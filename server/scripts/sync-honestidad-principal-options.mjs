/**
 * Sincroniza options + scoreByIndex de p1–p40 (sección `principal`) desde defaultDefinition.js
 * hacia AssessmentDefinition.config persistido en PostgreSQL.
 *
 * Idempotente. Solo toca la sección principal; no modifica prompts ni metadata de p1–p40.
 *
 * Uso:
 *   node server/scripts/sync-honestidad-principal-options.mjs              # dry-run
 *   node server/scripts/sync-honestidad-principal-options.mjs --dry-run
 *   node server/scripts/sync-honestidad-principal-options.mjs --apply
 *   node server/scripts/sync-honestidad-principal-options.mjs --validate-structure
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { defaultDemoAssessmentConfig } from '../src/assessment/defaultDefinition.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DEF_KEY = 'honestidad_confianza';
const DEF_VERSION = 1;
const PRINCIPAL_IDS = Array.from({ length: 40 }, (_, i) => `p${i + 1}`);

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const validateStructure = argv.includes('--validate-structure');
  const dryRun = validateStructure ? false : !apply || argv.includes('--dry-run');
  if (apply && validateStructure) {
    throw new Error('Use either --apply or --validate-structure, not both.');
  }
  return { apply, dryRun, validateStructure };
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function findPrincipalSection(config) {
  return config?.sections?.find((s) => s?.id === 'principal') ?? null;
}

function indexPrincipalQuestions(section) {
  const map = new Map();
  for (const q of section?.questions ?? []) {
    if (q?.id) map.set(q.id, q);
  }
  return map;
}

function getCanonicalPrincipalQuestions() {
  const principal = findPrincipalSection(defaultDemoAssessmentConfig);
  if (!principal) throw new Error('defaultDefinition.js: falta sección principal.');
  const byId = indexPrincipalQuestions(principal);
  const missing = PRINCIPAL_IDS.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new Error(`defaultDefinition.js: faltan ${missing.join(', ')}`);
  }
  for (const id of PRINCIPAL_IDS) {
    validateQuestionStructure(byId.get(id), id, 'canonical');
  }
  return byId;
}

function validateQuestionStructure(q, id, label) {
  if (!q || q.kind !== 'likert') {
    throw new Error(`${label} ${id}: kind likert requerido.`);
  }
  if (q.id !== id) throw new Error(`${label}: id esperado ${id}.`);
  if (!Array.isArray(q.options) || q.options.length !== 4) {
    throw new Error(`${label} ${id}: options debe tener 4 strings.`);
  }
  if (!Array.isArray(q.scoreByIndex) || q.scoreByIndex.length !== 4) {
    throw new Error(`${label} ${id}: scoreByIndex debe tener 4 números.`);
  }
  if (!q.prompt || !q.dimension) {
    throw new Error(`${label} ${id}: prompt/dimension requeridos.`);
  }
}

function validateStoredPrincipal(section) {
  if (!section || section.id !== 'principal') {
    throw new Error('Config persistida: no se encontró sección principal.');
  }
  const byId = indexPrincipalQuestions(section);
  const missing = PRINCIPAL_IDS.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new Error(`Config persistida: faltan ${missing.join(', ')}`);
  }
  for (const id of PRINCIPAL_IDS) {
    validateQuestionStructure(byId.get(id), id, 'persistida');
  }
  return byId;
}

function diffPrincipalQuestion(stored, canonical) {
  const changes = [];
  if (!arraysEqual(stored.options, canonical.options)) {
    changes.push({ field: 'options', from: [...stored.options], to: [...canonical.options] });
  }
  if (!arraysEqual(stored.scoreByIndex, canonical.scoreByIndex)) {
    changes.push({
      field: 'scoreByIndex',
      from: [...stored.scoreByIndex],
      to: [...canonical.scoreByIndex],
    });
  }
  return changes;
}

function buildSyncedConfig(existingConfig, canonicalById) {
  const config = structuredClone(existingConfig);
  const principal = findPrincipalSection(config);
  validateStoredPrincipal(principal);
  for (const question of principal.questions) {
    if (!PRINCIPAL_IDS.includes(question.id)) continue;
    const canonical = canonicalById.get(question.id);
    question.options = [...canonical.options];
    question.scoreByIndex = [...canonical.scoreByIndex];
  }
  return config;
}

function collectPlannedChanges(storedById, canonicalById) {
  const planned = [];
  for (const id of PRINCIPAL_IDS) {
    const changes = diffPrincipalQuestion(storedById.get(id), canonicalById.get(id));
    if (changes.length) planned.push({ id, changes });
  }
  return planned;
}

function printDefinitionSummary(def) {
  console.log('Objetivo de sincronización (única fila global):');
  console.log(`  id:             ${def.id}`);
  console.log(`  key:            ${def.key}`);
  console.log(`  version:        ${def.version}`);
  console.log(`  organizationId: ${def.organizationId === null ? 'null' : def.organizationId}`);
  console.log(
    `  Confirmación:   única fila con key="${DEF_KEY}", version=${DEF_VERSION}, organizationId=null`,
  );
}

function printPlannedChanges(planned) {
  if (!planned.length) {
    console.log('\nSin cambios pendientes: p1–p40 ya coinciden con defaultDefinition.js.');
    return;
  }
  console.log(`\nCampos a actualizar (${planned.length} reactivo(s)) — solo options + scoreByIndex:`);
  for (const { id, changes } of planned) {
    console.log(`\n  [${id}]`);
    for (const c of changes) {
      console.log(`    ${c.field}:`);
      console.log(`      actual:  ${JSON.stringify(c.from)}`);
      console.log(`      nuevo:   ${JSON.stringify(c.to)}`);
    }
  }
}

async function resolveUniqueGlobalDefinition(prisma) {
  const matches = await prisma.assessmentDefinition.findMany({
    where: { key: DEF_KEY, version: DEF_VERSION, organizationId: null },
  });
  if (matches.length === 0) {
    throw new Error(
      `No existe AssessmentDefinition con key="${DEF_KEY}", version=${DEF_VERSION}, organizationId=null.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Se encontraron ${matches.length} definiciones globales (ids: ${matches.map((d) => d.id).join(', ')}).`,
    );
  }
  return matches[0];
}

function runStructureValidation() {
  console.log('=== Validación local de estructura (sin BD) ===\n');
  getCanonicalPrincipalQuestions();
  console.log('Fuente canónica: OK — p1–p40 presentes.\n');
  console.log('Use --dry-run con DATABASE_URL para inspeccionar producción.');
}

async function runWithDatabase({ apply, dryRun }) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL no configurada. Use --validate-structure para validación local.');
  }
  const prisma = new PrismaClient();
  try {
    const def = await resolveUniqueGlobalDefinition(prisma);
    printDefinitionSummary(def);
    const storedById = validateStoredPrincipal(findPrincipalSection(def.config));
    const canonicalById = getCanonicalPrincipalQuestions();
    const planned = collectPlannedChanges(storedById, canonicalById);
    console.log(`\nModo: ${apply ? 'APPLY (escritura)' : 'DRY-RUN (sin escritura)'}`);
    printPlannedChanges(planned);
    if (!planned.length) return;
    if (dryRun) {
      console.log('\nDry-run: no se escribió en BD. Use --apply para persistir.');
      return;
    }
    const defConfirm = await resolveUniqueGlobalDefinition(prisma);
    if (defConfirm.id !== def.id) {
      throw new Error('La definición objetivo cambió entre validación y escritura.');
    }
    await prisma.assessmentDefinition.update({
      where: { id: def.id },
      data: { config: buildSyncedConfig(def.config, canonicalById) },
    });
    console.log(`\nActualización aplicada en AssessmentDefinition ${def.id}.`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const { apply, dryRun, validateStructure } = parseArgs(process.argv.slice(2));
  if (validateStructure) {
    runStructureValidation();
    return;
  }
  await runWithDatabase({ apply, dryRun });
}

main().catch((err) => {
  console.error(`\n[sync-honestidad-principal-options] ABORT: ${err.message}`);
  process.exit(1);
});

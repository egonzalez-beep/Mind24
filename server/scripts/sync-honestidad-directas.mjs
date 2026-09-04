/**
 * Sincroniza únicamente prompt + options de d1–d5 (sección `directas`) en
 * AssessmentDefinition.config desde defaultDefinition.js.
 *
 * No toca c1–c5, p1–p40, scoring, dimensiones ni otras secciones.
 * Idempotente: una segunda ejecución con --apply no modifica filas ya alineadas.
 *
 * Uso:
 *   node server/scripts/sync-honestidad-directas.mjs              # dry-run (default)
 *   node server/scripts/sync-honestidad-directas.mjs --dry-run    # explícito
 *   node server/scripts/sync-honestidad-directas.mjs --apply        # escribe en BD
 *   node server/scripts/sync-honestidad-directas.mjs --validate-structure  # sin BD
 *
 * Requiere DATABASE_URL en server/.env (o entorno) para --dry-run / --apply.
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
const DIRECT_IDS = ['d1', 'd2', 'd3', 'd4', 'd5'];

const REQUIRED_QUESTION_KEYS = [
  'id',
  'kind',
  'labelType',
  'prompt',
  'options',
  'scoreByIndex',
  'denialOptionIndex',
];

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

function findDirectasSection(config) {
  const sections = config?.sections;
  if (!Array.isArray(sections)) return null;
  return sections.find((s) => s && s.id === 'directas') ?? null;
}

function indexDirectQuestions(section) {
  const map = new Map();
  for (const q of section?.questions ?? []) {
    if (q?.id) map.set(q.id, q);
  }
  return map;
}

function getCanonicalDirectQuestions() {
  const directas = findDirectasSection(defaultDemoAssessmentConfig);
  if (!directas) {
    throw new Error('defaultDefinition.js: falta sección directas.');
  }
  const byId = indexDirectQuestions(directas);
  const missing = DIRECT_IDS.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new Error(`defaultDefinition.js: faltan reactivos canónicos: ${missing.join(', ')}`);
  }
  for (const id of DIRECT_IDS) {
    validateQuestionStructure(byId.get(id), id, 'canonical');
  }
  return byId;
}

function validateQuestionStructure(q, id, label) {
  if (!q || typeof q !== 'object') {
    throw new Error(`${label} ${id}: pregunta inválida o ausente.`);
  }
  for (const key of REQUIRED_QUESTION_KEYS) {
    if (!(key in q)) {
      throw new Error(`${label} ${id}: falta campo requerido "${key}".`);
    }
  }
  if (q.id !== id) {
    throw new Error(`${label}: id esperado ${id}, encontrado ${q.id}.`);
  }
  if (q.kind !== 'direct') {
    throw new Error(`${label} ${id}: kind debe ser "direct", encontrado "${q.kind}".`);
  }
  if (q.denialOptionIndex !== 1) {
    throw new Error(
      `${label} ${id}: denialOptionIndex debe ser 1, encontrado ${q.denialOptionIndex}.`,
    );
  }
  if (!Array.isArray(q.options) || q.options.length !== 4) {
    throw new Error(`${label} ${id}: options debe ser un array de 4 strings.`);
  }
  if (!Array.isArray(q.scoreByIndex) || q.scoreByIndex.length !== 4) {
    throw new Error(`${label} ${id}: scoreByIndex debe ser un array de 4 números.`);
  }
}

function validateStoredDirectas(section) {
  if (!section || section.id !== 'directas') {
    throw new Error('Config persistida: no se encontró sección directas.');
  }
  const byId = indexDirectQuestions(section);
  const foundIds = DIRECT_IDS.filter((id) => byId.has(id));
  if (foundIds.length !== DIRECT_IDS.length) {
    const missing = DIRECT_IDS.filter((id) => !byId.has(id));
    throw new Error(
      `Config persistida: se esperaban exactamente d1–d5; faltan: ${missing.join(', ')}.`,
    );
  }
  for (const id of DIRECT_IDS) {
    validateQuestionStructure(byId.get(id), id, 'persistida');
  }
  return byId;
}

function diffDirectQuestion(stored, canonical) {
  const changes = [];
  if (stored.prompt !== canonical.prompt) {
    changes.push({ field: 'prompt', from: stored.prompt, to: canonical.prompt });
  }
  if (!arraysEqual(stored.options, canonical.options)) {
    changes.push({ field: 'options', from: [...stored.options], to: [...canonical.options] });
  }
  return changes;
}

function buildSyncedConfig(existingConfig, canonicalById) {
  const config = structuredClone(existingConfig);
  const directas = findDirectasSection(config);
  validateStoredDirectas(directas);

  for (const question of directas.questions) {
    if (!DIRECT_IDS.includes(question.id)) continue;
    const canonical = canonicalById.get(question.id);
    question.prompt = canonical.prompt;
    question.options = [...canonical.options];
  }
  return config;
}

function collectPlannedChanges(storedById, canonicalById) {
  const planned = [];
  for (const id of DIRECT_IDS) {
    const stored = storedById.get(id);
    const canonical = canonicalById.get(id);
    const changes = diffDirectQuestion(stored, canonical);
    if (changes.length) {
      planned.push({ id, changes });
    }
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
  console.log(`  name:           ${def.name}`);
  console.log(`  isActive:       ${def.isActive}`);
  console.log(`  updatedAt:      ${def.updatedAt?.toISOString?.() ?? def.updatedAt}`);
}

async function resolveUniqueGlobalDefinition(prisma) {
  const matches = await prisma.assessmentDefinition.findMany({
    where: {
      key: DEF_KEY,
      version: DEF_VERSION,
      organizationId: null,
    },
  });

  if (matches.length === 0) {
    throw new Error(
      `No existe AssessmentDefinition con key="${DEF_KEY}", version=${DEF_VERSION}, organizationId=null. Abortando sin cambios.`,
    );
  }
  if (matches.length > 1) {
    const ids = matches.map((d) => d.id).join(', ');
    throw new Error(
      `Se encontraron ${matches.length} definiciones con key="${DEF_KEY}", version=${DEF_VERSION}, organizationId=null (ids: ${ids}). Se requiere exactamente una. Abortando sin cambios.`,
    );
  }

  return matches[0];
}

function printPlannedChanges(planned) {
  if (!planned.length) {
    console.log('\nSin cambios pendientes: d1–d5 ya coinciden con defaultDefinition.js.');
    return;
  }
  console.log(`\nCampos a actualizar (${planned.length} reactivo(s)):`);
  for (const { id, changes } of planned) {
    console.log(`\n  [${id}]`);
    for (const c of changes) {
      console.log(`    ${c.field}:`);
      console.log(`      actual:  ${JSON.stringify(c.from)}`);
      console.log(`      nuevo:   ${JSON.stringify(c.to)}`);
    }
  }
}

function runStructureValidation() {
  console.log('=== Validación local de estructura (sin BD) ===\n');
  const canonicalById = getCanonicalDirectQuestions();
  console.log('Fuente canónica (defaultDefinition.js): OK — d1–d5 presentes y válidos.\n');

  const syntheticStored = structuredClone(defaultDemoAssessmentConfig);
  const directas = findDirectasSection(syntheticStored);
  for (const id of DIRECT_IDS) {
    const q = directas.questions.find((item) => item.id === id);
    q.prompt = `[LEGACY] ${id} prompt anterior`;
    q.options = ['Opción A', 'Opción B', 'Opción C', 'Opción D'];
  }

  validateStoredDirectas(directas);
  const storedById = indexDirectQuestions(directas);
  const planned = collectPlannedChanges(storedById, canonicalById);
  printPlannedChanges(planned);

  const syncedOnce = buildSyncedConfig(syntheticStored, canonicalById);
  const syncedDirectas = findDirectasSection(syncedOnce);
  const resyncPlanned = collectPlannedChanges(
    indexDirectQuestions(syncedDirectas),
    canonicalById,
  );
  if (resyncPlanned.length !== 0) {
    throw new Error('Idempotencia fallida: segundo merge generaría cambios adicionales.');
  }
  console.log('\nIdempotencia (merge simulado x2): OK');
  console.log('\nValidación local completada. Para inspeccionar producción use --dry-run con DATABASE_URL.');
}

async function runWithDatabase({ apply, dryRun }) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error(
      'DATABASE_URL no configurada. Use --validate-structure para validación local sin BD.',
    );
  }

  const prisma = new PrismaClient();
  try {
    const def = await resolveUniqueGlobalDefinition(prisma);
    if (!def.isActive) {
      console.warn(
        `Advertencia: definición ${def.id} tiene isActive=false; se sincronizará igualmente por key/version/organizationId.`,
      );
    }

    printDefinitionSummary(def);

    const existingConfig = def.config;
    if (!existingConfig || typeof existingConfig !== 'object') {
      throw new Error('Config persistida inválida: no es un objeto JSON.');
    }

    const directas = findDirectasSection(existingConfig);
    const storedById = validateStoredDirectas(directas);
    const canonicalById = getCanonicalDirectQuestions();
    const planned = collectPlannedChanges(storedById, canonicalById);

    console.log(`\nModo: ${apply ? 'APPLY (escritura)' : 'DRY-RUN (sin escritura)'}`);
    printPlannedChanges(planned);

    if (!planned.length) {
      console.log('\nResultado: ya sincronizado.');
      return;
    }

    if (dryRun) {
      console.log('\nDry-run: no se escribió en BD. Use --apply para persistir.');
      return;
    }

    const defConfirm = await resolveUniqueGlobalDefinition(prisma);
    if (defConfirm.id !== def.id) {
      throw new Error(
        `La definición objetivo cambió entre validación y escritura (antes: ${def.id}, ahora: ${defConfirm.id}). Abortando sin cambios.`,
      );
    }

    const nextConfig = buildSyncedConfig(existingConfig, canonicalById);
    await prisma.assessmentDefinition.update({
      where: { id: def.id },
      data: { config: nextConfig },
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
  console.error(`\n[sync-honestidad-directas] ABORT: ${err.message}`);
  process.exit(1);
});

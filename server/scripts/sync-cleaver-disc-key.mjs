/**
 * Sincroniza la clave DISC M/L del banco Cleaver hacia producción.
 *
 * Solo escribe `QuestionOption.metadata` y `QuestionOption.value`.
 * NO borra preguntas, NO recrea optionIds, NO toca CandidateResponse,
 * NO recalcula resultados históricos.
 *
 * Uso:
 *   node server/scripts/sync-cleaver-disc-key.mjs --validate-structure   # sin BD
 *   node server/scripts/sync-cleaver-disc-key.mjs                        # dry-run
 *   node server/scripts/sync-cleaver-disc-key.mjs --dry-run
 *   node server/scripts/sync-cleaver-disc-key.mjs --apply
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import {
  CLEAVER_CATALOG_VERSION,
  CLEAVER_TETRAD_COUNT,
  cleaverBankValidation,
  cleaverBlockByOrder,
  cleaverOptionMetadataEquals,
} from '../src/data/cleaverData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MODULE_KEY = 'cleaver';

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const validateStructure = argv.includes('--validate-structure');
  if (apply && validateStructure) {
    throw new Error('Use --apply o --validate-structure, no ambos.');
  }
  return { apply, validateStructure, dryRun: !apply };
}

function questionOrder(question) {
  const meta = question?.metadata;
  const declared =
    meta && typeof meta === 'object' && !Array.isArray(meta)
      ? Number(meta.order ?? meta.blockNumber)
      : Number.NaN;
  if (Number.isInteger(declared) && declared >= 1 && declared <= CLEAVER_TETRAD_COUNT) {
    return declared;
  }
  return Number(question?.sortOrder) + 1;
}

function printBankSummary() {
  const { summary, warnings } = cleaverBankValidation;
  console.log('Banco canónico Cleaver:');
  console.log(`  tétradas:                 ${summary.blocks}`);
  console.log(`  opciones:                 ${summary.options}`);
  console.log(`  clave M/L verificada:     ${summary.verifiedCount} bloque(s) → ${summary.verifiedBlocks.join(', ') || '—'}`);
  console.log(`  clave M/L pendiente:      ${summary.pendingCount} bloque(s)`);
  console.log(`  banco 100% verificado:    ${summary.fullyVerified ? 'sí' : 'no'}`);
  if (warnings.length) {
    console.log('\nAdvertencias estructurales:');
    for (const w of warnings) console.log(`  - ${w}`);
  }
}

function planChanges(questions) {
  const planned = [];
  const blockers = [];

  if (questions.length !== CLEAVER_TETRAD_COUNT) {
    blockers.push(
      `Se encontraron ${questions.length} tétradas activas, se esperaban ${CLEAVER_TETRAD_COUNT}.`,
    );
  }

  const seenOrders = new Set();

  for (const question of questions) {
    const order = questionOrder(question);
    const block = cleaverBlockByOrder(order);
    if (!block) {
      blockers.push(`Pregunta ${question.id}: bloque ${order} no existe en el banco canónico.`);
      continue;
    }
    if (seenOrders.has(order)) {
      blockers.push(`Bloque ${order} declarado por más de una pregunta.`);
      continue;
    }
    seenOrders.add(order);

    if (question.options.length !== block.options.length) {
      blockers.push(
        `Bloque ${order}: ${question.options.length} opciones persistidas, se esperaban ${block.options.length}.`,
      );
      continue;
    }

    const canonicalByLabel = new Map(block.options.map((opt) => [opt.text, opt]));
    for (const option of question.options) {
      const canonical = canonicalByLabel.get(option.label);
      if (!canonical) {
        blockers.push(`Bloque ${order}: label "${option.label}" no está en el banco canónico.`);
        continue;
      }
      const sameMetadata = cleaverOptionMetadataEquals(option.metadata, canonical.metadata);
      const sameValue = (option.value ?? '') === canonical.value;
      if (sameMetadata && sameValue) continue;

      planned.push({
        order,
        optionId: option.id,
        label: option.label,
        from: { metadata: option.metadata, value: option.value ?? '' },
        to: { metadata: canonical.metadata, value: canonical.value },
      });
    }
  }

  const missingOrders = [];
  for (let order = 1; order <= CLEAVER_TETRAD_COUNT; order++) {
    if (!seenOrders.has(order)) missingOrders.push(order);
  }
  if (missingOrders.length) {
    blockers.push(`Bloques ausentes en BD: ${missingOrders.join(', ')}.`);
  }

  return { planned, blockers };
}

function printPlan(planned) {
  if (!planned.length) {
    console.log('\nSin cambios pendientes: la clave M/L persistida ya coincide con el banco canónico.');
    return;
  }
  console.log(`\nOpciones a actualizar (${planned.length}) — solo metadata + value:`);
  for (const change of planned) {
    console.log(`\n  [bloque ${change.order}] ${change.label} (${change.optionId})`);
    console.log(`    actual:  value=${JSON.stringify(change.from.value)} metadata=${JSON.stringify(change.from.metadata)}`);
    console.log(`    nuevo:   value=${JSON.stringify(change.to.value)} metadata=${JSON.stringify(change.to.metadata)}`);
  }
}

async function loadCleaverQuestions(prisma) {
  const mod = await prisma.evaluationModule.findUnique({
    where: { key: MODULE_KEY },
    select: { id: true, key: true, description: true, isActive: true },
  });
  if (!mod) throw new Error(`No existe EvaluationModule con key="${MODULE_KEY}".`);

  const questions = await prisma.question.findMany({
    where: { moduleId: mod.id, type: 'CLEAVER_MATRIX', isActive: true },
    include: { options: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { sortOrder: 'asc' },
  });

  return { mod, questions };
}

async function runWithDatabase({ apply, dryRun }) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL no configurada. Use --validate-structure para validación local.');
  }
  const prisma = new PrismaClient();
  try {
    const { mod, questions } = await loadCleaverQuestions(prisma);
    console.log(`Módulo objetivo: ${mod.key} (${mod.id}) · activo: ${mod.isActive}`);
    console.log(`Tétradas activas en BD: ${questions.length}\n`);
    printBankSummary();

    const { planned, blockers } = planChanges(questions);

    if (blockers.length) {
      console.log('\nBloqueos estructurales (no se escribe nada):');
      for (const b of blockers) console.log(`  - ${b}`);
      throw new Error('El banco persistido no es compatible con la sincronización por label.');
    }

    console.log(`\nModo: ${apply ? 'APPLY (escritura)' : 'DRY-RUN (sin escritura)'}`);
    printPlan(planned);

    if (dryRun) {
      if (planned.length) console.log('\nDry-run: no se escribió en BD. Use --apply para persistir.');
      return;
    }

    let written = 0;
    for (const change of planned) {
      await prisma.questionOption.update({
        where: { id: change.optionId },
        data: { metadata: change.to.metadata, value: change.to.value },
      });
      written++;
    }

    const stamp = `[catalog:v${CLEAVER_CATALOG_VERSION}]`;
    if (!String(mod.description || '').includes(stamp)) {
      console.log(`\nNota: la descripción del módulo no contiene ${stamp}; el bootstrap la sella al arrancar.`);
    }

    console.log(`\nActualización aplicada: ${written} opción(es). Preguntas, optionIds y respuestas intactas.`);

    const { questions: after } = await loadCleaverQuestions(prisma);
    const verify = planChanges(after);
    if (verify.planned.length === 0 && verify.blockers.length === 0) {
      console.log('Verificación post-escritura: la clave M/L persistida coincide con el banco canónico.');
    } else {
      console.log('Verificación post-escritura: quedaron diferencias; revisar salida anterior.');
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const { apply, dryRun, validateStructure } = parseArgs(process.argv.slice(2));
  if (validateStructure) {
    console.log('=== Validación local del banco Cleaver (sin BD) ===\n');
    printBankSummary();
    console.log('\nEstructura canónica: OK.');
    return;
  }
  await runWithDatabase({ apply, dryRun });
}

main().catch((err) => {
  console.error(`\n[sync-cleaver-disc-key] ABORT: ${err.message}`);
  process.exit(1);
});

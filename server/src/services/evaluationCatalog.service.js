import { prisma as defaultPrisma } from '../db/client.js';
import { CLEAVER_TETRAD_COUNT, cleaverBlocks } from '../data/cleaverData.js';
import {
  SJT_SALES_CATALOG_VERSION,
  sjtSalesQuestionCount,
  sjtSalesQuestionsFlat,
} from '../data/sjtSalesData.js';
import {
  TERMAN_CATALOG_VERSION,
  termanQuestionCount,
  termanQuestionsFlat,
} from '../data/termanData.js';

/** Incrementar cuando cambie la clave DISC o el banco Cleaver (fuerza resync en prod). */
export const CLEAVER_CATALOG_VERSION = 2;
import {
  MODULE_CATALOG,
  MIND24_MODULE_KEYS,
  isModuleActiveInDb,
} from '../utils/moduleCatalog.js';

const PLACEHOLDER_QUESTIONS = [
  {
    moduleKey: 'entrevista_digital',
    type: 'AUDIO_RECORDING',
    text: '[Demo] Graba un audio de 30–60 segundos: ¿Por qué te interesa este puesto?',
    metadata: { maxDurationSec: 60, placeholder: 'Pulsa grabar cuando estés listo.' },
  },
  {
    moduleKey: 'medida',
    type: 'OPEN_TEXT',
    text: '[Demo] Describe brevemente una situación donde resolviste un problema en equipo.',
    metadata: { maxLength: 500, placeholder: 'Escribe tu respuesta aquí…' },
  },
];

async function upsertModules(db) {
  const moduleIdByKey = {};
  for (let i = 0; i < MIND24_MODULE_KEYS.length; i++) {
    const key = MIND24_MODULE_KEYS[i];
    const cat = MODULE_CATALOG[key];
    const mod = await db.evaluationModule.upsert({
      where: { key },
      create: {
        key,
        title: cat.label,
        description: cat.description,
        icon: cat.icon,
        sortOrder: i,
        isActive: isModuleActiveInDb(key),
      },
      update: {
        title: cat.label,
        description: cat.description,
        icon: cat.icon,
        sortOrder: i,
        isActive: isModuleActiveInDb(key),
      },
    });
    moduleIdByKey[key] = mod.id;
  }
  const cleaverId = moduleIdByKey.cleaver;
  if (cleaverId) {
    const cat = MODULE_CATALOG.cleaver;
    await db.evaluationModule.update({
      where: { id: cleaverId },
      data: {
        description: `${cat.description} [catalog:v${CLEAVER_CATALOG_VERSION}]`,
      },
    });
  }

  await db.evaluationModule.updateMany({
    where: {
      key: { in: ['cognitivo', 'raven', 'mrr', 'habilidades_especificas'] },
    },
    data: { isActive: false },
  });

  return moduleIdByKey;
}

async function ensurePlaceholderQuestions(db, moduleIdByKey) {
  let created = 0;
  for (let i = 0; i < PLACEHOLDER_QUESTIONS.length; i++) {
    const spec = PLACEHOLDER_QUESTIONS[i];
    const moduleId = moduleIdByKey[spec.moduleKey];
    if (!moduleId) continue;

    const existing = await db.question.count({
      where: { moduleId, type: spec.type, isActive: true },
    });
    if (existing > 0) continue;

    await db.question.create({
      data: {
        moduleId,
        type: spec.type,
        text: spec.text,
        metadata: spec.metadata ?? undefined,
        sortOrder: i,
        options: spec.options
          ? {
              create: spec.options.map((o, j) => ({
                label: o.label,
                value: o.value,
                metadata: o.metadata ?? undefined,
                sortOrder: j,
              })),
            }
          : undefined,
      },
    });
    created++;
  }
  return created;
}

async function cleaverBankNeedsResync(db, moduleId) {
  const expected = CLEAVER_TETRAD_COUNT;
  const existing = await db.question.count({
    where: { moduleId, type: 'CLEAVER_MATRIX', isActive: true },
  });
  if (existing !== expected) return true;

  const options = await db.questionOption.findMany({
    where: {
      question: { moduleId, type: 'CLEAVER_MATRIX', isActive: true },
    },
    select: { metadata: true, value: true },
  });
  if (options.length !== expected * 4) return true;

  const versionRow = await db.evaluationModule.findUnique({
    where: { id: moduleId },
    select: { description: true },
  });
  const desc = String(versionRow?.description || '');
  if (!desc.includes(`catalog:v${CLEAVER_CATALOG_VERSION}`)) return true;

  return options.some((o) => {
    const meta = o.metadata;
    const dim =
      meta && typeof meta === 'object' && !Array.isArray(meta)
        ? String(meta.dimension || '').trim()
        : '';
    return !dim || !['D', 'I', 'S', 'C'].includes(dim.toUpperCase());
  });
}

async function ensureCleaverQuestions(db, moduleId) {
  const expected = CLEAVER_TETRAD_COUNT;
  const existing = await db.question.count({
    where: { moduleId, type: 'CLEAVER_MATRIX', isActive: true },
  });

  if (existing === expected && !(await cleaverBankNeedsResync(db, moduleId))) {
    return { existing, created: 0, expected };
  }

  if (existing > 0) {
    await db.question.deleteMany({
      where: { moduleId, type: 'CLEAVER_MATRIX' },
    });
  }

  for (let b = 0; b < cleaverBlocks.length; b++) {
    const block = cleaverBlocks[b];
    const order = block.order;
    await db.question.create({
      data: {
        moduleId,
        type: 'CLEAVER_MATRIX',
        text: `Bloque ${order} — Selecciona la palabra que MÁS y MENOS te describe.`,
        metadata: {
          order,
          blockNumber: order,
          instruction: 'Elige una palabra en MÁS y otra distinta en MENOS.',
        },
        sortOrder: b,
        options: {
          create: block.options.map((opt, j) => {
            const dimension = opt.metadata?.dimension ?? '';
            return {
              label: opt.text,
              value: dimension,
              metadata: { dimension },
              sortOrder: j,
            };
          }),
        },
      },
    });
  }

  return { existing, created: cleaverBlocks.length, expected };
}

async function termanBankNeedsResync(db, moduleId) {
  const expected = termanQuestionCount();
  const existing = await db.question.count({
    where: { moduleId, type: 'MULTIPLE_CHOICE', isActive: true },
  });
  if (existing !== expected) return true;

  const mod = await db.evaluationModule.findUnique({
    where: { id: moduleId },
    select: { description: true },
  });
  const desc = String(mod?.description || '');
  return !desc.includes(`terman:v${TERMAN_CATALOG_VERSION}`);
}

async function ensureTermanQuestions(db, moduleId) {
  const expected = termanQuestionCount();
  const existing = await db.question.count({
    where: { moduleId, type: 'MULTIPLE_CHOICE', isActive: true },
  });

  if (existing === expected && !(await termanBankNeedsResync(db, moduleId))) {
    return { existing, created: 0, expected };
  }

  if (existing > 0) {
    await db.question.deleteMany({
      where: { moduleId, type: 'MULTIPLE_CHOICE' },
    });
  }

  const flat = termanQuestionsFlat();
  for (const row of flat) {
    await db.question.create({
      data: {
        moduleId,
        type: 'MULTIPLE_CHOICE',
        text: row.text,
        metadata: {
          termanItemId: row.termanItemId,
          seriesId: row.seriesId,
          seriesName: row.seriesName,
          seriesIndex: row.seriesIndex,
          seriesTimeLimitSeconds: row.seriesTimeLimitSeconds,
          seriesInstruction: row.seriesInstruction,
          questionIndexInSeries: row.questionIndexInSeries,
          correctIndex: row.correctIndex,
        },
        sortOrder: row.sortOrder,
        options: {
          create: row.options.map((label, j) => ({
            label,
            value: String(j),
            sortOrder: j,
          })),
        },
      },
    });
  }

  const cat = MODULE_CATALOG.terman;
  await db.evaluationModule.update({
    where: { id: moduleId },
    data: {
      description: `${cat.description} [terman:v${TERMAN_CATALOG_VERSION}]`,
    },
  });

  return { existing, created: flat.length, expected };
}

async function sjtSalesBankNeedsResync(db, moduleId) {
  const expected = sjtSalesQuestionCount();
  const existing = await db.question.count({
    where: { moduleId, type: 'MULTIPLE_CHOICE', isActive: true },
  });
  if (existing !== expected) return true;

  const mod = await db.evaluationModule.findUnique({
    where: { id: moduleId },
    select: { description: true },
  });
  const desc = String(mod?.description || '');
  return !desc.includes(`sales_sjt:v${SJT_SALES_CATALOG_VERSION}`);
}

async function ensureSalesSjtQuestions(db, moduleId) {
  const expected = sjtSalesQuestionCount();
  const existing = await db.question.count({
    where: { moduleId, type: 'MULTIPLE_CHOICE', isActive: true },
  });

  if (existing === expected && !(await sjtSalesBankNeedsResync(db, moduleId))) {
    return { existing, created: 0, expected };
  }

  if (existing > 0) {
    await db.question.deleteMany({
      where: { moduleId, type: 'MULTIPLE_CHOICE' },
    });
  }

  const flat = sjtSalesQuestionsFlat();
  for (const row of flat) {
    await db.question.create({
      data: {
        moduleId,
        type: 'MULTIPLE_CHOICE',
        text: row.text,
        metadata: {
          scenarioId: row.scenarioId,
          competence: row.competence,
          scenarioIndex: row.scenarioIndex,
          maxPoints: row.maxPoints,
        },
        sortOrder: row.sortOrder,
        options: {
          create: row.options.map((opt) => ({
            label: opt.label,
            value: String(opt.sortOrder),
            sortOrder: opt.sortOrder,
            metadata: { points: opt.points },
          })),
        },
      },
    });
  }

  const cat = MODULE_CATALOG.sales_sjt;
  await db.evaluationModule.update({
    where: { id: moduleId },
    data: {
      description: `${cat.description} [sales_sjt:v${SJT_SALES_CATALOG_VERSION}]`,
    },
  });

  return { existing, created: flat.length, expected };
}

/**
 * Idempotente: asegura módulos del catálogo y preguntas mínimas (Cleaver, placeholders).
 * No borra usuarios, asignaciones ni intentos. Seguro en cada arranque de producción.
 */
export async function ensureEvaluationCatalog(db = defaultPrisma) {
  const moduleIdByKey = await upsertModules(db);
  const placeholdersCreated = await ensurePlaceholderQuestions(db, moduleIdByKey);

  const cleaverModuleId = moduleIdByKey.cleaver;
  let cleaver = { existing: 0, created: 0 };
  if (cleaverModuleId) {
    cleaver = await ensureCleaverQuestions(db, cleaverModuleId);
  }

  const termanModuleId = moduleIdByKey.terman;
  let terman = { existing: 0, created: 0 };
  if (termanModuleId) {
    terman = await ensureTermanQuestions(db, termanModuleId);
  }

  const salesSjtModuleId = moduleIdByKey.sales_sjt;
  let salesSjt = { existing: 0, created: 0 };
  if (salesSjtModuleId) {
    salesSjt = await ensureSalesSjtQuestions(db, salesSjtModuleId);
  }

  const cleaverCount = cleaverModuleId
    ? await db.question.count({
        where: { moduleId: cleaverModuleId, type: 'CLEAVER_MATRIX', isActive: true },
      })
    : 0;

  const termanCount = termanModuleId
    ? await db.question.count({
        where: { moduleId: termanModuleId, type: 'MULTIPLE_CHOICE', isActive: true },
      })
    : 0;

  const salesSjtCount = salesSjtModuleId
    ? await db.question.count({
        where: { moduleId: salesSjtModuleId, type: 'MULTIPLE_CHOICE', isActive: true },
      })
    : 0;

  const summary = {
    modules: MIND24_MODULE_KEYS.length,
    cleaverQuestions: cleaverCount,
    cleaverExpected: CLEAVER_TETRAD_COUNT,
    termanQuestions: termanCount,
    termanExpected: termanQuestionCount(),
    salesSjtQuestions: salesSjtCount,
    salesSjtExpected: sjtSalesQuestionCount(),
    placeholdersCreated,
    cleaverSeeded: cleaver.created,
    termanSeeded: terman.created,
    salesSjtSeeded: salesSjt.created,
  };

  console.log('[catalog] Evaluation catalog OK:', summary);

  if (cleaverCount < CLEAVER_TETRAD_COUNT) {
    const err = new Error(
      `CLEAVER_INCOMPLETE: ${cleaverCount}/${CLEAVER_TETRAD_COUNT} tétradas activas`,
    );
    console.error('[catalog]', err.message);
    throw err;
  }

  if (termanCount < termanQuestionCount()) {
    const err = new Error(
      `TERMAN_INCOMPLETE: ${termanCount}/${termanQuestionCount()} ítems activos`,
    );
    console.error('[catalog]', err.message);
    throw err;
  }

  if (salesSjtCount < sjtSalesQuestionCount()) {
    const err = new Error(
      `SALES_SJT_INCOMPLETE: ${salesSjtCount}/${sjtSalesQuestionCount()} escenarios activos`,
    );
    console.error('[catalog]', err.message);
    throw err;
  }

  return summary;
}

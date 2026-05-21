import { prisma as defaultPrisma } from '../db/client.js';
import { cleaverBlocks } from '../data/cleaverData.js';
import { MODULE_CATALOG, MIND24_MODULE_KEYS } from '../utils/moduleCatalog.js';

const PLACEHOLDER_QUESTIONS = [
  {
    moduleKey: 'habilidades_especificas',
    type: 'MULTIPLE_CHOICE',
    text: '[Demo] Ante un cliente insatisfecho, ¿cuál es tu primer paso?',
    options: [
      { label: 'Escuchar con calma y pedir detalles', value: 'a' },
      { label: 'Derivar de inmediato sin escuchar', value: 'b' },
      { label: 'Ignorar el comentario', value: 'c' },
    ],
  },
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
        isActive: true,
      },
      update: {
        title: cat.label,
        description: cat.description,
        icon: cat.icon,
        sortOrder: i,
        isActive: true,
      },
    });
    moduleIdByKey[key] = mod.id;
  }
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

async function ensureCleaverQuestions(db, moduleId) {
  const existing = await db.question.count({
    where: { moduleId, type: 'CLEAVER_MATRIX', isActive: true },
  });

  if (existing >= cleaverBlocks.length) {
    return { existing, created: 0 };
  }

  if (existing > 0) {
    await db.question.deleteMany({
      where: { moduleId, type: 'CLEAVER_MATRIX' },
    });
  }

  for (let b = 0; b < cleaverBlocks.length; b++) {
    const block = cleaverBlocks[b];
    await db.question.create({
      data: {
        moduleId,
        type: 'CLEAVER_MATRIX',
        text: `Bloque ${block.blockNumber} — Selecciona la palabra que MÁS y MENOS te describe.`,
        metadata: {
          blockNumber: block.blockNumber,
          instruction: 'Elige una palabra en MÁS y otra distinta en MENOS.',
        },
        sortOrder: b,
        options: {
          create: block.options.map((opt, j) => ({
            label: opt.text,
            value: opt.dimension,
            metadata: { dimension: opt.dimension },
            sortOrder: j,
          })),
        },
      },
    });
  }

  return { existing, created: cleaverBlocks.length };
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

  const cleaverCount = cleaverModuleId
    ? await db.question.count({
        where: { moduleId: cleaverModuleId, type: 'CLEAVER_MATRIX', isActive: true },
      })
    : 0;

  const summary = {
    modules: MIND24_MODULE_KEYS.length,
    cleaverQuestions: cleaverCount,
    placeholdersCreated,
    cleaverSeeded: cleaver.created,
  };

  console.log('[catalog] Evaluation catalog OK:', summary);

  if (!cleaverCount) {
    const err = new Error('CLEAVER_MODULE_EMPTY_AFTER_CATALOG_SYNC');
    console.error('[catalog]', err.message);
    throw err;
  }

  return summary;
}

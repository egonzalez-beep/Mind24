import { prisma as defaultPrisma } from '../db/client.js';
import {
  CLEAVER_CATALOG_VERSION,
  CLEAVER_TETRAD_COUNT,
  cleaverBankValidation,
  cleaverBlockByOrder,
  cleaverBlocks,
  cleaverOptionMetadataEquals,
} from '../data/cleaverData.js';
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
import {
  PERSONALIDAD_MIND24_CATALOG_VERSION,
  PERSONALIDAD_MIND24_SCALE,
  personalitySyncableItemsFlat,
} from '../data/personalityMind24Data.js';

export { CLEAVER_CATALOG_VERSION };
import {
  MODULE_CATALOG,
  MIND24_MODULE_KEYS,
  isModuleActiveInDb,
} from '../utils/moduleCatalog.js';

const PLACEHOLDER_QUESTIONS = [
  {
    moduleKey: 'digital_interview',
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
      key: { in: ['cognitivo', 'raven', 'mrr', 'habilidades_especificas', 'entrevista_digital'] },
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

/** Número de bloque declarado por una pregunta Cleaver persistida. */
function cleaverQuestionOrder(question) {
  const meta = question?.metadata;
  const declared =
    meta && typeof meta === 'object' && !Array.isArray(meta)
      ? Number(meta.order ?? meta.blockNumber)
      : Number.NaN;
  if (Number.isInteger(declared) && declared >= 1 && declared <= CLEAVER_TETRAD_COUNT) {
    return declared;
  }
  const bySortOrder = Number(question?.sortOrder) + 1;
  return Number.isInteger(bySortOrder) ? bySortOrder : null;
}

async function countCleaverResponses(db, moduleId) {
  return db.candidateResponse.count({
    where: { question: { moduleId, type: 'CLEAVER_MATRIX' } },
  });
}

/**
 * Calcula (sin escribir) qué opciones Cleaver difieren de la clave M/L canónica.
 * Se planifica el lote completo antes de tocar la BD para no dejar escrituras a medias.
 */
function planCleaverOptionSync(questions) {
  const updates = [];
  for (const question of questions) {
    const order = cleaverQuestionOrder(question);
    const block = cleaverBlockByOrder(order);
    if (!block) {
      return { ok: false, reason: `pregunta ${question.id} sin bloque canónico (order=${order})` };
    }
    if (question.options.length !== block.options.length) {
      return {
        ok: false,
        reason: `tétrada ${order}: ${question.options.length} opciones persistidas, se esperaban ${block.options.length}`,
      };
    }

    const canonicalByLabel = new Map(block.options.map((opt) => [opt.text, opt]));
    for (const option of question.options) {
      const canonical = canonicalByLabel.get(option.label);
      if (!canonical) {
        return { ok: false, reason: `tétrada ${order}: label "${option.label}" fuera del banco canónico` };
      }
      const sameMetadata = cleaverOptionMetadataEquals(option.metadata, canonical.metadata);
      const sameValue = (option.value ?? '') === canonical.value;
      if (sameMetadata && sameValue) continue;

      updates.push({
        optionId: option.id,
        metadata: canonical.metadata,
        value: canonical.value,
      });
    }
  }
  return { ok: true, updates };
}

/**
 * Aplica el lote planificado. Solo escribe `metadata` y `value`: no borra
 * preguntas, no recrea optionIds y no toca CandidateResponse.
 */
async function applyCleaverOptionSync(db, updates) {
  for (const update of updates) {
    await db.questionOption.update({
      where: { id: update.optionId },
      data: { metadata: update.metadata, value: update.value },
    });
  }
  return updates.length;
}

async function createCleaverQuestions(db, moduleId) {
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
          create: block.options.map((opt, j) => ({
            label: opt.text,
            value: opt.value,
            metadata: opt.metadata,
            sortOrder: j,
          })),
        },
      },
    });
  }
  return cleaverBlocks.length;
}

/**
 * Idempotente y no destructivo: si las 24 tétradas existen, solo sincroniza la
 * metadata de sus opciones. Nunca borra preguntas que tengan respuestas.
 */
async function ensureCleaverQuestions(db, moduleId) {
  const expected = CLEAVER_TETRAD_COUNT;
  const questions = await db.question.findMany({
    where: { moduleId, type: 'CLEAVER_MATRIX', isActive: true },
    include: { options: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { sortOrder: 'asc' },
  });
  const existing = questions.length;

  if (existing === expected) {
    const plan = planCleaverOptionSync(questions);
    if (plan.ok) {
      const patched = await applyCleaverOptionSync(db, plan.updates);
      if (patched) {
        console.log(`[catalog] Cleaver: clave M/L sincronizada en ${patched} opción(es).`);
      }
      return { existing, created: 0, expected, patched };
    }

    const responses = await countCleaverResponses(db, moduleId);
    if (responses > 0) {
      console.warn(
        `[catalog] Cleaver: banco divergente con ${responses} respuesta(s) histórica(s); no se recrea. Motivo: ${plan.reason}`,
      );
      return { existing, created: 0, expected, patched: 0, mismatch: plan.reason, responses };
    }

    console.warn(`[catalog] Cleaver: banco divergente sin respuestas; se regenera. Motivo: ${plan.reason}`);
    await db.question.deleteMany({ where: { moduleId, type: 'CLEAVER_MATRIX' } });
    return { existing, created: await createCleaverQuestions(db, moduleId), expected, patched: 0 };
  }

  if (existing > 0) {
    const responses = await countCleaverResponses(db, moduleId);
    if (responses > 0) {
      console.warn(
        `[catalog] Cleaver: ${existing}/${expected} tétradas activas con ${responses} respuesta(s) histórica(s); requiere migración manual.`,
      );
      return { existing, created: 0, expected, patched: 0, mismatch: 'count_mismatch', responses };
    }
    await db.question.deleteMany({ where: { moduleId, type: 'CLEAVER_MATRIX' } });
  }

  return { existing, created: await createCleaverQuestions(db, moduleId), expected, patched: 0 };
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

function personalityMind24QuestionMetadata(item) {
  return {
    personalityItemId: item.itemId,
    dimensionId: item.dimensionId,
    direction: item.direction,
    bankStatus: item.bankStatus,
  };
}

function personalityItemIdFromQuestion(question) {
  const meta = question?.metadata;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  return typeof meta.personalityItemId === 'string' ? meta.personalityItemId : null;
}

function personalityMetadataEquals(stored, item) {
  const next = personalityMind24QuestionMetadata(item);
  if (!stored || typeof stored !== 'object') return false;
  return (
    stored.personalityItemId === next.personalityItemId &&
    stored.dimensionId === next.dimensionId &&
    stored.direction === next.direction &&
    stored.bankStatus === next.bankStatus
  );
}

function likertOptionNeedsUpdate(option, canonical) {
  return (
    option.label !== canonical.label ||
    (option.value ?? '') !== canonical.value ||
    Number(option.sortOrder) !== canonical.sortOrder
  );
}

function personalityMind24QuestionContentDrift(flat, existingQuestions, likertPayload) {
  const byItemId = new Map();
  for (const question of existingQuestions) {
    const itemId = personalityItemIdFromQuestion(question);
    if (itemId) byItemId.set(itemId, question);
  }

  const syncableIds = new Set(flat.map((item) => item.itemId));
  if (byItemId.size !== flat.length) return true;

  for (const question of existingQuestions) {
    const itemId = personalityItemIdFromQuestion(question);
    if (!itemId || !syncableIds.has(itemId)) return true;
  }

  for (const item of flat) {
    const question = byItemId.get(item.itemId);
    if (!question) return true;
    if (question.text !== item.text) return true;
    if (Number(question.sortOrder) !== item.sortOrder) return true;
    if (!personalityMetadataEquals(question.metadata, item)) return true;

    const optionsBySort = new Map(
      (question.options || []).map((opt) => [Number(opt.sortOrder), opt]),
    );
    for (const canonical of likertPayload) {
      const option = optionsBySort.get(canonical.sortOrder);
      if (!option || likertOptionNeedsUpdate(option, canonical)) return true;
    }
  }

  return false;
}

async function personalityMind24BankNeedsResync(db, moduleId, expected, flat) {
  const existing = await db.question.count({
    where: { moduleId, type: 'MULTIPLE_CHOICE', isActive: true },
  });
  if (existing !== expected) return true;

  const mod = await db.evaluationModule.findUnique({
    where: { id: moduleId },
    select: { description: true },
  });
  const desc = String(mod?.description || '');
  if (!desc.includes(`personalidad_mind24:v${PERSONALIDAD_MIND24_CATALOG_VERSION}`)) return true;

  const existingQuestions = await db.question.findMany({
    where: { moduleId, type: 'MULTIPLE_CHOICE', isActive: true },
    include: { options: { orderBy: { sortOrder: 'asc' } } },
  });
  const likertPayload = personalityMind24LikertOptionsCreatePayload();
  return personalityMind24QuestionContentDrift(flat, existingQuestions, likertPayload);
}

async function upsertPersonalityMind24Question(db, moduleId, item, existingQuestion, likertPayload) {
  const metadata = personalityMind24QuestionMetadata(item);
  if (!existingQuestion) {
    await db.question.create({
      data: {
        moduleId,
        type: 'MULTIPLE_CHOICE',
        text: item.text,
        metadata,
        sortOrder: item.sortOrder,
        options: {
          create: likertPayload.map((opt) => ({
            label: opt.label,
            value: opt.value,
            sortOrder: opt.sortOrder,
          })),
        },
      },
    });
    return { created: 1, updated: 0 };
  }

  if (
    existingQuestion.text !== item.text ||
    Number(existingQuestion.sortOrder) !== item.sortOrder ||
    !personalityMetadataEquals(existingQuestion.metadata, item)
  ) {
    await db.question.update({
      where: { id: existingQuestion.id },
      data: {
        text: item.text,
        sortOrder: item.sortOrder,
        metadata,
      },
    });
  }

  const optionsBySort = new Map(
    (existingQuestion.options || []).map((opt) => [Number(opt.sortOrder), opt]),
  );
  for (const canonical of likertPayload) {
    const option = optionsBySort.get(canonical.sortOrder);
    if (!option) {
      await db.questionOption.create({
        data: {
          questionId: existingQuestion.id,
          label: canonical.label,
          value: canonical.value,
          sortOrder: canonical.sortOrder,
        },
      });
    } else if (likertOptionNeedsUpdate(option, canonical)) {
      await db.questionOption.update({
        where: { id: option.id },
        data: {
          label: canonical.label,
          value: canonical.value,
          sortOrder: canonical.sortOrder,
        },
      });
    }
  }

  return { created: 0, updated: 1 };
}

/**
 * Sync Personalidad Mind24 — ítems pilot ∪ production (idempotente).
 * @param {object} db
 * @param {string} moduleId
 * @param {Array<object>|null|undefined} syncableItemsOverride Solo pruebas (fixtures).
 */
const PERSONALITY_SYNCABLE_STATUSES = new Set(['pilot', 'production']);

function personalitySyncableOnly(items) {
  return items.filter((item) => PERSONALITY_SYNCABLE_STATUSES.has(item.bankStatus));
}

export async function ensurePersonalityMind24Questions(db, moduleId, syncableItemsOverride = undefined) {
  const raw =
    syncableItemsOverride === undefined
      ? personalitySyncableItemsFlat()
      : Array.isArray(syncableItemsOverride)
        ? syncableItemsOverride
        : [];
  const flat = personalitySyncableOnly(raw).sort((a, b) => a.sortOrder - b.sortOrder);
  const expected = flat.length;
  if (expected === 0) {
    return {
      existing: 0,
      created: 0,
      expected: 0,
      skipped: true,
      reason: 'empty_item_bank',
    };
  }

  if (!(await personalityMind24BankNeedsResync(db, moduleId, expected, flat))) {
    const existing = await db.question.count({
      where: { moduleId, type: 'MULTIPLE_CHOICE', isActive: true },
    });
    return { existing, created: 0, expected, skipped: false, updated: 0 };
  }

  const existingQuestions = await db.question.findMany({
    where: { moduleId, type: 'MULTIPLE_CHOICE', isActive: true },
    include: { options: { orderBy: { sortOrder: 'asc' } } },
  });

  const byItemId = new Map();
  for (const question of existingQuestions) {
    const itemId = personalityItemIdFromQuestion(question);
    if (itemId) byItemId.set(itemId, question);
  }

  const syncableIds = new Set(flat.map((item) => item.itemId));
  for (const question of existingQuestions) {
    const itemId = personalityItemIdFromQuestion(question);
    if (itemId && !syncableIds.has(itemId)) {
      await db.question.delete({ where: { id: question.id } });
      byItemId.delete(itemId);
    }
  }

  const likertPayload = personalityMind24LikertOptionsCreatePayload();
  let created = 0;
  let updated = 0;
  for (const item of flat) {
    const existingQuestion = byItemId.get(item.itemId) || null;
    const result = await upsertPersonalityMind24Question(
      db,
      moduleId,
      item,
      existingQuestion,
      likertPayload,
    );
    created += result.created;
    updated += result.updated;
  }

  const cat = MODULE_CATALOG.personalidad_mind24;
  if (cat) {
    await db.evaluationModule.update({
      where: { id: moduleId },
      data: {
        description: `${cat.description} [personalidad_mind24:v${PERSONALIDAD_MIND24_CATALOG_VERSION}]`,
      },
    });
  }

  const existing = await db.question.count({
    where: { moduleId, type: 'MULTIPLE_CHOICE', isActive: true },
  });

  return { existing, created, expected, skipped: false, updated };
}

/** Opciones Likert 1–5 estándar (para sync futuro). */
export function personalityMind24LikertOptionsCreatePayload() {
  return PERSONALIDAD_MIND24_SCALE.optionLabels.map((label, j) => ({
    label,
    value: String(j + 1),
    sortOrder: j,
  }));
}

/**
 * Idempotente: asegura módulos del catálogo y preguntas mínimas (Cleaver, placeholders).
 * No borra usuarios, asignaciones ni intentos. Seguro en cada arranque de producción.
 */
export async function ensureEvaluationCatalog(db = defaultPrisma) {
  const moduleIdByKey = await upsertModules(db);
  const placeholdersCreated = await ensurePlaceholderQuestions(db, moduleIdByKey);

  const cleaverModuleId = moduleIdByKey.cleaver;
  let cleaver = { existing: 0, created: 0, patched: 0 };
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

  const personalityModuleId = moduleIdByKey.personalidad_mind24;
  let personalidadMind24 = { existing: 0, created: 0, expected: 0, skipped: true };
  if (personalityModuleId) {
    personalidadMind24 = await ensurePersonalityMind24Questions(db, personalityModuleId);
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
    cleaverOptionsPatched: cleaver.patched ?? 0,
    cleaverKeyMismatch: cleaver.mismatch ?? null,
    cleaverKeyVerifiedBlocks: cleaverBankValidation.summary.verifiedCount,
    cleaverKeyPendingBlocks: cleaverBankValidation.summary.pendingBlocks,
    termanSeeded: terman.created,
    salesSjtSeeded: salesSjt.created,
    personalidadMind24Questions: personalidadMind24.existing ?? 0,
    personalidadMind24Expected: personalidadMind24.expected ?? 0,
    personalidadMind24Skipped: personalidadMind24.skipped ?? false,
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

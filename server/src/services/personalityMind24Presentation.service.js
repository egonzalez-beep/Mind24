/**
 * Orden de presentación Personalidad Mind24 — mezcla inter-dimensional persistente por intento.
 * Persistencia: AssessmentAttempt.results.personalityMind24.presentationOrder (questionId[]).
 */

import {
  PERSONALIDAD_MIND24_ACTIVE_FORM_VERSION,
  PERSONALIDAD_MIND24_ITEMS_PER_DIMENSION,
  PERSONALIDAD_MIND24_LEGACY_FORM_VERSION,
  PERSONALIDAD_MIND24_LEGACY_ITEMS_PER_DIMENSION,
} from '../data/personalityMind24Data.js';

export const PERSONALITY_MIND24_MAX_CONSECUTIVE_SAME_DIMENSION = 2;

const PERSONALITY_RESULTS_KEY = 'personalityMind24';

export function inferPersonalityFormVersionFromOrderLength(length) {
  if (length === 80) return PERSONALIDAD_MIND24_LEGACY_FORM_VERSION;
  if (length === 60) return PERSONALIDAD_MIND24_ACTIVE_FORM_VERSION;
  return null;
}

export function personalityItemsPerDimensionForFormVersion(formVersion) {
  if (formVersion === PERSONALIDAD_MIND24_LEGACY_FORM_VERSION) {
    return PERSONALIDAD_MIND24_LEGACY_ITEMS_PER_DIMENSION;
  }
  if (formVersion === PERSONALIDAD_MIND24_ACTIVE_FORM_VERSION) {
    return PERSONALIDAD_MIND24_ITEMS_PER_DIMENSION;
  }
  return null;
}

export function readPersonalityFormMeta(attempt) {
  const results = attempt?.results;
  if (!results || typeof results !== 'object' || Array.isArray(results)) {
    return null;
  }
  const block = results[PERSONALITY_RESULTS_KEY];
  if (!block || typeof block !== 'object') return null;
  const order = Array.isArray(block.presentationOrder) ? block.presentationOrder : [];
  let formVersion =
    block.formVersion != null ? Number(block.formVersion) : inferPersonalityFormVersionFromOrderLength(order.length);
  const totalItemsExpected =
    block.totalItemsExpected != null ? Number(block.totalItemsExpected) : order.length || null;
  let itemsPerDimension =
    block.itemsPerDimension != null
      ? Number(block.itemsPerDimension)
      : personalityItemsPerDimensionForFormVersion(formVersion);
  if (!formVersion && order.length) {
    formVersion = inferPersonalityFormVersionFromOrderLength(order.length);
    itemsPerDimension = personalityItemsPerDimensionForFormVersion(formVersion);
  }
  return {
    formVersion,
    totalItemsExpected,
    itemsPerDimension,
    presentationOrderLength: order.length,
  };
}

export function personalityDimensionIdFromQuestion(question) {
  const meta = question?.metadata;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return 'unknown';
  return typeof meta.dimensionId === 'string' ? meta.dimensionId : 'unknown';
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function questionIdSet(questions) {
  return new Set((questions || []).map((q) => q.id).filter(Boolean));
}

function dimensionByQuestionId(questions) {
  const map = new Map();
  for (const q of questions || []) {
    if (q?.id) map.set(q.id, personalityDimensionIdFromQuestion(q));
  }
  return map;
}

/**
 * Greedy interleave: máx. 2 consecutivos de la misma dimensión; reparación local si hace falta.
 * @param {Array<{ id: string, metadata?: object }>} questions
 * @param {{ random?: () => number }} [options]
 * @returns {string[]} questionId[]
 */
export function buildPersonalityPresentationOrder(questions, options = {}) {
  const rng = typeof options.random === 'function' ? options.random : Math.random;
  const entries = (questions || [])
    .filter((q) => q?.id)
    .map((q) => ({
      questionId: q.id,
      dimensionId: personalityDimensionIdFromQuestion(q),
    }));

  if (!entries.length) return [];

  const byDim = new Map();
  for (const e of entries) {
    if (!byDim.has(e.dimensionId)) byDim.set(e.dimensionId, []);
    byDim.get(e.dimensionId).push(e.questionId);
  }
  for (const ids of byDim.values()) shuffleInPlace(ids, rng);

  const dimRotation = shuffleInPlace([...byDim.keys()], rng);
  const queues = new Map([...byDim.entries()].map(([d, ids]) => [d, [...ids]]));

  const result = [];
  let lastDim = null;
  let streak = 0;

  while (result.length < entries.length) {
    const available = dimRotation.filter((d) => (queues.get(d)?.length ?? 0) > 0);
    if (!available.length) break;

    let pickPool = available.filter((d) => d !== lastDim || streak < PERSONALITY_MIND24_MAX_CONSECUTIVE_SAME_DIMENSION);
    if (!pickPool.length) pickPool = available;

    const pickedDim = pickPool[0];
    const qid = queues.get(pickedDim).shift();
    result.push(qid);

    if (pickedDim === lastDim) streak += 1;
    else {
      lastDim = pickedDim;
      streak = 1;
    }

    const rotIdx = dimRotation.indexOf(pickedDim);
    if (rotIdx >= 0) {
      dimRotation.push(...dimRotation.splice(0, rotIdx + 1));
    }
  }

  const dimOf = dimensionByQuestionId(questions);
  repairConsecutiveDimensionStreak(result, dimOf, PERSONALITY_MIND24_MAX_CONSECUTIVE_SAME_DIMENSION);

  return result;
}

function repairConsecutiveDimensionStreak(order, dimOf, maxStreak) {
  for (let i = 0; i < order.length; i += 1) {
    let streak = 1;
    for (let j = i + 1; j < order.length && dimOf.get(order[j]) === dimOf.get(order[i]); j += 1) {
      streak += 1;
    }
    if (streak <= maxStreak) continue;
    const swapIdx = order.findIndex(
      (qid, idx) =>
        idx > i + maxStreak - 1 &&
        dimOf.get(qid) !== dimOf.get(order[i]) &&
        (idx === 0 || dimOf.get(qid) !== dimOf.get(order[idx - 1])),
    );
    if (swapIdx < 0) continue;
    [order[i + maxStreak], order[swapIdx]] = [order[swapIdx], order[i + maxStreak]];
    i = Math.max(-1, i - 1);
  }
}

export function readPersonalityPresentationOrder(attempt) {
  const results = attempt?.results;
  if (!results || typeof results !== 'object' || Array.isArray(results)) return null;
  const block = results[PERSONALITY_RESULTS_KEY];
  if (!block || typeof block !== 'object') return null;
  const order = block.presentationOrder;
  if (!Array.isArray(order) || !order.length) return null;
  return order.map((id) => String(id));
}

export function presentationOrderMatchesQuestions(presentationOrder, questions) {
  const expected = questionIdSet(questions);
  if (presentationOrder.length !== expected.size) return false;
  const seen = new Set();
  for (const id of presentationOrder) {
    if (!expected.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return seen.size === expected.size;
}

/**
 * Formulario congelado: si ya hay presentationOrder, no se regenera aunque el catálogo cambie.
 * @returns {{ presentationOrder: string[], created: boolean, frozen: boolean }}
 */
export function resolvePersonalityPresentationOrder(attempt, questions, options = {}) {
  const stored = readPersonalityPresentationOrder(attempt);
  if (stored?.length) {
    return { presentationOrder: stored, created: false, frozen: true };
  }
  const presentationOrder = buildPersonalityPresentationOrder(questions, options);
  return { presentationOrder, created: true, frozen: false };
}

export function createPersonalityAttemptFormIntegrityError(missingQuestionIds) {
  const err = new Error('PERSONALITY_ATTEMPT_FORM_INTEGRITY');
  err.code = 'PERSONALITY_ATTEMPT_FORM_INTEGRITY';
  err.message =
    'El formulario congelado del intento ya no está disponible en el catálogo (integridad).';
  err.details = { missingQuestionIds: [...missingQuestionIds] };
  return err;
}

/**
 * Resuelve el form del intento: congelado (BD por presentationOrder) o catálogo activo si aún no hay orden.
 * @param {object} db cliente Prisma o mock con question.findMany
 */
export async function resolvePersonalityAttemptForm(db, attempt, catalogQuestions, include = undefined) {
  const storedOrder = readPersonalityPresentationOrder(attempt);
  if (!storedOrder?.length) {
    return {
      frozen: false,
      presentationOrder: null,
      questions: catalogQuestions || [],
    };
  }

  const rows = await db.question.findMany({
    where: { id: { in: storedOrder } },
    ...(include ? { include } : {}),
  });
  const foundIds = new Set(rows.map((q) => q.id));
  const missing = storedOrder.filter((id) => !foundIds.has(id));
  if (missing.length) {
    throw createPersonalityAttemptFormIntegrityError(missing);
  }

  return {
    frozen: true,
    presentationOrder: storedOrder,
    questions: orderQuestionsByPresentation(rows, storedOrder),
  };
}

export function mergePersonalityAttemptResults(existingResults, presentationOrder, options = {}) {
  const base =
    existingResults && typeof existingResults === 'object' && !Array.isArray(existingResults)
      ? { ...existingResults }
      : {};
  const order = [...presentationOrder];
  const formVersion =
    options.formVersion != null
      ? options.formVersion
      : inferPersonalityFormVersionFromOrderLength(order.length) ?? PERSONALIDAD_MIND24_ACTIVE_FORM_VERSION;
  const itemsPerDimension =
    options.itemsPerDimension != null
      ? options.itemsPerDimension
      : personalityItemsPerDimensionForFormVersion(formVersion);
  const totalItemsExpected = options.totalItemsExpected != null ? options.totalItemsExpected : order.length;
  return {
    ...base,
    [PERSONALITY_RESULTS_KEY]: {
      presentationOrder: order,
      formVersion,
      totalItemsExpected,
      itemsPerDimension,
    },
  };
}

/**
 * Persiste presentationOrder solo si aún no existe (transacción + FOR UPDATE).
 * @param {object} db Prisma client (debe soportar $transaction, $queryRaw, assessmentAttempt.update)
 * @param {string} attemptId
 * @param {string[]} candidateOrder
 * @returns {Promise<{ presentationOrder: string[], claimed: boolean }>}
 */
export async function claimPersonalityPresentationOrder(db, attemptId, candidateOrder) {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT "results" FROM "AssessmentAttempt" WHERE "id" = ${attemptId} FOR UPDATE
    `;
    const results = rows[0]?.results ?? null;
    const existing = readPersonalityPresentationOrder({ results });
    if (existing?.length) {
      return { presentationOrder: existing, claimed: false };
    }

    const formVersion =
      inferPersonalityFormVersionFromOrderLength(candidateOrder.length) ??
      PERSONALIDAD_MIND24_ACTIVE_FORM_VERSION;
    const merged = mergePersonalityAttemptResults(results, candidateOrder, {
      formVersion,
      itemsPerDimension: personalityItemsPerDimensionForFormVersion(formVersion),
      totalItemsExpected: candidateOrder.length,
    });
    await tx.assessmentAttempt.update({
      where: { id: attemptId },
      data: { results: merged },
    });
    return { presentationOrder: candidateOrder, claimed: true };
  });
}

export function orderQuestionsByPresentation(questions, presentationOrder) {
  const byId = new Map((questions || []).map((q) => [q.id, q]));
  return presentationOrder.map((id) => byId.get(id)).filter(Boolean);
}

export function orderResponseRowsByPresentation(rows, presentationOrder) {
  const orderIndex = new Map(presentationOrder.map((id, idx) => [id, idx]));
  return [...(rows || [])].sort(
    (a, b) =>
      (orderIndex.get(a.questionId) ?? Number.MAX_SAFE_INTEGER) -
      (orderIndex.get(b.questionId) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Ítems esperados del formulario a partir de preguntas BD (metadata de sync). */
export function personalityExpectedItemsFromQuestions(questions) {
  return (questions || [])
    .map((q) => {
      const meta = q.metadata && typeof q.metadata === 'object' ? q.metadata : {};
      return {
        itemId: meta.personalityItemId || q.id,
        dimensionId: meta.dimensionId,
        direction: meta.direction === 'inverse' ? 'inverse' : 'direct',
        bankStatus: meta.bankStatus || 'production',
        sortOrder: Number(q.sortOrder) || 0,
        text: q.text,
      };
    })
    .filter((item) => item.dimensionId);
}

/** Invariantes testeables del orden (sin depender de un shuffle concreto). */
export function validatePersonalityPresentationInvariants(questions, presentationOrder) {
  const errors = [];
  const expected = questionIdSet(questions);
  if (presentationOrder.length !== expected.size) {
    errors.push(`length mismatch: ${presentationOrder.length} vs ${expected.size}`);
  }
  const seen = new Set();
  for (const id of presentationOrder) {
    if (!expected.has(id)) errors.push(`unknown questionId: ${id}`);
    if (seen.has(id)) errors.push(`duplicate questionId: ${id}`);
    seen.add(id);
  }
  for (const id of expected) {
    if (!seen.has(id)) errors.push(`missing questionId: ${id}`);
  }

  const dimOf = dimensionByQuestionId(questions);
  let streak = 0;
  let lastDim = null;
  for (const qid of presentationOrder) {
    const dim = dimOf.get(qid);
    if (dim === lastDim) streak += 1;
    else {
      lastDim = dim;
      streak = 1;
    }
    if (streak > PERSONALITY_MIND24_MAX_CONSECUTIVE_SAME_DIMENSION) {
      errors.push(`consecutive streak > ${PERSONALITY_MIND24_MAX_CONSECUTIVE_SAME_DIMENSION} for ${dim}`);
      break;
    }
  }

  const perDimCounts = new Map();
  for (const qid of presentationOrder) {
    const dim = dimOf.get(qid);
    perDimCounts.set(dim, (perDimCounts.get(dim) || 0) + 1);
  }
  for (const [, count] of perDimCounts) {
    if (count > PERSONALITY_MIND24_MAX_CONSECUTIVE_SAME_DIMENSION && count === presentationOrder.length) {
      errors.push('single-dimension block spans entire form');
    }
  }

  return { ok: errors.length === 0, errors };
}

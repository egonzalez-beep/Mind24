import {
  PERSONALIDAD_MIND24_CATALOG_VERSION,
  PERSONALIDAD_MIND24_DIMENSIONS,
  PERSONALIDAD_MIND24_FORM_ITEM_COUNT,
  PERSONALIDAD_MIND24_ITEMS_PER_DIMENSION,
  PERSONALIDAD_MIND24_MODULE_KEY,
  PERSONALIDAD_MIND24_SCALE,
  personalityExpectedCountByDimension,
  personalityProductionItemsFlat,
} from '../data/personalityMind24Data.js';

const FORBIDDEN_SCORE_KEYS = new Set([
  'global',
  'percentile',
  'percentScore',
  'stanine',
  'profileKey',
  'profileLabel',
  'level',
  'tier',
  'high',
  'medium',
  'low',
]);

/**
 * @param {number} raw Respuesta cruda 1–5
 * @param {'direct'|'inverse'} direction
 */
export function keyedPersonalityResponse(raw, direction) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < PERSONALIDAD_MIND24_SCALE.min || n > PERSONALIDAD_MIND24_SCALE.max) {
    return null;
  }
  if (direction === 'inverse') {
    return PERSONALIDAD_MIND24_SCALE.min + PERSONALIDAD_MIND24_SCALE.max - n;
  }
  return n;
}

function parseRawFromSelectedOption(selectedOption) {
  if (!selectedOption) return null;
  const fromValue = Number(selectedOption.value);
  if (
    Number.isFinite(fromValue) &&
    fromValue >= PERSONALIDAD_MIND24_SCALE.min &&
    fromValue <= PERSONALIDAD_MIND24_SCALE.max
  ) {
    return fromValue;
  }
  const sortOrder = Number(selectedOption.sortOrder);
  if (Number.isFinite(sortOrder) && sortOrder >= 0 && sortOrder <= 4) {
    return sortOrder + 1;
  }
  return null;
}

function roundMean(values) {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

function emptyDimensionScores() {
  const expectedByDim = personalityExpectedCountByDimension();
  const dimensions = {};
  for (const dim of PERSONALIDAD_MIND24_DIMENSIONS) {
    dimensions[dim.dimensionId] = {
      dimensionId: dim.dimensionId,
      label: dim.label,
      mean: null,
      nAnswered: 0,
      nExpected: expectedByDim[dim.dimensionId] ?? 0,
      scaleMin: PERSONALIDAD_MIND24_SCALE.min,
      scaleMax: PERSONALIDAD_MIND24_SCALE.max,
    };
  }
  return dimensions;
}

/**
 * Completitud del formulario (no altera medias dimensionales).
 * @param {string[]} expectedQuestionIds
 * @param {Array<{ questionId: string }>} rows
 */
export function computePersonalityMind24Completeness(expectedQuestionIds, rows) {
  const expected = Array.isArray(expectedQuestionIds) ? expectedQuestionIds.filter(Boolean) : [];
  const expectedCount = expected.length;
  const answeredIds = new Set(
    (rows || []).filter((r) => r?.questionId).map((r) => r.questionId),
  );
  let answeredCount = 0;
  for (const id of expected) {
    if (answeredIds.has(id)) answeredCount += 1;
  }
  const completenessRate =
    expectedCount > 0 ? Math.round((answeredCount / expectedCount) * 1000) / 10 : 0;
  return {
    expectedCount,
    answeredCount,
    unansweredCount: Math.max(0, expectedCount - answeredCount),
    completenessRate,
  };
}

/**
 * Tiempos observados únicamente — sin clasificación confiable/no confiable (v1 Personalidad).
 * Acepta salida de computeAttemptSpeedReliability u objeto equivalente; ignora isUnreliableSpeed.
 * @param {object|null|undefined} timingSource
 */
export function buildPersonalityObservedTimingMeta(timingSource) {
  if (!timingSource || typeof timingSource !== 'object') return null;
  return {
    avgSecondsPerQuestion:
      timingSource.avgSecondsPerQuestion != null ? timingSource.avgSecondsPerQuestion : null,
    elapsedMs: timingSource.elapsedMs != null ? timingSource.elapsedMs : null,
    questionCount: timingSource.questionCount != null ? timingSource.questionCount : null,
  };
}

/**
 * @param {object|null|undefined} timingSource Tiempos observados (sin flags de velocidad)
 * @param {ReturnType<typeof computePersonalityMind24Completeness>} completeness
 */
export function buildPersonalityApplicationQualityMeta(timingSource, completeness) {
  return {
    completeness: completeness || {
      expectedCount: 0,
      answeredCount: 0,
      unansweredCount: 0,
      completenessRate: 0,
    },
    reliability: buildPersonalityObservedTimingMeta(timingSource),
  };
}

/**
 * Califica respuestas Likert 1–5 por dimensión (sin puntaje global).
 * @param {Array<{ questionId?: string, question: object, selectedOption: object|null }>} rows
 */
export function scorePersonalityMind24Responses(rows) {
  const dimensions = emptyDimensionScores();
  const keyedByDimension = Object.fromEntries(
    PERSONALIDAD_MIND24_DIMENSIONS.map((d) => [d.dimensionId, []]),
  );
  const itemResponses = [];

  for (const row of rows || []) {
    const meta = row.question?.metadata;
    if (!meta || typeof meta !== 'object') continue;
    const dimensionId = meta.dimensionId;
    const direction = meta.direction === 'inverse' ? 'inverse' : 'direct';
    if (!dimensions[dimensionId]) continue;

    const raw = parseRawFromSelectedOption(row.selectedOption);
    if (raw == null) continue;
    const keyed = keyedPersonalityResponse(raw, direction);
    if (keyed == null) continue;

    keyedByDimension[dimensionId].push(keyed);
    itemResponses.push({
      itemId: meta.personalityItemId || null,
      dimensionId,
      direction,
      raw,
      keyed,
    });
  }

  for (const dim of PERSONALIDAD_MIND24_DIMENSIONS) {
    const values = keyedByDimension[dim.dimensionId];
    const bucket = dimensions[dim.dimensionId];
    bucket.nAnswered = values.length;
    bucket.mean = roundMean(values);
  }

  const productionCount = personalityProductionItemsFlat().length;

  return {
    catalogVersion: PERSONALIDAD_MIND24_CATALOG_VERSION,
    form: {
      itemsPerDimension: PERSONALIDAD_MIND24_ITEMS_PER_DIMENSION,
      totalItemsExpected: PERSONALIDAD_MIND24_FORM_ITEM_COUNT,
      productionItemsInCatalog: productionCount,
    },
    dimensions,
    itemResponses,
  };
}

export function buildPersonalityMind24AttemptScores(scoring, applicationQuality = null) {
  const scoresPayload = {
    instrument: PERSONALIDAD_MIND24_MODULE_KEY,
    catalogVersion: scoring.catalogVersion,
    form: scoring.form,
    dimensions: scoring.dimensions,
    meta: {
      engine: PERSONALIDAD_MIND24_MODULE_KEY,
      scoredAt: new Date().toISOString(),
    },
  };

  if (applicationQuality) {
    scoresPayload.meta.applicationQuality = applicationQuality;
  }

  assertNoForbiddenScoreFields(scoresPayload);

  return {
    instrument: PERSONALIDAD_MIND24_MODULE_KEY,
    scores: scoresPayload,
  };
}

/** Guardia de diseño: sin global / percentiles / tiers en payload persistido. */
export function assertNoForbiddenScoreFields(obj, path = '') {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => assertNoForbiddenScoreFields(v, `${path}[${i}]`));
    return;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_SCORE_KEYS.has(key)) {
      throw new Error(`FORBIDDEN_SCORE_FIELD:${path ? `${path}.` : ''}${key}`);
    }
    assertNoForbiddenScoreFields(value, path ? `${path}.${key}` : key);
  }
}

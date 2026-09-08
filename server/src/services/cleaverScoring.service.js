import { CLEAVER_DISC_KEYS, CLEAVER_KEY_SCHEMA } from '../data/cleaverDiscKey.js';

export function emptyDiscCounts() {
  return { D: 0, I: 0, S: 0, C: 0 };
}

export const CLEAVER_ROLES = ['more', 'less'];

const ROLE_FIELD = { more: 'dimensionMore', less: 'dimensionLess' };

/** Origen de la dimensión resuelta, útil para auditar el estado del banco. */
export const CLEAVER_KEY_SOURCE = {
  ML: CLEAVER_KEY_SCHEMA,
  LEGACY: 'legacy_single',
};

function validationError(message, details) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  if (details) err.details = details;
  return err;
}

function optionMetadata(option) {
  const meta = option?.metadata;
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : null;
}

/** Normaliza una dimensión declarada. `null` es válido y significa "no puntúa". */
function normalizeDimension(raw) {
  if (raw === null) return { ok: true, dimension: null };
  if (typeof raw !== 'string') return { ok: false };
  const upper = raw.trim().toUpperCase();
  if (!CLEAVER_DISC_KEYS.includes(upper)) return { ok: false };
  return { ok: true, dimension: upper };
}

/**
 * Resuelve la dimensión DISC de una opción según el rol con que fue elegida.
 *
 * - `metadata.keySchema === 'ml_v1'` → lee `dimensionMore` / `dimensionLess`.
 *   `null` es una respuesta válida que no incrementa ninguna escala.
 * - Filas sin esquema M/L (banco aún no sincronizado) → cae a la dimensión
 *   única heredada (`metadata.dimension` o `value`), que sí es obligatoria.
 *
 * @param {object} option QuestionOption
 * @param {'more'|'less'} role
 * @returns {{ dimension: string|null, source: string }}
 */
export function resolveOptionDimension(option, role) {
  const field = ROLE_FIELD[role];
  if (!field) {
    throw validationError('CLEAVER_SCORING_INVALID_ROLE', { role });
  }
  if (!option) {
    throw validationError('CLEAVER_SCORING_MISSING_OPTION', { role });
  }

  const meta = optionMetadata(option);

  if (meta && meta.keySchema === CLEAVER_KEY_SCHEMA) {
    if (!Object.prototype.hasOwnProperty.call(meta, field)) {
      throw validationError('CLEAVER_SCORING_INVALID_METADATA', {
        role,
        optionId: option.id,
        reason: `falta ${field}`,
      });
    }
    const normalized = normalizeDimension(meta[field]);
    if (!normalized.ok) {
      throw validationError('CLEAVER_SCORING_INVALID_METADATA', {
        role,
        optionId: option.id,
        reason: `${field} inválido`,
        value: meta[field],
      });
    }
    return { dimension: normalized.dimension, source: CLEAVER_KEY_SOURCE.ML };
  }

  const legacyRaw =
    meta && typeof meta.dimension === 'string' && meta.dimension.trim()
      ? meta.dimension
      : option.value;
  const legacy = normalizeDimension(typeof legacyRaw === 'string' ? legacyRaw : undefined);
  if (!legacy.ok || legacy.dimension === null) {
    throw validationError('CLEAVER_SCORING_MISSING_DIMENSION', {
      role,
      optionId: option.id,
      reason: 'opción sin clave M/L ni dimensión heredada válida',
    });
  }
  return { dimension: legacy.dimension, source: CLEAVER_KEY_SOURCE.LEGACY };
}

/**
 * Algoritmo Cleaver: conteo MÁS / MENOS y perfil Total (M − L).
 *
 * Determinista: el resultado depende solo de la metadata de las opciones
 * elegidas, no del orden de las filas ni de datos externos.
 *
 * @param {Array<{ questionId?: string, moreOptionId?: string|null, lessOptionId?: string|null, moreOption?: object, lessOption?: object }>} responses
 */
export function scoreCleaverResponses(responses) {
  const most = emptyDiscCounts();
  const least = emptyDiscCounts();
  const rows = Array.isArray(responses) ? responses : [];

  let unscoredMore = 0;
  let unscoredLess = 0;
  const keySources = new Set();

  for (const row of rows) {
    const details = {
      questionId: row?.questionId,
      moreOptionId: row?.moreOptionId,
      lessOptionId: row?.lessOptionId,
    };

    if (!row?.moreOption || !row?.lessOption) {
      throw validationError('CLEAVER_SCORING_MISSING_OPTION', details);
    }
    if (row.moreOptionId && row.lessOptionId && row.moreOptionId === row.lessOptionId) {
      throw validationError('CLEAVER_SAME_MORE_LESS', details);
    }

    let moreKey;
    let lessKey;
    try {
      moreKey = resolveOptionDimension(row.moreOption, 'more');
      lessKey = resolveOptionDimension(row.lessOption, 'less');
    } catch (err) {
      err.details = { ...details, ...(err.details || {}) };
      throw err;
    }

    keySources.add(moreKey.source);
    keySources.add(lessKey.source);

    if (moreKey.dimension) most[moreKey.dimension] += 1;
    else unscoredMore += 1;

    if (lessKey.dimension) least[lessKey.dimension] += 1;
    else unscoredLess += 1;
  }

  const total = emptyDiscCounts();
  for (const key of CLEAVER_DISC_KEYS) {
    total[key] = most[key] - least[key];
  }

  return {
    most,
    least,
    total,
    tetradCount: rows.length,
    /** Selecciones válidas que no puntúan (clave `null`). */
    unscoredMore,
    unscoredLess,
    keySources: [...keySources].sort(),
  };
}

/**
 * Payload para AssessmentAttempt.scores (campo `scores` en Prisma).
 */
export function buildCleaverAttemptScores(scoring) {
  return {
    instrument: 'cleaver',
    moduleKey: 'cleaver',
    scores: {
      most: scoring.most,
      least: scoring.least,
      total: scoring.total,
    },
    meta: {
      tetradCount: scoring.tetradCount,
      unscoredMore: scoring.unscoredMore,
      unscoredLess: scoring.unscoredLess,
      keySources: scoring.keySources,
      scoredAt: new Date().toISOString(),
    },
  };
}

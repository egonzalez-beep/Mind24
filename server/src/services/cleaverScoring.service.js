import { CLEAVER_DISC_KEYS } from '../data/cleaverDiscKey.js';

export function emptyDiscCounts() {
  return { D: 0, I: 0, S: 0, C: 0 };
}

/**
 * Extrae dimensión DISC de una QuestionOption (Cleaver).
 */
export function dimensionFromOption(option) {
  if (!option) return null;
  const meta = option.metadata;
  const fromMeta =
    meta && typeof meta === 'object' && !Array.isArray(meta)
      ? String(meta.dimension || '').trim().toUpperCase()
      : '';
  if (CLEAVER_DISC_KEYS.includes(fromMeta)) return fromMeta;
  const fromValue = String(option.value || '').trim().toUpperCase();
  if (CLEAVER_DISC_KEYS.includes(fromValue)) return fromValue;
  return null;
}

/**
 * Algoritmo oficial Cleaver: conteo MÁS / MENOS y perfil Total (M − L).
 * @param {Array<{ moreOptionId?: string|null, lessOptionId?: string|null, moreOption?: object, lessOption?: object }>} responses
 */
export function scoreCleaverResponses(responses) {
  const most = emptyDiscCounts();
  const least = emptyDiscCounts();

  for (const row of responses || []) {
    const moreDim = dimensionFromOption(row.moreOption);
    const lessDim = dimensionFromOption(row.lessOption);

    if (!moreDim || !lessDim) {
      const err = new Error('CLEAVER_SCORING_MISSING_DIMENSION');
      err.code = 'VALIDATION_ERROR';
      err.details = {
        questionId: row.questionId,
        moreOptionId: row.moreOptionId,
        lessOptionId: row.lessOptionId,
      };
      throw err;
    }
    if (moreDim === lessDim) {
      const err = new Error('CLEAVER_SAME_MORE_LESS');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    most[moreDim] += 1;
    least[lessDim] += 1;
  }

  const total = emptyDiscCounts();
  for (const key of CLEAVER_DISC_KEYS) {
    total[key] = most[key] - least[key];
  }

  return {
    most,
    least,
    total,
    tetradCount: (responses || []).length,
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
      scoredAt: new Date().toISOString(),
    },
  };
}

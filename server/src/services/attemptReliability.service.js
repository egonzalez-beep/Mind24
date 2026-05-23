/** Umbral mínimo de segundos por ítem para considerar el intento confiable. */
export const MIN_AVG_SECONDS_PER_QUESTION = 1.5;

export const UNRELIABLE_SPEED_FLAG_TEXT =
  '⚠️ ALERTA DE CONFIABILIDAD: El candidato completó esta evaluación en un tiempo inusualmente bajo, lo que sugiere respuestas aleatorias. Los resultados podrían no ser confiables.';

/**
 * @param {{ startedAt: Date|string, submittedAt: Date|string, questionCount: number }} params
 */
export function computeAttemptSpeedReliability({ startedAt, submittedAt, questionCount }) {
  const count = Number(questionCount) || 0;
  if (!startedAt || !submittedAt || count < 1) {
    return {
      isUnreliableSpeed: false,
      elapsedMs: 0,
      avgSecondsPerQuestion: null,
      questionCount: count,
    };
  }
  const start = new Date(startedAt).getTime();
  const end = new Date(submittedAt).getTime();
  const elapsedMs = Math.max(0, end - start);
  const avgSecondsPerQuestion = elapsedMs / 1000 / count;
  return {
    isUnreliableSpeed: avgSecondsPerQuestion < MIN_AVG_SECONDS_PER_QUESTION,
    elapsedMs,
    avgSecondsPerQuestion: Math.round(avgSecondsPerQuestion * 100) / 100,
    questionCount: count,
  };
}

/**
 * Fusiona reliability en scores.meta y flags del intento.
 * @param {object|null} scores
 * @param {string[]|null} flags
 * @param {ReturnType<typeof computeAttemptSpeedReliability>} reliability
 */
export function applyReliabilityToAttemptPayload(scores, flags, reliability) {
  const nextScores =
    scores && typeof scores === 'object' ? { ...scores } : {};
  const meta =
    nextScores.meta && typeof nextScores.meta === 'object'
      ? { ...nextScores.meta }
      : {};
  meta.reliability = reliability;
  nextScores.meta = meta;

  const nextFlags = Array.isArray(flags) ? [...flags] : [];
  if (reliability.isUnreliableSpeed) {
    const has = nextFlags.some(
      (f) => String(f).includes('ALERTA DE CONFIABILIDAD') || String(f).includes('UNRELIABLE_SPEED'),
    );
    if (!has) nextFlags.push(UNRELIABLE_SPEED_FLAG_TEXT);
  }
  return { scores: nextScores, flags: nextFlags };
}

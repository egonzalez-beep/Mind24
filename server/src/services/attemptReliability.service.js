/** Umbral mínimo de segundos por ítem para considerar el intento confiable (módulos dinámicos). */
export const MIN_AVG_SECONDS_PER_QUESTION = 1.5;

export const UNRELIABLE_SPEED_FLAG_TEXT =
  '⚠️ ALERTA DE CONFIABILIDAD: El candidato completó esta evaluación en un tiempo inusualmente bajo, lo que sugiere respuestas aleatorias. Los resultados podrían no ser confiables.';

/** Honestidad: duración total mínima (inclusive) para estado normal — 3:20. */
export const HONESTIDAD_SPEED_NORMAL_MIN_SEC = 200;

/** Honestidad: duración total mínima (inclusive) para estado revisar — 2:00. */
export const HONESTIDAD_SPEED_REVIEW_MIN_SEC = 120;

export const HONESTIDAD_SPEED_REVIEW_MESSAGE =
  'La evaluación fue completada en un tiempo inusualmente rápido. Se recomienda revisar la confiabilidad de las respuestas antes de emitir una conclusión.';

export const HONESTIDAD_SPEED_INVALID_MESSAGE =
  'El tiempo de aplicación reduce significativamente la confiabilidad de esta evaluación. Se recomienda realizar una nueva evaluación antes de emitir una conclusión.';

/**
 * Termómetro de confiabilidad por duración total (Honestidad y Confianza).
 * @param {number} elapsedSeconds
 * @returns {'normal'|'review'|'invalid'}
 */
export function resolveHonestidadSpeedReliability(elapsedSeconds) {
  const sec = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
  if (sec >= HONESTIDAD_SPEED_NORMAL_MIN_SEC) return 'normal';
  if (sec >= HONESTIDAD_SPEED_REVIEW_MIN_SEC) return 'review';
  return 'invalid';
}

/**
 * @param {{ startedAt: Date|string, submittedAt: Date|string }} params
 */
export function computeHonestidadDurationReliability({ startedAt, submittedAt }) {
  if (!startedAt || !submittedAt) {
    return {
      elapsedMs: 0,
      elapsedSeconds: 0,
      speedReliability: 'normal',
      invalidates: false,
    };
  }
  const start = new Date(startedAt).getTime();
  const end = new Date(submittedAt).getTime();
  const elapsedMs = Math.max(0, end - start);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const speedReliability = resolveHonestidadSpeedReliability(elapsedSeconds);
  return {
    elapsedMs,
    elapsedSeconds,
    speedReliability,
    invalidates: speedReliability === 'invalid',
  };
}

/**
 * Capa de confiabilidad por velocidad (Honestidad) — no altera scores dimensionales.
 * @param {{ scored: object, flags: string[]|null, reliability: ReturnType<typeof computeHonestidadDurationReliability>, moduleKey?: string|null }} params
 */
export function applyHonestidadSpeedReliabilityLayer({ scored, flags, reliability, moduleKey }) {
  const nextFlags = Array.isArray(flags) ? [...flags] : [];
  if (reliability.speedReliability === 'review') {
    const has = nextFlags.some((f) => f === HONESTIDAD_SPEED_REVIEW_MESSAGE);
    if (!has) nextFlags.push(HONESTIDAD_SPEED_REVIEW_MESSAGE);
  } else if (reliability.speedReliability === 'invalid') {
    const has = nextFlags.some((f) => f === HONESTIDAD_SPEED_INVALID_MESSAGE);
    if (!has) nextFlags.push(HONESTIDAD_SPEED_INVALID_MESSAGE);
  }

  let interpretation = {
    verdict: scored.verdict,
    badge: scored.badge,
    description: scored.description,
  };
  const denialInvalid = scored.meta?.denialReliability === 'invalid';
  if (reliability.speedReliability === 'invalid' && !denialInvalid) {
    interpretation = {
      verdict: 'Prueba Inválida',
      badge: '⚠️ No Confiable',
      description: HONESTIDAD_SPEED_INVALID_MESSAGE,
    };
  }

  const scores = {
    global: scored.global,
    dimensions: scored.dimensions,
    meta: {
      ...(scored.meta || {}),
      moduleKey: moduleKey ?? scored.meta?.moduleKey ?? null,
      speedReliability: reliability.speedReliability,
      reliability: {
        elapsedMs: reliability.elapsedMs,
        elapsedSeconds: reliability.elapsedSeconds,
        speedReliability: reliability.speedReliability,
      },
    },
  };

  return { scores, flags: nextFlags, interpretation };
}

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

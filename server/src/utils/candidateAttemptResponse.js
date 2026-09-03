/** Campos psicométricos que el candidato no debe recibir por API. */
const CONFIDENTIAL_RESULT_KEYS = new Set([
  'scores',
  'interpretation',
  'flags',
  'global',
  'verdict',
  'badge',
  'description',
  'dimensions',
  'dimension',
  'meta',
  'profileLabel',
  'profileDescription',
  'rawScore',
  'maxPossible',
  'scenarios',
  'percentCorrect',
  'ci',
  'ciEstimate',
  'series',
  'most',
  'least',
  'total',
]);

/**
 * Respuesta mínima tras submit legacy (Honestidad).
 * @param {object|null} scored
 */
export function sanitizeCandidateSubmitResult(scored) {
  return {
    ok: true,
    moduleKey: scored?.moduleKey ?? null,
    assignmentCompleted: Boolean(scored?.assignmentCompleted),
  };
}

/**
 * Respuesta mínima tras complete dinámico (Cleaver, SJT, Terman).
 * @param {object|null} out
 */
export function sanitizeCandidateCompleteResult(out) {
  return {
    ok: out?.ok !== false,
    moduleKey: out?.moduleKey ?? null,
    assignmentCompleted: Boolean(out?.assignmentCompleted),
    message:
      typeof out?.message === 'string' ? out.message : 'Módulo enviado correctamente.',
  };
}

/**
 * Estado de intento visible al candidato (sin puntajes ni interpretación).
 * @param {object} attempt
 */
export function buildCandidateAttemptStatus(attempt) {
  return {
    attemptId: attempt.id,
    status: attempt.status,
    submitted: attempt.status === 'submitted',
    submittedAt: attempt.submittedAt,
    moduleKey: attempt.moduleKey ?? null,
    assessmentName: attempt.assignment?.assessmentDefinition?.name ?? null,
  };
}

/** @param {unknown} value */
export function assertNoConfidentialCandidatePayload(value, path = 'root') {
  if (value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoConfidentialCandidatePayload(item, `${path}[${i}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (CONFIDENTIAL_RESULT_KEYS.has(key)) {
      throw new Error(`Confidential key exposed at ${path}.${key}`);
    }
    assertNoConfidentialCandidatePayload(nested, `${path}.${key}`);
  }
}

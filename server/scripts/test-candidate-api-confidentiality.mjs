/**
 * Validación: respuestas API candidato sin datos psicométricos.
 * Ejecutar: node server/scripts/test-candidate-api-confidentiality.mjs
 */
import {
  sanitizeCandidateSubmitResult,
  sanitizeCandidateCompleteResult,
  buildCandidateAttemptStatus,
  assertNoConfidentialCandidatePayload,
} from '../src/utils/candidateAttemptResponse.js';

let failed = 0;

function fail(msg) {
  console.log('  FAIL:', msg);
  failed++;
}
function ok(msg) {
  console.log('  OK:', msg);
}

console.log('\n=== Confidencialidad API candidato ===\n');

const fullSubmit = {
  global: 98,
  verdict: 'Aprobatorio',
  badge: '✅',
  description: 'secreto',
  dimensions: { honestidad: { avg: 100 } },
  flags: ['alerta'],
  meta: { negDir: 0 },
  moduleKey: 'honestidad',
  assignmentCompleted: true,
};

const submitSafe = sanitizeCandidateSubmitResult(fullSubmit);
try {
  assertNoConfidentialCandidatePayload({ result: submitSafe });
  ok('submit sanitizado sin claves confidenciales');
} catch (e) {
  fail(e.message);
}
if (!submitSafe.assignmentCompleted || submitSafe.moduleKey !== 'honestidad') {
  fail('submit sanitizado pierde assignmentCompleted/moduleKey');
} else {
  ok('submit conserva assignmentCompleted y moduleKey');
}

const fullComplete = {
  ok: true,
  moduleKey: 'sales_sjt',
  assignmentCompleted: false,
  message: 'Módulo enviado correctamente.',
  scores: { rawScore: 60, scenarios: [] },
  interpretation: { verdict: 'Perfil comercial', profileLabel: 'Alto' },
};

const completeSafe = sanitizeCandidateCompleteResult(fullComplete);
try {
  assertNoConfidentialCandidatePayload(completeSafe);
  ok('complete sanitizado sin claves confidenciales');
} catch (e) {
  fail(e.message);
}

const status = buildCandidateAttemptStatus({
  id: 'att1',
  status: 'submitted',
  submittedAt: new Date(),
  moduleKey: 'honestidad',
  assignment: { assessmentDefinition: { name: 'Demo' } },
});
try {
  assertNoConfidentialCandidatePayload({ result: status });
  ok('GET /result status sin claves confidenciales');
} catch (e) {
  fail(e.message);
}
if (!status.submitted || status.assessmentName !== 'Demo') {
  fail('status incompleto para lobby');
} else {
  ok('status incluye submitted/assessmentName');
}

// Simula payload antiguo GET /result (debe fallar el assert)
try {
  assertNoConfidentialCandidatePayload({
    result: {
      scores: { global: 90 },
      interpretation: { verdict: 'Aprobatorio' },
      flags: [],
    },
  });
  fail('assert debía detectar payload confidencial legacy');
} catch (_e) {
  ok('detecta payload confidencial legacy');
}

console.log(failed === 0 ? '\n✓ Confidencialidad API OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

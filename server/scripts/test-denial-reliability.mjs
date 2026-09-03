/**
 * Validación manual: termómetro de confiabilidad por negDir (d1–d5).
 * Ejecutar: node server/scripts/test-denial-reliability.mjs
 */
import { defaultDemoAssessmentConfig } from '../src/assessment/defaultDefinition.js';
import {
  scoreAssessment,
  DENIAL_REVIEW_MESSAGE,
  DENIAL_INVALID_MESSAGE,
} from '../src/services/scoring.service.js';
import {
  buildHonestidadModuleFragment,
  isHonestidadPruebaInvalida,
} from '../src/reports/honestidadReport.fragment.js';

const DIRECT_IDS = ['d1', 'd2', 'd3', 'd4', 'd5'];
const CAL_IDS = ['c1', 'c2', 'c3', 'c4', 'c5'];
const LIKERT_IDS = Array.from({ length: 40 }, (_, i) => `p${i + 1}`);

function buildAnswers(negDirCount) {
  const answers = {};
  for (const id of CAL_IDS) answers[id] = 0;
  DIRECT_IDS.forEach((id, i) => {
    answers[id] = i < negDirCount ? 1 : 0;
  });
  for (const id of LIKERT_IDS) answers[id] = 0;
  return answers;
}

function buildMockAttempt(scored) {
  return {
    submittedAt: new Date('2026-09-03T12:00:00Z'),
    scores: {
      global: scored.global,
      dimensions: scored.dimensions,
      meta: scored.meta,
    },
    interpretation: {
      verdict: scored.verdict,
      badge: scored.badge,
      description: scored.description,
    },
    flags: scored.flags,
  };
}

const baseline = scoreAssessment(defaultDemoAssessmentConfig, buildAnswers(0));
const baselineGlobal = baseline.global;
const baselineHon = baseline.dimensions.honestidad.avg;

const cases = [0, 2, 3, 4, 5];
let failed = 0;

for (const negDir of cases) {
  const r = scoreAssessment(defaultDemoAssessmentConfig, buildAnswers(negDir));
  const hasReviewFlag = r.flags.includes(DENIAL_REVIEW_MESSAGE);
  const hasInvalidFlag = r.flags.includes(DENIAL_INVALID_MESSAGE);
  const isAprobatorio = r.verdict === 'Aprobatorio';
  const isInvalid = r.verdict === 'Prueba Inválida';

  console.log(`\n--- negDir=${negDir} ---`);
  console.log(`  verdict: ${r.verdict}`);
  console.log(`  global: ${r.global}% (baseline ${baselineGlobal}%)`);
  console.log(`  honestidad: ${r.dimensions.honestidad.avg}% (baseline ${baselineHon}%)`);
  console.log(`  flags: ${r.flags.length ? r.flags.join(' | ') : '(ninguna)'}`);
  console.log(`  meta.denialReliability: ${r.meta.denialReliability}`);

  if (negDir <= 2) {
    if (hasReviewFlag || hasInvalidFlag || isInvalid) {
      console.log('  FAIL: 0–2 no debe generar alerta de negación ni invalidar');
      failed++;
    }
  } else if (negDir <= 4) {
    if (!hasReviewFlag || hasInvalidFlag || isInvalid) {
      console.log('  FAIL: 3–4 debe alertar revisión sin invalidar');
      failed++;
    }
    if (isAprobatorio && r.global >= 75) {
      console.log('  OK: veredicto score-based se mantiene (puede ser Aprobatorio)');
    }
  } else if (negDir === 5) {
    if (!isInvalid || isAprobatorio) {
      console.log('  FAIL: 5 debe invalidar y no ser Aprobatorio');
      failed++;
    }
    if (!hasInvalidFlag) {
      console.log('  FAIL: 5 debe incluir mensaje de no confiable en flags');
      failed++;
    }
    if (r.global < 90) {
      console.log('  FAIL: caso invalid debe conservar global alto (>=90%)');
      failed++;
    }
  }

  if (r.global !== baselineGlobal || r.dimensions.honestidad.avg !== baselineHon) {
    console.log('  FAIL: scoring dimensional alterado respecto al baseline');
    failed++;
  }
}

// PDF: negDir=5 + global alto — semáforo no debe verse favorable (verde)
const invalidScored = scoreAssessment(defaultDemoAssessmentConfig, buildAnswers(5));
const invalidAttempt = buildMockAttempt(invalidScored);
const pdfHtml = buildHonestidadModuleFragment({
  payload: {
    global: invalidScored.global,
    dimensions: invalidScored.dimensions,
    meta: invalidScored.meta,
    interpretation: invalidAttempt.interpretation,
    flags: invalidScored.flags,
  },
  submittedAt: '03/09/2026 12:00',
});

console.log('\n--- PDF negDir=5 (global alto) ---');
console.log(`  global en PDF: ${invalidScored.global}%`);
console.log(`  verdict en PDF: ${invalidScored.verdict}`);
console.log(
  `  isHonestidadPruebaInvalida: ${isHonestidadPruebaInvalida(invalidAttempt.interpretation, invalidScored.meta)}`,
);

const greenLitActive = /background:#10B981.*box-shadow:0 0 8px rgba\(16,185,129/.test(pdfHtml);
const redLitActive = /background:#EF4444.*box-shadow:0 0 8px rgba\(239,68,68/.test(pdfHtml);
const redContainer = pdfHtml.includes('background:#FEF2F2') && pdfHtml.includes('border:1.5px solid #FCA5A5');

if (greenLitActive) {
  console.log('  FAIL: semáforo PDF muestra luz verde activa con prueba inválida');
  failed++;
}
if (!redLitActive || !redContainer) {
  console.log('  FAIL: semáforo PDF debe usar estilo rojo para prueba inválida');
  failed++;
} else {
  console.log('  OK: semáforo PDF en rojo (no favorable) pese a global alto');
}

console.log(failed === 0 ? '\n✓ Todos los escenarios pasaron.' : `\n✗ ${failed} fallo(s).`);
process.exit(failed === 0 ? 0 : 1);

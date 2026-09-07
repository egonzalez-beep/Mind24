/**
 * Termómetro de confiabilidad por calibración c1–c5 — Honestidad.
 * Ejecutar: node server/scripts/test-honestidad-calibration-reliability.mjs
 */
import { defaultDemoAssessmentConfig } from '../src/assessment/defaultDefinition.js';
import { scoreAssessment } from '../src/services/scoring.service.js';
import {
  applyHonestidadCalibrationReliabilityLayer,
  applyHonestidadSpeedReliabilityLayer,
  computeHonestidadDurationReliability,
  honestidadCalibrationReviewMessage,
  HONESTIDAD_CALIBRATION_INVALID_MESSAGE,
  HONESTIDAD_CALIBRATION_LOW_RELIABILITY_TEMPLATE,
  resolveHonestidadCalibrationReliability,
} from '../src/services/attemptReliability.service.js';
import {
  buildHonestidadModuleFragment,
  isHonestidadPruebaInvalida,
} from '../src/reports/honestidadReport.fragment.js';
import { fillBestLikertAnswers } from './honestidadTestHelpers.mjs';

const CAL_IDS = ['c1', 'c2', 'c3', 'c4', 'c5'];
const DIRECT_IDS = ['d1', 'd2', 'd3', 'd4', 'd5'];
const LIKERT_IDS = Array.from({ length: 40 }, (_, i) => `p${i + 1}`);

function buildAnswers(errCalCount) {
  const answers = {};
  CAL_IDS.forEach((id, i) => {
    answers[id] = i < errCalCount ? 1 : 0;
  });
  for (const id of DIRECT_IDS) answers[id] = 0;
  fillBestLikertAnswers(defaultDemoAssessmentConfig, answers);
  return answers;
}

function layerForErrCal(errCalCount) {
  const scored = scoreAssessment(defaultDemoAssessmentConfig, buildAnswers(errCalCount));
  const cal = applyHonestidadCalibrationReliabilityLayer({
    scored,
    flags: scored.flags,
    moduleKey: 'honestidad',
  });
  const startedAt = new Date('2026-01-01T12:00:00Z');
  const submittedAt = new Date(startedAt.getTime() + 240 * 1000);
  const speedRel = computeHonestidadDurationReliability({ startedAt, submittedAt });
  return applyHonestidadSpeedReliabilityLayer({
    scored: cal.scores,
    flags: cal.flags,
    interpretation: cal.interpretation,
    reliability: speedRel,
    moduleKey: 'honestidad',
  });
}

const baseline = scoreAssessment(defaultDemoAssessmentConfig, buildAnswers(0));
const baselineGlobal = baseline.global;

const cases = [
  { errCal: 0, expect: 'normal' },
  { errCal: 1, expect: 'normal' },
  { errCal: 2, expect: 'review' },
  { errCal: 3, expect: 'low_reliability' },
  { errCal: 4, expect: 'low_reliability' },
  { errCal: 5, expect: 'invalid' },
];

let failed = 0;

console.log('\n=== Honestidad — termómetro calibración c1–c5 ===\n');
console.log(`Baseline global: ${baselineGlobal}%\n`);

for (const { errCal, expect } of cases) {
  const level = resolveHonestidadCalibrationReliability(errCal);
  if (level !== expect) {
    console.log(`FAIL resolve errCal=${errCal}: ${level} (esperado ${expect})`);
    failed++;
  }
}

for (const { errCal, expect } of cases) {
  const out = layerForErrCal(errCal);
  const level = out.scores.meta.calibrationReliability;
  const pdf = buildHonestidadModuleFragment({
    payload: {
      global: out.scores.global,
      dimensions: out.scores.dimensions,
      meta: out.scores.meta,
      interpretation: out.interpretation,
      flags: out.flags,
    },
    submittedAt: '03/09/2026',
  });
  const invalidVisual = isHonestidadPruebaInvalida(out.interpretation, out.scores.meta);
  const greenLit = pdf.includes('background:#10B981') && pdf.includes('box-shadow:0 0 8px rgba(16,185,129');
  const yellowLit = pdf.includes('background:#F59E0B') && pdf.includes('box-shadow:0 0 8px rgba(245,158,11');
  const redLit = pdf.includes('background:#EF4444') && pdf.includes('box-shadow:0 0 8px rgba(239,68,68');

  console.log(`errCal=${errCal} → ${level}`);
  console.log(`  verdict: ${out.interpretation.verdict}`);
  console.log(`  global: ${out.scores.global}%`);
  console.log(`  flags: ${out.flags.length || 0}`);

  if (level !== expect) {
    console.log(`  FAIL: nivel ${level}, esperado ${expect}`);
    failed++;
  }
  if (out.scores.global !== baselineGlobal) {
    console.log('  FAIL: global alterado');
    failed++;
  }

  if (expect === 'normal') {
    if (out.flags.length) {
      console.log('  FAIL: normal no debe generar flags de calibración');
      failed++;
    }
  }
  if (expect === 'review') {
    if (!out.flags.includes(honestidadCalibrationReviewMessage(errCal))) {
      console.log('  FAIL: falta flag review');
      failed++;
    }
    if (out.interpretation.verdict === 'Prueba Inválida') {
      console.log('  FAIL: review no debe invalidar');
      failed++;
    }
  }
  if (expect === 'low_reliability') {
    const tpl = HONESTIDAD_CALIBRATION_LOW_RELIABILITY_TEMPLATE.replace('{{errCal}}', String(errCal));
    if (!out.flags.some((f) => f.includes(String(errCal)) && f.includes('baja atención'))) {
      console.log('  FAIL: falta flag low_reliability');
      failed++;
    }
    if (!yellowLit || greenLit) {
      console.log('  FAIL: PDF debe usar semáforo amarillo (no verde)');
      failed++;
    }
    if (out.interpretation.verdict === 'Prueba Inválida') {
      console.log('  FAIL: low_reliability no debe invalidar');
      failed++;
    }
  }
  if (expect === 'invalid') {
    if (out.interpretation.verdict !== 'Prueba Inválida') {
      console.log('  FAIL: invalid debe forzar Prueba Inválida');
      failed++;
    }
    if (out.interpretation.verdict === 'Aprobatorio') {
      console.log('  FAIL: invalid no puede ser Aprobatorio');
      failed++;
    }
    if (!invalidVisual || !redLit || greenLit) {
      console.log('  FAIL: PDF debe ser inválido y semáforo rojo');
      failed++;
    }
    if (!out.flags.includes(HONESTIDAD_CALIBRATION_INVALID_MESSAGE)) {
      console.log('  FAIL: falta flag invalid');
      failed++;
    }
  }
  console.log('');
}

console.log(failed === 0 ? '✓ Calibración OK.\n' : `✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

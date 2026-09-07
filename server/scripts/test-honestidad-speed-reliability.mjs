/**
 * Termómetro de confiabilidad por duración total — Honestidad y Confianza.
 * Ejecutar: node server/scripts/test-honestidad-speed-reliability.mjs
 */
import { defaultDemoAssessmentConfig } from '../src/assessment/defaultDefinition.js';
import { scoreAssessment } from '../src/services/scoring.service.js';
import {
  applyHonestidadCalibrationReliabilityLayer,
  applyHonestidadSpeedReliabilityLayer,
  computeHonestidadDurationReliability,
  HONESTIDAD_SPEED_REVIEW_MESSAGE,
  resolveHonestidadSpeedReliability,
} from '../src/services/attemptReliability.service.js';
import {
  buildHonestidadModuleFragment,
  isHonestidadPruebaInvalida,
} from '../src/reports/honestidadReport.fragment.js';
import { buildSpeedReliabilityAlertHtml } from '../src/reports/reliabilityAlert.fragment.js';
import { fillBestLikertAnswers } from './honestidadTestHelpers.mjs';

const CAL_IDS = ['c1', 'c2', 'c3', 'c4', 'c5'];
const DIRECT_IDS = ['d1', 'd2', 'd3', 'd4', 'd5'];
const LIKERT_IDS = Array.from({ length: 40 }, (_, i) => `p${i + 1}`);

function buildAnswers() {
  const answers = {};
  for (const id of CAL_IDS) answers[id] = 0;
  for (const id of DIRECT_IDS) answers[id] = 0;
  fillBestLikertAnswers(defaultDemoAssessmentConfig, answers);
  return answers;
}

function layerForElapsedSeconds(elapsedSeconds) {
  const startedAt = new Date('2026-01-01T12:00:00Z');
  const submittedAt = new Date(startedAt.getTime() + elapsedSeconds * 1000);
  const scored = scoreAssessment(defaultDemoAssessmentConfig, buildAnswers());
  const cal = applyHonestidadCalibrationReliabilityLayer({
    scored,
    flags: scored.flags,
    moduleKey: 'honestidad',
  });
  const reliability = computeHonestidadDurationReliability({ startedAt, submittedAt });
  return applyHonestidadSpeedReliabilityLayer({
    scored: cal.scores,
    flags: cal.flags,
    interpretation: cal.interpretation,
    reliability,
    moduleKey: 'honestidad',
  });
}

const baseline = scoreAssessment(defaultDemoAssessmentConfig, buildAnswers());
const baselineGlobal = baseline.global;

const thresholdCases = [
  { label: '4:00', sec: 240, expect: 'normal' },
  { label: '3:20', sec: 200, expect: 'normal' },
  { label: '3:19', sec: 199, expect: 'review' },
  { label: '2:30', sec: 150, expect: 'review' },
  { label: '2:00', sec: 120, expect: 'review' },
  { label: '1:59', sec: 119, expect: 'invalid' },
  { label: '1:00', sec: 60, expect: 'invalid' },
];

let failed = 0;

console.log('\n=== Honestidad — termómetro duración total ===\n');
console.log(`Baseline global (scoring puro): ${baselineGlobal}%\n`);

for (const { label, sec, expect } of thresholdCases) {
  const level = resolveHonestidadSpeedReliability(sec);
  const okLevel = level === expect;
  console.log(`${label} (${sec}s) → ${level}${okLevel ? '' : ` FAIL (esperado ${expect})`}`);
  if (!okLevel) failed++;
}

console.log('\n--- Capa sobre scoring (global intacto) ---\n');

for (const { label, sec, expect } of thresholdCases) {
  const out = layerForElapsedSeconds(sec);
  const level = out.scores.meta.speedReliability;
  const globalOk = out.scores.global === baselineGlobal;
  const dimsOk =
    JSON.stringify(out.scores.dimensions) === JSON.stringify(baseline.dimensions);

  console.log(`${label}:`);
  console.log(`  speedReliability: ${level}`);
  console.log(`  verdict: ${out.interpretation.verdict}`);
  console.log(`  global: ${out.scores.global}% (baseline ${baselineGlobal}%)`);
  console.log(`  elapsedSeconds meta: ${out.scores.meta.reliability.elapsedSeconds}`);

  if (level !== expect) {
    console.log(`  FAIL: nivel ${level}, esperado ${expect}`);
    failed++;
  }
  if (!globalOk || !dimsOk) {
    console.log('  FAIL: scoring numérico alterado');
    failed++;
  }

  if (expect === 'normal') {
    if (out.interpretation.verdict !== 'Aprobatorio') {
      console.log('  FAIL: normal debe conservar veredicto Aprobatorio');
      failed++;
    }
    if (out.flags.some((f) => f.includes('tiempo') || f.includes('confiabilidad'))) {
      console.log('  FAIL: normal no debe generar flag de velocidad');
      failed++;
    }
  }

  if (expect === 'review') {
    if (!out.flags.includes(HONESTIDAD_SPEED_REVIEW_MESSAGE)) {
      console.log('  FAIL: review debe incluir flag de revisión');
      failed++;
    }
    if (out.interpretation.verdict === 'Prueba Inválida') {
      console.log('  FAIL: review no debe invalidar veredicto');
      failed++;
    }
    if (out.interpretation.verdict !== 'Aprobatorio') {
      console.log('  FAIL: review debe mantener veredicto score-based Aprobatorio');
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
    const attempt = {
      moduleKey: 'honestidad',
      scores: out.scores,
      interpretation: out.interpretation,
      flags: out.flags,
    };
    const pdfHtml = buildHonestidadModuleFragment({
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
    const greenLit = /background:#10B981.*box-shadow:0 0 8px rgba\(16,185,129/.test(pdfHtml);
    const topAlert = buildSpeedReliabilityAlertHtml(attempt);

    if (!invalidVisual) {
      console.log('  FAIL: PDF debe tratar la prueba como inválida');
      failed++;
    }
    if (greenLit) {
      console.log('  FAIL: semáforo PDF no debe mostrar verde activo');
      failed++;
    }
    if (topAlert) {
      console.log('  FAIL: invalid no debe usar banner genérico de review');
      failed++;
    }
  }
  console.log('');
}

console.log(failed === 0 ? '✓ Todos los escenarios pasaron.\n' : `✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

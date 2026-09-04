/**
 * Validación: orden intercalado c1–c5 en Honestidad (presentación).
 * Ejecutar: node server/scripts/test-honestidad-question-order.mjs
 */
import { defaultDemoAssessmentConfig } from '../src/assessment/defaultDefinition.js';
import { scoreAssessment } from '../src/services/scoring.service.js';

function buildSequentialFlat(cfg) {
  const flat = [];
  for (const sec of cfg.sections || []) {
    for (const q of sec.questions || []) {
      flat.push({ sectionId: sec.id, id: q.id });
    }
  }
  return flat;
}

function interleaveHonestidadFlat(flat) {
  const cal = flat.filter((q) => q.sectionId === 'calibracion');
  const rest = flat.filter((q) => q.sectionId !== 'calibracion');
  if (cal.length <= 1) return flat;
  const nCal = cal.length;
  const nRest = rest.length;
  const total = nCal + nRest;
  const positions = [];
  for (let i = 0; i < nCal; i++) {
    positions.push(Math.round(((i + 1) * total) / (nCal + 1)) - 1);
  }
  const out = new Array(total);
  let ri = 0;
  let ci = 0;
  for (let pos = 0; pos < total; pos++) {
    if (ci < nCal && pos === positions[ci]) out[pos] = cal[ci++];
    else out[pos] = rest[ri++];
  }
  return out;
}

function buildAnswersFromFlat(flat, errCalCount) {
  const answers = {};
  let calWrong = 0;
  for (const item of flat) {
    if (item.id.startsWith('c')) {
      answers[item.id] = calWrong < errCalCount ? 1 : 0;
      if (calWrong < errCalCount) calWrong++;
    } else if (item.id.startsWith('d')) {
      answers[item.id] = 0;
    } else {
      answers[item.id] = 0;
    }
  }
  return answers;
}

const sequential = buildSequentialFlat(defaultDemoAssessmentConfig);
const interleaved = interleaveHonestidadFlat(sequential);
const ids = interleaved.map((q) => q.id);
const calIds = ['c1', 'c2', 'c3', 'c4', 'c5'];

let failed = 0;

console.log('\n=== Honestidad — orden intercalado c1–c5 ===\n');

// 1. No consecutivas
for (let i = 0; i < ids.length - 1; i++) {
  if (ids[i].startsWith('c') && ids[i + 1].startsWith('c')) {
    console.log('FAIL: calibración consecutiva en', ids[i], ids[i + 1]);
    failed++;
  }
}
if (!failed) console.log('OK: c1–c5 no aparecen consecutivas');

// 2. Una sola vez cada una
for (const cid of calIds) {
  const n = ids.filter((id) => id === cid).length;
  if (n !== 1) {
    console.log('FAIL:', cid, 'aparece', n, 'veces');
    failed++;
  }
}
console.log('OK: cada pregunta c1–c5 aparece exactamente una vez');

// 3. Distribuidas (no todas al inicio)
const firstCalIdx = ids.findIndex((id) => id.startsWith('c'));
const lastCalIdx = ids.reduce((acc, id, i) => (id.startsWith('c') ? i : acc), -1);
if (firstCalIdx < 3 || lastCalIdx < 30) {
  console.log('FAIL: distribución insuficiente (first=', firstCalIdx, 'last=', lastCalIdx, ')');
  failed++;
} else {
  console.log('OK: distribuidas (primera cal en índice', firstCalIdx + ', última en', lastCalIdx + ')');
}

console.log('\nOrden visible (50 ítems):');
console.log(ids.join(' → '));

// 4–5. Submit por ID / errCal igual
const baseline = scoreAssessment(
  defaultDemoAssessmentConfig,
  buildAnswersFromFlat(sequential, 3),
);
const interleavedAnswers = buildAnswersFromFlat(interleaved, 3);
const fromInterleaved = scoreAssessment(defaultDemoAssessmentConfig, interleavedAnswers);

if (baseline.meta.errCal !== 3 || fromInterleaved.meta.errCal !== 3) {
  console.log('FAIL: errCal esperado 3, got', baseline.meta.errCal, fromInterleaved.meta.errCal);
  failed++;
} else {
  console.log('\nOK: errCal=3 idéntico con orden secuencial e intercalado');
}

if (baseline.global !== fromInterleaved.global) {
  console.log('FAIL: global alterado por orden de respuestas');
  failed++;
} else {
  console.log('OK: global intacto (', baseline.global, '%)');
}

console.log(failed === 0 ? '\n✓ Orden intercalado OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * Cognitiva Analítica Mind24 — indicador de completitud (Fase 2).
 * Ejecutar: node server/scripts/test-terman-completeness.mjs
 */
import {
  scoreTermanResponses,
  buildTermanAttemptScores,
  buildTermanHrInterpretation,
  computeTermanCompleteness,
  formatTermanCompletenessText,
} from '../src/services/termanScoring.service.js';
import { termanQuestionsFlat, TERMAN_MAX_RAW_SCORE } from '../src/data/termanData.js';
import { buildTermanModuleFragment } from '../src/reports/fragments/termanReport.fragment.js';

let failed = 0;
let passed = 0;

function ok(msg) {
  passed++;
  console.log(`  OK  ${msg}`);
}

function fail(msg, extra) {
  failed++;
  console.log(`  FAIL ${msg}`);
  if (extra !== undefined) console.log(`       ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`);
}

function check(cond, msg, extra) {
  if (cond) ok(msg);
  else fail(msg, extra);
}

const flat = termanQuestionsFlat();
const allQuestionIds = flat.map((_, i) => `q-${i}`);

function rowFor(i, correct = true) {
  const row = flat[i];
  const wrong = row.correctIndex === 0 ? 1 : 0;
  return {
    questionId: allQuestionIds[i],
    selectedOptionId: correct ? 'sel' : 'sel',
    question: { metadata: { seriesId: row.seriesId, correctIndex: row.correctIndex } },
    selectedOption: { sortOrder: correct ? row.correctIndex : wrong },
  };
}

function perfectRows() {
  return flat.map((_, i) => rowFor(i, true));
}

function partialRows(count) {
  return flat.slice(0, count).map((_, i) => rowFor(i, true));
}

function mergeScoring(rows, countAnswered) {
  const scoring = scoreTermanResponses(rows);
  return {
    ...scoring,
    ...computeTermanCompleteness(allQuestionIds, rows),
  };
}

console.log('\n=== Terman: completitud de aplicación ===\n');

const full = mergeScoring(perfectRows(), 50);
check(full.answeredCount === 50, '50/50 → answeredCount=50', full.answeredCount);
check(full.unansweredCount === 0, '50/50 → unansweredCount=0', full.unansweredCount);
check(full.completionRate === 100, '50/50 → completionRate=100', full.completionRate);
check(full.rawScore === 50, '50/50 → rawScore=50 (sin cambio)', full.rawScore);
check(full.percentCorrect === 100, '50/50 → percentCorrect=100 (sin cambio)', full.percentCorrect);

const partial = mergeScoring(partialRows(46), 46);
check(partial.answeredCount === 46, '46/50 → answeredCount=46', partial.answeredCount);
check(partial.unansweredCount === 4, '46/50 → unansweredCount=4', partial.unansweredCount);
check(partial.completionRate === 92, '46/50 → completionRate=92', partial.completionRate);
check(partial.rawScore === 46, '46 correctas → rawScore=46 (omisiones=0)', partial.rawScore);
check(partial.percentCorrect === 92, '46/50 aciertos → percentCorrect=92', partial.percentCorrect);

const tenOnly = mergeScoring(partialRows(10), 10);
check(tenOnly.answeredCount === 10, '10 respondidos → answeredCount=10', tenOnly.answeredCount);
check(tenOnly.unansweredCount === 40, '40 omitidos → unansweredCount=40', tenOnly.unansweredCount);
check(tenOnly.rawScore === 10, '10 aciertos + 40 omisiones → rawScore=10', tenOnly.rawScore);
check(tenOnly.percentCorrect === 20, '10/50 → percentCorrect=20', tenOnly.percentCorrect);

check(
  formatTermanCompletenessText({ answeredCount: 50, unansweredCount: 0, expectedTotal: 50 }) ===
    '50 de 50 reactivos respondidos.',
  'texto completo',
);
check(
  formatTermanCompletenessText({ answeredCount: 46, unansweredCount: 4, expectedTotal: 50 }) ===
    '46 de 50 reactivos respondidos. 4 reactivos quedaron sin respuesta.',
  'texto incompleto',
);

const persisted = buildTermanAttemptScores(full);
check(persisted.scores.answeredCount === 50, 'scores persisten answeredCount');
check(persisted.scores.unansweredCount === 0, 'scores persisten unansweredCount');
check(persisted.scores.completionRate === 100, 'scores persisten completionRate');
check(persisted.scores.rawScore === 50, 'scores.rawScore intacto');

const interpFull = buildTermanHrInterpretation(full);
check(/50 de 50 reactivos respondidos/.test(interpFull.description), 'interpretación incluye completitud total');

const interpPartial = buildTermanHrInterpretation(partial);
check(/46 de 50 reactivos respondidos/.test(interpPartial.description), 'interpretación incluye parcial');
check(/4 reactivos quedaron sin respuesta/.test(interpPartial.description), 'interpretación menciona omitidos');

const htmlFull = buildTermanModuleFragment({ scores: full, submittedAt: '2026-09-08' });
check(/Completitud de la aplicación/.test(htmlFull), 'PDF sección completitud');
check(/50 de 50 reactivos respondidos/.test(htmlFull), 'PDF texto aplicación completa');

const htmlPartial = buildTermanModuleFragment({ scores: partial, submittedAt: '2026-09-08' });
check(/46 de 50 reactivos respondidos/.test(htmlPartial), 'PDF texto aplicación incompleta');
check(/4 reactivos quedaron sin respuesta/.test(htmlPartial), 'PDF menciona omitidos');

check(TERMAN_MAX_RAW_SCORE === 50, 'denominador sigue en 50');

if (failed) {
  console.log(`\nRESULTADO: ${failed} fallos, ${passed} ok\n`);
  process.exit(1);
}
console.log(`\nRESULTADO: ${passed} ok\n`);

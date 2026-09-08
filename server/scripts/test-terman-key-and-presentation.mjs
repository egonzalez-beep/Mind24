/**
 * Cognitiva Analítica Mind24: clave no sale al candidato; ciEstimate no se presenta como CI.
 * Scoring bruto (rawScore / percentCorrect / series) no debe cambiar.
 *
 * Ejecutar: node server/scripts/test-terman-key-and-presentation.mjs
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://test:test@127.0.0.1:5432/test';

const { serializeQuestion, buildTermanSeriesPayload } = await import(
  '../src/services/dynamicAssessment.service.js'
);
const {
  scoreTermanResponses,
  buildTermanAttemptScores,
  buildTermanHrInterpretation,
} = await import('../src/services/termanScoring.service.js');
const { termanQuestionsFlat, TERMAN_MAX_RAW_SCORE } = await import('../src/data/termanData.js');
const { buildTermanModuleFragment } = await import(
  '../src/reports/fragments/termanReport.fragment.js'
);

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

const FORBIDDEN_KEY_RE =
  /^(correctIndex|correctAnswer|isCorrect|correct|answerKey|solution|answerIndex|rightIndex|rightAnswer|correctLetter|correctOption|correctOptionId)$/i;

function collectForbiddenKeys(value, path, found) {
  if (value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectForbiddenKeys(item, `${path}[${i}]`, found));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEY_RE.test(key)) found.push(`${path}.${key}`);
    collectForbiddenKeys(nested, `${path}.${key}`, found);
  }
}

function assertNoAnswerKey(payload, label) {
  const found = [];
  collectForbiddenKeys(payload, 'payload', found);
  const json = JSON.stringify(payload);
  if (/correctIndex|correctAnswer|"isCorrect"/.test(json)) {
    found.push('json_contains_sensitive_token');
  }
  check(found.length === 0, `${label}: sin clave de acierto`, found.length ? found : undefined);
}

function containsIqLanguage(text) {
  const s = String(text || '');
  return (
    /coeficiente\s+intelectual/i.test(s) ||
    /\bCI\b/.test(s) ||
    /ci\s+(oficial|preliminar|estimado)/i.test(s) ||
    /ciEstimate/i.test(s) ||
    /iqEstimate/i.test(s)
  );
}

function dbShapedQuestions() {
  return termanQuestionsFlat().map((row, i) => ({
    id: `q-${row.termanItemId}`,
    type: 'MULTIPLE_CHOICE',
    text: row.text,
    sortOrder: row.sortOrder,
    metadata: {
      termanItemId: row.termanItemId,
      seriesId: row.seriesId,
      seriesName: row.seriesName,
      seriesIndex: row.seriesIndex,
      seriesTimeLimitSeconds: row.seriesTimeLimitSeconds,
      seriesInstruction: row.seriesInstruction,
      questionIndexInSeries: row.questionIndexInSeries,
      correctIndex: row.correctIndex,
      correctAnswer: 'LEAK',
      isCorrect: true,
    },
    options: row.options.map((label, j) => ({
      id: `opt-${i}-${j}`,
      label,
      value: String(j),
      sortOrder: j,
      metadata: { isCorrect: j === row.correctIndex, correctIndex: row.correctIndex },
    })),
  }));
}

function perfectRows() {
  return termanQuestionsFlat().map((row) => ({
    questionId: row.termanItemId,
    selectedOptionId: 'sel',
    question: {
      metadata: {
        seriesId: row.seriesId,
        correctIndex: row.correctIndex,
      },
    },
    selectedOption: { sortOrder: row.correctIndex },
  }));
}

function zeroRows() {
  return termanQuestionsFlat().map((row) => {
    const wrong = row.correctIndex === 0 ? 1 : 0;
    return {
      questionId: row.termanItemId,
      selectedOptionId: 'sel',
      question: { metadata: { seriesId: row.seriesId, correctIndex: row.correctIndex } },
      selectedOption: { sortOrder: wrong },
    };
  });
}

console.log('\n=== Terman: clave candidato + presentación CI ===\n');

check(termanQuestionsFlat().length === 50, 'banco interno sigue en 50 reactivos');
check(TERMAN_MAX_RAW_SCORE === 50, 'TERMAN_MAX_RAW_SCORE = 50');

const questions = dbShapedQuestions();
check(questions.every((q) => q.metadata.correctIndex != null), 'fixture interno conserva correctIndex para scoring');

console.log('\n-- Payload candidato --');

const serialized = questions.map((q) => serializeQuestion(q, 'terman'));
assertNoAnswerKey(serialized, 'serializeQuestion(terman)');

for (const alias of ['cognitivo', 'conocimientos', 'raven']) {
  assertNoAnswerKey(
    questions.slice(0, 2).map((q) => serializeQuestion(q, alias)),
    `serializeQuestion(${alias})`,
  );
}

const firstMeta = serialized[0].metadata || {};
check(firstMeta.seriesId != null, 'metadata cliente conserva seriesId');
check(firstMeta.seriesInstruction != null, 'metadata cliente conserva seriesInstruction');
check(firstMeta.seriesTimeLimitSeconds != null, 'metadata cliente conserva seriesTimeLimitSeconds');
check(firstMeta.correctIndex === undefined, 'metadata cliente no incluye correctIndex');
check(
  serialized[0].options.every((o) => o.metadata == null),
  'metadata de opciones Terman no se envía al cliente',
);

const enginePayload = {
  engine: 'dynamic',
  moduleKey: 'terman',
  questions: questions.map((q) => serializeQuestion(q, 'terman')),
  answeredQuestionIds: [],
};
assertNoAnswerKey(enginePayload, 'GET /engine (questions)');

const startPayload = {
  engine: 'dynamic',
  moduleKey: 'terman',
  assessmentMode: 'terman',
  questions: questions.map((q) => serializeQuestion(q, 'terman')),
  termanSeries: buildTermanSeriesPayload(questions),
};
assertNoAnswerKey(startPayload, 'POST /start (questions + termanSeries)');
check(startPayload.termanSeries.length === 10, 'termanSeries sigue agrupando 10 series');
check(
  startPayload.termanSeries.every((s) => s.questions.length === 5),
  'cada serie del payload tiene 5 reactivos',
);

console.log('\n-- Otros módulos no se sanitizan como Terman --');

const cleaverQ = {
  id: 'c1',
  type: 'MULTIPLE_CHOICE',
  text: 'bloque',
  metadata: { order: 1, instruction: 'Elija' },
  sortOrder: 0,
  options: [
    {
      id: 'o1',
      label: 'Decisivo',
      value: '',
      sortOrder: 0,
      metadata: { keySchema: 'ml_v1', dimensionMore: 'D', dimensionLess: 'S' },
    },
  ],
};
const cleaverSer = serializeQuestion(cleaverQ, 'cleaver');
check(cleaverSer.metadata?.order === 1, 'Cleaver conserva metadata de pregunta');
check(cleaverSer.options[0].metadata?.dimensionMore === 'D', 'Cleaver conserva dimensionMore en opción');
check(cleaverSer.options[0].metadata?.dimensionLess === 'S', 'Cleaver conserva dimensionLess en opción');

const sjtQ = {
  id: 's1',
  type: 'MULTIPLE_CHOICE',
  text: 'escenario',
  metadata: { scenarioIndex: 3, scoringKey: 'secret' },
  sortOrder: 0,
  options: [{ id: 'so', label: 'A', value: 'a', sortOrder: 0, metadata: { points: 5 } }],
};
const sjtSer = serializeQuestion(sjtQ, 'sales_sjt');
check(sjtSer.metadata?.scenarioIndex === 3, 'SJT conserva scenarioIndex');
check(sjtSer.metadata?.scoringKey === undefined, 'SJT no envía scoringKey');
check(sjtSer.options[0].metadata == null, 'SJT no envía metadata de opción');

console.log('\n-- Scoring bruto --');

const perfect = scoreTermanResponses(perfectRows());
check(perfect.rawScore === 50, '50/50 → rawScore=50', perfect.rawScore);
check(perfect.percentCorrect === 100, '50/50 → percentCorrect=100', perfect.percentCorrect);
check(perfect.totalQuestions === 50, '50/50 → totalQuestions=50', perfect.totalQuestions);
check(
  perfect.series.length === 10 && perfect.series.every((s) => s.correct === 5 && s.total === 5 && s.percent === 100),
  '50/50 → series[] 10×5/5 a 100%',
);
check(perfect.ci === null && perfect.iq === null, 'ci e iq reales siguen en null');
check(perfect.ciEstimate === 130, 'ciEstimate interno 50/50 = 130 (compatibilidad, no se muestra)', perfect.ciEstimate);

const zero = scoreTermanResponses(zeroRows());
check(zero.rawScore === 0, '0/50 → rawScore=0', zero.rawScore);
check(zero.percentCorrect === 0, '0/50 → percentCorrect=0', zero.percentCorrect);
check(zero.ciEstimate === 70, 'ciEstimate interno 0/50 = 70', zero.ciEstimate);

const persisted = buildTermanAttemptScores(perfect);
check(persisted.scores.rawScore === 50, 'buildTermanAttemptScores conserva rawScore');
check(persisted.scores.percentCorrect === 100, 'buildTermanAttemptScores conserva percentCorrect');
check(Array.isArray(persisted.scores.series) && persisted.scores.series.length === 10, 'scores.series intacto');
check(persisted.scores.ciEstimate === 130, 'ciEstimate permanece en scores internos');

console.log('\n-- Interpretación RH / PDF --');

const interp = buildTermanHrInterpretation(perfect);
check(!containsIqLanguage(JSON.stringify(interp)), 'interpretación sin CI / coeficiente intelectual / ciEstimate', interp.description);
check(/Resultado de la evaluación cognitiva/i.test(interp.description), 'interpretación usa lenguaje de producto');
check(/puntaje bruto 50\/50/.test(interp.description), 'interpretación incluye rawScore 50/50');
check(/100% aciertos/.test(interp.description), 'interpretación incluye percentCorrect');
check(interp.termanRawScore === 50, 'interpretation.termanRawScore sigue siendo rawScore');

const html = buildTermanModuleFragment({
  scores: {
    ...perfect,
    ci: 777,
    ciEstimate: 999,
    iqEstimate: 999,
    ciNote: 'CI oficial en calibración. Coeficiente intelectual (CI) preliminar.',
  },
  submittedAt: '2026-09-08',
});

check(/Desempeño cognitivo/.test(html), 'PDF etiqueta Desempeño cognitivo');
check(/Porcentaje global de aciertos/.test(html), 'PDF badge Porcentaje global de aciertos');
check(!containsIqLanguage(html), 'PDF no muestra CI / coeficiente intelectual / ciEstimate');
check(!/999/.test(html), 'PDF no renderiza ciEstimate interno');
check(!/777/.test(html), 'PDF no renderiza ci interno');
check(!/preliminar/i.test(html), 'PDF no dice preliminar');
check(!/Coeficiente intelectual/.test(html), 'PDF no usa label Coeficiente intelectual (CI)');
check(/Puntaje bruto global/.test(html), 'PDF conserva puntaje bruto global');
check(/kpi-value">50 /.test(html) && /\/ 50/.test(html), 'PDF muestra rawScore 50/50');

if (failed) {
  console.log(`\nRESULTADO: ${failed} fallos, ${passed} ok\n`);
  process.exit(1);
}
console.log(`\nRESULTADO: ${passed} ok\n`);

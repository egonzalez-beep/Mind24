/**
 * Personalidad Mind24 — motor dinámico (orden, sanitización, scoring 80/60, resume).
 * Ejecutar: node server/scripts/test-personality-mind24-dynamic.mjs
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://test:test@127.0.0.1:5432/test';

import {
  PERSONALIDAD_MIND24_DIMENSIONS,
  PERSONALIDAD_MIND24_ITEMS,
  PERSONALIDAD_MIND24_SCALE,
  personalityItemsFlat,
} from '../src/data/personalityMind24Data.js';
import {
  assertNoPersonalityScoringMetadata,
  serializeQuestion,
} from '../src/services/dynamicAssessment.service.js';
import {
  buildPersonalityApplicationQualityMeta,
  buildPersonalityMind24AttemptScores,
  computePersonalityMind24Completeness,
  scorePersonalityMind24Responses,
} from '../src/services/personalityMind24Scoring.service.js';
import {
  buildPersonalityPresentationOrder,
  mergePersonalityAttemptResults,
  orderQuestionsByPresentation,
  personalityExpectedItemsFromQuestions,
  readPersonalityPresentationOrder,
  claimPersonalityPresentationOrder,
  resolvePersonalityAttemptForm,
  resolvePersonalityPresentationOrder,
  validatePersonalityPresentationInvariants,
} from '../src/services/personalityMind24Presentation.service.js';

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function dbQuestionsFromItems(items, bankStatusOverride) {
  return items.map((item, idx) => ({
    id: `db-q-${item.itemId}`,
    moduleId: 'mod-pm24',
    type: 'MULTIPLE_CHOICE',
    text: item.text,
    sortOrder: item.sortOrder ?? idx + 1,
    metadata: {
      personalityItemId: item.itemId,
      dimensionId: item.dimensionId,
      direction: item.direction,
      bankStatus: bankStatusOverride || item.bankStatus,
    },
    options: PERSONALIDAD_MIND24_SCALE.optionLabels.map((label, j) => ({
      id: `opt-${item.itemId}-${j + 1}`,
      label,
      value: String(j + 1),
      sortOrder: j,
      metadata: null,
    })),
  }));
}

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

console.log('\n=== Personalidad Mind24 — dynamic (Fase 4A.3) ===\n');

console.log('--- Shuffle / invariantes ---\n');

const items80 = personalityItemsFlat();
const questions80 = dbQuestionsFromItems(
  items80.map((i) => ({ ...i, bankStatus: 'pilot' })),
  'pilot',
);

for (let seed = 1; seed <= 25; seed += 1) {
  const order = buildPersonalityPresentationOrder(questions80, { random: seededRandom(seed) });
  const inv = validatePersonalityPresentationInvariants(questions80, order);
  check(inv.ok, `shuffle seed ${seed}: invariantes (${inv.errors[0] || 'ok'})`);
}

console.log('\n--- Sanitización payload candidato ---\n');

const sampleQ = questions80[0];
const clientQ = serializeQuestion(sampleQ, 'personalidad_mind24');
check(clientQ.metadata == null, 'serializeQuestion: metadata null');
check(
  clientQ.options.every((o) => o.metadata == null),
  'serializeQuestion: option metadata null',
);
check(clientQ.options.length === 5, 'Likert: 5 opciones');
check(clientQ.options[0].value === '1', 'Likert value "1"');
check(clientQ.options[4].label === PERSONALIDAD_MIND24_SCALE.optionLabels[4], 'Likert label 5');

const forbidden = assertNoPersonalityScoringMetadata({ questions: [clientQ] });
check(forbidden.length === 0, 'sin dimensionId/direction/personalityItemId/bankStatus en cliente');

console.log('\n--- Persistencia presentationOrder ---\n');

const attemptEmpty = { id: 'att-1', results: null };
const resolved = resolvePersonalityPresentationOrder(attemptEmpty, questions80, {
  random: seededRandom(42),
});
check(resolved.created === true, 'primera resolución: created');
check(resolved.presentationOrder.length === 80, 'orden: 80 ids');

const mergedResults = mergePersonalityAttemptResults(null, resolved.presentationOrder);
check(
  readPersonalityPresentationOrder({ results: mergedResults })?.length === 80,
  'readPersonalityPresentationOrder desde results',
);

const attemptStored = { id: 'att-1', results: mergedResults };
const resolvedAgain = resolvePersonalityPresentationOrder(attemptStored, questions80);
check(resolvedAgain.created === false, 'resume: reutiliza orden persistido');
check(
  JSON.stringify(resolvedAgain.presentationOrder) === JSON.stringify(resolved.presentationOrder),
  'resume: mismo presentationOrder',
);

const ordered = orderQuestionsByPresentation(questions80, resolved.presentationOrder);
check(ordered.length === 80, 'orderQuestionsByPresentation: 80');
check(ordered[0].id === resolved.presentationOrder[0], 'orden aplicado a preguntas');

console.log('\n--- Scoring integración 80 ---\n');

const expected80 = personalityExpectedItemsFromQuestions(questions80);
const rows80 = questions80.map((q, idx) => ({
  questionId: q.id,
  question: { metadata: q.metadata },
  selectedOption: {
    value: String((idx % 5) + 1),
    sortOrder: idx % 5,
  },
}));

const scored80 = scorePersonalityMind24Responses(rows80, { expectedItems: expected80 });
check(scored80.form.totalItemsExpected === 80, '80: totalItemsExpected');
check(scored80.form.itemsPerDimension === 8, '80: itemsPerDimension 8');
for (const dim of PERSONALIDAD_MIND24_DIMENSIONS) {
  check(scored80.dimensions[dim.dimensionId].nExpected === 8, `80: nExpected ${dim.dimensionId}`);
  check(scored80.dimensions[dim.dimensionId].nAnswered === 8, `80: nAnswered ${dim.dimensionId}`);
  check(scored80.dimensions[dim.dimensionId].mean != null, `80: mean ${dim.dimensionId}`);
}
check(scored80.global === undefined, '80: sin global');

const completeness80 = computePersonalityMind24Completeness(
  questions80.map((q) => q.id),
  rows80.map((r) => ({ questionId: r.questionId })),
);
const reliabilityFast = {
  isUnreliableSpeed: true,
  avgSecondsPerQuestion: 0.2,
  elapsedMs: 1000,
  questionCount: 80,
};
const aq80 = buildPersonalityApplicationQualityMeta(reliabilityFast, completeness80);
check(aq80.reliability?.isUnreliableSpeed === undefined, '80: sin isUnreliableSpeed en AQ');
check(aq80.reliability?.avgSecondsPerQuestion === 0.2, '80: conserva avgSecondsPerQuestion');
check(completeness80.answeredCount === 80, '80: completeness 80/80');

const attempt80 = buildPersonalityMind24AttemptScores(scored80, aq80);
check(attempt80.instrument === 'personalidad_mind24', '80: instrument');
check(attempt80.scores.dimensions && !('global' in attempt80.scores), '80: scores sin global');
check(
  attempt80.scores.meta.applicationQuality?.completeness?.answeredCount === 80,
  '80: applicationQuality completeness',
);
check(
  attempt80.scores.meta.applicationQuality?.reliability?.isUnreliableSpeed === undefined,
  '80: scores sin reliability velocidad',
);
check(attempt80.scores.itemResponses === undefined, '80: itemResponses no persistidos en scores');

console.log('\n--- Scoring integración 60 ---\n');

const prodItems = [];
for (const dim of PERSONALIDAD_MIND24_DIMENSIONS) {
  prodItems.push(
    ...personalityItemsFlat()
      .filter((i) => i.dimensionId === dim.dimensionId)
      .slice(0, 6)
      .map((i) => ({ ...i, bankStatus: 'production' })),
  );
}
const questions60 = dbQuestionsFromItems(prodItems, 'production');
const expected60 = personalityExpectedItemsFromQuestions(questions60);
const rows60 = questions60.map((q, idx) => ({
  questionId: q.id,
  question: { metadata: q.metadata },
  selectedOption: { value: '3', sortOrder: 2 },
}));
const scored60 = scorePersonalityMind24Responses(rows60, { expectedItems: expected60 });
check(scored60.form.totalItemsExpected === 60, '60: totalItemsExpected');
check(scored60.form.itemsPerDimension === 6, '60: itemsPerDimension 6');
check(
  scored60.dimensions.logro_persistencia.nExpected === 6,
  '60: nExpected por dimensión',
);

console.log('\n--- Form congelado: catálogo 80 → resume con catálogo 60 ---\n');

const order80Frozen = buildPersonalityPresentationOrder(questions80, { random: seededRandom(7) });
const attempt80Frozen = {
  id: 'att-frozen-80',
  results: mergePersonalityAttemptResults(null, order80Frozen),
};
const all80ById = new Map(questions80.map((q) => [q.id, q]));
const catalog60Only = questions60;

const mockDb80 = {
  question: {
    async findMany({ where }) {
      const ids = where.id.in;
      return ids.map((id) => all80ById.get(id)).filter(Boolean);
    },
  },
};

const shrinkResolve = resolvePersonalityPresentationOrder(attempt80Frozen, catalog60Only);
check(shrinkResolve.frozen === true, 'shrink: no regenera presentationOrder');
check(shrinkResolve.presentationOrder.length === 80, 'shrink: conserva 80 IDs en orden');
check(
  JSON.stringify(shrinkResolve.presentationOrder) === JSON.stringify(order80Frozen),
  'shrink: mismo orden exacto',
);

const frozenForm = await resolvePersonalityAttemptForm(mockDb80, attempt80Frozen, catalog60Only);
check(frozenForm.frozen === true, 'shrink: form frozen');
check(frozenForm.questions.length === 80, 'shrink: carga 80 preguntas desde BD');
check(
  frozenForm.questions.every((q) => order80Frozen.includes(q.id)),
  'shrink: preguntas son las del intento original',
);

const rows80Frozen = frozenForm.questions.map((q, idx) => ({
  questionId: q.id,
  question: { metadata: q.metadata },
  selectedOption: { value: String((idx % 5) + 1), sortOrder: idx % 5 },
}));
const scoredFrozen80 = scorePersonalityMind24Responses(rows80Frozen, {
  expectedItems: personalityExpectedItemsFromQuestions(frozenForm.questions),
});
check(scoredFrozen80.form.totalItemsExpected === 80, 'shrink complete: totalItemsExpected 80');
check(scoredFrozen80.form.itemsPerDimension === 8, 'shrink complete: itemsPerDimension 8');
check(
  scoredFrozen80.dimensions.logro_persistencia.nExpected === 8,
  'shrink complete: nExpected 8',
);

const attemptNew60 = { id: 'att-new-60', results: null };
const new60Order = resolvePersonalityPresentationOrder(attemptNew60, catalog60Only, {
  random: seededRandom(11),
});
check(new60Order.created === true, 'nuevo intento: crea orden');
check(new60Order.presentationOrder.length === 60, 'nuevo intento: 60 IDs');

let integrityThrown = false;
try {
  await resolvePersonalityAttemptForm(
    {
      question: {
        async findMany({ where }) {
          return where.id.in.slice(0, 2).map((id) => all80ById.get(id));
        },
      },
    },
    attempt80Frozen,
    catalog60Only,
  );
} catch (e) {
  integrityThrown = e.code === 'PERSONALITY_ATTEMPT_FORM_INTEGRITY';
}
check(integrityThrown, 'integridad: error si faltan questionIds en BD');

console.log('\n--- Concurrencia atómica: claimPersonalityPresentationOrder ---\n');

const orderA = buildPersonalityPresentationOrder(questions80, { random: seededRandom(1) });
const orderB = buildPersonalityPresentationOrder(questions80, { random: seededRandom(2) });
check(JSON.stringify(orderA) !== JSON.stringify(orderB), 'race: órdenes candidatos distintos');

let persistedResults = null;
let txMutex = Promise.resolve();

function createSerializedForUpdateMockDb() {
  return {
    async $transaction(fn) {
      const prev = txMutex;
      let unlock;
      txMutex = new Promise((resolve) => {
        unlock = resolve;
      });
      await prev;
      try {
        const tx = {
          async $queryRaw() {
            return [{ results: persistedResults }];
          },
          assessmentAttempt: {
            async update({ data }) {
              const existing = readPersonalityPresentationOrder({ results: persistedResults });
              if (existing?.length) return;
              persistedResults = data.results;
            },
          },
        };
        return await fn(tx);
      } finally {
        unlock();
      }
    },
  };
}

const raceDb = createSerializedForUpdateMockDb();
const attemptId = 'att-race-atomic';

const [claim1, claim2] = await Promise.all([
  claimPersonalityPresentationOrder(raceDb, attemptId, orderA),
  claimPersonalityPresentationOrder(raceDb, attemptId, orderB),
]);

check(claim1.presentationOrder.length === 80, 'race: claim1 devuelve 80 ids');
check(claim2.presentationOrder.length === 80, 'race: claim2 devuelve 80 ids');
check(
  JSON.stringify(claim1.presentationOrder) === JSON.stringify(claim2.presentationOrder),
  'race: ambos callers mismo orden canónico',
);
const persistedOrder = readPersonalityPresentationOrder({ results: persistedResults });
check(
  JSON.stringify(persistedOrder) === JSON.stringify(claim1.presentationOrder),
  'race: BD coincide con orden canónico',
);
check(claim1.claimed !== claim2.claimed, 'race: exactamente uno claimed, uno reutilizó');
check(!claim1.claimed || !claim2.claimed, 'race: no ambos claimed');

const claim3 = await claimPersonalityPresentationOrder(raceDb, attemptId, orderB);
check(
  JSON.stringify(claim3.presentationOrder) === JSON.stringify(claim1.presentationOrder),
  'race: tercer claim no sobrescribe',
);
check(claim3.claimed === false, 'race: tercer claim no claimed');

console.log('\n--- Resume (orden + respuestas parciales) ---\n');

const partialIds = new Set(resolved.presentationOrder.slice(0, 12));
const answeredAfterPartial = resolved.presentationOrder.filter((id) => partialIds.has(id));
check(answeredAfterPartial.length === 12, 'parcial: 12 respondidas simuladas');

const resumeOrder = resolvePersonalityPresentationOrder(attemptStored, questions80);
check(
  resumeOrder.presentationOrder.every((id, i) => id === resolved.presentationOrder[i]),
  'resume: orden idéntico posición a posición',
);
check(
  resumeOrder.presentationOrder.every((id) => questions80.some((q) => q.id === id)),
  'resume: mismos questionIds del formulario',
);

console.log(
  failed === 0
    ? '\n✓ Personalidad Mind24 dynamic — OK.\n'
    : `\n✗ ${failed} fallo(s).\n`,
);
process.exit(failed === 0 ? 0 : 1);

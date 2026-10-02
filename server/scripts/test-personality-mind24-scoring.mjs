/**
 * Regresión — scoring Personalidad Mind24 (fixtures sintéticos).
 * Ejecutar: node server/scripts/test-personality-mind24-scoring.mjs
 */
import {
  PERSONALIDAD_MIND24_DIMENSIONS,
  PERSONALIDAD_MIND24_SCALE,
} from '../src/data/personalityMind24Data.js';
import {
  assertNoForbiddenScoreFields,
  buildPersonalityApplicationQualityMeta,
  buildPersonalityMind24AttemptScores,
  buildPersonalityObservedTimingMeta,
  computePersonalityMind24Completeness,
  keyedPersonalityResponse,
  scorePersonalityMind24Responses,
} from '../src/services/personalityMind24Scoring.service.js';

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function row({ questionId, dimensionId, direction, rawValue }) {
  const sortOrder = rawValue - 1;
  return {
    questionId: questionId || `q-${dimensionId}-${rawValue}`,
    question: {
      metadata: {
        personalityItemId: `pm24_${dimensionId}_${rawValue}`,
        dimensionId,
        direction,
        catalogVersion: 1,
      },
    },
    selectedOption: { value: String(rawValue), sortOrder },
  };
}

console.log('\n=== Personalidad Mind24 — scoring ===\n');

check(keyedPersonalityResponse(4, 'direct') === 4, 'direct: raw 4 → keyed 4');
check(keyedPersonalityResponse(5, 'direct') === 5, 'direct: raw 5 → keyed 5');
check(keyedPersonalityResponse(5, 'inverse') === 1, 'inverse: raw 5 → keyed 1');
check(keyedPersonalityResponse(1, 'inverse') === 5, 'inverse: raw 1 → keyed 5');
check(keyedPersonalityResponse(0, 'direct') === null, 'escala: 0 inválido');
check(keyedPersonalityResponse(6, 'direct') === null, 'escala: 6 inválido');

const dimId = 'logro_persistencia';
const directRows = [
  row({ dimensionId: dimId, direction: 'direct', rawValue: 5 }),
  row({ dimensionId: dimId, direction: 'direct', rawValue: 3 }),
  row({ dimensionId: dimId, direction: 'direct', rawValue: 4 }),
];
const directScored = scorePersonalityMind24Responses(directRows);
check(directScored.dimensions[dimId].mean === 4, 'medias: direct (5+3+4)/3 = 4.0');
check(directScored.dimensions[dimId].nAnswered === 3, 'nAnswered: 3');

const inverseRows = [
  row({ dimensionId: 'orden_precision', direction: 'inverse', rawValue: 5 }),
  row({ dimensionId: 'orden_precision', direction: 'inverse', rawValue: 5 }),
];
const inverseScored = scorePersonalityMind24Responses(inverseRows);
check(inverseScored.dimensions.orden_precision.mean === 1, 'inverse: mean keyed 1+1 → 1.0');

const allDimRows = [];
for (const dim of PERSONALIDAD_MIND24_DIMENSIONS) {
  allDimRows.push(row({ dimensionId: dim.dimensionId, direction: 'direct', rawValue: 3 }));
}
const allDimScored = scorePersonalityMind24Responses(allDimRows);
check(Object.keys(allDimScored.dimensions).length === 10, '10 dimensiones en output');
for (const dim of PERSONALIDAD_MIND24_DIMENSIONS) {
  check(allDimScored.dimensions[dim.dimensionId].mean === 3, `dim ${dim.dimensionId}: mean 3`);
  check(
    allDimScored.dimensions[dim.dimensionId].scaleMin === PERSONALIDAD_MIND24_SCALE.min,
    `dim ${dim.dimensionId}: scaleMin`,
  );
  check(
    allDimScored.dimensions[dim.dimensionId].scaleMax === PERSONALIDAD_MIND24_SCALE.max,
    `dim ${dim.dimensionId}: scaleMax`,
  );
}

check(allDimScored.global === undefined, 'ausencia de global en scoring');
check(allDimScored.percentScore === undefined, 'ausencia de percentScore');
check(allDimScored.percentile === undefined, 'ausencia de percentile');

const attempt = buildPersonalityMind24AttemptScores(allDimScored, {
  completeness: { expectedCount: 10, answeredCount: 10, unansweredCount: 0, completenessRate: 100 },
  reliability: { avgSecondsPerQuestion: 3.5, elapsedMs: 35000, questionCount: 10 },
});
check(attempt.instrument === 'personalidad_mind24', 'attempt instrument');
check(attempt.scores.dimensions && !('global' in attempt.scores), 'attempt scores sin global');
check(attempt.scores.meta.applicationQuality?.completeness?.answeredCount === 10, 'applicationQuality completitud');
check(
  attempt.scores.meta.applicationQuality?.reliability?.avgSecondsPerQuestion === 3.5,
  'tiempo: avgSecondsPerQuestion',
);
check(attempt.scores.meta.applicationQuality?.reliability?.elapsedMs === 35000, 'tiempo: elapsedMs');
check(attempt.scores.meta.applicationQuality?.reliability?.questionCount === 10, 'tiempo: questionCount');
check(
  attempt.scores.meta.applicationQuality?.reliability?.isUnreliableSpeed === undefined,
  'sin isUnreliableSpeed en persistencia',
);
check(allDimScored.dimensions.logro_persistencia.mean === 3, 'scoring sin impacto por metadatos de tiempo');

try {
  assertNoForbiddenScoreFields(attempt.scores);
  check(true, 'assertNoForbiddenScoreFields pasa');
} catch (e) {
  check(false, `assertNoForbiddenScoreFields: ${e.message}`);
}

const completeness = computePersonalityMind24Completeness(['a', 'b', 'c'], [
  { questionId: 'a' },
  { questionId: 'c' },
]);
check(completeness.answeredCount === 2, 'completitud: 2/3');
check(completeness.completenessRate === 66.7, 'completitud rate 66.7%');

const aq = buildPersonalityApplicationQualityMeta(
  { isUnreliableSpeed: true, avgSecondsPerQuestion: 0.5, elapsedMs: 1000, questionCount: 2 },
  completeness,
);
check(aq.reliability.avgSecondsPerQuestion === 0.5, 'timing: ignora clasificación, conserva avg');
check(aq.reliability.isUnreliableSpeed === undefined, 'timing: no propaga isUnreliableSpeed');
check(
  buildPersonalityObservedTimingMeta({ isUnreliableSpeed: true, speedReliability: 'invalid' })
      ?.speedReliability === undefined,
  'timing: sin verdicts de velocidad',
);

console.log(
  failed === 0
    ? '\n✓ Personalidad Mind24 scoring — todos los escenarios pasaron.\n'
    : `\n✗ ${failed} fallo(s).\n`,
);
process.exit(failed === 0 ? 0 : 1);

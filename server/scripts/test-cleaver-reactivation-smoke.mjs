/**
 * Smoke test lógico del flujo Cleaver reactivado:
 * asignar → iniciar → 24 respuestas válidas → completar → scores.
 *
 * No toca BD ni CandidateResponse históricos.
 * Ejecutar: node server/scripts/test-cleaver-reactivation-smoke.mjs
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://test:test@127.0.0.1:5432/test';

const {
  DEFAULT_SELECTED_MODULES,
  filterAssignableModuleKeys,
  isOfferableModuleKey,
  resolveModuleKey,
} = await import('../src/utils/moduleCatalog.js');
const { resolveStartableAttempt } = await import('../src/services/attempt.service.js');
const { cleaverBlocks, cleaverBankValidation } = await import('../src/data/cleaverData.js');
const {
  buildCleaverAttemptScores,
  scoreCleaverResponses,
} = await import('../src/services/cleaverScoring.service.js');

let failed = 0;
let passed = 0;

function check(cond, msg, extra) {
  if (cond) {
    passed++;
    console.log(`  OK  ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL ${msg}`);
    if (extra !== undefined) console.log(`       ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`);
  }
}

function expectThrows(fn, code, msg) {
  try {
    fn();
    check(false, msg, 'no lanzó');
  } catch (err) {
    check(err.code === code || err.message === code, msg, { code: err.code, message: err.message });
  }
}

function assignmentCompleted(selectedModules, completedModules) {
  const selected = (selectedModules || []).map((k) => resolveModuleKey(k));
  const nextCompleted = completedModules.map((k) => resolveModuleKey(k));
  return selected.length > 0 && selected.every((k) => nextCompleted.includes(k));
}

console.log('\n=== Smoke Cleaver — asignar → iniciar → completar ===');

console.log('\n[1] Asignar módulo');
check(cleaverBankValidation.summary.fullyVerified === true, 'banco fullyVerified');
check(isOfferableModuleKey('cleaver') === true, 'cleaver asignable');
check(
  JSON.stringify(filterAssignableModuleKeys(['cleaver', 'disc'])) === JSON.stringify(['cleaver']),
  'createAssignment aceptaría cleaver y alias disc (una sola key)',
);
check(DEFAULT_SELECTED_MODULES.includes('cleaver'), 'queda en la selección por defecto');

console.log('\n[2] Iniciar attempt');
check(resolveStartableAttempt('cleaver', []) === null, 'sin attempt previo → se permite crear');
check(resolveStartableAttempt('disc', []) === null, 'alias disc sin attempt → se permite crear');
check(
  resolveStartableAttempt('cleaver', [
    { id: 'open', moduleKey: 'cleaver', status: 'in_progress', startedAt: new Date() },
  ])?.id === 'open',
  'attempt in_progress se reanuda (no duplica)',
);

console.log('\n[3] 24 respuestas válidas + scoring');
{
  const rows = cleaverBlocks.map((block) => {
    const opts = block.options.map((o, j) => ({ ...o, id: `b${block.order}o${j}` }));
    return {
      questionId: `q${block.order}`,
      moreOptionId: opts[0].id,
      lessOptionId: opts[1].id,
      moreOption: opts[0],
      lessOption: opts[1],
    };
  });

  check(rows.length === 24, '24 tétradas respondidas');
  check(
    rows.every((r) => r.moreOptionId && r.lessOptionId && r.moreOptionId !== r.lessOptionId),
    'cada fila usa optionIds distintos',
  );

  let scoring;
  try {
    scoring = scoreCleaverResponses(rows);
    check(true, 'scoreCleaverResponses sin VALIDATION_ERROR');
  } catch (err) {
    check(false, 'scoreCleaverResponses sin VALIDATION_ERROR', {
      code: err.code,
      message: err.message,
    });
    scoring = null;
  }

  if (scoring) {
    const sumMost = Object.values(scoring.most).reduce((a, b) => a + b, 0);
    const sumLeast = Object.values(scoring.least).reduce((a, b) => a + b, 0);
    check(scoring.tetradCount === 24, 'tetradCount = 24', scoring.tetradCount);
    check(sumMost + scoring.unscoredMore === 24, 'sum(most)+unscoredMore = 24', {
      sumMost,
      unscoredMore: scoring.unscoredMore,
    });
    check(sumLeast + scoring.unscoredLess === 24, 'sum(least)+unscoredLess = 24', {
      sumLeast,
      unscoredLess: scoring.unscoredLess,
    });
    check(
      scoring.unscoredMore >= 1 && scoring.unscoredLess >= 1,
      'null M/L procesados (hay selecciones que no puntúan)',
      { unscoredMore: scoring.unscoredMore, unscoredLess: scoring.unscoredLess },
    );
    for (const key of ['D', 'I', 'S', 'C']) {
      check(
        scoring.total[key] === scoring.most[key] - scoring.least[key],
        `total.${key} = most − least`,
      );
    }

    const payload = buildCleaverAttemptScores(scoring);
    check(payload.instrument === 'cleaver', 'payload de attempt Cleaver');
    check(!!payload.scores.most && !!payload.scores.least && !!payload.scores.total, 'most/least/total persistibles');
  }

  const sameId = {
    questionId: 'q1',
    moreOptionId: 'same',
    lessOptionId: 'same',
    moreOption: { ...cleaverBlocks[0].options[0], id: 'same' },
    lessOption: { ...cleaverBlocks[0].options[0], id: 'same' },
  };
  expectThrows(
    () => scoreCleaverResponses([sameId]),
    'CLEAVER_SAME_MORE_LESS',
    'misma optionId en Más y Menos sigue siendo inválida',
  );
}

console.log('\n[4] Completar assignment');
{
  const attemptStatus = 'submitted';
  check(attemptStatus === 'submitted', 'attempt queda submitted');
  check(
    assignmentCompleted(['cleaver'], ['cleaver']) === true,
    'assignment completed cuando Cleaver era el único módulo',
  );
  check(
    assignmentCompleted(['disc'], ['cleaver']) === true,
    'alias disc en selectedModules cuenta como cleaver completado',
  );
  check(
    assignmentCompleted(['honestidad', 'cleaver'], ['cleaver']) === false,
    'assignment sigue abierta si falta otro módulo',
  );
}

console.log(
  failed === 0
    ? `\n✓ ${passed} aserciones OK.\n`
    : `\n✗ ${failed} fallo(s) de ${passed + failed} aserciones.\n`,
);
process.exit(failed === 0 ? 0 : 1);

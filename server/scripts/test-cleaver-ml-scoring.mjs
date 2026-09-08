/**
 * Regresiones del scoring Cleaver M/L y de la validación estructural del banco.
 * Ejecutar: node server/scripts/test-cleaver-ml-scoring.mjs
 */
import {
  CLEAVER_KEY_SCHEMA,
  CLEAVER_KEY_STATUS,
  CLEAVER_ML_KEY,
} from '../src/data/cleaverDiscKey.js';
import {
  CLEAVER_TETRAD_COUNT,
  cleaverBankValidation,
  cleaverBlockByOrder,
  cleaverBlocks,
  cleaverOptionMetadataEquals,
} from '../src/data/cleaverData.js';
import { validateCleaverBank } from '../src/data/cleaverBankValidation.js';
import {
  CLEAVER_KEY_SOURCE,
  resolveOptionDimension,
  scoreCleaverResponses,
} from '../src/services/cleaverScoring.service.js';

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

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function expectThrows(fn, expectedMessage, msg) {
  try {
    fn();
  } catch (err) {
    if (expectedMessage && err.message !== expectedMessage) {
      fail(msg, `esperaba "${expectedMessage}", recibió "${err.message}"`);
      return null;
    }
    ok(msg);
    return err;
  }
  fail(msg, 'no lanzó');
  return null;
}

/** Opción sintética con esquema M/L. */
function mlOption(id, dimensionMore, dimensionLess, extra = {}) {
  const metadata = {
    keySchema: CLEAVER_KEY_SCHEMA,
    keyStatus: CLEAVER_KEY_STATUS.VERIFIED,
    dimensionMore,
    dimensionLess,
    ...extra,
  };
  return { id, label: id, value: '', metadata };
}

/** Opción heredada (banco no sincronizado todavía). */
function legacyOption(id, dimension) {
  return { id, label: id, value: dimension, metadata: { dimension } };
}

function row(questionId, moreOption, lessOption) {
  return {
    questionId,
    moreOptionId: moreOption?.id ?? null,
    lessOptionId: lessOption?.id ?? null,
    moreOption,
    lessOption,
  };
}

console.log('\n=== Cleaver M/L — scoring y estructura del banco ===');

// ---------------------------------------------------------------- dimensionMore
console.log('\n[1] dimensionMore se usa para la selección MÁS');
{
  const asym = mlOption('asym', 'D', 'C');
  const more = resolveOptionDimension(asym, 'more');
  const less = resolveOptionDimension(asym, 'less');
  check(more.dimension === 'D', 'MÁS lee dimensionMore', more);
  check(less.dimension === 'C', 'MENOS lee dimensionLess', less);
  check(more.source === CLEAVER_KEY_SOURCE.ML, 'source = ml_v1', more);

  const scoring = scoreCleaverResponses([row('q1', mlOption('a', 'D', 'S'), mlOption('b', 'I', 'C'))]);
  check(deepEqual(scoring.most, { D: 1, I: 0, S: 0, C: 0 }), 'most usa la clave MÁS', scoring.most);
  check(deepEqual(scoring.least, { D: 0, I: 0, S: 0, C: 1 }), 'least usa la clave MENOS', scoring.least);
  check(deepEqual(scoring.total, { D: 1, I: 0, S: 0, C: -1 }), 'total = most − least', scoring.total);
}

// ------------------------------------------------------------------ null en MÁS
console.log('\n[2] null en MÁS: respuesta válida que no puntúa');
{
  const scoring = scoreCleaverResponses([row('q1', mlOption('a', null, 'S'), mlOption('b', 'I', 'I'))]);
  check(deepEqual(scoring.most, { D: 0, I: 0, S: 0, C: 0 }), 'no incrementa ninguna escala en most', scoring.most);
  check(deepEqual(scoring.least, { D: 0, I: 1, S: 0, C: 0 }), 'least sigue puntuando', scoring.least);
  check(scoring.unscoredMore === 1, 'unscoredMore = 1', scoring.unscoredMore);
  check(scoring.unscoredLess === 0, 'unscoredLess = 0', scoring.unscoredLess);
  check(scoring.tetradCount === 1, 'la tétrada cuenta como respondida', scoring.tetradCount);
}

// ---------------------------------------------------------------- null en MENOS
console.log('\n[3] null en MENOS: respuesta válida que no puntúa');
{
  const scoring = scoreCleaverResponses([row('q1', mlOption('a', 'D', 'D'), mlOption('b', 'I', null))]);
  check(deepEqual(scoring.most, { D: 1, I: 0, S: 0, C: 0 }), 'most puntúa normal', scoring.most);
  check(deepEqual(scoring.least, { D: 0, I: 0, S: 0, C: 0 }), 'least no incrementa', scoring.least);
  check(scoring.unscoredLess === 1, 'unscoredLess = 1', scoring.unscoredLess);
  check(deepEqual(scoring.total, { D: 1, I: 0, S: 0, C: 0 }), 'total refleja solo lo puntuado', scoring.total);
}

// ------------------------------------------------------------- metadata inválida
console.log('\n[4] metadata inválida → error; null nunca es error');
{
  expectThrows(
    () => resolveOptionDimension(mlOption('bad', 'X', 'S'), 'more'),
    'CLEAVER_SCORING_INVALID_METADATA',
    'dimensión fuera de D/I/S/C',
  );
  expectThrows(
    () => resolveOptionDimension({ id: 'x', metadata: { keySchema: CLEAVER_KEY_SCHEMA, keyStatus: CLEAVER_KEY_STATUS.VERIFIED, dimensionLess: 'S' } }, 'more'),
    'CLEAVER_SCORING_INVALID_METADATA',
    'falta dimensionMore con keySchema ml_v1',
  );
  expectThrows(
    () => resolveOptionDimension({ id: 'x', metadata: {} }, 'more'),
    'CLEAVER_SCORING_MISSING_DIMENSION',
    'metadata vacía sin clave heredada',
  );
  expectThrows(
    () => resolveOptionDimension(null, 'more'),
    'CLEAVER_SCORING_MISSING_OPTION',
    'opción ausente',
  );
  expectThrows(
    () => resolveOptionDimension(mlOption('a', 'D', 'S'), 'other'),
    'CLEAVER_SCORING_INVALID_ROLE',
    'rol inválido',
  );

  const err = expectThrows(
    () => scoreCleaverResponses([row('q7', mlOption('a', 'ZZ', 'S'), mlOption('b', 'I', 'C'))]),
    'CLEAVER_SCORING_INVALID_METADATA',
    'el scorer propaga metadata inválida',
  );
  check(err?.code === 'VALIDATION_ERROR', 'error con code VALIDATION_ERROR', err?.code);
  check(err?.details?.questionId === 'q7', 'error incluye questionId', err?.details);

  const withNulls = scoreCleaverResponses([row('q1', mlOption('a', null, 'S'), mlOption('b', 'I', null))]);
  check(withNulls.tetradCount === 1, 'null no convierte la fila en error', withNulls);

  expectThrows(
    () => scoreCleaverResponses([row('q1', mlOption('same', 'D', 'S'), mlOption('same', 'D', 'S'))]),
    'CLEAVER_SAME_MORE_LESS',
    'misma opción en MÁS y MENOS sigue rechazada',
  );
  expectThrows(
    () => scoreCleaverResponses([row('q1', mlOption('a', 'D', 'S'), null)]),
    'CLEAVER_SCORING_MISSING_OPTION',
    'fila sin lessOption',
  );
}

// ------------------------------------------------------------------- regla legacy
console.log('\n[5] la regla artificial "moreDim ≠ lessDim" ya no aplica');
{
  const scoring = scoreCleaverResponses([row('q1', mlOption('a', 'S', 'S'), mlOption('b', 'S', 'S'))]);
  check(deepEqual(scoring.most, { D: 0, I: 0, S: 1, C: 0 }), 'dos palabras con la misma escala puntúan', scoring.most);
  check(deepEqual(scoring.least, { D: 0, I: 0, S: 1, C: 0 }), 'least también', scoring.least);
  check(deepEqual(scoring.total, { D: 0, I: 0, S: 0, C: 0 }), 'total neutro', scoring.total);
}

// ------------------------------------------------------------- compatibilidad
console.log('\n[6] filas heredadas (banco sin sincronizar) siguen puntuando');
{
  const more = resolveOptionDimension(legacyOption('l1', 'D'), 'more');
  const less = resolveOptionDimension(legacyOption('l2', 'C'), 'less');
  check(more.source === CLEAVER_KEY_SOURCE.LEGACY, 'source = legacy_single', more);
  check(more.dimension === 'D' && less.dimension === 'C', 'dimensión heredada resuelta', { more, less });

  const fromValue = resolveOptionDimension({ id: 'v', value: 'i', metadata: null }, 'more');
  check(fromValue.dimension === 'I', 'fallback a column value (normalizado)', fromValue);

  const scoring = scoreCleaverResponses([row('q1', legacyOption('a', 'D'), legacyOption('b', 'S'))]);
  check(deepEqual(scoring.keySources, [CLEAVER_KEY_SOURCE.LEGACY]), 'keySources reporta legacy_single', scoring.keySources);
}

// ---------------------------------------------------------------------- bloque 18
console.log('\n[7] bloque 18 con clave M/L verificada');
{
  const block = cleaverBlockByOrder(18);
  const expected = {
    Conforme: { dimensionMore: null, dimensionLess: 'S' },
    Confiable: { dimensionMore: 'I', dimensionLess: 'I' },
    Pacífico: { dimensionMore: 'C', dimensionLess: 'C' },
    Positivo: { dimensionMore: 'D', dimensionLess: 'D' },
  };

  check(block?.options.length === 4, 'bloque 18 tiene 4 opciones', block?.options?.length);
  for (const option of block?.options ?? []) {
    const exp = expected[option.text];
    check(
      !!exp &&
        option.metadata.dimensionMore === exp.dimensionMore &&
        option.metadata.dimensionLess === exp.dimensionLess,
      `bloque 18 · ${option.text} = M:${JSON.stringify(exp?.dimensionMore)} / L:${JSON.stringify(exp?.dimensionLess)}`,
      option.metadata,
    );
    check(
      option.metadata.keyStatus === CLEAVER_KEY_STATUS.VERIFIED,
      `bloque 18 · ${option.text} marcado verified_ml`,
      option.metadata.keyStatus,
    );
  }

  const conforme = block.options.find((o) => o.text === 'Conforme');
  check(
    !Object.prototype.hasOwnProperty.call(conforme.metadata, 'dimension') && conforme.value === '',
    'Conforme no expone dimension simétrica ni value DISC',
    conforme,
  );

  const byText = new Map(block.options.map((o) => [o.text, { ...o, id: o.text }]));
  const pairs = [
    ['Conforme', 'Confiable', { most: { D: 0, I: 0, S: 0, C: 0 }, least: { D: 0, I: 1, S: 0, C: 0 } }],
    ['Confiable', 'Conforme', { most: { D: 0, I: 1, S: 0, C: 0 }, least: { D: 0, I: 0, S: 1, C: 0 } }],
    ['Positivo', 'Pacífico', { most: { D: 1, I: 0, S: 0, C: 0 }, least: { D: 0, I: 0, S: 0, C: 1 } }],
  ];
  for (const [moreText, lessText, exp] of pairs) {
    const scoring = scoreCleaverResponses([row('q18', byText.get(moreText), byText.get(lessText))]);
    check(
      deepEqual(scoring.most, exp.most) && deepEqual(scoring.least, exp.least),
      `bloque 18 · MÁS=${moreText} / MENOS=${lessText} puntúa sin error`,
      { most: scoring.most, least: scoring.least },
    );
  }

  check(
    Object.keys(CLEAVER_ML_KEY).length === 1 && Object.prototype.hasOwnProperty.call(CLEAVER_ML_KEY, '18'),
    'solo el bloque 18 tiene clave M/L verificada (no se inventaron los otros 23)',
    Object.keys(CLEAVER_ML_KEY),
  );
}

// ------------------------------------------------------------------ determinismo
console.log('\n[8] scoring determinista y reproducible');
{
  const bank = cleaverBlocks.map((block, i) => {
    const opts = block.options.map((o, j) => ({ ...o, id: `b${block.order}o${j}` }));
    return row(`q${block.order}`, opts[i % 4], opts[(i + 1) % 4]);
  });

  const first = scoreCleaverResponses(bank);
  const second = scoreCleaverResponses(bank);
  check(deepEqual(first, second), 'dos ejecuciones idénticas dan el mismo resultado');

  const shuffled = [...bank].reverse();
  const reversed = scoreCleaverResponses(shuffled);
  check(
    deepEqual(first.most, reversed.most) &&
      deepEqual(first.least, reversed.least) &&
      deepEqual(first.total, reversed.total),
    'los conteos no dependen del orden de las filas',
  );

  check(first.tetradCount === CLEAVER_TETRAD_COUNT, '24 tétradas procesadas', first.tetradCount);

  const scoredMost = Object.values(first.most).reduce((a, b) => a + b, 0);
  check(
    scoredMost + first.unscoredMore === CLEAVER_TETRAD_COUNT,
    'most + unscoredMore = 24 (contabilidad completa)',
    { scoredMost, unscoredMore: first.unscoredMore },
  );

  const scoredLeast = Object.values(first.least).reduce((a, b) => a + b, 0);
  check(
    scoredLeast + first.unscoredLess === CLEAVER_TETRAD_COUNT,
    'least + unscoredLess = 24',
    { scoredLeast, unscoredLess: first.unscoredLess },
  );

  check(scoreCleaverResponses([]).tetradCount === 0, 'banco vacío no rompe el scorer');
}

// ------------------------------------------------- validación estructural banco
console.log('\n[9] validación estructural del banco');
{
  check(cleaverBankValidation.ok, 'banco canónico válido', cleaverBankValidation.errors);
  check(
    cleaverBankValidation.summary.blocks === CLEAVER_TETRAD_COUNT &&
      cleaverBankValidation.summary.options === CLEAVER_TETRAD_COUNT * 4,
    '24 tétradas · 96 opciones',
    cleaverBankValidation.summary,
  );
  check(
    deepEqual(cleaverBankValidation.summary.verifiedBlocks, [18]),
    'bloque verificado = [18]',
    cleaverBankValidation.summary.verifiedBlocks,
  );
  check(
    cleaverBankValidation.summary.pendingCount === 23,
    '23 bloques pendientes de verificación M/L',
    cleaverBankValidation.summary.pendingCount,
  );
  check(
    cleaverBankValidation.summary.fullyVerified === false,
    'fullyVerified = false mientras falten claves',
    cleaverBankValidation.summary.fullyVerified,
  );

  const clone = () => JSON.parse(JSON.stringify(cleaverBlocks));

  const badDim = clone();
  badDim[0].options[0].metadata.dimensionMore = 'X';
  check(!validateCleaverBank(badDim).ok, 'rechaza dimensión fuera de D/I/S/C/null');

  const bothNull = clone();
  bothNull[0].options[0].metadata.dimensionMore = null;
  bothNull[0].options[0].metadata.dimensionLess = null;
  check(!validateCleaverBank(bothNull).ok, 'rechaza dimensionMore y dimensionLess ambos null');

  const missingField = clone();
  delete missingField[0].options[0].metadata.dimensionLess;
  check(!validateCleaverBank(missingField).ok, 'rechaza metadata M/L incompleta');

  const badSchema = clone();
  badSchema[0].options[0].metadata.keySchema = 'v0';
  check(!validateCleaverBank(badSchema).ok, 'rechaza keySchema desconocido');

  const badStatus = clone();
  badStatus[0].options[0].metadata.keyStatus = 'whatever';
  check(!validateCleaverBank(badStatus).ok, 'rechaza keyStatus desconocido');

  const shortTetrad = clone();
  shortTetrad[0].options.pop();
  check(!validateCleaverBank(shortTetrad).ok, 'rechaza tétrada incompleta');

  const dupLabel = clone();
  dupLabel[0].options[1].text = dupLabel[0].options[0].text;
  check(!validateCleaverBank(dupLabel).ok, 'rechaza texto duplicado en la tétrada');

  const missingBlock = clone().slice(0, 23);
  check(!validateCleaverBank(missingBlock).ok, 'rechaza banco con menos de 24 tétradas');

  const dupOrder = clone();
  dupOrder[1].order = dupOrder[0].order;
  check(!validateCleaverBank(dupOrder).ok, 'rechaza order duplicado');

  const asymmetricWithDimension = clone();
  asymmetricWithDimension[0].options[0].metadata.dimensionLess = 'C';
  check(
    !validateCleaverBank(asymmetricWithDimension).ok,
    'rechaza `dimension` espejo cuando M ≠ L',
  );

  const mixedStatus = clone();
  mixedStatus[0].options[0].metadata.keyStatus = CLEAVER_KEY_STATUS.VERIFIED;
  check(!validateCleaverBank(mixedStatus).ok, 'rechaza keyStatus mixto dentro de una tétrada');

  check(!validateCleaverBank(null).ok, 'rechaza entrada no-array');
}

// -------------------------------------------------------- comparación de metadata
console.log('\n[10] comparación de metadata para sync idempotente');
{
  const canonical = cleaverBlockByOrder(1).options[0].metadata;
  check(cleaverOptionMetadataEquals({ ...canonical }, canonical), 'metadata idéntica → sin cambio');
  check(
    cleaverOptionMetadataEquals(
      {
        dimension: canonical.dimension,
        dimensionLess: canonical.dimensionLess,
        dimensionMore: canonical.dimensionMore,
        keyStatus: canonical.keyStatus,
        keySchema: canonical.keySchema,
      },
      canonical,
    ),
    'el orden de las claves no importa',
  );
  check(!cleaverOptionMetadataEquals({ ...canonical, dimensionMore: 'X' }, canonical), 'detecta dimensión distinta');
  check(!cleaverOptionMetadataEquals({ dimension: canonical.dimension }, canonical), 'detecta metadata legacy');
  check(!cleaverOptionMetadataEquals(null, canonical), 'detecta metadata ausente');

  const conforme = cleaverBlockByOrder(18).options.find((o) => o.text === 'Conforme');
  check(
    !cleaverOptionMetadataEquals({ ...conforme.metadata, dimension: 'S' }, conforme.metadata),
    'detecta `dimension` sobrante en clave asimétrica',
  );
}

console.log(
  failed === 0
    ? `\n✓ ${passed} aserciones OK.\n`
    : `\n✗ ${failed} fallo(s) de ${passed + failed} aserciones.\n`,
);
process.exit(failed === 0 ? 0 : 1);

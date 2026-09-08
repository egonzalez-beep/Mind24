/**
 * Regresiones del scoring Cleaver M/L y de la validación estructural del banco.
 * Ejecutar: node server/scripts/test-cleaver-ml-scoring.mjs
 */
import {
  CLEAVER_DISC_KEYS,
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

/**
 * Matriz canónica 192/192 congelada. Cualquier cambio accidental en
 * CLEAVER_ML_KEY o en el banco construido debe fallar aquí.
 * Formato: [bloque, palabra, dimensionMore, dimensionLess]
 */
const CANONICAL_ML_MATRIX = [
  [1, 'Persuasivo', 'I', null],
  [1, 'Gentil', 'S', 'S'],
  [1, 'Humilde', 'C', 'C'],
  [1, 'Original', null, 'D'],
  [2, 'Agresivo', 'D', null],
  [2, 'Alma de la fiesta', 'I', 'I'],
  [2, 'Comodino', 'S', 'S'],
  [2, 'Temeroso', null, 'C'],
  [3, 'Agradable', null, 'S'],
  [3, 'Temeroso de Dios', 'C', 'C'],
  [3, 'Tenaz', 'D', 'D'],
  [3, 'Atractivo', 'I', 'I'],
  [4, 'Cauteloso', 'C', 'C'],
  [4, 'Determinado', 'D', null],
  [4, 'Convincente', 'I', 'I'],
  [4, 'Bonachón', 'S', null],
  [5, 'Dócil', null, 'C'],
  [5, 'Atrevido', 'D', 'D'],
  [5, 'Leal', 'S', null],
  [5, 'Encantador', 'I', 'I'],
  [6, 'Dispuesto', 'S', null],
  [6, 'Deseoso', null, null],
  [6, 'Consecuente', 'C', 'C'],
  [6, 'Entusiasta', null, 'D'],
  [7, 'Fuerza de voluntad', null, 'D'],
  [7, 'Mente abierta', 'C', null],
  [7, 'Complaciente', 'S', 'S'],
  [7, 'Animoso', 'I', 'I'],
  [8, 'Confiado', 'I', null],
  [8, 'Simpatizador', null, 'S'],
  [8, 'Tolerante', null, 'C'],
  [8, 'Afirmativo', 'D', 'D'],
  [9, 'Ecuánime', 'S', 'S'],
  [9, 'Preciso', 'C', 'C'],
  [9, 'Nervioso', null, 'D'],
  [9, 'Jovial', null, 'I'],
  [10, 'Disciplinado', 'C', null],
  [10, 'Generoso', 'S', 'S'],
  [10, 'Animoso', null, 'I'],
  [10, 'Persistente', 'D', 'D'],
  [11, 'Competitivo', 'D', 'D'],
  [11, 'Alegre', null, 'I'],
  [11, 'Considerado', 'S', 'S'],
  [11, 'Armonioso', null, 'C'],
  [12, 'Admirable', 'I', null],
  [12, 'Bondadoso', 'S', null],
  [12, 'Resignado', null, 'C'],
  [12, 'Carácter firme', 'D', 'D'],
  [13, 'Obediente', 'S', null],
  [13, 'Quisquilloso', null, 'C'],
  [13, 'Inconquistable', 'D', 'D'],
  [13, 'Juguetón', 'I', 'I'],
  [14, 'Respetuoso', 'C', null],
  [14, 'Emprendedor', 'D', 'D'],
  [14, 'Optimista', 'I', 'I'],
  [14, 'Servicial', 'S', 'S'],
  [15, 'Valiente', 'D', null],
  [15, 'Inspirador', 'I', null],
  [15, 'Sumiso', null, 'S'],
  [15, 'Tímido', null, 'C'],
  [16, 'Adaptable', 'C', null],
  [16, 'Disputador', 'D', 'D'],
  [16, 'Indiferente', null, 'S'],
  [16, 'Sangre liviana', 'I', 'I'],
  [17, 'Amiguero', 'I', 'I'],
  [17, 'Paciente', 'S', 'S'],
  [17, 'Confianza en sí mismo', 'D', 'D'],
  [17, 'Mesurado para hablar', 'C', null],
  [18, 'Conforme', null, 'S'],
  [18, 'Confiable', 'S', 'I'],
  [18, 'Pacífico', 'C', 'C'],
  [18, 'Positivo', 'D', 'D'],
  [19, 'Aventurero', 'D', 'D'],
  [19, 'Receptivo', 'C', null],
  [19, 'Cordial', null, 'I'],
  [19, 'Moderado', 'S', 'S'],
  [20, 'Indulgente', 'S', 'S'],
  [20, 'Esteta', null, 'C'],
  [20, 'Vigoroso', 'D', 'D'],
  [20, 'Sociable', 'I', 'I'],
  [21, 'Parlanchín', 'I', 'I'],
  [21, 'Controlado', 'S', 'S'],
  [21, 'Convencional', null, 'C'],
  [21, 'Decisivo', 'D', 'D'],
  [22, 'Cohibido', null, 'S'],
  [22, 'Exacto', 'C', null],
  [22, 'Franco', 'D', 'D'],
  [22, 'Buen compañero', 'I', 'I'],
  [23, 'Diplomático', 'C', null],
  [23, 'Audaz', 'D', 'D'],
  [23, 'Refinado', null, 'I'],
  [23, 'Satisfecho', 'S', 'S'],
  [24, 'Inquieto', 'D', 'D'],
  [24, 'Popular', 'I', 'I'],
  [24, 'Buen vecino', 'S', 'S'],
  [24, 'Devoto', 'C', 'C'],
];

/** Mapeo heredado de una dimensión por adjetivo. Solo para medir el delta; no puntúa. */
const CLEAVER_LEGACY_DIMENSIONS = {
  Persuasivo: 'I', Gentil: 'S', Humilde: 'C', Original: 'D', Agresivo: 'D',
  'Alma de la fiesta': 'I', Comodino: 'S', Temeroso: 'C', Agradable: 'S',
  'Temeroso de Dios': 'C', Tenaz: 'D', Atractivo: 'I', Cauteloso: 'C',
  Determinado: 'D', Convincente: 'I', Bonachón: 'S', Dócil: 'C', Atrevido: 'D',
  Leal: 'S', Encantador: 'I', Dispuesto: 'S', Deseoso: 'I', Consecuente: 'C',
  Entusiasta: 'D', 'Fuerza de voluntad': 'D', 'Mente abierta': 'C',
  Complaciente: 'S', Animoso: 'I', Confiado: 'I', Simpatizador: 'S',
  Tolerante: 'C', Afirmativo: 'D', Ecuánime: 'S', Preciso: 'C', Nervioso: 'D',
  Jovial: 'I', Disciplinado: 'C', Generoso: 'S', Persistente: 'D',
  Competitivo: 'D', Alegre: 'I', Considerado: 'S', Armonioso: 'C',
  Admirable: 'I', Bondadoso: 'S', Resignado: 'C', 'Carácter firme': 'D',
  Obediente: 'S', Quisquilloso: 'C', Inconquistable: 'D', Juguetón: 'I',
  Respetuoso: 'C', Emprendedor: 'D', Optimista: 'I', Servicial: 'S',
  Valiente: 'D', Inspirador: 'I', Sumiso: 'S', Tímido: 'C', Adaptable: 'C',
  Disputador: 'D', Indiferente: 'S', 'Sangre liviana': 'I', Amiguero: 'I',
  Paciente: 'S', 'Confianza en sí mismo': 'D', 'Mesurado para hablar': 'C',
  Conforme: 'S', Confiable: 'S', Pacífico: 'C', Positivo: 'D', Aventurero: 'D',
  Receptivo: 'C', Cordial: 'I', Moderado: 'S', Indulgente: 'S', Esteta: 'C',
  Vigoroso: 'D', Sociable: 'I', Parlanchín: 'I', Controlado: 'S',
  Convencional: 'C', Decisivo: 'D', Cohibido: 'S', Exacto: 'C', Franco: 'D',
  'Buen compañero': 'I', Diplomático: 'C', Audaz: 'D', Refinado: 'I',
  Satisfecho: 'S', Inquieto: 'D', Popular: 'I', 'Buen vecino': 'S', Devoto: 'C',
};

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

// ---------------------------------------------------------------------- matriz 192
console.log('\n[7] matriz canónica 192/192 — cualquier celda alterada debe fallar');
{
  check(CANONICAL_ML_MATRIX.length === 96, 'la matriz congelada tiene 96 filas');
  check(Object.keys(CLEAVER_ML_KEY).length === 24, 'CLEAVER_ML_KEY declara 24 bloques', Object.keys(CLEAVER_ML_KEY));

  const seen = new Set();
  let drifted = 0;
  for (const [block, word, more, less] of CANONICAL_ML_MATRIX) {
    const key = `${block}::${word}`;
    if (seen.has(key)) fail(`fila duplicada en la matriz congelada: ${key}`);
    seen.add(key);

    const declared = CLEAVER_ML_KEY[block]?.[word];
    const bank = cleaverBlockByOrder(block)?.options.find((o) => o.text === word);
    const keyOk =
      !!declared &&
      declared.dimensionMore === more &&
      declared.dimensionLess === less;
    const bankOk =
      !!bank &&
      bank.metadata.dimensionMore === more &&
      bank.metadata.dimensionLess === less &&
      bank.metadata.keySchema === CLEAVER_KEY_SCHEMA &&
      bank.metadata.keyStatus === CLEAVER_KEY_STATUS.VERIFIED;
    if (!keyOk || !bankOk) {
      drifted++;
      fail(
        `celda ${block}/${word}: M=${JSON.stringify(more)} L=${JSON.stringify(less)}`,
        { declared, bank: bank?.metadata },
      );
    }
  }
  check(drifted === 0, `0 celdas desviadas de las 192 (96×2) — ${seen.size} palabras ancladas`);
}

console.log('\n[7b] casos de control de la clave verificada');
{
  const cell = (block, word) => {
    const opt = cleaverBlockByOrder(block).options.find((o) => o.text === word);
    return { more: opt.metadata.dimensionMore, less: opt.metadata.dimensionLess, opt };
  };

  const deseoso = cell(6, 'Deseoso');
  check(deseoso.more === null && deseoso.less === null, 'B6 Deseoso: More=null, Less=null', deseoso);

  const confiable = cell(18, 'Confiable');
  check(confiable.more === 'S' && confiable.less === 'I', 'B18 Confiable: More=S, Less=I', confiable);

  const conforme = cell(18, 'Conforme');
  check(conforme.more === null && conforme.less === 'S', 'B18 Conforme: More=null, Less=S', conforme);

  const cordial = cell(19, 'Cordial');
  check(cordial.more === null && cordial.less === 'I', 'B19 Cordial: More=null, Less=I', cordial);

  const symmetric = cell(24, 'Inquieto');
  check(symmetric.more === 'D' && symmetric.less === 'D', 'B24 Inquieto: clave simétrica D/D', symmetric);
  check(
    cleaverBlockByOrder(24).options.every(
      (o) => o.metadata.dimensionMore && o.metadata.dimensionMore === o.metadata.dimensionLess,
    ),
    'B24 es simétrico en las 4 palabras',
  );

  const nullMore = CANONICAL_ML_MATRIX.filter(([, , more]) => more === null);
  const nullLess = CANONICAL_ML_MATRIX.filter(([, , , less]) => less === null);
  check(nullMore.length === 25, `bloques con null en More: ${nullMore.length}`, nullMore.map((r) => `${r[0]}:${r[1]}`));
  check(nullLess.length === 21, `bloques con null en Less: ${nullLess.length}`, nullLess.map((r) => `${r[0]}:${r[1]}`));
  check(
    nullMore.some(([b, w]) => b === 18 && w === 'Conforme') &&
      nullMore.some(([b, w]) => b === 19 && w === 'Cordial') &&
      nullMore.some(([b, w]) => b === 6 && w === 'Deseoso'),
    'null en More incluye Conforme, Cordial y Deseoso',
  );
  check(
    nullLess.some(([b, w]) => b === 6 && w === 'Deseoso') &&
      nullLess.some(([b, w]) => b === 1 && w === 'Persuasivo'),
    'null en Less incluye Deseoso y Persuasivo',
  );

  const byText18 = new Map(
    cleaverBlockByOrder(18).options.map((o) => [o.text, { ...o, id: o.text }]),
  );
  const pairs = [
    ['Conforme', 'Confiable', { most: { D: 0, I: 0, S: 0, C: 0 }, least: { D: 0, I: 1, S: 0, C: 0 } }],
    ['Confiable', 'Conforme', { most: { D: 0, I: 0, S: 1, C: 0 }, least: { D: 0, I: 0, S: 1, C: 0 } }],
    ['Positivo', 'Pacífico', { most: { D: 1, I: 0, S: 0, C: 0 }, least: { D: 0, I: 0, S: 0, C: 1 } }],
  ];
  for (const [moreText, lessText, exp] of pairs) {
    const scoring = scoreCleaverResponses([row('q18', byText18.get(moreText), byText18.get(lessText))]);
    check(
      deepEqual(scoring.most, exp.most) && deepEqual(scoring.least, exp.least),
      `B18 · MÁS=${moreText} / MENOS=${lessText}`,
      { most: scoring.most, least: scoring.least },
    );
  }

  const byText19 = new Map(
    cleaverBlockByOrder(19).options.map((o) => [o.text, { ...o, id: o.text }]),
  );
  const cordialScoring = scoreCleaverResponses([
    row('q19', byText19.get('Cordial'), byText19.get('Aventurero')),
  ]);
  check(
    deepEqual(cordialScoring.most, { D: 0, I: 0, S: 0, C: 0 }) &&
      deepEqual(cordialScoring.least, { D: 1, I: 0, S: 0, C: 0 }) &&
      cordialScoring.unscoredMore === 1,
    'B19 Cordial como MÁS: null no suma y no es error',
    cordialScoring,
  );

  const sameScale = scoreCleaverResponses([
    row('q18', byText18.get('Confiable'), byText18.get('Conforme')),
  ]);
  check(
    sameScale.most.S === 1 && sameScale.least.S === 1,
    'misma dimensión en Más/Menos es válida cuando la clave lo determina (S/S)',
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
console.log('\n[9] validación estructural del banco — 24/24 verified_ml');
{
  const expectedVerified = Array.from({ length: CLEAVER_TETRAD_COUNT }, (_, i) => i + 1);
  check(cleaverBankValidation.ok, 'banco canónico válido', cleaverBankValidation.errors);
  check(
    cleaverBankValidation.summary.blocks === CLEAVER_TETRAD_COUNT &&
      cleaverBankValidation.summary.options === 96 &&
      cleaverBankValidation.summary.keyValues === 192,
    '24 tétradas · 96 palabras · 192 valores M/L',
    cleaverBankValidation.summary,
  );
  check(
    deepEqual(cleaverBankValidation.summary.verifiedBlocks, expectedVerified),
    'los 24 bloques están verified_ml',
    cleaverBankValidation.summary.verifiedBlocks,
  );
  check(
    cleaverBankValidation.summary.pendingCount === 0 &&
      deepEqual(cleaverBankValidation.summary.pendingBlocks, []),
    'ningún bloque queda pending_ml',
    cleaverBankValidation.summary.pendingBlocks,
  );
  check(
    cleaverBankValidation.summary.fullyVerified === true,
    'fullyVerified === true',
    cleaverBankValidation.summary.fullyVerified,
  );
  check(cleaverBankValidation.summary.nullMore === 25, '25 null en MÁS', cleaverBankValidation.summary.nullMore);
  check(cleaverBankValidation.summary.nullLess === 21, '21 null en MENOS', cleaverBankValidation.summary.nullLess);

  const clone = () => JSON.parse(JSON.stringify(cleaverBlocks));

  const badDim = clone();
  badDim[0].options[0].metadata.dimensionMore = 'X';
  check(!validateCleaverBank(badDim).ok, 'rechaza dimensión fuera de D/I/S/C/null');

  const bothNull = clone();
  bothNull[0].options[0].metadata.dimensionMore = null;
  bothNull[0].options[0].metadata.dimensionLess = null;
  delete bothNull[0].options[0].metadata.dimension;
  bothNull[0].options[0].value = '';
  check(validateCleaverBank(bothNull).ok, 'ambos null es válido (el instrumento lo usa en Deseoso)');

  const missingField = clone();
  delete missingField[0].options[0].metadata.dimensionLess;
  check(!validateCleaverBank(missingField).ok, 'rechaza metadata M/L incompleta');

  const badSchema = clone();
  badSchema[0].options[0].metadata.keySchema = 'v0';
  check(!validateCleaverBank(badSchema).ok, 'rechaza keySchema desconocido');

  const badStatus = clone();
  badStatus[0].options[0].metadata.keyStatus = 'whatever';
  check(!validateCleaverBank(badStatus).ok, 'rechaza keyStatus desconocido');

  const pendingBlock = clone();
  for (const opt of pendingBlock[0].options) opt.metadata.keyStatus = CLEAVER_KEY_STATUS.PENDING;
  const pendingResult = validateCleaverBank(pendingBlock);
  check(!pendingResult.ok, 'rechaza cualquier bloque pending_ml');
  check(pendingResult.summary.fullyVerified === false, 'pending_ml apaga fullyVerified');

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
  asymmetricWithDimension[0].options[0].metadata.dimension = 'I';
  check(
    !validateCleaverBank(asymmetricWithDimension).ok,
    'rechaza `dimension` espejo cuando M ≠ L',
  );

  const mixedStatus = clone();
  mixedStatus[0].options[0].metadata.keyStatus = CLEAVER_KEY_STATUS.PENDING;
  check(!validateCleaverBank(mixedStatus).ok, 'rechaza keyStatus mixto dentro de una tétrada');

  check(!validateCleaverBank(null).ok, 'rechaza entrada no-array');
}

// -------------------------------------------------------- comparación de metadata
console.log('\n[10] comparación de metadata para sync idempotente');
{
  const canonical = cleaverBlockByOrder(24).options[0].metadata;
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

console.log('\n[11] delta contra el mapeo heredado (no se usa para puntuar)');
{
  let moreDiff = 0;
  let lessDiff = 0;
  const touchedBlocks = new Set();
  for (const [block, word, more, less] of CANONICAL_ML_MATRIX) {
    const legacy = CLEAVER_LEGACY_DIMENSIONS[word];
    if (legacy !== more) moreDiff++;
    if (legacy !== less) lessDiff++;
    if (legacy !== more || legacy !== less) touchedBlocks.add(block);
    check(CLEAVER_DISC_KEYS.includes(legacy), `legacy de "${word}" es una letra DISC`);
  }
  check(moreDiff === 25, `MÁS difiere del legado en ${moreDiff} celdas`, moreDiff);
  check(lessDiff === 22, `MENOS difiere del legado en ${lessDiff} celdas`, lessDiff);
  check(
    touchedBlocks.size === 23 && !touchedBlocks.has(24),
    'el legado habría puntuado distinto en 23/24 bloques (B24 intacto)',
    [...touchedBlocks].sort((a, b) => a - b),
  );
}

console.log(
  failed === 0
    ? `\n✓ ${passed} aserciones OK.\n`
    : `\n✗ ${failed} fallo(s) de ${passed + failed} aserciones.\n`,
);
process.exit(failed === 0 ? 0 : 1);

/**
 * Motor interpretativo Personalidad Mind24 (Fase 4C.3).
 * Ejecutar: node server/scripts/test-personality-mind24-interpretation.mjs
 */
import { PERSONALIDAD_MIND24_DIMENSIONS } from '../src/data/personalityMind24Data.js';
import {
  buildPersonalityMind24ModuleFragment,
  intraprofileTrends,
} from '../src/reports/fragments/personalityMind24Report.fragment.js';
import {
  allPersonalityInterpretationCopyText,
  assertInterpretationCatalogComplete,
  buildDimensionInterpretationView,
  buildPersonalityProfileSummary,
  conductasLinkFragment,
  HOMOGENEOUS_PROFILE_SUMMARY_TEXT,
  summaryQualityIssues,
  personalityDimensionNarrative,
  personalityFrequencyDescriptor,
  personalityNarrativeStyleZone,
  PERSONALITY_DIMENSION_INTERPRETATIONS,
  PERSONALITY_INTERPRETATION_FORBIDDEN,
} from '../src/reports/personalityMind24Interpretation.js';

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function buildRows(meanOverrides) {
  return PERSONALIDAD_MIND24_DIMENSIONS.map((def) => ({
    dimensionId: def.dimensionId,
    sortOrder: def.sortOrder,
    label: def.label,
    mean: meanOverrides[def.dimensionId] ?? 3.0,
    nAnswered: 8,
    nExpected: 8,
  }));
}

function buildScoresPayload(rows) {
  const dimensions = Object.fromEntries(
    rows.map((r) => [
      r.dimensionId,
      {
        dimensionId: r.dimensionId,
        label: r.label,
        mean: r.mean,
        nAnswered: 8,
        nExpected: 8,
        scaleMin: 1,
        scaleMax: 5,
      },
    ]),
  );
  return {
    instrument: 'personalidad_mind24',
    form: { totalItemsExpected: 80, itemsPerDimension: 8 },
    dimensions,
    dimensionRows: rows,
    meta: {
      applicationQuality: { completeness: { answeredCount: 80, expectedCount: 80 } },
    },
  };
}

console.log('\n=== Personalidad Mind24 — interpretación 4C.3 ===\n');

console.log('--- Catálogo 10 × 3 narrativas ---\n');
try {
  assertInterpretationCatalogComplete();
  check(Object.keys(PERSONALITY_DIMENSION_INTERPRETATIONS).length === 10, '10 dimensiones con copy');
} catch (e) {
  check(false, e.message);
}

const copyBlob = allPersonalityInterpretationCopyText();
for (const re of PERSONALITY_INTERPRETATION_FORBIDDEN) {
  check(!re.test(copyBlob), `copy estático sin patrón ${re}`);
}

console.log('\n--- Descriptor de frecuencia (bordes) ---\n');

const descriptorCases = [
  [1.0, 'Nunca o casi nunca'],
  [1.4, 'Nunca o casi nunca'],
  [1.5, 'Rara vez'],
  [2.4, 'Rara vez'],
  [2.5, 'A veces'],
  [3.4, 'A veces'],
  [3.5, 'Con frecuencia'],
  [4.4, 'Con frecuencia'],
  [4.5, 'Siempre o casi siempre'],
  [5.0, 'Siempre o casi siempre'],
];

for (const [mean, label] of descriptorCases) {
  check(personalityFrequencyDescriptor(mean)?.label === label, `descriptor ${mean} → ${label}`);
}

console.log('\n--- Zonas narrativas (bordes) ---\n');

check(personalityNarrativeStyleZone(2.4) === 'lower', '2.4 → lower');
check(personalityNarrativeStyleZone(2.5) === 'mixed', '2.5 → mixed');
check(personalityNarrativeStyleZone(3.4) === 'mixed', '3.4 → mixed');
check(personalityNarrativeStyleZone(3.5) === 'upper', '3.5 → upper');

console.log('\n--- Cada dimensionId ---\n');

for (const def of PERSONALIDAD_MIND24_DIMENSIONS) {
  const copy = PERSONALITY_DIMENSION_INTERPRETATIONS[def.dimensionId];
  check(copy?.lowerText?.length > 20, `${def.dimensionId}: lowerText`);
  check(copy?.mixedText?.length > 20, `${def.dimensionId}: mixedText`);
  check(copy?.upperText?.length > 20, `${def.dimensionId}: upperText`);
  check(
    personalityDimensionNarrative(def.dimensionId, 2.0) === copy.lowerText,
    `${def.dimensionId}: mean 2.0 → lower`,
  );
  check(
    personalityDimensionNarrative(def.dimensionId, 3.0) === copy.mixedText,
    `${def.dimensionId}: mean 3.0 → mixed`,
  );
  check(
    personalityDimensionNarrative(def.dimensionId, 4.0) === copy.upperText,
    `${def.dimensionId}: mean 4.0 → upper`,
  );
}

console.log('\n--- Síntesis top Sociabilidad + Liderazgo + Apego a normas ---\n');

const realTopMeans = {
  logro_persistencia: 3.0,
  orden_precision: 3.1,
  autonomia_decision: 3.2,
  influencia_persuasion: 3.0,
  sociabilidad_colaboracion: 4.35,
  liderazgo_equipos: 4.25,
  apego_normas: 4.45,
  regulacion_presion: 3.0,
  dinamismo_iniciativa: 2.6,
  adaptabilidad_cambio: 2.5,
};
const realTopRows = buildRows(realTopMeans);
const realTopTrends = intraprofileTrends(realTopRows);
const realTopIds = realTopTrends.moreExpressed.map((r) => r.dimensionId);
check(
  realTopIds.includes('sociabilidad_colaboracion') &&
    realTopIds.includes('liderazgo_equipos') &&
    realTopIds.includes('apego_normas'),
  'top 3 incluye sociabilidad, liderazgo y apego_normas',
);
const realTopSummary = buildPersonalityProfileSummary(realTopRows, realTopTrends);
const realTopP1 = realTopSummary.paragraphs[0];
check(!/\bal coordinaci/i.test(realTopP1), 'real top3: no “al coordinación”');
check(!/\bla uso\b/i.test(realTopP1), 'real top3: no “la uso”');
check(summaryQualityIssues(realTopP1).length === 0, 'real top3: summaryQualityIssues vacío');
const conductasSeg =
  realTopP1.split(/conductas\s/i)[1]?.split(/\.\s/)[0]?.toLowerCase() || '';
check(
  (conductasSeg.match(/\bcoordinaci[oó]n\b/g) || []).length === 0,
  'real top3: sin repetición de “coordinación” en oración de conductas',
);
check(
  conductasSeg.includes('contacto') || conductasSeg.includes('apoyo'),
  'real top3: idea sociabilidad',
);
check(conductasSeg.includes('dirección') || conductasSeg.includes('colectivo'), 'real top3: idea liderazgo');
check(conductasSeg.includes('referencias') || conductasSeg.includes('procedimientos'), 'real top3: idea apego_normas');

console.log('\n--- Síntesis gramatical (composición conductas) ---\n');

check(
  conductasLinkFragment('contacto directo con apoyo en trabajo compartido') ===
    'al contacto directo con apoyo en trabajo compartido',
  'link: contacto → al',
);
check(conductasLinkFragment('uso de referencias y procedimientos claros') === 'al uso de referencias y procedimientos claros', 'link: uso → al');
check(conductasLinkFragment('sostener el esfuerzo hacia resultados y el seguimiento de pendientes') === 'a sostener el esfuerzo hacia resultados y el seguimiento de pendientes', 'link: infinitivo → a');

const grammarMeans = {
  logro_persistencia: 3.0,
  orden_precision: 3.0,
  autonomia_decision: 3.0,
  influencia_persuasion: 3.0,
  sociabilidad_colaboracion: 4.4,
  liderazgo_equipos: 4.2,
  apego_normas: 4.5,
  regulacion_presion: 3.0,
  dinamismo_iniciativa: 2.5,
  adaptabilidad_cambio: 2.5,
};
const grammarRows = buildRows(grammarMeans);
const grammarTrends = intraprofileTrends(grammarRows);
const grammarSummary = buildPersonalityProfileSummary(grammarRows, grammarTrends);
const grammarText = grammarSummary.paragraphs.join(' ');
check(!/\bal coordinaci/i.test(grammarText), 'síntesis: no “al coordinación”');
check(!/\bla uso\b/i.test(grammarText), 'síntesis: no “la uso”');
check(summaryQualityIssues(grammarText).length === 0, 'síntesis gramatical: calidad redacción');
check(
  grammarText.includes('al contacto directo') || grammarText.includes('al uso de referencias'),
  'síntesis: concordancia artículos/preposiciones',
);

console.log('\n--- Perfil piloto realista ---\n');

const pilotMeans = {
  logro_persistencia: 3.0,
  orden_precision: 3.3,
  autonomia_decision: 3.6,
  influencia_persuasion: 3.0,
  sociabilidad_colaboracion: 2.5,
  liderazgo_equipos: 3.4,
  apego_normas: 3.8,
  regulacion_presion: 3.1,
  dinamismo_iniciativa: 2.6,
  adaptabilidad_cambio: 2.6,
};
const pilotRows = buildRows(pilotMeans);
const pilotTrends = intraprofileTrends(pilotRows);
const pilotSummary = buildPersonalityProfileSummary(pilotRows, pilotTrends);
check(!pilotSummary.isHomogeneous, 'piloto: no homogéneo');
check(pilotSummary.paragraphs.length <= 2, 'piloto: máx. 2 párrafos síntesis');
check(
  pilotTrends.moreExpressed.some((r) => r.dimensionId === 'apego_normas'),
  'piloto: top incluye apego_normas',
);
check(
  pilotTrends.lessExpressed.some((r) => r.dimensionId === 'sociabilidad_colaboracion'),
  'piloto: bottom incluye sociabilidad',
);

const pilotSummaryText = pilotSummary.paragraphs.join(' ');
check(pilotSummaryText.includes('En conjunto, este patrón sugiere'), 'piloto síntesis: transición natural p1');
check(pilotSummaryText.includes('presentan menor expresión relativa dentro del perfil'), 'piloto síntesis: estructura p2');
check(!/\bgradual\w*.*\bgradual\w*/i.test(pilotSummaryText), 'piloto síntesis: sin repetir gradual');
check(summaryQualityIssues(pilotSummaryText).length === 0, 'piloto síntesis: calidad redacción');
check(
  (pilotSummaryText.match(/\bpreferencia\b/gi) || []).length === 1,
  'piloto síntesis: una sola mención de preferencia',
);
for (const re of PERSONALITY_INTERPRETATION_FORBIDDEN) {
  check(!re.test(pilotSummaryText), `piloto síntesis sin patrón ${re}`);
}

const pilotHtml = buildPersonalityMind24ModuleFragment({
  scores: buildScoresPayload(pilotRows),
  submittedAt: '10 oct 2026',
});
check(pilotHtml.includes('Interpretación del perfil'), 'piloto HTML: sección interpretación');
check((pilotHtml.match(/pm24-interpret-row/g) || []).length === 10, 'piloto HTML: 10 lecturas');
check(pilotHtml.includes('Frecuencia observada'), 'piloto HTML: descriptor frecuencia');
check(!/score global|resultado global/i.test(pilotHtml), 'piloto: sin score global');
for (const re of PERSONALITY_INTERPRETATION_FORBIDDEN) {
  check(!re.test(pilotHtml), `piloto HTML sin patrón ${re}`);
}

console.log('\n--- Perfil homogéneo ---\n');

const homRows = buildRows(Object.fromEntries(PERSONALIDAD_MIND24_DIMENSIONS.map((d) => [d.dimensionId, 3.0])));
const homTrends = intraprofileTrends(homRows);
const homSummary = buildPersonalityProfileSummary(homRows, homTrends);
check(homSummary.isHomogeneous, 'homogéneo: flag');
check(homSummary.paragraphs[0] === HOMOGENEOUS_PROFILE_SUMMARY_TEXT, 'homogéneo: texto síntesis');
check(homSummary.paragraphs.join(' ').includes('homogénea'), 'homogéneo: sin contrastes inventados');
check(summaryQualityIssues(homSummary.paragraphs.join(' ')).length === 0, 'homogéneo: calidad redacción');
check(
  personalityDimensionNarrative('logro_persistencia', 3.0) ===
    PERSONALITY_DIMENSION_INTERPRETATIONS.logro_persistencia.mixedText,
  'homogéneo: dim 3.0 → mixed',
);

console.log('\n--- Fallback mean inválido ---\n');

const badView = buildDimensionInterpretationView({
  dimensionId: 'logro_persistencia',
  label: 'Test',
  mean: NaN,
});
check(badView.narrative.includes('no disponible'), 'mean inválido: mensaje fallback');

console.log(
  failed === 0
    ? '\n✓ Personalidad Mind24 interpretación — OK.\n'
    : `\n✗ ${failed} fallo(s).\n`,
);
process.exit(failed === 0 ? 0 : 1);

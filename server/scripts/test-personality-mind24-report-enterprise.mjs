/**
 * Regresión — reporte Personalidad Mind24 (Fase 4C.2 / 4C.2.1).
 * Ejecutar: node server/scripts/test-personality-mind24-report-enterprise.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PERSONALIDAD_MIND24_DIMENSIONS } from '../src/data/personalityMind24Data.js';
import { buildModuleCoverSummaries } from '../src/reports/coverSummary.js';
import { buildModuleFragment } from '../src/reports/moduleFragments.js';
import { buildUnifiedReportHtml } from '../src/reports/unifiedReport.template.js';
import {
  barWidthPct,
  buildPersonalityMind24IncompleteFragment,
  buildPersonalityMind24ModuleFragment,
  extractPersonalityMind24Scores,
  HOMOGENEOUS_PROFILE_MESSAGE,
  intraprofileHasContrast,
  intraprofileTrends,
  PERSONALITY_METHODOLOGY_NOTE,
  PM24_RADAR_SHORT_LABELS,
  radarRadiusForMean,
  radarVertexPoints,
  rankPersonalityDimensionsByMean,
} from '../src/reports/fragments/personalityMind24Report.fragment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');

const FORBIDDEN = [
  /\bpercentil/i,
  /score global/i,
  /resultado global/i,
  /nivel alto/i,
  /nivel bajo/i,
  /\bcompatibilidad laboral/i,
  /recomendado para/i,
  /no recomendado/i,
  /\bfortalezas\b/i,
  /\bdebilidades\b/i,
  /\bpeor\b/i,
  /\bmejor\b/i,
];

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function assertNoForbidden(html, label) {
  const stripped = html.replaceAll(PERSONALITY_METHODOLOGY_NOTE, '');
  for (const re of FORBIDDEN) {
    check(!re.test(stripped), `${label}: sin patrón ${re}`);
  }
}

function attempt(moduleKey, scores, extra = {}) {
  return {
    id: `att-${moduleKey}`,
    moduleKey,
    status: 'submitted',
    submittedAt: new Date('2026-10-09T18:00:00Z'),
    scores,
    interpretation: { verdict: 'Evaluación completada' },
    flags: [],
    ...extra,
  };
}

function buildValidScores(meanOverrides = {}) {
  const dimensions = {};
  for (const dim of PERSONALIDAD_MIND24_DIMENSIONS) {
    dimensions[dim.dimensionId] = {
      dimensionId: dim.dimensionId,
      label: dim.label,
      mean: meanOverrides[dim.dimensionId] ?? 3.0,
      nAnswered: 8,
      nExpected: 8,
      scaleMin: 1,
      scaleMax: 5,
    };
  }
  return {
    instrument: 'personalidad_mind24',
    catalogVersion: 1,
    form: {
      itemsPerDimension: 8,
      totalItemsExpected: 80,
      productionItemsInCatalog: 0,
      syncableItemsInCatalog: 80,
    },
    dimensions,
    meta: {
      engine: 'personalidad_mind24',
      applicationQuality: {
        completeness: {
          expectedCount: 80,
          answeredCount: 80,
          unansweredCount: 0,
          completenessRate: 100,
        },
        reliability: {
          avgSecondsPerQuestion: 11.2,
          elapsedMs: 896000,
          questionCount: 80,
        },
      },
    },
  };
}

console.log('\n=== Personalidad Mind24 — reporte Enterprise (4C.2.1) ===\n');

console.log('--- Escala visual barras 1–5 ---\n');

check(barWidthPct(1.0) === 0, 'barWidth mean 1.0 → 0%');
check(barWidthPct(3.0) === 50, 'barWidth mean 3.0 → 50%');
check(barWidthPct(5.0) === 100, 'barWidth mean 5.0 → 100%');

console.log('\n--- Radar escala 1–5 ---\n');

check(radarRadiusForMean(1, 80) === 0, 'radar mean 1 → radio 0');
check(radarRadiusForMean(3, 80) === 40, 'radar mean 3 → radio 50% del máximo');
check(radarRadiusForMean(5, 80) === 80, 'radar mean 5 → radio máximo');
check(PM24_RADAR_SHORT_LABELS.length === 10, '10 labels cortos radar');

console.log('\n--- CASO A: scores válidos 80/80 (contraste claro) ---\n');

const meansA = {
  logro_persistencia: 4.2,
  orden_precision: 3.8,
  autonomia_decision: 3.5,
  influencia_persuasion: 3.1,
  sociabilidad_colaboracion: 3.9,
  liderazgo_equipos: 2.8,
  apego_normas: 4.0,
  regulacion_presion: 3.3,
  dinamismo_iniciativa: 3.6,
  adaptabilidad_cambio: 3.0,
};
const scoresA = buildValidScores(meansA);
const attA = attempt('personalidad_mind24', scoresA);
const extractedA = extractPersonalityMind24Scores(attA);
check(extractedA != null, 'extractor: scores válidos');
check(extractedA.dimensionRows.length === 10, '10 dimensiones');
check(extractedA.form.totalItemsExpected === 80, 'form.totalItemsExpected 80');

const htmlA = buildPersonalityMind24ModuleFragment({ scores: extractedA, submittedAt: '9 oct 2026' });
check((htmlA.match(/pm24-bar-row/g) || []).length === 11, 'escala + 10 barras horizontales');
check(htmlA.includes('pm24-bar-fill'), 'barras renderizadas');
check(htmlA.includes('width:80.0%;'), 'barra 4.2 normalizada (80%)');
check(htmlA.includes('width:50.0%;'), 'barra 3.0 normalizada (50%)');
check(htmlA.includes('left:25%;'), 'marca escala 2 al 25%');
check(htmlA.includes('4.2 / 5'), 'mean visible en gráfica');
check(htmlA.includes(PERSONALITY_METHODOLOGY_NOTE), 'nota metodológica');
check(htmlA.includes('Mapa general del perfil'), 'sección radar');
check(htmlA.includes('Perfil dimensional'), 'sección barras');
check(htmlA.includes('pm24-radar'), 'radar SVG presente');
check((htmlA.match(/pm24-radar-vertex/g) || []).length === 10, 'radar: 10 vértices');
check((htmlA.match(/pm24-radar-ring/g) || []).length === 4, 'radar: anillos escala 2–5');
check((htmlA.match(/class="pm24-radar-axis"/g) || []).length === 10, 'radar: 10 ejes');
for (const label of PM24_RADAR_SHORT_LABELS) {
  check(htmlA.includes(label), `radar label: ${label}`);
}
check(radarVertexPoints(extractedA.dimensionRows).length === 10, 'radarVertexPoints: 10');
check(!htmlA.includes('Desglose por dimensión'), 'sin tabla desglose redundante');
check(!htmlA.match(/\b8\s\/\s8\b/), 'sin 8/8 repetido por dimensión');
check(htmlA.includes('Aplicación completa: 80/80 respuestas.'), 'nota completitud compacta');
check(htmlA.includes('Tendencias relativamente más expresadas'), 'sección más expresadas');
check(htmlA.includes('Tendencias relativamente menos expresadas'), 'sección menos expresadas');
check(htmlA.includes('Interpretación del perfil'), 'sección interpretación 4C.3');
check((htmlA.match(/pm24-interpret-row/g) || []).length === 10, '10 lecturas interpretativas');
check(htmlA.includes('Síntesis del perfil'), 'síntesis del perfil');
check(htmlA.includes('Lectura por dimensión'), 'lectura por dimensión');
check(htmlA.includes('Frecuencia observada'), 'descriptor frecuencia en interpretación');

const trendsA = intraprofileTrends(extractedA.dimensionRows);
check(trendsA.hasContrast === true, 'CASO A: hay contraste intraperfil');
check(intraprofileHasContrast(extractedA.dimensionRows), 'intraprofileHasContrast true');
check(trendsA.moreExpressed.length === 3, 'top 3');
check(trendsA.lessExpressed.length === 3, 'bottom 3');
check(trendsA.moreExpressed[0].dimensionId === 'logro_persistencia', 'top: mayor mean');
check(
  trendsA.lessExpressed[0].dimensionId === 'liderazgo_equipos' ||
    trendsA.lessExpressed.some((d) => d.dimensionId === 'liderazgo_equipos'),
  'bottom incluye dimensión con mean menor',
);

const fragA = buildModuleFragment(attA);
check(fragA != null && fragA.includes('mod-personalidad-mind24'), 'moduleFragments integrado');
assertNoForbidden(htmlA, 'CASO A');

const coverA = buildModuleCoverSummaries([attA])[0];
check(coverA.lines.some((l) => l.value === '10 dimensiones evaluadas'), 'cover: dimensiones');
check(coverA.lines.some((l) => l.value === 'Perfil completado'), 'cover: perfil completado');
check(!coverA.lines.some((l) => /global/i.test(l.value)), 'cover: sin media global');

console.log('\n--- CASO B: 10 medias iguales (sin contraste) ---\n');

const scoresB = buildValidScores(
  Object.fromEntries(PERSONALIDAD_MIND24_DIMENSIONS.map((d) => [d.dimensionId, 3.0])),
);
const rowsB = extractPersonalityMind24Scores(attempt('personalidad_mind24', scoresB)).dimensionRows;
const rankedB = rankPersonalityDimensionsByMean(rowsB);
check(
  rankedB.map((r) => r.dimensionId).join(',') ===
    PERSONALIDAD_MIND24_DIMENSIONS.map((d) => d.dimensionId).join(','),
  'empate total: orden canónico estable en rank',
);
check(!intraprofileHasContrast(rowsB), '10 iguales: sin contraste');
const trendsB = intraprofileTrends(rowsB);
check(trendsB.hasContrast === false, 'trends: hasContrast false');
check(trendsB.moreExpressed.length === 0 && trendsB.lessExpressed.length === 0, 'sin top/bottom artificial');
const htmlB = buildPersonalityMind24ModuleFragment({
  scores: extractPersonalityMind24Scores(attempt('personalidad_mind24', scoresB)),
  submittedAt: '9 oct 2026',
});
check(htmlB.includes(HOMOGENEOUS_PROFILE_MESSAGE), 'HTML: mensaje perfil homogéneo');
check(!htmlB.includes('Tendencias relativamente más expresadas'), 'HTML: sin bloque más expresadas');
check(!htmlB.includes('Tendencias relativamente menos expresadas'), 'HTML: sin bloque menos expresadas');

console.log('\n--- CASO B2: empates parciales (tiers de media) ---\n');

const meansPartial = Object.fromEntries(PERSONALIDAD_MIND24_DIMENSIONS.map((d) => [d.dimensionId, 3.0]));
meansPartial.logro_persistencia = 4.5;
meansPartial.orden_precision = 4.5;
meansPartial.liderazgo_equipos = 2.0;
meansPartial.adaptabilidad_cambio = 2.0;
const rowsPartial = extractPersonalityMind24Scores(
  attempt('personalidad_mind24', buildValidScores(meansPartial)),
).dimensionRows;
check(intraprofileHasContrast(rowsPartial), 'empates parciales: hay contraste');
const trendsPartial = intraprofileTrends(rowsPartial);
check(trendsPartial.hasContrast === true, 'trends parciales: hasContrast true');
const topMeans = new Set(trendsPartial.moreExpressed.map((r) => Math.round(r.mean * 10) / 10));
check(topMeans.has(4.5), 'top tier incluye media 4.5');
check(
  trendsPartial.moreExpressed.filter((r) => r.mean === 4.5).length === 2,
  'top tier: ambas dimensiones empatadas en 4.5',
);
const bottomMeans = new Set(trendsPartial.lessExpressed.map((r) => Math.round(r.mean * 10) / 10));
check(bottomMeans.has(2.0), 'bottom tier incluye media 2.0');
check(
  trendsPartial.lessExpressed.filter((r) => r.mean === 2.0).length === 2,
  'bottom tier: ambas dimensiones empatadas en 2.0',
);

console.log('\n--- CASO C: scores inválidos / ausentes ---\n');

check(extractPersonalityMind24Scores(attempt('personalidad_mind24', null)) === null, 'null scores');
check(
  extractPersonalityMind24Scores(attempt('personalidad_mind24', { instrument: 'terman' })) === null,
  'instrument incorrecto',
);
const partialDims = buildValidScores();
delete partialDims.dimensions.adaptabilidad_cambio;
check(extractPersonalityMind24Scores(attempt('personalidad_mind24', partialDims)) === null, 'dimensiones incompletas');

const attBad = attempt('personalidad_mind24', {});
const fragBad = buildModuleFragment(attBad);
check(fragBad != null, 'fallback: no crash');
check(fragBad.includes('desglose dimensional no pudo generarse'), 'fallback mensaje');
check(buildPersonalityMind24IncompleteFragment({ submittedAt: 'x' }).includes('no pudo generarse'), 'incomplete fragment');

console.log('\n--- CASO D: lenguaje prohibido ---\n');

assertNoForbidden(htmlA, 'CASO D fragmento');
assertNoForbidden(fragBad, 'CASO D fallback');

console.log('\n--- Regresión PDF / HTML fixtures ---\n');

const cleaverAtt = attempt('cleaver', {
  scores: {
    most: { D: 8, I: 4, S: 3, C: 5 },
    least: { D: 2, I: 5, S: 6, C: 3 },
    total: { D: 6, I: -1, S: -3, C: 2 },
  },
});
const termanAtt = attempt('terman', {
  scores: { rawScore: 42, totalQuestions: 50, percentCorrect: 84, series: [] },
});
const sjtAtt = attempt('sales_sjt', {
  scores: { rawScore: 58, maxPossible: 75, profileLabel: 'Perfil demo' },
});

const cleHtmlBefore = buildModuleFragment(cleaverAtt);
const cleKey = 'id="mod-cleaver"';

function buildReportHtml(attempts) {
  const summaries = buildModuleCoverSummaries(attempts);
  const frags = attempts.map((a) => buildModuleFragment(a)).filter(Boolean).join('\n');
  return buildUnifiedReportHtml({
    organizationName: 'Mind24 Demo',
    candidateName: 'Candidato Demo',
    puesto: 'Puesto demo',
    curp: '—',
    modulesAppliedLine: summaries.map((s) => s.title).join(', '),
    moduleCount: summaries.length,
    completedAt: '9 oct 2026',
    moduleCoverSummaries: summaries,
    logoDataUri: null,
    moduleFragmentsHtml: frags,
    generatedDate: '2026-10-09',
  });
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const scenarios = [
  { name: 'report-pm24-solo', attempts: [attA] },
  { name: 'report-pm24-cleaver', attempts: [attA, cleaverAtt] },
  { name: 'report-pm24-cog-sjt', attempts: [attA, termanAtt, sjtAtt] },
  { name: 'report-sin-pm24', attempts: [cleaverAtt, termanAtt] },
];

for (const sc of scenarios) {
  const html = buildReportHtml(sc.attempts);
  check(html.includes('mod-personalidad-mind24') === sc.attempts.some((a) => a.moduleKey === 'personalidad_mind24'), `${sc.name}: presencia fragmento PM24 coherente`);
  check(/page-break-after:always/.test(html), `${sc.name}: portada intacta`);
  const outPath = path.join(OUT_DIR, `${sc.name}.html`);
  fs.writeFileSync(outPath, html, 'utf8');
  check(fs.existsSync(outPath), `${sc.name}: HTML escrito`);
}

check(cleHtmlBefore.includes(cleKey), 'Cleaver fragmento sin regresión');
check(buildModuleFragment(cleaverAtt) === cleHtmlBefore, 'Cleaver HTML idéntico tras cambios');

console.log(
  failed === 0
    ? '\n✓ Personalidad Mind24 reporte — OK.\n'
    : `\n✗ ${failed} fallo(s).\n`,
);
process.exit(failed === 0 ? 0 : 1);

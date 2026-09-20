/**
 * Regresión — reporte Cognitiva Enterprise v1.
 * Ejecutar: node server/scripts/test-cognitiva-report-enterprise.mjs
 */
import { TERMAN_SERIES, TERMAN_MAX_RAW_SCORE } from '../src/data/termanData.js';
import {
  analyzeTermanCognitive,
  rankTermanSeries,
} from '../src/reports/termanCognitiveAnalysis.js';
import { buildTermanModuleFragment } from '../src/reports/fragments/termanReport.fragment.js';
import { scoreTermanResponses } from '../src/services/termanScoring.service.js';

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

const FORBIDDEN = [
  /coeficiente\s+intelectual/i,
  /\bCI\b/,
  /ciEstimate/i,
  /iqEstimate/i,
  /percentil/i,
  /stanine/i,
  /nivel cognitivo/i,
  /inclinación analítica/i,
  /deficiencia/i,
  /déficit/i,
  /baja capacidad/i,
  /bajo\s*\/\s*medio\s*\/\s*alto/i,
  /Desempeño cognitivo/,
  /Macro-categorías cognitivas/,
  /perfil analítico/i,
];

function assertNoForbidden(html, label) {
  for (const re of FORBIDDEN) {
    check(!re.test(html), `${label}: sin ${re}`);
  }
}

function baseSeries(defaults = {}) {
  return TERMAN_SERIES.map((s) => ({
    seriesId: s.seriesId,
    name: s.name,
    correct: defaults.correct ?? 3,
    total: 5,
    percent: defaults.percent ?? 60,
    ...(defaults.byId?.[s.seriesId] || {}),
  }));
}

function buildScores(overrides = {}) {
  return {
    rawScore: 25,
    totalQuestions: 50,
    percentCorrect: 50,
    series: baseSeries(),
    answeredCount: 50,
    unansweredCount: 0,
    completionRate: 100,
    ...overrides,
  };
}

function fragment(scores) {
  return buildTermanModuleFragment({ scores, submittedAt: '15/09/2026' });
}

console.log('\n=== Cognitiva — reporte Enterprise v1 ===\n');

console.log('--- resultado alto ---');
const high = buildScores({
  rawScore: 45,
  percentCorrect: 90,
  series: baseSeries({ correct: 4, percent: 80 }),
});
const aHigh = analyzeTermanCognitive(high);
const htmlHigh = fragment(high);
check(aHigh.rawScore === 45, 'alto: rawScore');
check(htmlHigh.includes('cog-exec'), 'alto: bloque ejecutivo');
check(htmlHigh.includes('Resultado ejecutivo'), 'alto: sección ejecutiva');
check(!htmlHigh.includes('Desempeño cognitivo'), 'alto: sin KPI duplicado');
assertNoForbidden(htmlHigh, 'alto');

console.log('\n--- resultado medio ---');
const med = buildScores({ rawScore: 25, percentCorrect: 50 });
check(analyzeTermanCognitive(med).percentCorrect === 50, 'medio: percentCorrect');
check(fragment(med).includes('Fortalezas relativas'), 'medio: lectura RH');

console.log('\n--- resultado bajo ---');
const low = buildScores({
  rawScore: 8,
  percentCorrect: 16,
  series: baseSeries({ correct: 1, percent: 20 }),
});
check(analyzeTermanCognitive(low).rawScore === 8, 'bajo: rawScore');
check(fragment(low).includes('Puntos de atención'), 'bajo: puntos de atención');

console.log('\n--- empate serie más alta ---');
const tieTop = buildScores({
  rawScore: 40,
  percentCorrect: 80,
  series: baseSeries({
    byId: {
      serie_1: { correct: 5, percent: 100 },
      serie_2: { correct: 5, percent: 100 },
      serie_3: { correct: 3, percent: 60 },
    },
  }),
});
const aTieTop = analyzeTermanCognitive(tieTop);
check(aTieTop.topEntries.length === 2, 'empate top: 2 series en síntesis');
check(aTieTop.topTied === true, 'empate top: flag tied');
check(aTieTop.synthesis.includes('Las series con mayor proporción'), 'empate top: síntesis plural');
check(aTieTop.strengthEntries.length === 3, 'empate top: 2 grupos superiores → 3 fortalezas max');
check(aTieTop.strengths[0].includes('Mayor proporción de aciertos'), 'empate top: copy principal');
check(aTieTop.strengths[1].includes('relativamente más sólidos'), 'empate top: copy secundario');

console.log('\n--- empate serie más baja ---');
const tieBottom = buildScores({
  rawScore: 20,
  percentCorrect: 40,
  series: baseSeries({
    byId: {
      serie_9: { correct: 0, percent: 0 },
      serie_10: { correct: 0, percent: 0 },
      serie_1: { correct: 5, percent: 100 },
    },
  }),
});
const aTieBottom = analyzeTermanCognitive(tieBottom);
check(aTieBottom.bottomEntries.length === 2, 'empate bottom: 2 series en síntesis');
check(aTieBottom.bottomTied === true, 'empate bottom: flag tied');
check(aTieBottom.synthesis.includes('Las series con menor proporción'), 'empate bottom: síntesis plural');
check(aTieBottom.attention.length >= 2, 'empate bottom: atención en grupos inferiores');
check(aTieBottom.attention[0].includes('Menor proporción de aciertos'), 'empate bottom: copy principal');
check(
  !aTieBottom.attention.some((t) => t.includes('Información General')),
  'empate bottom: sin duplicar serie de fortalezas',
);

console.log('\n--- dos grupos superiores en fortalezas ---');
const twoTopGroups = buildScores({
  series: baseSeries({
    byId: {
      serie_1: { correct: 5, percent: 100 },
      serie_2: { correct: 4, percent: 80 },
      serie_3: { correct: 3, percent: 60 },
    },
  }),
});
const aTwoTop = analyzeTermanCognitive(twoTopGroups);
check(aTwoTop.strengthEntries.length === 2, '2 grupos top: 1 serie por grupo superior');
check(aTwoTop.strengthEntries.some((e) => e.percent === 80), '2 grupos top: incluye 2.º grupo');
check(aTwoTop.attentionEntries.every((e) => !aTwoTop.strengthEntries.some((s) => s.seriesId === e.seriesId)), 'sin duplicados RH');

console.log('\n--- distribución uniforme ---');
const uniform = buildScores({ series: baseSeries({ correct: 3, percent: 60 }) });
const aUniform = analyzeTermanCognitive(uniform);
const htmlUniform = fragment(uniform);
check(aUniform.strengths.length === 0, 'uniforme: sin fortalezas');
check(aUniform.attention.length === 0, 'uniforme: sin atención');
check(aUniform.uniformRhMessage != null, 'uniforme: mensaje RH');
check(htmlUniform.includes('misma proporción de aciertos en este intento'), 'uniforme: mensaje en PDF');
check(!htmlUniform.includes('cog-rh-strength-list'), 'uniforme: sin lista fortalezas');
check(!htmlUniform.includes('cog-rh-attention-list'), 'uniforme: sin lista atención');

console.log('\n--- completitud parcial ---');
const partial = buildScores({
  rawScore: 46,
  percentCorrect: 92,
  answeredCount: 46,
  unansweredCount: 4,
  completionRate: 92,
});
const htmlPartial = fragment(partial);
check(htmlPartial.includes('cog-pill-partial'), 'parcial: pill completitud');
check(htmlPartial.includes('46 de 50 reactivos respondidos'), 'parcial: texto completitud');
check(!htmlPartial.includes('Completitud de la aplicación'), 'parcial: sin sección legacy completitud');

console.log('\n--- completitud 100% ---');
const full = buildScores({ answeredCount: 50, unansweredCount: 0, completionRate: 100 });
const htmlFull = fragment(full);
check(!htmlFull.includes('cog-pill-partial'), 'completo: sin pill completitud');

console.log('\n--- series faltantes / legacy ---');
const legacy = buildScores({ series: [], rawScore: 42, percentCorrect: 84 });
const aLegacy = analyzeTermanCognitive(legacy);
const htmlLegacy = fragment(legacy);
check(aLegacy.hasSeries === false, 'legacy: sin series');
check(aLegacy.strengths.length === 0, 'legacy: sin fortalezas');
check(aLegacy.attention.length === 0, 'legacy: sin atención');
check(htmlLegacy.includes('No hay desglose por series'), 'legacy: mensaje síntesis');
check(htmlLegacy.includes('Sin datos de series'), 'legacy: gráfica vacía');

console.log('\n--- ausencia CI ---');
const withCi = buildScores({
  ciEstimate: 999,
  iqEstimate: 888,
  ci: 777,
  ciNote: 'Coeficiente intelectual preliminar',
});
const htmlCi = fragment(withCi);
check(!/999|888|777/.test(htmlCi), 'CI: no renderiza valores internos');
assertNoForbidden(htmlCi, 'CI');

console.log('\n--- agrupación descriptiva ---');
const htmlGroups = fragment(buildScores());
check(htmlGroups.includes('Agrupación descriptiva de series'), 'agrupación: título');
check(htmlGroups.includes('afinidad temática'), 'agrupación: nota disclaimer');
check(htmlGroups.includes('Verbal'), 'agrupación: Verbal');
check(!htmlGroups.includes('Macro-categorías cognitivas'), 'agrupación: sin label legacy');
check(htmlGroups.includes('cog-descriptive-section'), 'agrupación: sección paginación');
check(htmlGroups.includes('cog-descriptive-block'), 'agrupación: bloque indivisible');

console.log('\n--- gráfica: nombres completos ---');
const htmlChart = fragment(buildScores());
check(htmlChart.includes('Juicio Práctico y Resolución'), 'gráfica: nombre largo resolución');
check(htmlChart.includes('Aritmética y Razonamiento Numérico'), 'gráfica: nombre largo aritmética');
check(!htmlChart.includes('Resolu…'), 'gráfica: sin truncar resolución');
check(!htmlChart.includes('Razonamient…'), 'gráfica: sin truncar aritmética');

console.log('\n--- sin referencia técnica (redundante con gráfica) ---');
const rank = rankTermanSeries(
  baseSeries({
    byId: {
      serie_1: { correct: 5, percent: 100 },
      serie_2: { correct: 1, percent: 20 },
    },
  }),
);
check(rank[0].percent >= rank[rank.length - 1].percent, 'ranking: orden desc');
const htmlTech = fragment(buildScores());
check(!htmlTech.includes('Referencia técnica'), 'PDF: sin referencia técnica Cognitiva');
check(!htmlTech.includes('cog-tech-table'), 'PDF: sin tabla técnica duplicada');
check(htmlTech.includes('Rendimiento por serie'), 'PDF: conserva gráfica por serie');

console.log('\n--- scoring intacto ---');
const rows = [
  {
    questionId: 'q1',
    selectedOptionId: 'a',
    question: { metadata: { seriesId: 'serie_1', correctIndex: 0 } },
    selectedOption: { sortOrder: 0 },
  },
];
const scored = scoreTermanResponses(rows);
check(scored.rawScore === 1, 'scoring: rawScore sin cambio');
check(scored.percentCorrect === 2, 'scoring: percentCorrect 1/50');

console.log(failed === 0 ? '\n✓ Cognitiva Enterprise v1 — todos los escenarios pasaron.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

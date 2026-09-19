/**
 * Regresión — reporte SJT Comercial Enterprise (Fase 1 + Fase 2).
 * Ejecutar: node server/scripts/test-sjt-report-enterprise.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  SJT_SALES_MACRO_GROUPS,
  SJT_SALES_PROFILE_TIERS,
  computeSjtSalesMacroCompetencies,
  resolveSjtSalesProfile,
  scoreSjtSalesResponses,
} from '../src/services/sjtSalesScoring.service.js';
import { SJT_SALES_MAX_POINTS, SJT_SALES_SCENARIOS } from '../src/data/sjtSalesData.js';
import {
  analyzeSjtSales,
  rankSjtMacroAreas,
  SJT_UNIFORM_AREA_RH_MESSAGE,
} from '../src/reports/sjtSalesAnalysis.js';
import {
  buildSjtSalesModuleFragment,
  extractSjtSalesScores,
  sjtSpeedUnreliable,
  SJT_AREA_PERCENT_NOTE,
  SJT_PROFILE_ASSIGNMENT_NOTE,
} from '../src/reports/fragments/sjtSalesReport.fragment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAGMENT_SRC = fs.readFileSync(
  path.join(__dirname, '../src/reports/fragments/sjtSalesReport.fragment.js'),
  'utf8',
);

const FORBIDDEN = [
  /nivel comercial/i,
  /capacidad\s+(alta|baja)/i,
  /déficit/i,
  /deficiencia/i,
  /apto\s+para/i,
  /no apto/i,
  /recomendación de contratación/i,
  /recomendamos contratar/i,
  /percentil/i,
  /escala psicométrica/i,
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
  for (const re of FORBIDDEN) {
    check(!re.test(html), `${label}: sin ${re}`);
  }
}

function attempt(scores, extra = {}) {
  return {
    moduleKey: 'sales_sjt',
    status: 'submitted',
    scores,
    flags: [],
    ...extra,
  };
}

function baseMacroFromPoints(byScenarioPoints = {}) {
  const scenarios = SJT_SALES_SCENARIOS.map((s) => {
    const pts = byScenarioPoints[s.scenarioId] ?? 3;
    return {
      scenarioId: s.scenarioId,
      competence: s.competence,
      points: pts,
      maxPoints: 5,
      percent: (pts / 5) * 100,
    };
  });
  const rawScore = scenarios.reduce((sum, s) => sum + s.points, 0);
  return {
    scenarios,
    macroCompetencies: computeSjtSalesMacroCompetencies(scenarios),
    rawScore,
  };
}

function buildScores(overrides = {}) {
  const { byScenarioPoints, ...rest } = overrides;
  const base = baseMacroFromPoints(byScenarioPoints);
  const raw = Number(rest.rawScore ?? base.rawScore);
  const profile = resolveSjtSalesProfile(raw);
  const maxPossible = SJT_SALES_MAX_POINTS;
  const percentScore = Math.round((raw / maxPossible) * 1000) / 10;
  return {
    rawScore: raw,
    maxPossible,
    totalScenarios: 15,
    percentScore,
    profileKey: profile.key,
    profileLabel: profile.label,
    profileDescription: profile.description,
    scenarios: base.scenarios,
    macroCompetencies: base.macroCompetencies,
    ...rest,
  };
}

function pointsByGroupPattern({ groupPoints }) {
  const byScenarioPoints = {};
  for (const g of SJT_SALES_MACRO_GROUPS) {
    const pts = groupPoints[g.key] ?? 3;
    for (const id of g.scenarioIds) byScenarioPoints[id] = pts;
  }
  return byScenarioPoints;
}

function fragment(scores, attemptExtra = {}) {
  const att = attempt({ scores, ...attemptExtra });
  return buildSjtSalesModuleFragment({
    scores,
    submittedAt: '19/09/2026',
    attempt: att,
  });
}

console.log('\n=== SJT Comercial — reporte Enterprise ===\n');

console.log('--- perfiles oficiales (4 tiers) ---');
for (const tier of SJT_SALES_PROFILE_TIERS) {
  const mid = Math.floor((tier.min + tier.max) / 2);
  const p = resolveSjtSalesProfile(mid);
  check(p.key === tier.key, `perfil ${tier.key} @ ${mid} pts`);
  check(p.label === tier.label, `label ${tier.label}`);
}

console.log('\n--- Fase 1: resultado ejecutivo ---');
const htmlExec = fragment(buildScores({ rawScore: 48, byScenarioPoints: undefined }));
const scores48 = buildScores({ rawScore: 48 });
const html48 = fragment(scores48);
check(html48.includes('Resultado ejecutivo'), 'ejecutivo: sección');
check(html48.includes('sjt-exec'), 'ejecutivo: bloque Enterprise');
check(html48.includes('48 <span class="sjt-exec-denom">/ 75'), 'ejecutivo: puntaje X/75');
check(html48.includes('64.0%'), 'ejecutivo: percentScore 48/75');
check(html48.includes('Ejecutivo de Cierre Ágil'), 'ejecutivo: perfil');
check(html48.includes(SJT_PROFILE_ASSIGNMENT_NOTE), 'ejecutivo: nota asignación perfil');
check(!html48.includes('module-icon">📊'), 'encabezado: sin emoji');
check(html48.includes('module-svg-icon'), 'encabezado: SVG lineal');

console.log('\n--- Fase 1: áreas situacionales ---');
check(html48.includes('Resultado por área situacional'), 'áreas: título');
check(html48.includes(SJT_AREA_PERCENT_NOTE), 'áreas: nota metodológica');
for (const g of SJT_SALES_MACRO_GROUPS) {
  check(html48.includes(g.label), `áreas: label ${g.label}`);
}
const sorted = [...scores48.macroCompetencies].sort((a, b) => b.percent - a.percent);
const areaOrder = [...html48.matchAll(/class="sjt-area-name">([^<]+)/g)].map((m) => m[1]);
check(areaOrder.length === 4, 'áreas: 4 filas');
check(areaOrder[0] === sorted[0].label, 'áreas: primera fila = mayor %');

console.log('\n--- Fase 1: confiabilidad velocidad ---');
check(!html48.includes('Alertas y banderas'), 'velocidad: sin sección alertas vacía');
check(!FRAGMENT_SRC.includes('SJT_PDF_SPEED_THRESHOLD_SEC'), 'velocidad: sin threshold PDF 3s');
check(!FRAGMENT_SRC.includes('avgSecondsPerQuestion <'), 'velocidad: sin regla paralela avg');

const reliable = buildScores({ rawScore: 48 });
const attReliable = attempt({
  scores: { ...reliable, meta: { reliability: { isUnreliableSpeed: false, avgSecondsPerQuestion: 2 } } },
});
check(sjtSpeedUnreliable(attReliable.scores, attReliable) === false, 'velocidad: avg 2s sin flag → no alerta');

console.log('\n--- Fase 2: síntesis comparativa ---');
const clearHighLow = buildScores({
  byScenarioPoints: pointsByGroupPattern({
    groupPoints: {
      negociacion_cierre: 5,
      prospeccion_apertura: 4,
      fidelizacion_retencion: 1,
      etica_crisis: 0,
    },
  }),
});
const aClear = analyzeSjtSales(clearHighLow);
check(aClear.comparativeSynthesis.includes(aClear.profileLabel), 'síntesis: incluye perfil');
check(aClear.comparativeSynthesis.includes('Negociación y Cierre'), 'síntesis: área superior');
check(aClear.comparativeSynthesis.includes('Ética y Manejo de Crisis'), 'síntesis: área inferior');
const htmlClear = fragment(clearHighLow);
check(htmlClear.includes('sjt-exec-synthesis'), 'síntesis: bloque en ejecutivo');
check(htmlClear.includes('El perfil asignado es'), 'síntesis: copy en PDF');
check(aClear.comparativeSynthesis.includes(', mientras que la menor proporción'), 'síntesis: frase fluida');
check(!/\.\s+Mientras/.test(aClear.comparativeSynthesis), 'síntesis: sin corte con punto antes de mientras');

console.log('\n--- Fase 2: fortalezas / atención ---');
check(aClear.strengths.length >= 1, 'RH: al menos 1 fortaleza');
check(aClear.attention.length >= 1, 'RH: al menos 1 atención');
check(
  !aClear.strengthEntries.some((s) => aClear.attentionEntries.some((w) => w.key === s.key)),
  'RH: sin duplicación fortalezas/atención',
);
check(htmlClear.includes('Fortalezas relativas'), 'RH: título fortalezas');
check(htmlClear.includes('Puntos de atención'), 'RH: título atención');
check(htmlClear.includes('Mayor proporción de puntos'), 'RH: copy fortaleza');
check(htmlClear.includes('Menor proporción de puntos'), 'RH: copy atención');
check(!htmlClear.includes('Lectura del perfil comercial</div>'), 'RH: sin sección perfil Fase 1 duplicada');
check(htmlClear.includes('Lectura para recursos humanos'), 'RH: sección');
check(htmlClear.includes('Lectura ampliada del perfil comercial'), 'RH: ampliada perfil');

console.log('\n--- Fase 2: empate superior ---');
const topTie = buildScores({
  byScenarioPoints: pointsByGroupPattern({
    groupPoints: {
      negociacion_cierre: 5,
      prospeccion_apertura: 5,
      fidelizacion_retencion: 2,
      etica_crisis: 1,
    },
  }),
});
const aTopTie = analyzeSjtSales(topTie);
check(aTopTie.strengthEntries.length === 2, 'empate top: 2 áreas al 100%');
check(aTopTie.topTied || aTopTie.strengthEntries.length > 1, 'empate top: detectado');
check(
  aTopTie.comparativeSynthesis.includes('mayores resultados relativos') ||
    aTopTie.comparativeSynthesis.includes('Negociación y Cierre'),
  'empate top: síntesis plural o nombres',
);

const tripleTop = buildScores({
  byScenarioPoints: pointsByGroupPattern({
    groupPoints: {
      negociacion_cierre: 4,
      prospeccion_apertura: 4,
      fidelizacion_retencion: 4,
      etica_crisis: 2,
    },
  }),
});
const aTriple = analyzeSjtSales(tripleTop);
check(aTriple.strengthEntries.length === 3, 'empate top: 3 áreas al 80% completas');
check(aTriple.strengths.length === 3, 'empate top: 3 frases fortalezas');
check(aTriple.attentionEntries.length === 1, 'empate top triple: atención solo área inferior');
check(aTriple.attentionEntries[0].key === 'etica_crisis', 'empate top triple: ética inferior');

console.log('\n--- Fase 2: empate inferior ---');
const bottomTie = buildScores({
  byScenarioPoints: pointsByGroupPattern({
    groupPoints: {
      negociacion_cierre: 5,
      prospeccion_apertura: 4,
      fidelizacion_retencion: 0,
      etica_crisis: 0,
    },
  }),
});
const aBotTie = analyzeSjtSales(bottomTie);
check(aBotTie.attentionEntries.length >= 1, 'empate bottom: atención presente');
const botKeys = new Set(aBotTie.attentionEntries.map((e) => e.key));
check(botKeys.has('fidelizacion_retencion') || botKeys.has('etica_crisis'), 'empate bottom: áreas bajas');

console.log('\n--- Fase 2: distribución uniforme ---');
const uniform = buildScores({
  byScenarioPoints: pointsByGroupPattern({
    groupPoints: {
      negociacion_cierre: 3,
      prospeccion_apertura: 3,
      fidelizacion_retencion: 3,
      etica_crisis: 3,
    },
  }),
});
const aUniform = analyzeSjtSales(uniform);
check(aUniform.uniformRhMessage === SJT_UNIFORM_AREA_RH_MESSAGE, 'uniforme: mensaje RH');
check(aUniform.strengths.length === 0, 'uniforme: sin fortalezas');
check(aUniform.attention.length === 0, 'uniforme: sin atención');
const htmlUniform = fragment(uniform);
check(htmlUniform.includes(SJT_UNIFORM_AREA_RH_MESSAGE), 'uniforme: mensaje en PDF');

console.log('\n--- Fase 2: referencia técnica ---');
check(htmlClear.includes('Referencia técnica'), 'tabla: sección');
check(htmlClear.includes('sjt-tech-table'), 'tabla: markup');
const tableOrder = [...htmlClear.matchAll(/<td>([^<]+)<\/td>\s*<td class="num">/g)].map((m) => m[1]);
check(tableOrder[0] === aClear.ranking[0].label, 'tabla: orden desc por %');

console.log('\n--- lenguaje prohibido ---');
assertNoForbidden(htmlClear, 'SJT PDF');

console.log('\n--- scoring intacto ---');
const row = (scenarioId, points) => ({
  question: { metadata: { scenarioId } },
  selectedOption: { metadata: { points } },
});
const rows = SJT_SALES_SCENARIOS.map((s) => row(s.scenarioId, 5));
const perfect = scoreSjtSalesResponses(rows);
check(perfect.rawScore === 75, 'scoring: máximo 75');
check(perfect.maxPossible === 75, 'scoring: maxPossible 75');
check(perfect.percentScore === 100, 'scoring: percentScore 100%');
check(perfect.profileKey === 'consultor_estrategico', 'scoring: perfil top tier');
check(perfect.macroCompetencies.length === 4, 'scoring: 4 macros');
check(rankSjtMacroAreas(perfect.macroCompetencies).length === 4, 'ranking: 4 áreas');

console.log('\n--- extract scores ---');
const extracted = extractSjtSalesScores(attempt({ scores: buildScores({ rawScore: 60 }) }));
check(extracted?.rawScore === 60, 'extract: rawScore');

console.log(
  failed === 0
    ? '\n✓ SJT Enterprise — todos los escenarios pasaron.\n'
    : `\n✗ ${failed} fallo(s).\n`,
);
process.exit(failed === 0 ? 0 : 1);

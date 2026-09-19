/**
 * Regresión — reporte SJT Comercial Enterprise Fase 1.
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

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
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
  return {
    scenarios,
    macroCompetencies: computeSjtSalesMacroCompetencies(scenarios),
  };
}

function buildScores(overrides = {}) {
  const { byScenarioPoints, ...rest } = overrides;
  const raw = Number(rest.rawScore ?? 48);
  const profile = resolveSjtSalesProfile(raw);
  const maxPossible = SJT_SALES_MAX_POINTS;
  const percentScore = Math.round((raw / maxPossible) * 1000) / 10;
  const { scenarios, macroCompetencies } = baseMacroFromPoints(byScenarioPoints);
  return {
    rawScore: raw,
    maxPossible,
    totalScenarios: 15,
    percentScore,
    profileKey: profile.key,
    profileLabel: profile.label,
    profileDescription: profile.description,
    scenarios,
    macroCompetencies,
    ...rest,
  };
}

function fragment(scores, attemptExtra = {}) {
  const att = attempt({ scores, ...attemptExtra });
  return buildSjtSalesModuleFragment({
    scores,
    submittedAt: '19/09/2026',
    attempt: att,
  });
}

console.log('\n=== SJT Comercial — reporte Enterprise Fase 1 ===\n');

console.log('--- perfiles oficiales (4 tiers) ---');
for (const tier of SJT_SALES_PROFILE_TIERS) {
  const mid = Math.floor((tier.min + tier.max) / 2);
  const p = resolveSjtSalesProfile(mid);
  check(p.key === tier.key, `perfil ${tier.key} @ ${mid} pts`);
  check(p.label === tier.label, `label ${tier.label}`);
}

console.log('\n--- resultado ejecutivo ---');
const htmlExec = fragment(buildScores({ rawScore: 48 }));
check(htmlExec.includes('Resultado ejecutivo'), 'ejecutivo: sección');
check(htmlExec.includes('sjt-exec'), 'ejecutivo: bloque Enterprise');
check(htmlExec.includes('48 <span class="sjt-exec-denom">/ 75'), 'ejecutivo: puntaje X/75');
check(htmlExec.includes('64.0%'), 'ejecutivo: percentScore 48/75');
check(htmlExec.includes('Ejecutivo de Cierre Ágil'), 'ejecutivo: perfil');
check(htmlExec.includes(SJT_PROFILE_ASSIGNMENT_NOTE), 'ejecutivo: nota asignación perfil');
check(!htmlExec.includes('module-icon">📊'), 'encabezado: sin emoji');
check(htmlExec.includes('module-svg-icon'), 'encabezado: SVG lineal');

console.log('\n--- lectura del perfil (sin redundancia) ---');
check(htmlExec.includes('Lectura del perfil comercial'), 'perfil: título único');
check(!htmlExec.includes('Dictamen del perfil'), 'perfil: sin dictamen legacy');
check(!htmlExec.includes('Análisis técnico de perfiles'), 'perfil: sin análisis técnico duplicado');
check(htmlExec.includes('Orientado a resultados inmediatos'), 'perfil: description oficial');

console.log('\n--- áreas situacionales ---');
check(htmlExec.includes('Resultado por área situacional'), 'áreas: título');
check(htmlExec.includes(SJT_AREA_PERCENT_NOTE), 'áreas: nota metodológica');
for (const g of SJT_SALES_MACRO_GROUPS) {
  check(htmlExec.includes(g.label), `áreas: label ${g.label}`);
}
const scoresAreas = buildScores({ rawScore: 48 });
const sorted = [...scoresAreas.macroCompetencies].sort((a, b) => b.percent - a.percent);
const areaOrder = [...htmlExec.matchAll(/class="sjt-area-name">([^<]+)/g)].map((m) => m[1]);
check(areaOrder.length === 4, 'áreas: 4 filas');
check(areaOrder[0] === sorted[0].label, 'áreas: primera fila = mayor %');
const neg = scoresAreas.macroCompetencies.find((m) => m.key === 'negociacion_cierre');
check(
  htmlExec.includes(`${neg.rawScore} / ${neg.maxPossible}`),
  'áreas: puntos / máximo en meta',
);

console.log('\n--- confiabilidad velocidad ---');
check(!htmlExec.includes('Alertas y banderas'), 'velocidad: sin sección alertas vacía');
check(!FRAGMENT_SRC.includes('SJT_PDF_SPEED_THRESHOLD_SEC'), 'velocidad: sin threshold PDF 3s');
check(!FRAGMENT_SRC.includes('avgSecondsPerQuestion <'), 'velocidad: sin regla paralela avg en fragmento');

const reliable = buildScores({ rawScore: 48 });
const attReliable = attempt({
  scores: { ...reliable, meta: { reliability: { isUnreliableSpeed: false, avgSecondsPerQuestion: 2 } } },
});
check(sjtSpeedUnreliable(attReliable.scores, attReliable) === false, 'velocidad: avg 2s sin flag → no alerta');

const unreliableScores = {
  ...reliable,
  meta: { reliability: { isUnreliableSpeed: true, avgSecondsPerQuestion: 0.5 } },
};
const htmlUnrel = buildSjtSalesModuleFragment({
  scores: unreliableScores,
  submittedAt: '19/09/2026',
  attempt: attempt(unreliableScores),
});
check(htmlUnrel.includes('sjt-pill-reliability'), 'velocidad: pill en ejecutivo si isUnreliableSpeed');
check(htmlUnrel.includes('ALERTA DE CONFIABILIDAD'), 'velocidad: texto oficial scoring');

console.log('\n--- extract scores ---');
const extracted = extractSjtSalesScores(attempt({ scores: buildScores({ rawScore: 60 }) }));
check(extracted?.rawScore === 60, 'extract: rawScore');

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

console.log(
  failed === 0
    ? '\n✓ SJT Enterprise Fase 1 — todos los escenarios pasaron.\n'
    : `\n✗ ${failed} fallo(s).\n`,
);
process.exit(failed === 0 ? 0 : 1);

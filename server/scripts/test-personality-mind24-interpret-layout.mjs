/**
 * QA layout — interpretación Personalidad Mind24 (Fase 4C.4C).
 * Ejecutar: node server/scripts/test-personality-mind24-interpret-layout.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PERSONALIDAD_MIND24_DIMENSIONS } from '../src/data/personalityMind24Data.js';
import { buildModuleFragment } from '../src/reports/moduleFragments.js';
import { buildUnifiedReportHtml } from '../src/reports/unifiedReport.template.js';
import { buildModuleCoverSummaries } from '../src/reports/coverSummary.js';
import { buildPersonalityMind24ModuleFragment } from '../src/reports/fragments/personalityMind24Report.fragment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');
const TEMPLATE_PATH = path.join(__dirname, '../src/reports/unifiedReport.template.js');

const LONG_DIMENSION_LABELS = [
  'Regulación bajo presión y tolerancia a la frustración',
  'Adaptabilidad y flexibilidad ante el cambio',
  'Influencia y persuasión interpersonal',
  'Autonomía y seguridad para decidir',
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

function buildScoresPayload(mean = 3.2) {
  const dimensions = {};
  for (const dim of PERSONALIDAD_MIND24_DIMENSIONS) {
    dimensions[dim.dimensionId] = {
      dimensionId: dim.dimensionId,
      label: dim.label,
      mean,
      nAnswered: 8,
      nExpected: 8,
      scaleMin: 1,
      scaleMax: 5,
    };
  }
  const dimensionRows = PERSONALIDAD_MIND24_DIMENSIONS.map((def) => ({
    dimensionId: def.dimensionId,
    sortOrder: def.sortOrder,
    label: def.label,
    mean,
    nAnswered: 8,
    nExpected: 8,
  }));
  return {
    instrument: 'personalidad_mind24',
    form: { totalItemsExpected: 80, itemsPerDimension: 8 },
    dimensions,
    dimensionRows,
    meta: { applicationQuality: { completeness: { answeredCount: 80, expectedCount: 80 } } },
  };
}

console.log('\n=== Personalidad Mind24 — layout interpretación (4C.4C) ===\n');

const templateCss = fs.readFileSync(TEMPLATE_PATH, 'utf8');
check(templateCss.includes('.pm24-interpret-hd{display:flex;flex-direction:column'), 'CSS: cabecera tarjeta en columna');
check(!/pm24-interpret-freq\{[^}]*white-space:nowrap/.test(templateCss), 'CSS: frecuencia permite wrap');
check(/pm24-interpret-slot\{[^}]*break-inside:auto/.test(templateCss), 'CSS: slot permite paginación');
check(templateCss.includes('pm24-interpret-summary'), 'CSS: bloque síntesis con break-inside avoid');
check(/\.pm24-interpret-row\{[^}]*break-inside:avoid/.test(templateCss), 'CSS: tarjeta no partida en impresión');

const scores = buildScoresPayload(3.4);
const fragment = buildPersonalityMind24ModuleFragment({ scores, submittedAt: '10 oct 2026' });

check((fragment.match(/pm24-interpret-row/g) || []).length === 10, '10 tarjetas interpretación');
check(fragment.includes('pm24-interpret-summary'), 'HTML: bloque síntesis');
check(fragment.includes('pm24-interpret-by-dim'), 'HTML: bloque lectura por dimensión');

for (const label of LONG_DIMENSION_LABELS) {
  check(fragment.includes(label), `HTML incluye dimensión larga: ${label.slice(0, 40)}…`);
  check(
    new RegExp(`<h4 class="pm24-interpret-dim">${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h4>`).test(
      fragment,
    ),
    `tarjeta con título largo: ${label.slice(0, 28)}…`,
  );
}

const att = {
  id: 'att-pm24-layout',
  moduleKey: 'personalidad_mind24',
  status: 'submitted',
  submittedAt: new Date('2026-10-10T15:00:00Z'),
  scores: buildScoresPayload(3.4),
  interpretation: {},
  flags: [],
};

const cleaverAtt = {
  id: 'att-cleaver',
  moduleKey: 'cleaver',
  status: 'submitted',
  submittedAt: new Date('2026-10-10T15:00:00Z'),
  scores: {
    most: { D: 8, I: 4, S: 3, C: 5 },
    least: { D: 2, I: 5, S: 6, C: 3 },
    total: { D: 6, I: -1, S: -3, C: 2 },
  },
};

const cleBefore = buildModuleFragment(cleaverAtt);
const summaries = buildModuleCoverSummaries([att]);
const fullHtml = buildUnifiedReportHtml({
  organizationName: 'Mind24 Demo',
  candidateName: 'Candidato Layout QA',
  puesto: 'Puesto demo',
  curp: '—',
  modulesAppliedLine: summaries.map((s) => s.title).join(', '),
  moduleCount: 1,
  completedAt: '10 oct 2026',
  moduleCoverSummaries: summaries,
  logoDataUri: null,
  moduleFragmentsHtml: buildModuleFragment(att),
  generatedDate: '2026-10-10',
});

check(/page-break-after:always/.test(fullHtml), 'portada: salto de página');
check(fullHtml.includes('pm24-radar'), 'visual: radar presente');
check(buildModuleFragment(cleaverAtt) === cleBefore, 'Cleaver HTML idéntico');

fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, 'report-pm24-interpret-layout-qa.html');
fs.writeFileSync(outPath, fullHtml, 'utf8');
check(fs.existsSync(outPath), `fixture → ${outPath}`);

console.log(
  failed === 0
    ? '\n✓ Personalidad Mind24 layout interpretación — OK.\n'
    : `\n✗ ${failed} fallo(s).\n`,
);
process.exit(failed === 0 ? 0 : 1);

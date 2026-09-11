/**
 * Genera muestras HTML del reporte Cleaver Enterprise Fase 2.
 * Ejecutar: node server/scripts/generate-cleaver-phase2-samples.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildModuleCoverSummaries } from '../src/reports/coverSummary.js';
import { buildUnifiedReportHtml } from '../src/reports/unifiedReport.template.js';
import { buildModuleFragment } from '../src/reports/moduleFragments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');

function attempt(name, total, most, least, meta = { tetradCount: 24 }) {
  return {
    id: `att-${name}`,
    moduleKey: 'cleaver',
    status: 'submitted',
    submittedAt: new Date('2026-09-11T18:00:00Z'),
    scores: {
      instrument: 'cleaver',
      moduleKey: 'cleaver',
      scores: { most, least, total },
      meta,
    },
    interpretation: {},
    flags: [],
  };
}

const SCENARIOS = [
  {
    name: 'cleaver-di-claro',
    total: { D: 6, I: 4, C: 0, S: -2 },
    most: { D: 10, I: 8, S: 5, C: 4 },
    least: { D: 4, I: 4, S: 7, C: 4 },
  },
  {
    name: 'cleaver-dc-claro',
    total: { D: 5, C: 3, I: 0, S: -1 },
    most: { D: 9, I: 5, S: 4, C: 7 },
    least: { D: 4, I: 5, S: 5, C: 4 },
  },
  {
    name: 'cleaver-is-claro',
    total: { I: 5, S: 4, D: 0, C: -1 },
    most: { I: 9, S: 8, D: 4, C: 3 },
    least: { I: 4, S: 4, D: 4, C: 4 },
  },
  {
    name: 'cleaver-sc-claro',
    total: { S: 5, C: 3, I: 0, D: -2 },
    most: { S: 8, C: 7, I: 4, D: 3 },
    least: { S: 3, C: 4, I: 4, D: 5 },
  },
  {
    name: 'cleaver-co-dominancia',
    total: { D: 5, I: 5, S: 0, C: -2 },
    most: { D: 9, I: 9, S: 5, C: 3 },
    least: { D: 4, I: 4, S: 5, C: 5 },
  },
  {
    name: 'cleaver-poco-diferenciado',
    total: { D: 2, I: 1, S: 1, C: 0 },
    most: { D: 7, I: 6, S: 6, C: 5 },
    least: { D: 5, I: 5, S: 5, C: 5 },
  },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const sc of SCENARIOS) {
  const att = attempt(sc.name, sc.total, sc.most, sc.least);
  const summaries = buildModuleCoverSummaries([att]);
  const html = buildUnifiedReportHtml({
    organizationName: 'Talento24 Demo',
    candidateName: 'María López',
    puesto: 'Ejecutivo Comercial',
    curp: 'LOPM850101MDFRRR09',
    modulesAppliedLine: summaries.map((s) => s.title).join(', '),
    moduleCount: 1,
    completedAt: '11 sep 2026, 6:00 p.m.',
    moduleCoverSummaries: summaries,
    logoDataUri: null,
    moduleFragmentsHtml: buildModuleFragment(att) || '',
    generatedDate: '2026-09-11',
  });
  const outPath = path.join(OUT_DIR, `report-${sc.name}.html`);
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`  → ${outPath}`);
}

console.log('\n✓ Muestras Cleaver Fase 2 generadas.\n');

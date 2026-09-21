/**
 * QA paginación continua — PDF consolidado 4 módulos (Hon + Cle + Cog + SJT).
 * Ejecutar: node server/scripts/test-report-pagination-qa.mjs
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildModuleCoverSummaries } from '../src/reports/coverSummary.js';
import { buildUnifiedReportHtml } from '../src/reports/unifiedReport.template.js';
import { buildModuleFragment } from '../src/reports/moduleFragments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');
const TEMPLATE_PATH = path.join(__dirname, '../src/reports/unifiedReport.template.js');

function attempt(moduleKey, scores, interpretation = {}) {
  return {
    id: `att-${moduleKey}`,
    moduleKey,
    status: 'submitted',
    submittedAt: new Date('2026-09-08T18:00:00Z'),
    scores,
    interpretation,
    flags: [],
  };
}

const attempts = [
  attempt(
    'honestidad',
    { global: 88.5, dimensions: { honestidad: { label: 'Honestidad', avg: 88.5 } } },
    { verdict: 'Aprobatorio', badge: '✅' },
  ),
  attempt('cleaver', {
    scores: {
      most: { D: 8, I: 4, S: 3, C: 5 },
      least: { D: 2, I: 5, S: 6, C: 3 },
      total: { D: 6, I: -1, S: -3, C: 2 },
    },
  }),
  attempt('terman', {
    scores: {
      rawScore: 42,
      totalQuestions: 50,
      percentCorrect: 84,
      answeredCount: 50,
      unansweredCount: 0,
      completionRate: 100,
      series: [],
    },
  }),
  attempt('sales_sjt', {
    scores: {
      rawScore: 58,
      maxPossible: 75,
      profileLabel: 'Ejecutivo de cierre ágil',
      profileKey: 'ejecutivo_cierre_agil',
    },
  }),
];

function extractMasterStyles(source) {
  const m = source.match(/const MASTER_STYLES = `([\s\S]*?)`\s*;/);
  if (!m) throw new Error('MASTER_STYLES no encontrado');
  return m[1];
}

function buildFourModuleHtml(stylesOverride = null) {
  const summaries = buildModuleCoverSummaries(attempts);
  let html = buildUnifiedReportHtml({
    organizationName: 'Talento24 Demo',
    candidateName: 'María López',
    puesto: 'Ejecutivo Comercial',
    curp: 'LOPM850101MDFRRR09',
    modulesAppliedLine: summaries.map((s) => s.title).join(', '),
    moduleCount: summaries.length,
    completedAt: '8 sep 2026, 6:00 p.m.',
    moduleCoverSummaries: summaries,
    logoDataUri: null,
    moduleFragmentsHtml: attempts.map((att) => buildModuleFragment(att) || '').filter(Boolean).join('\n'),
    generatedDate: '2026-09-08',
  });
  if (stylesOverride) {
    html = html.replace(/<style>[\s\S]*?<\/style>/, `<style>${stylesOverride}</style>`);
  }
  return html;
}

function countPdfPages(buf) {
  const s = buf.toString('latin1');
  const matches = s.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 0;
}

function cssRulePresent(styles, snippet) {
  return styles.includes(snippet);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const currentSource = fs.readFileSync(TEMPLATE_PATH, 'utf8');
const newStyles = extractMasterStyles(currentSource);

let baselineSource;
try {
  baselineSource = execSync('git show HEAD:server/src/reports/unifiedReport.template.js', {
    encoding: 'utf8',
    cwd: path.join(__dirname, '../..'),
  });
} catch {
  baselineSource = currentSource;
  console.warn('  WARN: no se pudo leer baseline git HEAD; before=after');
}
const oldStyles = extractMasterStyles(baselineSource);

const htmlAfter = buildFourModuleHtml();
const htmlBefore = buildFourModuleHtml(oldStyles);

fs.writeFileSync(path.join(OUT_DIR, 'report-enterprise-pagination-after.html'), htmlAfter, 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'report-enterprise-pagination-before.html'), htmlBefore, 'utf8');

console.log('\n=== QA paginación Enterprise (4 módulos) ===\n');

const removed = [
  { rule: '.module-block page-break-inside:avoid', was: cssRulePresent(oldStyles, 'page-break-inside:avoid') && oldStyles.includes('.module-block{') },
  { rule: '.module-block:last-of-type break-after:avoid', was: oldStyles.includes('.module-block:last-of-type') },
  { rule: '.cog-descriptive-block break-inside:avoid', was: oldStyles.includes('.cog-descriptive-block{break-inside:avoid') },
  { rule: '.cog-group-grid break-inside:avoid', was: oldStyles.includes('.cog-group-grid{display:flex') && /cog-group-grid\{[^}]*break-inside:avoid/.test(oldStyles) },
  { rule: '.sjt-areas-block break-inside:avoid', was: oldStyles.includes('.sjt-areas-block{break-inside:avoid') },
  { rule: '.sjt-rh-block break-inside:avoid', was: oldStyles.includes('.sjt-rh-block{break-inside:avoid') },
];

for (const r of removed) {
  console.log(`  ${r.was ? '−' : '·'} ${r.rule}`);
}

const protectedNow = [
  '.section-title break-after:avoid',
  '.hon-exec / .cle-exec / .cog-exec / .sjt-exec break-inside:avoid',
  '.hon-attention-item, .cle-rh-card, .cog-rh-card, .cog-group-card',
  '.sjt-area-row, .sjt-rh-card, .sjt-rh-profile, .sjt-profile-reading, .sjt-tech',
  '.cle-tech, .kpi-card, .change-card, .chart-box, .cle-workplace-card',
  '.footer break-before:avoid + break-inside:avoid',
  '.cover-page page-break-after:always (sin cambio)',
];
console.log('\n  Elementos aún protegidos contra cortes:');
for (const p of protectedNow) console.log(`    · ${p}`);

let pagesBefore = null;
let pagesAfter = null;

try {
  const { renderHtmlToPdfBuffer } = await import('../src/services/pdf.service.js');
  const bufBefore = await renderHtmlToPdfBuffer(htmlBefore);
  const bufAfter = await renderHtmlToPdfBuffer(htmlAfter);
  pagesBefore = countPdfPages(bufBefore);
  pagesAfter = countPdfPages(bufAfter);
  fs.writeFileSync(path.join(OUT_DIR, 'report-enterprise-pagination-before.pdf'), bufBefore);
  fs.writeFileSync(path.join(OUT_DIR, 'report-enterprise-pagination-after.pdf'), bufAfter);
  console.log(`\n  Páginas PDF (portada + cuerpo): ANTES ${pagesBefore} → DESPUÉS ${pagesAfter} (Δ ${pagesBefore - pagesAfter})`);
  console.log(`  PDF → ${path.relative(process.cwd(), path.join(OUT_DIR, 'report-enterprise-pagination-after.pdf'))}`);
} catch (e) {
  console.log(`\n  PDF omitido (${e.message || 'Puppeteer/Chromium no disponible'})`);
  console.log('  HTML before/after en server/scripts/output/');
}

const stillRisky = [];
if (newStyles.includes('.cle-mlt-panel') && !/cle-mlt-panel\{[^}]*break-inside:avoid/.test(newStyles)) {
  stillRisky.push('Triada Cleaver (.cle-mlt-panel ×3): puede forzar salto si no cabe junta, pero ya no evita corte del módulo entero.');
}
if (!newStyles.includes('.cog-descriptive-block')) {
  stillRisky.push('Agrupación Cognitiva: grid de 3 tarjetas puede partirse entre páginas (solo cada .cog-group-card evita corte interno).');
}
if (stillRisky.length) {
  console.log('\n  Bloques que aún pueden dejar hueco vertical:');
  for (const b of stillRisky) console.log(`    · ${b}`);
}

console.log('\n');

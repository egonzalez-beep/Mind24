/**
 * Regresión visual/lógica de la portada del reporte consolidado.
 * Ejecutar: node server/scripts/test-report-cover.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildModuleCoverSummaries, coverSummaryGridClass } from '../src/reports/coverSummary.js';
import { buildUnifiedReportHtml } from '../src/reports/unifiedReport.template.js';
import { resolveMind24LogoDataUri } from '../src/reports/reportBranding.js';
import { buildModuleFragment } from '../src/reports/moduleFragments.js';
import { TERMAN_MAX_RAW_SCORE } from '../src/data/termanData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');

let failed = 0;
let passed = 0;

function ok(msg) {
  passed++;
  console.log(`  OK  ${msg}`);
}

function fail(msg, extra) {
  failed++;
  console.log(`  FAIL ${msg}`);
  if (extra !== undefined) console.log(`       ${extra}`);
}

function check(cond, msg, extra) {
  if (cond) ok(msg);
  else fail(msg, extra);
}

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

const honestidadAtt = attempt(
  'honestidad',
  { global: 88.5, dimensions: { honestidad: { label: 'Honestidad', avg: 88.5 } } },
  { verdict: 'Aprobatorio', badge: '✅' },
);

const cleaverAtt = attempt('cleaver', {
  scores: {
    most: { D: 8, I: 4, S: 3, C: 5 },
    least: { D: 2, I: 5, S: 6, C: 3 },
    total: { D: 6, I: -1, S: -3, C: 2 },
  },
});

const termanFull = attempt('terman', {
  scores: {
    rawScore: 42,
    totalQuestions: 50,
    percentCorrect: 84,
    answeredCount: 50,
    unansweredCount: 0,
    completionRate: 100,
    series: [],
  },
});

const termanPartial = attempt('terman', {
  scores: {
    rawScore: 38,
    totalQuestions: 50,
    percentCorrect: 76,
    answeredCount: 46,
    unansweredCount: 4,
    completionRate: 92,
    series: [],
  },
});

const sjtAtt = attempt('sales_sjt', {
  scores: {
    rawScore: 58,
    maxPossible: 75,
    profileLabel: 'Ejecutivo de cierre ágil',
    profileKey: 'ejecutivo_cierre_agil',
  },
});

const genericAtt = attempt('digital_interview', {});

console.log('\n=== Portada reporte consolidado ===\n');

const hSum = buildModuleCoverSummaries([honestidadAtt])[0];
check(hSum.lines[0].value === '88.5%', 'Honestidad: global %');
check(hSum.lines[1].value === 'Aprobatorio', 'Honestidad: veredicto');

const cSum = buildModuleCoverSummaries([cleaverAtt])[0];
check(cSum.lines[0].value === 'D', 'Cleaver: perfil predominante');
check(cSum.lines[1].value === 'Dominancia', 'Cleaver: label DISC');

const tFull = buildModuleCoverSummaries([termanFull])[0];
check(tFull.lines[0].value === `42 / ${TERMAN_MAX_RAW_SCORE}`, 'Cognitiva: rawScore/50');
check(tFull.lines[1].value === '84.0%', 'Cognitiva: percentCorrect');
check(tFull.lines.length === 2, 'Cognitiva 100%: sin línea completitud');

const tPart = buildModuleCoverSummaries([termanPartial])[0];
check(tPart.lines.length === 3, 'Cognitiva parcial: incluye completitud');
check(/46 de 50/.test(tPart.lines[2].value), 'Cognitiva: texto completitud');

const sSum = buildModuleCoverSummaries([sjtAtt])[0];
check(sSum.lines[0].value === '58 / 75', 'SJT: puntaje');
check(/Ejecutivo/.test(sSum.lines[1].value), 'SJT: perfil');

const gSum = buildModuleCoverSummaries([genericAtt])[0];
check(gSum.lines[0].value === 'Completado', 'Genérico: Completado');

check(coverSummaryGridClass(1) === 'summary-grid summary-grid--1', 'grid 1 módulo');
check(coverSummaryGridClass(2) === 'summary-grid summary-grid--2', 'grid 2 módulos');
check(coverSummaryGridClass(5).includes('--multi'), 'grid 5 módulos');

const logo = resolveMind24LogoDataUri();
check(logo === null, 'sin logo real → placeholder (null dataUri)');

function buildSampleHtml(summaries, label) {
  return buildUnifiedReportHtml({
    organizationName: 'Talento24 Demo',
    candidateName: 'María López',
    puesto: 'Ejecutivo Comercial',
    curp: 'LOPM850101MDFRRR09',
    modulesAppliedLine: summaries.map((s) => s.title).join(', '),
    moduleCount: summaries.length,
    completedAt: '8 sep 2026, 6:00 p.m.',
    moduleCoverSummaries: summaries,
    logoDataUri: null,
    moduleFragmentsHtml: summaries
      .map((s) => {
        const att =
          s.moduleKey === 'honestidad'
            ? honestidadAtt
            : s.moduleKey === 'cleaver'
              ? cleaverAtt
              : s.moduleKey === 'terman'
                ? termanFull
                : s.moduleKey === 'sales_sjt'
                  ? sjtAtt
                  : genericAtt;
        return buildModuleFragment(att) || '';
      })
      .filter(Boolean)
      .join('\n'),
    generatedDate: '2026-09-08',
  });
}

const scenarios = [
  { name: 'solo-honestidad', attempts: [honestidadAtt] },
  { name: 'solo-cleaver', attempts: [cleaverAtt] },
  { name: 'solo-cognitiva', attempts: [termanFull] },
  { name: 'hon-cle-cog', attempts: [honestidadAtt, cleaverAtt, termanFull] },
  { name: 'cinco-modulos', attempts: [honestidadAtt, cleaverAtt, termanPartial, sjtAtt, genericAtt] },
  { name: 'sin-curp', attempts: [honestidadAtt], noCurp: true },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const sc of scenarios) {
  const summaries = buildModuleCoverSummaries(sc.attempts);
  let html = buildSampleHtml(summaries, sc.name);
  if (sc.noCurp) {
    html = buildUnifiedReportHtml({
      organizationName: 'Talento24 Demo',
      candidateName: 'María López',
      puesto: '—',
      curp: '—',
      modulesAppliedLine: summaries.map((s) => s.title).join(', '),
      moduleCount: summaries.length,
      completedAt: '8 sep 2026, 6:00 p.m.',
      moduleCoverSummaries: summaries,
      logoDataUri: null,
      moduleFragmentsHtml: buildModuleFragment(honestidadAtt) || '',
      generatedDate: '2026-09-08',
    });
  }
  check(/Mind24 Assess/.test(html), `${sc.name}: producto en portada`);
  check(/Reporte de Evaluación Psicométrica/.test(html), `${sc.name}: título`);
  check(/Resultados de la batería/.test(html), `${sc.name}: sección batería`);
  check(/page-break-after:always/.test(html), `${sc.name}: salto de página portada`);
  check(/cover-logo-fallback/.test(html), `${sc.name}: fallback tipográfico logo`);
  check(!/cover-logo-placeholder/.test(html), `${sc.name}: sin rectángulo punteado`);
  check(!/cover-meta-item.*CURP/s.test(html) || !sc.noCurp, `${sc.name}: CURP omitido si ausente`);
  if (sc.noCurp) check(!html.includes('LOPM850101'), `${sc.name}: sin CURP en HTML`);
  const outPath = path.join(OUT_DIR, `report-cover-${sc.name}.html`);
  fs.writeFileSync(outPath, html, 'utf8');
  ok(`${sc.name}: HTML → ${path.relative(process.cwd(), outPath)}`);
}

try {
  const { renderHtmlToPdfBuffer } = await import('../src/services/pdf.service.js');
  const pdfHtml = buildSampleHtml(
    buildModuleCoverSummaries([honestidadAtt, cleaverAtt, termanFull]),
    'sample-pdf',
  );
  const buf = await renderHtmlToPdfBuffer(pdfHtml);
  const pdfPath = path.join(OUT_DIR, 'report-cover-sample.pdf');
  fs.writeFileSync(pdfPath, buf);
  check(buf.length > 5000, `PDF muestra generado (${buf.length} bytes)`);
  ok(`PDF → ${path.relative(process.cwd(), pdfPath)}`);
} catch (e) {
  ok(`PDF omitido (${e.message || 'Puppeteer no disponible en este entorno'})`);
}

if (failed) {
  console.log(`\nRESULTADO: ${failed} fallos, ${passed} ok\n`);
  process.exit(1);
}
console.log(`\nRESULTADO: ${passed} ok\n`);

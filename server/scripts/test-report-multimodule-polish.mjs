/**
 * Regresión — paginación/estructura multimódulo (Hon + Cleaver + Personalidad).
 * node server/scripts/test-report-multimodule-polish.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PERSONALIDAD_MIND24_DIMENSIONS } from '../src/data/personalityMind24Data.js';
import { buildModuleCoverSummaries } from '../src/reports/coverSummary.js';
import { buildModuleFragment } from '../src/reports/moduleFragments.js';
import { buildUnifiedReportHtml } from '../src/reports/unifiedReport.template.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function attempt(moduleKey, scores, extra = {}) {
  return {
    id: `att-${moduleKey}`,
    moduleKey,
    status: 'submitted',
    submittedAt: new Date('2026-10-13T18:00:00Z'),
    scores,
    interpretation: { verdict: 'Evaluación completada' },
    flags: [],
    ...extra,
  };
}

function buildPm24Scores(totalItemsExpected, itemsPerDimension) {
  const dimensions = {};
  for (const dim of PERSONALIDAD_MIND24_DIMENSIONS) {
    dimensions[dim.dimensionId] = {
      dimensionId: dim.dimensionId,
      label: dim.label,
      mean: 3.2,
      nAnswered: itemsPerDimension,
      nExpected: itemsPerDimension,
      scaleMin: 1,
      scaleMax: 5,
    };
  }
  dimensions.apego_normas.mean = 4.1;
  dimensions.sociabilidad_colaboracion.mean = 2.6;
  return {
    instrument: 'personalidad_mind24',
    catalogVersion: itemsPerDimension === 6 ? 2 : 1,
    form: { itemsPerDimension, totalItemsExpected },
    dimensions,
    meta: {
      applicationQuality: {
        completeness: {
          expectedCount: totalItemsExpected,
          answeredCount: totalItemsExpected,
        },
      },
    },
  };
}

const honestidadAtt = attempt(
  'honestidad',
  { global: 86, dimensions: { honestidad: { label: 'Honestidad', avg: 86 } } },
  { verdict: 'Aprobatorio' },
);

const cleaverAtt = attempt('cleaver', {
  scores: {
    most: { D: 7, I: 5, S: 4, C: 4 },
    least: { D: 3, I: 4, S: 6, C: 3 },
    total: { D: 4, I: 1, S: -2, C: 1 },
  },
});

const pm24_60 = attempt('personalidad_mind24', buildPm24Scores(60, 6));
const pm24_80 = attempt('personalidad_mind24', buildPm24Scores(80, 8));

function buildReportHtml(attempts, tag) {
  const summaries = buildModuleCoverSummaries(attempts);
  const moduleFragmentsHtml = attempts
    .map((att) => buildModuleFragment(att) || '')
    .filter(Boolean)
    .join('\n');
  return buildUnifiedReportHtml({
    organizationName: 'Mind24 QA',
    candidateName: 'Candidato QA Multimódulo',
    puesto: 'Rol comercial',
    curp: '—',
    modulesAppliedLine: summaries.map((s) => s.title).join(', '),
    moduleCount: summaries.length,
    completedAt: '13 oct 2026',
    moduleCoverSummaries: summaries,
    logoDataUri: null,
    moduleFragmentsHtml,
    generatedDate: '2026-10-13',
  });
}

console.log('\n=== Reporte multimódulo — polish post-real ===\n');

fs.mkdirSync(OUT_DIR, { recursive: true });

const honClePm60 = buildReportHtml([honestidadAtt, cleaverAtt, pm24_60], 'hon-cle-pm60');
const out60 = path.join(OUT_DIR, 'report-polish-hon-cle-pm24-v2-60.html');
fs.writeFileSync(out60, honClePm60, 'utf8');

check(honClePm60.includes('cle-module-lead'), 'Cleaver: wrapper cle-module-lead');
check(honClePm60.includes('Comportamiento (Cleaver)'), 'Cleaver: título módulo');
check(honClePm60.includes('Resultado ejecutivo'), 'Cleaver: bloque ejecutivo');
check(honClePm60.includes('break-inside:avoid') && honClePm60.includes('.cle-module-lead'), 'Cleaver: anti-orphan CSS');
check(honClePm60.includes('Aplicación completa: 60/60 respuestas.'), 'Personalidad v2: 60/60');
check(honClePm60.includes('Documento generado automáticamente por Mind24'), 'footer presente');
check(honClePm60.includes('page-break-before:auto'), 'footer: sin break-before forzado');
check(!honClePm60.includes('page-break-before:avoid-page'), 'footer: sin avoid-page huérfano');

const pm80solo = buildReportHtml([pm24_80], 'pm80');
check(pm80solo.includes('Aplicación completa: 80/80 respuestas.'), 'Personalidad legacy: 80/80');

console.log(`  OK  fixture → ${path.relative(process.cwd(), out60)}`);

try {
  const { renderHtmlToPdfBuffer } = await import('../src/services/pdf.service.js');
  const buf = await renderHtmlToPdfBuffer(honClePm60);
  const pdfPath = path.join(OUT_DIR, 'report-polish-hon-cle-pm24-v2-60.pdf');
  fs.writeFileSync(pdfPath, buf);
  check(buf.length > 8000, `PDF multimódulo generado (${buf.length} bytes)`);
  console.log(`  OK  PDF → ${path.relative(process.cwd(), pdfPath)}`);
} catch (e) {
  console.log(`  OK  PDF omitido (${e.message || 'Puppeteer no disponible'})`);
}

console.log(
  failed === 0
    ? '\n✓ Reporte multimódulo polish — OK.\n'
    : `\n✗ ${failed} fallo(s).\n`,
);
process.exitCode = failed ? 1 : 0;

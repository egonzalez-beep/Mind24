/**
 * PDF/HTML QA visual — batería Enterprise realista (Hon + Cle + Cog + SJT).
 * Ejecutar: node server/scripts/generate-report-enterprise-visual-qa.mjs
 *
 * Requiere Chromium/Chrome (PUPPETEER_EXECUTABLE_PATH en Windows).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defaultDemoAssessmentConfig } from '../src/assessment/defaultDefinition.js';
import { scoreAssessment } from '../src/services/scoring.service.js';
import {
  applyHonestidadCalibrationReliabilityLayer,
  applyHonestidadSpeedReliabilityLayer,
  computeHonestidadDurationReliability,
} from '../src/services/attemptReliability.service.js';
import { fillBestLikertAnswers } from './honestidadTestHelpers.mjs';
import { termanQuestionsFlat } from '../src/data/termanData.js';
import { scoreTermanResponses, buildTermanAttemptScores } from '../src/services/termanScoring.service.js';
import {
  SJT_SALES_MACRO_GROUPS,
  computeSjtSalesMacroCompetencies,
  resolveSjtSalesProfile,
} from '../src/services/sjtSalesScoring.service.js';
import { SJT_SALES_MAX_POINTS, SJT_SALES_SCENARIOS } from '../src/data/sjtSalesData.js';
import { buildModuleCoverSummaries } from '../src/reports/coverSummary.js';
import { buildUnifiedReportHtml } from '../src/reports/unifiedReport.template.js';
import { buildModuleFragment } from '../src/reports/moduleFragments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');
const OUT_BASE = 'report-enterprise-visual-qa';

function buildHonestidadAttempt() {
  const answers = {};
  ['c1', 'c2', 'c3', 'c4', 'c5'].forEach((id) => {
    answers[id] = 0;
  });
  ['d1', 'd2', 'd3', 'd4', 'd5'].forEach((id) => {
    answers[id] = 0;
  });
  fillBestLikertAnswers(defaultDemoAssessmentConfig, answers);
  const scored = scoreAssessment(defaultDemoAssessmentConfig, answers);
  const cal = applyHonestidadCalibrationReliabilityLayer({
    scored,
    flags: scored.flags,
    moduleKey: 'honestidad',
  });
  const startedAt = new Date('2026-09-08T16:00:00Z');
  const submittedAt = new Date('2026-09-08T16:04:00Z');
  const speedRel = computeHonestidadDurationReliability({ startedAt, submittedAt });
  const out = applyHonestidadSpeedReliabilityLayer({
    scored: cal.scores,
    flags: cal.flags,
    interpretation: cal.interpretation,
    reliability: speedRel,
    moduleKey: 'honestidad',
  });
  return {
    id: 'qa-hon',
    moduleKey: 'honestidad',
    status: 'submitted',
    submittedAt,
    scores: out.scores,
    interpretation: out.interpretation,
    flags: out.flags,
  };
}

function buildCleaverAttempt() {
  return {
    id: 'qa-cle',
    moduleKey: 'cleaver',
    status: 'submitted',
    submittedAt: new Date('2026-09-08T16:12:00Z'),
    scores: {
      most: { D: 8, I: 4, S: 3, C: 5 },
      least: { D: 2, I: 5, S: 6, C: 3 },
      total: { D: 6, I: -1, S: -3, C: 2 },
    },
    flags: [],
  };
}

/** ~76% aciertos, 10 series calificadas — volumen similar a producción. */
function buildTermanAttempt() {
  const flat = termanQuestionsFlat();
  const rows = flat.map((row, idx) => {
    const wrong = idx % 4 === 3;
    const sortOrder = wrong ? (row.correctIndex === 0 ? 1 : 0) : row.correctIndex;
    return {
      questionId: row.termanItemId,
      selectedOptionId: 'sel',
      question: {
        metadata: { seriesId: row.seriesId, correctIndex: row.correctIndex },
      },
      selectedOption: { sortOrder },
    };
  });
  const scoring = scoreTermanResponses(rows);
  scoring.answeredCount = 50;
  scoring.unansweredCount = 0;
  scoring.completionRate = 100;
  const wrapped = buildTermanAttemptScores(scoring);
  return {
    id: 'qa-terman',
    moduleKey: 'terman',
    status: 'submitted',
    submittedAt: new Date('2026-09-08T16:28:00Z'),
    scores: wrapped.scores,
    flags: [],
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

function buildSjtAttempt() {
  const byScenarioPoints = pointsByGroupPattern({
    groupPoints: {
      negociacion_cierre: 5,
      prospeccion_apertura: 4,
      fidelizacion_retencion: 2,
      etica_crisis: 1,
    },
  });
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
  const profile = resolveSjtSalesProfile(rawScore);
  const scores = {
    rawScore,
    maxPossible: SJT_SALES_MAX_POINTS,
    totalScenarios: 15,
    percentScore: Math.round((rawScore / SJT_SALES_MAX_POINTS) * 1000) / 10,
    profileKey: profile.key,
    profileLabel: profile.label,
    profileDescription: profile.description,
    scenarios,
    macroCompetencies: computeSjtSalesMacroCompetencies(scenarios),
    meta: {
      reliability: { isUnreliableSpeed: false, avgSecondsPerQuestion: 2.4 },
    },
  };
  return {
    id: 'qa-sjt',
    moduleKey: 'sales_sjt',
    status: 'submitted',
    submittedAt: new Date('2026-09-08T16:42:00Z'),
    scores,
    flags: [],
  };
}

function countPdfPages(buf) {
  const s = buf.toString('latin1');
  return (s.match(/\/Type\s*\/Page\b/g) || []).length;
}

function buildConsolidatedHtml(attempts) {
  const summaries = buildModuleCoverSummaries(attempts);
  return buildUnifiedReportHtml({
    organizationName: 'Talento24 Enterprise QA',
    candidateName: 'María López Hernández',
    puesto: 'Ejecutivo Comercial Senior',
    curp: 'LOHM900215MDFRRR08',
    modulesAppliedLine: summaries.map((s) => s.title).join(', '),
    moduleCount: attempts.length,
    completedAt: '8 sep 2026, 4:42 p.m.',
    moduleCoverSummaries: summaries,
    logoDataUri: null,
    moduleFragmentsHtml: attempts.map((att) => buildModuleFragment(att) || '').filter(Boolean).join('\n'),
    generatedDate: '2026-09-08',
  });
}

async function analyzeLayout(page, pdfPageCount) {
  await page.emulateMediaType('print');
  return page.evaluate((pageCount) => {
    const mm = (n) => (n * 96) / 25.4;
    const nominalContentH = mm(297 - 20);

    const cover = document.querySelector('.cover-page');
    const coverBottom = cover ? cover.offsetTop + cover.offsetHeight : 0;
    const docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const detailsHeight = Math.max(0, docHeight - coverBottom);
    const contentH =
      pageCount > 1 && detailsHeight > 0 ? detailsHeight / (pageCount - 1) : nominalContentH;

    const yOf = (el) => {
      const r = el.getBoundingClientRect();
      return r.top + window.scrollY;
    };
    const bottomOf = (el) => {
      const r = el.getBoundingClientRect();
      return r.top + window.scrollY + r.height;
    };
    const pageOfY = (y) => {
      if (y < coverBottom - 1) return 1;
      return 2 + Math.floor((y - coverBottom) / contentH);
    };

    const moduleIds = [
      ['Honestidad', 'mod-honestidad'],
      ['Cleaver', 'mod-cleaver'],
      ['Cognitiva', 'mod-terman'],
      ['SJT', 'mod-sales-sjt'],
    ];
    const moduleStarts = moduleIds.map(([label, id]) => {
      const el = document.getElementById(id);
      if (!el) return { label, page: null, note: 'no encontrado' };
      const top = yOf(el);
      return { label, page: pageOfY(top), topPx: Math.round(top) };
    });

    const footer = document.querySelector('.footer');
    const footerPage = footer ? pageOfY(yOf(footer)) : null;

    const trackSelectors =
      '.section, .module-block, .hon-exec, .cle-exec, .cog-exec, .sjt-exec, .cog-chart-wrap, .cog-group-grid, .cle-triad, .sjt-tech, .footer';
    const tracked = [...document.querySelectorAll(trackSelectors)].filter((el) => el.getBoundingClientRect().height > 8);

    const largeGaps = [];
    for (let p = 2; p <= pageCount; p += 1) {
      const pageStart = coverBottom + (p - 2) * contentH;
      const pageEnd = pageStart + contentH;
      let maxBottom = pageStart;
      for (const el of tracked) {
        const top = yOf(el);
        const bottom = bottomOf(el);
        if (bottom <= pageStart || top >= pageEnd) continue;
        maxBottom = Math.max(maxBottom, Math.min(bottom, pageEnd));
      }
      const gap = pageEnd - maxBottom;
      const gapPct = Math.round((gap / contentH) * 100);
      if (gapPct >= 25) {
        largeGaps.push({ page: p, gapPct, gapPx: Math.round(gap) });
      }
    }

    const orphanTitles = [];
    document.querySelectorAll('.details-page .section').forEach((sec) => {
      const title = sec.querySelector(':scope > .section-title');
      const body = title?.nextElementSibling;
      if (!title || !body) return;
      const tp = pageOfY(yOf(title));
      const bp = pageOfY(yOf(body));
      if (tp !== bp) {
        orphanTitles.push({
          title: title.textContent.trim().slice(0, 60),
          titlePage: tp,
          bodyPage: bp,
        });
      }
    });

    const bigJumpBlocks = [];
    const jumpCandidates = [
      '.cog-chart-wrap',
      '.cog-group-grid',
      '.cle-triad',
      '.sjt-exec',
      '.sjt-areas-section',
      '.sjt-rh-section',
      '.sjt-tech-section',
      '.cle-tech-section',
    ];
    for (const sel of jumpCandidates) {
      document.querySelectorAll(sel).forEach((el) => {
        const top = yOf(el);
        const p = pageOfY(top);
        const prev = el.previousElementSibling;
        if (!prev) return;
        const prevBottom = bottomOf(prev);
        const prevPage = pageOfY(prevBottom - 1);
        const whitespaceBefore = top - prevBottom;
        if (p > prevPage && whitespaceBefore > contentH * 0.2) {
          bigJumpBlocks.push({
            block: sel,
            startsPage: p,
            whitespaceBeforePx: Math.round(whitespaceBefore),
            whitespaceBeforePct: Math.round((whitespaceBefore / contentH) * 100),
          });
        }
      });
    }

    const pageFill = [];
    for (let p = 2; p <= pageCount; p += 1) {
      const pageStart = coverBottom + (p - 2) * contentH;
      const pageEnd = pageStart + contentH;
      let minTop = pageEnd;
      let maxBottom = pageStart;
      for (const el of tracked) {
        const top = yOf(el);
        const bottom = bottomOf(el);
        if (bottom <= pageStart || top >= pageEnd) continue;
        minTop = Math.min(minTop, top);
        maxBottom = Math.max(maxBottom, bottom);
      }
      const used = maxBottom > pageStart ? maxBottom - Math.max(minTop, pageStart) : 0;
      pageFill.push({
        page: p,
        fillPct: Math.round((used / contentH) * 100),
        trailingPct: Math.round(((pageEnd - maxBottom) / contentH) * 100),
      });
    }

    return {
      contentH: Math.round(contentH),
      coverBottom: Math.round(coverBottom),
      docHeight: Math.round(docHeight),
      moduleStarts,
      footerPage,
      largeGaps,
      orphanTitles,
      bigJumpBlocks,
      pageFill,
    };
  }, pdfPageCount);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const attempts = [buildHonestidadAttempt(), buildCleaverAttempt(), buildTermanAttempt(), buildSjtAttempt()];
const html = buildConsolidatedHtml(attempts);
const htmlPath = path.join(OUT_DIR, `${OUT_BASE}.html`);
fs.writeFileSync(htmlPath, html, 'utf8');

console.log('\n=== QA visual Enterprise (batería realista) ===\n');
console.log(`  HTML → ${path.relative(process.cwd(), htmlPath)}`);
console.log(`  Módulos: Honestidad (scoring demo completo), Cleaver Fase 2, Cognitiva 50 reactivos, SJT 15 escenarios`);
console.log(
  `  Cognitiva: ${attempts[2].scores.rawScore}/50 (${attempts[2].scores.percentCorrect}%) · SJT: ${attempts[3].scores.rawScore}/${SJT_SALES_MAX_POINTS}`,
);

let pdfPageCount = null;
let layout = null;

try {
  const { renderHtmlToPdfBuffer } = await import('../src/services/pdf.service.js');
  const pdfBuf = await renderHtmlToPdfBuffer(html);
  pdfPageCount = countPdfPages(pdfBuf);
  const pdfPath = path.join(OUT_DIR, `${OUT_BASE}.pdf`);
  fs.writeFileSync(pdfPath, pdfBuf);
  console.log(`  PDF  → ${path.relative(process.cwd(), pdfPath)} (${pdfBuf.length} bytes)`);

  const { default: puppeteer } = await import('puppeteer-core');
  const exe =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    layout = await analyzeLayout(page, pdfPageCount);
  } finally {
    await browser.close();
  }
} catch (e) {
  console.log(`\n  ERROR generando PDF/análisis: ${e.message}`);
  console.log('  Define PUPPETEER_EXECUTABLE_PATH si Chrome no está en la ruta por defecto.\n');
  process.exit(1);
}

console.log(`\n--- Resumen paginación ---`);
console.log(`  Páginas totales (PDF): ${pdfPageCount}`);
console.log(`  Inicio por módulo (estimado impresión, calibrado al PDF):`);
for (const m of layout.moduleStarts) {
  console.log(`    · ${m.label}: página ${m.page ?? '—'}`);
}
console.log(`  Footer: página ${layout.footerPage ?? '—'}`);

if (layout.pageFill?.length) {
  console.log(`\n  Uso aproximado por página (cuerpo):`);
  for (const pf of layout.pageFill) {
    console.log(`    · Página ${pf.page}: ~${pf.fillPct}% contenido, ~${pf.trailingPct}% libre al pie`);
  }
}

if (layout.largeGaps.length) {
  console.log(`\n  Espacios en blanco ≥ ~25% al cierre de página:`);
  for (const g of layout.largeGaps) {
    console.log(`    · Página ${g.page}: ~${g.gapPct}% libre (${g.gapPx}px)`);
  }
} else {
  console.log(`\n  Espacios en blanco ≥ ~25%: no detectados (heurística layout impresión).`);
}

if (layout.orphanTitles.length) {
  console.log(`\n  Títulos de sección separados del cuerpo (posible huérfano):`);
  for (const o of layout.orphanTitles) {
    console.log(`    · "${o.title}" (título p.${o.titlePage} → contenido p.${o.bodyPage})`);
  }
} else {
  console.log(`\n  Títulos huérfanos: no detectados.`);
}

if (layout.bigJumpBlocks.length) {
  console.log(`\n  Bloques con salto grande / hueco previo (>20% página):`);
  for (const b of layout.bigJumpBlocks) {
    console.log(
      `    · ${b.block} inicia p.${b.startsPage} (~${b.whitespaceBeforePct}% hueco antes del bloque)`,
    );
  }
} else {
  console.log(`\n  Saltos grandes entre bloques adyacentes: no detectados por heurística.`);
}

console.log(`\n  Revisión manual recomendada: abrir ${OUT_BASE}.pdf y validar transiciones Hon→Cle→Cog→SJT.\n`);

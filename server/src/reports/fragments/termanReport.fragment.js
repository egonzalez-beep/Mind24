import { esc } from '../reportUtils.js';
import { TERMAN_MAX_RAW_SCORE } from '../../data/termanData.js';
import { formatTermanCompletenessText } from '../../services/termanScoring.service.js';
import {
  analyzeTermanCognitive,
  getDescriptiveGroupForSeries,
  TERMAN_DESCRIPTIVE_GROUP_NOTE,
} from '../termanCognitiveAnalysis.js';

const SVG_BRAIN = `<svg class="module-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 .88.21 1.71.58 2.45"/><path d="M14.5 2A5.5 5.5 0 0 1 20 7.5c0 .88-.21 1.71-.58 2.45"/><path d="M4 12a8 8 0 0 0 16 0"/><path d="M12 12v10"/><path d="M8 22h8"/></svg>`;

function buildExecutiveBlock(analysis, scores) {
  const completenessPill = analysis.showCompleteness
    ? `<span class="cog-pill cog-pill-partial">${esc(formatTermanCompletenessText(scores))}</span>`
    : '';

  return `<div class="cog-exec">
  <div class="cog-exec-head">
    <div class="cog-exec-kpi cog-exec-kpi-primary">
      <div class="cog-exec-label">Puntaje bruto global</div>
      <div class="cog-exec-code">${analysis.rawScore} <span class="cog-exec-denom">/ ${analysis.totalQuestions}</span></div>
    </div>
    <div class="cog-exec-kpi">
      <div class="cog-exec-label">Porcentaje de aciertos</div>
      <div class="cog-exec-value">${analysis.percentCorrect.toFixed(1)}%</div>
    </div>
  </div>
  ${completenessPill ? `<div class="cog-exec-status">${completenessPill}</div>` : ''}
  <div class="cog-exec-synthesis">
    <p class="interp">${esc(analysis.synthesis)}</p>
  </div>
</div>`;
}

function buildRhList(items, cls) {
  if (!items.length) return `<p class="cog-rh-empty">No aplica con los datos disponibles.</p>`;
  return `<ul class="cog-rh-list ${cls}">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

function buildRhSection(analysis) {
  const uniformNote = analysis.uniformRhMessage
    ? `<p class="cog-rh-empty">${esc(analysis.uniformRhMessage)}</p>`
    : null;
  return `<div class="cog-rh-grid">
    <div class="cog-rh-card cog-rh-strengths">
      <div class="cog-rh-card-title">Fortalezas relativas</div>
      ${uniformNote ?? buildRhList(analysis.strengths, 'cog-rh-strength-list')}
    </div>
    <div class="cog-rh-card cog-rh-attention">
      <div class="cog-rh-card-title">Puntos de atención</div>
      ${uniformNote ?? buildRhList(analysis.attention, 'cog-rh-attention-list')}
    </div>
  </div>`;
}

function buildDescriptiveGroups(analysis) {
  if (!analysis.hasSeries) {
    return '<p class="muted">Sin datos de series para agrupación descriptiva.</p>';
  }
  const cards = analysis.descriptiveGroups
    .filter((g) => g.series.length > 0 && g.avg != null)
    .map((g) => {
      const barWidth = Math.min(100, Math.round(g.avg));
      const seriesNames = g.series.map((s) => s.name).join(', ');
      return `<div class="cog-group-card" style="border-color:${g.color};background:${g.bg}">
  <div class="cog-group-title" style="color:${g.color}">${esc(g.label)}</div>
  <div class="cog-group-value" style="color:${g.color}">${g.avg.toFixed(1)}%</div>
  <div class="cog-group-bar"><div class="cog-group-fill" style="width:${barWidth}%;background:${g.color}"></div></div>
  <div class="cog-group-series">${esc(seriesNames)}</div>
</div>`;
    })
    .join('');
  return `<div class="cog-descriptive-block">
<p class="cog-group-note">${esc(TERMAN_DESCRIPTIVE_GROUP_NOTE)}</p>
<div class="cog-group-grid">${cards || '<p class="muted">Sin datos de agrupación.</p>'}</div>
</div>`;
}

/** Parte nombres de serie en líneas cortas para labels SVG (sin abreviar). */
function splitSeriesLabel(name, maxLineLen = 22) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxLineLen) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function buildSeriesLabelSvg(x, y, lines) {
  const lineHeight = 9;
  if (lines.length === 1) {
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="7.5" fill="#374151" font-weight="600">${esc(lines[0])}</text>`;
  }
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  const tspans = lines
    .map((line, i) => `<tspan x="${x.toFixed(1)}" dy="${i === 0 ? 0 : lineHeight}">${esc(line)}</tspan>`)
    .join('');
  return `<text x="${x.toFixed(1)}" y="${startY.toFixed(1)}" text-anchor="end" font-size="7.5" fill="#374151" font-weight="600">${tspans}</text>`;
}

/**
 * Barras horizontales SVG — eje fijo 0–100%, ordenadas por ranking descendente.
 */
function buildSeriesChart(ranking) {
  const N = ranking.length;
  if (!N) return '<p class="muted">Sin datos de series</p>';

  const LABEL_W = 178;
  const CHART_W = 232;
  const VAL_W = 68;
  const TOTAL_W = LABEL_W + CHART_W + VAL_W;
  const TOP_PAD = 26;
  const BOT_PAD = 14;
  const MIN_ROW_H = 26;
  const LINE_H = 9;
  const BAR_H = 10;

  const rowMeta = ranking.map((s) => {
    const lines = splitSeriesLabel(s.name || s.seriesId || '');
    const rowH = Math.max(MIN_ROW_H, 10 + lines.length * LINE_H);
    return { lines, rowH };
  });
  const chartBodyH = rowMeta.reduce((sum, r) => sum + r.rowH, 0);
  const TOTAL_H = TOP_PAD + chartBodyH + BOT_PAD;

  const gx = [0, 25, 50, 75, 100].map((p) => LABEL_W + (p / 100) * CHART_W);
  const xLabels = [0, 25, 50, 75, 100]
    .map(
      (p, i) =>
        `<text x="${gx[i].toFixed(1)}" y="${TOP_PAD - 8}" text-anchor="middle" font-size="7" fill="#9CA3AF" font-weight="600">${p}%</text>`,
    )
    .join('');

  const gridLines = gx
    .map((x, i) => {
      const is50 = i === 2;
      return `<line x1="${x.toFixed(1)}" y1="${TOP_PAD - 4}" x2="${x.toFixed(1)}" y2="${(TOP_PAD + chartBodyH).toFixed(1)}" stroke="${is50 ? '#CBD5E1' : '#E5E7EB'}" stroke-width="${is50 ? 0.9 : 0.5}" stroke-dasharray="${i === 0 || i === 4 ? '' : '3,2'}"/>`;
    })
    .join('');

  const baseline = `<line x1="${gx[0].toFixed(1)}" y1="${(TOP_PAD - 4).toFixed(1)}" x2="${gx[4].toFixed(1)}" y2="${(TOP_PAD - 4).toFixed(1)}" stroke="#D1D5DB" stroke-width="0.8"/>`;

  let rowOffset = TOP_PAD;
  const rows = ranking
    .map((s, i) => {
      const pct = Math.min(100, Math.max(0, s.percent));
      const barW = (pct / 100) * CHART_W;
      const { lines, rowH } = rowMeta[i];
      const rowY = rowOffset;
      rowOffset += rowH;
      const barY = rowY + (rowH - BAR_H) / 2;
      const midY = rowY + rowH / 2;
      const cat = getDescriptiveGroupForSeries(s.seriesId);
      const valText = `${pct.toFixed(0)}% · ${s.correct}/${s.total}`;
      const rowBg =
        i % 2 === 1
          ? `<rect x="0" y="${rowY}" width="${TOTAL_W}" height="${rowH}" fill="#F8FAFC"/>`
          : '';

      return `${rowBg}
${buildSeriesLabelSvg(LABEL_W - 6, midY, lines)}
<rect x="${LABEL_W}" y="${barY.toFixed(1)}" width="${CHART_W}" height="${BAR_H}" rx="5" fill="#F1F5F9"/>
${barW > 1 ? `<rect x="${LABEL_W}" y="${barY.toFixed(1)}" width="${barW.toFixed(1)}" height="${BAR_H}" rx="5" fill="${cat.color}"/>` : ''}
<text x="${(LABEL_W + CHART_W + 4).toFixed(1)}" y="${midY.toFixed(1)}" dominant-baseline="middle" font-size="7" fill="${cat.color}" font-weight="700">${esc(valText)}</text>`;
    })
    .join('');

  const legendY = TOP_PAD + chartBodyH + 4;
  const legend = Object.values(
    ranking.reduce((acc, s) => {
      const cat = getDescriptiveGroupForSeries(s.seriesId);
      acc[cat.label] = cat;
      return acc;
    }, {}),
  )
    .map((cat, i) => {
      const lx = LABEL_W + i * 92;
      return `<rect x="${lx}" y="${legendY}" width="8" height="8" rx="2" fill="${cat.color}"/>
<text x="${lx + 11}" y="${legendY + 5}" font-size="7" fill="${cat.color}" font-weight="700">${esc(cat.label)}</text>`;
    })
    .join('');

  return `<div class="cog-chart-wrap"><svg width="${TOTAL_W}" height="${TOTAL_H}" viewBox="0 0 ${TOTAL_W} ${TOTAL_H}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;">
  <text x="0" y="10" font-size="7" fill="#9CA3AF" font-weight="600">Eje fijo 0–100% · Aciertos por serie</text>
  ${xLabels}
  ${gridLines}
  ${baseline}
  ${rows}
  ${legend}
</svg></div>`;
}

function buildTechnicalTable(ranking) {
  if (!ranking.length) {
    return '<p class="muted">Sin desglose por series.</p>';
  }
  const rows = ranking
    .map(
      (s) => `<tr>
      <td>${esc(s.name)}</td>
      <td class="num">${s.correct}</td>
      <td class="num">${s.total}</td>
      <td class="num strong">${s.percent.toFixed(1)}%</td>
    </tr>`,
    )
    .join('');
  return `<table class="cog-tech-table">
    <thead><tr><th>Serie</th><th>Aciertos</th><th>Total</th><th>%</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function extractTermanScores(attempt) {
  const raw = attempt?.scores;
  if (!raw || typeof raw !== 'object') return null;
  const inner = raw.scores && typeof raw.scores === 'object' ? raw.scores : raw;
  if (inner.rawScore == null && !inner.series) return null;
  return inner;
}

export function buildTermanModuleFragment(ctx) {
  const { scores, submittedAt } = ctx;
  const closed = submittedAt ? esc(submittedAt) : '—';
  const analysis = analyzeTermanCognitive(scores);
  const totalLabel = analysis.totalQuestions || TERMAN_MAX_RAW_SCORE;

  return `
  <section class="module-block cog-module" id="mod-terman">
    <div class="module-hd">
      ${SVG_BRAIN}
      <div>
        <h2 class="module-title">Evaluación Cognitiva Analítica Mind24</h2>
        <p class="module-sub">10 series · ${totalLabel} reactivos · Cierre: ${closed}</p>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Resultado ejecutivo</div>
      ${buildExecutiveBlock(analysis, scores)}
    </div>
    <div class="section">
      <div class="section-title">Rendimiento por serie</div>
      ${buildSeriesChart(analysis.ranking)}
    </div>
    <div class="section">
      <div class="section-title">Lectura para recursos humanos</div>
      ${buildRhSection(analysis)}
    </div>
    <div class="section cog-descriptive-section">
      <div class="section-title">Agrupación descriptiva de series</div>
      ${buildDescriptiveGroups(analysis)}
    </div>
    <div class="section cog-tech-section">
      <div class="section-title section-title-muted">Referencia técnica</div>
      <div class="cog-tech">${buildTechnicalTable(analysis.ranking)}</div>
    </div>
  </section>`;
}

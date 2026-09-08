import { esc } from '../reportUtils.js';

/**
 * Macro-categorías cognitivas Mind24.
 * Agrupan las 10 series en 3 dimensiones ejecutivas.
 */
const MACRO_CATEGORIES = {
  VERBAL: {
    label: 'Verbal',
    color: '#2563EB',
    bg: '#DBEAFE',
    series: ['serie_1', 'serie_3', 'serie_7', 'serie_8'],
  },
  LOGICO: {
    label: 'Lógico-Analítico',
    color: '#7C3AED',
    bg: '#EDE9FE',
    series: ['serie_2', 'serie_4', 'serie_6', 'serie_9'],
  },
  NUMERICO: {
    label: 'Numérico',
    color: '#059669',
    bg: '#D1FAE5',
    series: ['serie_5', 'serie_10'],
  },
};

function getMacroForSeries(seriesId) {
  for (const cat of Object.values(MACRO_CATEGORIES)) {
    if (cat.series.includes(seriesId)) return cat;
  }
  return { label: 'General', color: '#6B7280', bg: '#F3F4F6' };
}

/**
 * Gráfica de barras horizontales SVG con eje X fijo 0-100%.
 * Etiquetas de Y con espacio garantizado (no se truncan).
 */
function buildTermanHbarChart(series) {
  const N = series.length;
  if (!N) return '<p class="muted">Sin datos de series</p>';

  // Layout constants (px)
  const LABEL_W = 162;   // Y-axis label area (right-aligned)
  const CHART_W = 272;   // bar area represents 0–100%
  const VAL_W   = 40;    // value text area
  const TOTAL_W = LABEL_W + CHART_W + VAL_W;  // 474
  const TOP_PAD  = 26;   // room for X-axis scale labels
  const BOT_PAD  = 18;
  const ROW_H    = 24;
  const BAR_H    = 12;
  const TOTAL_H  = TOP_PAD + N * ROW_H + BOT_PAD;

  // X grid positions (px) for 0, 25, 50, 75, 100%
  const gx = [0, 25, 50, 75, 100].map((p) => LABEL_W + (p / 100) * CHART_W);

  // X scale labels
  const xLabels = [0, 25, 50, 75, 100]
    .map((p, i) =>
      `<text x="${gx[i].toFixed(1)}" y="${TOP_PAD - 8}" text-anchor="middle" font-size="7" fill="#9CA3AF" font-weight="600">${p}%</text>`,
    )
    .join('');

  // Vertical grid lines (dashed except 0 and 100%)
  const gridLines = gx
    .map((x, i) => {
      const is50 = i === 2;
      return `<line x1="${x.toFixed(1)}" y1="${TOP_PAD - 4}" x2="${x.toFixed(1)}" y2="${(TOP_PAD + N * ROW_H).toFixed(1)}" stroke="${is50 ? '#CBD5E1' : '#E5E7EB'}" stroke-width="${is50 ? 0.9 : 0.5}" stroke-dasharray="${i === 0 || i === 4 ? '' : '3,2'}"/>`;
    })
    .join('');

  // X-axis baseline
  const baseline = `<line x1="${gx[0].toFixed(1)}" y1="${(TOP_PAD - 4).toFixed(1)}" x2="${gx[4].toFixed(1)}" y2="${(TOP_PAD - 4).toFixed(1)}" stroke="#D1D5DB" stroke-width="0.8"/>`;

  // Rows
  const rows = series
    .map((s, i) => {
      const pct   = Math.min(100, Math.max(0, Number(s.percent) || 0));
      const barW  = (pct / 100) * CHART_W;
      const rowY  = TOP_PAD + i * ROW_H;
      const barY  = rowY + (ROW_H - BAR_H) / 2;
      const midY  = rowY + ROW_H / 2;
      const cat   = getMacroForSeries(s.seriesId || '');
      const name  = esc((s.name || s.seriesId || '').slice(0, 28));
      const correct = Number(s.correct) || 0;
      const total   = Number(s.total)   || 0;

      // Alternate row background for readability
      const rowBg = i % 2 === 0 ? '' :
        `<rect x="0" y="${rowY}" width="${TOTAL_W}" height="${ROW_H}" fill="#F8FAFC"/>`;

      return `${rowBg}
<text x="${(LABEL_W - 6).toFixed(1)}" y="${midY.toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="8" fill="#374151" font-weight="600">${name}</text>
<rect x="${LABEL_W}" y="${barY.toFixed(1)}" width="${CHART_W}" height="${BAR_H}" rx="6" fill="#F1F5F9"/>
${barW > 1 ? `<rect x="${LABEL_W}" y="${barY.toFixed(1)}" width="${barW.toFixed(1)}" height="${BAR_H}" rx="6" fill="${cat.color}"/>` : ''}
<text x="${(LABEL_W + CHART_W + 6).toFixed(1)}" y="${midY.toFixed(1)}" dominant-baseline="middle" font-size="7.5" fill="${cat.color}" font-weight="800">${pct.toFixed(0)}%</text>
<title>${name}: ${pct.toFixed(1)}% (${correct}/${total})</title>`;
    })
    .join('');

  // Category legend at bottom
  const legendY = TOP_PAD + N * ROW_H + 6;
  const legend  = Object.entries(MACRO_CATEGORIES)
    .map(([, cat], i) => {
      const lx = LABEL_W + i * 90;
      return `<rect x="${lx}" y="${legendY}" width="8" height="8" rx="2" fill="${cat.color}"/>
<text x="${lx + 11}" y="${legendY + 5}" font-size="7" fill="${cat.color}" font-weight="700">${esc(cat.label)}</text>`;
    })
    .join('');

  return `<svg width="${TOTAL_W}" height="${TOTAL_H}" viewBox="0 0 ${TOTAL_W} ${TOTAL_H}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;">
  <text x="0" y="10" font-size="7" fill="#9CA3AF" font-weight="600">Eje fijo 0–100% · Aciertos por serie</text>
  ${xLabels}
  ${gridLines}
  ${baseline}
  ${rows}
  ${legend}
</svg>`;
}

/**
 * 3 tarjetas de macro-categoría con score promedio y mini-barra.
 */
function buildMacroCards(series) {
  return Object.entries(MACRO_CATEGORIES)
    .map(([, cat]) => {
      const catSeries = series.filter((s) => cat.series.includes(s.seriesId || ''));
      if (!catSeries.length) return '';
      const avg = catSeries.reduce((sum, s) => sum + (Number(s.percent) || 0), 0) / catSeries.length;
      const barWidth = Math.min(100, Math.round(avg));
      const seriesNames = catSeries.map((s) => (s.name || s.seriesId || '').slice(0, 15)).join(', ');
      return `<div style="flex:1;min-width:130px;border:1.5px solid ${cat.color};border-radius:10px;padding:11px 13px;background:${cat.bg};">
  <div style="font-size:9px;font-weight:800;color:${cat.color};text-transform:uppercase;letter-spacing:.09em;margin-bottom:4px;">${esc(cat.label)}</div>
  <div style="font-size:20px;font-weight:900;color:${cat.color};margin-bottom:7px;">${avg.toFixed(1)}%</div>
  <div style="height:6px;border-radius:3px;background:rgba(255,255,255,.7);overflow:hidden;margin-bottom:7px;">
    <div style="height:100%;width:${barWidth}%;background:${cat.color};border-radius:3px;"></div>
  </div>
  <div style="font-size:7.5px;color:#6B7280;line-height:1.45;">${esc(seriesNames)}</div>
</div>`;
    })
    .join('');
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
  const rawScore       = Number(scores.rawScore) || 0;
  const totalQuestions = Number(scores.totalQuestions) || 0;
  const percent        = Number(scores.percentCorrect) || 0;

  const series = Array.isArray(scores.series) ? scores.series : [];

  const strongest = [...series].sort(
    (a, b) => (Number(b.percent) || 0) - (Number(a.percent) || 0),
  )[0];
  const synth = strongest
    ? `Mayor rendimiento relativo en «${esc(strongest.name)}» (${(Number(strongest.percent) || 0).toFixed(1)}%). Esto sugiere una inclinación analítica hacia esta área cognitiva.`
    : 'Sin desglose por series disponible.';

  const hbarChart  = buildTermanHbarChart(series);
  const macroCards = buildMacroCards(series);

  return `
  <section class="module-block" id="mod-terman">
    <div class="module-hd">
      <span class="module-icon">🧠</span>
      <div>
        <h2 class="module-title">Evaluación Cognitiva Analítica Mind24</h2>
        <p class="module-sub">10 series · 50 reactivos · Cierre: ${closed}</p>
      </div>
    </div>
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Puntaje bruto global</div>
        <div class="kpi-value">${rawScore} <span style="font-size:12px;font-weight:600;color:#6B7280">/ ${totalQuestions || 50}</span></div>
        <div class="kpi-badge">${percent.toFixed(1)}% aciertos</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Desempeño cognitivo</div>
        <div class="kpi-value kpi-sm">${percent.toFixed(1)}%</div>
        <div class="kpi-badge">Porcentaje global de aciertos</div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Síntesis de perfil analítico</div>
      <p class="interp">${synth}</p>
    </div>
    <div class="section">
      <div class="section-title">Macro-categorías cognitivas</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:4px;">
        ${macroCards || '<p class="muted">Sin datos de macro-categorías</p>'}
      </div>
    </div>
    <div class="section">
      <div class="section-title">Rendimiento por serie — eje fijo 0–100%</div>
      ${hbarChart}
    </div>
  </section>`;
}

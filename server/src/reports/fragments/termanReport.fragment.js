import { esc } from '../reportUtils.js';

/**
 * Macro-categorías cognitivas Mind24.
 * Agrupan las 10 series en 3 dimensiones ejecutivas para facilitar
 * la lectura del reclutador.
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
 * Radar chart SVG con 10 ejes (uno por serie).
 * Ejes coloreados por macro-categoría.
 */
function buildTermanRadar(series) {
  const N = series.length;
  if (N < 3) return '';

  const cx = 160, cy = 160, R = 105;
  const toAngle = (i) => -Math.PI / 2 + ((2 * Math.PI) / N) * i;

  // Grid polygons: 25 / 50 / 75 / 100
  const gridPolygons = [25, 50, 75, 100]
    .map((pct) => {
      const r = (pct / 100) * R;
      const pts = series
        .map((_, i) => {
          const a = toAngle(i);
          return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
        })
        .join(' ');
      const is50 = pct === 50;
      return `<polygon points="${pts}" fill="${pct === 100 ? 'rgba(229,231,235,0.35)' : 'none'}" stroke="${is50 ? '#CBD5E1' : '#E5E7EB'}" stroke-width="${is50 ? 0.9 : 0.55}" stroke-dasharray="${is50 ? '3,2' : ''}"/>`;
    })
    .join('');

  // Axis lines colored by macro-category
  const axisLines = series
    .map((s, i) => {
      const a = toAngle(i);
      const cat = getMacroForSeries(s.seriesId || '');
      return `<line x1="${cx}" y1="${cy}" x2="${(cx + R * Math.cos(a)).toFixed(1)}" y2="${(cy + R * Math.sin(a)).toFixed(1)}" stroke="${cat.color}" stroke-width="0.7" opacity="0.45"/>`;
    })
    .join('');

  // Labels: abbreviated name + % value
  const labels = series
    .map((s, i) => {
      const a = toAngle(i);
      const lr = R + 28;
      const lx = (cx + lr * Math.cos(a)).toFixed(1);
      const baseY = cy + lr * Math.sin(a);
      const cat = getMacroForSeries(s.seriesId || '');
      const name = esc((s.name || s.seriesId || '').slice(0, 11));
      const pct = Number(s.percent || 0);
      return `<text x="${lx}" y="${(baseY - 4).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#374151" font-weight="600">${name}</text>
<text x="${lx}" y="${(baseY + 5).toFixed(1)}" text-anchor="middle" font-size="6" fill="${cat.color}" font-weight="700">${pct.toFixed(0)}%</text>`;
    })
    .join('');

  // Data polygon
  const dataPoints = series
    .map((s, i) => {
      const a = toAngle(i);
      const pct = Math.min(100, Math.max(0, Number(s.percent) || 0));
      const r = (pct / 100) * R;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    })
    .join(' ');

  // Dot markers colored by macro-category
  const dots = series
    .map((s, i) => {
      const a = toAngle(i);
      const pct = Math.min(100, Math.max(0, Number(s.percent) || 0));
      const r = (pct / 100) * R;
      const cat = getMacroForSeries(s.seriesId || '');
      return `<circle cx="${(cx + r * Math.cos(a)).toFixed(1)}" cy="${(cy + r * Math.sin(a)).toFixed(1)}" r="3" fill="${cat.color}" stroke="white" stroke-width="1"/>`;
    })
    .join('');

  return `<svg width="320" height="320" viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">
  ${gridPolygons}
  ${axisLines}
  ${labels}
  <polygon points="${dataPoints}" fill="#7C3AED" fill-opacity="0.13" stroke="#7C3AED" stroke-width="1.8"/>
  ${dots}
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
  const ciDisplay =
    scores.ci != null
      ? String(scores.ci)
      : scores.ciEstimate != null
        ? `~${scores.ciEstimate} (preliminar)`
        : 'Por calibrar';
  const ciNote = scores.ciNote || '';

  const series = Array.isArray(scores.series) ? scores.series : [];

  const strongest = [...series].sort(
    (a, b) => (Number(b.percent) || 0) - (Number(a.percent) || 0),
  )[0];
  const synth = strongest
    ? `Mayor rendimiento relativo en «${esc(strongest.name)}» (${(Number(strongest.percent) || 0).toFixed(1)}%). Esto sugiere una inclinación analítica hacia esta área cognitiva.`
    : 'Sin desglose por series disponible.';

  // Radar + macro-cards
  const radarSvg   = buildTermanRadar(series);
  const macroCards = buildMacroCards(series);

  // Bar chart colored by macro-category (replaces the old uniform blue bars)
  const maxPct = Math.max(...series.map((s) => Number(s.percent) || 0), 1);
  const bars = series
    .map((s) => {
      const pct     = Number(s.percent) || 0;
      const w       = Math.round((pct / maxPct) * 100);
      const correct = Number(s.correct) || 0;
      const total   = Number(s.total) || 0;
      const cat     = getMacroForSeries(s.seriesId || '');
      return `<div class="bar-row">
  <div class="bar-label" style="font-size:9px;">${esc((s.name || s.seriesId || '').slice(0, 20))}</div>
  <div class="bar-track"><div class="bar-fill pos" style="width:${w}%;background:${cat.color};"></div></div>
  <div class="bar-val" style="color:${cat.color};font-weight:700;">${correct}/${total}</div>
</div>`;
    })
    .join('');

  // Category legend
  const catLegend = Object.entries(MACRO_CATEGORIES)
    .map(
      ([, cat]) =>
        `<div style="display:flex;align-items:center;gap:4px;">
  <div style="width:9px;height:9px;border-radius:3px;background:${cat.color};"></div>
  <span style="color:${cat.color};font-size:8px;font-weight:700;">${esc(cat.label)}</span>
</div>`,
    )
    .join('');

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
        <div class="kpi-label">Coeficiente intelectual (CI)</div>
        <div class="kpi-value kpi-sm">${esc(ciDisplay)}</div>
        <div class="kpi-badge">${esc(ciNote)}</div>
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
      <div class="section-title">Radar cognitivo · 10 dimensiones</div>
      <div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;">
        <div style="flex-shrink:0;">
          ${radarSvg || '<p class="muted">Sin datos de series</p>'}
        </div>
        <div style="flex:1;min-width:170px;">
          <div class="chart-box" style="margin-bottom:10px;">
            <h3>Detalle por serie (aciertos / total)</h3>
            ${bars || '<p class="muted">Sin datos de series</p>'}
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            ${catLegend}
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

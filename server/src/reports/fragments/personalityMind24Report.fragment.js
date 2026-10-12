import {
  PERSONALIDAD_MIND24_DIMENSIONS,
  PERSONALIDAD_MIND24_MODULE_KEY,
  PERSONALIDAD_MIND24_SCALE,
} from '../../data/personalityMind24Data.js';
import { buildPersonalityInterpretationSectionHtml } from '../personalityMind24Interpretation.js';
import { esc } from '../reportUtils.js';

export const PERSONALITY_METHODOLOGY_NOTE =
  'Los puntajes corresponden a medias observadas en una escala de frecuencia de 1 a 5. Esta versión piloto no utiliza percentiles ni normas poblacionales; las comparaciones presentadas son internas al perfil evaluado.';

export const INTRAPROFILE_DISCLAIMER =
  'Estas referencias comparan las dimensiones dentro del propio perfil y no contra una población normativa.';

export const HOMOGENEOUS_PROFILE_MESSAGE =
  'Perfil relativamente homogéneo en las dimensiones evaluadas; no se observan contrastes suficientes para destacar tendencias más o menos expresadas.';

const SCALE_MIN = PERSONALIDAD_MIND24_SCALE.min;
const SCALE_MAX = PERSONALIDAD_MIND24_SCALE.max;
const SCALE_SPAN = SCALE_MAX - SCALE_MIN;

/** Etiquetas cortas solo para el radar (orden canónico). */
export const PM24_RADAR_SHORT_LABELS = [
  'Logro',
  'Orden',
  'Autonomía',
  'Influencia',
  'Sociabilidad',
  'Liderazgo',
  'Normas',
  'Regulación',
  'Dinamismo',
  'Adaptabilidad',
];

export const PM24_RADAR_LABEL_BY_DIMENSION_ID = Object.fromEntries(
  PERSONALIDAD_MIND24_DIMENSIONS.map((d, i) => [d.dimensionId, PM24_RADAR_SHORT_LABELS[i]]),
);

const RADAR_CX = 120;
const RADAR_CY = 120;
/** Radio del polígono (reducido para dejar margen a etiquetas en PDF). */
const RADAR_R_MAX = 68;
/** Padding simétrico del viewBox: evita clipping de labels con text-anchor start/end. */
export const PM24_RADAR_VIEWBOX = { min: -38, size: 316 };
const RADAR_AXIS_COUNT = PERSONALIDAD_MIND24_DIMENSIONS.length;

function radarAngleRad(index) {
  return -Math.PI / 2 + index * ((2 * Math.PI) / RADAR_AXIS_COUNT);
}

/** Radio SVG para media en escala 1–5 (1 → centro, 5 → borde). */
export function radarRadiusForMean(mean, rMax = RADAR_R_MAX) {
  const n = Number(mean);
  if (!Number.isFinite(n)) return 0;
  const t = (n - SCALE_MIN) / SCALE_SPAN;
  return Math.max(0, Math.min(1, t)) * rMax;
}

function radarPolarXY(index, radius) {
  const a = radarAngleRad(index);
  const x = RADAR_CX + radius * Math.cos(a);
  const y = RADAR_CY + radius * Math.sin(a);
  return { x: +x.toFixed(2), y: +y.toFixed(2) };
}

/**
 * @param {Array<object>} dimensionRows — orden canónico
 * @returns {Array<{ dimensionId: string, mean: number, x: number, y: number, shortLabel: string }>}
 */
export function radarVertexPoints(dimensionRows) {
  return dimensionRows.map((row, index) => {
    const r = radarRadiusForMean(row.mean);
    const { x, y } = radarPolarXY(index, r);
    return {
      dimensionId: row.dimensionId,
      mean: Number(row.mean),
      x,
      y,
      shortLabel: PM24_RADAR_LABEL_BY_DIMENSION_ID[row.dimensionId] || row.label,
    };
  });
}

function buildRadarGridPolygons() {
  const parts = [];
  for (let level = 2; level <= SCALE_MAX; level += 1) {
    const r = radarRadiusForMean(level);
    const pts = [];
    for (let i = 0; i < RADAR_AXIS_COUNT; i += 1) {
      const { x, y } = radarPolarXY(i, r);
      pts.push(`${x},${y}`);
    }
    parts.push(
      `<polygon class="pm24-radar-ring" data-scale-level="${level}" points="${pts.join(' ')}" fill="none" stroke="#E5E7EB" stroke-width="1"/>`,
    );
  }
  return parts.join('\n');
}

function buildRadarAxes() {
  const parts = [];
  for (let i = 0; i < RADAR_AXIS_COUNT; i += 1) {
    const outer = radarPolarXY(i, RADAR_R_MAX);
    parts.push(
      `<line class="pm24-radar-axis" x1="${RADAR_CX}" y1="${RADAR_CY}" x2="${outer.x}" y2="${outer.y}" stroke="#E5E7EB" stroke-width="1"/>`,
    );
  }
  return parts.join('\n');
}

function buildRadarScaleLabels() {
  const parts = [];
  for (let level = SCALE_MIN; level <= SCALE_MAX; level += 1) {
    const r = radarRadiusForMean(level);
    const x = RADAR_CX + 4;
    const y = RADAR_CY - r;
    if (level === SCALE_MIN && r === 0) continue;
    parts.push(
      `<text class="pm24-radar-scale-label" x="${x.toFixed(2)}" y="${(y + 3).toFixed(2)}" font-size="7" fill="#9CA3AF" text-anchor="start">${level}</text>`,
    );
  }
  return parts.join('\n');
}

function radarAxisLabelLayout(index, x, y) {
  const a = radarAngleRad(index);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  let anchor = 'middle';
  let dx = 0;
  let dy = 3;
  if (cos > 0.3) {
    anchor = 'start';
    dx = 3;
  } else if (cos < -0.3) {
    anchor = 'end';
    dx = -3;
  }
  if (sin < -0.35) dy = 0;
  else if (sin > 0.35) dy = 5;
  return { anchor, dx, dy };
}

function buildRadarAxisLabels(dimensionRows) {
  const labelR = RADAR_R_MAX + 11;
  return dimensionRows
    .map((row, index) => {
      const short = PM24_RADAR_LABEL_BY_DIMENSION_ID[row.dimensionId] || row.label;
      const a = radarAngleRad(index);
      const x = RADAR_CX + labelR * Math.cos(a);
      const y = RADAR_CY + labelR * Math.sin(a);
      const { anchor, dx, dy } = radarAxisLabelLayout(index, x, y);
      return `<text class="pm24-radar-axis-label" data-radar-label="${esc(short)}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" dx="${dx}" dy="${dy}" font-size="7" font-weight="600" fill="#4B5563" text-anchor="${anchor}">${esc(short)}</text>`;
    })
    .join('\n');
}

function buildProfileRadarChart(dimensionRows) {
  const vertices = radarVertexPoints(dimensionRows);
  const polygonPts = vertices.map((v) => `${v.x},${v.y}`).join(' ');
  const dots = vertices
    .map(
      (v) =>
        `<circle class="pm24-radar-vertex" data-dimension-id="${esc(v.dimensionId)}" data-mean="${esc(formatMean(v.mean))}" cx="${v.x}" cy="${v.y}" r="2.5" fill="#7C3AED" stroke="#fff" stroke-width="1"/>`,
    )
    .join('\n');

  return `<div class="pm24-radar-wrap">
  <svg class="pm24-radar" viewBox="${PM24_RADAR_VIEWBOX.min} ${PM24_RADAR_VIEWBOX.min} ${PM24_RADAR_VIEWBOX.size} ${PM24_RADAR_VIEWBOX.size}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa general del perfil en 10 dimensiones, escala 1 a 5">
    ${buildRadarGridPolygons()}
    ${buildRadarAxes()}
    ${buildRadarScaleLabels()}
    <polygon class="pm24-radar-profile" points="${polygonPts}" fill="rgba(124,58,237,0.18)" stroke="#7C3AED" stroke-width="1.5" stroke-linejoin="round"/>
    ${dots}
    ${buildRadarAxisLabels(dimensionRows)}
  </svg>
</div>`;
}

function buildCompletenessNote(scores) {
  const form = scores?.form || {};
  const expected = form.totalItemsExpected;
  const completeness = scores?.meta?.applicationQuality?.completeness;
  const answered =
    completeness?.answeredCount != null
      ? Number(completeness.answeredCount)
      : dimensionRowsTotalAnswered(scores?.dimensionRows);
  if (expected == null || !Number.isFinite(Number(expected))) return '';
  const exp = Number(expected);
  if (answered != null && Number.isFinite(answered) && answered === exp) {
    return `<p class="pm24-completeness">Aplicación completa: ${answered}/${exp} respuestas.</p>`;
  }
  if (answered != null && Number.isFinite(answered)) {
    return `<p class="pm24-completeness">Respuestas registradas: ${answered}/${exp}.</p>`;
  }
  return '';
}

function dimensionRowsTotalAnswered(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.reduce((sum, r) => sum + (Number(r.nAnswered) || 0), 0);
}

const SVG_PM24 = `<svg class="module-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="9"/></svg>`;

/**
 * @param {import('@prisma/client').AssessmentAttempt} attempt
 * @returns {object|null}
 */
export function extractPersonalityMind24Scores(attempt) {
  const raw = attempt?.scores;
  if (!raw || typeof raw !== 'object') return null;
  const scores = raw.scores && typeof raw.scores === 'object' ? raw.scores : raw;
  if (scores.instrument !== PERSONALIDAD_MIND24_MODULE_KEY) return null;
  if (!scores.dimensions || typeof scores.dimensions !== 'object') return null;

  const dimensionRows = canonicalDimensionRows(scores.dimensions);
  if (dimensionRows.length !== PERSONALIDAD_MIND24_DIMENSIONS.length) return null;

  for (const row of dimensionRows) {
    const mean = Number(row.mean);
    if (!Number.isFinite(mean)) return null;
    if (mean < SCALE_MIN || mean > SCALE_MAX) return null;
  }

  return {
    ...scores,
    dimensionRows,
  };
}

/**
 * @param {Record<string, object>} dimensionsMap
 * @returns {Array<object>}
 */
export function canonicalDimensionRows(dimensionsMap) {
  const rows = [];
  for (const def of PERSONALIDAD_MIND24_DIMENSIONS) {
    const bucket = dimensionsMap[def.dimensionId];
    if (!bucket || typeof bucket !== 'object') return [];
    rows.push({
      dimensionId: def.dimensionId,
      sortOrder: def.sortOrder,
      label: bucket.label || def.label,
      mean: bucket.mean != null ? Number(bucket.mean) : null,
      nAnswered: bucket.nAnswered != null ? Number(bucket.nAnswered) : 0,
      nExpected: bucket.nExpected != null ? Number(bucket.nExpected) : 0,
      scaleMin: bucket.scaleMin ?? SCALE_MIN,
      scaleMax: bucket.scaleMax ?? SCALE_MAX,
    });
  }
  return rows;
}

/**
 * Orden por mean desc; empates → orden canónico (sortOrder asc).
 * @param {Array<object>} dimensionRows
 */
export function rankPersonalityDimensionsByMean(dimensionRows) {
  return [...dimensionRows].sort((a, b) => {
    const dm = (Number(b.mean) || 0) - (Number(a.mean) || 0);
    if (dm !== 0) return dm;
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  });
}

function roundMeanDisplay(mean) {
  const n = Number(mean);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

/**
 * ¿Hay contraste intraperfil? (misma media a 1 decimal → homogéneo)
 * @param {Array<object>} dimensionRows
 */
export function intraprofileHasContrast(dimensionRows) {
  const rounded = dimensionRows
    .map((r) => roundMeanDisplay(r.mean))
    .filter((m) => m != null);
  if (rounded.length === 0) return false;
  const min = Math.min(...rounded);
  const max = Math.max(...rounded);
  return min !== max;
}

/**
 * Agrupa por media (1 decimal); orden de tiers por mean asc/desc.
 * @param {Array<object>} dimensionRows
 * @param {boolean} ascendingMean
 */
function meanTierGroups(dimensionRows, ascendingMean) {
  const sorted = [...dimensionRows].sort((a, b) => {
    const da = roundMeanDisplay(a.mean) ?? 0;
    const db = roundMeanDisplay(b.mean) ?? 0;
    if (da !== db) return ascendingMean ? da - db : db - da;
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  });
  const tiers = [];
  let currentMean = null;
  for (const row of sorted) {
    const m = roundMeanDisplay(row.mean);
    if (m !== currentMean) {
      tiers.push([]);
      currentMean = m;
    }
    tiers[tiers.length - 1].push(row);
  }
  return tiers;
}

/**
 * Top/bottom por tiers de media: no mezcla superioridad dentro del mismo mean.
 * @param {Array<object>} dimensionRows
 * @param {boolean} pickHigh
 */
function selectTrendExtremes(dimensionRows, pickHigh) {
  const tiers = meanTierGroups(dimensionRows, !pickHigh);
  const out = [];
  for (const tier of tiers) {
    for (const row of tier) out.push(row);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * @param {Array<object>} dimensionRows
 */
export function intraprofileTrends(dimensionRows) {
  if (!intraprofileHasContrast(dimensionRows)) {
    return { hasContrast: false, moreExpressed: [], lessExpressed: [] };
  }
  return {
    hasContrast: true,
    moreExpressed: selectTrendExtremes(dimensionRows, true),
    lessExpressed: selectTrendExtremes(dimensionRows, false),
  };
}

function formatMean(mean) {
  const n = Number(mean);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(1);
}

/** Ancho de barra sobre escala Likert 1–5 (1 → 0%, 5 → 100%). */
export function barWidthPct(mean) {
  const n = Number(mean);
  if (!Number.isFinite(n)) return 0;
  if (SCALE_SPAN <= 0) return 0;
  const normalized = (n - SCALE_MIN) / SCALE_SPAN;
  return Math.max(0, Math.min(100, normalized * 100));
}

function buildBarChart(dimensionRows) {
  const rows = dimensionRows
    .map((row) => {
      const pct = barWidthPct(row.mean);
      const meanLabel = `${formatMean(row.mean)} / ${SCALE_MAX}`;
      return `<div class="pm24-bar-row">
  <div class="pm24-bar-label" title="${esc(row.label)}">${esc(row.label)}</div>
  <div class="pm24-bar-track"><div class="pm24-bar-fill" style="width:${pct.toFixed(1)}%;"></div></div>
  <div class="pm24-bar-val">${esc(meanLabel)}</div>
</div>`;
    })
    .join('\n');

  return `<div class="pm24-chart-wrap">
  <div class="pm24-chart-scale pm24-bar-row" aria-hidden="true">
    <div class="pm24-bar-label"></div>
    <div class="pm24-scale-track">
      <span class="pm24-scale-tick" style="left:0%;">1</span>
      <span class="pm24-scale-tick" style="left:25%;">2</span>
      <span class="pm24-scale-tick" style="left:50%;">3</span>
      <span class="pm24-scale-tick" style="left:75%;">4</span>
      <span class="pm24-scale-tick" style="left:100%;">5</span>
    </div>
    <div class="pm24-bar-val"></div>
  </div>
  ${rows}
</div>`;
}

function buildTrendsPanel(trends) {
  if (!trends.hasContrast) {
    return `<p class="pm24-homogeneous">${esc(HOMOGENEOUS_PROFILE_MESSAGE)}</p>`;
  }
  return `<div class="pm24-trends-stack">
      <div class="pm24-trend-card pm24-trend-more">
        <div class="pm24-trend-title">Tendencias relativamente más expresadas</div>
        ${buildTrendList(trends.moreExpressed)}
      </div>
      <div class="pm24-trend-card pm24-trend-less">
        <div class="pm24-trend-title">Tendencias relativamente menos expresadas</div>
        ${buildTrendList(trends.lessExpressed)}
      </div>
    </div>`;
}

function buildTrendList(items) {
  if (!items.length) return '<p class="pm24-trend-empty">No aplica.</p>';
  return `<ul class="pm24-trend-list">${items
    .map(
      (row) =>
        `<li><span class="pm24-trend-name">${esc(row.label)}</span> <span class="pm24-trend-mean">${esc(formatMean(row.mean))} / ${SCALE_MAX}</span></li>`,
    )
    .join('')}</ul>`;
}

export function buildPersonalityMind24IncompleteFragment(ctx) {
  const { submittedAt, moduleLabel = 'Personalidad Mind24' } = ctx;
  const closed = submittedAt ? esc(submittedAt) : '—';
  return `
  <section class="module-block pm24-module pm24-module--incomplete" id="mod-personalidad-mind24">
    <div class="module-hd">
      <span class="module-icon">◈</span>
      <div>
        <h2 class="module-title">${esc(moduleLabel)}</h2>
        <p class="module-sub">Módulo completado · Cierre: ${closed}</p>
      </div>
    </div>
    <div class="generic-body">
      <p class="muted">Resultados disponibles, pero el desglose dimensional no pudo generarse.</p>
    </div>
  </section>`;
}

export function buildPersonalityMind24ModuleFragment(ctx) {
  const { scores, submittedAt } = ctx;
  const closed = submittedAt ? esc(submittedAt) : '—';
  const rows = scores.dimensionRows || canonicalDimensionRows(scores.dimensions || {});
  const trends = intraprofileTrends(rows);

  return `
  <section class="module-block pm24-module" id="mod-personalidad-mind24">
    <div class="module-hd">
      ${SVG_PM24}
      <div>
        <h2 class="module-title">Personalidad Mind24</h2>
        <p class="module-sub">Perfil de personalidad laboral · Cierre: ${closed}</p>
      </div>
    </div>

    <p class="pm24-method-note">${esc(PERSONALITY_METHODOLOGY_NOTE)}</p>

    <div class="pm24-overview-grid">
      <div class="section pm24-radar-section">
        <div class="section-title">Mapa general del perfil</div>
        <p class="pm24-chart-sub">10 dimensiones · escala ${SCALE_MIN}–${SCALE_MAX}</p>
        ${buildProfileRadarChart(rows)}
      </div>
      <div class="section pm24-trends-section">
        ${buildTrendsPanel(trends)}
      </div>
    </div>

    <div class="section pm24-bars-section">
      <div class="section-title">Perfil dimensional</div>
      ${buildCompletenessNote(scores)}
      <p class="pm24-chart-sub">Medias por dimensión · escala ${SCALE_MIN}–${SCALE_MAX}</p>
      ${buildBarChart(rows)}
    </div>

    ${trends.hasContrast ? `<p class="pm24-intra-disclaimer">${esc(INTRAPROFILE_DISCLAIMER)}</p>` : ''}
    ${buildPersonalityInterpretationSectionHtml(rows, trends)}
  </section>`;
}

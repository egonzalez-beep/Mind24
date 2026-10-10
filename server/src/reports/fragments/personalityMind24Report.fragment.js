import {
  PERSONALIDAD_MIND24_DIMENSIONS,
  PERSONALIDAD_MIND24_MODULE_KEY,
  PERSONALIDAD_MIND24_SCALE,
} from '../../data/personalityMind24Data.js';
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

function buildTrendsSection(trends) {
  if (!trends.hasContrast) {
    return `<p class="pm24-homogeneous">${esc(HOMOGENEOUS_PROFILE_MESSAGE)}</p>`;
  }
  return `<div class="pm24-trends-grid">
      <div class="pm24-trend-card pm24-trend-more">
        <div class="pm24-trend-title">Tendencias relativamente más expresadas</div>
        ${buildTrendList(trends.moreExpressed)}
      </div>
      <div class="pm24-trend-card pm24-trend-less">
        <div class="pm24-trend-title">Tendencias relativamente menos expresadas</div>
        ${buildTrendList(trends.lessExpressed)}
      </div>
    </div>
    <p class="pm24-intra-disclaimer">${esc(INTRAPROFILE_DISCLAIMER)}</p>`;
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

function buildBreakdownTable(dimensionRows) {
  const body = dimensionRows
    .map(
      (row) => `<tr>
  <td>${esc(row.label)}</td>
  <td class="num strong">${esc(`${formatMean(row.mean)} / ${SCALE_MAX}`)}</td>
  <td class="num">${esc(`${row.nAnswered} / ${row.nExpected}`)}</td>
</tr>`,
    )
    .join('\n');

  return `<table class="pm24-table">
  <thead><tr><th>Dimensión</th><th>Media</th><th>Respuestas</th></tr></thead>
  <tbody>${body}</tbody>
</table>`;
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

    <div class="section">
      <div class="section-title">Perfil de personalidad laboral</div>
      <p class="pm24-chart-sub">10 dimensiones · escala ${SCALE_MIN}–${SCALE_MAX}</p>
      ${buildBarChart(rows)}
    </div>

    ${buildTrendsSection(trends)}

    <div class="section pm24-table-section">
      <div class="section-title">Desglose por dimensión</div>
      ${buildBreakdownTable(rows)}
    </div>
  </section>`;
}

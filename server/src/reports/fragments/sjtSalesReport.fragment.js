import { esc } from '../reportUtils.js';
import { SJT_SALES_MAX_POINTS } from '../../data/sjtSalesData.js';
import {
  computeSjtSalesMacroCompetencies,
  resolveSjtSalesProfile,
} from '../../services/sjtSalesScoring.service.js';
import { UNRELIABLE_SPEED_FLAG_TEXT } from '../../services/attemptReliability.service.js';
import { extractReliabilityFromAttempt } from '../reliabilityAlert.fragment.js';

export const SJT_PROFILE_ASSIGNMENT_NOTE =
  'El perfil comercial se asigna a partir del puntaje global del SJT.';

export const SJT_AREA_PERCENT_NOTE =
  'Los porcentajes representan la proporción de puntos obtenidos dentro de los escenarios agrupados en cada área.';

const SVG_SJT = `<svg class="module-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect x="2" y="8" width="20" height="12" rx="2"/><path d="M12 12v4M10 12h4"/></svg>`;

export function extractSjtSalesScores(attempt) {
  const raw = attempt?.scores;
  if (!raw || typeof raw !== 'object') return null;
  const inner = raw.scores && typeof raw.scores === 'object' ? raw.scores : raw;
  if (inner.rawScore == null && !inner.scenarios && !inner.macroCompetencies) return null;
  return inner;
}

/** Confiabilidad por velocidad: solo señal persistida por scoring (sin umbral paralelo en PDF). */
export function sjtSpeedUnreliable(scores, attempt = null) {
  if (scores?.meta?.reliability?.isUnreliableSpeed === true) return true;
  if (!attempt) return false;
  const rel = extractReliabilityFromAttempt(attempt);
  return rel?.isUnreliableSpeed === true;
}

function resolveMacroCompetencies(scores) {
  if (Array.isArray(scores.macroCompetencies) && scores.macroCompetencies.length) {
    return scores.macroCompetencies;
  }
  if (Array.isArray(scores.scenarios) && scores.scenarios.length) {
    return computeSjtSalesMacroCompetencies(scores.scenarios);
  }
  return [];
}

function resolvePercentScore(scores, rawScore, maxPossible) {
  const stored = Number(scores.percentScore);
  if (Number.isFinite(stored)) return stored;
  if (maxPossible > 0) return Math.round((rawScore / maxPossible) * 1000) / 10;
  return 0;
}

function buildExecutiveBlock(scores, profileLabel, percentScore, rawScore, maxPossible, speedUnreliable) {
  const reliabilityPill = speedUnreliable
    ? `<div class="sjt-exec-status"><span class="sjt-pill sjt-pill-reliability">${esc(UNRELIABLE_SPEED_FLAG_TEXT)}</span></div>`
    : '';

  return `<div class="sjt-exec">
  <div class="sjt-exec-head">
    <div class="sjt-exec-kpi sjt-exec-kpi-primary">
      <div class="sjt-exec-label">Puntaje bruto global</div>
      <div class="sjt-exec-code">${rawScore} <span class="sjt-exec-denom">/ ${maxPossible}</span></div>
    </div>
    <div class="sjt-exec-kpi">
      <div class="sjt-exec-label">% del máximo posible</div>
      <div class="sjt-exec-value">${percentScore.toFixed(1)}%</div>
    </div>
    <div class="sjt-exec-kpi sjt-exec-kpi-profile">
      <div class="sjt-exec-label">Perfil comercial asignado</div>
      <div class="sjt-exec-profile">${esc(profileLabel)}</div>
    </div>
  </div>
  ${reliabilityPill}
  <p class="sjt-exec-note">${esc(SJT_PROFILE_ASSIGNMENT_NOTE)}</p>
</div>`;
}

function buildProfileReading(profileLabel, profileDescription) {
  return `<div class="section sjt-profile-section">
  <div class="section-title">Lectura del perfil comercial</div>
  <div class="sjt-profile-reading">
    <p class="interp"><strong>${esc(profileLabel)}.</strong> ${esc(profileDescription)}</p>
  </div>
</div>`;
}

function buildMacroAreaBarsHtml(macroSeries) {
  if (!macroSeries.length) {
    return '<p class="muted">Sin desglose por área situacional.</p>';
  }

  const sorted = [...macroSeries].sort(
    (a, b) => (Number(b.percent) || 0) - (Number(a.percent) || 0),
  );

  const rows = sorted
    .map((m) => {
      const name = esc(m.label || m.key || '—');
      const raw = Number(m.rawScore) || 0;
      const max = Number(m.maxPossible) || 0;
      const pct = Math.max(0, Math.min(100, Number(m.percent) || 0));
      const barWidth = Math.round(pct);

      return `<div class="sjt-area-row">
  <div class="sjt-area-head">
    <span class="sjt-area-name">${name}</span>
    <span class="sjt-area-meta">${raw} / ${max} · ${pct.toFixed(1)}%</span>
  </div>
  <div class="sjt-area-bar">
    <div class="sjt-area-fill" style="width:${barWidth}%;"></div>
  </div>
</div>`;
    })
    .join('');

  return `<p class="sjt-area-note">${esc(SJT_AREA_PERCENT_NOTE)}</p>
<div class="sjt-areas-block">${rows}</div>`;
}

/**
 * @param {{ scores: object, submittedAt?: string, attempt?: object }} ctx
 */
export function buildSjtSalesModuleFragment(ctx) {
  const { scores, submittedAt, attempt = null } = ctx;
  const closed = submittedAt ? esc(submittedAt) : '—';
  const rawScore = Number(scores.rawScore) || 0;
  const maxPossible = Number(scores.maxPossible) || SJT_SALES_MAX_POINTS;
  let profileLabel = scores.profileLabel || null;
  let profileDescription = scores.profileDescription || null;
  if (!profileLabel && scores.rawScore != null) {
    const legacy = resolveSjtSalesProfile(scores.rawScore);
    profileLabel = legacy.label;
    profileDescription = legacy.description;
  }
  profileLabel = profileLabel || '—';
  profileDescription =
    profileDescription ||
    'Descripción no disponible para este intento. Vuelva a calificar si el intento es reciente.';

  const percentScore = resolvePercentScore(scores, rawScore, maxPossible);
  const speedUnreliable = sjtSpeedUnreliable(scores, attempt);
  const macroSeries = resolveMacroCompetencies(scores);
  const macroBarsHtml = buildMacroAreaBarsHtml(macroSeries);

  return `
  <section class="module-block sjt-module" id="mod-sales-sjt">
    <div class="module-hd">
      ${SVG_SJT}
      <div>
        <h2 class="module-title">Simulador de Escenarios Comerciales (SJT)</h2>
        <p class="module-sub">Juicio situacional · 15 escenarios · Cierre: ${closed}</p>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Resultado ejecutivo</div>
      ${buildExecutiveBlock(scores, profileLabel, percentScore, rawScore, maxPossible, speedUnreliable)}
    </div>
    ${buildProfileReading(profileLabel, profileDescription)}
    <div class="section sjt-areas-section">
      <div class="section-title">Resultado por área situacional</div>
      ${macroBarsHtml}
    </div>
  </section>`;
}

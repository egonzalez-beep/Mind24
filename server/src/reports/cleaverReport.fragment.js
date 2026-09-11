import { CLEAVER_DISC_KEYS } from '../data/cleaverDiscKey.js';
import {
  analyzeCleaverProfile,
  CLEAVER_DISC_META,
  CLEAVER_NET_PROFILE_LABEL,
  cleaverProfileSynthesis,
  dominantDiscKey,
  formatCleaverRankingLine,
} from './cleaverProfileAnalysis.js';
import { buildCleaverRhReading } from './cleaverRhInterpretation.js';
import { esc } from './reportUtils.js';

export { cleaverProfileSynthesis, dominantDiscKey };

const DISC_META = CLEAVER_DISC_META;

const SVG_TARGET = `<svg class="module-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`;

const MLT_EXPLAIN = {
  most: 'Conductas o rasgos que la persona reconoce y destaca como propios al completar el instrumento.',
  least: 'Conductas o rasgos con los que la persona indica identificarse en menor medida.',
  total: 'Integración resultante de Más − Menos; base principal de la lectura DISC de este reporte.',
};

function formatDominantDisplay(group) {
  if (!group?.keys?.length) return '—';
  return group.keys
    .map((k) => `${CLEAVER_DISC_META[k].label} (${k})`)
    .join(' · ');
}

function formatSecondaryDisplay(analysis) {
  if (analysis.isBalanced) return '—';
  if (analysis.primary.tied) {
    if (analysis.secondary) return formatDominantDisplay(analysis.secondary);
    return '—';
  }
  if (!analysis.hasSecondary) return '—';
  return formatDominantDisplay(analysis.secondary);
}

function buildExecutiveBlock(analysis) {
  const statusPill = analysis.isBalanced
    ? '<span class="cle-pill cle-pill-balanced">Perfil equilibrado</span>'
    : analysis.isLowDifferentiation
      ? '<span class="cle-pill cle-pill-balanced">Poco diferenciado</span>'
      : analysis.primary.tied
        ? '<span class="cle-pill cle-pill-tie">Co-dominancia</span>'
        : analysis.hasSecondary && analysis.secondary?.tied
          ? '<span class="cle-pill cle-pill-tie">Empate secundario</span>'
          : '';

  const rankingLine = formatCleaverRankingLine(analysis.ranking);

  return `
<div class="cle-exec">
  <div class="cle-exec-head">
    <div class="cle-exec-kpi cle-exec-kpi-primary">
      <div class="cle-exec-label">${esc(CLEAVER_NET_PROFILE_LABEL)}</div>
      <div class="cle-exec-code">${esc(analysis.profileCodeDisplay)}</div>
    </div>
    <div class="cle-exec-kpi">
      <div class="cle-exec-label">Dimensión dominante</div>
      <div class="cle-exec-value">${esc(formatDominantDisplay(analysis.primary))}</div>
    </div>
    <div class="cle-exec-kpi">
      <div class="cle-exec-label">Dimensión secundaria</div>
      <div class="cle-exec-value">${esc(formatSecondaryDisplay(analysis))}</div>
    </div>
  </div>
  ${statusPill ? `<div class="cle-exec-status">${statusPill}</div>` : ''}
  <div class="cle-exec-ranking">
    <span class="cle-exec-label">Ranking DISC</span>
    <span class="cle-exec-ranking-line">${esc(rankingLine)}</span>
  </div>
  <div class="cle-exec-synthesis">
    <p class="interp">${esc(analysis.synthesis)}</p>
  </div>
</div>`;
}

/** Escala fija Más/Menos: 0–24 (comparable entre paneles). */
const MLT_SCALE_COUNT = 24;
/** Escala fija Perfil neto: −24…+24 con cero en el centro. */
const MLT_SCALE_NET = 24;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function buildMltBarRowCount(key, value) {
  const m = DISC_META[key];
  const v = clamp(Number(value) || 0, 0, MLT_SCALE_COUNT);
  const w = Math.round((v / MLT_SCALE_COUNT) * 100);
  return `<div class="cle-mlt-bar-row">
    <span class="cle-mlt-key" style="color:${m.color}">${key}</span>
    <div class="cle-mlt-track">
      <div class="cle-mlt-fill" style="width:${w}%;background:${m.color}"></div>
    </div>
    <span class="cle-mlt-val">${v}</span>
  </div>`;
}

function buildMltBarRowNet(key, value) {
  const m = DISC_META[key];
  const v = clamp(Number(value) || 0, -MLT_SCALE_NET, MLT_SCALE_NET);
  const display = v > 0 ? `+${v}` : String(v);
  const halfPct = Math.round((Math.abs(v) / MLT_SCALE_NET) * 50);
  let fill = '';
  if (v > 0) {
    fill = `<div class="cle-mlt-fill cle-mlt-fill-pos" style="left:50%;width:${halfPct}%;background:${m.color}"></div>`;
  } else if (v < 0) {
    fill = `<div class="cle-mlt-fill cle-mlt-fill-neg" style="left:${50 - halfPct}%;width:${halfPct}%;background:${m.color}"></div>`;
  }
  return `<div class="cle-mlt-bar-row">
    <span class="cle-mlt-key" style="color:${m.color}">${key}</span>
    <div class="cle-mlt-track cle-mlt-track-signed">
      <div class="cle-mlt-zero" aria-hidden="true"></div>
      ${fill}
    </div>
    <span class="cle-mlt-val">${display}</span>
  </div>`;
}

function buildMltPanel(title, subtitle, scores, mode) {
  const rows =
    mode === 'net'
      ? CLEAVER_DISC_KEYS.map((k) => buildMltBarRowNet(k, scores[k])).join('')
      : CLEAVER_DISC_KEYS.map((k) => buildMltBarRowCount(k, scores[k])).join('');
  return `<div class="cle-mlt-panel">
    <div class="cle-mlt-panel-hd">
      <div class="cle-mlt-panel-title">${esc(title)}</div>
      <div class="cle-mlt-panel-sub">${esc(subtitle)}</div>
    </div>
    <div class="cle-mlt-bars">${rows}</div>
  </div>`;
}

function buildTriadSection(most, least, total) {
  return `<div class="cle-triad">
    ${buildMltPanel('Más', 'Rasgos con los que más se identifica', most, 'count')}
    ${buildMltPanel('Menos', 'Rasgos con los que menos se identifica', least, 'count')}
    ${buildMltPanel('Perfil neto', 'Tendencia conductual integrada', total, 'net')}
  </div>
  <div class="cle-mlt-explain">
    <p><strong>Más:</strong> ${esc(MLT_EXPLAIN.most)}</p>
    <p><strong>Menos:</strong> ${esc(MLT_EXPLAIN.least)}</p>
    <p><strong>Perfil neto:</strong> ${esc(MLT_EXPLAIN.total)}</p>
  </div>`;
}

function buildRhList(items, cls) {
  return `<ul class="cle-rh-list ${cls}">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

function buildRhSection(rh) {
  return `<div class="cle-rh-grid">
    <div class="cle-rh-card cle-rh-strengths">
      <div class="cle-rh-card-title">Fortalezas conductuales</div>
      ${buildRhList(rh.strengths, 'cle-rh-strength-list')}
    </div>
    <div class="cle-rh-card cle-rh-attention">
      <div class="cle-rh-card-title">Puntos de atención</div>
      ${buildRhList(rh.attention, 'cle-rh-attention-list')}
    </div>
  </div>`;
}

function buildWorkplaceSection(areas) {
  const blocks = [
    { title: 'Comunicación e interacción', text: areas.communication },
    { title: 'Decisiones y ritmo', text: areas.decisions },
    { title: 'Normas y calidad', text: areas.norms },
    { title: 'Trabajo en equipo y estabilidad', text: areas.teamwork },
  ];
  return `<div class="cle-workplace-grid">${blocks
    .map(
      (b) => `<div class="cle-workplace-card">
      <div class="cle-workplace-title">${esc(b.title)}</div>
      <p class="cle-workplace-text">${esc(b.text)}</p>
    </div>`,
    )
    .join('')}</div>`;
}

function buildTechnicalSection(most, least, total, meta) {
  const rows = CLEAVER_DISC_KEYS.map((k) => {
    const m = DISC_META[k];
    return `<tr>
      <td><span class="dim-dot" style="background:${m.color}"></span>${m.label} (${k})</td>
      <td class="num">${most[k]}</td>
      <td class="num">${least[k]}</td>
      <td class="num strong">${total[k] > 0 ? '+' : ''}${total[k]}</td>
    </tr>`;
  }).join('');

  const metaBits = [];
  if (meta?.tetradCount != null && Number.isFinite(Number(meta.tetradCount))) {
    metaBits.push(`${meta.tetradCount}/24 tétradas completadas`);
  }
  if (meta?.unscoredMore != null && meta.unscoredMore > 0) {
    metaBits.push(`${meta.unscoredMore} selección(es) Más sin puntuación`);
  }
  if (meta?.unscoredLess != null && meta.unscoredLess > 0) {
    metaBits.push(`${meta.unscoredLess} selección(es) Menos sin puntuación`);
  }
  const metaLine = metaBits.length
    ? `<div class="cle-tech-meta">${esc(metaBits.join(' · '))}</div>`
    : '';

  return `<div class="cle-tech">
    ${metaLine}
    <table class="cle-tech-table">
      <thead><tr><th>Dimensión</th><th>Más</th><th>Menos</th><th>Perfil neto</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

export function extractCleaverScores(attempt) {
  const raw = attempt?.scores;
  if (!raw || typeof raw !== 'object') return null;
  const inner = raw.scores && typeof raw.scores === 'object' ? raw.scores : raw;
  const most = inner.most || inner.Most;
  const least = inner.least || inner.Least;
  const total = inner.total || inner.Total;
  if (!most || !least || !total) return null;
  const pick = (obj) => {
    const out = {};
    for (const k of CLEAVER_DISC_KEYS) {
      out[k] = Number(obj[k]) || 0;
    }
    return out;
  };
  const metaRaw = raw.meta && typeof raw.meta === 'object' ? raw.meta : null;
  const meta = {};
  if (metaRaw?.tetradCount != null) {
    const n = Number(metaRaw.tetradCount);
    if (Number.isFinite(n)) meta.tetradCount = n;
  }
  if (metaRaw?.unscoredMore != null) {
    const n = Number(metaRaw.unscoredMore);
    if (Number.isFinite(n) && n > 0) meta.unscoredMore = n;
  }
  if (metaRaw?.unscoredLess != null) {
    const n = Number(metaRaw.unscoredLess);
    if (Number.isFinite(n) && n > 0) meta.unscoredLess = n;
  }
  const picked = { most: pick(most), least: pick(least), total: pick(total) };
  if (Object.keys(meta).length > 0) picked.meta = meta;
  return picked;
}

/**
 * Fragmento HTML del módulo Cleaver (sin documento ni header ejecutivo).
 * @param {{ scores: object, submittedAt?: string, meta?: object }} ctx
 */
export function buildCleaverModuleFragment(ctx) {
  const { scores, submittedAt } = ctx;
  const { most, least, total, meta: scoresMeta } = scores;
  const meta = ctx.meta ?? scoresMeta ?? {};
  const analysis = analyzeCleaverProfile(total);
  const rh = buildCleaverRhReading(analysis, total, most, least);

  const closed = submittedAt ? esc(submittedAt) : '—';
  const executiveHtml = buildExecutiveBlock(analysis);
  const triadHtml = buildTriadSection(most, least, total);
  const rhHtml = buildRhSection(rh);
  const workplaceHtml = buildWorkplaceSection(rh.areas);
  const mostLeastNote = rh.mostLeastContext
    ? `<div class="cle-context-note"><p>${esc(rh.mostLeastContext)}</p></div>`
    : '';
  const techHtml = buildTechnicalSection(most, least, total, meta);

  return `
  <section class="module-block cle-module" id="mod-cleaver">
    <div class="module-hd">
      ${SVG_TARGET}
      <div>
        <h2 class="module-title">Comportamiento (Cleaver)</h2>
        <p class="module-sub">Perfil conductual DISC · ${esc(CLEAVER_NET_PROFILE_LABEL)} · Cierre: ${closed}</p>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Resultado ejecutivo</div>
      ${executiveHtml}
    </div>
    <div class="section">
      <div class="section-title">Capas del perfil — Más, Menos y Perfil neto</div>
      ${triadHtml}
    </div>
    <div class="section">
      <div class="section-title">Lectura para recursos humanos</div>
      ${rhHtml}
      ${mostLeastNote}
    </div>
    <div class="section">
      <div class="section-title">Áreas de comportamiento laboral</div>
      ${workplaceHtml}
    </div>
    <div class="section cle-tech-section">
      <div class="section-title section-title-muted">Referencia técnica</div>
      ${techHtml}
    </div>
  </section>`;
}

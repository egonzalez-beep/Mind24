import { esc } from './reportUtils.js';

export function extractHonestidadPayload(attempt) {
  const raw = attempt?.scores;
  if (!raw || typeof raw !== 'object') return null;
  if (raw.global == null && !raw.dimensions) return null;
  return {
    global: Number(raw.global) || 0,
    dimensions: raw.dimensions && typeof raw.dimensions === 'object' ? raw.dimensions : {},
    meta: raw.meta || {},
    interpretation: attempt.interpretation || {},
    flags: Array.isArray(attempt.flags) ? attempt.flags : [],
  };
}

/**
 * Fragmento HTML — Batería de Honestidad.
 */
export function buildHonestidadModuleFragment(ctx) {
  const { payload, submittedAt } = ctx;
  const { global, dimensions, interpretation, flags } = payload;
  const closed = submittedAt ? esc(submittedAt) : '—';

  const dimRows = Object.entries(dimensions)
    .map(([id, v]) => {
      const label = v?.label || id;
      const avg = v?.avg != null ? Number(v.avg).toFixed(1) : '—';
      return `<tr><td>${esc(label)}</td><td class="num strong">${avg}%</td></tr>`;
    })
    .join('');

  const flagList =
    flags.length > 0
      ? `<ul class="flag-list">${flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
      : '<p class="muted">Sin alertas automáticas registradas.</p>';

  const verdict = interpretation?.verdict || '—';
  const badge = interpretation?.badge || '—';
  const description = interpretation?.description || '';

  return `
  <section class="module-block" id="mod-honestidad">
    <div class="module-hd">
      <span class="module-icon">🛡️</span>
      <div>
        <h2 class="module-title">Batería de Honestidad (Mind24)</h2>
        <p class="module-sub">Índice antifraude y confianza · Cierre: ${closed}</p>
      </div>
    </div>
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Índice global</div>
        <div class="kpi-value">${Number(global).toFixed(1)}%</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Veredicto</div>
        <div class="kpi-value kpi-sm">${esc(verdict)}</div>
        <div class="kpi-badge">${esc(badge)}</div>
      </div>
    </div>
    ${
      description
        ? `<div class="section"><div class="section-title">Síntesis interpretativa</div><p class="interp">${esc(description)}</p></div>`
        : ''
    }
    <div class="section">
      <div class="section-title">Dimensiones evaluadas</div>
      <table>
        <thead><tr><th>Dimensión</th><th>Promedio</th></tr></thead>
        <tbody>${dimRows || '<tr><td colspan="2" class="muted">Sin desglose dimensional</td></tr>'}</tbody>
      </table>
    </div>
    <div class="section">
      <div class="section-title">Alertas y banderas</div>
      ${flagList}
    </div>
  </section>`;
}

import { esc } from './reportUtils.js';

const RISK_THRESHOLD = 50;

const RISK_MESSAGES = {
  honestidad:
    'Muestra tolerancia a desviaciones de política corporativa o justificación de conductas en zona gris.',
  etica:
    'Señales de flexibilidad elevada ante normas internas; conviene reforzar expectativas de cumplimiento.',
  integridad:
    'Riesgo de priorizar conveniencia personal sobre principios declarados de la organización.',
  responsabilidad:
    'Posible relajación en la rendición de cuentas y en el apego a procedimientos establecidos.',
  lealtad:
    'Indicadores de ambivalencia en compromiso institucional bajo presión o incentivos externos.',
};

function riskMessageForDimension(id, label) {
  const key = String(id || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (RISK_MESSAGES[key]) return RISK_MESSAGES[key];
  if (key.includes('honest')) return RISK_MESSAGES.honestidad;
  if (key.includes('etic')) return RISK_MESSAGES.etica;
  return `La dimensión «${label}» presenta un puntaje por debajo del umbral de referencia; se recomienda profundizar en entrevista estructurada.`;
}

/** @returns {{ label: string, avg: number, message: string }[]} */
export function collectHonestidadRiskAreas(dimensions, global) {
  const risks = [];
  for (const [id, v] of Object.entries(dimensions || {})) {
    const avg = Number(v?.avg);
    if (!Number.isFinite(avg) || avg >= RISK_THRESHOLD) continue;
    const label = v?.label || id;
    risks.push({ label, avg, message: riskMessageForDimension(id, label) });
  }
  if (Number.isFinite(global) && global < RISK_THRESHOLD && !risks.length) {
    risks.push({
      label: 'Índice global',
      avg: global,
      message:
        'El perfil global sugiere vulnerabilidad en criterios de confianza; validar con referencias y escenarios de integridad.',
    });
  }
  return risks;
}

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
  const risks = collectHonestidadRiskAreas(dimensions, global);

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

  const riskSection =
    risks.length > 0
      ? `<ul class="risk-list">${risks
          .map(
            (r) =>
              `<li class="risk-item"><strong>${esc(r.label)} · ${r.avg.toFixed(1)}%</strong><p>${esc(r.message)}</p></li>`,
          )
          .join('')}</ul>`
      : '<p class="muted">No se detectaron focos rojos por debajo del umbral de referencia en las dimensiones evaluadas.</p>';

  const verdict = interpretation?.verdict || '—';
  const badge = interpretation?.badge || '—';
  const description = interpretation?.description || '';

  return `
  <section class="module-block" id="mod-honestidad">
    <div class="module-hd">
      <span class="module-icon">🛡️</span>
      <div>
        <h2 class="module-title">Honestidad (Mind24)</h2>
        <p class="module-sub">Índice antifraude · Cierre: ${closed}</p>
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
      <div class="section-title">Áreas de riesgo / focos rojos</div>
      ${riskSection}
    </div>
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

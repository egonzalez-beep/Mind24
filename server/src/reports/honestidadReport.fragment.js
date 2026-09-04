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

/** Prueba invalidada por negación máxima (negDir = 5) o velocidad (< 2:00). */
export function isHonestidadPruebaInvalida(interpretation, meta) {
  if (meta?.denialReliability === 'invalid') return true;
  if (meta?.speedReliability === 'invalid') return true;
  if (meta?.reliability?.speedReliability === 'invalid') return true;
  const v = String(interpretation?.verdict || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  return v.includes('invalida') || v.includes('no confiable');
}

/**
 * Componente visual: Semáforo horizontal + barra termómetro con zona de colores.
 * Verde ≥70% | Amarillo 60-69% | Rojo <60%
 * @param {{ invalid?: boolean }} [opts] — fuerza rojo cuando la aplicación es inválida (negDir=5).
 */
function buildVerdictSemaforo(globalScore, verdict, opts = {}) {
  const pct = Math.min(100, Math.max(0, Number(globalScore) || 0));
  const forceInvalid = opts.invalid === true;
  const isGreen  = !forceInvalid && pct >= 70;
  const isYellow = !forceInvalid && pct >= 60 && pct < 70;
  const isRed    = forceInvalid || pct < 60;

  const textColor = isGreen ? '#065F46' : isYellow ? '#92400E' : '#991B1B';
  const bgColor   = isGreen ? '#ECFDF5' : isYellow ? '#FFFBEB'  : '#FEF2F2';
  const bdColor   = isGreen ? '#6EE7B7' : isYellow ? '#FCD34D'  : '#FCA5A5';

  const redLit    = isRed    ? '#EF4444' : '#FECACA';
  const yellowLit = isYellow ? '#F59E0B' : '#FDE68A';
  const greenLit  = isGreen  ? '#10B981' : '#A7F3D0';

  const redSh    = isRed    ? 'box-shadow:0 0 8px rgba(239,68,68,.6);'    : '';
  const yellowSh = isYellow ? 'box-shadow:0 0 8px rgba(245,158,11,.6);'   : '';
  const greenSh  = isGreen  ? 'box-shadow:0 0 8px rgba(16,185,129,.6);'   : '';

  const markerPct = pct.toFixed(1);

  return `
<div style="margin:12px 0 18px;padding:14px 16px;border-radius:12px;background:${bgColor};border:1.5px solid ${bdColor};">
  <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px;">
    <div style="display:flex;gap:10px;align-items:center;">
      <div style="width:22px;height:22px;border-radius:50%;background:${redLit};${redSh}"></div>
      <div style="width:22px;height:22px;border-radius:50%;background:${yellowLit};${yellowSh}"></div>
      <div style="width:22px;height:22px;border-radius:50%;background:${greenLit};${greenSh}"></div>
    </div>
    <span style="font-size:13px;font-weight:800;color:${textColor};">${esc(verdict)}</span>
    <span style="font-size:12px;font-weight:800;color:${textColor};margin-left:auto;">${markerPct}%</span>
  </div>
  <div style="position:relative;height:14px;border-radius:7px;overflow:hidden;background:linear-gradient(to right,#FCA5A5 0%,#FCA5A5 60%,#FDE68A 60%,#FDE68A 70%,#6EE7B7 70%,#6EE7B7 100%);">
    <div style="position:absolute;top:0;left:calc(${markerPct}% - 1.5px);width:3px;height:100%;background:#1F2937;border-radius:2px;"></div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:8px;color:#6B7280;font-weight:600;">
    <span>No Aprobatorio (&lt;60%)</span>
    <span>Bajo Reservas (60–70%)</span>
    <span>Aprobatorio (&gt;70%)</span>
  </div>
</div>`;
}

/**
 * Radar chart SVG (inline) para las dimensiones de honestidad.
 * Retorna cadena vacía si hay menos de 3 dimensiones (fallback a tabla).
 */
function buildDimensionsRadar(dimensions) {
  const entries = Object.entries(dimensions || {});
  const N = entries.length;
  if (N < 3) return '';

  const cx = 130, cy = 130, R = 95;
  const toAngle = (i) => -Math.PI / 2 + ((2 * Math.PI) / N) * i;

  // Grid polygons at 25 / 50 / 75 / 100 %
  const gridPolygons = [25, 50, 75, 100]
    .map((pct) => {
      const r = (pct / 100) * R;
      const pts = entries
        .map((_, i) => {
          const a = toAngle(i);
          return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
        })
        .join(' ');
      const isThreshold = pct === 50;
      return `<polygon points="${pts}" fill="none" stroke="${isThreshold ? '#FCA5A5' : '#E5E7EB'}" stroke-width="${isThreshold ? 1 : 0.6}" stroke-dasharray="${isThreshold ? '3,2' : ''}"/>`;
    })
    .join('');

  // Axis lines
  const axisLines = entries
    .map((_, i) => {
      const a = toAngle(i);
      return `<line x1="${cx}" y1="${cy}" x2="${(cx + R * Math.cos(a)).toFixed(1)}" y2="${(cy + R * Math.sin(a)).toFixed(1)}" stroke="#E5E7EB" stroke-width="0.7"/>`;
    })
    .join('');

  // Labels + score annotations
  const labels = entries
    .map(([id, v], i) => {
      const a = toAngle(i);
      const lr = R + 22;
      const lx = (cx + lr * Math.cos(a)).toFixed(1);
      const baseY = cy + lr * Math.sin(a);
      const score = Number(v?.avg || 0);
      const labelColor = score < RISK_THRESHOLD ? '#DC2626' : score >= 70 ? '#065F46' : '#92400E';
      const name = esc((v?.label || id).slice(0, 13));
      return `<text x="${lx}" y="${(baseY - 4).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#374151" font-weight="600">${name}</text>
      <text x="${lx}" y="${(baseY + 6).toFixed(1)}" text-anchor="middle" font-size="7" fill="${labelColor}" font-weight="700">${score.toFixed(0)}%</text>`;
    })
    .join('');

  // Data polygon
  const dataPoints = entries
    .map(([, v], i) => {
      const a = toAngle(i);
      const score = Math.min(100, Math.max(0, Number(v?.avg) || 0));
      const r = (score / 100) * R;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    })
    .join(' ');

  // Dot markers color-coded by risk
  const dots = entries
    .map(([, v], i) => {
      const a = toAngle(i);
      const score = Math.min(100, Math.max(0, Number(v?.avg) || 0));
      const r = (score / 100) * R;
      const dotColor =
        score < RISK_THRESHOLD ? '#EF4444' : score >= 70 ? '#10B981' : '#F59E0B';
      return `<circle cx="${(cx + r * Math.cos(a)).toFixed(1)}" cy="${(cy + r * Math.sin(a)).toFixed(1)}" r="3.5" fill="${dotColor}" stroke="white" stroke-width="1.2"/>`;
    })
    .join('');

  const avgScore = entries.reduce((s, [, v]) => s + (Number(v?.avg) || 0), 0) / N;
  const fillColor   = avgScore >= 70 ? '#10B981' : avgScore >= 60 ? '#F59E0B' : '#EF4444';
  const strokeColor = avgScore >= 70 ? '#059669' : avgScore >= 60 ? '#D97706' : '#DC2626';

  // Legend
  const legend = entries
    .map(([id, v]) => {
      const score = Number(v?.avg || 0);
      const dotColor =
        score < RISK_THRESHOLD ? '#EF4444' : score >= 70 ? '#10B981' : '#F59E0B';
      const name = esc((v?.label || id).slice(0, 20));
      return `<div style="display:flex;align-items:center;gap:5px;font-size:9px;margin-bottom:5px;">
  <div style="width:9px;height:9px;border-radius:50%;background:${dotColor};flex-shrink:0;"></div>
  <span style="color:#374151;font-weight:600;flex:1;">${name}</span>
  <span style="color:${dotColor};font-weight:800;min-width:30px;text-align:right;">${score.toFixed(1)}%</span>
</div>`;
    })
    .join('');

  return `
<div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;">
  <svg width="260" height="260" viewBox="0 0 260 260" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">
    ${gridPolygons}
    ${axisLines}
    ${labels}
    <polygon points="${dataPoints}" fill="${fillColor}" fill-opacity="0.18" stroke="${strokeColor}" stroke-width="2"/>
    ${dots}
  </svg>
  <div style="min-width:140px;padding-top:6px;">
    ${legend}
    <div style="margin-top:10px;padding:7px 9px;border-radius:8px;background:#F3F4F6;font-size:8px;color:#6B7280;line-height:1.7;">
      <div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#EF4444;margin-right:5px;vertical-align:middle;"></span>Riesgo (&lt;${RISK_THRESHOLD}%)</div>
      <div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#F59E0B;margin-right:5px;vertical-align:middle;"></span>Atención (${RISK_THRESHOLD}–69%)</div>
      <div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10B981;margin-right:5px;vertical-align:middle;"></span>Óptimo (≥70%)</div>
      <div style="margin-top:5px;border-top:1px solid #E5E7EB;padding-top:5px;">— — Línea punteada = umbral de riesgo (50%)</div>
    </div>
  </div>
</div>`;
}

/**
 * Fragmento HTML — Batería de Honestidad.
 */
export function buildHonestidadModuleFragment(ctx) {
  const { payload, submittedAt } = ctx;
  const { global, dimensions, interpretation, flags } = payload;
  const closed = submittedAt ? esc(submittedAt) : '—';
  const risks = collectHonestidadRiskAreas(dimensions, global);

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

  const verdict     = interpretation?.verdict     || '—';
  const badge       = interpretation?.badge       || '—';
  const description = interpretation?.description || '';
  const pruebaInvalida = isHonestidadPruebaInvalida(interpretation, payload.meta);

  const semaforoHtml = buildVerdictSemaforo(global, verdict, { invalid: pruebaInvalida });
  const radarHtml    = buildDimensionsRadar(dimensions);

  // Tabla de respaldo si el radar no puede renderizarse (<3 dims)
  const dimRows = Object.entries(dimensions)
    .map(([id, v]) => {
      const label = v?.label || id;
      const avg   = v?.avg != null ? Number(v.avg).toFixed(1) : '—';
      return `<tr><td>${esc(label)}</td><td class="num strong">${avg}%</td></tr>`;
    })
    .join('');

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
    ${semaforoHtml}
    ${description
      ? `<div class="section"><div class="section-title">Síntesis interpretativa</div><p class="interp">${esc(description)}</p></div>`
      : ''}
    <div class="section">
      <div class="section-title">Áreas de riesgo / focos rojos</div>
      ${riskSection}
    </div>
    <div class="section">
      <div class="section-title">Dimensiones evaluadas</div>
      ${radarHtml
        ? radarHtml
        : `<table>
            <thead><tr><th>Dimensión</th><th>Promedio</th></tr></thead>
            <tbody>${dimRows || '<tr><td colspan="2" class="muted">Sin desglose dimensional</td></tr>'}</tbody>
           </table>`}
    </div>
    <div class="section">
      <div class="section-title">Alertas y banderas</div>
      ${flagList}
    </div>
  </section>`;
}

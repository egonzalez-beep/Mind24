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

const SVG_SHIELD = `<svg class="module-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

function normalizeKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function riskMessageForDimension(id, label) {
  const key = normalizeKey(id);
  if (RISK_MESSAGES[key]) return RISK_MESSAGES[key];
  if (key.includes('honest')) return RISK_MESSAGES.honestidad;
  if (key.includes('etic')) return RISK_MESSAGES.etica;
  return `La dimensión «${label}» presenta un puntaje por debajo del umbral de referencia; se recomienda profundizar en entrevista estructurada.`;
}

function formatElapsed(seconds) {
  const sec = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** @returns {'Normal'|'Revisar'|'Baja confiabilidad'|'No interpretable'|'—'} */
export function reliabilityStateLabel(level) {
  switch (level) {
    case 'normal':
      return 'Normal';
    case 'review':
      return 'Revisar';
    case 'low_reliability':
      return 'Baja confiabilidad';
    case 'invalid':
      return 'No interpretable';
    default:
      return '—';
  }
}

function reliabilityStateClass(level) {
  switch (level) {
    case 'normal':
      return 'hon-rel-pill hon-rel-normal';
    case 'review':
      return 'hon-rel-pill hon-rel-review';
    case 'low_reliability':
      return 'hon-rel-pill hon-rel-low';
    case 'invalid':
      return 'hon-rel-pill hon-rel-invalid';
    default:
      return 'hon-rel-pill hon-rel-muted';
  }
}

function scoreBarColor(score) {
  const n = Number(score) || 0;
  if (n < RISK_THRESHOLD) return '#EF4444';
  if (n >= 70) return '#10B981';
  return '#F59E0B';
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

/** Prueba invalidada por negación, calibración (5 errores) o velocidad (< 2:00). */
export function isHonestidadPruebaInvalida(interpretation, meta) {
  if (meta?.denialReliability === 'invalid') return true;
  if (meta?.calibrationReliability === 'invalid') return true;
  if (meta?.speedReliability === 'invalid') return true;
  if (meta?.reliability?.speedReliability === 'invalid') return true;
  if (meta?.reliability?.calibrationReliability === 'invalid') return true;
  const v = normalizeKey(interpretation?.verdict);
  return v.includes('invalida') || v.includes('no confiable');
}

/**
 * Estado visual del semáforo — coherente con veredicto real, no solo con el global.
 * @returns {'pass'|'review'|'fail'|'invalid'}
 */
export function resolveHonestidadSemaforoState(verdict, opts = {}) {
  if (opts.invalid === true) return 'invalid';
  if (opts.lowReliability === true) return 'review';

  const v = normalizeKey(verdict);
  if (v.includes('invalida') || v.includes('no confiable')) return 'invalid';
  if (v.includes('no aprobatorio')) return 'fail';
  if (v.includes('reservas')) return 'review';
  if (v.includes('aprobatorio')) return 'pass';
  return 'review';
}

/**
 * Semáforo + barra de posición global. La luz activa sigue el veredicto integrado.
 */
function buildVerdictSemaforo(globalScore, verdict, opts = {}) {
  const pct = Math.min(100, Math.max(0, Number(globalScore) || 0));
  const state = resolveHonestidadSemaforoState(verdict, opts);
  const isGreen = state === 'pass';
  const isYellow = state === 'review';
  const isRed = state === 'fail' || state === 'invalid';

  const textColor = isGreen ? '#065F46' : isYellow ? '#92400E' : '#991B1B';
  const bgColor = isGreen ? '#ECFDF5' : isYellow ? '#FFFBEB' : '#FEF2F2';
  const bdColor = isGreen ? '#6EE7B7' : isYellow ? '#FCD34D' : '#FCA5A5';

  const redLit = isRed ? '#EF4444' : '#FECACA';
  const yellowLit = isYellow ? '#F59E0B' : '#FDE68A';
  const greenLit = isGreen ? '#10B981' : '#A7F3D0';

  const redSh = isRed ? 'box-shadow:0 0 8px rgba(239,68,68,.6);' : '';
  const yellowSh = isYellow ? 'box-shadow:0 0 8px rgba(245,158,11,.6);' : '';
  const greenSh = isGreen ? 'box-shadow:0 0 8px rgba(16,185,129,.6);' : '';

  const markerPct = pct.toFixed(1);

  return `
<div class="hon-semaforo" style="margin:0 0 14px;padding:14px 16px;border-radius:12px;background:${bgColor};border:1.5px solid ${bdColor};">
  <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px;">
    <div style="display:flex;gap:10px;align-items:center;">
      <div style="width:22px;height:22px;border-radius:50%;background:${redLit};${redSh}"></div>
      <div style="width:22px;height:22px;border-radius:50%;background:${yellowLit};${yellowSh}"></div>
      <div style="width:22px;height:22px;border-radius:50%;background:${greenLit};${greenSh}"></div>
    </div>
    <span style="font-size:10px;color:#6B7280;font-weight:600;margin-left:auto;">Posición global: ${markerPct}%</span>
  </div>
  <div style="position:relative;height:14px;border-radius:7px;overflow:hidden;background:linear-gradient(to right,#FCA5A5 0%,#FCA5A5 60%,#FDE68A 60%,#FDE68A 70%,#6EE7B7 70%,#6EE7B7 100%);">
    <div style="position:absolute;top:0;left:calc(${markerPct}% - 1.5px);width:3px;height:100%;background:#1F2937;border-radius:2px;"></div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:8px;color:#6B7280;font-weight:600;">
    <span>No Aprobatorio</span>
    <span>Con reservas</span>
    <span>Aprobatorio</span>
  </div>
  <p style="margin-top:8px;font-size:8px;color:#6B7280;line-height:1.45;">El semáforo refleja el veredicto integrado (dimensiones críticas, global y confiabilidad). La marca indica el índice global.</p>
</div>`;
}

function buildExecutiveBlock(global, verdict, pruebaInvalida) {
  const verdictClass =
    pruebaInvalida || normalizeKey(verdict).includes('no aprobatorio')
      ? 'hon-verdict hon-verdict-fail'
      : normalizeKey(verdict).includes('reservas')
        ? 'hon-verdict hon-verdict-review'
        : normalizeKey(verdict).includes('aprobatorio')
          ? 'hon-verdict hon-verdict-pass'
          : 'hon-verdict';

  return `
<div class="hon-exec">
  <div class="hon-exec-main">
    <div class="hon-exec-kpi">
      <div class="hon-exec-label">Índice global</div>
      <div class="hon-exec-value">${Number(global).toFixed(1)}%</div>
    </div>
    <div class="hon-exec-kpi">
      <div class="hon-exec-label">Veredicto</div>
      <div class="${verdictClass}">${esc(verdict)}</div>
    </div>
  </div>
</div>`;
}

function extractReliabilityMeta(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const rel = m.reliability && typeof m.reliability === 'object' ? m.reliability : {};
  return {
    elapsedSeconds: m.elapsedSeconds ?? rel.elapsedSeconds ?? null,
    errCal: m.errCal ?? rel.errCal ?? null,
    negDir: m.negDir ?? rel.negDir ?? null,
    speedReliability: m.speedReliability ?? rel.speedReliability ?? null,
    calibrationReliability: m.calibrationReliability ?? rel.calibrationReliability ?? null,
    denialReliability: m.denialReliability ?? rel.denialReliability ?? null,
  };
}

function buildReliabilityPanel(meta) {
  const rel = extractReliabilityMeta(meta);
  const elapsed =
    rel.elapsedSeconds != null && Number.isFinite(Number(rel.elapsedSeconds))
      ? formatElapsed(rel.elapsedSeconds)
      : '—';
  const errCal = rel.errCal != null ? String(rel.errCal) : '—';
  const negDir = rel.negDir != null ? String(rel.negDir) : '—';

  const rows = [
    { label: 'Tiempo total', value: elapsed },
    { label: 'Calibración', value: errCal },
    { label: 'Negaciones', value: negDir },
    {
      label: 'Velocidad',
      value: reliabilityStateLabel(rel.speedReliability),
      pillClass: reliabilityStateClass(rel.speedReliability),
    },
    {
      label: 'Calibración',
      value: reliabilityStateLabel(rel.calibrationReliability),
      pillClass: reliabilityStateClass(rel.calibrationReliability),
    },
    {
      label: 'Negación',
      value: reliabilityStateLabel(rel.denialReliability),
      pillClass: reliabilityStateClass(rel.denialReliability),
    },
  ];

  const cells = rows
    .map((r) => {
      const valHtml = r.pillClass
        ? `<span class="${r.pillClass}">${esc(r.value)}</span>`
        : `<span class="hon-rel-value">${esc(r.value)}</span>`;
      return `<div class="hon-rel-item"><span class="hon-rel-label">${esc(r.label)}</span>${valHtml}</div>`;
    })
    .join('');

  return `<div class="hon-reliability">${cells}</div>`;
}

function findDimensionExtremes(dimensions) {
  const entries = Object.entries(dimensions || {})
    .map(([id, v]) => ({
      id,
      label: v?.label || id,
      avg: Number(v?.avg),
    }))
    .filter((e) => Number.isFinite(e.avg));

  if (!entries.length) return null;

  let high = entries[0];
  let low = entries[0];
  for (const e of entries) {
    if (e.avg > high.avg) high = e;
    if (e.avg < low.avg) low = e;
  }
  if (high.id === low.id && entries.length === 1) return { high, low: null };
  return { high, low };
}

const RADAR_LABEL_LINES = {
  etica: ['Ética Personal', 'y Profesional'],
  'etica personal y profesional': ['Ética Personal', 'y Profesional'],
};

function splitRadarLabel(text, id) {
  const name = String(text || '');
  const key = normalizeKey(id || name);
  if (RADAR_LABEL_LINES[key]) {
    const [line1, line2 = ''] = RADAR_LABEL_LINES[key];
    return { line1, line2 };
  }
  if (name.length <= 14) return { line1: name, line2: '' };
  const mid = Math.ceil(name.length / 2);
  let split = name.lastIndexOf(' ', mid);
  if (split < 4) split = name.indexOf(' ', mid);
  if (split < 0) return { line1: name, line2: '' };
  return { line1: name.slice(0, split).trim(), line2: name.slice(split).trim() };
}

function dimensionBarLabel(id, label) {
  const key = normalizeKey(id);
  if (key === 'etica' || normalizeKey(label).includes('etica personal y prof')) {
    return 'Ética Personal y Profesional';
  }
  return label || id;
}

function buildDimensionBars(dimensions) {
  const entries = Object.entries(dimensions || {});
  if (!entries.length) return '';

  const rows = entries
    .map(([id, v]) => {
      const label = dimensionBarLabel(id, v?.label || id);
      const score = Math.min(100, Math.max(0, Number(v?.avg) || 0));
      const color = scoreBarColor(score);
      return `<div class="bar-row hon-bar-row" style="grid-template-columns:minmax(148px,1fr) 1.4fr 36px;">
  <div class="bar-label">${esc(label)}</div>
  <div class="bar-track"><div class="bar-fill" style="width:${score.toFixed(1)}%;background:${color};"></div></div>
  <div class="bar-val" style="color:${color};">${score.toFixed(0)}%</div>
</div>`;
    })
    .join('');

  return `<div class="hon-bars">${rows}</div>`;
}

/**
 * Radar chart SVG (inline) para las dimensiones de honestidad.
 * Retorna cadena vacía si hay menos de 3 dimensiones (fallback a tabla).
 */
function buildDimensionsRadar(dimensions) {
  const entries = Object.entries(dimensions || {});
  const N = entries.length;
  if (N < 3) return '';

  const cx = 150;
  const cy = 150;
  const R = 88;
  const toAngle = (i) => -Math.PI / 2 + ((2 * Math.PI) / N) * i;

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

  const axisLines = entries
    .map((_, i) => {
      const a = toAngle(i);
      return `<line x1="${cx}" y1="${cy}" x2="${(cx + R * Math.cos(a)).toFixed(1)}" y2="${(cy + R * Math.sin(a)).toFixed(1)}" stroke="#E5E7EB" stroke-width="0.7"/>`;
    })
    .join('');

  const labels = entries
    .map(([id, v], i) => {
      const a = toAngle(i);
      const lr = R + 32;
      const lx = (cx + lr * Math.cos(a)).toFixed(1);
      const baseY = cy + lr * Math.sin(a);
      const score = Number(v?.avg || 0);
      const labelColor = score < RISK_THRESHOLD ? '#DC2626' : score >= 70 ? '#065F46' : '#92400E';
      const { line1, line2 } = splitRadarLabel(v?.label || id, id);
      const anchor =
        Math.abs(Math.cos(a)) < 0.15 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
      const labelSvg = line2
        ? `<text x="${lx}" y="${(baseY - 5).toFixed(1)}" text-anchor="${anchor}" font-size="6.5" fill="#374151" font-weight="600"><tspan x="${lx}" dy="0">${esc(line1)}</tspan><tspan x="${lx}" dy="7">${esc(line2)}</tspan></text>`
        : `<text x="${lx}" y="${(baseY - 2).toFixed(1)}" text-anchor="${anchor}" font-size="6.5" fill="#374151" font-weight="600">${esc(line1)}</text>`;
      const scoreY = line2 ? baseY + 11 : baseY + 7;
      return `${labelSvg}
      <text x="${lx}" y="${scoreY.toFixed(1)}" text-anchor="middle" font-size="7" fill="${labelColor}" font-weight="700">${score.toFixed(0)}%</text>`;
    })
    .join('');

  const dataPoints = entries
    .map(([, v], i) => {
      const a = toAngle(i);
      const score = Math.min(100, Math.max(0, Number(v?.avg) || 0));
      const r = (score / 100) * R;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    })
    .join(' ');

  const dots = entries
    .map(([, v], i) => {
      const a = toAngle(i);
      const score = Math.min(100, Math.max(0, Number(v?.avg) || 0));
      const r = (score / 100) * R;
      const dotColor = scoreBarColor(score);
      return `<circle cx="${(cx + r * Math.cos(a)).toFixed(1)}" cy="${(cy + r * Math.sin(a)).toFixed(1)}" r="3.5" fill="${dotColor}" stroke="white" stroke-width="1.2"/>`;
    })
    .join('');

  const avgScore = entries.reduce((s, [, v]) => s + (Number(v?.avg) || 0), 0) / N;
  const fillColor = scoreBarColor(avgScore);
  const strokeColor = fillColor;

  return `
<div class="hon-radar-wrap">
  <svg width="260" height="260" viewBox="-10 -10 320 320" overflow="visible" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;overflow:visible;">
    ${gridPolygons}
    ${axisLines}
    ${labels}
    <polygon points="${dataPoints}" fill="${fillColor}" fill-opacity="0.18" stroke="${strokeColor}" stroke-width="2"/>
    ${dots}
  </svg>
</div>`;
}

function buildExtremesNote(extremes) {
  if (!extremes?.high) return '';
  const high = `<span class="hon-extreme">${esc(extremes.high.label)} · ${extremes.high.avg.toFixed(0)}%</span>`;
  if (!extremes.low || extremes.low.id === extremes.high.id) {
    return `<p class="hon-extremes-note">Mayor puntaje: ${high}</p>`;
  }
  const low = `<span class="hon-extreme">${esc(extremes.low.label)} · ${extremes.low.avg.toFixed(0)}%</span>`;
  return `<p class="hon-extremes-note">Mayor: ${high} · Menor: ${low}</p>`;
}

function buildAttentionSection(risks) {
  if (!risks.length) return '';
  const items = risks
    .map(
      (r) =>
        `<li class="hon-attention-item"><strong>${esc(r.label)} · ${r.avg.toFixed(1)}%</strong><span>${esc(r.message)}</span></li>`,
    )
    .join('');
  return `
<div class="section">
  <div class="section-title">Áreas de atención</div>
  <ul class="hon-attention-list">${items}</ul>
</div>`;
}

/**
 * Fragmento HTML — Batería de Honestidad.
 */
export function buildHonestidadModuleFragment(ctx) {
  const { payload, submittedAt } = ctx;
  const { global, dimensions, interpretation, meta } = payload;
  const closed = submittedAt ? esc(submittedAt) : '—';
  const risks = collectHonestidadRiskAreas(dimensions, global);

  const verdict = interpretation?.verdict || '—';
  const description = interpretation?.description || '';
  const pruebaInvalida = isHonestidadPruebaInvalida(interpretation, meta);
  const calLowReliability =
    meta?.calibrationReliability === 'low_reliability' && !pruebaInvalida;

  const executiveHtml = buildExecutiveBlock(global, verdict, pruebaInvalida);
  const semaforoHtml = buildVerdictSemaforo(global, verdict, {
    invalid: pruebaInvalida,
    lowReliability: calLowReliability,
  });
  const reliabilityHtml = buildReliabilityPanel(meta);
  const radarHtml = buildDimensionsRadar(dimensions);
  const barsHtml = buildDimensionBars(dimensions);
  const extremes = findDimensionExtremes(dimensions);
  const extremesNote = buildExtremesNote(extremes);
  const attentionHtml = buildAttentionSection(risks);

  const invalidDisclaimer = pruebaInvalida
    ? `<div class="hon-disclaimer">Esta aplicación no es interpretable por confiabilidad. El índice global no debe utilizarse como base de decisión; se recomienda una nueva evaluación.</div>`
    : '';

  const synthesisHtml =
    description && !pruebaInvalida
      ? `<div class="section hon-synthesis"><p class="interp">${esc(description)}</p></div>`
      : pruebaInvalida && description
        ? `<div class="section hon-synthesis"><p class="interp">${esc(description)}</p></div>`
        : '';

  const dimRows = Object.entries(dimensions)
    .map(([id, v]) => {
      const label = v?.label || id;
      const avg = v?.avg != null ? Number(v.avg).toFixed(1) : '—';
      return `<tr><td>${esc(label)}</td><td class="num strong">${avg}%</td></tr>`;
    })
    .join('');

  const dimensionsBody =
    radarHtml || barsHtml
      ? `<div class="hon-dimensions">
          ${radarHtml || ''}
          ${barsHtml || ''}
          ${extremesNote}
        </div>`
      : `<table>
            <thead><tr><th>Dimensión</th><th>Promedio</th></tr></thead>
            <tbody>${dimRows || '<tr><td colspan="2" class="muted">Sin desglose dimensional</td></tr>'}</tbody>
           </table>`;

  return `
  <section class="module-block hon-module" id="mod-honestidad">
    <div class="module-hd">
      ${SVG_SHIELD}
      <div>
        <h2 class="module-title">Honestidad (Mind24)</h2>
        <p class="module-sub">Índice antifraude · Cierre: ${closed}</p>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Resultado ejecutivo</div>
      ${executiveHtml}
      ${semaforoHtml}
      ${invalidDisclaimer}
    </div>
    <div class="section">
      <div class="section-title">Confiabilidad de la aplicación</div>
      ${reliabilityHtml}
    </div>
    ${synthesisHtml}
    <div class="section">
      <div class="section-title">Dimensiones</div>
      ${dimensionsBody}
    </div>
    ${attentionHtml}
  </section>`;
}

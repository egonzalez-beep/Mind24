import { CLEAVER_DISC_KEYS } from '../data/cleaverDiscKey.js';

const DISC_META = {
  D: { label: 'Dominancia', sub: 'Empuje', color: '#7C3AED' },
  I: { label: 'Influencia', sub: 'Conexión', color: '#DB2777' },
  S: { label: 'Estabilidad', sub: 'Apoyo', color: '#059669' },
  C: { label: 'Cumplimiento', sub: 'Control', color: '#2563EB' },
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function trendIcon(delta) {
  if (delta > 0) return { icon: '▲', label: 'Aumenta', cls: 'up' };
  if (delta < 0) return { icon: '▼', label: 'Disminuye', cls: 'down' };
  return { icon: '■', label: 'Estable', cls: 'flat' };
}

function competencyNote(key, delta) {
  const notes = {
    D: {
      up: 'Mayor asertividad y orientación a resultados bajo presión; prioriza decisiones rápidas.',
      down: 'Menor necesidad de control directo; puede delegar y esperar consenso.',
      flat: 'Equilibrio en toma de decisiones; ni impulso ni evitación dominante.',
    },
    I: {
      up: 'Incrementa influencia social y persuasión; busca visibilidad y alianzas.',
      down: 'Prefiere trabajo analítico o individual; comunicación más reservada.',
      flat: 'Estilo comunicativo moderado sin exceso de exposición.',
    },
    S: {
      up: 'Refuerza paciencia, escucha y continuidad; resiste cambios bruscos.',
      down: 'Tolera ritmos acelerados y cambio; menor apego a rutinas.',
      flat: 'Flexibilidad razonable entre estabilidad y adaptación.',
    },
    C: {
      up: 'Eleva precisión, normas y calidad; atención a detalle y procedimiento.',
      down: 'Prioriza velocidad sobre perfección; tolera ambigüedad normativa.',
      flat: 'Cumplimiento equilibrado sin rigidez extrema.',
    },
  };
  const bucket = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  return notes[key][bucket];
}

/** Radar SVG — ejes D,I,S,C con valores `total` (-24..24 aprox). */
function buildRadarSvg(total) {
  const cx = 140;
  const cy = 140;
  const maxR = 88;
  const scale = 24;
  const angles = { D: -90, I: 0, S: 90, C: 180 };
  const pt = (key) => {
    const v = Math.max(-scale, Math.min(scale, Number(total[key]) || 0));
    const r = (v / scale) * maxR;
    const rad = (angles[key] * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const pts = CLEAVER_DISC_KEYS.map((k) => pt(k));
  const poly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const grid = [0.25, 0.5, 0.75, 1]
    .map((f) => {
      const r = maxR * f;
      const gpts = CLEAVER_DISC_KEYS.map((k) => {
        const rad = (angles[k] * Math.PI) / 180;
        return `${cx + r * Math.cos(rad)},${cy + r * Math.sin(rad)}`;
      }).join(' ');
      return `<polygon points="${gpts}" fill="none" stroke="#E5E7EB" stroke-width="1"/>`;
    })
    .join('');
  const axes = CLEAVER_DISC_KEYS.map((k) => {
    const rad = (angles[k] * Math.PI) / 180;
    const x2 = cx + maxR * Math.cos(rad);
    const y2 = cy + maxR * Math.sin(rad);
    const lx = cx + (maxR + 22) * Math.cos(rad);
    const ly = cy + (maxR + 22) * Math.sin(rad);
    return `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="#D1D5DB" stroke-width="1"/>
      <text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="${DISC_META[k].color}">${k}</text>`;
  }).join('');
  return `<svg viewBox="0 0 280 280" width="280" height="280" xmlns="http://www.w3.org/2000/svg">
    ${grid}
    ${axes}
    <polygon points="${poly}" fill="rgba(124,58,237,0.25)" stroke="#7C3AED" stroke-width="2.5"/>
    ${pts.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${DISC_META[CLEAVER_DISC_KEYS[i]].color}"/>`).join('')}
  </svg>`;
}

function barWidth(val, maxVal) {
  const m = Math.max(maxVal, 1);
  return Math.round((Math.abs(Number(val) || 0) / m) * 100);
}

export function buildCleaverReportHtml(ctx) {
  const { candidateName, puesto, evaluationId, completedAt, scores } = ctx;
  const { most, least, total } = scores;
  const maxBar = Math.max(...CLEAVER_DISC_KEYS.map((k) => Math.abs(total[k])), 1);

  const metricsRows = CLEAVER_DISC_KEYS.map((k) => {
    const m = DISC_META[k];
    return `<tr>
      <td><span class="dim-dot" style="background:${m.color}"></span>${m.label} (${k})</td>
      <td class="num">${most[k]}</td>
      <td class="num">${least[k]}</td>
      <td class="num strong">${total[k]}</td>
    </tr>`;
  }).join('');

  const changeRows = CLEAVER_DISC_KEYS.map((k) => {
    const delta = (most[k] || 0) - (least[k] || 0);
    const t = trendIcon(total[k]);
    const m = DISC_META[k];
    return `<div class="change-card">
      <div class="change-hd">
        <span class="dim-dot" style="background:${m.color}"></span>
        <strong>${m.label}</strong>
        <span class="trend ${t.cls}">${t.icon} ${t.label}</span>
      </div>
      <div class="change-metrics">Más: <b>${most[k]}</b> · Menos: <b>${least[k]}</b> · Total: <b>${total[k]}</b></div>
      <p class="change-note">${esc(competencyNote(k, total[k]))}</p>
    </div>`;
  }).join('');

  const bars = CLEAVER_DISC_KEYS.map((k) => {
    const m = DISC_META[k];
    const w = barWidth(total[k], maxBar);
    const sign = total[k] < 0 ? 'neg' : 'pos';
    return `<div class="bar-row">
      <div class="bar-label">${k} · ${m.label}</div>
      <div class="bar-track"><div class="bar-fill ${sign}" style="width:${w}%;background:${m.color}"></div></div>
      <div class="bar-val">${total[k]}</div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Inter,Arial,sans-serif;color:#111827;font-size:11px;line-height:1.45;background:#fff}
  .page{padding:28px 32px 24px}
  .brand{border-bottom:3px solid #7C3AED;padding-bottom:14px;margin-bottom:18px}
  .brand h1{font-size:20px;font-weight:800;color:#4C1D95;letter-spacing:-.02em}
  .brand p{font-size:10px;color:#6B7280;margin-top:4px;text-transform:uppercase;letter-spacing:.12em}
  .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin-bottom:20px}
  .meta-item label{display:block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9CA3AF}
  .meta-item span{font-size:12px;font-weight:600;color:#111827}
  .status{display:inline-block;padding:4px 10px;border-radius:999px;background:#D1FAE5;color:#065F46;font-size:10px;font-weight:700}
  .section{margin-top:18px}
  .section-title{font-size:12px;font-weight:800;color:#374151;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px;border-left:4px solid #7C3AED;padding-left:8px}
  .charts{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}
  .chart-box{border:1px solid #E5E7EB;border-radius:10px;padding:14px;background:#FAFAFA}
  .chart-box h3{font-size:11px;font-weight:700;color:#4B5563;margin-bottom:10px;text-align:center}
  .bar-row{display:grid;grid-template-columns:120px 1fr 36px;gap:8px;align-items:center;margin-bottom:8px}
  .bar-label{font-size:10px;font-weight:600}
  .bar-track{height:10px;background:#E5E7EB;border-radius:6px;overflow:hidden}
  .bar-fill{height:100%;border-radius:6px}
  .bar-val{font-size:10px;font-weight:700;text-align:right}
  table{width:100%;border-collapse:collapse;font-size:10px}
  th,td{padding:8px 10px;border-bottom:1px solid #E5E7EB;text-align:left}
  th{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;background:#F9FAFB}
  td.num{text-align:center;font-variant-numeric:tabular-nums}
  td.strong{font-weight:800}
  .dim-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
  .change-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .change-card{border:1px solid #E5E7EB;border-radius:8px;padding:10px;background:#fff}
  .change-hd{display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap}
  .trend{font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px}
  .trend.up{background:#EDE9FE;color:#5B21B6}
  .trend.down{background:#FEE2E2;color:#991B1B}
  .trend.flat{background:#F3F4F6;color:#4B5563}
  .change-metrics{font-size:9px;color:#6B7280;margin-bottom:4px}
  .change-note{font-size:9px;color:#374151;line-height:1.4}
  .footer{margin-top:22px;padding-top:10px;border-top:1px solid #E5E7EB;font-size:8px;color:#9CA3AF;text-align:center}
</style>
</head>
<body>
<div class="page">
  <div class="brand">
    <h1>Reporte Cleaver — Perfil conductual DISC</h1>
    <p>Mind24 Assess · Informe técnico ejecutivo</p>
  </div>
  <div class="meta-grid">
    <div class="meta-item"><label>Candidato</label><span>${esc(candidateName)}</span></div>
    <div class="meta-item"><label>Puesto evaluado</label><span>${esc(puesto)}</span></div>
    <div class="meta-item"><label>ID de evaluación</label><span>${esc(evaluationId)}</span></div>
    <div class="meta-item"><label>Estatus</label><span class="status">Completado</span></div>
    <div class="meta-item"><label>Fecha de cierre</label><span>${esc(completedAt)}</span></div>
    <div class="meta-item"><label>Instrumento</label><span>Comportamiento (CLEAVER) · 24 tétradas</span></div>
  </div>

  <div class="section">
    <div class="section-title">Perfil gráfico — intensidad relativa (Total = Más − Menos)</div>
    <div class="charts">
      <div class="chart-box">
        <h3>Perfil radar (Total DISC)</h3>
        ${buildRadarSvg(total)}
      </div>
      <div class="chart-box">
        <h3>Barras de perfil total</h3>
        ${bars}
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Métricas crudas por dimensión</div>
    <table>
      <thead><tr><th>Dimensión</th><th>Más</th><th>Menos</th><th>Total</th></tr></thead>
      <tbody>${metricsRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Vector de cambio conductual (bajo presión)</div>
    <div class="change-grid">${changeRows}</div>
  </div>

  <div class="footer">Documento generado automáticamente por Mind24 · Uso confidencial RH · ${esc(new Date().toISOString().slice(0, 10))}</div>
</div>
</body>
</html>`;
}

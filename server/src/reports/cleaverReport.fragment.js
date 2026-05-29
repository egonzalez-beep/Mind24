import { CLEAVER_DISC_KEYS } from '../data/cleaverDiscKey.js';
import { esc } from './reportUtils.js';

const DISC_META = {
  D: { label: 'Dominancia', sub: 'Empuje', color: '#7C3AED' },
  I: { label: 'Influencia', sub: 'Conexión', color: '#DB2777' },
  S: { label: 'Estabilidad', sub: 'Apoyo', color: '#059669' },
  C: { label: 'Cumplimiento', sub: 'Control', color: '#2563EB' },
};

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

function buildRadarSvg(total) {
  const cx = 140, cy = 140, maxR = 88, scale = 24;
  const angles = { D: -90, I: 0, S: 90, C: 180 };

  const pt = (key) => {
    const v   = Math.max(-scale, Math.min(scale, Number(total[key]) || 0));
    const r   = (v / scale) * maxR;
    const rad = (angles[key] * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const pts  = CLEAVER_DISC_KEYS.map((k) => pt(k));
  const poly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Subtle concentric grids
  const grid = [0.25, 0.5, 0.75, 1]
    .map((f) => {
      const r    = maxR * f;
      const gpts = CLEAVER_DISC_KEYS.map((k) => {
        const rad = (angles[k] * Math.PI) / 180;
        return `${(cx + r * Math.cos(rad)).toFixed(1)},${(cy + r * Math.sin(rad)).toFixed(1)}`;
      }).join(' ');
      const is75 = f === 0.75;
      return `<polygon points="${gpts}" fill="${f === 1 ? 'rgba(241,245,249,0.6)' : 'none'}" stroke="${is75 ? '#CBD5E1' : '#E5E7EB'}" stroke-width="${f === 1 ? 0.8 : 0.5}"/>`;
    })
    .join('');

  // Colored axis lines + labels
  const axes = CLEAVER_DISC_KEYS.map((k) => {
    const rad = (angles[k] * Math.PI) / 180;
    const x2  = cx + maxR * Math.cos(rad);
    const y2  = cy + maxR * Math.sin(rad);
    const lx  = cx + (maxR + 24) * Math.cos(rad);
    const ly  = cy + (maxR + 24) * Math.sin(rad);
    const col = DISC_META[k].color;
    return `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="0.8" opacity="0.4"/>
<circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="2.5" fill="${col}" opacity="0.3"/>
<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="800" fill="${col}" filter="url(#diskLabelShadow)">${k}</text>`;
  }).join('');

  // Per-dimension colored dot with outer ring
  const dotMarkup = pts
    .map(
      (p, i) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="7" fill="${DISC_META[CLEAVER_DISC_KEYS[i]].color}" opacity="0.18"/>
<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="${DISC_META[CLEAVER_DISC_KEYS[i]].color}" stroke="white" stroke-width="1.5"/>`,
    )
    .join('');

  return `<svg viewBox="0 0 280 280" width="280" height="280" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="discPolyGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#7C3AED" flood-opacity="0.28"/>
    </filter>
    <filter id="diskLabelShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000" flood-opacity="0.10"/>
    </filter>
    <radialGradient id="discBgGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#F5F3FF" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${maxR}" fill="url(#discBgGrad)"/>
  ${grid}
  ${axes}
  <polygon points="${poly}" fill="rgba(124,58,237,0.18)" stroke="#7C3AED" stroke-width="2" stroke-linejoin="round" filter="url(#discPolyGlow)"/>
  ${dotMarkup}
</svg>`;
}

function barWidth(val, maxVal) {
  const m = Math.max(maxVal, 1);
  return Math.round((Math.abs(Number(val) || 0) / m) * 100);
}

const PROFILE_SYNTHESIS = {
  D: 'El candidato prioriza la velocidad y los resultados; es directo y asume riesgos.',
  I: 'El candidato es persuasivo, sociable y prioriza las relaciones interpersonales.',
  S: 'El candidato valora la estabilidad, la cooperación y un ritmo de trabajo constante.',
  C: 'El candidato prioriza la precisión, las normas y decisiones basadas en datos y procedimiento.',
};

/** Dimensión DISC con mayor puntaje en `total`. */
export function dominantDiscKey(total) {
  let winner = CLEAVER_DISC_KEYS[0];
  let max = Number(total[winner]) || 0;
  for (const k of CLEAVER_DISC_KEYS) {
    const v = Number(total[k]) || 0;
    if (v > max) {
      max = v;
      winner = k;
    }
  }
  return winner;
}

export function cleaverProfileSynthesis(total) {
  const key = dominantDiscKey(total);
  const meta = DISC_META[key];
  const text = PROFILE_SYNTHESIS[key] || '';
  return { key, label: meta.label, text };
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
  return { most: pick(most), least: pick(least), total: pick(total) };
}

/**
 * Fragmento HTML del módulo Cleaver (sin documento ni header ejecutivo).
 * @param {{ scores: object, submittedAt?: string }} ctx
 */
export function buildCleaverModuleFragment(ctx) {
  const { scores, submittedAt } = ctx;
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
    const m    = DISC_META[k];
    const w    = barWidth(total[k], maxBar);
    const val  = total[k];
    const isNeg = val < 0;
    // Premium gradient fill: each DISC has its own accent gradient
    const gradMap = {
      D: 'linear-gradient(90deg,#6D28D9,#7C3AED)',
      I: 'linear-gradient(90deg,#BE185D,#DB2777)',
      S: 'linear-gradient(90deg,#047857,#059669)',
      C: 'linear-gradient(90deg,#1D4ED8,#2563EB)',
    };
    const shadowMap = {
      D: '0 2px 8px rgba(124,58,237,.30)',
      I: '0 2px 8px rgba(219,39,119,.30)',
      S: '0 2px 8px rgba(5,150,105,.30)',
      C: '0 2px 8px rgba(37,99,235,.30)',
    };
    return `<div class="bar-row" style="margin-bottom:10px;">
      <div class="bar-label" style="font-weight:700;color:#374151;">${k} · ${m.label}</div>
      <div class="bar-track" style="background:#F1F5F9;border-radius:999px;height:11px;overflow:hidden;">
        <div style="width:${w}%;height:100%;border-radius:999px;background:${gradMap[k]};box-shadow:${shadowMap[k]};${isNeg ? 'opacity:.55;' : ''}"></div>
      </div>
      <div class="bar-val" style="color:${m.color};font-weight:800;">${val > 0 ? '+' : ''}${val}</div>
    </div>`;
  }).join('');

  const closed = submittedAt ? esc(submittedAt) : '—';
  const synth = cleaverProfileSynthesis(total);

  return `
  <section class="module-block" id="mod-cleaver">
    <div class="module-hd">
      <span class="module-icon">🎯</span>
      <div>
        <h2 class="module-title">Comportamiento (CLEAVER)</h2>
        <p class="module-sub">Perfil conductual DISC · Cierre: ${closed}</p>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Síntesis interpretativa del perfil</div>
      <div class="synthesis-box">
        <p class="interp"><strong>Dimensión predominante: ${esc(synth.label)} (${synth.key})</strong> — ${esc(synth.text)}</p>
      </div>
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
  </section>`;
}

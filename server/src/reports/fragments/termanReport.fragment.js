import { esc } from '../reportUtils.js';

export function extractTermanScores(attempt) {
  const raw = attempt?.scores;
  if (!raw || typeof raw !== 'object') return null;
  const inner = raw.scores && typeof raw.scores === 'object' ? raw.scores : raw;
  if (inner.rawScore == null && !inner.series) return null;
  return inner;
}

export function buildTermanModuleFragment(ctx) {
  const { scores, submittedAt } = ctx;
  const closed = submittedAt ? esc(submittedAt) : '—';
  const rawScore = Number(scores.rawScore) || 0;
  const totalQuestions = Number(scores.totalQuestions) || 0;
  const percent = Number(scores.percentCorrect) || 0;
  const ciDisplay =
    scores.ci != null
      ? String(scores.ci)
      : scores.ciEstimate != null
        ? `~${scores.ciEstimate} (preliminar)`
        : 'Por calibrar';
  const ciNote = scores.ciNote || '';

  const series = Array.isArray(scores.series) ? scores.series : [];
  const maxPct = Math.max(...series.map((s) => Number(s.percent) || 0), 1);

  const bars = series
    .map((s) => {
      const pct = Number(s.percent) || 0;
      const w = Math.round((pct / maxPct) * 100);
      const correct = Number(s.correct) || 0;
      const total = Number(s.total) || 0;
      return `<div class="bar-row">
        <div class="bar-label">${esc(s.name || s.seriesId)}</div>
        <div class="bar-track"><div class="bar-fill pos" style="width:${w}%;background:#2563EB"></div></div>
        <div class="bar-val">${correct}/${total}</div>
      </div>`;
    })
    .join('');

  const tableRows = series
    .map(
      (s) =>
        `<tr>
          <td>${esc(s.name || s.seriesId)}</td>
          <td class="num">${Number(s.correct) || 0}</td>
          <td class="num">${Number(s.total) || 0}</td>
          <td class="num strong">${(Number(s.percent) || 0).toFixed(1)}%</td>
        </tr>`,
    )
    .join('');

  const strongest = [...series].sort(
    (a, b) => (Number(b.percent) || 0) - (Number(a.percent) || 0),
  )[0];
  const synth = strongest
    ? `Mayor rendimiento relativo en «${esc(strongest.name)}» (${(Number(strongest.percent) || 0).toFixed(1)}%). Esto sugiere una inclinación analítica hacia esta área cognitiva.`
    : 'Sin desglose por series disponible.';

  return `
  <section class="module-block" id="mod-terman">
    <div class="module-hd">
      <span class="module-icon">🧠</span>
      <div>
        <h2 class="module-title">Evaluación Cognitiva Analítica Mind24</h2>
        <p class="module-sub">10 series · 50 reactivos · Cierre: ${closed}</p>
      </div>
    </div>
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Puntaje bruto global</div>
        <div class="kpi-value">${rawScore} <span style="font-size:12px;font-weight:600;color:#6B7280">/ ${totalQuestions || 50}</span></div>
        <div class="kpi-badge">${percent.toFixed(1)}% aciertos</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Coeficiente intelectual (CI)</div>
        <div class="kpi-value kpi-sm">${esc(ciDisplay)}</div>
        <div class="kpi-badge">${esc(ciNote)}</div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Síntesis de perfil analítico</div>
      <p class="interp">${synth}</p>
    </div>
    <div class="section">
      <div class="section-title">Rendimiento por serie</div>
      <div class="chart-box" style="margin-bottom:12px">
        <h3>Intensidad por área (% aciertos)</h3>
        ${bars || '<p class="muted">Sin datos de series</p>'}
      </div>
      <table>
        <thead><tr><th>Serie</th><th>Aciertos</th><th>Total</th><th>%</th></tr></thead>
        <tbody>${tableRows || '<tr><td colspan="4" class="muted">—</td></tr>'}</tbody>
      </table>
    </div>
  </section>`;
}

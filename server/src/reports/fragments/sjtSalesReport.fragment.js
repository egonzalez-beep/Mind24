import { esc } from '../reportUtils.js';

export function extractSjtSalesScores(attempt) {
  const raw = attempt?.scores;
  if (!raw || typeof raw !== 'object') return null;
  const inner = raw.scores && typeof raw.scores === 'object' ? raw.scores : raw;
  if (inner.rawScore == null && !inner.scenarios) return null;
  return inner;
}

export function buildSjtSalesModuleFragment(ctx) {
  const { scores, submittedAt } = ctx;
  const closed = submittedAt ? esc(submittedAt) : '—';
  const rawScore = Number(scores.rawScore) || 0;
  const maxPossible = Number(scores.maxPossible) || 50;
  const percent = Number(scores.percentScore) || 0;
  const level = scores.performanceLevel || '—';

  const series = Array.isArray(scores.scenarios) ? scores.scenarios : [];
  const maxPct = Math.max(...series.map((s) => Number(s.percent) || 0), 1);

  const bars = series
    .map((s) => {
      const pct = Number(s.percent) || 0;
      const w = Math.round((pct / maxPct) * 100);
      return `<div class="bar-row">
        <div class="bar-label">${esc(s.competence || s.scenarioId)}</div>
        <div class="bar-track"><div class="bar-fill pos" style="width:${w}%;background:#059669"></div></div>
        <div class="bar-val">${Number(s.points) || 0}/${Number(s.maxPoints) || 5}</div>
      </div>`;
    })
    .join('');

  const tableRows = series
    .map(
      (s) =>
        `<tr>
          <td>${esc(s.competence || s.scenarioId)}</td>
          <td class="num">${Number(s.points) || 0}</td>
          <td class="num">${Number(s.maxPoints) || 5}</td>
          <td class="num strong">${(Number(s.percent) || 0).toFixed(1)}%</td>
        </tr>`,
    )
    .join('');

  const synth = scores.strongestCompetence
    ? `Desempeño global ${level.toLowerCase()} (${percent.toFixed(1)}%). Mayor puntaje relativo en «${esc(scores.strongestCompetence)}».${
        scores.weakestCompetence && scores.weakestCompetence !== scores.strongestCompetence
          ? ` Área de oportunidad: «${esc(scores.weakestCompetence)}».`
          : ''
      }`
    : 'Sin desglose por competencia disponible.';

  return `
  <section class="module-block" id="mod-sales-sjt">
    <div class="module-hd">
      <span class="module-icon">📊</span>
      <div>
        <h2 class="module-title">Simulador de Escenarios Comerciales (SJT)</h2>
        <p class="module-sub">10 escenarios · Puntuación ponderada · Cierre: ${closed}</p>
      </div>
    </div>
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Puntaje ponderado</div>
        <div class="kpi-value">${rawScore} <span style="font-size:12px;font-weight:600;color:#6B7280">/ ${maxPossible}</span></div>
        <div class="kpi-badge">${percent.toFixed(1)}% · ${esc(level)}</div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Síntesis comercial</div>
      <p class="interp">${synth}</p>
    </div>
    <div class="section">
      <div class="section-title">Rendimiento por competencia</div>
      <div class="chart-box" style="margin-bottom:12px">
        <h3>Intensidad por área (% del máximo por escenario)</h3>
        ${bars || '<p class="muted">Sin datos</p>'}
      </div>
      <table>
        <thead><tr><th>Competencia</th><th>Puntos</th><th>Máx.</th><th>%</th></tr></thead>
        <tbody>${tableRows || '<tr><td colspan="4" class="muted">—</td></tr>'}</tbody>
      </table>
    </div>
  </section>`;
}

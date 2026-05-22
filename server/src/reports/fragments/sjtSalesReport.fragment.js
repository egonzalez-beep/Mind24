import { esc } from '../reportUtils.js';
import { SJT_SALES_MAX_POINTS } from '../../data/sjtSalesData.js';
import { resolveSjtSalesProfile } from '../../services/sjtSalesScoring.service.js';

export function extractSjtSalesScores(attempt) {
  const raw = attempt?.scores;
  if (!raw || typeof raw !== 'object') return null;
  const inner = raw.scores && typeof raw.scores === 'object' ? raw.scores : raw;
  if (inner.rawScore == null && !inner.scenarios) return null;
  return inner;
}

function competenceShortLabel(competence) {
  const c = String(competence || '');
  const paren = c.indexOf('(');
  if (paren > 0) return c.slice(0, paren).trim();
  return c || '—';
}

export function buildSjtSalesModuleFragment(ctx) {
  const { scores, submittedAt } = ctx;
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
    'Dictamen no disponible para este intento. Vuelva a calificar si el intento es reciente.';

  const series = Array.isArray(scores.scenarios) ? scores.scenarios : [];

  const competenceList = series
    .map((s) => {
      const name = competenceShortLabel(s.competence);
      const pts = Number(s.points) || 0;
      const max = Number(s.maxPoints) || 5;
      return `<li><strong>${esc(name)}</strong> — ${pts}/${max} pts</li>`;
    })
    .join('');

  const tableRows = series
    .map(
      (s) =>
        `<tr>
          <td>${esc(s.competence || s.scenarioId)}</td>
          <td class="num">${Number(s.points) || 0}</td>
          <td class="num">${Number(s.maxPoints) || 5}</td>
        </tr>`,
    )
    .join('');

  return `
  <section class="module-block" id="mod-sales-sjt">
    <div class="module-hd">
      <span class="module-icon">📊</span>
      <div>
        <h2 class="module-title">Simulador de Escenarios Comerciales (SJT)</h2>
        <p class="module-sub">Juicio situacional · Cierre: ${closed}</p>
      </div>
    </div>
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Puntaje obtenido</div>
        <div class="kpi-value">${rawScore} <span style="font-size:12px;font-weight:600;color:#6B7280">/ ${maxPossible}</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Perfil comercial asignado</div>
        <div class="kpi-value kpi-sm">${esc(profileLabel)}</div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Dictamen del perfil</div>
      <p class="interp"><strong>${esc(profileLabel)}.</strong> ${esc(profileDescription)}</p>
    </div>
    <div class="section">
      <div class="section-title">Competencias evaluadas</div>
      <ul class="interp" style="margin:0;padding-left:20px;line-height:1.55">
        ${competenceList || '<li class="muted">Sin desglose disponible</li>'}
      </ul>
    </div>
    <div class="section">
      <div class="section-title">Detalle por escenario</div>
      <table>
        <thead><tr><th>Competencia</th><th>Puntos</th><th>Máx.</th></tr></thead>
        <tbody>${tableRows || '<tr><td colspan="3" class="muted">—</td></tr>'}</tbody>
      </table>
    </div>
  </section>`;
}

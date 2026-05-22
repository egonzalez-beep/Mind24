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

/** Análisis técnico fijo por perfil (interpretación para el cliente). */
const SJT_TECHNICAL_PROFILE_ANALYSIS = {
  consultor_estrategico: `Este nivel refleja madurez comercial avanzada: el evaluado integra datos, margen y relación de largo plazo antes de conceder descuentos o promesas. Ante el rechazo, suele aislar objeciones, reencuadrar valor y sostener límites éticos sin romper el vínculo. En el ciclo de venta acorta tiempos muertos al proponer siguientes pasos concretos y alinear expectativas con compras y operaciones. Su impacto en la organización es predecible: pipeline más calificado, menor riesgo legal y renovaciones con menor fricción, aunque puede parecer menos agresivo en cierres de volumen inmediato.`,
  ejecutivo_cierre_agil: `Indica orientación a resultado y velocidad en el embudo. El candidato prioriza avanzar el ciclo con llamadas de seguimiento, urgencia razonable y cierres antes de que el interés se enfríe. Ante el rechazo, reacciona con contraofertas, casos de éxito o concesiones tácticas; bajo presión puede ceder margen para no perder la oportunidad del mes. En ventas aporta volumen y ocupación del mercado, pero requiere coaching en negociación estructurada y cumplimiento de promesas para no erosionar margen ni postventa.`,
  especialista_fidelizacion: `Señala fortaleza en servicio, empatía y continuidad de cuenta más que en prospección agresiva. Ante el rechazo o la queja, valida emociones, ofrece planes de acción y busca compensaciones que restauren confianza antes de escalar conflicto. En prospección en frío puede mostrar cautela o dependencia de guiones. En el ciclo de venta es ideal para retención, expansión en cuentas instaladas y comunicación en crisis, siempre que se le complemente con entrenamiento en discovery y cierre consultivo para nuevos logos.`,
  asesor_operativo: `Sugiere preferencia por procesos, políticas y flujos definidos; el ritmo lo marca con frecuencia el cliente o el área interna. Ante objeciones complejas puede apelar a reglas, derivar a terceros o postergar decisiones en lugar de negociar valor. En el ciclo de venta contribuye a orden documental y cumplimiento, pero alarga etapas si no recibe acompañamiento en manejo de objeciones y priorización (retención vs. crecimiento). Su desarrollo impacta directamente en tasa de cierre y en percepción de proactividad comercial.`,
};

function technicalAnalysisForProfile(scores) {
  const key = scores.profileKey || resolveSjtSalesProfile(scores.rawScore).key;
  return (
    SJT_TECHNICAL_PROFILE_ANALYSIS[key] ||
    SJT_TECHNICAL_PROFILE_ANALYSIS.asesor_operativo
  );
}

function buildCompetenceBarsHtml(series) {
  if (!series.length) {
    return '<p class="muted">Sin desglose por competencia.</p>';
  }
  const rows = series
    .map((s) => {
      const name = esc(competenceShortLabel(s.competence));
      const pts = Number(s.points) || 0;
      const max = Number(s.maxPoints) || 5;
      const pct = max > 0 ? Math.round((pts / max) * 100) : 0;
      const barColor =
        pct >= 80 ? '#059669' : pct >= 50 ? '#D97706' : '#DC2626';
      return `
        <div class="sjt-bar-row">
          <div class="sjt-bar-label">${name}</div>
          <div class="sjt-bar-track">
            <div class="sjt-bar-fill" style="width:${pct}%;background:${barColor}"></div>
          </div>
          <div class="sjt-bar-score">${pts}/${max}</div>
        </div>`;
    })
    .join('');

  return `
    <div class="sjt-bars-wrap">
      <style>
        .sjt-bars-wrap{margin-top:8px}
        .sjt-bar-row{display:grid;grid-template-columns:minmax(120px,34%) 1fr 48px;gap:10px;align-items:center;margin-bottom:10px;font-size:12px}
        .sjt-bar-label{font-weight:600;color:#1E293B;line-height:1.3}
        .sjt-bar-track{height:10px;background:#E2E8F0;border-radius:6px;overflow:hidden}
        .sjt-bar-fill{height:100%;border-radius:6px;min-width:2px}
        .sjt-bar-score{font-weight:700;color:#475569;text-align:right;font-variant-numeric:tabular-nums}
      </style>
      ${rows}
    </div>`;
}

export function buildSjtSalesModuleFragment(ctx) {
  const { scores, submittedAt } = ctx;
  const closed = submittedAt ? esc(submittedAt) : '—';
  const rawScore = Number(scores.rawScore) || 0;
  const maxPossible = Number(scores.maxPossible) || SJT_SALES_MAX_POINTS;
  let profileLabel = scores.profileLabel || null;
  let profileDescription = scores.profileDescription || null;
  let profileKey = scores.profileKey || null;
  if (!profileLabel && scores.rawScore != null) {
    const legacy = resolveSjtSalesProfile(scores.rawScore);
    profileLabel = legacy.label;
    profileDescription = legacy.description;
    profileKey = legacy.key;
  }
  profileLabel = profileLabel || '—';
  profileKey = profileKey || resolveSjtSalesProfile(rawScore).key;
  profileDescription =
    profileDescription ||
    'Dictamen no disponible para este intento. Vuelva a calificar si el intento es reciente.';

  const series = Array.isArray(scores.scenarios) ? scores.scenarios : [];
  const technicalText = technicalAnalysisForProfile({ ...scores, profileKey });
  const barsHtml = buildCompetenceBarsHtml(series);

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
      <div class="section-title">Análisis técnico de perfiles</div>
      <p class="interp" style="line-height:1.65;text-align:justify">${esc(technicalText)}</p>
    </div>
    <div class="section">
      <div class="section-title">Desempeño por competencia</div>
      ${barsHtml}
    </div>
  </section>`;
}

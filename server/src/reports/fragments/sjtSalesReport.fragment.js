import { esc } from '../reportUtils.js';
import { SJT_SALES_MAX_POINTS } from '../../data/sjtSalesData.js';
import {
  computeSjtSalesMacroCompetencies,
  resolveSjtSalesProfile,
} from '../../services/sjtSalesScoring.service.js';
import { extractReliabilityFromAttempt } from '../reliabilityAlert.fragment.js';

export const SJT_PDF_SPEED_THRESHOLD_SEC = 3;

export const SJT_UNRELIABLE_SPEED_ALERT_TEXT =
  '⚠️ ALERTA DE CONFIABILIDAD: El candidato completó esta evaluación en un tiempo inusualmente bajo, sugiriendo respuestas aleatorias. Resultados no fiables.';

export function extractSjtSalesScores(attempt) {
  const raw = attempt?.scores;
  if (!raw || typeof raw !== 'object') return null;
  const inner = raw.scores && typeof raw.scores === 'object' ? raw.scores : raw;
  if (inner.rawScore == null && !inner.scenarios && !inner.macroCompetencies) return null;
  return inner;
}

function resolveMacroCompetencies(scores) {
  if (Array.isArray(scores.macroCompetencies) && scores.macroCompetencies.length) {
    return scores.macroCompetencies;
  }
  if (Array.isArray(scores.scenarios) && scores.scenarios.length) {
    return computeSjtSalesMacroCompetencies(scores.scenarios);
  }
  return [];
}

function sjtAttemptSpeedUnreliable(attempt) {
  const rel = extractReliabilityFromAttempt(attempt);
  if (rel?.isUnreliableSpeed) return true;
  const avg = rel?.avgSecondsPerQuestion;
  return avg != null && Number(avg) < SJT_PDF_SPEED_THRESHOLD_SEC;
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

function buildMacroAreaBarsHtml(macroSeries) {
  if (!macroSeries.length) {
    return '<p class="muted">Sin desglose por área comercial.</p>';
  }
  const rows = macroSeries
    .map((m) => {
      const name = esc(m.label || m.key || '—');
      const pct = Math.max(0, Math.min(100, Math.round(Number(m.percent) || 0)));
      const barColor =
        pct >= 80 ? '#059669' : pct >= 50 ? '#D97706' : '#DC2626';
      const blocks = Math.max(1, Math.round(pct / 10));
      const barChars = '█'.repeat(blocks) + '░'.repeat(10 - blocks);
      return `
        <div class="sjt-macro-row">
          <div class="sjt-macro-label">${name}</div>
          <div class="sjt-macro-bar-line" aria-hidden="true">
            <span class="sjt-macro-blocks" style="color:${barColor}">${barChars}</span>
          </div>
          <div class="sjt-macro-pct" style="color:${barColor}">${pct}%</div>
        </div>`;
    })
    .join('');

  return `
    <div class="sjt-macro-wrap">
      <style>
        .sjt-macro-wrap{margin-top:8px}
        .sjt-macro-row{display:grid;grid-template-columns:minmax(140px,38%) 1fr 52px;gap:10px;align-items:center;margin-bottom:12px;font-size:12px}
        .sjt-macro-label{font-weight:700;color:#1E293B;line-height:1.35}
        .sjt-macro-bar-line{font-family:ui-monospace,Consolas,monospace;font-size:11px;letter-spacing:1px;line-height:1}
        .sjt-macro-blocks{white-space:nowrap}
        .sjt-macro-pct{font-weight:800;text-align:right;font-variant-numeric:tabular-nums}
      </style>
      ${rows}
    </div>`;
}

function buildAlertsSectionHtml(attempt) {
  if (!sjtAttemptSpeedUnreliable(attempt)) {
    return `
    <div class="section">
      <div class="section-title">Alertas y banderas</div>
      <p class="muted">Sin alertas de confiabilidad registradas para este intento.</p>
    </div>`;
  }
  return `
    <div class="section">
      <div class="section-title">Alertas y banderas</div>
      <div class="reliability-alert">${esc(SJT_UNRELIABLE_SPEED_ALERT_TEXT)}</div>
    </div>`;
}

/**
 * @param {{ scores: object, submittedAt?: string, attempt?: object }} ctx
 */
export function buildSjtSalesModuleFragment(ctx) {
  const { scores, submittedAt, attempt = null } = ctx;
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

  const macroSeries = resolveMacroCompetencies(scores);
  const technicalText = technicalAnalysisForProfile({ ...scores, profileKey });
  const macroBarsHtml = buildMacroAreaBarsHtml(macroSeries);
  const alertsHtml = buildAlertsSectionHtml(attempt);

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
    ${alertsHtml}
    <div class="section">
      <div class="section-title">Dictamen del perfil</div>
      <p class="interp"><strong>${esc(profileLabel)}.</strong> ${esc(profileDescription)}</p>
    </div>
    <div class="section">
      <div class="section-title">Análisis técnico de perfiles</div>
      <p class="interp" style="line-height:1.65;text-align:justify">${esc(technicalText)}</p>
    </div>
    <div class="section">
      <div class="section-title">Desempeño por área comercial</div>
      ${macroBarsHtml}
    </div>
  </section>`;
}

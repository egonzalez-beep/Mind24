import { esc } from './reportUtils.js';
import { coverSummaryGridClass } from './coverSummary.js';

/** Icono lineal sobrio — resultados (único SVG destacado en sección batería). */
const SVG_BATTERY = `<svg class="cover-section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="16" height="12" rx="2"/><path d="M21 10v4"/><path d="M7 10v4M11 10v4M15 10v4"/></svg>`;

const MASTER_STYLES = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Inter,Arial,sans-serif;color:#111827;font-size:11px;line-height:1.45;background:#fff}
  .page{padding:0}
  .cover-page{
    padding:32px 36px 28px;
    page-break-after:always;
    background:linear-gradient(165deg,#FAFAFF 0%,#fff 42%,#fff 100%);
    border-bottom:1px solid #E5E7EB;
  }
  .cover-top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:22px}
  .cover-logo-slot{flex:0 0 auto;width:180px;max-width:40%;min-height:40px;display:flex;align-items:center}
  .cover-logo-img{max-width:180px;max-height:40px;width:auto;height:auto;display:block;object-fit:contain}
  .cover-logo-fallback{font-size:21px;font-weight:800;color:#4C1D95;letter-spacing:-.03em;line-height:1}
  .cover-brand-text{text-align:right;flex:1;min-width:0}
  .cover-product{font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#7C3AED}
  .cover-title{font-size:22px;font-weight:800;color:#4C1D95;letter-spacing:-.03em;line-height:1.2;margin-top:6px}
  .cover-subtitle{font-size:11px;color:#6B7280;margin-top:6px;font-weight:500}
  .cover-org{font-size:12px;font-weight:700;color:#374151;margin-top:4px}
  .cover-accent{height:4px;width:100%;border-radius:999px;background:linear-gradient(90deg,#7C3AED 0%,#A78BFA 55%,#EDE9FE 100%);margin-bottom:22px}
  .cover-meta{
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:12px 28px;
    padding:18px 20px;
    border:1px solid #E5E7EB;
    border-radius:12px;
    background:#fff;
    box-shadow:0 1px 3px rgba(17,24,39,.04);
    margin-bottom:20px;
  }
  .cover-meta-item label{display:block;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#9CA3AF;margin-bottom:3px}
  .cover-meta-item span{font-size:12px;font-weight:600;color:#111827;line-height:1.4}
  .cover-meta-item span.cover-meta-muted{color:#6B7280;font-weight:500}
  .cover-meta-item--wide{grid-column:1/-1}
  .cover-status{display:inline-block;padding:3px 10px;border-radius:999px;background:#D1FAE5;color:#065F46;font-size:9px;font-weight:700;letter-spacing:.04em}
  .cover-battery{margin-top:0}
  .cover-battery-hd{display:flex;align-items:center;gap:8px;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #EDE9FE}
  .cover-section-icon{width:18px;height:18px;color:#7C3AED;flex-shrink:0}
  .cover-battery-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:#5B21B6}
  .summary-grid{display:grid;gap:14px;width:100%}
  .summary-grid--1{grid-template-columns:1fr;width:100%}
  .summary-grid--1 .summary-card{
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:12px 28px;
    min-height:auto;
    padding:18px 22px;
  }
  .summary-grid--1 .summary-card-title{grid-column:1/-1;margin-bottom:2px}
  .summary-grid--1 .summary-kpi{margin-bottom:0}
  .summary-grid--1 .summary-kpi:last-child{margin-top:0}
  .summary-grid--2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .summary-grid--multi{grid-template-columns:repeat(auto-fit,minmax(168px,1fr))}
  .summary-card{
    border:1px solid #E5E7EB;
    border-radius:12px;
    padding:14px 16px;
    background:#fff;
    box-shadow:0 1px 2px rgba(17,24,39,.04);
    border-top:3px solid #7C3AED;
    min-height:108px;
    display:flex;
    flex-direction:column;
  }
  .summary-card-title{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#4C1D95;margin-bottom:10px;line-height:1.35}
  .summary-kpi{margin-bottom:8px}
  .summary-kpi:last-child{margin-bottom:0;margin-top:auto}
  .summary-kpi-label{font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9CA3AF}
  .summary-kpi-value{font-size:13px;font-weight:800;color:#111827;margin-top:2px;line-height:1.35}
  .summary-kpi-value.summary-kpi-primary{font-size:18px;color:#4C1D95}
  .summary-kpi-value.summary-kpi-sm{font-size:11px;font-weight:700;color:#374151}
  .details-page{padding:28px 32px 24px}
  .module-block{margin-top:28px;padding-top:22px;border-top:2px solid #E5E7EB;page-break-inside:avoid}
  .module-block:first-child{margin-top:0;padding-top:0;border-top:none}
  .module-hd{display:flex;align-items:flex-start;gap:12px;margin-bottom:16px}
  .module-icon{font-size:22px;line-height:1}
  .module-title{font-size:15px;font-weight:800;color:#374151}
  .module-sub{font-size:10px;color:#6B7280;margin-top:2px}
  .section{margin-top:14px}
  .section-title{font-size:11px;font-weight:800;color:#374151;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px;border-left:4px solid #7C3AED;padding-left:8px}
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
  .kpi-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
  .kpi-card{border:1px solid #E5E7EB;border-radius:10px;padding:14px;background:#FAFAFA}
  .kpi-label{font-size:9px;font-weight:700;text-transform:uppercase;color:#9CA3AF}
  .kpi-value{font-size:22px;font-weight:800;color:#4C1D95;margin-top:4px}
  .kpi-value.kpi-sm{font-size:14px}
  .kpi-badge{font-size:10px;color:#6B7280;margin-top:4px}
  .interp{font-size:10px;color:#374151;line-height:1.5}
  .synthesis-box{padding:12px 14px;border-radius:8px;background:#F5F3FF;border:1px solid #DDD6FE}
  .flag-list{margin:0;padding-left:18px;font-size:10px;color:#374151}
  .flag-list li{margin-bottom:4px}
  .risk-list{margin:0;padding:0;list-style:none}
  .risk-item{border:1px solid #FECACA;border-radius:8px;padding:10px;margin-bottom:8px;background:#FEF2F2}
  .risk-item strong{display:block;font-size:10px;color:#991B1B;margin-bottom:4px}
  .risk-item p{font-size:9px;color:#7F1D1D;line-height:1.45;margin:0}
  .muted{color:#9CA3AF;font-size:10px}
  .reliability-alert{padding:12px 14px;border:2px solid #DC2626;border-radius:8px;background:#FEF2F2;color:#991B1B;font-size:10px;font-weight:700;line-height:1.55;margin-bottom:14px}
  .module-svg-icon{width:22px;height:22px;color:#7C3AED;flex-shrink:0;margin-top:2px}
  .hon-exec{border:1px solid #E5E7EB;border-radius:12px;padding:14px 16px;background:#fff;box-shadow:0 1px 2px rgba(17,24,39,.04);border-top:3px solid #7C3AED;margin-bottom:12px}
  .hon-exec-main{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
  .hon-exec-label{font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9CA3AF}
  .hon-exec-value{font-size:24px;font-weight:800;color:#4C1D95;margin-top:4px;line-height:1.1}
  .hon-verdict{font-size:14px;font-weight:800;margin-top:4px;line-height:1.25;color:#374151}
  .hon-verdict-pass{color:#065F46}
  .hon-verdict-review{color:#92400E}
  .hon-verdict-fail{color:#991B1B}
  .hon-exec-badge{font-size:9px;color:#6B7280;margin-top:4px;font-weight:600}
  .hon-disclaimer{margin-top:10px;padding:10px 12px;border-radius:8px;background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;font-size:9px;font-weight:700;line-height:1.5}
  .hon-reliability{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 12px;padding:12px 14px;border:1px solid #E5E7EB;border-radius:10px;background:#FAFAFA}
  .hon-rel-item{display:flex;flex-direction:column;gap:3px;min-width:0}
  .hon-rel-label{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9CA3AF;line-height:1.3}
  .hon-rel-value{font-size:11px;font-weight:700;color:#111827}
  .hon-rel-pill{display:inline-block;width:fit-content;padding:2px 8px;border-radius:999px;font-size:9px;font-weight:700;line-height:1.4}
  .hon-rel-normal{background:#D1FAE5;color:#065F46}
  .hon-rel-review{background:#FEF3C7;color:#92400E}
  .hon-rel-low{background:#FFEDD5;color:#9A3412}
  .hon-rel-invalid{background:#FEE2E2;color:#991B1B}
  .hon-rel-muted{background:#F3F4F6;color:#6B7280}
  .hon-dimensions{display:grid;grid-template-columns:260px 1fr;gap:16px 20px;align-items:start}
  .hon-bars{min-width:0;padding-top:4px}
  .hon-bar-row{grid-template-columns:minmax(120px,1fr) 1.4fr 36px}
  .hon-extremes-note{grid-column:1/-1;font-size:9px;color:#6B7280;margin:0;padding-top:2px}
  .hon-extreme{font-weight:700;color:#374151}
  .hon-attention-list{margin:0;padding:0;list-style:none}
  .hon-attention-item{border-left:3px solid #FCA5A5;padding:8px 10px;margin-bottom:8px;background:#FFFBFB;font-size:9px;line-height:1.45;color:#7F1D1D}
  .hon-attention-item strong{display:block;font-size:9px;color:#991B1B;margin-bottom:3px}
  .hon-attention-item span{color:#7F1D1D}
  .hon-synthesis .interp{padding:10px 12px;border-radius:8px;background:#F5F3FF;border:1px solid #DDD6FE}
  .generic-body{padding:12px 14px;border:1px dashed #D1D5DB;border-radius:8px;background:#F9FAFB}
  .footer{margin-top:22px;padding-top:10px;border-top:1px solid #E5E7EB;font-size:8px;color:#9CA3AF;text-align:center}
`;

function buildSummaryCardsHtml(summaries) {
  if (!summaries?.length) {
    return '<p class="muted">Sin resultados consolidados.</p>';
  }
  const gridClass = coverSummaryGridClass(summaries.length);
  const cards = summaries
    .map((card, idx) => {
      const lines = (card.lines || []).map((ln, li) => {
        const isPrimary = li === 0;
        const valClass = isPrimary
          ? 'summary-kpi-value summary-kpi-primary'
          : ln.label === 'Completitud'
            ? 'summary-kpi-value summary-kpi-sm'
            : 'summary-kpi-value';
        return `<div class="summary-kpi">
        <div class="summary-kpi-label">${esc(ln.label)}</div>
        <div class="${valClass}">${esc(ln.value)}</div>
      </div>`;
      }).join('');
      return `<article class="summary-card" id="cover-mod-${esc(card.moduleKey)}-${idx}">
        <div class="summary-card-title">${esc(card.title)}</div>
        ${lines}
      </article>`;
    })
    .join('');
  return `<div class="${gridClass}">${cards}</div>`;
}

function buildLogoSlotHtml(logoDataUri) {
  if (logoDataUri) {
    return `<img src="${logoDataUri}" alt="Mind24" class="cover-logo-img"/>`;
  }
  return '<span class="cover-logo-fallback" aria-hidden="true">Mind24</span>';
}

function buildCoverPageHtml(ctx) {
  const {
    organizationName,
    candidateName,
    puesto,
    curp,
    modulesAppliedLine,
    moduleCount,
    completedAt,
    moduleCoverSummaries,
    logoDataUri,
  } = ctx;

  const showCurp = curp && curp !== '—';
  const moduleCountLabel =
    moduleCount === 1 ? '1 módulo aplicado' : `${moduleCount} módulos aplicados`;

  return `<section class="cover-page" id="report-cover">
  <div class="cover-top">
    <div class="cover-logo-slot">${buildLogoSlotHtml(logoDataUri)}</div>
    <div class="cover-brand-text">
      <div class="cover-product">Mind24 Assess</div>
      <h1 class="cover-title">Reporte de Evaluación Psicométrica</h1>
      <p class="cover-subtitle">Documento confidencial para Recursos Humanos</p>
      <p class="cover-org">${esc(organizationName)}</p>
    </div>
  </div>
  <div class="cover-accent"></div>
  <div class="cover-meta">
    <div class="cover-meta-item"><label>Candidato</label><span>${esc(candidateName)}</span></div>
    <div class="cover-meta-item"><label>Puesto evaluado</label><span>${esc(puesto)}</span></div>
    ${showCurp ? `<div class="cover-meta-item"><label>CURP</label><span>${esc(curp)}</span></div>` : ''}
    <div class="cover-meta-item"><label>Fecha de cierre</label><span>${esc(completedAt)}</span></div>
    <div class="cover-meta-item"><label>Estatus</label><span class="cover-status">Completado</span></div>
    <div class="cover-meta-item cover-meta-item--wide">
      <label>${esc(moduleCountLabel)}</label>
      <span class="cover-meta-muted">${esc(modulesAppliedLine)}</span>
    </div>
  </div>
  <div class="cover-battery">
    <div class="cover-battery-hd">
      ${SVG_BATTERY}
      <h2 class="cover-battery-title">Resultados de la batería</h2>
    </div>
    ${buildSummaryCardsHtml(moduleCoverSummaries)}
  </div>
</section>`;
}

/**
 * Layout maestro: portada ejecutiva + fragmentos de módulo en página(s) siguientes.
 */
export function buildUnifiedReportHtml(ctx) {
  const { moduleFragmentsHtml, generatedDate } = ctx;
  const coverHtml = buildCoverPageHtml(ctx);
  const genDate = generatedDate || new Date().toISOString().slice(0, 10);

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<style>${MASTER_STYLES}</style>
</head>
<body>
<div class="page">
  ${coverHtml}
  <div class="details-page">
    ${moduleFragmentsHtml}
    <div class="footer">Documento generado automáticamente por Mind24 · Uso confidencial RH · ${esc(genDate)}</div>
  </div>
</div>
</body>
</html>`;
}

/** Expuesto para pruebas de regresión de portada. */
export { buildCoverPageHtml, buildSummaryCardsHtml };

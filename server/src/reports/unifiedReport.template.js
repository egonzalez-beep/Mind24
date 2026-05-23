import { esc } from './reportUtils.js';

const MASTER_STYLES = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Inter,Arial,sans-serif;color:#111827;font-size:11px;line-height:1.45;background:#fff}
  .page{padding:28px 32px 24px}
  .brand{border-bottom:3px solid #7C3AED;padding-bottom:14px;margin-bottom:18px}
  .brand h1{font-size:20px;font-weight:800;color:#4C1D95;letter-spacing:-.02em}
  .brand p{font-size:10px;color:#6B7280;margin-top:4px;text-transform:uppercase;letter-spacing:.12em}
  .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin-bottom:20px}
  .meta-item label{display:block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9CA3AF}
  .meta-item span{font-size:12px;font-weight:600;color:#111827}
  .meta-item .meta-line{display:block;line-height:1.5}
  .status{display:inline-block;padding:4px 10px;border-radius:999px;background:#D1FAE5;color:#065F46;font-size:10px;font-weight:700}
  .module-block{margin-top:28px;padding-top:22px;border-top:2px solid #E5E7EB;page-break-inside:avoid}
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
  .generic-body{padding:12px 14px;border:1px dashed #D1D5DB;border-radius:8px;background:#F9FAFB}
  .footer{margin-top:22px;padding-top:10px;border-top:1px solid #E5E7EB;font-size:8px;color:#9CA3AF;text-align:center}
`;

/**
 * Layout maestro: header ejecutivo + fragmentos apilados.
 */
export function buildUnifiedReportHtml(ctx) {
  const {
    organizationName,
    candidateName,
    puesto,
    curp,
    instrumentLabel,
    modulesAppliedLine,
    completedAt,
    moduleFragmentsHtml,
  } = ctx;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<style>${MASTER_STYLES}</style>
</head>
<body>
<div class="page">
  <div class="brand">
    <h1>Reporte consolidado de evaluación</h1>
    <p>Mind24 Assess · ${esc(organizationName)}</p>
  </div>
  <div class="meta-grid">
    <div class="meta-item"><label>Candidato</label><span>${esc(candidateName)}</span></div>
    <div class="meta-item"><label>Puesto evaluado</label><span>${esc(puesto)}</span></div>
    <div class="meta-item"><label>CURP</label><span>${esc(curp)}</span></div>
    <div class="meta-item"><label>Instrumento</label><span>${esc(instrumentLabel || 'Mind24')}</span></div>
    <div class="meta-item"><label>Módulos aplicados</label><span class="meta-line">${esc(modulesAppliedLine)}</span></div>
    <div class="meta-item"><label>Estatus</label><span class="status">Completado</span></div>
    <div class="meta-item"><label>Fecha de cierre</label><span>${esc(completedAt)}</span></div>
  </div>

  ${moduleFragmentsHtml}

  <div class="footer">Documento generado automáticamente por Mind24 · Uso confidencial RH · ${esc(new Date().toISOString().slice(0, 10))}</div>
</div>
</body>
</html>`;
}

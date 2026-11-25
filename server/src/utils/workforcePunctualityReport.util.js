/**
 * Presentación del reporte semanal. No recalcula puntualidad, cobertura ni estados.
 * Los días y el resumen de cada persona llegan del motor canónico.
 * La paginación imprimible la controla Chromium/Puppeteer con márgenes únicos;
 * no se estima un presupuesto fijo de filas.
 */
import { formatMinuteEsMx, formatWeekdaySelection } from './workforceWorkSchedule.util.js';
import { formatDurationEs, formatTimeEs } from './workforcePunctuality.util.js';

const DOW = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Márgenes del área imprimible (mm). Única fuente: coinciden con Puppeteer. */
export const PUNCTUALITY_PDF_MARGINS_MM = {
  top: 14,
  right: 12,
  bottom: 14,
  left: 12,
};

export function escapeReportHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function punctualityExportFilename(organizationName, weekStart) {
  const slug = String(organizationName || 'organizacion')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'organizacion';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(weekStart || '')) ? weekStart : 'semana';
  return `mind24-puntualidad-semanal-${slug}-${day}.pdf`;
}

export function punctualityExportContentDisposition(filename) {
  const ascii = String(filename || 'mind24-puntualidad-semanal.pdf')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '')
    .replace(/[\\/]/g, '-');
  if (!ascii || ascii.includes('..')) {
    return 'attachment; filename="mind24-puntualidad-semanal.pdf"';
  }
  return `attachment; filename="${ascii}"`;
}

export function formatPunctualityPdfDay(dateKey, weekday) {
  const parts = String(dateKey || '').split('-');
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const dow = DOW[weekday] || '';
  const mon = MONTHS[month - 1] || '';
  if (!dow || !day || !mon) return dow || '—';
  return `${dow} ${day} ${mon}`;
}

export function punctualityPdfDayCells(day, timeZone) {
  const entry = day.firstCheckInAt ? formatTimeEs(new Date(day.firstCheckInAt), timeZone) : null;
  let exit = null;
  if (day.status === 'IN_PROGRESS') exit = 'En curso';
  else if (day.lastCheckOutAt) exit = formatTimeEs(new Date(day.lastCheckOutAt), timeZone);
  const worked = day.firstCheckInAt ? formatDurationEs(day.workedSec) : null;
  const late = day.lateSec > 0 ? `${Math.max(1, Math.round(day.lateSec / 60))} min` : null;
  return {
    day: formatPunctualityPdfDay(day.dateKey, day.weekday),
    entry: entry || '—',
    exit: exit || '—',
    worked: worked || '—',
    late: late || '—',
    status: day.statusLabel || '—',
  };
}

function roundMean(values) {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizePunctualityReports(reports) {
  const punctuality = [];
  const coverage = [];
  let lateDays = 0;
  for (const report of reports) {
    const summary = report?.summary;
    if (!summary) continue;
    if (summary.punctualityPct != null) punctuality.push(summary.punctualityPct);
    if (summary.expectedCoveragePct != null) coverage.push(summary.expectedCoveragePct);
    lateDays += summary.lateDays || 0;
  }
  return {
    collaborators: reports.length,
    punctualityPct: roundMean(punctuality),
    expectedCoveragePct: roundMean(coverage),
    lateDays,
  };
}

/**
 * Conservado para pruebas/compat: el documento ya no parte el equipo en hojas fijas.
 * Devuelve un único bloque con todas las personas para que Chromium pagine.
 */
export function paginatePunctualityPeople(people) {
  const list = Array.isArray(people) ? people : [];
  return [list];
}

function pctLabel(value) {
  return value == null ? '—' : `${value}%`;
}

function personHtml(person) {
  const schedule = person.scheduleLabel || (person.schedule
    ? `${formatWeekdaySelection(person.schedule.weekdays)} · ${formatMinuteEsMx(person.schedule.startMinute)}–${formatMinuteEsMx(person.schedule.endMinute)}`
    : 'Sin horario aplicable en la semana');
  const zone = person.timeZone ? `<p class="zone">${escapeReportHtml(person.timeZone)}</p>` : '';
  const code = person.code ? ` <span class="code">· ${escapeReportHtml(person.code)}</span>` : '';
  const head = `<div class="person-head"><h2>${escapeReportHtml(person.fullName)}${code}</h2><p class="schedule">${escapeReportHtml(schedule)}</p>${zone}</div>`;
  if (!person.days?.length) {
    const note = person.emptyReason === 'NOT_IN_FORCE'
      ? 'El horario actual todavía no aplicaba en esta semana.'
      : 'Aún no hay días evaluables en esta semana.';
    return `<section class="person">${head}<p class="note">${escapeReportHtml(note)}</p></section>`;
  }
  const rows = person.days.map((day) => {
    const cells = day.cells || punctualityPdfDayCells(day, person.timeZone);
    const statusClass = /^[A-Z_]+$/.test(String(day.status || '')) ? ` class="status-${day.status}"` : '';
    return `<tr><td>${escapeReportHtml(cells.day)}</td><td>${timeCellHtml(cells.entry)}</td><td>${timeCellHtml(cells.exit)}</td><td>${escapeReportHtml(cells.worked)}</td><td>${escapeReportHtml(cells.late)}</td><td${statusClass}>${escapeReportHtml(cells.status)}</td></tr>`;
  }).join('');
  const note = person.emptyReason === 'NO_EVALUABLE'
    ? '<p class="note">Aún no hay días evaluables en esta semana.</p>'
    : '';
  return `<section class="person">${head}${note}<table><thead><tr><th scope="col">Día</th><th scope="col">Entrada real</th><th scope="col">Salida real</th><th scope="col">Tiempo trabajado</th><th scope="col">Retardo</th><th scope="col">Estado</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function timeCellHtml(value) {
  return Array.isArray(value)
    ? value.map((line) => `<div>${escapeReportHtml(line)}</div>`).join('')
    : escapeReportHtml(value);
}

function summaryHtml(summary) {
  const items = [
    ['Colaboradores', String(summary.collaborators)],
    ['Puntualidad promedio', pctLabel(summary.punctualityPct)],
    ['Cobertura promedio de jornada', pctLabel(summary.expectedCoveragePct)],
    ['Total de retardos', String(summary.lateDays)],
  ];
  return `<div class="summary">${items.map(([label, value]) => `<div><span>${escapeReportHtml(label)}</span><strong>${escapeReportHtml(value)}</strong></div>`).join('')}</div>`;
}

export function buildPunctualityPdfFooterTemplate() {
  return `<div style="width:100%;box-sizing:border-box;padding:0 ${PUNCTUALITY_PDF_MARGINS_MM.right}mm 0 ${PUNCTUALITY_PDF_MARGINS_MM.left}mm;font-family:Arial,sans-serif;font-size:8px;line-height:1.2;color:#64748b;text-align:right;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`;
}

export function weeklyPunctualityPdfOptions() {
  return {
    format: 'A4',
    landscape: true,
    waitUntil: 'load',
    displayHeaderFooter: true,
    footerTemplate: buildPunctualityPdfFooterTemplate(),
    margin: Object.fromEntries(Object.entries(PUNCTUALITY_PDF_MARGINS_MM).map(([edge, mm]) => [edge, `${mm}mm`])),
  };
}

export function buildWeeklyPunctualityReportDocument(model) {
  const mast = `<header class="mast"><p class="org">${escapeReportHtml(model.organizationName)}</p><h1>Reporte semanal de horarios y puntualidad</h1><p class="meta">${escapeReportHtml(model.weekLabel)} · Generado ${escapeReportHtml(model.generatedAtLabel)}</p></header>${summaryHtml(model.summary)}`;
  const summaryNote = model.summaryNote ? `<p class="note summary-note">${escapeReportHtml(model.summaryNote)}</p>` : '';
  const people = (model.people || []).map(personHtml).join('') ||
    `<p class="note">${escapeReportHtml(model.emptyLabel || 'No hay colaboradores para esta semana.')}</p>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Reporte semanal de horarios y puntualidad</title><style>
    @page{size:A4 landscape;}
    *{box-sizing:border-box;}
    html,body{margin:0;padding:0;background:#fff;color:#0f172a;font-family:"Segoe UI",Arial,sans-serif;font-size:11px;line-height:1.35;}
    .mast{border-bottom:2px solid #6d28d9;padding-bottom:8px;margin:0 0 10px;}
    .org{margin:0;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6d28d9;}
    h1{margin:2px 0 4px;font-size:18px;line-height:1.2;color:#4c1d95;break-after:avoid;page-break-after:avoid;}
    .meta,.schedule,.zone,.note{margin:0;color:#475569;}
    .summary{display:flex;gap:8px;margin:10px 0 4px;break-inside:avoid;page-break-inside:avoid;}
    .summary div{flex:1;border:1px solid #e9d5ff;background:#faf5ff;border-radius:8px;padding:6px 8px;min-width:0;}
    .summary span{display:block;font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6d28d9;}
    .summary strong{display:block;margin-top:2px;font-size:16px;color:#1e1b4b;}
    .person{margin-top:12px;break-inside:avoid;page-break-inside:avoid;}
    .person-head{break-after:avoid;page-break-after:avoid;break-inside:avoid;page-break-inside:avoid;}
    h2{margin:0;font-size:13px;color:#0f172a;overflow-wrap:anywhere;break-after:avoid;page-break-after:avoid;}
    .schedule{margin-top:2px;}
    .zone{font-size:10px;}
    .code{color:#475569;font-size:10px;font-weight:600;}
    .note{margin:4px 0;break-after:avoid;page-break-after:avoid;}
    table{width:100%;border-collapse:collapse;margin-top:4px;table-layout:fixed;}
    thead{display:table-header-group;}
    tbody{display:table-row-group;}
    tr{break-inside:avoid;page-break-inside:avoid;}
    th{background:#f5f3ff;color:#5b21b6;font-size:9px;font-weight:700;text-align:left;padding:5px 6px;border-bottom:1px solid #ddd6fe;}
    td{padding:4px 6px;border-bottom:1px solid #e2e8f0;vertical-align:top;overflow-wrap:anywhere;}
    th:nth-child(1),td:nth-child(1){width:12%;}
    th:nth-child(2),td:nth-child(2),th:nth-child(3),td:nth-child(3){width:20%;}
    th:nth-child(4),td:nth-child(4){width:15%;}
    th:nth-child(5),td:nth-child(5){width:9%;}
    th:nth-child(6),td:nth-child(6){width:24%;}
    td.status-IN_PROGRESS{color:#b45309;font-weight:600;}
    td.status-INCOMPLETE,td.status-NO_SHIFT{color:#64748b;}
    td.status-COMPLETED,td.status-ON_TIME{color:#166534;font-weight:600;}
    td.status-ABSENT,td.status-LATE{color:#9a3412;font-weight:600;}
  </style></head><body>${mast}${summaryNote}${people}</body></html>`;
}

export function formatReportGeneratedAt(now, timeZone) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: timeZone || 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(now);
}

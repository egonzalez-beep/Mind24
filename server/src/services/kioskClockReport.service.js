import { prisma } from '../db/client.js';
import { utcRangeForLocalDateInclusive } from './remoteWorkSessionHistory.service.js';
import { resolvePunctualityWeek } from '../utils/workforcePunctuality.util.js';
import { escapeReportHtml } from '../utils/workforcePunctualityReport.util.js';
import { renderHtmlToPdfBuffer } from './pdf.service.js';

const punchLabels = {
  CHECK_IN: 'Entrada',
  MEAL_OUT: 'Salida a comida',
  MEAL_IN: 'Regreso de comida',
  CHECK_OUT: 'Salida',
};

export async function prepareKioskWeekReport(organizationId, week, db = prisma, now = new Date()) {
  const anchor = new Date(`${week}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || week < '1900-01-01' ||
      !Number.isFinite(anchor.getTime()) || anchor.toISOString().slice(0, 10) !== week) {
    throw Object.assign(new Error('Selecciona una semana válida.'), { code: 'VALIDATION_ERROR' });
  }

  const clock = await db.kioskClock.findUnique({
    where: { organizationId },
    select: { id: true, timeZone: true, organization: { select: { name: true } } },
  });
  if (!clock) {
    throw Object.assign(new Error('Activa primero el reloj checador.'), { code: 'NOT_FOUND' });
  }
  const timeZone = clock.timeZone;
  const { weekStart, weekEnd, future } = resolvePunctualityWeek(week, timeZone, now);
  if (future) {
    throw Object.assign(new Error('No puedes descargar una semana futura.'), { code: 'VALIDATION_ERROR' });
  }
  const { start, end } = utcRangeForLocalDateInclusive(weekStart, weekEnd, timeZone);
  const punches = await db.kioskPunch.findMany({
    where: { employee: { clockId: clock.id }, recordedAt: { gte: start, lt: end } },
    orderBy: [{ recordedAt: 'asc' }, { ordinal: 'asc' }, { id: 'asc' }],
    select: { type: true, recordedAt: true, employee: { select: { code: true, fullName: true } } },
  });

  const date = new Intl.DateTimeFormat('es-MX', { timeZone, dateStyle: 'medium' });
  const civilDate = new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', dateStyle: 'medium' });
  const time = new Intl.DateTimeFormat('es-MX', {
    timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset',
  });
  const period = civilDate.formatRange(new Date(weekStart + 'T12:00:00Z'), new Date(weekEnd + 'T12:00:00Z'));
  const rows = punches.map(({ type, recordedAt, employee }) => {
    const cells = [date.format(recordedAt), time.format(recordedAt), employee.fullName, employee.code, punchLabels[type]];
    return '<tr>' + cells.map(value => '<td>' + escapeReportHtml(value) + '</td>').join('') + '</tr>';
  }).join('') || '<tr><td colspan="5">No hay checadas registradas en esta semana.</td></tr>';

  const html = `<!doctype html><html lang="es-MX"><head><meta charset="utf-8">
    <title>Registro semanal de checadas · Mind24</title>
    <style>
      body{margin:0;color:#29183f;font:12px Arial,sans-serif}
      header{padding:14px;border-radius:10px;background:#f4ecfc;break-inside:avoid}
      h1{margin:4px 0 8px;color:#4f207c;font-size:24px}
      p{margin:4px 0;overflow-wrap:anywhere}
      table{width:100%;margin-top:14px;border-collapse:collapse;text-align:left}
      thead{display:table-header-group}
      th,td{padding:7px 8px;border-bottom:1px solid #eadff3;vertical-align:top}
      th{color:#4f207c;background:#f4ecfc}
      td:nth-child(1),td:nth-child(2){white-space:nowrap}
      tr{break-inside:avoid}
      td:nth-child(3){max-width:70mm;overflow-wrap:anywhere}
    </style></head><body>
    <header><strong>Mind24 · Reloj checador</strong><h1>Registro semanal de checadas</h1>
    <p><strong>${escapeReportHtml(clock.organization.name)}</strong> · ${escapeReportHtml(period)}</p>
    <p>Zona horaria: ${escapeReportHtml(timeZone)} · Generado: ${escapeReportHtml(date.format(now) + ' ' + time.format(now))}</p>
    </header>
    <table aria-label="Checadas de la semana">
      <thead><tr><th scope="col">Fecha</th><th scope="col">Hora local</th><th scope="col">Colaborador</th><th scope="col">N.º de empleado</th><th scope="col">Movimiento</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></body></html>`;
  return { html, filename: `mind24-checadas-${weekStart}.pdf` };
}

export async function exportKioskWeekPdf(organizationId, week) {
  const { html, filename } = await prepareKioskWeekReport(organizationId, week);
  const buffer = await renderHtmlToPdfBuffer(html, {
    waitUntil: 'load',
    displayHeaderFooter: true,
    margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' },
    footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;color:#654f78"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  });
  return { buffer, filename };
}

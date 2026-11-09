import { prisma } from '../db/client.js';
import { utcRangeForLocalDateInclusive } from './remoteWorkSessionHistory.service.js';
import { buildWorkScheduleDto } from '../utils/workforceWorkSchedule.util.js';
import {
  assertPunctualityWeekKey,
  buildWeekPunctuality,
  formatPunctualityWeekLabel,
  resolvePunctualityWeek,
} from '../utils/workforcePunctuality.util.js';
import { rejectFuturePunctualityWeek } from './workforcePunctuality.service.js';
import { renderHtmlToPdfBuffer } from './pdf.service.js';
import {
  buildWeeklyPunctualityReportDocument,
  formatReportGeneratedAt,
  punctualityExportContentDisposition,
  punctualityExportFilename,
  summarizePunctualityReports,
} from '../utils/workforcePunctualityReport.util.js';

function validationError(message) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  return err;
}

const EMPLOYEE_SELECT = {
  id: true,
  fullName: true,
  timezone: true,
  isActive: true,
  organizationId: true,
  workScheduleStartMinute: true,
  workScheduleEndMinute: true,
  workScheduleToleranceMinutes: true,
  workScheduleWeekdayMask: true,
  workScheduleAssignedAt: true,
  organization: { select: { name: true } },
};

function sessionInRange(session, range) {
  const at = new Date(session.checkInAt).getTime();
  return at >= range.start.getTime() && at < range.end.getTime();
}

/**
 * Arma el reporte de la organización con el motor semanal ya existente.
 * No acepta zona, métricas ni lista de colaboradores desde el cliente.
 */
export async function assembleWeeklyPunctualityExport({
  organizationId,
  weekKey,
  now = new Date(),
  db = prisma,
}) {
  const requested = assertPunctualityWeekKey(weekKey);
  if (!requested) throw validationError('La semana debe indicarse como YYYY-MM-DD.');

  const rows = await db.workforceEmployee.findMany({
    where: {
      organizationId,
      isActive: true,
      workScheduleAssignedAt: { not: null },
      workScheduleWeekdayMask: { not: null },
      workScheduleStartMinute: { not: null },
      workScheduleEndMinute: { not: null },
      workScheduleToleranceMinutes: { not: null },
    },
    orderBy: { fullName: 'asc' },
    select: EMPLOYEE_SELECT,
  });

  const eligible = rows.filter((row) => buildWorkScheduleDto(row)?.assignedAt);
  if (!eligible.length) {
    throw validationError('No hay colaboradores activos con horario laboral para este reporte.');
  }

  const prepared = eligible.map((emp) => {
    const resolved = resolvePunctualityWeek(requested, emp.timezone, now);
    const range = utcRangeForLocalDateInclusive(resolved.weekStart, resolved.weekEnd, emp.timezone);
    return { emp, resolved, range };
  });
  if (prepared.every((item) => item.resolved.future)) {
    rejectFuturePunctualityWeek(prepared[0].resolved);
  }

  let minStart = prepared[0].range.start;
  let maxEnd = prepared[0].range.end;
  for (const item of prepared) {
    if (item.range.start < minStart) minStart = item.range.start;
    if (item.range.end > maxEnd) maxEnd = item.range.end;
  }
  const sessions = await db.remoteWorkSession.findMany({
    where: {
      employeeId: { in: prepared.map((item) => item.emp.id) },
      checkInAt: { gte: minStart, lt: maxEnd },
    },
    orderBy: { checkInAt: 'asc' },
    select: { id: true, employeeId: true, checkInAt: true, checkOutAt: true },
  });

  const people = prepared
    .map((item) => {
      const own = sessions.filter((session) => session.employeeId === item.emp.id && sessionInRange(session, item.range));
      const report = buildWeekPunctuality({
        schedule: buildWorkScheduleDto(item.emp),
        timeZone: item.emp.timezone,
        weekStart: item.resolved.weekStart,
        now,
        sessions: own.map(({ id, checkInAt, checkOutAt }) => ({ id, checkInAt, checkOutAt })),
      });
      return {
        fullName: item.emp.fullName,
        timeZone: item.emp.timezone,
        schedule: report.schedule,
        summary: report.summary,
        days: report.days,
        emptyReason: report.emptyReason,
        weekLabel: report.weekLabel,
        weekStart: report.weekStart,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));

  const zones = [...new Set(people.map((person) => person.timeZone).filter(Boolean))];
  const timeZone = zones.length === 1 ? zones[0] : 'UTC';
  const weekStart = people[0]?.weekStart || resolvePunctualityWeek(requested, timeZone, now).weekStart;
  const organizationName = eligible[0]?.organization?.name || 'Organización';
  const model = {
    organizationName,
    weekStart,
    weekLabel: zones.length === 1 ? formatPunctualityWeekLabel(weekStart, zones[0]) : people[0]?.weekLabel || weekStart,
    timeZoneLabel: zones.length === 1 ? zones[0] : 'Zona horaria de cada colaborador',
    generatedAtLabel: formatReportGeneratedAt(now, timeZone),
    summary: summarizePunctualityReports(people),
    people,
  };
  const filename = punctualityExportFilename(organizationName, weekStart);
  return {
    ...model,
    filename,
    contentDisposition: punctualityExportContentDisposition(filename),
    html: buildWeeklyPunctualityReportDocument(model),
  };
}

export async function exportWeeklyPunctualityPdf(input) {
  const report = await assembleWeeklyPunctualityExport(input);
  const buffer = await renderHtmlToPdfBuffer(report.html, {
    format: 'A4',
    landscape: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:8px;width:100%;text-align:right;padding-right:12mm;color:#64748b;font-family:Arial,sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    margin: { top: '12mm', right: '12mm', bottom: '16mm', left: '12mm' },
  });
  return {
    buffer,
    filename: report.filename,
    contentType: 'application/pdf',
    contentDisposition: report.contentDisposition,
  };
}

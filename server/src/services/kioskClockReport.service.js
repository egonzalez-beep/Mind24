import { prisma } from '../db/client.js';
import { addDaysToDateKey, localDateKey, localMidnightUtc } from './remoteWorkSessionHistory.service.js';
import {
  kioskAttendanceForDay, kioskAttendancePunchFields, kioskComparePunches, kioskMinuteLookup, kioskPunchOrder,
} from '../utils/kioskAttendance.util.js';
import { formatDurationEs, formatPunctualityWeekLabel, formatTimeEs, resolvePunctualityWeek } from '../utils/workforcePunctuality.util.js';
import { formatWeekdaySelection } from '../utils/workforceWorkSchedule.util.js';
import {
  buildWeeklyPunctualityReportDocument, formatPunctualityPdfDay, formatReportGeneratedAt,
  summarizePunctualityReports, weeklyPunctualityPdfOptions,
} from '../utils/workforcePunctualityReport.util.js';
import { renderHtmlToPdfBuffer } from './pdf.service.js';

const statusLabels = {
  ON_TIME: 'A tiempo',
  LATE: 'Retardo',
  ABSENT: 'Falta',
  INCOMPLETE: 'Checada incompleta',
  COMPLETED: 'Jornada cumplida',
  LATE_EXIT: 'Salida posterior al horario',
  UNSCHEDULED: 'Sin horario para este día',
  REST: 'Descanso',
  BEFORE_ENROLLMENT: 'Alta posterior al inicio',
  UNAVAILABLE: 'Horario por revisar',
};
const justifiedLabels = {
  ABSENT: 'Falta justificada',
  LATE: 'Retardo justificado',
  INCOMPLETE: 'Checada incompleta justificada',
  LATE_EXIT: 'Salida posterior justificada',
};

function measuredTime(punches, attendance) {
  let sessionStart = null;
  let workStart = null;
  let workedMs = null;
  let coveredMs = 0;
  const addCoverage = (until) => {
    if (sessionStart == null || attendance.kind !== 'PLANNED') return;
    coveredMs += Math.max(0, Math.min(+until, +attendance.endAt) - Math.max(+sessionStart, +attendance.startAt));
  };
  for (const { type, recordedAt } of punches) {
    if (type === 'CHECK_IN') sessionStart = recordedAt;
    if (type === 'CHECK_IN' || type === 'MEAL_IN') {
      workStart = recordedAt;
    } else if (workStart != null) {
      workedMs = (workedMs ?? 0) + (+recordedAt - +workStart);
      workStart = null;
    }
    if (type === 'CHECK_OUT') {
      addCoverage(recordedAt);
      sessionStart = null;
    }
  }
  if (sessionStart != null) addCoverage(punches.at(-1).recordedAt);
  return { workedMs, coveredMs };
}

function dayStatus(attendance, owned, now, justified) {
  const last = owned.at(-1);
  if (attendance.kind !== 'PLANNED') {
    const progress = last
      ? last.type === 'CHECK_OUT' ? ' · Salida registrada' : ' · Sin salida registrada'
      : '';
    return { status: attendance.kind, label: statusLabels[attendance.kind] + progress };
  }
  const flags = attendance.flags.filter((flag) => flag !== 'ON_TIME' || !attendance.flags.includes('COMPLETED'));
  const status = flags.includes('INCOMPLETE') ? 'INCOMPLETE' : flags[0] || 'PENDING';
  const labels = flags.map((flag) => justified.has(flag) ? justifiedLabels[flag] : statusLabels[flag]);
  if (!last && !flags.length) labels.push('Pendiente');
  if (last && last.type !== 'CHECK_OUT' && now < attendance.endAt) labels.push('En curso');
  if (last?.type === 'CHECK_OUT' && !flags.includes('COMPLETED') && !flags.includes('LATE_EXIT')) labels.push('Salida registrada');
  return { status, label: labels.join(' · ') };
}

function buildReportDay(window, attendance, otherPunches, justified, context) {
  const { timeZone, punchTime, now } = context;
  const { dateKey, end } = window;
  const owned = attendance.punches;
  const last = owned.at(-1);
  const { workedMs, coveredMs } = measuredTime(owned, attendance);
  const { status, label } = dayStatus(attendance, owned, now, justified);
  const entry = [];
  const exit = [];
  const meal = [];
  const punches = [...owned, ...otherPunches].sort(kioskComparePunches);
  for (const { type, recordedAt, originalRecordedAt, isManual } of punches) {
    const annotation = (isManual ? ' (manual)' : '') + (originalRecordedAt ? ' (corregida)' : '');
    const time = punchTime.format(recordedAt) + (recordedAt >= end ? ' (+1 día)' : '') + annotation;
    switch (type) {
      case 'CHECK_IN': entry.push(time); break;
      case 'MEAL_IN': meal.push('Regreso ' + time); break;
      case 'MEAL_OUT': meal.push('Salida ' + time); break;
      case 'CHECK_OUT': exit.push(time); break;
    }
  }
  const isOpen = last && last.type !== 'CHECK_OUT';
  const weekday = new Date(dateKey).getUTCDay() || 7;
  const planned = attendance.kind === 'PLANNED';
  const coverage = planned && (attendance.flags.includes('ABSENT') ||
    (last && (!isOpen || now >= attendance.endAt)))
    ? Math.min(1, coveredMs / (+attendance.endAt - +attendance.startAt))
    : null;
  const expected = planned
    ? formatTimeEs(attendance.startAt, timeZone) + '–' + formatTimeEs(attendance.endAt, timeZone) +
      (attendance.endAt >= end ? ' (+1 día)' : '')
    : null;
  return {
    dateKey, weekday, status, expected, coverage,
    onTime: attendance.flags.includes('ON_TIME'),
    late: attendance.flags.includes('LATE'),
    absent: attendance.flags.includes('ABSENT'),
    cells: {
      day: formatPunctualityPdfDay(dateKey, weekday),
      entry: entry.length ? entry : '—',
      exit: exit.length ? exit : '—',
      worked: workedMs == null ? '—' : formatDurationEs(workedMs / 1000) + (isOpen ? ' (parcial)' : ''),
      late: attendance.lateMinutes === undefined ? '—' : attendance.lateMinutes === 0 ? '<1 min' : `${attendance.lateMinutes} min`,
      status: label + (otherPunches.length ? ' · Checada sin entrada identificada' : '') +
        (justified.size && !attendance.flags.some((flag) => justified.has(flag)) ? ' · Justificación en historial' : ''),
      meal,
    },
  };
}

function reportPerson(employee, windows, context) {
  const records = windows.map((window) => {
    const punches = employee.punches.filter((punch) => punch.recordedAt >= window.start && punch.recordedAt < window.followingEnd);
    return kioskAttendanceForDay({ ...employee, punches }, {
      date: window.dateKey, nextStart: window.end, now: context.now, atMinute: context.atMinute,
    });
  });
  const claimed = new Set(records.flatMap((attendance) => attendance.punches.map(({ ordinal }) => ordinal)));
  const justifications = new Map();
  for (const adjustment of employee.attendanceAdjustments ?? []) {
    const date = adjustment.date.toISOString().slice(0, 10);
    if (!justifications.has(date)) justifications.set(date, new Set());
    justifications.get(date).add(adjustment.incident);
  }
  const days = windows.slice(1).flatMap((window, i) => {
    const attendance = records[i + 1];
    const otherPunches = employee.punches.filter((punch) =>
      !claimed.has(punch.ordinal) && punch.recordedAt >= window.start && punch.recordedAt < window.end);
    const justified = justifications.get(window.dateKey) ?? new Set();
    if (!attendance.punches.length && !otherPunches.length && !justified.size &&
      (!employee.isActive || employee.createdAt >= window.end)) return [];
    return [buildReportDay(window, attendance, otherPunches, justified, context)];
  });
  if (!days.length) return null;
  const hours = new Map();
  for (const day of days) {
    if (!day.expected) continue;
    if (!hours.has(day.expected)) hours.set(day.expected, []);
    hours.get(day.expected).push(day.weekday);
  }
  const evaluated = days.filter((day) => day.onTime || day.late || day.absent);
  const coverage = days.filter((day) => day.coverage != null);
  return {
    fullName: employee.fullName,
    code: employee.code,
    timeZone: context.timeZone,
    scheduleLabel: [...hours].map(([time, weekdays]) => `${formatWeekdaySelection(weekdays)} · ${time}`).join(' | '),
    days,
    summary: {
      punctualityPct: evaluated.length ? Math.round(100 * evaluated.filter((day) => day.onTime).length / evaluated.length) : null,
      expectedCoveragePct: coverage.length ? Math.round(100 * coverage.reduce((sum, day) => sum + day.coverage, 0) / coverage.length) : null,
      lateDays: days.filter((day) => day.late).length,
    },
  };
}

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
  const { timeZone } = clock;
  const { weekStart, weekEnd, future } = resolvePunctualityWeek(week, timeZone, now);
  if (future) {
    throw Object.assign(new Error('No puedes descargar una semana futura.'), { code: 'VALIDATION_ERROR' });
  }
  const today = localDateKey(now, timeZone);
  const lastDay = today < weekEnd ? today : weekEnd;
  const boundaries = Array.from({ length: 10 }, (_, index) => {
    const dateKey = addDaysToDateKey(weekStart, index - 1);
    return { dateKey, start: localMidnightUtc(dateKey, timeZone) };
  });
  const windows = boundaries.slice(0, -2).filter(({ dateKey }) => dateKey <= lastDay)
    .map((day, i) => ({ ...day, end: boundaries[i + 1].start, followingEnd: boundaries[i + 2].start }));
  const { dateKey: lastDate, end, followingEnd } = windows.at(-1);
  const employees = await db.kioskEmployee.findMany({
    where: { clockId: clock.id, createdAt: { lt: end, lte: now } },
    orderBy: [{ fullName: 'asc' }, { code: 'asc' }],
    select: {
      fullName: true, code: true, isActive: true, createdAt: true,
      schedules: { where: { effectiveOn: { lte: new Date(addDaysToDateKey(lastDate, 1)) } }, orderBy: { effectiveOn: 'desc' } },
      punches: {
        where: { recordedAt: { gte: windows[0].start, lt: followingEnd, lte: now } },
        orderBy: kioskPunchOrder,
        select: kioskAttendancePunchFields,
      },
      attendanceAdjustments: {
        where: { action: 'JUSTIFY', date: { gte: new Date(weekStart), lte: new Date(lastDate) }, createdAt: { lte: now } },
        select: { date: true, incident: true },
      },
    },
  });
  const punchTime = new Intl.DateTimeFormat('es-MX', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const context = { timeZone, punchTime, now, atMinute: kioskMinuteLookup(timeZone) };
  const people = employees.map((employee) => reportPerson(employee, windows, context)).filter(Boolean);
  const model = {
    organizationName: clock.organization.name,
    weekLabel: formatPunctualityWeekLabel(weekStart, timeZone),
    generatedAtLabel: formatReportGeneratedAt(now, timeZone),
    summary: summarizePunctualityReports(people),
    summaryNote: 'La cobertura mide cuánto del horario previsto respaldan las checadas. El tiempo trabajado descuenta la comida registrada. Los indicadores reflejan las checadas, incluidas las incidencias justificadas.',
    showMealColumn: people.some(({ days }) => days.some(({ cells }) => cells.meal.length > 0)),
    people,
  };
  return { ...model, html: buildWeeklyPunctualityReportDocument(model), filename: `mind24-checadas-${weekStart}.pdf` };
}

export async function exportKioskWeekPdf(organizationId, week) {
  const { html, filename } = await prepareKioskWeekReport(organizationId, week);
  const buffer = await renderHtmlToPdfBuffer(html, weeklyPunctualityPdfOptions());
  return { buffer, filename };
}

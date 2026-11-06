/**
 * Puntualidad semanal. No persiste métricas.
 * La duración trabajada es la de la jornada (check-in a check-out), nunca el tiempo con señal.
 * Varias sesiones del mismo día local se agrupan por la fecha local de checkInAt.
 * Los intervalos superpuestos se fusionan para no contar dos veces el mismo tiempo.
 * Esta versión no reconstruye horarios anteriores a workScheduleAssignedAt.
 */
import { utcInstantFromLocalParts } from './timezoneLocalInstant.util.js';
import {
  addDaysToDateKey,
  localDateKey,
  weekRangeMonday,
} from '../services/remoteWorkSessionHistory.service.js';
import { workedDurationSec } from '../services/remoteWorkSession.service.js';

export const PUNCTUALITY_EXTRA_THRESHOLD_MS = 30 * 60 * 1000;

const WEEKDAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const STATUS_LABEL = {
  COMPLETE: 'Completa',
  LATE: 'Retardo',
  INCOMPLETE: 'Jornada incompleta',
  EXTRA: 'Tiempo adicional',
  IN_PROGRESS: 'En curso',
  PENDING: 'Pendiente',
  AWAITING: 'Sin entrada',
  NO_SHIFT: 'Sin jornada',
  NOT_EVALUABLE: 'No evaluable',
};

function weekdayNumber(dateKey, timeZone) {
  const instant = utcInstantFromLocalParts(dateKey, 12, 0, timeZone);
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
  return WEEKDAY_INDEX[short] || null;
}

function formatTimeEs(instant, timeZone) {
  if (!instant) return null;
  return new Intl.DateTimeFormat('es-MX', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(instant);
}

function formatDurationEs(sec) {
  const totalMin = Math.floor(Math.max(0, Number(sec) || 0) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${totalMin} min`;
}

function formatMonthEs(instant, timeZone) {
  const raw = new Intl.DateTimeFormat('es-MX', { timeZone, month: 'short' }).format(instant);
  return raw.replace(/\./g, '').trim();
}

function dayNumber(instant, timeZone) {
  return new Intl.DateTimeFormat('es-MX', { timeZone, day: 'numeric' }).format(instant);
}

function yearNumber(instant, timeZone) {
  return new Intl.DateTimeFormat('es-MX', { timeZone, year: 'numeric' }).format(instant);
}

export function formatPunctualityWeekLabel(weekStart, timeZone) {
  const weekEnd = addDaysToDateKey(weekStart, 6);
  const start = utcInstantFromLocalParts(weekStart, 12, 0, timeZone);
  const end = utcInstantFromLocalParts(weekEnd, 12, 0, timeZone);
  const d1 = dayNumber(start, timeZone);
  const d2 = dayNumber(end, timeZone);
  const m1 = formatMonthEs(start, timeZone);
  const m2 = formatMonthEs(end, timeZone);
  const y1 = yearNumber(start, timeZone);
  const y2 = yearNumber(end, timeZone);
  if (y1 !== y2) return `${d1} ${m1} ${y1}–${d2} ${m2} ${y2}`;
  if (m1 !== m2) return `${d1} ${m1}–${d2} ${m2} ${y1}`;
  return `${d1}–${d2} ${m1} ${y1}`;
}

function mergedWorkedSec(sessions, now) {
  const intervals = [];
  for (const session of sessions) {
    if (!session?.checkInAt) continue;
    const start = new Date(session.checkInAt).getTime();
    const end = session.checkOutAt ? new Date(session.checkOutAt).getTime() : now.getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) intervals.push([start, end]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = null;
  let curEnd = null;
  for (const [start, end] of intervals) {
    if (curStart == null) {
      curStart = start;
      curEnd = end;
      continue;
    }
    if (start <= curEnd) curEnd = Math.max(curEnd, end);
    else {
      total += Math.floor((curEnd - curStart) / 1000);
      curStart = start;
      curEnd = end;
    }
  }
  if (curStart != null) total += Math.floor((curEnd - curStart) / 1000);
  return total;
}

function groupByLocalDay(sessions, timeZone) {
  const map = new Map();
  for (const session of sessions) {
    if (!session?.checkInAt) continue;
    const key = localDateKey(session.checkInAt, timeZone);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(session);
  }
  for (const list of map.values()) {
    list.sort((a, b) => new Date(a.checkInAt) - new Date(b.checkInAt));
  }
  return map;
}

function minuteParts(minute) {
  return { hour: Math.floor(minute / 60), minute: minute % 60 };
}

function buildDetails({
  schedule,
  timeZone,
  expectedStart,
  toleranceEnd,
  expectedEnd,
  firstCheckIn,
  lastCheckOut,
  workedSec,
  expectedSec,
  lateSec,
  extraSec,
  flags,
}) {
  const details = [];
  details.push(`Entrada esperada ${formatTimeEs(expectedStart, timeZone)}`);
  details.push(`Fin de tolerancia ${formatTimeEs(toleranceEnd, timeZone)}`);
  details.push(`Salida esperada ${formatTimeEs(expectedEnd, timeZone)}`);
  if (firstCheckIn) {
    const lateBit = lateSec > 0 ? ` · Retardo ${Math.max(1, Math.round(lateSec / 60))} min` : '';
    details.push(`Entrada ${formatTimeEs(firstCheckIn, timeZone)}${lateBit}`);
  }
  if (lastCheckOut) details.push(`Salida ${formatTimeEs(lastCheckOut, timeZone)}`);
  if (workedSec != null) {
    details.push(`Jornada ${formatDurationEs(workedSec)} de ${formatDurationEs(expectedSec)} esperadas`);
  }
  if (extraSec > 0) details.push(`Tiempo adicional ${Math.max(1, Math.round(extraSec / 60))} min`);
  if (flags.includes('NO_SHIFT')) details.push('Sin jornada registrada');
  if (flags.includes('INCOMPLETE') && flags.includes('LATE')) details.push('Fuera de tolerancia · jornada incompleta');
  else if (flags.includes('INCOMPLETE')) details.push('Jornada incompleta');
  else if (flags.includes('LATE')) details.push('Fuera de tolerancia');
  return details;
}

function cardCopy(status, lateSec, firstCheckIn, lastCheckOut, workedSec, timeZone) {
  if (status === 'COMPLETE') {
    return {
      headline: 'Completa',
      lines: [firstCheckIn ? `Entrada ${formatTimeEs(firstCheckIn, timeZone)}` : '', formatDurationEs(workedSec)].filter(Boolean),
    };
  }
  if (status === 'LATE') {
    return {
      headline: `Retardo · ${Math.max(1, Math.round(lateSec / 60))} min`,
      lines: [firstCheckIn ? `Entrada ${formatTimeEs(firstCheckIn, timeZone)}` : '', formatDurationEs(workedSec)].filter(Boolean),
    };
  }
  if (status === 'INCOMPLETE') {
    return {
      headline: 'Jornada incompleta',
      lines: [firstCheckIn ? `Entrada ${formatTimeEs(firstCheckIn, timeZone)}` : '', formatDurationEs(workedSec)].filter(Boolean),
    };
  }
  if (status === 'EXTRA') {
    return {
      headline: 'Tiempo adicional',
      lines: [lastCheckOut ? `Salida ${formatTimeEs(lastCheckOut, timeZone)}` : '', formatDurationEs(workedSec)].filter(Boolean),
    };
  }
  if (status === 'IN_PROGRESS') {
    return {
      headline: 'En curso',
      lines: [firstCheckIn ? `Entrada ${formatTimeEs(firstCheckIn, timeZone)}` : '', formatDurationEs(workedSec)].filter(Boolean),
    };
  }
  if (status === 'NO_SHIFT') return { headline: 'Sin jornada', lines: [] };
  if (status === 'PENDING') return { headline: 'Pendiente', lines: [] };
  if (status === 'AWAITING') return { headline: 'Sin entrada', lines: [] };
  return { headline: STATUS_LABEL[status] || '', lines: [] };
}

function classifyDay({ dateKey, weekday, schedule, timeZone, now, sessions }) {
  const startParts = minuteParts(schedule.startMinute);
  const endParts = minuteParts(schedule.endMinute);
  const expectedStart = utcInstantFromLocalParts(dateKey, startParts.hour, startParts.minute, timeZone);
  const expectedEnd = utcInstantFromLocalParts(dateKey, endParts.hour, endParts.minute, timeZone);
  const toleranceEnd = new Date(expectedStart.getTime() + schedule.toleranceMinutes * 60 * 1000);
  const extraThreshold = new Date(expectedEnd.getTime() + PUNCTUALITY_EXTRA_THRESHOLD_MS);
  const expectedSec = (schedule.endMinute - schedule.startMinute) * 60;
  const assignedAt = schedule.assignedAt ? new Date(schedule.assignedAt) : null;
  const inForce = assignedAt && !Number.isNaN(assignedAt.getTime()) && expectedStart.getTime() >= assignedAt.getTime();
  const todayKey = localDateKey(now, timeZone);
  const base = {
    dateKey,
    weekday,
    expectedStartAt: expectedStart.toISOString(),
    toleranceEndAt: toleranceEnd.toISOString(),
    expectedEndAt: expectedEnd.toISOString(),
    firstCheckInAt: null,
    lastCheckOutAt: null,
    workedSec: 0,
    expectedSec,
    lateSec: 0,
    extraSec: 0,
    coveragePct: null,
    isEvaluable: false,
    onTime: false,
  };
  if (!inForce || dateKey > todayKey) {
    const copy = cardCopy('NOT_EVALUABLE', 0, null, null, 0, timeZone);
    return {
      ...base,
      omit: !inForce,
      status: 'NOT_EVALUABLE',
      statusLabel: STATUS_LABEL.NOT_EVALUABLE,
      flags: ['NOT_EVALUABLE'],
      headline: dateKey > todayKey && inForce ? 'Aún no inicia' : copy.headline,
      lines: [],
      details: inForce ? [`Horario previsto ${formatTimeEs(expectedStart, timeZone)}–${formatTimeEs(expectedEnd, timeZone)}`] : [],
    };
  }

  const open = sessions.some((session) => session.checkInAt && !session.checkOutAt);
  const first = sessions[0] || null;
  const firstCheckIn = first ? new Date(first.checkInAt) : null;
  const closedOuts = sessions.filter((session) => session.checkOutAt).map((session) => new Date(session.checkOutAt));
  const lastCheckOut = closedOuts.length ? new Date(Math.max(...closedOuts.map((d) => d.getTime()))) : null;
  const workedSec = sessions.length ? mergedWorkedSec(sessions, now) : 0;
  const singleWorked = sessions.length === 1 ? workedDurationSec(sessions[0], now) : null;
  const late = !!(firstCheckIn && firstCheckIn.getTime() > toleranceEnd.getTime());
  const lateSec = late ? Math.floor((firstCheckIn.getTime() - toleranceEnd.getTime()) / 1000) : 0;
  const closed = sessions.length > 0 && !open;
  const incomplete = closed && workedSec < expectedSec;
  const extra = !!(closed && lastCheckOut && lastCheckOut.getTime() >= extraThreshold.getTime());
  const extraSec = extra ? Math.floor((lastCheckOut.getTime() - expectedEnd.getTime()) / 1000) : 0;
  const onTime = !!(firstCheckIn && firstCheckIn.getTime() <= toleranceEnd.getTime());
  const flags = [];
  let status = 'AWAITING';
  if (!sessions.length && now < expectedStart) status = 'PENDING';
  else if (!sessions.length && now < expectedEnd) status = 'AWAITING';
  else if (!sessions.length) status = 'NO_SHIFT';
  else if (open) status = 'IN_PROGRESS';
  else if (late) status = 'LATE';
  else if (incomplete) status = 'INCOMPLETE';
  else if (extra) status = 'EXTRA';
  else status = 'COMPLETE';

  if (status === 'PENDING') flags.push('PENDING');
  if (status === 'AWAITING') flags.push('AWAITING');
  if (status === 'NO_SHIFT') flags.push('NO_SHIFT');
  if (open) flags.push('IN_PROGRESS');
  if (late) flags.push('LATE');
  if (incomplete) flags.push('INCOMPLETE');
  if (extra) flags.push('EXTRA');
  if (status === 'COMPLETE') flags.push('COMPLETE');

  const scheduleEnded = now.getTime() >= expectedEnd.getTime();
  const isEvaluable = status === 'NO_SHIFT' || ((closed || (open && scheduleEnded)) && status !== 'PENDING' && status !== 'AWAITING');
  const ratio = expectedSec > 0 ? Math.min(workedSec / expectedSec, 1) : 0;
  const copy = cardCopy(status, lateSec, firstCheckIn, lastCheckOut, workedSec, timeZone);
  const details = buildDetails({
    schedule,
    timeZone,
    expectedStart,
    toleranceEnd,
    expectedEnd,
    firstCheckIn,
    lastCheckOut: open ? null : lastCheckOut,
    workedSec: sessions.length ? workedSec : null,
    expectedSec,
    lateSec,
    extraSec,
    flags,
  });
  return {
    ...base,
    omit: false,
    status,
    statusLabel: STATUS_LABEL[status] || status,
    flags,
    firstCheckInAt: firstCheckIn ? firstCheckIn.toISOString() : null,
    lastCheckOutAt: open || !lastCheckOut ? null : lastCheckOut.toISOString(),
    workedSec,
    lateSec,
    extraSec,
    coveragePct: isEvaluable ? Math.round(ratio * 100) : null,
    isEvaluable,
    onTime,
    headline: copy.headline,
    lines: copy.lines,
    details,
    singleSessionSec: singleWorked,
  };
}

export function buildWeekPunctuality({ schedule, timeZone, weekStart, now = new Date(), sessions = [] }) {
  const weekEnd = addDaysToDateKey(weekStart, 6);
  const weekLabel = formatPunctualityWeekLabel(weekStart, timeZone);
  const todayKey = localDateKey(now, timeZone);
  const currentWeek = weekRangeMonday(todayKey, timeZone);
  const shell = {
    weekStart,
    weekEnd,
    weekLabel,
    timezone: timeZone,
    canGoNext: weekStart < currentWeek.weekStart,
    schedule: schedule
      ? {
          weekdays: schedule.weekdays,
          restDays: schedule.restDays,
          startMinute: schedule.startMinute,
          endMinute: schedule.endMinute,
          toleranceMinutes: schedule.toleranceMinutes,
          assignedAt: schedule.assignedAt,
        }
      : null,
    summary: null,
    days: [],
    emptyReason: null,
  };
  if (!schedule) {
    shell.emptyReason = 'NO_SCHEDULE';
    return shell;
  }
  const byDay = groupByLocalDay(sessions, timeZone);
  const selected = new Set(schedule.weekdays || []);
  const days = [];
  let cursor = weekStart;
  for (let i = 0; i < 7; i += 1) {
    const weekday = weekdayNumber(cursor, timeZone);
    if (selected.has(weekday)) {
      const daySessions = byDay.get(cursor) || [];
      const classified = classifyDay({
        dateKey: cursor,
        weekday,
        schedule,
        timeZone,
        now,
        sessions: daySessions,
      });
      if (!classified.omit) {
        const { omit, onTime, singleSessionSec, ...publicDay } = classified;
        publicDay.onTime = onTime;
        days.push(publicDay);
      }
    }
    cursor = addDaysToDateKey(cursor, 1);
  }
  if (!days.length) {
    shell.emptyReason = 'NOT_IN_FORCE';
    return shell;
  }
  const evaluable = days.filter((day) => day.isEvaluable);
  if (!evaluable.length) shell.emptyReason = 'NO_EVALUABLE';
  const onTimeCount = evaluable.filter((day) => day.onTime).length;
  const coverageAvg = evaluable.length
    ? evaluable.reduce((sum, day) => sum + Math.min((day.workedSec || 0) / day.expectedSec, 1), 0) / evaluable.length
    : null;
  shell.summary = {
    punctualityPct: evaluable.length ? Math.round((onTimeCount / evaluable.length) * 100) : null,
    expectedCoveragePct: coverageAvg == null ? null : Math.round(coverageAvg * 100),
    lateDays: evaluable.filter((day) => day.flags.includes('LATE')).length,
    extraTimeDays: evaluable.filter((day) => day.flags.includes('EXTRA')).length,
    evaluableDays: evaluable.length,
  };
  shell.days = days.map(({ onTime, ...day }) => day);
  return shell;
}

export function resolvePunctualityWeek(weekKey, timeZone, now = new Date()) {
  const anchor = weekKey || localDateKey(now, timeZone);
  const range = weekRangeMonday(anchor, timeZone);
  const current = weekRangeMonday(localDateKey(now, timeZone), timeZone);
  return {
    weekStart: range.weekStart,
    weekEnd: range.weekEnd,
    future: range.weekStart > current.weekStart,
  };
}

export function assertPunctualityWeekKey(weekKey) {
  if (weekKey == null || weekKey === '') return null;
  if (typeof weekKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) {
    const err = new Error('La semana debe indicarse como YYYY-MM-DD.');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  return weekKey;
}

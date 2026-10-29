import {
  calendarYmdInTimeZone,
  endOfCalendarDayInTimeZone,
  startOfCalendarDayInTimeZone,
} from './workforceDueDate.js';
import { isValidIanaTimezone } from './ianaTimezone.js';

/** Máximo de periodos a materializar por meta en una sola sincronización (backfill acotado). */
export const MAX_GOAL_PERIOD_BACKFILL = 400;

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function dayOfWeekMondayZero(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 6 : js - 1;
}

export function weekStartYmd(ymd) {
  const mondayOffset = dayOfWeekMondayZero(ymd);
  return addDaysYmd(ymd, -mondayOffset);
}

export function monthStartYmd(ymd) {
  const [y, m] = ymd.split('-');
  return `${y}-${m}-01`;
}

export function monthEndYmd(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

export function periodAnchorYmd(periodicity, ymd) {
  if (periodicity === 'DAILY') return ymd;
  if (periodicity === 'WEEKLY') return weekStartYmd(ymd);
  if (periodicity === 'MONTHLY') return monthStartYmd(ymd);
  return ymd;
}

export function nextPeriodAnchorYmd(periodicity, anchorYmd) {
  if (periodicity === 'DAILY') return addDaysYmd(anchorYmd, 1);
  if (periodicity === 'WEEKLY') return addDaysYmd(anchorYmd, 7);
  if (periodicity === 'MONTHLY') {
    const [y, m] = anchorYmd.split('-').map(Number);
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    return `${ny}-${String(nm).padStart(2, '0')}-01`;
  }
  return addDaysYmd(anchorYmd, 1);
}

export function previousPeriodAnchorYmd(periodicity, anchorYmd) {
  if (periodicity === 'DAILY') return addDaysYmd(anchorYmd, -1);
  if (periodicity === 'WEEKLY') return addDaysYmd(anchorYmd, -7);
  if (periodicity === 'MONTHLY') {
    const [y, m] = anchorYmd.split('-').map(Number);
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    return `${py}-${String(pm).padStart(2, '0')}-01`;
  }
  return addDaysYmd(anchorYmd, -1);
}

/** Ancla más antigua permitida al crear una meta (backfill acotado por solicitud). */
export function earliestAllowedStartAnchorYmd(periodicity, now, timeZone) {
  let cursor = currentAnchorYmdForGoal(periodicity, now, timeZone);
  for (let i = 0; i < MAX_GOAL_PERIOD_BACKFILL - 1; i += 1) {
    cursor = previousPeriodAnchorYmd(periodicity, cursor);
  }
  return cursor;
}

export function periodBoundsFromAnchor(anchorYmd, periodicity, timeZone) {
  if (!isValidIanaTimezone(timeZone)) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Zona horaria del colaborador inválida.';
    throw err;
  }
  let startYmd = anchorYmd;
  let endYmd = anchorYmd;
  if (periodicity === 'WEEKLY') {
    startYmd = weekStartYmd(anchorYmd);
    endYmd = addDaysYmd(startYmd, 6);
  } else if (periodicity === 'MONTHLY') {
    startYmd = monthStartYmd(anchorYmd);
    endYmd = monthEndYmd(anchorYmd);
  }
  const periodStart = startOfCalendarDayInTimeZone(startYmd, timeZone);
  const periodEnd = endOfCalendarDayInTimeZone(endYmd, timeZone);
  if (!periodStart || !periodEnd) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Periodo de meta inválido.';
    throw err;
  }
  return { periodStart, periodEnd, startYmd, endYmd };
}

export function ymdFromDateField(dateValue) {
  if (!dateValue) return null;
  if (dateValue instanceof Date) {
    const y = dateValue.getUTCFullYear();
    const m = String(dateValue.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateValue.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(dateValue).slice(0, 10);
}

export function currentAnchorYmdForGoal(periodicity, now, timeZone) {
  const today = calendarYmdInTimeZone(now, timeZone);
  return periodAnchorYmd(periodicity, today);
}

/** Cuenta anclas inclusive entre startYmd y endLimitYmd (periodos reales, no días). */
export function countPeriodAnchorsInclusive(startYmd, endLimitYmd, periodicity) {
  let cursor = periodAnchorYmd(periodicity, startYmd);
  const limit = periodAnchorYmd(periodicity, endLimitYmd);
  if (cursor > limit) return 0;
  let count = 0;
  while (cursor <= limit) {
    count += 1;
    cursor = nextPeriodAnchorYmd(periodicity, cursor);
  }
  return count;
}

/** Anclas de periodo desde startYmd hasta endLimitYmd (inclusive), sin futuros. Sin tope interno: validar antes con count. */
export function listPeriodAnchorsBetween(startYmd, endLimitYmd, periodicity) {
  const anchors = [];
  let cursor = periodAnchorYmd(periodicity, startYmd);
  const limit = periodAnchorYmd(periodicity, endLimitYmd);
  while (cursor <= limit) {
    anchors.push(cursor);
    cursor = nextPeriodAnchorYmd(periodicity, cursor);
  }
  return anchors;
}

/** @deprecated Usar listPeriodAnchorsBetween tras validar count ≤ MAX_GOAL_PERIOD_BACKFILL */
export function listPeriodAnchorsUpTo(startYmd, endLimitYmd, periodicity) {
  return listPeriodAnchorsBetween(startYmd, endLimitYmd, periodicity).slice(0, MAX_GOAL_PERIOD_BACKFILL);
}

export function anchorYmdFromPeriodStart(periodStart, periodicity, timeZone) {
  const ymd = calendarYmdInTimeZone(periodStart, timeZone);
  return periodAnchorYmd(periodicity, ymd);
}

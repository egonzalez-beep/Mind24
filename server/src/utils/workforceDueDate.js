import { isValidIanaTimezone } from './ianaTimezone.js';

/** YYYY-MM-DD in IANA timezone for an instant. */
export function calendarYmdInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Local midnight at start of ymd in timeZone, as UTC instant. */
export function startOfCalendarDayInTimeZone(ymd, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !isValidIanaTimezone(timeZone)) return null;
  let lo = Date.parse(`${ymd}T00:00:00.000Z`) - 36 * 3600 * 1000;
  let hi = Date.parse(`${ymd}T00:00:00.000Z`) + 36 * 3600 * 1000;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const label = calendarYmdInTimeZone(new Date(mid), timeZone);
    if (label < ymd) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

/** Last millisecond of ymd in timeZone (inclusive due date). */
export function endOfCalendarDayInTimeZone(ymd, timeZone) {
  const nextYmd = addDaysYmd(ymd, 1);
  const startNext = startOfCalendarDayInTimeZone(nextYmd, timeZone);
  if (!startNext) return null;
  return new Date(startNext.getTime() - 1);
}

/**
 * Date-only input → end of that calendar day in employee timezone.
 * Legacy dueAt ISO still accepted if dueDate omitted.
 */
export function resolveWorkforceTaskDueAtFromInput({ dueDate, dueAtIso, timezone }) {
  if (dueDate === null) return null;
  if (dueDate != null && dueDate !== '') {
    const end = endOfCalendarDayInTimeZone(String(dueDate).trim(), timezone);
    if (!end) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Fecha de vencimiento inválida.';
      throw err;
    }
    return end;
  }
  if (dueAtIso) {
    const d = new Date(dueAtIso);
    if (Number.isNaN(d.getTime())) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Fecha de vencimiento inválida.';
      throw err;
    }
    return d;
  }
  return undefined;
}

import { addDaysToDateKey } from '../services/remoteWorkSessionHistory.service.js';
import { utcInstantFromLocalParts } from './timezoneLocalInstant.util.js';

export const KIOSK_PUNCH_TYPES = ['CHECK_IN', 'MEAL_OUT', 'MEAL_IN', 'CHECK_OUT'];
export const KIOSK_NEXT_PUNCH = {
  CHECK_IN: ['MEAL_OUT', 'CHECK_OUT'],
  MEAL_OUT: ['MEAL_IN'],
  MEAL_IN: ['CHECK_OUT'],
  CHECK_OUT: ['CHECK_IN'],
};
export const KIOSK_INCIDENTS = ['ABSENT', 'LATE', 'INCOMPLETE', 'LATE_EXIT'];
export const kioskPunchOrder = [{ recordedAt: 'asc' }, { ordinal: 'asc' }];
export const kioskLatestPunchOrder = [{ recordedAt: 'desc' }, { ordinal: 'desc' }];
export const kioskAttendancePunchFields = { type: true, recordedAt: true, ordinal: true, originalRecordedAt: true, isManual: true };
export const kioskAdjustmentFields = { id: true, action: true, reason: true, actorName: true, createdAt: true, incident: true, changes: true };

export function kioskComparePunches(a, b) {
  return +a.recordedAt - +b.recordedAt || a.ordinal - b.ordinal;
}

function expectedShift(date, schedule, createdAt, atMinute) {
  if (!schedule) return { kind: 'UNSCHEDULED' };
  const weekday = new Date(date).getUTCDay() || 7;
  if (!(schedule.weekdayMask & (1 << (weekday - 1)))) return { kind: 'REST' };
  const { startMinute, endMinute } = schedule.weekendHours?.[weekday] ?? schedule;
  const endDate = endMinute < startMinute ? addDaysToDateKey(date, 1) : date;
  const startAt = atMinute(date, startMinute);
  const endAt = atMinute(endDate, endMinute);
  if (createdAt > startAt) return { kind: 'BEFORE_ENROLLMENT' };
  // A clock change can skip both civil times and collapse the planned interval.
  if (endAt <= startAt) return { kind: 'UNAVAILABLE' };
  const toleranceEndAt = new Date(+startAt + schedule.toleranceMinutes * 60_000);
  return { kind: 'PLANNED', startAt, endAt, toleranceEndAt };
}

function belongsToPreviousShift(recordedAt, prior, current) {
  return prior.kind === 'PLANNED' && recordedAt < prior.endAt &&
    (current.kind !== 'PLANNED' || recordedAt < current.startAt);
}

// The input includes civil-day records and the following day's records, in chronological order.
// A continued session belongs to its entry. An entry after midnight can still start the
// previous overnight shift until that shift ends or the new day's shift begins.
export function kioskAttendanceForDay(employee, { date, nextStart, now, atMinute }) {
  const previousDate = addDaysToDateKey(date, -1);
  const nextDate = addDaysToDateKey(date, 1);
  const shiftFor = (day) => expectedShift(
    day, employee.schedules.find((schedule) => schedule.effectiveOn.toISOString().slice(0, 10) <= day),
    employee.createdAt, atMinute,
  );
  const prior = shiftFor(previousDate);
  const shift = shiftFor(date);
  const next = shiftFor(nextDate);
  const upcoming = shift.kind === 'UNSCHEDULED' ? employee.schedules[0] : null;

  const punches = [];
  let belongsToDay = false;
  for (const punch of employee.punches) {
    if (punch.type === 'CHECK_IN') {
      belongsToDay = punch.recordedAt < nextStart
        ? !belongsToPreviousShift(punch.recordedAt, prior, shift)
        : belongsToPreviousShift(punch.recordedAt, shift, next);
    }
    if (belongsToDay) punches.push(punch);
  }

  const flags = [];
  let lateMinutes;
  if (shift.kind === 'PLANNED') {
    const first = punches[0];
    const last = punches.at(-1);
    if (first) {
      const lateBy = first.recordedAt - shift.toleranceEndAt;
      const onTime = lateBy <= 0;
      flags.push(onTime ? 'ON_TIME' : 'LATE');
      if (!onTime) lateMinutes = Math.floor(lateBy / 60_000);
      if (last.type === 'CHECK_OUT') {
        if (onTime && last.recordedAt >= shift.endAt) flags.push('COMPLETED');
        if (last.recordedAt > shift.endAt) flags.push('LATE_EXIT');
      } else if (now >= shift.endAt) {
        flags.push('INCOMPLETE');
      }
    } else if (employee.isActive && now >= shift.endAt) {
      flags.push('ABSENT');
    }
  }
  return {
    ...shift,
    ...(upcoming && { scheduleStartsOn: upcoming.effectiveOn.toISOString().slice(0, 10) }),
    ...(lateMinutes !== undefined && { lateMinutes }),
    flags,
    punches,
  };
}

export function kioskMinuteLookup(timeZone) {
  const instants = new Map();
  return (date, minute) => {
    const key = date + ':' + minute;
    if (!instants.has(key)) {
      instants.set(key, utcInstantFromLocalParts(date, Math.floor(minute / 60), minute % 60, timeZone));
    }
    return instants.get(key);
  };
}

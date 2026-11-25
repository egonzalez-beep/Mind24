import { addDaysToDateKey } from '../services/remoteWorkSessionHistory.service.js';
import { utcInstantFromLocalParts } from './timezoneLocalInstant.util.js';

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

// The input includes civil-day records and the following day's records, in ordinal order.
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
  if (shift.kind === 'PLANNED') {
    const first = punches[0];
    const last = punches.at(-1);
    if (first) {
      flags.push(first.recordedAt <= shift.toleranceEndAt ? 'ON_TIME' : 'LATE');
      if (last.type === 'CHECK_OUT') {
        if (last.recordedAt > shift.endAt) flags.push('LATE_EXIT');
      } else if (now >= shift.endAt) {
        flags.push('INCOMPLETE');
      }
    } else if (employee.isActive && now >= shift.endAt) {
      flags.push('ABSENT');
    }
  }
  return { ...shift, flags, punches };
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

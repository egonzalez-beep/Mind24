import { prisma } from '../db/client.js';
import { assertWorkforceEmployeeInOrg } from './workforceEmployee.service.js';
import { workedDurationSec } from './remoteWorkSession.service.js';
import {
  connectionEffectivePercent,
  enrichSessionSignalMetrics,
  isOfficialFullSignalSession,
  resolveSignalTelemetryStatus,
  SIGNAL_TELEMETRY,
} from './remoteWorkSignalDuration.service.js';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar date YYYY-MM-DD in IANA timezone. */
export function localDateKey(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
}

function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

function addDaysToDateKey(key, days) {
  const { y, m, d } = parseDateKey(key);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** UTC instant of local midnight at dateKey in timeZone. */
export function localMidnightUtc(dateKey, timeZone) {
  const { y, m, d } = parseDateKey(dateKey);
  let lo = Date.UTC(y, m - 1, d - 1, 12, 0, 0);
  let hi = Date.UTC(y, m - 1, d + 1, 12, 0, 0);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const key = localDateKey(new Date(mid), timeZone);
    if (key < dateKey) lo = mid + 1;
    else hi = mid;
  }
  return new Date(lo);
}

export function utcRangeForLocalDateInclusive(fromKey, toKey, timeZone) {
  const start = localMidnightUtc(fromKey, timeZone);
  const end = localMidnightUtc(addDaysToDateKey(toKey, 1), timeZone);
  return { start, end };
}

export function sanitizeSessionRow(session, now = new Date(), opts = {}) {
  const isOpen = !session.checkOutAt;
  const metrics = enrichSessionSignalMetrics(session, now, opts);
  return {
    id: session.id,
    checkInAt: session.checkInAt,
    checkOutAt: session.checkOutAt,
    status: session.status,
    isOpen,
    durationSec: metrics.durationSec,
    signalDurationSeconds: metrics.signalDurationSeconds,
    connectionEffectivePercent: metrics.connectionEffectivePercent,
    lastSignalAt: metrics.lastSignalAt,
    signalTelemetryStatus: metrics.signalTelemetryStatus,
    connectionVisualLevel: metrics.connectionVisualLevel,
    signalTrackingStartedAt: metrics.signalTrackingStartedAt,
    expectedCoveragePercent: metrics.expectedCoveragePercent,
  };
}

export function buildConnectionSummaryForSessions(sessions, timeZone, fromKey, toKey, now = new Date()) {
  const enriched = sessions.map((s) => enrichSessionSignalMetrics(s, now));
  const officialFull = sessions.filter((s) => isOfficialFullSignalSession(s, now));

  let totalDurationTelemetry = 0;
  let totalSignalSec = 0;
  let highGapCount = 0;
  for (let i = 0; i < sessions.length; i += 1) {
    if (!isOfficialFullSignalSession(sessions[i], now)) continue;
    const e = enriched[i];
    totalDurationTelemetry += e.durationSec ?? 0;
    totalSignalSec += e.signalDurationSeconds ?? 0;
    const gap = (e.durationSec ?? 0) - (e.signalDurationSeconds ?? 0);
    if (gap > 3 * 3600) highGapCount += 1;
  }

  const daysWithSessions = new Set();
  const daysWithFullTelemetry = new Set();
  for (let i = 0; i < sessions.length; i += 1) {
    const s = sessions[i];
    const dayKey = localDateKey(s.checkInAt, timeZone);
    daysWithSessions.add(dayKey);
    if (isOfficialFullSignalSession(s, now) && enriched[i].signalDurationSeconds != null) {
      daysWithFullTelemetry.add(dayKey);
    }
  }

  const totalDurationAll = enriched.reduce((acc, e) => acc + (e.durationSec ?? 0), 0);

  const overallConnectionEffectivePercent = connectionEffectivePercent(
    totalSignalSec,
    totalDurationTelemetry,
  );

  const avgDailyDurationSec =
    daysWithSessions.size > 0 ? Math.round(totalDurationAll / daysWithSessions.size) : null;

  const avgDailySignalSec =
    daysWithFullTelemetry.size > 0 ? Math.round(totalSignalSec / daysWithFullTelemetry.size) : null;

  const dailyMap = {};
  for (let i = 0; i < sessions.length; i += 1) {
    const s = sessions[i];
    const e = enriched[i];
    const dayKey = localDateKey(s.checkInAt, timeZone);
    if (!dailyMap[dayKey]) {
      dailyMap[dayKey] = {
        date: dayKey,
        durationSec: 0,
        signalSec: 0,
        hasFullTelemetry: false,
        hasPartialOnly: false,
      };
    }
    dailyMap[dayKey].durationSec += e.durationSec ?? 0;
    if (isOfficialFullSignalSession(s, now) && e.signalDurationSeconds != null) {
      dailyMap[dayKey].signalSec += e.signalDurationSeconds;
      dailyMap[dayKey].hasFullTelemetry = true;
    } else if (
      resolveSignalTelemetryStatus(s) === SIGNAL_TELEMETRY.PARTIAL &&
      (s.signalSampleCount ?? 0) > 0
    ) {
      dailyMap[dayKey].hasPartialOnly = true;
    }
  }

  const chartDaily = Object.keys(dailyMap)
    .sort()
    .filter((k) => k >= fromKey && k <= toKey)
    .map((k) => ({
      date: k,
      durationSec: dailyMap[k].durationSec,
      signalSec: dailyMap[k].hasFullTelemetry ? dailyMap[k].signalSec : null,
      partialOnly: dailyMap[k].hasPartialOnly && !dailyMap[k].hasFullTelemetry,
    }));

  const weeklyMap = {};
  for (const row of chartDaily) {
    const { weekStart } = weekRangeMonday(row.date, timeZone);
    if (!weeklyMap[weekStart]) {
      weeklyMap[weekStart] = {
        weekStart,
        durationSec: 0,
        signalSec: 0,
        hasFullTelemetry: false,
        partialOnly: false,
      };
    }
    weeklyMap[weekStart].durationSec += row.durationSec;
    if (row.signalSec != null) {
      weeklyMap[weekStart].signalSec += row.signalSec;
      weeklyMap[weekStart].hasFullTelemetry = true;
    }
    if (row.partialOnly) weeklyMap[weekStart].partialOnly = true;
  }

  const chartWeekly = Object.keys(weeklyMap)
    .sort()
    .map((k) => ({
      weekStart: k,
      durationSec: weeklyMap[k].durationSec,
      signalSec: weeklyMap[k].hasFullTelemetry ? weeklyMap[k].signalSec : null,
      partialOnly: weeklyMap[k].partialOnly && !weeklyMap[k].hasFullTelemetry,
    }));

  return {
    sessionCountTotal: sessions.length,
    sessionCountWithFullTelemetry: officialFull.length,
    totalDurationSec: totalDurationAll,
    totalSignalDurationSec: officialFull.length > 0 ? totalSignalSec : null,
    avgDailyDurationSec,
    avgDailySignalSec,
    overallConnectionEffectivePercent,
    highGapSessionCount: highGapCount,
    chartDaily,
    chartWeekly,
  };
}

export function groupSessionsByLocalDay(sessions, timeZone, now = new Date(), enrichOpts = {}) {
  const days = {};
  for (const raw of sessions) {
    const row = sanitizeSessionRow(raw, now, enrichOpts);
    const dayKey = localDateKey(row.checkInAt, timeZone);
    if (!days[dayKey]) {
      days[dayKey] = {
        date: dayKey,
        sessionCount: 0,
        hasOpen: false,
        totalDurationSec: 0,
        sessions: [],
      };
    }
    const bucket = days[dayKey];
    bucket.sessionCount += 1;
    bucket.hasOpen = bucket.hasOpen || row.isOpen;
    bucket.totalDurationSec += row.durationSec ?? 0;
    bucket.sessions.push(row);
  }
  for (const bucket of Object.values(days)) {
    bucket.sessions.sort(
      (a, b) => new Date(a.checkInAt).getTime() - new Date(b.checkInAt).getTime(),
    );
  }
  return days;
}

/** Monday-start week containing refDateKey in employee timezone. */
export function weekRangeMonday(refDateKey, timeZone) {
  let cursor = refDateKey;
  for (let i = 0; i < 7; i += 1) {
    const instant = localMidnightUtc(cursor, timeZone);
    const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
    if (wd === 'Mon') break;
    cursor = addDaysToDateKey(cursor, -1);
  }
  return { weekStart: cursor, weekEnd: addDaysToDateKey(cursor, 6) };
}

export function buildWeekSummary(sessions, timeZone, refDateKey, now = new Date()) {
  const { weekStart, weekEnd } = weekRangeMonday(refDateKey, timeZone);
  let sessionCount = 0;
  let totalDurationSec = 0;
  for (const raw of sessions) {
    const key = localDateKey(raw.checkInAt, timeZone);
    if (key < weekStart || key > weekEnd) continue;
    sessionCount += 1;
    totalDurationSec += workedDurationSec(raw, now) ?? 0;
  }
  const averageDurationSec =
    sessionCount > 0 ? Math.round(totalDurationSec / sessionCount) : null;
  return {
    weekStart,
    weekEnd,
    sessionCount,
    totalDurationSec,
    averageDurationSec,
  };
}

export function assertValidDateRange(fromKey, toKey, maxDays = 93) {
  if (!DATE_KEY_RE.test(fromKey) || !DATE_KEY_RE.test(toKey)) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Rango de fechas inválido (use YYYY-MM-DD).';
    throw err;
  }
  if (fromKey > toKey) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La fecha inicial no puede ser posterior a la final.';
    throw err;
  }
  const span =
    Math.floor(
      (localMidnightUtc(toKey, 'UTC').getTime() - localMidnightUtc(fromKey, 'UTC').getTime()) /
        86400000,
    ) + 1;
  if (span > maxDays) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'El rango solicitado es demasiado amplio.';
    throw err;
  }
}

export async function listEmployeeSessionsHistory({
  organizationId,
  employeeId,
  fromKey,
  toKey,
  now = new Date(),
}) {
  assertValidDateRange(fromKey, toKey);
  const emp = await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const timeZone = emp.timezone;
  const { start, end } = utcRangeForLocalDateInclusive(fromKey, toKey, timeZone);

  const sessions = await prisma.remoteWorkSession.findMany({
    where: {
      employeeId: emp.id,
      checkInAt: { gte: start, lt: end },
    },
    orderBy: { checkInAt: 'asc' },
    select: {
      id: true,
      checkInAt: true,
      checkOutAt: true,
      status: true,
      lastHeartbeatAt: true,
      lastWebSignal: true,
      lastVisibilityState: true,
      signalDurationSeconds: true,
      signalTrackingStartedAt: true,
      signalLastCreditedAt: true,
      signalSampleCount: true,
      signalTelemetryStatus: true,
    },
  });

  const enrichOpts = { expectedWorkMinutes: emp.expectedWorkMinutes };
  const sanitized = sessions.map((s) => sanitizeSessionRow(s, now, enrichOpts));
  const days = groupSessionsByLocalDay(sessions, timeZone, now, enrichOpts);
  const connectionSummary = buildConnectionSummaryForSessions(
    sessions,
    timeZone,
    fromKey,
    toKey,
    now,
  );
  const todayKey = localDateKey(now, timeZone);
  const { weekStart, weekEnd } = weekRangeMonday(todayKey, timeZone);
  const weekUtc = utcRangeForLocalDateInclusive(weekStart, weekEnd, timeZone);
  const weekSessions = await prisma.remoteWorkSession.findMany({
    where: {
      employeeId: emp.id,
      checkInAt: { gte: weekUtc.start, lt: weekUtc.end },
    },
    orderBy: { checkInAt: 'asc' },
    select: {
      id: true,
      checkInAt: true,
      checkOutAt: true,
      status: true,
      lastHeartbeatAt: true,
      lastWebSignal: true,
      lastVisibilityState: true,
      signalDurationSeconds: true,
      signalTrackingStartedAt: true,
      signalLastCreditedAt: true,
      signalSampleCount: true,
      signalTelemetryStatus: true,
    },
  });
  const weekSummary = buildWeekSummary(weekSessions, timeZone, todayKey, now);

  return {
    employeeId: emp.id,
    timezone: timeZone,
    expectedWorkMinutes: emp.expectedWorkMinutes ?? null,
    from: fromKey,
    to: toKey,
    sessions: sanitized,
    days,
    weekSummary,
    connectionSummary,
  };
}

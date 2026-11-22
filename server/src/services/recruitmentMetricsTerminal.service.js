import { localYearMonth } from './organizationTimezone.service.js';

export const TERMINAL_MIN_DWELL_MS = 24 * 60 * 60 * 1000;

/** Timeline row mínima para reglas consolidadas. */
export function effectiveStageKeyAt(timeline, instant) {
  let key = null;
  for (const ev of timeline) {
    if (ev.createdAt.getTime() <= instant.getTime()) key = ev.toStageKey;
    else break;
  }
  return key;
}

export function isSelectedMonthCurrent(year, month, timeZone, now = new Date()) {
  const cur = localYearMonth(now, timeZone);
  return cur.year === year && cur.month === month;
}

/**
 * ¿Esta application cuenta una vez para stageKey en el mes?
 * @returns {{ applicationId: string, entryAt: Date } | null}
 */
export function qualifyTerminalApplicationForMonth({
  applicationId,
  currentStageKey,
  timeline,
  stageKey,
  monthStart,
  monthEnd,
  endOfMonthInstant,
  now,
  isCurrentMonth,
}) {
  const entries = timeline.filter(
    (ev) =>
      ev.toStageKey === stageKey &&
      ev.createdAt.getTime() >= monthStart.getTime() &&
      ev.createdAt.getTime() < monthEnd.getTime(),
  );
  if (!entries.length) return null;

  /** Contratación seguida de Baja en el mismo mes sigue contando una sola vez como HIRED. */
  const hireSurvivesExit =
    stageKey === 'HIRED'
    && (currentStageKey === 'EMPLOYMENT_EXIT'
      || effectiveStageKeyAt(timeline, endOfMonthInstant) === 'EMPLOYMENT_EXIT');

  if (!isCurrentMonth) {
    const atClose = effectiveStageKeyAt(timeline, endOfMonthInstant);
    if (atClose !== stageKey && !(stageKey === 'HIRED' && atClose === 'EMPLOYMENT_EXIT')) {
      return null;
    }
    const entryAt = entries[entries.length - 1].createdAt;
    return { applicationId, entryAt };
  }

  if (currentStageKey !== stageKey && !hireSurvivesExit) return null;

  const lastEntry = entries[entries.length - 1];
  const entryMs = lastEntry.createdAt.getTime();
  const minEndMs = entryMs + TERMINAL_MIN_DWELL_MS;

  for (const ev of timeline) {
    if (ev.createdAt.getTime() <= entryMs) continue;
    if (ev.toStageKey !== stageKey) {
      // HIRED → Baja cuenta aunque sea en <24 h; el resto conserva la ventana.
      if (stageKey === 'HIRED' && ev.toStageKey === 'EMPLOYMENT_EXIT') break;
      if (ev.createdAt.getTime() < minEndMs) return null;
      break;
    }
  }

  if (currentStageKey === stageKey && now.getTime() < minEndMs) return null;
  if (hireSurvivesExit) {
    // Baja temprana no anula la contratación; otras salidas <24 h sí.
    const leftEarly = timeline.some(
      (ev) =>
        ev.createdAt.getTime() > entryMs
        && ev.createdAt.getTime() < minEndMs
        && ev.toStageKey !== stageKey
        && ev.toStageKey !== 'EMPLOYMENT_EXIT',
    );
    if (leftEarly) return null;
  }

  return { applicationId, entryAt: lastEntry.createdAt };
}

export function consolidateTerminalApplications(applications, stageKey, context) {
  const out = [];
  for (const app of applications) {
    const row = qualifyTerminalApplicationForMonth({
      applicationId: app.applicationId,
      currentStageKey: app.currentStageKey,
      timeline: app.timeline,
      stageKey,
      ...context,
    });
    if (row) out.push(row);
  }
  return out;
}

export function rejectedTopClientFromConsolidated(applicationsById, consolidatedRejected) {
  const byClient = new Map();
  for (const row of consolidatedRejected) {
    const app = applicationsById.get(row.applicationId);
    const raw = app?.clientName ?? app?.vacancy?.clientName;
    const name = (raw || 'Sin cliente').trim() || 'Sin cliente';
    byClient.set(name, (byClient.get(name) || 0) + 1);
  }
  const total = consolidatedRejected.length;
  let top = null;
  for (const [name, count] of byClient.entries()) {
    if (!top || count > top.count) top = { name, count };
  }
  if (!top || total === 0) return { total: 0, topClient: null };
  return {
    total,
    topClient: {
      name: top.name,
      count: top.count,
      percent: Math.round((top.count / total) * 100),
    },
  };
}

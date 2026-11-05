import { prisma } from '../db/client.js';
import { isValidIanaTimezone } from '../utils/ianaTimezone.js';
import { calendarYmdInTimeZone } from '../utils/workforceDueDate.js';
import { ymdFromDateField } from '../utils/workforceGoalPeriod.util.js';
import {
  derivePeriodDisplayStatus,
  ensureWorkforceGoalPeriodsUpToDate,
} from './workforceGoal.service.js';

/** Organization no tiene zona horaria. Orden: colaborador, si no America/Mexico_City. */
export const DAILY_GOALS_REMINDER_FALLBACK_TIME_ZONE = 'America/Mexico_City';
export const DAILY_GOALS_REMINDER_START_MINUTES = 10 * 60;
export const DAILY_GOALS_REMINDER_END_MINUTES = 18 * 60;
export const DAILY_GOALS_REMINDER_SWEEP_MS = 5 * 60 * 1000;
export const GOAL_TITLE_MAX = 80;
export const WORKFORCE_DAILY_GOALS_REMINDER = 'WORKFORCE_DAILY_GOALS_REMINDER';

/**
 * Solo entra PENDING: periodo de hoy abierto y sin resultado.
 * PARTIAL, MET, NOT_MET, OVERDUE e INACTIVE quedan fuera.
 * No se cambia derivePeriodDisplayStatus ni el formulario de Completadas.
 */

export function resolveReminderTimeZone(employeeTimeZone) {
  if (isValidIanaTimezone(employeeTimeZone)) return employeeTimeZone;
  return DAILY_GOALS_REMINDER_FALLBACK_TIME_ZONE;
}

export function localClock(now, timeZone) {
  const ymd = calendarYmdInTimeZone(now, timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hourRaw = parts.find((part) => part.type === 'hour')?.value ?? '0';
  const minuteRaw = parts.find((part) => part.type === 'minute')?.value ?? '0';
  let hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (hour === 24) hour = 0;
  return { ymd, minutes: hour * 60 + minute };
}

export function isWithinDailyReminderWindow(minutes) {
  return minutes >= DAILY_GOALS_REMINDER_START_MINUTES && minutes < DAILY_GOALS_REMINDER_END_MINUTES;
}

export function compactGoalTitle(title) {
  const text = String(title ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return Array.from(text).slice(0, GOAL_TITLE_MAX).join('');
}

export function goalAppliesOnLocalDate(goal, localYmd) {
  if (!goal || goal.archivedAt || goal.periodicity !== 'DAILY') return false;
  const start = ymdFromDateField(goal.startDate);
  if (!start || start > localYmd) return false;
  if (goal.endDate) {
    const end = ymdFromDateField(goal.endDate);
    if (end && end < localYmd) return false;
  }
  return true;
}

export function periodCoversInstant(period, now) {
  if (!period?.periodStart || !period?.periodEnd) return false;
  const time = now.getTime();
  return period.periodStart.getTime() <= time && time <= period.periodEnd.getTime();
}

export function dailyGoalNeedsReminder(goal, period, now) {
  if (!periodCoversInstant(period, now)) return false;
  return derivePeriodDisplayStatus(goal, period, now) === 'PENDING';
}

export function dailyGoalsReminderDedupeKey(employeeId, localDateKey) {
  return `workforce_daily_goals_reminder:${employeeId}:${localDateKey}`;
}

export function buildDailyGoalsReminderCopy(goals) {
  const list = Array.isArray(goals) ? goals : [];
  const named = list.map((goal) => compactGoalTitle(goal?.title)).filter(Boolean);
  if (list.length === 1 && named.length === 1) {
    return {
      title: 'Meta pendiente para hoy',
      body: `No olvides registrar tu avance en «${named[0]}».`,
    };
  }
  if (list.length >= 2) {
    return {
      title: `Tienes ${list.length} metas para hoy`,
      body: 'No olvides registrar tus avances.',
    };
  }
  return {
    title: 'Tienes metas para hoy',
    body: 'No olvides registrar tus avances.',
  };
}

export function buildDailyGoalsReminderMessage(copy) {
  return `${copy.title} ${copy.body}`;
}

function organizationAllowsReminder(employee) {
  const org = employee?.organization;
  if (!org) return true;
  return org.blocked !== true && org.empresaPortalEnabled !== false;
}

export function selectDailyReminderPlans({ now, goals, periodsByGoalId }) {
  const grouped = new Map();
  for (const goal of goals || []) {
    const employee = goal.employee;
    if (!employee?.isActive || !organizationAllowsReminder(employee)) continue;
    const timeZone = resolveReminderTimeZone(employee.timezone);
    let clock;
    try {
      clock = localClock(now, timeZone);
    } catch {
      continue;
    }
    if (!isWithinDailyReminderWindow(clock.minutes)) continue;
    if (!goalAppliesOnLocalDate(goal, clock.ymd)) continue;
    const period = periodsByGoalId?.get?.(goal.id) || null;
    if (!dailyGoalNeedsReminder(goal, period, now)) continue;
    const bucketKey = `${goal.organizationId}:${goal.employeeId}:${clock.ymd}`;
    if (!grouped.has(bucketKey)) {
      grouped.set(bucketKey, {
        organizationId: goal.organizationId,
        employeeId: goal.employeeId,
        localDateKey: clock.ymd,
        timeZone,
        goals: [],
      });
    }
    grouped.get(bucketKey).goals.push(goal);
  }
  return [...grouped.values()];
}

function isDedupeUniqueConflict(err) {
  if (err?.code !== 'P2002') return false;
  const target = err.meta?.target;
  const text = Array.isArray(target) ? target.join(' ') : String(target || '');
  return text.includes('dedupeKey');
}

export async function emitDailyGoalsReminder(client, plan) {
  const copy = buildDailyGoalsReminderCopy(plan.goals);
  const message = buildDailyGoalsReminderMessage(copy);
  const named = plan.goals.length === 1 ? compactGoalTitle(plan.goals[0]?.title) : '';
  const metadata = {
    localDateKey: plan.localDateKey,
    pendingCount: plan.goals.length,
    goalId: named ? plan.goals[0].id : null,
    title: copy.title,
    body: copy.body,
  };
  const dedupeKey = dailyGoalsReminderDedupeKey(plan.employeeId, plan.localDateKey);
  const where = {
    organizationId_dedupeKey: { organizationId: plan.organizationId, dedupeKey },
  };
  try {
    return await client.workforceWorkplaceInbox.upsert({
      where,
      create: {
        organizationId: plan.organizationId,
        recipientWorkforceEmployeeId: plan.employeeId,
        eventType: WORKFORCE_DAILY_GOALS_REMINDER,
        message,
        metadata,
        dedupeKey,
      },
      update: {},
    });
  } catch (err) {
    if (!isDedupeUniqueConflict(err)) throw err;
    const existing = await client.workforceWorkplaceInbox.findUnique({ where });
    if (!existing) throw err;
    return existing;
  }
}

const goalSelect = {
  id: true,
  title: true,
  organizationId: true,
  employeeId: true,
  goalType: true,
  periodicity: true,
  targetValue: true,
  startDate: true,
  endDate: true,
  archivedAt: true,
  employee: {
    select: {
      id: true,
      isActive: true,
      timezone: true,
      organizationId: true,
      organization: { select: { blocked: true, empresaPortalEnabled: true } },
    },
  },
};

function employeeInReminderWindow(employee, now) {
  if (!employee?.isActive || !organizationAllowsReminder(employee)) return null;
  const timeZone = resolveReminderTimeZone(employee.timezone);
  let clock;
  try {
    clock = localClock(now, timeZone);
  } catch {
    return null;
  }
  if (!isWithinDailyReminderWindow(clock.minutes)) return null;
  return { employee, timeZone, clock };
}

/**
 * Consultas de un tick, siempre en lote:
 * 1. Colaboradores activos de organizaciones habilitadas.
 * 2. Avisos ya guardados para quienes están en la ventana local.
 * 3. Metas DAILY vigentes solo de quienes todavía no tienen el dedupe del día.
 * 4. Periodos que cubren este instante, en una sola consulta.
 * 5. ensureWorkforceGoalPeriodsUpToDate solo para la meta cuyo periodo de hoy falta.
 *    Si el último periodo es el de ayer, el helper inserta solo el de hoy.
 *    Si la meta nunca tuvo periodos, rellena desde su inicio hasta hoy, con el tope
 *    ya existente de 400, una sola vez. No se vuelve a llamar cuando el dedupe existe.
 * 6. Un upsert por colaborador con al menos una meta PENDING.
 * Quien ya tiene el aviso del día no llega a los pasos 3–6.
 */
export async function sweepDailyGoalReminders(now = new Date(), deps = {}) {
  const db = deps.db || prisma;
  const ensurePeriods = deps.ensurePeriods || ensureWorkforceGoalPeriodsUpToDate;
  const emit = deps.emit || emitDailyGoalsReminder;
  const employees = await db.workforceEmployee.findMany({
    where: {
      isActive: true,
      organization: { blocked: false, empresaPortalEnabled: true },
    },
    select: {
      id: true,
      timezone: true,
      isActive: true,
      organizationId: true,
      organization: { select: { blocked: true, empresaPortalEnabled: true } },
    },
  });
  const inWindow = employees
    .map((employee) => employeeInReminderWindow(employee, now))
    .filter(Boolean);
  if (!inWindow.length) {
    return { planned: 0, examined: employees.length, ensured: 0, skippedByDedupe: 0 };
  }

  const existing = await db.workforceWorkplaceInbox.findMany({
    where: {
      eventType: WORKFORCE_DAILY_GOALS_REMINDER,
      OR: inWindow.map(({ employee, clock }) => ({
        organizationId: employee.organizationId,
        dedupeKey: dailyGoalsReminderDedupeKey(employee.id, clock.ymd),
      })),
    },
    select: { organizationId: true, dedupeKey: true },
  });
  const seen = new Set(existing.map((row) => `${row.organizationId}|${row.dedupeKey}`));
  const pendingPeople = inWindow.filter(
    ({ employee, clock }) => !seen.has(`${employee.organizationId}|${dailyGoalsReminderDedupeKey(employee.id, clock.ymd)}`),
  );
  if (!pendingPeople.length) {
    return { planned: 0, examined: employees.length, ensured: 0, skippedByDedupe: inWindow.length };
  }

  const employeeById = new Map(pendingPeople.map(({ employee }) => [employee.id, employee]));
  const loadedGoals = await db.workforceGoal.findMany({
    where: {
      periodicity: 'DAILY',
      archivedAt: null,
      employeeId: { in: [...employeeById.keys()] },
    },
    select: goalSelect,
  });
  const candidates = loadedGoals
    .map((goal) => ({ ...goal, employee: goal.employee || employeeById.get(goal.employeeId) }))
    .filter((goal) => {
      const clock = employeeInReminderWindow(goal.employee, now)?.clock;
      return clock && goalAppliesOnLocalDate(goal, clock.ymd);
    });
  if (!candidates.length) {
    return { planned: 0, examined: employees.length, ensured: 0, skippedByDedupe: inWindow.length - pendingPeople.length };
  }

  const periods = await db.workforceGoalPeriod.findMany({
    where: {
      goalId: { in: candidates.map((goal) => goal.id) },
      periodStart: { lte: now },
      periodEnd: { gte: now },
    },
  });
  const periodsByGoalId = new Map(periods.map((period) => [period.goalId, period]));
  const missing = candidates.filter((goal) => !periodsByGoalId.has(goal.id));
  let ensured = 0;
  for (const goal of missing) {
    try {
      const timeZone = resolveReminderTimeZone(goal.employee.timezone);
      await ensurePeriods(goal, { ...goal.employee, timezone: timeZone }, now);
      ensured += 1;
    } catch (err) {
      console.error('[daily-goals-reminder] period', err?.code || 'error');
    }
  }
  if (missing.length) {
    const created = await db.workforceGoalPeriod.findMany({
      where: {
        goalId: { in: missing.map((goal) => goal.id) },
        periodStart: { lte: now },
        periodEnd: { gte: now },
      },
    });
    for (const period of created) periodsByGoalId.set(period.goalId, period);
  }

  const plans = selectDailyReminderPlans({ now, goals: candidates, periodsByGoalId });
  let planned = 0;
  for (const plan of plans) {
    try {
      await emit(db, plan);
      planned += 1;
    } catch (err) {
      console.error('[daily-goals-reminder] emit', err?.code || 'error');
    }
  }
  return {
    planned,
    examined: employees.length,
    ensured,
    skippedByDedupe: inWindow.length - pendingPeople.length,
  };
}

let reminderSweepTimer = null;
let reminderSweepRunning = false;

export function runDailyGoalsReminderSweepTick(task = sweepDailyGoalReminders) {
  if (reminderSweepRunning) return Promise.resolve({ skipped: true });
  reminderSweepRunning = true;
  return Promise.resolve()
    .then(() => task())
    .catch((err) => {
      console.error('[daily-goals-reminder]', err?.code || 'error');
      return { failed: true };
    })
    .finally(() => {
      reminderSweepRunning = false;
    });
}

export function startDailyGoalsReminderSweep() {
  if (reminderSweepTimer) return;
  const tick = () => {
    runDailyGoalsReminderSweepTick().catch(() => {});
  };
  tick();
  reminderSweepTimer = setInterval(tick, DAILY_GOALS_REMINDER_SWEEP_MS);
  if (typeof reminderSweepTimer.unref === 'function') reminderSweepTimer.unref();
}

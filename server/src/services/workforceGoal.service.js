import { prisma } from '../db/client.js';
import { assertWorkforceEmployeeInOrg } from './workforceEmployee.service.js';
import {
  anchorYmdFromPeriodStart,
  countPeriodAnchorsInclusive,
  currentAnchorYmdForGoal,
  listPeriodAnchorsBetween,
  nextPeriodAnchorYmd,
  periodBoundsFromAnchor,
  periodAnchorYmd,
  ymdFromDateField,
  MAX_GOAL_PERIOD_BACKFILL,
} from '../utils/workforceGoalPeriod.util.js';

export const MAX_GOAL_ACHIEVED_VALUE = 1e9;
export const MAX_GOAL_PERIOD_HISTORY_ROWS = 120;

const GOAL_START_TOO_OLD_MSG =
  'La fecha de inicio es demasiado antigua para esta periodicidad. Elige una fecha más reciente.';
const GOAL_BACKFILL_LIMIT_MSG =
  'Esta meta requiere materializar más periodos de los permitidos en una sola operación. Contacta soporte para regularizar el historial.';

function validationError(message) {
  const err = new Error('VALIDATION_ERROR');
  err.code = 'VALIDATION_ERROR';
  err.message = message;
  return err;
}

function goalBackfillLimitError() {
  const err = new Error('GOAL_PERIOD_BACKFILL_LIMIT');
  err.code = 'GOAL_PERIOD_BACKFILL_LIMIT';
  err.message = GOAL_BACKFILL_LIMIT_MSG;
  return err;
}

function computeLimitAnchorYmd(periodicity, endDateYmd, now, timeZone) {
  let limitAnchor = currentAnchorYmdForGoal(periodicity, now, timeZone);
  if (endDateYmd) {
    const endAnchor = periodAnchorYmd(periodicity, endDateYmd);
    if (endAnchor < limitAnchor) limitAnchor = endAnchor;
  }
  return limitAnchor;
}

export const WORKFORCE_GOAL_TYPES = ['COMPLIANCE', 'QUANTITATIVE'];
export const WORKFORCE_GOAL_PERIODICITIES = ['DAILY', 'WEEKLY', 'MONTHLY'];
export const WORKFORCE_GOAL_BINARY_RESULTS = ['MET', 'NOT_MET'];

export function computeCompletionPercent(goalType, { targetSnapshot, achievedValue, binaryResult }) {
  if (goalType === 'COMPLIANCE') {
    if (binaryResult === 'MET') return 100;
    if (binaryResult === 'NOT_MET') return 0;
    return null;
  }
  const target = Number(targetSnapshot);
  const achieved = Number(achievedValue);
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(achieved)) return null;
  return (achieved / target) * 100;
}

export function derivePeriodDisplayStatus(goal, period, now = new Date()) {
  if (goal.archivedAt) return 'INACTIVE';
  const hasResult =
    period.binaryResult != null ||
    (period.achievedValue != null && Number.isFinite(Number(period.achievedValue)));
  const ended = now.getTime() > period.periodEnd.getTime();
  if (!hasResult && !ended) return 'PENDING';
  if (!hasResult && ended) return 'OVERDUE';
  if (goal.goalType === 'COMPLIANCE') {
    return period.binaryResult === 'MET' ? 'MET' : 'NOT_MET';
  }
  const achieved = Number(period.achievedValue);
  const target = Number(period.targetSnapshot);
  if (achieved >= target) return 'MET';
  if (achieved === 0) return 'NOT_MET';
  return 'PARTIAL';
}

function snapshotTargetForGoal(goal) {
  if (goal.goalType === 'QUANTITATIVE') return Number(goal.targetValue);
  return 1;
}

function serializeGoal(goal, extras = {}) {
  return {
    id: goal.id,
    employeeId: goal.employeeId,
    title: goal.title,
    description: goal.description,
    goalType: goal.goalType,
    periodicity: goal.periodicity,
    targetValue: goal.targetValue,
    unit: goal.unit,
    startDate: ymdFromDateField(goal.startDate),
    endDate: goal.endDate ? ymdFromDateField(goal.endDate) : null,
    archivedAt: goal.archivedAt ? goal.archivedAt.toISOString() : null,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
    ...extras,
  };
}

function serializePeriod(period, goal, now = new Date()) {
  return {
    id: period.id,
    goalId: period.goalId,
    periodStart: period.periodStart.toISOString(),
    periodEnd: period.periodEnd.toISOString(),
    targetSnapshot: period.targetSnapshot,
    achievedValue: period.achievedValue,
    binaryResult: period.binaryResult,
    completionPercent: period.completionPercent,
    employeeComment: period.employeeComment,
    submittedAt: period.submittedAt ? period.submittedAt.toISOString() : null,
    displayStatus: derivePeriodDisplayStatus(goal, period, now),
    createdAt: period.createdAt.toISOString(),
    updatedAt: period.updatedAt.toISOString(),
  };
}

async function assertGoalInOrg(goalId, organizationId) {
  const goal = await prisma.workforceGoal.findFirst({
    where: { id: goalId, organizationId },
  });
  if (!goal) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Meta no encontrada.';
    throw err;
  }
  return goal;
}

function isGoalPeriodUniqueViolation(e) {
  if (e?.code !== 'P2002') return false;
  const target = e.meta?.target;
  if (Array.isArray(target)) {
    return target.includes('goalId') && target.includes('periodStart');
  }
  return String(target || '').includes('goalId_periodStart');
}

async function materializeGoalPeriodAnchors(tx, goal, employee, anchorYmds) {
  if (!anchorYmds.length) return;
  if (anchorYmds.length > MAX_GOAL_PERIOD_BACKFILL) {
    throw goalBackfillLimitError();
  }
  const targetSnapshot = snapshotTargetForGoal(goal);
  const rows = anchorYmds.map((anchorYmd) => {
    const { periodStart, periodEnd } = periodBoundsFromAnchor(
      anchorYmd,
      goal.periodicity,
      employee.timezone,
    );
    return {
      organizationId: goal.organizationId,
      goalId: goal.id,
      employeeId: goal.employeeId,
      periodStart,
      periodEnd,
      targetSnapshot,
    };
  });
  try {
    await tx.workforceGoalPeriod.createMany({ data: rows, skipDuplicates: true });
  } catch (e) {
    if (!isGoalPeriodUniqueViolation(e)) throw e;
  }
}

/**
 * Zona horaria: IANA del colaborador (WorkforceEmployee.timezone).
 * Máximo MAX_GOAL_PERIOD_BACKFILL inserts por solicitud; sin rondas ni periodos futuros.
 */
export async function ensureWorkforceGoalPeriodsUpToDate(goal, employee, now = new Date()) {
  if (goal.archivedAt) return;
  const startYmd = ymdFromDateField(goal.startDate);
  const endYmd = goal.endDate ? ymdFromDateField(goal.endDate) : null;
  const limitAnchor = computeLimitAnchorYmd(goal.periodicity, endYmd, now, employee.timezone);
  if (startYmd > limitAnchor) return;

  const goalStartAnchor = periodAnchorYmd(goal.periodicity, startYmd);
  const latest = await prisma.workforceGoalPeriod.findFirst({
    where: { goalId: goal.id },
    orderBy: { periodStart: 'desc' },
    select: { periodStart: true },
  });
  let fromAnchor = goalStartAnchor;
  if (latest) {
    const lastAnchor = anchorYmdFromPeriodStart(
      latest.periodStart,
      goal.periodicity,
      employee.timezone,
    );
    fromAnchor = nextPeriodAnchorYmd(goal.periodicity, lastAnchor);
  }
  if (fromAnchor > limitAnchor) return;

  const missingCount = countPeriodAnchorsInclusive(fromAnchor, limitAnchor, goal.periodicity);
  if (missingCount === 0) return;
  if (missingCount > MAX_GOAL_PERIOD_BACKFILL) {
    throw goalBackfillLimitError();
  }

  const anchors = listPeriodAnchorsBetween(fromAnchor, limitAnchor, goal.periodicity);
  await prisma.$transaction(async (tx) => {
    await materializeGoalPeriodAnchors(tx, goal, employee, anchors);
  });
}

export async function createWorkforceGoalForEmployee({
  organizationId,
  employeeId,
  createdByUserId,
  title,
  description,
  goalType,
  periodicity,
  targetValue,
  unit,
  startDate,
  endDate,
}) {
  const employee = await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  if (goalType === 'QUANTITATIVE') {
    const tv = Number(targetValue);
    if (!Number.isFinite(tv) || tv <= 0) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'El valor objetivo debe ser mayor a cero.';
      throw err;
    }
  }
  if (endDate && startDate > endDate) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La fecha de inicio no puede ser posterior al fin.';
    throw err;
  }
  const now = new Date();
  const limitAnchor = computeLimitAnchorYmd(periodicity, endDate, now, employee.timezone);
  const startAnchor = periodAnchorYmd(periodicity, startDate);
  if (startAnchor > limitAnchor) {
    throw validationError('La fecha de inicio no puede ser posterior al periodo vigente.');
  }
  const periodCount = countPeriodAnchorsInclusive(startDate, limitAnchor, periodicity);
  if (periodCount > MAX_GOAL_PERIOD_BACKFILL) {
    throw validationError(GOAL_START_TOO_OLD_MSG);
  }

  const goal = await prisma.$transaction(async (tx) => {
    const row = await tx.workforceGoal.create({
      data: {
        organizationId,
        employeeId,
        createdByUserId,
        title: title.trim(),
        description: description?.trim() || null,
        goalType,
        periodicity,
        targetValue: goalType === 'QUANTITATIVE' ? Number(targetValue) : null,
        unit: goalType === 'QUANTITATIVE' ? unit?.trim() || null : null,
        startDate: new Date(`${startDate}T00:00:00.000Z`),
        endDate: endDate ? new Date(`${endDate}T00:00:00.000Z`) : null,
      },
    });
    const anchors = listPeriodAnchorsBetween(startDate, limitAnchor, periodicity);
    await materializeGoalPeriodAnchors(tx, row, employee, anchors);
    return row;
  });

  return serializeGoal(goal);
}

async function loadGoalBundle(goalId, organizationId) {
  const goal = await assertGoalInOrg(goalId, organizationId);
  const employee = await assertWorkforceEmployeeInOrg(goal.employeeId, organizationId);
  await ensureWorkforceGoalPeriodsUpToDate(goal, employee);
  return { goal, employee };
}

export async function listWorkforceGoalsForAdmin({ organizationId, employeeId }) {
  await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const goals = await prisma.workforceGoal.findMany({
    where: { organizationId, employeeId },
    orderBy: [{ archivedAt: 'asc' }, { createdAt: 'desc' }],
  });
  const employee = await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const now = new Date();
  const out = [];
  for (const goal of goals) {
    await ensureWorkforceGoalPeriodsUpToDate(goal, employee, now);
    const currentPeriod = await prisma.workforceGoalPeriod.findFirst({
      where: {
        goalId: goal.id,
        periodStart: { lte: now },
        periodEnd: { gte: now },
      },
      orderBy: { periodStart: 'desc' },
    });
    out.push(
      serializeGoal(goal, {
        currentPeriod: currentPeriod ? serializePeriod(currentPeriod, goal, now) : null,
      }),
    );
  }
  return out;
}

export async function listWorkforceGoalPeriodsForAdmin({ organizationId, goalId }) {
  const { goal } = await loadGoalBundle(goalId, organizationId);
  const periods = await prisma.workforceGoalPeriod.findMany({
    where: { goalId, organizationId },
    orderBy: { periodStart: 'desc' },
    take: MAX_GOAL_PERIOD_HISTORY_ROWS,
  });
  const now = new Date();
  return {
    goal: serializeGoal(goal),
    periods: periods.map((p) => serializePeriod(p, goal, now)),
  };
}

export async function archiveWorkforceGoal({ organizationId, goalId }) {
  const goal = await assertGoalInOrg(goalId, organizationId);
  if (goal.archivedAt) return serializeGoal(goal);
  const updated = await prisma.workforceGoal.update({
    where: { id: goal.id },
    data: { archivedAt: new Date() },
  });
  return serializeGoal(updated);
}

function sortPeriodsForEmployeeView(periods, goal, now) {
  const decorated = periods.map((p) => ({
    period: p,
    status: derivePeriodDisplayStatus(goal, p, now),
    sortKey: p.periodStart.getTime(),
  }));
  const rank = { OVERDUE: 0, PENDING: 1, MET: 2, PARTIAL: 2, NOT_MET: 2, INACTIVE: 3 };
  decorated.sort((a, b) => {
    const ra = rank[a.status] ?? 9;
    const rb = rank[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    return b.sortKey - a.sortKey;
  });
  return decorated.map((d) => d.period);
}

export async function listWorkforceGoalsForEmployee(employee) {
  const organizationId = employee.organizationId;
  const employeeId = employee.id;
  const goals = await prisma.workforceGoal.findMany({
    where: { organizationId, employeeId, archivedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  const now = new Date();
  const items = [];
  for (const goal of goals) {
    await ensureWorkforceGoalPeriodsUpToDate(goal, employee, now);
    let periods = await prisma.workforceGoalPeriod.findMany({
      where: {
        goalId: goal.id,
        organizationId,
        employeeId,
        periodStart: { lte: now },
      },
      orderBy: { periodStart: 'desc' },
      take: MAX_GOAL_PERIOD_HISTORY_ROWS,
    });
    periods = sortPeriodsForEmployeeView(periods, goal, now);
    items.push({
      goal: serializeGoal(goal),
      periods: periods.map((p) => serializePeriod(p, goal, now)),
    });
  }
  return items;
}

export async function listWorkforceGoalPeriodsForEmployee({ employee, goalId }) {
  const goal = await prisma.workforceGoal.findFirst({
    where: { id: goalId, organizationId: employee.organizationId, employeeId: employee.id },
  });
  if (!goal) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Meta no encontrada.';
    throw err;
  }
  await ensureWorkforceGoalPeriodsUpToDate(goal, employee);
  const now = new Date();
  const periods = await prisma.workforceGoalPeriod.findMany({
    where: {
      goalId,
      organizationId: employee.organizationId,
      employeeId: employee.id,
      periodStart: { lte: now },
    },
    orderBy: { periodStart: 'desc' },
    take: MAX_GOAL_PERIOD_HISTORY_ROWS,
  });
  return {
    goal: serializeGoal(goal),
    periods: periods.map((p) => serializePeriod(p, goal, now)),
  };
}

export async function reportWorkforceGoalPeriod({
  employee,
  periodId,
  binaryResult,
  achievedValue,
  employeeComment,
}) {
  const period = await prisma.workforceGoalPeriod.findFirst({
    where: {
      id: periodId,
      organizationId: employee.organizationId,
      employeeId: employee.id,
    },
  });
  if (!period) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Periodo no encontrado.';
    throw err;
  }
  const goal = await prisma.workforceGoal.findFirst({
    where: { id: period.goalId, organizationId: employee.organizationId, employeeId: employee.id },
  });
  if (!goal || goal.archivedAt) {
    const err = new Error('INVALID_STATE');
    err.code = 'INVALID_STATE';
    err.message = 'No se puede reportar en esta meta.';
    throw err;
  }
  const now = new Date();
  if (period.periodStart.getTime() > now.getTime()) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'No se puede reportar un periodo futuro.';
    throw err;
  }

  let patch = {};
  if (goal.goalType === 'COMPLIANCE') {
    if (!WORKFORCE_GOAL_BINARY_RESULTS.includes(binaryResult)) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Resultado de cumplimiento inválido.';
      throw err;
    }
    patch = {
      binaryResult,
      achievedValue: null,
    };
  } else {
    const val = Number(achievedValue);
    if (!Number.isFinite(val) || val < 0 || val > MAX_GOAL_ACHIEVED_VALUE) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Indica un resultado numérico válido.';
      throw err;
    }
    patch = {
      achievedValue: val,
      binaryResult: null,
    };
  }

  const completionPercent = computeCompletionPercent(goal.goalType, {
    targetSnapshot: period.targetSnapshot,
    achievedValue: patch.achievedValue,
    binaryResult: patch.binaryResult,
  });

  const submittedAt = period.submittedAt ?? now;
  const updated = await prisma.workforceGoalPeriod.update({
    where: { id: period.id },
    data: {
      ...patch,
      completionPercent,
      employeeComment: employeeComment?.trim() || null,
      submittedAt,
    },
  });
  return serializePeriod(updated, goal, now);
}

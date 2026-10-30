import { prisma } from '../db/client.js';
import { assertWorkforceEmployeeInOrg } from './workforceEmployee.service.js';
import {
  computeCompletionPercent,
  ensureWorkforceGoalPeriodsUpToDate,
} from './workforceGoal.service.js';
import {
  calendarYmdInTimeZone,
  endOfCalendarDayInTimeZone,
  startOfCalendarDayInTimeZone,
} from '../utils/workforceDueDate.js';
import { ymdFromDateField } from '../utils/workforceGoalPeriod.util.js';

/** Máximo de periodos por mes; si hay más, no se calculan KPIs parciales. */
export const MAX_METRICS_PERIODS_PER_MONTH = 500;

/** Máximo de metas activas a sincronizar en mes actual (costo ~2–3 queries/meta). */
export const MAX_METRICS_ACTIVE_GOALS = 100;

const MONTH_STRICT_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const GOAL_METRICS_PERIOD_LIMIT_MSG =
  'El volumen de periodos de este mes supera el límite permitido. Contacta soporte para revisar el historial.';
const GOAL_METRICS_GOAL_LIMIT_MSG =
  'Este colaborador tiene demasiadas metas activas para calcular indicadores de forma segura. Contacta soporte.';

function validationError(message) {
  const err = new Error('VALIDATION_ERROR');
  err.code = 'VALIDATION_ERROR';
  err.message = message;
  throw err;
}

export function goalMetricsPeriodLimitError() {
  const err = new Error('GOAL_METRICS_PERIOD_LIMIT');
  err.code = 'GOAL_METRICS_PERIOD_LIMIT';
  err.message = GOAL_METRICS_PERIOD_LIMIT_MSG;
  return err;
}

export function goalMetricsGoalLimitError() {
  const err = new Error('GOAL_METRICS_GOAL_LIMIT');
  err.code = 'GOAL_METRICS_GOAL_LIMIT';
  err.message = GOAL_METRICS_GOAL_LIMIT_MSG;
  return err;
}

/** @param {number} periodCount periodos devueltos en la consulta (máx. MAX+1) */
export function assertMetricsPeriodVolume(periodCount) {
  if (periodCount > MAX_METRICS_PERIODS_PER_MONTH) {
    throw goalMetricsPeriodLimitError();
  }
}

function isValidCalendarMonthYm(monthYm) {
  if (!MONTH_STRICT_RE.test(monthYm)) return false;
  const [y, m] = monthYm.split('-').map(Number);
  if (!Number.isFinite(y) || y < 1000 || y > 9999) return false;
  if (m < 1 || m > 12) return false;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return lastDay >= 28;
}

export function parseMetricsMonthParam(month) {
  if (typeof month !== 'string') {
    throw validationError('El parámetro month debe tener formato YYYY-MM.');
  }
  if (month !== month.trim() || /\s/.test(month)) {
    throw validationError('El parámetro month debe tener formato YYYY-MM.');
  }
  if (month.length !== 7 || !isValidCalendarMonthYm(month)) {
    throw validationError('El parámetro month debe ser un mes calendario válido (YYYY-MM).');
  }
  return month;
}

export function assertMetricsMonthNotFuture(monthYm, timeZone, now = new Date()) {
  const currentYm = currentMonthYmInTimeZone(now, timeZone);
  if (monthYm > currentYm) {
    throw validationError('No se pueden consultar meses futuros.');
  }
}

function addMonthsYm(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  let nm = m + delta;
  let ny = y;
  while (nm < 1) {
    nm += 12;
    ny -= 1;
  }
  while (nm > 12) {
    nm -= 12;
    ny += 1;
  }
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function currentMonthYmInTimeZone(now, timeZone) {
  const ymd = calendarYmdInTimeZone(now, timeZone);
  return ymd.slice(0, 7);
}

export function monthBoundsInTimeZone(monthYm, timeZone) {
  parseMetricsMonthParam(monthYm);
  const startYmd = `${monthYm}-01`;
  const nextYm = addMonthsYm(monthYm, 1);
  const endExclusive = startOfCalendarDayInTimeZone(`${nextYm}-01`, timeZone);
  const start = startOfCalendarDayInTimeZone(startYmd, timeZone);
  if (!start || !endExclusive) {
    throw validationError('Mes o zona horaria inválidos.');
  }
  return { start, endExclusive, startYmd, nextYm };
}

/** periodEnd es el último instante inclusive del periodo (endOfCalendarDayInTimeZone). */
export function isMetricsPeriodEnded(now, periodEnd) {
  return now.getTime() > periodEnd.getTime();
}

export function monthLabelEs(monthYm, timeZone) {
  const start = startOfCalendarDayInTimeZone(`${monthYm}-01`, timeZone);
  if (!start) return monthYm;
  const label = new Intl.DateTimeFormat('es-MX', {
    timeZone,
    month: 'long',
    year: 'numeric',
  }).format(start);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function previousMonthLabelEs(monthYm, timeZone) {
  const prev = addMonthsYm(monthYm, -1);
  const start = startOfCalendarDayInTimeZone(`${prev}-01`, timeZone);
  if (!start) return prev;
  return new Intl.DateTimeFormat('es-MX', { timeZone, month: 'long' }).format(start);
}

export function periodHasReport(period) {
  if (!period) return false;
  if (period.binaryResult != null) return true;
  if (period.achievedValue != null && Number.isFinite(Number(period.achievedValue))) return true;
  if (period.submittedAt) return true;
  return false;
}

export function completionPercentRaw(goal, period) {
  let pct = null;
  if (period.completionPercent != null && Number.isFinite(Number(period.completionPercent))) {
    pct = Number(period.completionPercent);
  } else {
    pct = computeCompletionPercent(goal.goalType, {
      targetSnapshot: period.targetSnapshot,
      achievedValue: period.achievedValue,
      binaryResult: period.binaryResult,
    });
  }
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct < 0) return 0;
  return pct;
}

/** Clasificación para indicadores: MET | PARTIAL | NOT_MET | OVERDUE_UNREPORTED | PENDING */
export function classifyPeriodForMetrics(goal, period, now = new Date()) {
  const reported = periodHasReport(period);
  const ended = isMetricsPeriodEnded(now, period.periodEnd);
  if (!reported && !ended) return 'PENDING';
  if (!reported && ended) return 'OVERDUE_UNREPORTED';

  if (goal.goalType === 'COMPLIANCE') {
    if (period.binaryResult === 'MET') return 'MET';
    if (period.binaryResult === 'NOT_MET') return 'NOT_MET';
    return ended ? 'OVERDUE_UNREPORTED' : 'PENDING';
  }

  const pct = completionPercentRaw(goal, period);
  if (pct == null) return ended ? 'OVERDUE_UNREPORTED' : 'PENDING';
  if (pct >= 100) return 'MET';
  if (pct > 0) return 'PARTIAL';
  return 'NOT_MET';
}

export function normalizePercentForKpi(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return 0;
  return Math.min(100, Math.max(0, Number(pct)));
}

export function roundMetricPercent(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return null;
  const n = Math.round(Number(pct) * 10) / 10;
  return Number.isFinite(n) ? n : null;
}

function emptySummary() {
  return {
    averageCompliance: null,
    evaluablePeriods: 0,
    reportedPeriods: 0,
    met: 0,
    partial: 0,
    notMet: 0,
    overdueUnreported: 0,
    pending: 0,
  };
}

/** Agregación de filas clasificadas (exportada para pruebas). */
export function summarizeClassifiedPeriodRows(rows) {
  const summary = emptySummary();
  let kpiSum = 0;
  let evaluable = 0;
  let reported = 0;

  for (const row of rows) {
    const st = row.status;
    if (st === 'PENDING') {
      summary.pending += 1;
      continue;
    }
    evaluable += 1;
    if (row.reported) reported += 1;
    if (st === 'MET') summary.met += 1;
    else if (st === 'PARTIAL') summary.partial += 1;
    else if (st === 'NOT_MET') summary.notMet += 1;
    else if (st === 'OVERDUE_UNREPORTED') summary.overdueUnreported += 1;

    const contrib = row.reported ? normalizePercentForKpi(row.completionRaw) : 0;
    kpiSum += Number.isFinite(contrib) ? contrib : 0;
  }

  summary.evaluablePeriods = evaluable;
  summary.reportedPeriods = reported;
  summary.averageCompliance =
    evaluable > 0 ? roundMetricPercent(kpiSum / evaluable) : null;
  return summary;
}

export function averageAchievementRawForRows(rows) {
  let rawSum = 0;
  let rawEval = 0;
  for (const r of rows) {
    if (r.status === 'PENDING') continue;
    rawEval += 1;
    if (r.reported && r.completionRaw != null && Number.isFinite(Number(r.completionRaw))) {
      rawSum += Number(r.completionRaw);
    }
  }
  return rawEval > 0 ? roundMetricPercent(rawSum / rawEval) : null;
}

function buildGoalBuckets(classifiedRows) {
  const byGoal = new Map();
  for (const row of classifiedRows) {
    let g = byGoal.get(row.goalId);
    if (!g) {
      g = {
        goalId: row.goalId,
        title: row.title,
        cadence: row.periodicity,
        goalType: row.goalType,
        targetValue: row.targetValue,
        unit: row.unit,
        rows: [],
      };
      byGoal.set(row.goalId, g);
    }
    g.rows.push(row);
  }

  const goals = [];
  for (const g of byGoal.values()) {
    const summary = summarizeClassifiedPeriodRows(g.rows);
    const averageAchievementRaw = averageAchievementRawForRows(g.rows);

    const points = g.rows
      .slice()
      .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())
      .map((r) => ({
        periodId: r.periodId,
        periodStart: ymdFromDateField(r.periodStart),
        periodEnd: ymdFromDateField(r.periodEnd),
        completionPercent: r.completionRaw != null ? roundMetricPercent(r.completionRaw) : null,
        displayPercent:
          r.status === 'PENDING'
            ? null
            : r.completionRaw != null
              ? roundMetricPercent(r.completionRaw)
              : 0,
        status: r.status,
      }));

    goals.push({
      goalId: g.goalId,
      title: g.title,
      cadence: g.cadence,
      goalType: g.goalType,
      targetValue: g.targetValue,
      unit: g.unit,
      averageCompliance: summary.averageCompliance,
      averageAchievementRaw,
      evaluablePeriods: summary.evaluablePeriods,
      met: summary.met,
      partial: summary.partial,
      notMet: summary.notMet,
      overdueUnreported: summary.overdueUnreported,
      pending: summary.pending,
      points,
    });
  }

  goals.sort((a, b) => {
    const avA = a.averageCompliance ?? 101;
    const avB = b.averageCompliance ?? 101;
    if (avA !== avB) return avA - avB;
    if (b.overdueUnreported !== a.overdueUnreported) return b.overdueUnreported - a.overdueUnreported;
    return String(a.title).localeCompare(String(b.title), 'es');
  });

  return goals;
}

/**
 * Consultas estimadas por solicitud (mes M + mes M-1 para comparación):
 * - 1× assertWorkforceEmployeeInOrg
 * - Mes actual del colaborador: 1× findMany metas activas + por cada meta activa ~2–3 queries en ensureWorkforceGoalPeriodsUpToDate
 * - Por cada mes consultado: 1× findMany periodos (take MAX+1) con include goal
 * Total típico mes histórico: ~3 queries. Mes actual con G metas activas: ~3 + G×(2–3).
 */
async function loadClassifiedPeriodsForMonth({
  organizationId,
  employeeId,
  monthYm,
  employee,
  now,
  materializeCurrentMonth,
}) {
  const tz = employee.timezone;
  const { start, endExclusive } = monthBoundsInTimeZone(monthYm, tz);

  if (materializeCurrentMonth) {
    const activeGoals = await prisma.workforceGoal.findMany({
      where: { organizationId, employeeId, archivedAt: null },
    });
    if (activeGoals.length > MAX_METRICS_ACTIVE_GOALS) {
      throw goalMetricsGoalLimitError();
    }
    for (const goal of activeGoals) {
      await ensureWorkforceGoalPeriodsUpToDate(goal, employee, now);
    }
  }

  const periods = await prisma.workforceGoalPeriod.findMany({
    where: {
      organizationId,
      employeeId,
      periodStart: { gte: start, lt: endExclusive },
    },
    include: {
      goal: {
        select: {
          id: true,
          title: true,
          goalType: true,
          periodicity: true,
          targetValue: true,
          unit: true,
          archivedAt: true,
        },
      },
    },
    orderBy: { periodStart: 'asc' },
    take: MAX_METRICS_PERIODS_PER_MONTH + 1,
  });

  assertMetricsPeriodVolume(periods.length);

  const classified = [];
  for (const period of periods) {
    const goal = period.goal;
    if (!goal) continue;
    try {
      const status = classifyPeriodForMetrics(goal, period, now);
      const reported = periodHasReport(period);
      const completionRaw = reported ? completionPercentRaw(goal, period) : null;
      classified.push({
        goalId: goal.id,
        title: goal.title,
        periodicity: goal.periodicity,
        goalType: goal.goalType,
        targetValue: goal.targetValue,
        unit: goal.unit,
        periodId: period.id,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        status,
        reported,
        completionRaw,
      });
    } catch {
      /* omit anómalo */
    }
  }
  return classified;
}

function buildComparison(currentSummary, previousSummary, previousMonthYm, timeZone) {
  const prevEval = previousSummary.evaluablePeriods;
  const curEval = currentSummary.evaluablePeriods;
  if (
    curEval === 0 ||
    currentSummary.averageCompliance == null ||
    prevEval === 0 ||
    previousSummary.averageCompliance == null
  ) {
    return {
      previousMonth: previousMonthYm,
      previousAverageCompliance: null,
      differencePoints: null,
      previousMonthLabel: previousMonthLabelEs(previousMonthYm, timeZone),
      hasPreviousData: false,
    };
  }
  const cur = currentSummary.averageCompliance;
  const prev = previousSummary.averageCompliance;
  const diff = roundMetricPercent(cur - prev);
  return {
    previousMonth: previousMonthYm,
    previousAverageCompliance: prev,
    differencePoints: diff,
    previousMonthLabel: previousMonthLabelEs(previousMonthYm, timeZone),
    hasPreviousData: true,
  };
}

export async function getWorkforceGoalMetricsForAdmin({ organizationId, employeeId, month }) {
  const monthYm = parseMetricsMonthParam(month);
  const employee = await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const tz = employee.timezone;
  const now = new Date();
  assertMetricsMonthNotFuture(monthYm, tz, now);

  const currentYm = currentMonthYmInTimeZone(now, tz);
  const materialize = monthYm === currentYm;

  const classified = await loadClassifiedPeriodsForMonth({
    organizationId,
    employeeId,
    monthYm,
    employee,
    now,
    materializeCurrentMonth: materialize,
  });

  const summary = summarizeClassifiedPeriodRows(classified);
  const goals = buildGoalBuckets(classified);

  const previousMonthYm = addMonthsYm(monthYm, -1);
  const prevClassified = await loadClassifiedPeriodsForMonth({
    organizationId,
    employeeId,
    monthYm: previousMonthYm,
    employee,
    now,
    materializeCurrentMonth: previousMonthYm === currentYm,
  });
  const previousSummary = summarizeClassifiedPeriodRows(prevClassified);
  const comparison = buildComparison(summary, previousSummary, previousMonthYm, tz);

  return {
    employee: { id: employee.id, timezone: tz },
    period: { month: monthYm, label: monthLabelEs(monthYm, tz) },
    summary,
    comparison,
    goals,
  };
}

/** Utilidad de prueba: límites de vencimiento con TZ IANA. */
export function periodEndForLocalDay(ymd, timeZone) {
  return endOfCalendarDayInTimeZone(ymd, timeZone);
}

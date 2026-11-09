import { prisma } from '../db/client.js';
import { assertWorkforceEmployeeInOrg } from './workforceEmployee.service.js';
import { utcRangeForLocalDateInclusive } from './remoteWorkSessionHistory.service.js';
import { buildWorkScheduleDto } from '../utils/workforceWorkSchedule.util.js';
import {
  assertPunctualityWeekKey,
  buildWeekPunctuality,
  resolvePunctualityWeek,
} from '../utils/workforcePunctuality.util.js';

export function rejectFuturePunctualityWeek(resolved) {
  if (!resolved?.future) return;
  const err = new Error('No puedes consultar una semana futura.');
  err.code = 'VALIDATION_ERROR';
  throw err;
}

/**
 * Mismo cálculo que la vista semanal, a partir del colaborador ya cargado.
 * No consulta la base: quien llama entrega las sesiones de esa semana.
 */
export function punctualityForWorkforceEmployee(emp, { weekKey, now = new Date(), sessions = [] } = {}) {
  const requested = assertPunctualityWeekKey(weekKey);
  const timeZone = emp.timezone;
  const resolved = resolvePunctualityWeek(requested, timeZone, now);
  rejectFuturePunctualityWeek(resolved);
  const schedule = buildWorkScheduleDto(emp);
  return buildWeekPunctuality({
    schedule,
    timeZone,
    weekStart: resolved.weekStart,
    now,
    sessions: schedule ? sessions : [],
  });
}

/**
 * Semana lunes–domingo en la zona del colaborador.
 * Una consulta de sesiones cuyo check-in cae en esa semana local. Sin N+1.
 */
export async function getEmployeeWeekPunctuality({
  organizationId,
  employeeId,
  weekKey,
  now = new Date(),
}) {
  const requested = assertPunctualityWeekKey(weekKey);
  const emp = await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const timeZone = emp.timezone;
  const resolved = resolvePunctualityWeek(requested, timeZone, now);
  rejectFuturePunctualityWeek(resolved);
  const schedule = buildWorkScheduleDto(emp);
  let sessions = [];
  if (schedule) {
    const range = utcRangeForLocalDateInclusive(resolved.weekStart, resolved.weekEnd, timeZone);
    sessions = await prisma.remoteWorkSession.findMany({
      where: {
        employeeId: emp.id,
        checkInAt: { gte: range.start, lt: range.end },
      },
      orderBy: { checkInAt: 'asc' },
      select: { id: true, checkInAt: true, checkOutAt: true },
    });
  }
  return punctualityForWorkforceEmployee(emp, { weekKey, now, sessions });
}

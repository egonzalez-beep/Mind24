import { prisma } from '../db/client.js';
import { assertWorkforceEmployeeInOrg } from './workforceEmployee.service.js';
import { utcRangeForLocalDateInclusive } from './remoteWorkSessionHistory.service.js';
import { buildWorkScheduleDto } from '../utils/workforceWorkSchedule.util.js';
import {
  assertPunctualityWeekKey,
  buildWeekPunctuality,
  resolvePunctualityWeek,
} from '../utils/workforcePunctuality.util.js';

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
  const { weekStart, weekEnd } = resolved;
  if (resolved.future) {
    const err = new Error('No puedes consultar una semana futura.');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const schedule = buildWorkScheduleDto(emp);
  let sessions = [];
  if (schedule) {
    const range = utcRangeForLocalDateInclusive(weekStart, weekEnd, timeZone);
    sessions = await prisma.remoteWorkSession.findMany({
      where: {
        employeeId: emp.id,
        checkInAt: { gte: range.start, lt: range.end },
      },
      orderBy: { checkInAt: 'asc' },
      select: { id: true, checkInAt: true, checkOutAt: true },
    });
  }
  return buildWeekPunctuality({
    schedule,
    timeZone,
    weekStart,
    now,
    sessions,
  });
}

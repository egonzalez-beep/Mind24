import assert from 'node:assert/strict';
import { calendarYmdInTimeZone } from '../src/utils/workforceDueDate.js';
import { dailyGoalAppliesOnWorkDate } from '../src/utils/workforceGoalPeriod.util.js';
import { encodeWeekdayMask } from '../src/utils/workforceWorkSchedule.util.js';

const timezone = 'America/Mexico_City';
const weekdays = encodeWeekdayMask([1, 2, 3, 4, 5]);
const sunday = encodeWeekdayMask([7]);
const employee = {
  id: 'employee-1',
  organizationId: 'org-1',
  isActive: true,
  timezone,
  dailyGoalWeekdayHistory: { '2026-11-21': weekdays, '2026-11-23': sunday, '2026-11-30': null },
};
assert.equal(dailyGoalAppliesOnWorkDate(employee, '2026-11-15'), true);
assert.equal(dailyGoalAppliesOnWorkDate(employee, '2026-11-22'), false);
assert.equal(dailyGoalAppliesOnWorkDate(employee, '2026-11-23'), false);
assert.equal(dailyGoalAppliesOnWorkDate(employee, '2026-11-29'), true);
assert.equal(dailyGoalAppliesOnWorkDate(employee, '2026-11-30'), true);

const periods = [];
const db = {
  workforceEmployee: {
    async findFirst() { return employee; },
    async findMany() { return [employee]; },
  },
  workforceGoal: {
    async create({ data }) { return { ...data, id: 'created-' + data.periodicity, createdAt: new Date(), updatedAt: new Date() }; },
  },
  workforceGoalPeriod: {
    async findFirst({ where }) { return periods.filter((row) => row.goalId === where.goalId).at(-1); },
    async createMany({ data, skipDuplicates }) {
      assert.equal(skipDuplicates, true);
      periods.push(...data);
    },
  },
  workforceWorkplaceInbox: { async upsert() {} },
  async $transaction(callback) { return callback(db); },
};
globalThis.prisma = db;
const { createWorkforceGoalForEmployee, ensureWorkforceGoalPeriodsUpToDate } = await import('../src/services/workforceGoal.service.js');
const { selectDailyReminderPlans, sweepDailyGoalReminders } = await import('../src/services/workforceDailyGoalsReminder.service.js');

const goal = {
  id: 'daily', organizationId: 'org-1', employeeId: employee.id, employee,
  goalType: 'COMPLIANCE', periodicity: 'DAILY', startDate: new Date('2026-11-20'), archivedAt: null,
};
const localDays = (goalId) => periods.filter((row) => row.goalId === goalId).map((row) => calendarYmdInTimeZone(row.periodStart, timezone));
await ensureWorkforceGoalPeriodsUpToDate(goal, employee, new Date('2026-11-29T05:59:59Z'));
assert.deepEqual(localDays('daily'), ['2026-11-20']);
await ensureWorkforceGoalPeriodsUpToDate(goal, employee, new Date('2026-11-30T05:59:59Z'));
await ensureWorkforceGoalPeriodsUpToDate(goal, employee, new Date('2026-11-30T05:59:59Z'));
assert.deepEqual(localDays('daily'), ['2026-11-20', '2026-11-29']);

const now = new Date('2026-11-22T17:30:00Z');
const pendingSunday = {
  periodStart: new Date('2026-11-22T06:00:00Z'),
  periodEnd: new Date('2026-11-23T05:59:59Z'),
};
const reminderInput = { now, goals: [goal], periodsByGoalId: new Map([[goal.id, pendingSunday]]) };
assert.equal(selectDailyReminderPlans(reminderInput).length, 0);
const result = await sweepDailyGoalReminders(now, { db });
assert.equal(result.planned, 0);
assert.equal(result.ensured, 0);
const sundayEmployee = { ...employee, dailyGoalWeekdayHistory: { '2026-11-21': sunday } };
assert.equal(selectDailyReminderPlans({ ...reminderInput, goals: [{ ...goal, employee: sundayEmployee }] }).length, 1);
assert.equal(selectDailyReminderPlans({ ...reminderInput, goals: [{ ...goal, employee: { ...employee, dailyGoalWeekdayHistory: {} } }] }).length, 1);

const realDate = globalThis.Date;
globalThis.Date = class extends realDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
};
try {
  const common = { organizationId: 'org-1', employeeId: employee.id, title: 'Meta', goalType: 'COMPLIANCE', startDate: '2026-11-21' };
  await createWorkforceGoalForEmployee({ ...common, periodicity: 'DAILY' });
  assert.deepEqual(localDays('created-DAILY'), []);
  await createWorkforceGoalForEmployee({ ...common, periodicity: 'WEEKLY' });
  assert.deepEqual(localDays('created-WEEKLY'), ['2026-11-16']);
  await createWorkforceGoalForEmployee({ ...common, periodicity: 'MONTHLY' });
  assert.deepEqual(localDays('created-MONTHLY'), ['2026-11-01']);
} finally {
  globalThis.Date = realDate;
}

console.log('Metas por jornada: altas, calendario local, historial y recordatorios OK.');

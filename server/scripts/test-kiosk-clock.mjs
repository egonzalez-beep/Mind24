import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prepareKioskWeekReport } from '../src/services/kioskClockReport.service.js';
import {
  createKioskEmployee, getKioskClock, getKioskDailyAttendance, identifyKioskEmployee, recordKioskPunch,
  updateKioskEmployee, updateKioskEmployeeSchedule,
} from '../src/services/kioskClock.service.js';

process.env.SESSION_SECRET = 'kiosk-test-secret';
const clocks = [
  { id: 'clock-a', organizationId: 'org-a', publicKey: 'Q'.repeat(32), timeZone: 'America/Mexico_City' },
  { id: 'clock-b', organizationId: 'org-b', publicKey: 'X'.repeat(32), timeZone: 'America/Mexico_City' },
];
const employees = [];
const records = [];
const schedules = [];

function uniqueEmployeeFields(data, ignoreId) {
  for (const field of ['code', 'punchKeyDigest']) {
    if (data[field] && employees.some((employee) =>
      employee.id !== ignoreId && employee.clockId === data.clockId && employee[field] === data[field])) {
      throw Object.assign(new Error('duplicate'), { code: 'P2002', meta: { target: ['clockId', field] } });
    }
  }
}

function punchFields(punch) {
  if (!punch) return null;
  const { ordinal, type, recordedAt } = punch;
  return { ordinal, type, recordedAt };
}

function matchingPunch({ where }) {
  return punchFields(records.filter((punch) => punch.employeeId === where.employeeId).at(-1));
}

const tx = {
  async $queryRaw(sql, id, organizationId) {
    assert.match(sql.join(''), /FOR UPDATE/);
    const employee = employees.find((item) => item.id === id);
    if (organizationId) {
      assert.match(sql.join(''), /clock\."organizationId"\s*=/);
      const clock = clocks.find((item) => item.id === employee?.clockId && item.organizationId === organizationId);
      return clock ? [{ timeZone: clock.timeZone }] : [];
    }
    return employee ? [{ punchKeyDigest: employee.punchKeyDigest, isActive: employee.isActive }] : [];
  },
  kioskEmployeeSchedule: {
    async findFirst({ where: { employeeId } }) {
      return schedules.filter((item) => item.employeeId === employeeId).sort((a, b) => b.effectiveOn - a.effectiveOn)[0];
    },
    async upsert({ where: { employeeId_effectiveOn: { employeeId, effectiveOn } }, create, update }) {
      const existing = schedules.find((item) => item.employeeId === employeeId && +item.effectiveOn === +effectiveOn);
      if (existing) return Object.assign(existing, update);
      schedules.push(create);
      return create;
    },
  },
  kioskPunch: {
    findFirst: matchingPunch,
    async findUnique({ where }) {
      const { employeeId, requestId } = where.employeeId_requestId;
      return punchFields(records.find((item) => item.employeeId === employeeId && item.requestId === requestId));
    },
    async create({ data }) {
      records.push(data);
      return punchFields(data);
    },
  },
};
let transactions = Promise.resolve();
const db = {
  kioskClock: {
    async findUnique({ where, select }) {
      const clock = clocks.find((item) => item.organizationId === where.organizationId);
      if (!clock || !select?.employees) return clock;
      const fields = select.employees.select;
      return {
        ...clock,
        employees: employees.filter((item) => item.clockId === clock.id).map((item) => ({
          ...Object.fromEntries(Object.keys(fields).map((key) => [key, item[key]])),
          punches: [],
          schedules: schedules.filter((row) => row.employeeId === item.id)
            .sort((a, b) => b.effectiveOn - a.effectiveOn).slice(0, fields.schedules.take),
        })),
      };
    },
  },
  kioskEmployee: {
    async create({ data: { schedules: scheduleWrite, ...data }, select }) {
      uniqueEmployeeFields(data);
      assert.match(data.punchKeyDigest, /^[a-f0-9]{64}$/);
      const employee = { ...data, id: randomUUID(), isActive: true };
      employees.push(employee);
      schedules.push({ employeeId: employee.id, ...scheduleWrite.create });
      return Object.fromEntries(Object.keys(select).map((field) => [field, employee[field]]));
    },
    async findFirst({ where }) {
      if (where.clock.publicKey) {
        assert.deepEqual(where.clock.organization, { blocked: false, empresaPortalEnabled: true });
      }
      for (const employee of employees) {
        const clock = clocks.find((item) => item.id === employee.clockId);
        if (where.id && employee.id !== where.id) continue;
        if (where.clock.organizationId && clock.organizationId !== where.clock.organizationId) continue;
        if (where.clock.publicKey && clock.publicKey !== where.clock.publicKey) continue;
        if (where.isActive && !employee.isActive) continue;
        if (where.punchKeyDigest && employee.punchKeyDigest !== where.punchKeyDigest) continue;
        return { ...employee, clock };
      }
      return null;
    },
    async updateMany({ where, data }) {
      const match = await this.findFirst({ where });
      if (!match || (where.OR && match.punchKeyDigest === data.punchKeyDigest)) return { count: 0 };
      uniqueEmployeeFields({ ...data, clockId: match.clockId }, match.id);
      Object.assign(employees.find((item) => item.id === match.id), data);
      return { count: 1 };
    },
  },
  kioskPunch: { findFirst: matchingPunch },
  $transaction(operation, options) {
    assert.equal(options.isolationLevel, 'ReadCommitted');
    const next = transactions.then(() => operation(tx));
    transactions = next.catch(() => {});
    return next;
  },
};

const keySequence = (...values) => (max) => {
  assert.equal(max, 1_000_000);
  assert(values.length > 0);
  return values.shift();
};
const workSchedule = { start: '22:00', end: '06:00', weekdays: [1, 2, 3, 4, 7], toleranceMinutes: 5 };
const person = { code: '0007', fullName: 'Persona de prueba', workSchedule };
const nov24 = () => new Date('2026-11-25T02:00:00Z');
const created = await createKioskEmployee('org-a', person, db, keySequence(1234), nov24);
assert.equal(created.punchKey, '001234');
assert.equal(created.employee.code, '0007');
assert(!('punchKeyDigest' in created.employee));
assert(!('punchKey' in employees[0]));
await assert.rejects(createKioskEmployee('org-a', person, db, keySequence(1299)), { code: 'CONFLICT' });
const other = await createKioskEmployee('org-a', { ...person, code: '0008' }, db, keySequence(1234, 5678));
assert.equal(other.punchKey, '005678');
const external = await createKioskEmployee('org-b', person, db, keySequence(1234));
assert.equal(external.punchKey, '001234');
assert.notEqual(employees[0].punchKeyDigest, employees[2].punchKeyDigest);
await assert.rejects(updateKioskEmployee('org-b', created.employee.id, { renewKey: true }, db), { code: 'NOT_FOUND' });

const publicKey = clocks[0].publicKey;
const initialKey = { publicKey, punchKey: created.punchKey };
assert.deepEqual((await identifyKioskEmployee(initialKey, db)).actions, ['CHECK_IN']);
const renewed = await updateKioskEmployee('org-a', created.employee.id, { renewKey: true }, db, keySequence(1234, 5678, 42));
assert.equal(renewed.punchKey, '000042');
await assert.rejects(identifyKioskEmployee(initialKey, db), { code: 'INVALID_CREDENTIALS' });
const credentials = { publicKey, punchKey: renewed.punchKey };

function request(type, revision) {
  return { ...credentials, type, revision, requestId: randomUUID() };
}

assert.deepEqual((await identifyKioskEmployee(credentials, db)).actions, ['CHECK_IN']);
await assert.rejects(identifyKioskEmployee({ ...credentials, punchKey: '901234' }, db), { code: 'INVALID_CREDENTIALS' });
await assert.rejects(identifyKioskEmployee({ ...credentials, publicKey: 'X'.repeat(32) }, db), { code: 'INVALID_CREDENTIALS' });
await assert.rejects(recordKioskPunch(request('CHECK_OUT', 0), db), { code: 'INVALID_STATE' });

const start = request('CHECK_IN', 0);
const beforeMidnight = () => new Date('2026-11-25T04:30:00Z');
const [entered, replayed] = await Promise.all([
  recordKioskPunch(start, db, beforeMidnight),
  recordKioskPunch(start, db, beforeMidnight),
]);
assert.deepEqual(entered, replayed);
assert.equal(records.length, 1);
assert.equal(entered.recordedAt.toISOString(), '2026-11-25T04:30:00.000Z');

const mealTime = () => new Date('2026-11-25T05:50:00Z');
const simultaneous = await Promise.allSettled([
  recordKioskPunch(request('MEAL_OUT', 1), db, mealTime),
  recordKioskPunch(request('MEAL_OUT', 1), db, mealTime),
]);
assert.equal(simultaneous.filter((out) => out.status === 'fulfilled').length, 1);
assert.equal(simultaneous.find((out) => out.status === 'rejected').reason.code, 'INVALID_STATE');
assert.equal(records.length, 2);

assert.deepEqual((await identifyKioskEmployee(credentials, db)).actions, ['MEAL_IN']);
await recordKioskPunch(request('MEAL_IN', 2), db, () => new Date('2026-11-25T06:20:00Z'));
await recordKioskPunch(request('CHECK_OUT', 3), db, () => new Date('2026-11-25T12:30:00Z'));
assert.deepEqual((await identifyKioskEmployee(credentials, db)).actions, ['CHECK_IN']);
assert.deepEqual(records.map(({ ordinal }) => ordinal), [1, 2, 3, 4]);

await recordKioskPunch(request('CHECK_IN', 4), db);
await recordKioskPunch(request('CHECK_OUT', 5), db);
assert.deepEqual((await identifyKioskEmployee(credentials, db)).actions, ['CHECK_IN']);
const renewBeforeLock = {
  ...db,
  async $transaction(operation, options) {
    await updateKioskEmployee('org-a', created.employee.id, { renewKey: true }, db, keySequence(43));
    return db.$transaction(operation, options);
  },
};
await assert.rejects(recordKioskPunch(request('CHECK_IN', 6), renewBeforeLock), { code: 'INVALID_CREDENTIALS' });
assert.equal(records.length, 6);
const currentCredentials = { publicKey, punchKey: '000043' };
assert.deepEqual((await identifyKioskEmployee(currentCredentials, db)).actions, ['CHECK_IN']);
await updateKioskEmployee('org-a', created.employee.id, { isActive: false }, db);
await assert.rejects(identifyKioskEmployee(currentCredentials, db), { code: 'INVALID_CREDENTIALS' });
console.log('Reloj checador: alta, colisiones, renovación, acceso, aislamiento, reintentos y jornada nocturna OK (base simulada).');

const currentSchedule = async (personId, now) => (
  await getKioskClock('org-a', db, now)
).employees.find((employee) => employee.id === personId);
const employeeId = created.employee.id;
const original = await currentSchedule(employeeId, nov24());
assert.deepEqual(original.workSchedule, {
  effectiveOn: '2026-11-24', startMinute: 1320, endMinute: 360,
  toleranceMinutes: 5, weekdays: [1, 2, 3, 4, 7], endsNextDay: true, weekendHours: {},
});
assert.equal(original.upcomingWorkSchedule, null);
await assert.rejects(createKioskEmployee('org-a', { ...person, workSchedule: null }, db), { code: 'VALIDATION_ERROR' });
for (const invalid of [
  { ...workSchedule, end: workSchedule.start },
  { ...workSchedule, end: '19:00' },
  { ...workSchedule, start: '24:00' },
  { ...workSchedule, toleranceMinutes: -1 },
  { ...workSchedule, weekdays: [1, 1] },
  { ...workSchedule, weekdays: [] },
  { ...workSchedule, weekendHours: { 1: { start: '08:00', end: '13:00' } } },
  { ...workSchedule, weekendHours: { 6: { start: '08:00', end: '13:00' } } },
  { ...workSchedule, weekendHours: { 7: { start: '08:00', end: '08:00' } } },
]) {
  await assert.rejects(updateKioskEmployeeSchedule('org-a', employeeId, invalid, db, nov24), { code: 'VALIDATION_ERROR' });
}
await assert.rejects(updateKioskEmployeeSchedule('org-b', employeeId, workSchedule, db, nov24), { code: 'NOT_FOUND' });
await updateKioskEmployeeSchedule('org-a', employeeId, workSchedule, db, nov24);
assert.equal(schedules.filter((row) => row.employeeId === employeeId).length, 1);
await Promise.all([
  updateKioskEmployeeSchedule('org-a', employeeId, { ...workSchedule, start: '21:00' }, db, nov24),
  updateKioskEmployeeSchedule('org-a', employeeId, { ...workSchedule, start: '20:00' }, db, nov24),
]);
const pending = await currentSchedule(employeeId, new Date('2026-11-25T05:59:59Z'));
assert.deepEqual(pending.workSchedule, original.workSchedule);
assert.equal(pending.upcomingWorkSchedule.effectiveOn, '2026-11-25');
assert.equal(pending.upcomingWorkSchedule.startMinute, 1200);
assert.equal(schedules.filter((row) => row.employeeId === employeeId).length, 2);
const applied = await currentSchedule(employeeId, new Date('2026-11-25T06:00:00Z'));
assert.deepEqual(applied.workSchedule, pending.upcomingWorkSchedule);
assert.equal(applied.upcomingWorkSchedule, null);

employees.push({ id: 'legacy', clockId: 'clock-a' });
assert.equal((await currentSchedule('legacy', nov24())).workSchedule, null);
await updateKioskEmployeeSchedule('org-a', 'legacy', workSchedule, db, nov24);
const legacy = await currentSchedule('legacy', nov24());
assert.equal(legacy.workSchedule, null);
assert.equal(legacy.upcomingWorkSchedule.effectiveOn, '2026-11-25');
console.log('Horario esperado: alta, vigencia local, turnos nocturnos, personal existente y edición concurrente OK (base simulada).');

const weekendSchedule = {
  ...workSchedule,
  weekdays: [1, 2, 3, 4, 6, 7],
  weekendHours: {
    6: { start: '08:00', end: '13:00' },
    7: { start: '21:00', end: '04:30' },
  },
};
const weekendEmployee = (await createKioskEmployee(
  'org-a', { ...person, code: '0012', workSchedule: weekendSchedule }, db, keySequence(7654), nov24,
)).employee;
const expectedWeekend = { 6: { startMinute: 480, endMinute: 780 }, 7: { startMinute: 1260, endMinute: 270 } };
assert.deepEqual((await currentSchedule(weekendEmployee.id, nov24())).workSchedule.weekendHours, expectedWeekend);
await updateKioskEmployeeSchedule('org-a', weekendEmployee.id, weekendSchedule, db, nov24);
assert.equal((await currentSchedule(weekendEmployee.id, nov24())).upcomingWorkSchedule, null);
const { weekendHours: _weekendHours, ...oldClientSchedule } = weekendSchedule;
const compatibleEdit = await updateKioskEmployeeSchedule(
  'org-a', weekendEmployee.id, { ...oldClientSchedule, weekdays: [1, 2, 3, 4, 7] }, db, nov24,
);
assert.deepEqual(compatibleEdit.workSchedule.weekendHours, { 7: expectedWeekend[7] });
await updateKioskEmployeeSchedule('org-a', weekendEmployee.id, { ...weekendSchedule, weekendHours: {} }, db, nov24);
const editedWeekend = await currentSchedule(weekendEmployee.id, nov24());
assert.deepEqual(editedWeekend.workSchedule.weekendHours, expectedWeekend);
assert.deepEqual(editedWeekend.upcomingWorkSchedule.weekendHours, {});
console.log('Horario de fin de semana: sábado, domingo nocturno, días de descanso, edición e historial OK (base simulada).');

const dailyRoster = [
  { id: created.employee.id, code: created.employee.code, fullName: 'Turno nocturno', isActive: false, schedules: [] },
  { id: 'another', code: '0008', fullName: 'Sin checadas', isActive: true, schedules: [] },
  { id: 'disabled', code: '0009', fullName: 'Inactivo sin checadas', isActive: false, schedules: [] },
];
const morning = new Date('2026-11-25T15:00:00Z');
const dailyRecords = records.slice(0, 4);
const dailyDb = {
  kioskClock: { findUnique: db.kioskClock.findUnique },
  kioskEmployee: {
    async findMany({ where, select }) {
      assert.equal(where.clockId, 'clock-a');
      const { gte: start, lt: end, lte: now } = select.punches.where.recordedAt;
      const lastEffective = select.schedules.where.effectiveOn.lte;
      assert.ok(where.createdAt.lt <= end);
      return dailyRoster.filter((employee) => !employee.createdAt || employee.createdAt < where.createdAt.lt).map((employee) => ({
        ...employee,
        schedules: employee.schedules.filter((row) => row.effectiveOn <= lastEffective)
          .sort((a, b) => b.effectiveOn - a.effectiveOn).slice(0, select.schedules.take),
        punches: dailyRecords.filter((punch) =>
          punch.employeeId === employee.id && punch.recordedAt >= start && punch.recordedAt < end && punch.recordedAt <= now,
        ).map(punchFields),
      }));
    },
  },
  async $queryRaw(sql, start, clockId) {
    assert.match(sql.join(''), /JOIN LATERAL/);
    assert.equal(clockId, 'clock-a');
    return dailyRoster.flatMap((employee) => {
      const last = dailyRecords.filter((punch) => punch.employeeId === employee.id && punch.recordedAt < start).at(-1);
      return last && last.type !== 'CHECK_OUT' ? [{ id: employee.id, type: last.type }] : [];
    });
  },
};
const yesterday = await getKioskDailyAttendance('org-a', '2026-11-24', dailyDb, morning);
assert.equal(yesterday.date, '2026-11-24');
assert.equal(yesterday.today, '2026-11-25');
assert.deepEqual(yesterday.people.map(({ status }) => status), ['MEAL', 'NO_PUNCHES']);
assert.equal(yesterday.people[0].carriedIn, false);
assert.deepEqual(yesterday.people[0].punches.map(({ type }) => type), ['CHECK_IN', 'MEAL_OUT']);
const today = await getKioskDailyAttendance('org-a', undefined, dailyDb, morning);
assert.equal(today.date, '2026-11-25');
assert.equal(today.people[0].carriedIn, true);
assert.equal(today.people[0].status, 'OUT');
assert.deepEqual(today.people[0].punches.map(({ type }) => type), ['MEAL_IN', 'CHECK_OUT']);
await assert.rejects(getKioskDailyAttendance('org-a', '2026-11-26', dailyDb, morning), { code: 'VALIDATION_ERROR' });
await assert.rejects(getKioskDailyAttendance('org-a', '2026-02-31', dailyDb, morning), { code: 'VALIDATION_ERROR' });
await assert.rejects(getKioskDailyAttendance('unknown', undefined, dailyDb, morning), { code: 'NOT_FOUND' });
console.log('Asistencia diaria: cambio de día local, turno abierto al cierre, histórico de inactivos y fechas inválidas OK (base simulada).');

const rosterDay = (id, versions, createdAt = '2026-11-01T15:00:00Z') =>
  dailyRoster.push({ id, code: id, fullName: id, isActive: true, createdAt: new Date(createdAt), schedules: versions });
const daySchedule = {
  effectiveOn: new Date('2026-11-01'), startMinute: 480, endMinute: 1020,
  toleranceMinutes: 10, weekdayMask: 31, weekendHours: {},
};
const nightSchedule = { ...daySchedule, startMinute: 1320, endMinute: 360, weekdayMask: 127 };
rosterDay('on-time', [daySchedule]);
rosterDay('early-exit', [daySchedule]);
rosterDay('late', [daySchedule, { ...daySchedule, effectiveOn: new Date('2026-11-26'), startMinute: 540 }]);
rosterDay('absent', [daySchedule]);
rosterDay('no-schedule', []);
rosterDay('upcoming-schedule', [{ ...daySchedule, effectiveOn: new Date('2026-11-25') }]);
rosterDay('new-employee', [daySchedule], '2026-11-24T15:00:00Z');
rosterDay('night', [nightSchedule]);
rosterDay('late-night-entry', [nightSchedule]);
rosterDay('weekend', [{ ...daySchedule, weekdayMask: 63, weekendHours: { 6: { startMinute: 480, endMinute: 780 } } }]);
function attendancePunches(id, events) {
  for (const [index, [type, time]] of events.entries()) {
    dailyRecords.push({ employeeId: id, type, recordedAt: new Date(time), ordinal: index + 1 });
  }
}
attendancePunches('on-time', [
  ['CHECK_IN', '2026-11-24T14:10:00.000Z'], ['CHECK_OUT', '2026-11-24T23:00:00Z'],
]);
attendancePunches('early-exit', [
  ['CHECK_IN', '2026-11-24T14:00:00.000Z'], ['CHECK_OUT', '2026-11-24T22:50:00Z'],
]);
attendancePunches('late', [
  ['CHECK_IN', '2026-11-24T14:10:00.001Z'], ['MEAL_OUT', '2026-11-24T20:00:00Z'],
]);
attendancePunches('night', [
  ['CHECK_IN', '2026-11-25T04:00:00Z'], ['MEAL_OUT', '2026-11-25T05:00:00Z'],
  ['MEAL_IN', '2026-11-25T06:00:00Z'], ['CHECK_OUT', '2026-11-25T12:08:00Z'],
  ['CHECK_IN', '2026-11-26T04:00:00Z'], ['CHECK_OUT', '2026-11-26T12:00:00Z'],
]);
attendancePunches('late-night-entry', [
  ['CHECK_IN', '2026-11-25T07:00:00Z'], ['CHECK_OUT', '2026-11-25T12:00:00Z'],
]);
const findDay = (result, id) => result.people.find((entry) => entry.id === id);
const dayBeforeEnd = await getKioskDailyAttendance('org-a', '2026-11-24', dailyDb, new Date('2026-11-24T22:59:59Z'));
assert.deepEqual(findDay(dayBeforeEnd, 'absent').attendance.flags, []);
assert.deepEqual(findDay(dayBeforeEnd, 'late').attendance.flags, ['LATE']);
assert.equal(findDay(dayBeforeEnd, 'late').attendance.lateMinutes, 0);
const overnightStillOpen = await getKioskDailyAttendance('org-a', '2026-11-24', dailyDb, new Date('2026-11-25T06:30:00Z'));
assert.deepEqual(findDay(overnightStillOpen, 'night').attendance.flags, ['ON_TIME']);
const done = await getKioskDailyAttendance('org-a', '2026-11-24', dailyDb, new Date('2026-11-26T16:00:00Z'));
assert.deepEqual(findDay(done, 'on-time').attendance.flags, ['ON_TIME', 'COMPLETED']);
assert.deepEqual(findDay(done, 'early-exit').attendance.flags, ['ON_TIME']);
assert.deepEqual(findDay(done, 'late').attendance.flags, ['LATE', 'INCOMPLETE']);
assert.deepEqual(findDay(done, 'absent').attendance.flags, ['ABSENT']);
assert.equal(findDay(done, 'no-schedule').attendance.kind, 'UNSCHEDULED');
assert.equal(findDay(done, 'no-schedule').attendance.scheduleStartsOn, undefined);
assert.equal(findDay(done, 'upcoming-schedule').attendance.kind, 'UNSCHEDULED');
assert.equal(findDay(done, 'upcoming-schedule').attendance.scheduleStartsOn, '2026-11-25');
assert.deepEqual(findDay(done, 'upcoming-schedule').attendance.flags, []);
assert.equal(findDay(done, 'new-employee').attendance.kind, 'BEFORE_ENROLLMENT');
assert.deepEqual(findDay(done, 'night').attendance.flags, ['ON_TIME', 'COMPLETED', 'LATE_EXIT']);
assert.deepEqual(findDay(done, 'night').attendance.punches.map(({ ordinal }) => ordinal), [1, 2, 3, 4]);
assert.deepEqual(findDay(done, 'late-night-entry').attendance.flags, ['LATE']);
assert.equal(findDay(done, 'late-night-entry').attendance.lateMinutes, 170);
const following = await getKioskDailyAttendance('org-a', '2026-11-25', dailyDb, new Date('2026-11-26T16:00:00Z'));
assert.equal(findDay(following, 'upcoming-schedule').attendance.kind, 'PLANNED');
assert.deepEqual(findDay(following, 'upcoming-schedule').attendance.flags, ['ABSENT']);
assert.deepEqual(findDay(following, 'night').attendance.punches.map(({ ordinal }) => ordinal), [5, 6]);
assert.deepEqual(findDay(following, 'late-night-entry').attendance.punches, []);
const saturday = await getKioskDailyAttendance('org-a', '2026-11-28', dailyDb, new Date('2026-11-28T19:00:00Z'));
assert.equal(findDay(saturday, 'weekend').attendance.endAt.toISOString(), '2026-11-28T19:00:00.000Z');
assert.deepEqual(findDay(saturday, 'weekend').attendance.flags, ['ABSENT']);
const sunday = await getKioskDailyAttendance('org-a', '2026-11-29', dailyDb, new Date('2026-11-29T19:00:00Z'));
assert.equal(findDay(sunday, 'weekend').attendance.kind, 'REST');
assert.deepEqual(findDay(sunday, 'weekend').attendance.flags, []);
console.log('Incidencias: tolerancia exacta, alta, descanso, horario histórico, sábado especial y turnos nocturnos OK.');

const reportNow = new Date('2026-03-10T12:00:00Z');
const reportDaySchedule = { ...daySchedule, effectiveOn: new Date('2026-03-01'), weekdayMask: 65 };
const reportPunches = (...events) => events.map(([type, recordedAt], index) => ({
  type, recordedAt: new Date(recordedAt), ordinal: index + 1,
}));
let reportEmployees = [{
  fullName: 'Ana <Prueba>', code: '0001', isActive: false, createdAt: new Date('2026-03-01T12:00:00Z'), schedules: [],
  punches: reportPunches(['CHECK_IN', '2026-03-08T06:50:00Z'], ['CHECK_OUT', '2026-03-08T07:10:00Z']),
}, {
  fullName: 'Carlos fin de semana', code: '0002', isActive: true, createdAt: new Date('2026-03-07T14:00:00Z'),
  schedules: [{ ...reportDaySchedule, startMinute: 1320, endMinute: 360, weekdayMask: 64 }],
  punches: reportPunches(['CHECK_IN', '2026-03-09T02:00:00Z'], ['CHECK_OUT', '2026-03-09T10:07:00Z']),
}, {
  fullName: 'Daniela comida', code: '0003', isActive: true, createdAt: new Date('2026-03-01T12:00:00Z'),
  schedules: [reportDaySchedule],
  punches: reportPunches(
    ['CHECK_IN', '2026-03-02T13:00:00Z'], ['MEAL_OUT', '2026-03-02T18:00:00Z'],
    ['MEAL_IN', '2026-03-02T18:30:00Z'], ['CHECK_OUT', '2026-03-02T22:00:00Z'],
  ),
}];
const reportDb = {
  kioskClock: {
    async findUnique({ where }) {
      return where.organizationId === 'org-report'
        ? { id: 'clock-report', timeZone: 'America/New_York', organization: { name: 'Empresa & equipo' } }
        : null;
    },
  },
  kioskEmployee: {
    async findMany({ where, select }) {
      assert.equal(where.clockId, 'clock-report');
      const { gte, lt, lte } = select.punches.where.recordedAt;
      assert.deepEqual(Object.keys(select.punches.select), ['type', 'recordedAt', 'ordinal', 'originalRecordedAt', 'isManual']);
      assert.deepEqual(Object.keys(select.attendanceAdjustments.select), ['date', 'incident']);
      assert.equal(select.punchKeyDigest, undefined);
      return reportEmployees.map((employee) => ({
        ...employee,
        punches: employee.punches.filter(({ recordedAt }) => recordedAt >= gte && recordedAt < lt && recordedAt <= lte),
      }));
    },
  },
};
const report = await prepareKioskWeekReport('org-report', '2026-03-08', reportDb, reportNow);
assert.equal(report.filename, 'mind24-checadas-2026-03-02.pdf');
assert.match(report.html, /Empresa &amp; equipo/);
assert.match(report.html, /Ana &lt;Prueba&gt;/);
assert.match(report.html, /01:50:00 GMT-5/);
assert.match(report.html, /03:10:00 GMT-4/);
assert.match(report.html, /Entrada real/);
assert.match(report.html, /06:07:00 GMT-4 \(\+1 día\)/);
assert.match(report.html, /Salida a comida/);
assert.match(report.html, /Regreso de comida/);
assert.match(report.html, /Jornada cumplida/);
assert.match(report.html, /Falta/);
assert.match(report.html, /8 h 30 min/);
assert.deepEqual(report.summary, { collaborators: 3, punctualityPct: 75, expectedCoveragePct: 75, lateDays: 0 });
const nextReport = await prepareKioskWeekReport('org-report', '2026-03-09', reportDb, reportNow);
assert.doesNotMatch(nextReport.html, /06:07:00/);
assert.doesNotMatch(report.html, /punchKey|publicKey/);
reportEmployees = [];
const emptyReport = await prepareKioskWeekReport('org-report', '2026-03-02', reportDb, reportNow);
assert.match(emptyReport.html, /No hay colaboradores para esta semana/);
await assert.rejects(prepareKioskWeekReport('org-report', '2026-02-31', reportDb, reportNow), { code: 'VALIDATION_ERROR' });
await assert.rejects(prepareKioskWeekReport('org-report', '2026-03-16', reportDb, reportNow), { code: 'VALIDATION_ERROR' });
await assert.rejects(prepareKioskWeekReport('other-org', '2026-03-02', reportDb, reportNow), { code: 'NOT_FOUND' });
console.log('Exportación semanal: organización, horario de verano, cierre nocturno sin duplicar, comida, indicadores, escape y semana vacía OK (base simulada).');

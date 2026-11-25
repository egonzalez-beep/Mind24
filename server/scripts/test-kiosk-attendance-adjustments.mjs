import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { getKioskDailyAttendance, identifyKioskEmployee, recordKioskPunch } from '../src/services/kioskClock.service.js';
import { saveKioskAttendanceAdjustment } from '../src/services/kioskAttendanceAdjustment.service.js';
import { prepareKioskWeekReport } from '../src/services/kioskClockReport.service.js';
import { kioskComparePunches } from '../src/utils/kioskAttendance.util.js';

process.env.SESSION_SECRET = 'fixture';
const publicKey = 'X'.repeat(32);
const punchKey = '000123';
const employeeId = 'person';
const admin = { id: 'admin', fullName: 'Administradora Prueba', organizationId: 'org' };
const kioskClock = { id: 'clock', organizationId: 'org', publicKey, timeZone: 'America/Mexico_City', organization: { name: 'Empresa' } };
const employee = {
  id: employeeId, clockId: kioskClock.id, fullName: 'Colaborador de prueba', code: '001',
  isActive: true, createdAt: new Date('2026-11-01T12:00:00Z'),
  punchKeyDigest: createHmac('sha256', 'fixture').update(`kiosk-punch-key:v1:${publicKey}:${punchKey}`).digest('hex'),
  clock: kioskClock,
  schedules: [{ effectiveOn: new Date('2026-11-01'), weekdayMask: 31, startMinute: 480, endMinute: 1020, toleranceMinutes: 10 }],
};

const records = [{
  employeeId, ordinal: 1, type: 'CHECK_IN', recordedAt: new Date('2026-11-24T14:00:00Z'), requestId: randomUUID(),
}];
const history = [];
const byTime = (items) => [...items].sort(kioskComparePunches);
const compare = (value, bounds = {}) =>
  (bounds.gte == null || value >= bounds.gte) && (bounds.gt == null || value > bounds.gt) &&
  (bounds.lt == null || value < bounds.lt) && (bounds.lte == null || value <= bounds.lte);
const project = (row, select) => row && Object.fromEntries(Object.keys(select).map(key => [key, row[key]]));
let transaction = Promise.resolve();
const db = {
  kioskClock: { findUnique: async ({ where }) => where.organizationId === 'org' ? kioskClock : null },
  kioskEmployee: {
    findFirst: async ({ where }) => employee.punchKeyDigest === where.punchKeyDigest && where.clock.publicKey === publicKey ? employee : null,
    findMany: async ({ where, select }) => {
      if (where.id && where.id !== employeeId) return [];
      return [{
        ...project(employee, select),
        punches: byTime(records.filter(row => compare(row.recordedAt, select.punches.where.recordedAt)))
          .map(row => project(row, select.punches.select)),
        attendanceAdjustments: history.filter(item => {
          const filters = select.attendanceAdjustments.where;
          const same = filters.date instanceof Date ? +item.date === +filters.date : compare(item.date, filters.date);
          return same && compare(item.createdAt, filters.createdAt) && (!filters.action || item.action === filters.action);
        }).map(row => project(row, select.attendanceAdjustments.select)),
      }];
    },
  },
  kioskPunch: {
    findFirst: async ({ where, select, orderBy }) => {
      const matching = records.filter(row => compare(row.recordedAt, where.recordedAt));
      const ordered = Array.isArray(orderBy) ? byTime(matching) : [...matching].sort((a, b) => a.ordinal - b.ordinal);
      return project(orderBy[0]?.recordedAt === 'asc' ? ordered[0] : ordered.at(-1), select);
    },
    findMany: async ({ where, select }) => records.filter(row => compare(row.recordedAt, where.recordedAt)).map(row => project(row, select)),
    findUnique: async ({ where, select }) => project(records.find(row => row.requestId === where.employeeId_requestId.requestId), select),
    create: async ({ data, select }) => {
      records.push(data);
      return project(data, select);
    },
    createMany: async ({ data }) => records.push(...data),
    update: async ({ where, data }) => Object.assign(records.find(row => row.ordinal === where.employeeId_ordinal.ordinal), data),
  },
  kioskAttendanceAdjustment: {
    findUnique: async ({ where, select }) => project(history.find(item => item.requestId === where.employeeId_requestId.requestId), select),
    create: async ({ data, select }) => {
      const entry = { id: String(history.length + 1), ...data };
      history.push(entry);
      return project(entry, select);
    },
  },
  async $queryRaw(strings, first, second) {
    const sql = strings.join('');
    if (sql.includes('FOR UPDATE OF employee')) return first === employeeId && second === 'org' ? [{ createdAt: employee.createdAt, timeZone: kioskClock.timeZone }] : [];
    if (sql.includes('FOR UPDATE')) return [employee];
    const previous = byTime(records.filter(row => row.recordedAt < first)).at(-1);
    return previous && previous.type !== 'CHECK_OUT' ? [{ id: employeeId, type: previous.type }] : [];
  },
  $transaction(work) {
    const next = transaction.then(async () => {
      const snapshot = structuredClone(records);
      const previousSize = history.length;
      try { return await work(db); }
      catch (error) {
        records.splice(0, records.length, ...snapshot);
        history.length = previousSize;
        throw error;
      }
    });
    transaction = next.catch(() => {});
    return next;
  },
};

const now = () => new Date('2026-11-25T22:00:00Z');
const credentials = { publicKey, punchKey };
const time = (type, value) => ({ type, time: value, nextDay: false });
const input = (date, action, params) => ({ requestId: randomUUID(), date, action, reason: 'Motivo de prueba privado', ...params });
const save = (data) => saveKioskAttendanceAdjustment(admin, employeeId, data, db, now);
const today = () => getKioskDailyAttendance('org', '2026-11-25', db, now()).then(({ people }) => people[0]);

assert.deepEqual((await identifyKioskEmployee(credentials, db)).actions, ['MEAL_OUT', 'CHECK_OUT']);
const missingExit = input('2026-11-24', 'ADD_PUNCH', { events: [time('CHECK_OUT', '17:00')] });
await assert.rejects(saveKioskAttendanceAdjustment({ ...admin, organizationId: 'otra' }, employeeId, missingExit, db, now), { code: 'NOT_FOUND' });
const [saveOne, retry] = await Promise.all([save(missingExit), save(missingExit)]);
assert.deepEqual(saveOne, retry);
assert.equal(records.length, 2);
assert.equal(history.length, 1);
assert.equal(records[1].isManual, true);
assert.deepEqual((await identifyKioskEmployee(credentials, db)).actions, ['CHECK_IN']);
const swipe = { ...credentials, revision: 2, type: 'CHECK_IN', requestId: randomUUID() };
const original = await recordKioskPunch(swipe, db, () => new Date('2026-11-25T14:15:00Z'));
const justification = input('2026-11-25', 'JUSTIFY', { incident: 'LATE' });
await save(justification);
await assert.rejects(save({ ...justification, requestId: randomUUID() }), { code: 'CONFLICT' });
assert.deepEqual((await today()).attendance.flags, ['LATE']);
assert.match((await prepareKioskWeekReport('org', '2026-11-23', db, now())).html, /Retardo justificado/);

const historicalPair = input('2026-11-23', 'ADD_PUNCH', { events: [time('CHECK_IN', '08:00'), time('CHECK_OUT', '17:00')] });
await save(historicalPair);
const kioskState = await identifyKioskEmployee(credentials, db);
assert.equal(kioskState.revision, 5);
assert.deepEqual(kioskState.actions, ['MEAL_OUT', 'CHECK_OUT']);
await assert.rejects(recordKioskPunch({ ...credentials, revision: 3, type: 'CHECK_OUT', requestId: randomUUID() }, db, now), { code: 'INVALID_STATE' });

const correction = input('2026-11-25', 'EDIT_PUNCH', {
  ordinal: original.ordinal, previousAt: original.recordedAt.toISOString(), time: '08:05', nextDay: false,
});
await save(correction);
const corrected = await today();
assert.deepEqual(corrected.attendance.flags, ['ON_TIME']);
assert.equal(corrected.attendance.punches[0].recordedAt.toISOString(), '2026-11-25T14:05:00.000Z');
assert.equal(corrected.attendance.punches[0].originalRecordedAt.toISOString(), correction.previousAt);
assert.equal(corrected.adjustments.at(-1).actorName, admin.fullName);
assert.deepEqual(await recordKioskPunch(swipe, db, now), original);
await assert.rejects(save({ ...correction, requestId: randomUUID() }), { code: 'CONFLICT' });
await assert.rejects(save(input('2026-11-25', 'ADD_PUNCH', { events: [time('CHECK_IN', '09:00')] })), { code: 'CONFLICT' });
await assert.rejects(save(input('2026-11-25', 'ADD_PUNCH', { events: [time('CHECK_OUT', '17:00')] })), { code: 'VALIDATION_ERROR' });
const manualExit = records.find(row => row.isManual && row.type === 'CHECK_OUT');
await save(input('2026-11-24', 'EDIT_PUNCH', {
  ordinal: manualExit.ordinal, previousAt: manualExit.recordedAt.toISOString(), time: '16:55', nextDay: false,
}));
const report = await prepareKioskWeekReport('org', '2026-11-23', db, now());
assert.match(report.html, /\(manual\)/);
assert.match(report.html, /\(corregida\)/);
assert.match(report.html, /\(manual\) \(corregida\)/);
assert.doesNotMatch(report.html, /Motivo de prueba privado/);
console.log('Incidencias: autorización, reintentos, salida omitida, secuencia cronológica, hora original, justificación y PDF OK (base simulada).');

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createKioskEmployee, identifyKioskEmployee, recordKioskPunch, updateKioskEmployee,
} from '../src/services/kioskClock.service.js';

process.env.SESSION_SECRET = 'kiosk-test-secret';
const clocks = [
  { id: 'clock-a', organizationId: 'org-a', publicKey: 'Q'.repeat(32), timeZone: 'America/Mexico_City' },
  { id: 'clock-b', organizationId: 'org-b', publicKey: 'X'.repeat(32), timeZone: 'America/Mexico_City' },
];
const employees = [];
const records = [];

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
  async $queryRaw(sql, id) {
    assert.match(sql.join(''), /FOR UPDATE/);
    const employee = employees.find((item) => item.id === id);
    return employee ? [{ punchKeyDigest: employee.punchKeyDigest, isActive: employee.isActive }] : [];
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
    async findUnique({ where }) {
      return clocks.find((clock) => clock.organizationId === where.organizationId);
    },
  },
  kioskEmployee: {
    async create({ data, select }) {
      uniqueEmployeeFields(data);
      assert.match(data.punchKeyDigest, /^[a-f0-9]{64}$/);
      const employee = { ...data, id: randomUUID(), isActive: true };
      employees.push(employee);
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
const person = { code: '0007', fullName: 'Persona de prueba' };
const created = await createKioskEmployee('org-a', person, db, keySequence(1234));
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

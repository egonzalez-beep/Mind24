import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { prisma } from '../db/client.js';
import { resolveOrganizationIanaTimezone } from './organizationTimezone.service.js';
import { localDateKey, utcRangeForLocalDateInclusive } from './remoteWorkSessionHistory.service.js';

export const KIOSK_PUNCH_TYPES = ['CHECK_IN', 'MEAL_OUT', 'MEAL_IN', 'CHECK_OUT'];
const NEXT_PUNCH = {
  CHECK_IN: ['MEAL_OUT', 'CHECK_OUT'],
  MEAL_OUT: ['MEAL_IN'],
  MEAL_IN: ['CHECK_OUT'],
  CHECK_OUT: ['CHECK_IN'],
};
const punchFields = { type: true, recordedAt: true, ordinal: true };
const employeeFields = { id: true, code: true, fullName: true, isActive: true };

function kioskError(code, message) {
  return Object.assign(new Error(message), { code });
}

function invalidCredentials() {
  return kioskError('INVALID_CREDENTIALS', 'No pudimos validar la clave de checada.');
}

function punchKeyDigest(publicKey, punchKey) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET es obligatorio para el reloj checador.');
  return createHmac('sha256', secret).update(`kiosk-punch-key:v1:${publicKey}:${punchKey}`).digest('hex');
}

async function issuePunchKey(publicKey, save, nextKey = randomInt) {
  for (let attempt = 0; attempt < 32; attempt++) {
    const punchKey = String(nextKey(1_000_000)).padStart(6, '0');
    try {
      const result = await save(punchKeyDigest(publicKey, punchKey));
      if (result) return { ...result, punchKey };
    } catch (error) {
      if (error.code !== 'P2002' || !error.meta?.target?.includes('punchKeyDigest')) throw error;
    }
  }
  throw kioskError('CONFLICT', 'No se pudo asignar una clave. Intenta de nuevo.');
}

export async function getKioskClock(organizationId) {
  const clock = await prisma.kioskClock.findUnique({
    where: { organizationId },
    select: {
      publicKey: true,
      timeZone: true,
      employees: {
        orderBy: [{ fullName: 'asc' }, { code: 'asc' }],
        select: {
          ...employeeFields,
          punches: { select: punchFields, orderBy: { ordinal: 'desc' }, take: 1 },
        },
      },
    },
  });
  if (!clock) return null;
  return {
    ...clock,
    employees: clock.employees.map(({ punches, ...employee }) => ({
      ...employee,
      lastPunch: punches[0] ?? null,
    })),
  };
}

export async function getKioskDailyAttendance(organizationId, requestedDay, db = prisma, now = new Date()) {
  const clock = await db.kioskClock.findUnique({
    where: { organizationId },
    select: { id: true, timeZone: true },
  });
  if (!clock) throw kioskError('NOT_FOUND', 'Activa primero el reloj checador.');

  const today = localDateKey(now, clock.timeZone);
  const date = requestedDay ?? today;
  const dateCheck = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(dateCheck.valueOf()) ||
      dateCheck.toISOString().slice(0, 10) !== date || date > today || date < '1900-01-01') {
    throw kioskError('VALIDATION_ERROR', 'Elige una fecha válida hasta hoy.');
  }
  const { start, end } = utcRangeForLocalDateInclusive(date, date, clock.timeZone);
  const [employees, previous] = await Promise.all([
    db.kioskEmployee.findMany({
      where: { clockId: clock.id, createdAt: { lt: end } },
      orderBy: [{ fullName: 'asc' }, { code: 'asc' }],
      select: {
        ...employeeFields,
        punches: {
          where: { recordedAt: { gte: start, lt: end } },
          orderBy: { ordinal: 'asc' },
          select: punchFields,
        },
      },
    }),
    db.$queryRaw`
      SELECT employee."id", previous."type"::text AS "type"
      FROM "KioskEmployee" employee
      JOIN LATERAL (
        SELECT "type" FROM "KioskPunch"
        WHERE "employeeId" = employee."id" AND "recordedAt" < ${start}
        ORDER BY "ordinal" DESC
        LIMIT 1
      ) previous ON previous."type" <> 'CHECK_OUT'
      WHERE employee."clockId" = ${clock.id}
    `,
  ]);
  const priorByEmployee = new Map(previous.map(({ id, type }) => [id, type]));
  const people = employees.flatMap(({ punches, ...person }) => {
    const priorType = priorByEmployee.get(person.id);
    if (!person.isActive && !priorType && !punches.length) return [];
    const lastType = punches.at(-1)?.type ?? priorType;
    const status = lastType === 'CHECK_OUT' ? 'OUT' : lastType === 'MEAL_OUT' ? 'MEAL' : lastType ? 'IN' : 'NO_PUNCHES';
    return [{ ...person, status, carriedIn: Boolean(priorType), punches }];
  });
  return { date, today, timeZone: clock.timeZone, people };
}

export async function activateKioskClock(organizationId) {
  const timeZone = await resolveOrganizationIanaTimezone(organizationId);
  await prisma.kioskClock.createMany({
    data: [{ organizationId, timeZone, publicKey: randomBytes(24).toString('base64url') }],
    skipDuplicates: true,
  });
  return getKioskClock(organizationId);
}

export async function createKioskEmployee(organizationId, { code, fullName }, db = prisma, nextKey = randomInt) {
  const clock = await db.kioskClock.findUnique({ where: { organizationId }, select: { id: true, publicKey: true } });
  if (!clock) throw kioskError('NOT_FOUND', 'Activa primero el reloj checador.');
  try {
    return await issuePunchKey(clock.publicKey, async (digest) => {
      const employee = await db.kioskEmployee.create({
        data: { clockId: clock.id, code, fullName, punchKeyDigest: digest },
        select: employeeFields,
      });
      return { employee };
    }, nextKey);
  } catch (error) {
    if (error.code === 'P2002' && error.meta?.target?.includes('code')) {
      throw kioskError('CONFLICT', 'Ese número de colaborador ya está registrado.');
    }
    throw error;
  }
}

export async function updateKioskEmployee(organizationId, employeeId, change, db = prisma, nextKey = randomInt) {
  const where = { id: employeeId, clock: { organizationId } };
  if (change.renewKey) {
    const employee = await db.kioskEmployee.findFirst({
      where,
      select: { clock: { select: { publicKey: true } } },
    });
    if (!employee) throw kioskError('NOT_FOUND', 'No se encontró al colaborador.');
    return issuePunchKey(employee.clock.publicKey, async (digest) => {
      const { count } = await db.kioskEmployee.updateMany({
        where: { ...where, OR: [{ punchKeyDigest: null }, { punchKeyDigest: { not: digest } }] },
        data: { punchKeyDigest: digest },
      });
      if (count) return {};
      if (!(await db.kioskEmployee.findFirst({ where, select: { id: true } }))) {
        throw kioskError('NOT_FOUND', 'No se encontró al colaborador.');
      }
      return null;
    }, nextKey);
  }
  const { count } = await db.kioskEmployee.updateMany({ where, data: { isActive: change.isActive } });
  if (!count) throw kioskError('NOT_FOUND', 'No se encontró al colaborador.');
  return { ok: true };
}

async function matchEmployee(db, { publicKey, punchKey }) {
  const digest = punchKeyDigest(publicKey, punchKey);
  const employee = await db.kioskEmployee.findFirst({
    where: {
      punchKeyDigest: digest,
      isActive: true,
      clock: { publicKey, organization: { blocked: false, empresaPortalEnabled: true } },
    },
    select: { id: true, fullName: true, clock: { select: { timeZone: true } } },
  });
  if (!employee) throw invalidCredentials();
  return { ...employee, digest };
}

function latestPunch(db, employeeId) {
  return db.kioskPunch.findFirst({
    where: { employeeId },
    select: punchFields,
    orderBy: { ordinal: 'desc' },
  });
}

export async function identifyKioskEmployee(input, db = prisma) {
  const employee = await matchEmployee(db, input);
  const lastPunch = await latestPunch(db, employee.id);
  return {
    fullName: employee.fullName,
    timeZone: employee.clock.timeZone,
    revision: lastPunch?.ordinal ?? 0,
    actions: NEXT_PUNCH[lastPunch?.type ?? 'CHECK_OUT'],
  };
}

export async function recordKioskPunch(input, db = prisma, now = () => new Date()) {
  const employee = await matchEmployee(db, input);
  return db.$transaction(async (tx) => {
    // Serializa checadas del mismo colaborador, incluso desde tablets distintas.
    const [locked] = await tx.$queryRaw`
      SELECT "punchKeyDigest", "isActive" FROM "KioskEmployee" WHERE "id" = ${employee.id} FOR UPDATE
    `;
    if (!locked?.isActive || locked.punchKeyDigest !== employee.digest) throw invalidCredentials();

    const replay = await tx.kioskPunch.findUnique({
      where: { employeeId_requestId: { employeeId: employee.id, requestId: input.requestId } },
      select: punchFields,
    });
    if (replay && replay.type === input.type && replay.ordinal === input.revision + 1) {
      return { ...replay, timeZone: employee.clock.timeZone };
    }

    const last = await latestPunch(tx, employee.id);
    const revision = last?.ordinal ?? 0;
    if (replay || revision !== input.revision || !NEXT_PUNCH[last?.type ?? 'CHECK_OUT'].includes(input.type)) {
      throw kioskError('INVALID_STATE', 'La jornada cambió. Identifícate de nuevo para ver las acciones disponibles.');
    }

    const punch = await tx.kioskPunch.create({
      data: {
        employeeId: employee.id,
        requestId: input.requestId,
        ordinal: revision + 1,
        type: input.type,
        recordedAt: now(),
      },
      select: punchFields,
    });
    return { ...punch, timeZone: employee.clock.timeZone };
  }, { isolationLevel: 'ReadCommitted' });
}

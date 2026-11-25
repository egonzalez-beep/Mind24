import { randomUUID } from 'node:crypto';
import { prisma } from '../db/client.js';
import { getKioskDailyAttendance, kioskPunchState } from './kioskClock.service.js';
import { addDaysToDateKey, localDateKey } from './remoteWorkSessionHistory.service.js';
import { utcInstantFromLocalParts } from '../utils/timezoneLocalInstant.util.js';
import {
  KIOSK_NEXT_PUNCH, kioskComparePunches, kioskLatestPunchOrder, kioskPunchOrder,
} from '../utils/kioskAttendance.util.js';

function adjustmentError(code, message) {
  return Object.assign(new Error(message), { code });
}

function localPunchInstant(date, { time, nextDay }, employee, now) {
  const key = nextDay ? addDaysToDateKey(date, 1) : date;
  const [hour, minute] = time.split(':').map(Number);
  const instant = utcInstantFromLocalParts(key, hour, minute, employee.timeZone);
  const actual = new Intl.DateTimeFormat('en-GB', {
    timeZone: employee.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(instant);
  if (actual !== time || localDateKey(instant, employee.timeZone) !== key) {
    throw adjustmentError('VALIDATION_ERROR', 'Esa hora no existe en la zona del reloj. Selecciona otra hora.');
  }
  if (instant > now || instant < employee.createdAt) {
    throw adjustmentError('VALIDATION_ERROR', 'La checada debe estar entre el alta del colaborador y la hora actual.');
  }
  return instant;
}

async function checkPunchSequence(tx, employeeId, changes, original) {
  const times = changes.map(({ recordedAt }) => +recordedAt);
  if (original) times.push(+original.recordedAt);
  const start = new Date(Math.min(...times));
  const end = new Date(Math.max(...times));
  const where = { employeeId };
  const select = { ordinal: true, recordedAt: true, type: true };
  const [prior, inside, next] = await Promise.all([
    tx.kioskPunch.findFirst({ where: { ...where, recordedAt: { lt: start } }, orderBy: kioskLatestPunchOrder, select }),
    tx.kioskPunch.findMany({ where: { ...where, recordedAt: { gte: start, lte: end } }, select }),
    tx.kioskPunch.findFirst({ where: { ...where, recordedAt: { gt: end } }, orderBy: kioskPunchOrder, select }),
  ]);
  const sequence = [...inside.filter((punch) => punch.ordinal !== original?.ordinal), ...changes].sort(kioskComparePunches);
  if (next) sequence.push(next);
  let previousType = prior?.type ?? 'CHECK_OUT';
  for (const punch of sequence) {
    if (!KIOSK_NEXT_PUNCH[previousType].includes(punch.type)) {
      throw adjustmentError('CONFLICT', 'El ajuste dejaría las checadas fuera de orden. Revisa el tipo de movimiento, la fecha y la hora.');
    }
    previousType = punch.type;
  }
}

export async function saveKioskAttendanceAdjustment(admin, employeeId, input, db = prisma, clock = () => new Date()) {
  return db.$transaction(async (tx) => {
    const [employee] = await tx.$queryRaw`
      SELECT employee."createdAt", k."timeZone"
      FROM "KioskEmployee" employee
      JOIN "KioskClock" k ON k."id" = employee."clockId"
      WHERE employee."id" = ${employeeId} AND k."organizationId" = ${admin.organizationId}
      FOR UPDATE OF employee
    `;
    if (!employee) throw adjustmentError('NOT_FOUND', 'No se encontró al colaborador.');
    const requestKey = { employeeId, requestId: input.requestId };
    const existing = await tx.kioskAttendanceAdjustment.findUnique({
      where: { employeeId_requestId: requestKey }, select: { id: true },
    });
    if (existing) return existing;

    const now = clock();
    const loadDay = () => getKioskDailyAttendance(admin.organizationId, input.date, tx, now, employeeId);
    const person = (await loadDay()).people[0];
    if (!person) throw adjustmentError('NOT_FOUND', 'No hay una jornada del colaborador para esa fecha.');

    const data = {
      ...requestKey, date: new Date(input.date), action: input.action, reason: input.reason,
      actorId: admin.id, actorName: admin.fullName, createdAt: now,
    };
    if (input.action === 'JUSTIFY') {
      if (!person.attendance.flags.includes(input.incident)) {
        throw adjustmentError('CONFLICT', 'La incidencia cambió. Actualiza la jornada antes de justificar.');
      }
      if (person.adjustments.some(({ action, incident }) => action === 'JUSTIFY' && incident === input.incident)) {
        throw adjustmentError('CONFLICT', 'Esta incidencia ya está justificada.');
      }
      return tx.kioskAttendanceAdjustment.create({ data: { ...data, incident: input.incident }, select: { id: true } });
    }

    let original;
    let changes;
    if (input.action === 'EDIT_PUNCH') {
      original = person.attendance.punches.find((punch) => punch.ordinal === input.ordinal);
      if (!original || original.recordedAt.toISOString() !== input.previousAt) {
        throw adjustmentError('CONFLICT', 'La checada cambió. Actualiza la jornada antes de corregir.');
      }
      const recordedAt = localPunchInstant(input.date, input, employee, now);
      if (+recordedAt === +original.recordedAt) throw adjustmentError('VALIDATION_ERROR', 'Elige una hora distinta para corregir la checada.');
      changes = [{ ordinal: original.ordinal, type: original.type, recordedAt }];
    } else {
      const { revision } = await kioskPunchState(tx, employeeId);
      changes = input.events.map((event, i) => ({
        ordinal: revision + i + 1, type: event.type, recordedAt: localPunchInstant(input.date, event, employee, now),
      }));
      if (changes.length === 2 && +changes[0].recordedAt >= +changes[1].recordedAt) {
        throw adjustmentError('VALIDATION_ERROR', 'La salida debe ser posterior a la entrada.');
      }
    }
    await checkPunchSequence(tx, employeeId, changes, original);
    if (original) {
      await tx.kioskPunch.update({
        where: { employeeId_ordinal: { employeeId, ordinal: original.ordinal } },
        data: { recordedAt: changes[0].recordedAt, originalRecordedAt: original.originalRecordedAt ?? original.recordedAt },
        select: { id: true },
      });
    } else {
      await tx.kioskPunch.createMany({
        data: changes.map((punch) => ({ ...punch, employeeId, requestId: randomUUID(), isManual: true })),
      });
    }
    const updated = (await loadDay()).people[0];
    const effective = new Set(updated?.attendance.punches.map(({ ordinal }) => ordinal));
    if (!changes.every(({ ordinal }) => effective.has(ordinal))) {
      throw adjustmentError('CONFLICT', 'El ajuste pertenece a otra jornada. Abre el día de inicio de ese turno.');
    }
    return tx.kioskAttendanceAdjustment.create({
      data: {
        ...data,
        changes: changes.map(({ type, ordinal, recordedAt }) => ({
          type, ordinal, recordedAt: recordedAt.toISOString(),
          ...(original && { previousAt: original.recordedAt.toISOString() }),
        })),
      },
      select: { id: true },
    });
  }, { isolationLevel: 'ReadCommitted' });
}

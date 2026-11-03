import { prisma } from '../db/client.js';
import { assertWorkforceEmployeeInOrg } from './workforceEmployee.service.js';
import { lockOpenSessionRow } from '../utils/remoteWorkSessionLock.util.js';

export const WORK_LOG_MAX_CHARS = 4000;
export const WORK_LOG_MIN_CHARS = 1;

/**
 * Trim ends only; preserve internal newlines. Returns null if empty after trim.
 * @param {unknown} input
 */
export function normalizeWorkLogText(input) {
  if (input == null) return null;
  const text = String(input).replace(/\r\n/g, '\n').trim();
  if (!text) return null;
  if (text.length < WORK_LOG_MIN_CHARS) return null;
  if (text.length > WORK_LOG_MAX_CHARS) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = `La bitácora no puede superar ${WORK_LOG_MAX_CHARS} caracteres.`;
    throw err;
  }
  return text;
}

/** Texto no vacío y timestamp parseable. Cualquier mitad ausente no es bitácora. */
export function sessionHasValidWorkLog(session) {
  const text = session?.workLogText;
  if (typeof text !== 'string' || text.trim().length === 0) return false;
  const submittedAt = session?.workLogSubmittedAt;
  if (submittedAt == null || submittedAt === '') return false;
  const ms = submittedAt instanceof Date ? submittedAt.getTime() : new Date(submittedAt).getTime();
  return Number.isFinite(ms);
}

export function workLogPayloadFromSession(session) {
  if (!sessionHasValidWorkLog(session)) {
    return { submitted: false };
  }
  return {
    submitted: true,
    text: session.workLogText,
    submittedAt: session.workLogSubmittedAt,
  };
}

export function workLogAdminPayloadFromSession(session) {
  if (!sessionHasValidWorkLog(session)) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'No hay bitácora para esta jornada.';
    throw err;
  }
  return {
    text: session.workLogText,
    submittedAt: session.workLogSubmittedAt,
    checkInAt: session.checkInAt ?? null,
  };
}

async function findOpenSessionRow(tx, employeeId) {
  return tx.remoteWorkSession.findFirst({
    where: { employeeId, checkOutAt: null },
    orderBy: { checkInAt: 'desc' },
  });
}

/**
 * @param {{ employeeId: string, text: string }} params
 */
export async function submitWorkLogForOpenSession({ employeeId, text }) {
  const normalized = normalizeWorkLogText(text);
  if (!normalized) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Escribe la bitácora antes de enviar.';
    throw err;
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const open = await findOpenSessionRow(tx, employeeId);
    if (!open) {
      const err = new Error('WORK_SESSION_NOT_OPEN');
      err.code = 'WORK_SESSION_NOT_OPEN';
      err.message = 'La jornada ya no está abierta.';
      throw err;
    }
    await lockOpenSessionRow(tx, open.id);

    const updated = await tx.remoteWorkSession.updateMany({
      where: {
        id: open.id,
        employeeId,
        checkOutAt: null,
        workLogSubmittedAt: null,
      },
      data: {
        workLogText: normalized,
        workLogSubmittedAt: now,
      },
    });

    if (updated.count === 1) {
      const session = await tx.remoteWorkSession.findUnique({ where: { id: open.id } });
      return { session, workLog: workLogPayloadFromSession(session) };
    }

    const fresh = await tx.remoteWorkSession.findUnique({ where: { id: open.id } });
    if (!fresh || fresh.checkOutAt) {
      const err = new Error('WORK_SESSION_NOT_OPEN');
      err.code = 'WORK_SESSION_NOT_OPEN';
      err.message = 'La jornada ya no está abierta.';
      throw err;
    }
    if (fresh.workLogSubmittedAt) {
      const err = new Error('WORK_LOG_ALREADY_SUBMITTED');
      err.code = 'WORK_LOG_ALREADY_SUBMITTED';
      err.message = 'La bitácora de esta jornada ya fue enviada.';
      throw err;
    }

    const err = new Error('WORK_LOG_UPDATE_FAILED');
    err.code = 'INTERNAL';
    err.status = 500;
    throw err;
  });
}

export async function getSessionWorkLogForAdmin({ organizationId, employeeId, sessionId }) {
  await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const session = await prisma.remoteWorkSession.findFirst({
    where: {
      id: sessionId,
      employeeId,
      employee: { organizationId },
    },
    select: {
      workLogText: true,
      workLogSubmittedAt: true,
      checkInAt: true,
    },
  });
  return workLogAdminPayloadFromSession(session);
}

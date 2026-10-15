import { prisma } from '../db/client.js';
import {
  resolveCurrentWebSignal,
  webSignalFromVisibility,
  webSignalLabel,
} from './timeclockWebSignal.service.js';

export function resolveShiftLifecycle(openSession) {
  if (!openSession) return 'OFF_DUTY';
  if (openSession.checkOutAt) {
    return 'SHIFT_COMPLETED';
  }
  if (openSession.anomalyFlag) return 'OPEN_ANOMALY';
  return 'SHIFT_OPEN';
}

export function summarizeOpenSession(session, now = new Date()) {
  if (!session || session.checkOutAt) return null;
  const webSignal = resolveCurrentWebSignal(session, now);
  return {
    id: session.id,
    checkInAt: session.checkInAt,
    status: session.status,
    lastHeartbeatAt: session.lastHeartbeatAt,
    webSignal,
    webSignalLabel: webSignalLabel(webSignal),
  };
}

async function findOpenSession(tx, employeeId) {
  return tx.remoteWorkSession.findFirst({
    where: { employeeId, checkOutAt: null },
    orderBy: { checkInAt: 'desc' },
  });
}

export async function getOpenSessionForEmployee(employeeId) {
  return findOpenSession(prisma, employeeId);
}

export async function checkInRemoteWorkSession({ employeeId, userAgent, clientMetadata }) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const existing = await findOpenSession(tx, employeeId);
    if (existing) {
      return { session: existing, created: false };
    }
    try {
      const session = await tx.remoteWorkSession.create({
        data: {
          employeeId,
          checkInAt: now,
          status: 'open',
          lastWebSignal: 'no_signal',
          userAgent: userAgent?.slice(0, 512) || null,
          clientMetadata: clientMetadata ?? undefined,
        },
      });
      await tx.remoteWorkEvent.create({
        data: {
          sessionId: session.id,
          employeeId,
          type: 'CHECK_IN',
          occurredAt: now,
          payload: { checkInAt: now.toISOString() },
        },
      });
      return { session, created: true };
    } catch (e) {
      if (e.code === 'P2002') {
        const raced = await findOpenSession(tx, employeeId);
        if (raced) return { session: raced, created: false };
      }
      throw e;
    }
  });
}

export async function checkOutRemoteWorkSession(employeeId) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const open = await findOpenSession(tx, employeeId);
    if (!open) {
      const last = await tx.remoteWorkSession.findFirst({
        where: { employeeId },
        orderBy: { checkInAt: 'desc' },
      });
      if (last && last.checkOutAt && (last.status === 'completed' || last.status === 'admin_closed')) {
        return { session: last, alreadyClosed: true };
      }
      const err = new Error('INVALID_STATE');
      err.code = 'INVALID_STATE';
      err.message = 'No hay jornada abierta.';
      throw err;
    }
    if (open.status !== 'open') {
      return { session: open, alreadyClosed: true };
    }
    const updated = await tx.remoteWorkSession.update({
      where: { id: open.id },
      data: {
        checkOutAt: now,
        status: 'completed',
      },
    });
    await tx.remoteWorkEvent.create({
      data: {
        sessionId: updated.id,
        employeeId,
        type: 'CHECK_OUT',
        occurredAt: now,
        payload: { checkOutAt: now.toISOString() },
      },
    });
    return { session: updated, alreadyClosed: false };
  });
}

export async function recordRemoteWorkHeartbeat({
  employeeId,
  visibilityState,
  clientMetadata,
}) {
  const now = new Date();
  const vis = visibilityState === 'hidden' ? 'hidden' : 'visible';
  return prisma.$transaction(async (tx) => {
    const open = await findOpenSession(tx, employeeId);
    if (!open) {
      return { noop: true, reason: 'no_open_session' };
    }
    const previousEffective = resolveCurrentWebSignal(open, now);
    const immediateSignal = webSignalFromVisibility(vis);

    const data = {
      lastHeartbeatAt: now,
      lastWebSignal: immediateSignal,
      lastVisibilityState: vis,
      ...(clientMetadata != null ? { clientMetadata } : {}),
    };

    const updated = await tx.remoteWorkSession.update({
      where: { id: open.id },
      data,
    });

    if (open.lastVisibilityState !== vis) {
      const tabEventType = vis === 'hidden' ? 'TAB_BACKGROUND' : 'TAB_VISIBLE';
      await tx.remoteWorkEvent.create({
        data: {
          sessionId: open.id,
          employeeId,
          type: tabEventType,
          occurredAt: now,
          payload: { visibilityState: vis },
        },
      });
    }

    const newEffective = resolveCurrentWebSignal(updated, now);
    if (newEffective !== previousEffective) {
      await tx.remoteWorkEvent.create({
        data: {
          sessionId: open.id,
          employeeId,
          type: 'WEB_SIGNAL_CHANGED',
          occurredAt: now,
          payload: {
            from: webSignalLabel(previousEffective),
            to: webSignalLabel(newEffective),
          },
        },
      });
    }

    return { session: updated, noop: false };
  });
}

export async function adminCloseRemoteWorkSession({
  organizationId,
  sessionId,
  closedByUserId,
  closeReason,
}) {
  const reason = closeReason?.trim();
  if (!reason) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Se requiere motivo de cierre.';
    throw err;
  }
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const session = await tx.remoteWorkSession.findUnique({
      where: { id: sessionId },
      include: { employee: true },
    });
    if (!session || session.employee.organizationId !== organizationId) {
      const err = new Error('NOT_FOUND');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (session.checkOutAt) {
      return { session, alreadyClosed: true };
    }
    const updated = await tx.remoteWorkSession.update({
      where: { id: sessionId },
      data: {
        checkOutAt: now,
        status: 'admin_closed',
        closedByUserId,
        closedAt: now,
        closeReason: reason,
      },
    });
    await tx.remoteWorkEvent.create({
      data: {
        sessionId: sessionId,
        employeeId: session.employeeId,
        type: 'ADMIN_CLOSE',
        occurredAt: now,
        actorUserId: closedByUserId,
        payload: {
          checkOutAt: now.toISOString(),
          reason,
          closedByUserId,
          before: { checkInAt: session.checkInAt, checkOutAt: null },
        },
      },
    });
    return { session: updated, alreadyClosed: false };
  });
}

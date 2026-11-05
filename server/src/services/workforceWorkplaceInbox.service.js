import { prisma } from '../db/client.js';

function quoteTitle(title) {
  const t = String(title || '').trim();
  return t ? `“${t}”` : 'actividad';
}

function quoteGoalTitle(title) {
  const t = String(title || '').trim();
  return t ? `“${t}”` : 'meta';
}

async function upsertWorkplaceInboxDedupe(tx, data) {
  const { organizationId, dedupeKey, ...createFields } = data;
  return tx.workforceWorkplaceInbox.upsert({
    where: { organizationId_dedupeKey: { organizationId, dedupeKey } },
    create: { organizationId, dedupeKey, ...createFields },
    update: {},
  });
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export async function emitWorkplaceInboxTaskAssigned(
  tx,
  { organizationId, recipientWorkforceEmployeeId, taskId, taskTitle },
) {
  if (!organizationId || !recipientWorkforceEmployeeId || !taskId) return null;
  const message = `Te asignaron una nueva actividad: ${quoteTitle(taskTitle)}.`;
  const metadata = { taskId };
  const dedupeKey = `task_assigned:${taskId}`;
  return upsertWorkplaceInboxDedupe(tx, {
    organizationId,
    dedupeKey,
    recipientWorkforceEmployeeId,
    eventType: 'TASK_ASSIGNED',
    message,
    metadata,
  });
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export async function emitWorkplaceInboxGoalAssigned(
  tx,
  { organizationId, recipientWorkforceEmployeeId, goalId, goalTitle },
) {
  if (!organizationId || !recipientWorkforceEmployeeId || !goalId) return null;
  const message = `Te asignaron una nueva meta: ${quoteGoalTitle(goalTitle)}.`;
  const metadata = { goalId };
  const dedupeKey = `goal_assigned:${goalId}`;
  return upsertWorkplaceInboxDedupe(tx, {
    organizationId,
    dedupeKey,
    recipientWorkforceEmployeeId,
    eventType: 'GOAL_ASSIGNED',
    message,
    metadata,
  });
}

export async function markWorkplaceInboxItemRead(organizationId, recipientWorkforceEmployeeId, itemId) {
  const row = await prisma.workforceWorkplaceInbox.findFirst({
    where: {
      id: itemId,
      organizationId,
      recipientWorkforceEmployeeId,
    },
    select: { id: true, readAt: true },
  });
  if (!row) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Novedad no encontrada.';
    throw err;
  }
  if (row.readAt) return { ok: true };
  const now = new Date();
  await prisma.workforceWorkplaceInbox.updateMany({
    where: {
      id: row.id,
      organizationId,
      recipientWorkforceEmployeeId,
      readAt: null,
    },
    data: { readAt: now },
  });
  return { ok: true, readAt: now.toISOString() };
}

export async function countUnreadWorkplaceInbox(organizationId, recipientWorkforceEmployeeId) {
  return prisma.workforceWorkplaceInbox.count({
    where: {
      organizationId,
      recipientWorkforceEmployeeId,
      readAt: null,
    },
  });
}

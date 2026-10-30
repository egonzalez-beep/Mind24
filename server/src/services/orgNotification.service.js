import { prisma } from '../db/client.js';

export const ORG_NOTIFICATION_TYPES = [
  'SHIFT_CHECK_IN',
  'SHIFT_CHECK_OUT',
  'TASK_COMPLETED',
  'TASK_OVERDUE',
  'GOAL_PERIOD_REPORTED',
  'PLATFORM_ANNOUNCEMENT',
];

const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 30;

function quoteTitle(title) {
  const t = String(title || '').trim();
  return t ? `“${t}”` : 'actividad';
}

async function upsertOrgNotification(client, data) {
  const {
    organizationId,
    dedupeKey,
    type,
    message,
    employeeId,
    taskId,
    remoteWorkSessionId,
    goalId,
    goalPeriodId,
  } = data;
  return client.orgNotification.upsert({
    where: {
      organizationId_dedupeKey: { organizationId, dedupeKey },
    },
    create: {
      organizationId,
      dedupeKey,
      type,
      message,
      employeeId: employeeId ?? null,
      taskId: taskId ?? null,
      remoteWorkSessionId: remoteWorkSessionId ?? null,
      goalId: goalId ?? null,
      goalPeriodId: goalPeriodId ?? null,
    },
    update: {},
  });
}

function quoteGoalTitle(title) {
  const t = String(title || '').trim();
  return t ? `“${t}”` : 'meta';
}

export function buildGoalPeriodReportedMessage(
  employeeName,
  goalTitle,
  goalType,
  { targetSnapshot, achievedValue, binaryResult, completionPercent },
) {
  const name = employeeName || 'Colaborador';
  const meta = quoteGoalTitle(goalTitle);
  if (goalType === 'COMPLIANCE') {
    if (binaryResult === 'MET') return `${name} cumplió la meta ${meta}.`;
    return `${name} no cumplió la meta ${meta}.`;
  }
  const achieved = Number(achievedValue);
  const target = Number(targetSnapshot);
  if (Number.isFinite(achieved) && Number.isFinite(target) && achieved >= target) {
    return `${name} cumplió la meta ${meta}.`;
  }
  const pct =
    completionPercent != null && Number.isFinite(Number(completionPercent))
      ? Math.round(Number(completionPercent))
      : target > 0 && Number.isFinite(achieved)
        ? Math.round((achieved / target) * 100)
        : 0;
  return `${name} reportó parcialmente la meta ${meta} (${pct}%).`;
}

export async function notifyGoalPeriodReportedByEmployee(
  tx,
  {
    organizationId,
    employeeId,
    employeeName,
    goalId,
    goalTitle,
    goalType,
    periodId,
    targetSnapshot,
    achievedValue,
    binaryResult,
    completionPercent,
  },
) {
  if (!organizationId || !periodId) return;
  const message = buildGoalPeriodReportedMessage(employeeName, goalTitle, goalType, {
    targetSnapshot,
    achievedValue,
    binaryResult,
    completionPercent,
  });
  await upsertOrgNotification(tx, {
    organizationId,
    type: 'GOAL_PERIOD_REPORTED',
    message,
    employeeId,
    goalId,
    goalPeriodId: periodId,
    dedupeKey: `goal_period_reported:${periodId}`,
  });
}

export async function notifyShiftCheckIn(employee, sessionId) {
  if (!employee?.organizationId || !sessionId) return;
  const name = employee.fullName || 'Colaborador';
  await upsertOrgNotification(prisma, {
    organizationId: employee.organizationId,
    type: 'SHIFT_CHECK_IN',
    message: `${name} registró entrada`,
    employeeId: employee.id,
    remoteWorkSessionId: sessionId,
    dedupeKey: `shift_check_in:${sessionId}`,
  });
}

export async function notifyShiftCheckOut(employee, sessionId) {
  if (!employee?.organizationId || !sessionId) return;
  const name = employee.fullName || 'Colaborador';
  await upsertOrgNotification(prisma, {
    organizationId: employee.organizationId,
    type: 'SHIFT_CHECK_OUT',
    message: `${name} registró salida`,
    employeeId: employee.id,
    remoteWorkSessionId: sessionId,
    dedupeKey: `shift_check_out:${sessionId}`,
  });
}

export async function notifyTaskCompletedByEmployee(
  tx,
  { organizationId, employeeId, employeeName, taskId, taskTitle, taskEventId },
) {
  if (!organizationId || !taskEventId) return;
  const name = employeeName || 'Colaborador';
  await upsertOrgNotification(tx, {
    organizationId,
    type: 'TASK_COMPLETED',
    message: `${name} completó ${quoteTitle(taskTitle)}`,
    employeeId,
    taskId,
    dedupeKey: `task_completed:${taskEventId}`,
  });
}

export async function syncOverdueTaskNotifications(organizationId) {
  const now = new Date();
  const tasks = await prisma.workforceTask.findMany({
    where: {
      organizationId,
      archivedAt: null,
      status: { not: 'COMPLETED' },
      dueAt: { lt: now },
    },
    select: {
      id: true,
      title: true,
      dueAt: true,
      employee: { select: { id: true, fullName: true } },
    },
  });
  if (!tasks.length) return 0;
  await prisma.$transaction(async (tx) => {
    for (const task of tasks) {
      if (!task.dueAt) continue;
      const name = task.employee?.fullName || 'Colaborador';
      const dueMs = new Date(task.dueAt).getTime();
      await upsertOrgNotification(tx, {
        organizationId,
        type: 'TASK_OVERDUE',
        message: `${name} tiene una actividad vencida: ${quoteTitle(task.title)}`,
        employeeId: task.employee?.id ?? null,
        taskId: task.id,
        dedupeKey: `task_overdue:${task.id}:${dueMs}`,
      });
    }
  });
  return tasks.length;
}

function serializeNotification(row, readSet) {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    employeeId: row.employeeId,
    taskId: row.taskId,
    remoteWorkSessionId: row.remoteWorkSessionId,
    createdAt: row.createdAt,
    read: readSet.has(row.id),
  };
}

export async function listOrgNotificationsForUser({
  organizationId,
  userId,
  limit = DEFAULT_LIST_LIMIT,
  cursor,
}) {
  await syncOverdueTaskNotifications(organizationId);

  const take = Math.min(Math.max(Number(limit) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const where = { organizationId };
  if (cursor) {
    const createdAt = new Date(String(cursor));
    if (!Number.isNaN(createdAt.getTime())) {
      where.createdAt = { lt: createdAt };
    }
  }

  const rows = await prisma.orgNotification.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const readRows = page.length
    ? await prisma.orgNotificationRead.findMany({
        where: { userId, notificationId: { in: page.map((r) => r.id) } },
        select: { notificationId: true },
      })
    : [];
  const readSet = new Set(readRows.map((r) => r.notificationId));
  const notifications = page.map((r) => serializeNotification(r, readSet));
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? last.createdAt.toISOString() : null;
  return { notifications, nextCursor, hasMore };
}

export async function countUnreadOrgNotifications(organizationId, userId) {
  await syncOverdueTaskNotifications(organizationId);
  return prisma.orgNotification.count({
    where: {
      organizationId,
      reads: { none: { userId } },
    },
  });
}

export async function markOrgNotificationRead(organizationId, userId, notificationId) {
  const row = await prisma.orgNotification.findFirst({
    where: { id: notificationId, organizationId },
    select: { id: true },
  });
  if (!row) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Notificación no encontrada.';
    throw err;
  }
  await prisma.orgNotificationRead.upsert({
    where: { notificationId_userId: { notificationId, userId } },
    create: { notificationId, userId },
    update: { readAt: new Date() },
  });
  return { ok: true };
}

export async function markAllOrgNotificationsRead(organizationId, userId) {
  const unread = await prisma.orgNotification.findMany({
    where: { organizationId, reads: { none: { userId } } },
    select: { id: true },
  });
  if (!unread.length) return { ok: true, marked: 0 };
  const now = new Date();
  await prisma.$transaction(
    unread.map((n) =>
      prisma.orgNotificationRead.upsert({
        where: { notificationId_userId: { notificationId: n.id, userId } },
        create: { notificationId: n.id, userId, readAt: now },
        update: { readAt: now },
      }),
    ),
  );
  return { ok: true, marked: unread.length };
}

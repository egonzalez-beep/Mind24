import { prisma } from '../db/client.js';
import { assertWorkforceEmployeeInOrg } from './workforceEmployee.service.js';

export const WORKFORCE_TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED'];

const STATUS_SORT = { PENDING: 0, IN_PROGRESS: 1, COMPLETED: 2 };

const EMPLOYEE_STATUS_TRANSITIONS = {
  PENDING: new Set(['IN_PROGRESS', 'COMPLETED']),
  IN_PROGRESS: new Set(['PENDING', 'COMPLETED']),
  COMPLETED: new Set(),
};

export function canEmployeeChangeTaskStatus(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  const allowed = EMPLOYEE_STATUS_TRANSITIONS[fromStatus];
  return allowed ? allowed.has(toStatus) : false;
}

export function applyWorkforceTaskStatusTimestamps(existing, nextStatus, now) {
  const patch = { status: nextStatus };
  if (nextStatus === 'IN_PROGRESS' && !existing.startedAt) {
    patch.startedAt = now;
  }
  if (nextStatus === 'COMPLETED') {
    patch.completedAt = now;
  } else if (existing.status === 'COMPLETED' && nextStatus !== 'COMPLETED') {
    patch.completedAt = null;
  }
  return patch;
}

export function serializeWorkforceTask(task) {
  return {
    id: task.id,
    employeeId: task.employeeId,
    title: task.title,
    description: task.description,
    status: task.status,
    position: task.position,
    dueAt: task.dueAt ? task.dueAt.toISOString() : null,
    startedAt: task.startedAt ? task.startedAt.toISOString() : null,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    archivedAt: task.archivedAt ? task.archivedAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function sortTasksForKanban(tasks) {
  return [...tasks].sort((a, b) => {
    const sd = (STATUS_SORT[a.status] ?? 9) - (STATUS_SORT[b.status] ?? 9);
    if (sd !== 0) return sd;
    if (a.position !== b.position) return a.position - b.position;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

async function nextPositionForColumn(employeeId, status, tx = prisma) {
  const agg = await tx.workforceTask.aggregate({
    where: { employeeId, status, archivedAt: null },
    _max: { position: true },
  });
  return (agg._max.position ?? 0) + 1000;
}

async function recordTaskEvent(tx, payload) {
  await tx.workforceTaskEvent.create({ data: payload });
}

export async function assertWorkforceTaskInOrg(taskId, organizationId) {
  const task = await prisma.workforceTask.findFirst({
    where: { id: taskId, organizationId },
  });
  if (!task) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Actividad no encontrada.';
    throw err;
  }
  return task;
}

export async function createWorkforceTaskForEmployee({
  organizationId,
  employeeId,
  createdByUserId,
  title,
  description,
  dueAt,
}) {
  await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const position = await nextPositionForColumn(employeeId, 'PENDING', tx);
    const task = await tx.workforceTask.create({
      data: {
        organizationId,
        employeeId,
        title: title.trim(),
        description: description?.trim() || null,
        status: 'PENDING',
        position,
        dueAt: dueAt ?? null,
        createdByUserId,
      },
    });
    await recordTaskEvent(tx, {
      taskId: task.id,
      type: 'TASK_CREATED',
      actorType: 'ADMIN',
      actorUserId: createdByUserId,
      actorEmployeeId: null,
      fromStatus: null,
      toStatus: 'PENDING',
    });
    return serializeWorkforceTask(task);
  });
}

export async function listWorkforceTasksForAdmin({
  organizationId,
  employeeId,
  status,
  includeArchived = false,
}) {
  await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const where = {
    organizationId,
    employeeId,
    ...(includeArchived ? {} : { archivedAt: null }),
    ...(status ? { status } : {}),
  };
  const rows = await prisma.workforceTask.findMany({ where });
  return sortTasksForKanban(rows).map(serializeWorkforceTask);
}

export async function listWorkforceTasksForEmployee(employeeId) {
  const rows = await prisma.workforceTask.findMany({
    where: {
      employeeId,
      archivedAt: null,
      status: { in: ['PENDING', 'IN_PROGRESS'] },
    },
  });
  return sortTasksForKanban(rows).map(serializeWorkforceTask);
}

function assertExpectedUpdatedAt(task, expectedUpdatedAt) {
  if (!expectedUpdatedAt) return;
  const expected = new Date(expectedUpdatedAt);
  if (Number.isNaN(expected.getTime()) || task.updatedAt.getTime() !== expected.getTime()) {
    const err = new Error('CONFLICT');
    err.code = 'CONFLICT';
    err.message = 'La actividad fue modificada. Actualiza e intenta de nuevo.';
    throw err;
  }
}

export async function patchWorkforceTaskAsAdmin({
  organizationId,
  taskId,
  actorUserId,
  status,
  position,
  title,
  description,
  dueAt,
  archive,
  expectedUpdatedAt,
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.workforceTask.findFirst({
      where: { id: taskId, organizationId },
    });
    if (!existing) {
      const err = new Error('NOT_FOUND');
      err.code = 'NOT_FOUND';
      err.message = 'Actividad no encontrada.';
      throw err;
    }
    assertExpectedUpdatedAt(existing, expectedUpdatedAt);

    const now = new Date();
    const data = {};
    let statusChanged = false;
    let archived = false;

    if (title != null) data.title = title.trim();
    if (description !== undefined) data.description = description?.trim() || null;
    if (dueAt !== undefined) data.dueAt = dueAt;

    if (status != null && status !== existing.status) {
      Object.assign(data, applyWorkforceTaskStatusTimestamps(existing, status, now));
      statusChanged = true;
      if (position == null) {
        data.position = await nextPositionForColumn(existing.employeeId, status, tx);
      }
    }

    if (position != null) data.position = position;

    if (archive === true && !existing.archivedAt) {
      data.archivedAt = now;
      archived = true;
    } else if (archive === false) {
      data.archivedAt = null;
    }

    if (!Object.keys(data).length) {
      return serializeWorkforceTask(existing);
    }

    const updated = await tx.workforceTask.update({
      where: { id: existing.id },
      data,
    });

    if (statusChanged) {
      await recordTaskEvent(tx, {
        taskId: updated.id,
        type: 'TASK_STATUS_CHANGED',
        actorType: 'ADMIN',
        actorUserId: actorUserId,
        actorEmployeeId: null,
        fromStatus: existing.status,
        toStatus: updated.status,
      });
    }
    if (archived) {
      await recordTaskEvent(tx, {
        taskId: updated.id,
        type: 'TASK_ARCHIVED',
        actorType: 'ADMIN',
        actorUserId: actorUserId,
        actorEmployeeId: null,
        fromStatus: updated.status,
        toStatus: null,
      });
    }

    return serializeWorkforceTask(updated);
  });
}

export async function patchWorkforceTaskAsEmployee({
  employeeId,
  taskId,
  status,
  expectedUpdatedAt,
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.workforceTask.findFirst({
      where: { id: taskId, employeeId, archivedAt: null },
    });
    if (!existing) {
      const err = new Error('NOT_FOUND');
      err.code = 'NOT_FOUND';
      err.message = 'Actividad no encontrada.';
      throw err;
    }
    assertExpectedUpdatedAt(existing, expectedUpdatedAt);

    if (status == null || status === existing.status) {
      return serializeWorkforceTask(existing);
    }

    if (!canEmployeeChangeTaskStatus(existing.status, status)) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Transición de estado no permitida.';
      throw err;
    }

    const now = new Date();
    const data = {
      ...applyWorkforceTaskStatusTimestamps(existing, status, now),
      position: await nextPositionForColumn(employeeId, status, tx),
    };

    const updated = await tx.workforceTask.update({
      where: { id: existing.id },
      data,
    });

    await recordTaskEvent(tx, {
      taskId: updated.id,
      type: 'TASK_STATUS_CHANGED',
      actorType: 'EMPLOYEE',
      actorUserId: null,
      actorEmployeeId: employeeId,
      fromStatus: existing.status,
      toStatus: updated.status,
    });

    return serializeWorkforceTask(updated);
  });
}

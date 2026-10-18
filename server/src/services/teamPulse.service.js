import { prisma } from '../db/client.js';

export const EMPTY_TEAM_PULSE = {
  collaborators: 0,
  onShiftNow: 0,
  pending: 0,
  inProgress: 0,
  overdue: 0,
  completed: 0,
};

/** Merge org-level task groupBy rows (status only). */
export function mergeOrgTaskCountsFromGroupBy(rows) {
  const out = { pending: 0, inProgress: 0, completed: 0 };
  for (const row of rows) {
    const n = row._count?._all ?? 0;
    if (row.status === 'PENDING') out.pending = n;
    else if (row.status === 'IN_PROGRESS') out.inProgress = n;
    else if (row.status === 'COMPLETED') out.completed = n;
  }
  return out;
}

/**
 * Aggregated team pulse for one organization (fixed small query batch, no N+1).
 */
export async function getTeamPulseForOrganization(organizationId, now = new Date()) {
  const [
    collaborators,
    openShiftRows,
    taskGroupRows,
    overdue,
  ] = await Promise.all([
    prisma.workforceEmployee.count({
      where: { organizationId, isActive: true },
    }),
    prisma.remoteWorkSession.findMany({
      where: {
        checkOutAt: null,
        employee: { organizationId, isActive: true },
      },
      select: { employeeId: true },
      distinct: ['employeeId'],
    }),
    prisma.workforceTask.groupBy({
      by: ['status'],
      where: {
        organizationId,
        OR: [
          { status: 'COMPLETED' },
          { archivedAt: null, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        ],
      },
      _count: { _all: true },
    }),
    prisma.workforceTask.count({
      where: {
        organizationId,
        archivedAt: null,
        status: { not: 'COMPLETED' },
        dueAt: { lt: now },
      },
    }),
  ]);

  const taskCounts = mergeOrgTaskCountsFromGroupBy(taskGroupRows);

  return {
    collaborators,
    onShiftNow: openShiftRows.length,
    pending: taskCounts.pending,
    inProgress: taskCounts.inProgress,
    overdue,
    completed: taskCounts.completed,
  };
}

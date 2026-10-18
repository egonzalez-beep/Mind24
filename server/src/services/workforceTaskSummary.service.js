import { prisma } from '../db/client.js';

export const EMPTY_WORKFORCE_TASK_SUMMARY = { pending: 0, inProgress: 0, completed: 0 };

/** Pure merge for groupBy rows — used in tests and aggregate query. */
export function mergeTaskSummaryFromGroupByRows(rows) {
  const map = new Map();
  for (const row of rows) {
    let entry = map.get(row.employeeId);
    if (!entry) {
      entry = { pending: 0, inProgress: 0, completed: 0 };
      map.set(row.employeeId, entry);
    }
    const n = row._count?._all ?? 0;
    if (row.status === 'PENDING') entry.pending = n;
    else if (row.status === 'IN_PROGRESS') entry.inProgress = n;
    else if (row.status === 'COMPLETED') entry.completed = n;
  }
  return map;
}

/** One grouped query per org — pending/inProgress exclude archived; completed is lifetime incl. archived. */
export async function aggregateWorkforceTaskSummariesForOrg(organizationId) {
  const rows = await prisma.workforceTask.groupBy({
    by: ['employeeId', 'status'],
    where: {
      organizationId,
      OR: [
        { status: 'COMPLETED' },
        { archivedAt: null, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      ],
    },
    _count: { _all: true },
  });
  return mergeTaskSummaryFromGroupByRows(rows);
}

export function workforceTaskSummaryForEmployee(summaryMap, employeeId) {
  const hit = summaryMap.get(employeeId);
  return hit ? { ...hit } : { ...EMPTY_WORKFORCE_TASK_SUMMARY };
}

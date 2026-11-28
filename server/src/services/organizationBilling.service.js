/**
 * Cobro B2B por token: 1 crédito de organización al cerrar una batería completa.
 */

import { prisma } from '../db/client.js';
import { resolveModuleKey } from '../utils/moduleCatalog.js';

export async function assertOrganizationHasAssignmentCredits(tx, organizationId) {
  const org = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, credits: true, blocked: true },
  });
  if (!org || org.blocked) {
    const err = new Error('ORG_BLOCKED');
    err.code = 'ORG_BLOCKED';
    throw err;
  }
  if (org.credits < 1) {
    const err = new Error('Créditos insuficientes para asignar nuevas evaluaciones.');
    err.code = 'NO_CREDITS';
    throw err;
  }
  return org;
}

/** Consolida envíos simultáneos de una batería y confirma el crédito junto con su cierre. */
export async function completeAssignmentAttempt({ assignmentId, attemptId, organizationId, moduleKey, attemptData }) {
  return prisma.$transaction(async (tx) => {
    const [assignment] = await tx.$queryRaw`
      SELECT "selectedModules", "completedModules", "creditDeducted", "status"::text AS "status"
      FROM "Assignment" WHERE "id" = ${assignmentId} FOR UPDATE
    `;
    if (!assignment || assignment.status === 'archived') {
      const err = new Error('Esta evaluación ya no está disponible.');
      err.code = assignment ? 'ASSIGNMENT_ARCHIVED' : 'NOT_FOUND';
      throw err;
    }

    const submitted = await tx.assessmentAttempt.updateMany({
      where: { id: attemptId, assignmentId, status: 'in_progress' },
      data: { ...attemptData, status: 'submitted' },
    });
    if (submitted.count !== 1) {
      const err = new Error('INVALID_STATE');
      err.code = 'INVALID_STATE';
      throw err;
    }

    const selected = Array.isArray(assignment.selectedModules)
      ? assignment.selectedModules.map(resolveModuleKey).filter(Boolean)
      : [];
    const completed = new Set(Array.isArray(assignment.completedModules)
      ? assignment.completedModules.map(resolveModuleKey).filter(Boolean)
      : []);
    if (moduleKey) completed.add(moduleKey);
    if (!selected.length && moduleKey) selected.push(moduleKey);
    const wasCompleted = assignment.status === 'completed';
    const allDone = wasCompleted || (selected.length > 0 && selected.every((key) => completed.has(key)));

    let creditDeducted = assignment.creditDeducted;
    if (allDone && !wasCompleted && !creditDeducted && organizationId) {
      const debit = await tx.organization.updateMany({
        where: { id: organizationId, credits: { gte: 1 } },
        data: { credits: { decrement: 1 } },
      });
      // Una evaluación ya asignada puede terminar aunque la empresa haya agotado el saldo.
      creditDeducted = debit.count === 1;
      if (!creditDeducted) console.warn('[billing] Evaluación completada sin saldo para el descuento:', assignmentId);
    }

    await tx.assignment.update({
      where: { id: assignmentId },
      data: { completedModules: [...completed], status: allDone ? 'completed' : 'in_progress', creditDeducted },
    });
    return { allDone };
  });
}

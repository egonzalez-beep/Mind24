import { prisma } from '../db/client.js';

export async function createAssignment({
  organizationId,
  candidateId,
  assessmentDefinitionId,
  assignedByUserId,
  selectedModules,
}) {
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: organizationId } });
    if (!org || org.blocked) {
      const err = new Error('ORG_BLOCKED');
      err.code = 'ORG_BLOCKED';
      throw err;
    }
    if (org.credits < 1) {
      const err = new Error('NO_CREDITS');
      err.code = 'NO_CREDITS';
      throw err;
    }

    const cand = await tx.candidate.findFirst({
      where: { id: candidateId, organizationId },
    });
    if (!cand) {
      const err = new Error('NOT_FOUND');
      err.code = 'NOT_FOUND';
      throw err;
    }

    const def = await tx.assessmentDefinition.findFirst({
      where: {
        id: assessmentDefinitionId,
        isActive: true,
        OR: [{ organizationId: null }, { organizationId }],
      },
    });
    if (!def) {
      const err = new Error('DEFINITION_NOT_FOUND');
      err.code = 'DEFINITION_NOT_FOUND';
      throw err;
    }

    await tx.organization.update({
      where: { id: organizationId },
      data: { credits: { decrement: 1 } },
    });

    return tx.assignment.create({
      data: {
        candidateId,
        assessmentDefinitionId,
        assignedByUserId,
        status: 'pending',
        selectedModules:
          Array.isArray(selectedModules) && selectedModules.length > 0
            ? selectedModules.map((s) => String(s))
            : undefined,
      },
    });
  });
}

/**
 * Lista asignaciones de la organización.
 * @param {string} organizationId
 * @param {{ assignedByUserId?: string }} [options] — si `assignedByUserId` está definido, solo asignaciones creadas por ese admin.
 */
export async function listAssignmentsForOrg(organizationId, options = {}) {
  const where = { candidate: { organizationId } };
  if (options.assignedByUserId) {
    where.assignedByUserId = options.assignedByUserId;
  }
  return prisma.assignment.findMany({
    where,
    include: {
      candidate: { include: { user: { select: { email: true, fullName: true } } } },
      assessmentDefinition: { select: { id: true, name: true, key: true, version: true, config: true } },
      attempts: { orderBy: { startedAt: 'desc' }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
  });
}

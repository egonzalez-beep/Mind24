import { prisma } from '../db/client.js';
import { assertOrganizationHasAssignmentCredits } from './organizationBilling.service.js';
import { deleteDigitalInterviewAudioFiles } from '../utils/fileCleaner.js';

/** Asignaciones abiertas que se archivan al registrar una evaluación nueva del mismo candidato. */
const OPEN_ASSIGNMENT_STATUSES = ['pending', 'in_progress'];

/**
 * Archiva evaluaciones anteriores no terminadas del candidato (mismo correo / perfil).
 * No toca asignaciones ya `completed` (historial HR).
 */
export async function archiveOpenAssignmentsForCandidate(tx, candidateId) {
  await tx.assignment.updateMany({
    where: {
      candidateId,
      status: { in: OPEN_ASSIGNMENT_STATUSES },
    },
    data: { status: 'archived' },
  });
}

export async function createAssignment({
  organizationId,
  candidateId,
  assessmentDefinitionId,
  assignedByUserId,
  selectedModules,
}) {
  return prisma.$transaction(async (tx) => {
    await assertOrganizationHasAssignmentCredits(tx, organizationId);

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

    await archiveOpenAssignmentsForCandidate(tx, candidateId);

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
      attempts: { orderBy: { submittedAt: 'desc' } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Elimina asignación e intentos (cascade). No restaura créditos ya cobrados al completar.
 */
export async function deleteAssignmentForOrg(assignmentId, organizationId, options = {}) {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, candidate: { organizationId } },
    select: {
      id: true,
      assignedByUserId: true,
      attempts: { select: { results: true } },
    },
  });
  if (!assignment) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (
    options.assignedByUserId &&
    assignment.assignedByUserId !== options.assignedByUserId
  ) {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    err.message = 'No puedes eliminar evaluaciones creadas por otro administrador.';
    throw err;
  }

  // Best-effort cleanup (ignore missing files)
  for (const att of assignment.attempts || []) {
    const audios = att?.results && typeof att.results === 'object' ? att.results.audios : null;
    await deleteDigitalInterviewAudioFiles(audios);
  }

  await prisma.assignment.delete({ where: { id: assignmentId } });
  return { deleted: true, id: assignmentId };
}

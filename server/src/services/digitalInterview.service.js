import { prisma } from '../db/client.js';
import { resolveModuleKey } from '../utils/moduleCatalog.js';
import { completeAssignmentAttempt } from './organizationBilling.service.js';

export async function submitDigitalInterviewAudios(userId, attemptId, audios) {
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id: attemptId, assignment: { candidate: { userId } } },
    include: {
      assignment: {
        include: {
          candidate: { select: { organizationId: true } },
        },
      },
    },
  });
  if (!attempt) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (attempt.status !== 'in_progress') {
    const err = new Error('INVALID_STATE');
    err.code = 'INVALID_STATE';
    throw err;
  }
  const mk = resolveModuleKey(attempt.moduleKey || '');
  if (mk !== 'digital_interview') {
    const err = new Error('MODULE_NOT_CONFIGURED');
    err.code = 'MODULE_NOT_CONFIGURED';
    err.message = 'Este intento no corresponde al módulo de Entrevista Digital.';
    throw err;
  }

  const { allDone } = await completeAssignmentAttempt({
    assignmentId: attempt.assignmentId,
    attemptId: attempt.id,
    organizationId: attempt.assignment.candidate.organizationId,
    moduleKey: mk,
    attemptData: {
      submittedAt: new Date(),
      results: { status: 'COMPLETED', audios },
      interpretation: {
        verdict: 'Entrevista digital completada',
        badge: '◈',
        description: 'Entrevista Digital Estructurada enviada correctamente.',
      },
    },
  });

  return { ok: true, assignmentCompleted: allDone };
}


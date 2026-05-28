import { prisma } from '../db/client.js';
import { resolveModuleKey } from '../utils/moduleCatalog.js';
import { applyAssignmentCompletionUpdate } from './organizationBilling.service.js';

function readCompletedModules(assignment) {
  const raw = assignment.completedModules;
  if (Array.isArray(raw) && raw.length) return raw.map((x) => String(x));
  return [];
}

function selectedModuleKeys(assignment) {
  const raw = assignment.selectedModules;
  if (Array.isArray(raw) && raw.length) return raw.map((x) => String(x));
  return [];
}

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

  const assignment = attempt.assignment;
  const prevCompleted = readCompletedModules(assignment);
  const nextCompleted =
    mk && !prevCompleted.includes(mk) ? [...prevCompleted, mk] : prevCompleted;

  let selected = selectedModuleKeys(assignment).map((k) => resolveModuleKey(k));
  if (!selected.length && mk) selected = [mk];
  const allDone = selected.length > 0 && selected.every((k) => nextCompleted.includes(k));

  const organizationId = assignment.candidate.organizationId;
  const submittedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.assessmentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'submitted',
        submittedAt,
        results: { status: 'COMPLETED', audios },
        interpretation: {
          verdict: 'Entrevista digital completada',
          badge: '◈',
          description: 'Entrevista Digital Estructurada enviada correctamente.',
        },
      },
    });

    await applyAssignmentCompletionUpdate(tx, {
      assignmentId: assignment.id,
      organizationId,
      nextCompleted,
      allDone,
    });
  });

  return { ok: true, assignmentCompleted: allDone };
}


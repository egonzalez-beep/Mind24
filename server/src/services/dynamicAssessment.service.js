import { prisma } from '../db/client.js';
import { moduleMetaForKey, resolveModuleKey } from '../utils/moduleCatalog.js';

const questionInclude = {
  options: { orderBy: { sortOrder: 'asc' } },
};

export function serializeQuestion(q) {
  return {
    id: q.id,
    type: q.type,
    text: q.text,
    metadata: q.metadata ?? null,
    sortOrder: q.sortOrder,
    options: (q.options || []).map((o) => ({
      id: o.id,
      label: o.label,
      value: o.value,
      metadata: o.metadata ?? null,
      sortOrder: o.sortOrder,
    })),
  };
}

export async function getActiveModuleWithQuestions(moduleKey) {
  const key = resolveModuleKey(moduleKey);
  return prisma.evaluationModule.findFirst({
    where: { key, isActive: true },
    include: {
      questions: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: questionInclude,
      },
    },
  });
}

export async function moduleHasDynamicQuestions(moduleKey) {
  const mod = await getActiveModuleWithQuestions(moduleKey);
  return Boolean(mod?.questions?.length);
}

export async function getAttemptEnginePayload(userId, attemptId) {
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id: attemptId, assignment: { candidate: { userId } } },
    include: {
      candidateResponses: true,
    },
  });
  if (!attempt) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const mod = attempt.moduleKey
    ? await getActiveModuleWithQuestions(attempt.moduleKey)
    : null;
  if (!mod?.questions?.length) {
    const err = new Error('DYNAMIC_ENGINE_NOT_AVAILABLE');
    err.code = 'DYNAMIC_ENGINE_NOT_AVAILABLE';
    throw err;
  }
  const answered = new Set(attempt.candidateResponses.map((r) => r.questionId));
  return {
    engine: 'dynamic',
    attemptId: attempt.id,
    assignmentId: attempt.assignmentId,
    moduleKey: attempt.moduleKey,
    moduleTitle: mod.title,
    timeLimitSec: attempt.timeLimitSec,
    status: attempt.status,
    questions: mod.questions.map(serializeQuestion),
    answeredQuestionIds: [...answered],
  };
}

/**
 * Si el módulo tiene preguntas en BD, devuelve payload de inicio dinámico.
 * Reutiliza intento en curso o crea uno nuevo (llamado desde attempt.service).
 */
export async function buildDynamicStartPayload({
  assignmentId,
  moduleKey,
  attemptId,
  timeLimitSec,
  startedAt,
  resumed,
}) {
  const mod = await getActiveModuleWithQuestions(moduleKey);
  if (!mod?.questions?.length) return null;

  const meta = moduleMetaForKey(moduleKey);
  return {
    engine: 'dynamic',
    attemptId,
    assignmentId,
    moduleKey,
    moduleTitle: mod.title,
    timeLimitSec: timeLimitSec ?? 900,
    startedAt,
    resumed,
    questions: mod.questions.map(serializeQuestion),
    answeredQuestionIds: [],
  };
}

export async function saveCandidateResponse(userId, attemptId, payload) {
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id: attemptId, assignment: { candidate: { userId } } },
    include: { assignment: true },
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

  const question = await prisma.question.findUnique({
    where: { id: payload.questionId },
    include: { module: true, options: true },
  });
  if (!question || question.module.key !== resolveModuleKey(attempt.moduleKey || '')) {
    const err = new Error('QUESTION_NOT_IN_MODULE');
    err.code = 'QUESTION_NOT_IN_MODULE';
    throw err;
  }

  const data = { answeredAt: new Date() };

  switch (question.type) {
    case 'MULTIPLE_CHOICE':
      if (!payload.selectedOptionId) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
      data.selectedOptionId = payload.selectedOptionId;
      data.moreOptionId = null;
      data.lessOptionId = null;
      data.textValue = null;
      data.audioUrl = null;
      break;
    case 'CLEAVER_MATRIX':
      if (!payload.moreOptionId || !payload.lessOptionId) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
      if (payload.moreOptionId === payload.lessOptionId) {
        const err = new Error('CLEAVER_SAME_MORE_LESS');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
      data.moreOptionId = payload.moreOptionId;
      data.lessOptionId = payload.lessOptionId;
      data.selectedOptionId = null;
      data.textValue = null;
      data.audioUrl = null;
      break;
    case 'OPEN_TEXT':
      if (!payload.textValue || !String(payload.textValue).trim()) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
      data.textValue = String(payload.textValue).trim();
      data.selectedOptionId = null;
      data.moreOptionId = null;
      data.lessOptionId = null;
      data.audioUrl = null;
      break;
    case 'AUDIO_RECORDING':
      if (!payload.audioUrl || !String(payload.audioUrl).trim()) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
      data.audioUrl = String(payload.audioUrl).trim();
      data.selectedOptionId = null;
      data.moreOptionId = null;
      data.lessOptionId = null;
      data.textValue = null;
      break;
    default:
      break;
  }

  const row = await prisma.candidateResponse.upsert({
    where: {
      attemptId_questionId: { attemptId, questionId: question.id },
    },
    create: { attemptId, questionId: question.id, ...data },
    update: data,
  });

  return { ok: true, responseId: row.id, questionId: question.id };
}

function readCompletedModules(assignment) {
  const raw = assignment.completedModules;
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x));
}

function selectedModuleKeys(assignment) {
  const raw = assignment.selectedModules;
  if (Array.isArray(raw) && raw.length) return raw.map((x) => String(x));
  return [];
}

export async function completeDynamicAttempt(userId, attemptId) {
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id: attemptId, assignment: { candidate: { userId } } },
    include: {
      assignment: true,
      candidateResponses: true,
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

  const mod = await getActiveModuleWithQuestions(attempt.moduleKey || '');
  const requiredIds = new Set((mod?.questions || []).map((q) => q.id));
  const answeredIds = new Set(attempt.candidateResponses.map((r) => r.questionId));
  for (const qid of requiredIds) {
    if (!answeredIds.has(qid)) {
      const err = new Error('INCOMPLETE_ANSWERS');
      err.code = 'INCOMPLETE_ANSWERS';
      err.details = { missing: [...requiredIds].filter((id) => !answeredIds.has(id)) };
      throw err;
    }
  }

  const mk = attempt.moduleKey || '';
  const assignment = attempt.assignment;
  const prevCompleted = readCompletedModules(assignment);
  const nextCompleted = mk && !prevCompleted.includes(mk) ? [...prevCompleted, mk] : prevCompleted;
  let selected = selectedModuleKeys(assignment);
  if (!selected.length && mk) selected = [mk];
  const allDone = selected.length > 0 && selected.every((k) => nextCompleted.includes(k));

  await prisma.$transaction(async (tx) => {
    await tx.assessmentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
        interpretation: {
          verdict: 'Módulo completado',
          badge: '✓',
          description: `Completaste el módulo ${mod?.title || mk}.`,
        },
      },
    });
    await tx.assignment.update({
      where: { id: assignment.id },
      data: {
        completedModules: nextCompleted,
        status: allDone ? 'completed' : 'in_progress',
      },
    });
  });

  return {
    ok: true,
    moduleKey: mk,
    assignmentCompleted: allDone,
    message: 'Módulo enviado correctamente.',
  };
}

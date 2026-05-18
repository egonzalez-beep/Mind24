import { prisma } from '../db/client.js';
import { filterConfigByModule, moduleMetaForKey } from '../utils/moduleCatalog.js';
import { scoreAssessment, sanitizeConfigForClient, submitAnswersSchema } from './scoring.service.js';

function getTimeLimitSec(config) {
  const m = config?.meta?.timeLimitSec;
  return typeof m === 'number' && m > 0 ? m : 2700;
}

export async function listMyAssignments(userId) {
  const cand = await prisma.candidate.findUnique({ where: { userId } });
  if (!cand) return [];
  return prisma.assignment.findMany({
    where: { candidateId: cand.id },
    include: {
      assessmentDefinition: { select: { id: true, name: true, key: true, version: true } },
      attempts: { orderBy: { startedAt: 'desc' } },
    },
    orderBy: { createdAt: 'desc' },
  });
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

export async function startAttempt(userId, assignmentId, { moduleKey } = {}) {
  const cand = await prisma.candidate.findUnique({ where: { userId } });
  if (!cand) {
    const err = new Error('NOT_CANDIDATE');
    err.code = 'NOT_CANDIDATE';
    throw err;
  }

  const mk = moduleKey ? String(moduleKey).trim() : '';
  if (!mk) {
    const err = new Error('MODULE_KEY_REQUIRED');
    err.code = 'MODULE_KEY_REQUIRED';
    throw err;
  }

  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, candidateId: cand.id },
    include: {
      assessmentDefinition: true,
      attempts: { where: { status: 'in_progress', moduleKey: mk } },
    },
  });
  if (!assignment) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const completed = new Set(readCompletedModules(assignment));
  if (completed.has(mk)) {
    const err = new Error('MODULE_ALREADY_COMPLETED');
    err.code = 'MODULE_ALREADY_COMPLETED';
    throw err;
  }

  const allowed = selectedModuleKeys(assignment);
  if (allowed.length && !allowed.includes(mk)) {
    const err = new Error('MODULE_NOT_ASSIGNED');
    err.code = 'MODULE_NOT_ASSIGNED';
    throw err;
  }

  const fullConfig = assignment.assessmentDefinition.config;
  const moduleConfig = filterConfigByModule(fullConfig, mk);
  const meta = moduleMetaForKey(mk);
  const timeLimitSec = moduleConfig.meta?.timeLimitSec || meta.estimatedMinutes * 60;

  const existing = assignment.attempts[0];
  if (existing) {
    return {
      attemptId: existing.id,
      assignmentId: assignment.id,
      moduleKey: mk,
      timeLimitSec: existing.timeLimitSec ?? timeLimitSec,
      config: sanitizeConfigForClient(moduleConfig),
      startedAt: existing.startedAt,
      resumed: true,
    };
  }

  const attempt = await prisma.$transaction(async (tx) => {
    const a = await tx.assessmentAttempt.create({
      data: {
        assignmentId: assignment.id,
        moduleKey: mk,
        status: 'in_progress',
        timeLimitSec,
      },
    });
    if (assignment.status === 'pending') {
      await tx.assignment.update({
        where: { id: assignment.id },
        data: { status: 'in_progress' },
      });
    }
    return a;
  });

  return {
    attemptId: attempt.id,
    assignmentId: assignment.id,
    moduleKey: mk,
    timeLimitSec,
    config: sanitizeConfigForClient(moduleConfig),
    startedAt: attempt.startedAt,
    resumed: false,
  };
}

export async function submitAttempt(userId, attemptId, rawAnswers) {
  const parsed = submitAnswersSchema.safeParse(rawAnswers);
  if (!parsed.success) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.details = parsed.error.flatten();
    throw err;
  }
  const answers = parsed.data;

  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id: attemptId, assignment: { candidate: { userId } } },
    include: {
      assignment: {
        include: {
          assessmentDefinition: true,
          candidate: true,
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

  const mk = attempt.moduleKey || '';
  const fullConfig = attempt.assignment.assessmentDefinition.config;
  const moduleConfig = mk ? filterConfigByModule(fullConfig, mk) : fullConfig;
  const limit = attempt.timeLimitSec ?? getTimeLimitSec(moduleConfig);
  const deadline = new Date(attempt.startedAt.getTime() + limit * 1000);
  if (new Date() > deadline) {
    await prisma.assessmentAttempt.update({
      where: { id: attempt.id },
      data: { status: 'expired', submittedAt: new Date() },
    });
    const err = new Error('TIME_EXPIRED');
    err.code = 'TIME_EXPIRED';
    throw err;
  }

  const scored = scoreAssessment(moduleConfig, answers);

  const assignment = attempt.assignment;
  const prevCompleted = readCompletedModules(assignment);
  const nextCompleted = mk && !prevCompleted.includes(mk) ? [...prevCompleted, mk] : prevCompleted;

  let selected = selectedModuleKeys(assignment);
  if (!selected.length && mk) {
    selected = [mk];
  }
  const allDone = selected.length > 0 && selected.every((k) => nextCompleted.includes(k));

  await prisma.$transaction(async (tx) => {
    await tx.assessmentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
        responses: answers,
        scores: {
          global: scored.global,
          dimensions: scored.dimensions,
          meta: { ...(scored.meta || {}), moduleKey: mk || null },
        },
        interpretation: {
          verdict: scored.verdict,
          badge: scored.badge,
          description: scored.description,
        },
        flags: scored.flags,
      },
    });
    await tx.assignment.update({
      where: { id: attempt.assignmentId },
      data: {
        completedModules: nextCompleted,
        status: allDone ? 'completed' : 'in_progress',
      },
    });
  });

  return { ...scored, moduleKey: mk || null, assignmentCompleted: allDone };
}

export async function getAttemptResult(userId, attemptId) {
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id: attemptId, assignment: { candidate: { userId } } },
    include: { assignment: { include: { assessmentDefinition: { select: { name: true } } } } },
  });
  if (!attempt) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (attempt.status !== 'submitted') {
    const err = new Error('NOT_SUBMITTED');
    err.code = 'NOT_SUBMITTED';
    throw err;
  }
  return {
    assessmentName: attempt.assignment.assessmentDefinition.name,
    scores: attempt.scores,
    interpretation: attempt.interpretation,
    flags: attempt.flags,
    submittedAt: attempt.submittedAt,
  };
}

import { prisma } from '../db/client.js';
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

export async function startAttempt(userId, assignmentId) {
  const cand = await prisma.candidate.findUnique({ where: { userId } });
  if (!cand) {
    const err = new Error('NOT_CANDIDATE');
    err.code = 'NOT_CANDIDATE';
    throw err;
  }

  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, candidateId: cand.id },
    include: { assessmentDefinition: true, attempts: { where: { status: 'in_progress' } } },
  });
  if (!assignment) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (assignment.status === 'completed') {
    const err = new Error('ALREADY_COMPLETED');
    err.code = 'ALREADY_COMPLETED';
    throw err;
  }

  const config = assignment.assessmentDefinition.config;
  const timeLimitSec = getTimeLimitSec(config);

  const existing = assignment.attempts[0];
  if (existing) {
    return {
      attemptId: existing.id,
      assignmentId: assignment.id,
      timeLimitSec,
      config: sanitizeConfigForClient(config),
      startedAt: existing.startedAt,
      resumed: true,
    };
  }

  const attempt = await prisma.$transaction(async (tx) => {
    const a = await tx.assessmentAttempt.create({
      data: {
        assignmentId: assignment.id,
        status: 'in_progress',
        timeLimitSec,
      },
    });
    await tx.assignment.update({
      where: { id: assignment.id },
      data: { status: 'in_progress' },
    });
    return a;
  });

  return {
    attemptId: attempt.id,
    assignmentId: assignment.id,
    timeLimitSec,
    config: sanitizeConfigForClient(config),
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

  const fullConfig = attempt.assignment.assessmentDefinition.config;
  const limit = attempt.timeLimitSec ?? getTimeLimitSec(fullConfig);
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

  const scored = scoreAssessment(fullConfig, answers);

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
          meta: scored.meta,
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
      data: { status: 'completed' },
    });
  });

  return scored;
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

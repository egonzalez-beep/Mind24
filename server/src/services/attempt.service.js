import { prisma } from '../db/client.js';
import { sjtSalesTotalTimeSeconds } from '../data/sjtSalesData.js';
import { termanTotalTimeSeconds } from '../data/termanData.js';
import {
  filterConfigByModule,
  isLegacyJsonModule,
  moduleMetaForKey,
  resolveModuleKey,
} from '../utils/moduleCatalog.js';
import { buildDynamicStartPayload, moduleHasDynamicQuestions } from './dynamicAssessment.service.js';
import {
  applyReliabilityToAttemptPayload,
  computeAttemptSpeedReliability,
} from './attemptReliability.service.js';
import { scoreAssessment, sanitizeConfigForClient, submitAnswersSchema } from './scoring.service.js';
import { buildCandidateAttemptStatus } from '../utils/candidateAttemptResponse.js';
import { applyAssignmentCompletionUpdate, chargeOrganizationCreditPostTx } from './organizationBilling.service.js';

function getTimeLimitSec(config) {
  const m = config?.meta?.timeLimitSec;
  return typeof m === 'number' && m > 0 ? m : 2700;
}

function resolveModuleTimeLimitSec(moduleKey, moduleConfig, meta) {
  const mk = resolveModuleKey(moduleKey);
  if (mk === 'cleaver') return null;
  if (mk === 'terman') return termanTotalTimeSeconds();
  if (mk === 'sales_sjt') return sjtSalesTotalTimeSeconds();
  const fromConfig = moduleConfig?.meta?.timeLimitSec;
  if (typeof fromConfig === 'number' && fromConfig > 0) return fromConfig;
  if (meta?.estimatedMinutes != null && meta.estimatedMinutes > 0) {
    return meta.estimatedMinutes * 60;
  }
  return 2700;
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

function legacyStartPayload({
  attemptId,
  assignmentId,
  moduleKey,
  timeLimitSec,
  moduleConfig,
  startedAt,
  resumed,
}) {
  return {
    engine: 'legacy',
    attemptId,
    assignmentId,
    moduleKey,
    timeLimitSec,
    config: sanitizeConfigForClient(moduleConfig),
    startedAt,
    resumed,
  };
}

/** Motor dinámico (BD) o legacy JSON solo para honestidad — sin mezclar instrumentos. */
async function resolveModuleStartPayload({
  assignmentId,
  moduleKey,
  attemptId,
  timeLimitSec,
  moduleConfig,
  startedAt,
  resumed,
}) {
  const hasDynamic = await moduleHasDynamicQuestions(moduleKey);

  if (hasDynamic) {
    const dynamicPayload = await buildDynamicStartPayload({
      assignmentId,
      moduleKey,
      attemptId,
      timeLimitSec,
      startedAt,
      resumed,
    });
    if (!dynamicPayload) {
      const err = new Error('DYNAMIC_ENGINE_NOT_AVAILABLE');
      err.code = 'DYNAMIC_ENGINE_NOT_AVAILABLE';
      err.message = 'El módulo no tiene preguntas dinámicas activas.';
      throw err;
    }
    return dynamicPayload;
  }

  if (isLegacyJsonModule(moduleKey)) {
    return legacyStartPayload({
      attemptId,
      assignmentId,
      moduleKey,
      timeLimitSec,
      moduleConfig,
      startedAt,
      resumed,
    });
  }

  const err = new Error('MODULE_NOT_CONFIGURED');
  err.code = 'MODULE_NOT_CONFIGURED';
  err.message =
    'Este módulo aún no está disponible. Contacta al administrador o vuelve al lobby.';
  throw err;
}

export async function startAttempt(userId, assignmentId, { moduleKey } = {}) {
  const cand = await prisma.candidate.findUnique({ where: { userId } });
  if (!cand) {
    const err = new Error('NOT_CANDIDATE');
    err.code = 'NOT_CANDIDATE';
    throw err;
  }

  const mk = moduleKey ? resolveModuleKey(String(moduleKey).trim()) : '';
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
  if (assignment.status === 'archived') {
    const err = new Error('ASSIGNMENT_ARCHIVED');
    err.code = 'ASSIGNMENT_ARCHIVED';
    err.message =
      'Esta evaluación ya no está disponible. Usa la clave de acceso de tu evaluación más reciente.';
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
  const timeLimitSec = resolveModuleTimeLimitSec(mk, moduleConfig, meta);

  const existing = assignment.attempts[0];
  if (existing) {
    return resolveModuleStartPayload({
      assignmentId: assignment.id,
      moduleKey: mk,
      attemptId: existing.id,
      timeLimitSec: existing.timeLimitSec ?? timeLimitSec,
      moduleConfig,
      startedAt: existing.startedAt,
      resumed: true,
    });
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

  return resolveModuleStartPayload({
    assignmentId: assignment.id,
    moduleKey: mk,
    attemptId: attempt.id,
    timeLimitSec,
    moduleConfig,
    startedAt: attempt.startedAt,
    resumed: false,
  });
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
  const questionCount = Object.keys(answers).length;
  const reliability = computeAttemptSpeedReliability({
    startedAt: attempt.startedAt,
    submittedAt: new Date(),
    questionCount,
  });
  const persisted = applyReliabilityToAttemptPayload(
    {
      global: scored.global,
      dimensions: scored.dimensions,
      meta: { ...(scored.meta || {}), moduleKey: mk || null },
    },
    scored.flags,
    reliability,
  );

  const assignment = attempt.assignment;
  // Resolvemos las keys para que coincidan con las escritas por dynamicAssessment.service.js
  const resolvedMk = resolveModuleKey(mk);
  const prevCompleted = readCompletedModules(assignment);
  const nextCompleted =
    resolvedMk && !prevCompleted.includes(resolvedMk)
      ? [...prevCompleted, resolvedMk]
      : prevCompleted;

  let selected = selectedModuleKeys(assignment).map((k) => resolveModuleKey(k));
  if (!selected.length && resolvedMk) {
    selected = [resolvedMk];
  }
  const allDone = selected.length > 0 && selected.every((k) => nextCompleted.includes(k));
  const organizationId = attempt.assignment.candidate.organizationId;

  console.log('[BILLING:submitAttempt] módulo:', resolvedMk, '| selected:', selected, '| nextCompleted:', nextCompleted, '| allDone:', allDone, '| org:', organizationId);

  const billingResult = await prisma.$transaction(async (tx) => {
    await tx.assessmentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
        responses: answers,
        scores: persisted.scores,
        interpretation: {
          verdict: scored.verdict,
          badge: scored.badge,
          description: scored.description,
        },
        flags: persisted.flags,
      },
    });
    return applyAssignmentCompletionUpdate(tx, {
      assignmentId: attempt.assignmentId,
      organizationId,
      nextCompleted,
      allDone,
    });
  });

  // El cobro corre FUERA de la tx para que nunca revierta el intento completado.
  if (billingResult.claimed) {
    try {
      await chargeOrganizationCreditPostTx(organizationId);
    } catch (chargeErr) {
      console.error('[BILLING] Error al descontar crédito post-tx (intento guardado):', chargeErr.message);
    }
  }

  return { ...scored, moduleKey: resolvedMk || null, assignmentCompleted: allDone };
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

/** Estado de intento para candidato — sin datos psicométricos. */
export async function getCandidateAttemptStatus(userId, attemptId) {
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id: attemptId, assignment: { candidate: { userId } } },
    include: { assignment: { include: { assessmentDefinition: { select: { name: true } } } } },
  });
  if (!attempt) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return buildCandidateAttemptStatus(attempt);
}

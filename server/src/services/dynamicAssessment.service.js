import { prisma } from '../db/client.js';
import { moduleMetaForKey, resolveModuleKey } from '../utils/moduleCatalog.js';
import { TERMAN_SERIES } from '../data/termanData.js';
import {
  buildCleaverAttemptScores,
  scoreCleaverResponses,
} from './cleaverScoring.service.js';
import {
  buildSjtSalesAttemptScores,
  scoreSjtSalesResponses,
} from './sjtSalesScoring.service.js';
import {
  buildTermanAttemptScores,
  scoreTermanResponses,
} from './termanScoring.service.js';
import {
  applyReliabilityToAttemptPayload,
  computeAttemptSpeedReliability,
} from './attemptReliability.service.js';
import { applyAssignmentCompletionUpdate } from './organizationBilling.service.js';

const questionInclude = {
  options: { orderBy: { sortOrder: 'asc' } },
};

function clientQuestionMetadata(metadata, moduleKey) {
  if (!metadata || typeof metadata !== 'object') return null;
  const rk = resolveModuleKey(moduleKey);
  if (rk === 'sales_sjt') {
    const { scenarioIndex } = metadata;
    return scenarioIndex != null ? { scenarioIndex: Number(scenarioIndex) } : null;
  }
  return metadata;
}

function clientOptionMetadata(metadata, moduleKey) {
  if (!metadata || typeof metadata !== 'object') return null;
  if (resolveModuleKey(moduleKey) === 'sales_sjt') return null;
  return metadata;
}

export function serializeQuestion(q, moduleKey = '') {
  return {
    id: q.id,
    type: q.type,
    text: q.text,
    metadata: clientQuestionMetadata(q.metadata, moduleKey),
    sortOrder: q.sortOrder,
    options: (q.options || []).map((o) => ({
      id: o.id,
      label: o.label,
      value: o.value,
      metadata: clientOptionMetadata(o.metadata, moduleKey),
      sortOrder: o.sortOrder,
    })),
  };
}

export async function getActiveModuleWithQuestions(moduleKey) {
  const key = resolveModuleKey(moduleKey);
  const mod = await prisma.evaluationModule.findFirst({
    where: { key, isActive: true },
    include: {
      questions: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: questionInclude,
      },
    },
  });
  if (!mod) return null;
  // Aislamiento estricto: solo preguntas cuyo moduleId pertenece a este módulo.
  const questions = (mod.questions || []).filter((q) => q.moduleId === mod.id);
  return { ...mod, questions };
}

export async function moduleHasDynamicQuestions(moduleKey) {
  const key = resolveModuleKey(moduleKey);
  const mod = await getActiveModuleWithQuestions(moduleKey);
  const ok = Boolean(mod?.questions?.length);
  if (!ok) {
    console.warn('[dynamic] moduleHasDynamicQuestions=false', {
      requestedKey: moduleKey,
      resolvedKey: key,
      moduleFound: Boolean(mod),
      questionCount: mod?.questions?.length ?? 0,
    });
  }
  return ok;
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
    questions: mod.questions.map((q) => serializeQuestion(q, attempt.moduleKey || '')),
    answeredQuestionIds: [...answered],
  };
}

/**
 * Si el módulo tiene preguntas en BD, devuelve payload de inicio dinámico.
 * Reutiliza intento en curso o crea uno nuevo (llamado desde attempt.service).
 */
/** Agrupa preguntas BD en series Terman para el cliente. */
export function buildTermanSeriesPayload(questions) {
  const bySeries = new Map();
  for (const q of questions) {
    const meta = q.metadata && typeof q.metadata === 'object' ? q.metadata : {};
    const seriesId = meta.seriesId;
    if (!seriesId) continue;
    if (!bySeries.has(seriesId)) {
      const def = TERMAN_SERIES.find((s) => s.seriesId === seriesId);
      bySeries.set(seriesId, {
        seriesId,
        name: meta.seriesName || def?.name || seriesId,
        timeLimitSeconds: meta.seriesTimeLimitSeconds ?? def?.timeLimitSeconds ?? 120,
        instruction: meta.seriesInstruction || def?.instructions || def?.instruction || '',
        seriesIndex: meta.seriesIndex ?? 0,
        questions: [],
      });
    }
    bySeries.get(seriesId).questions.push(serializeQuestion(q, 'terman'));
  }
  return [...bySeries.values()]
    .sort((a, b) => a.seriesIndex - b.seriesIndex)
    .map((s) => ({
      ...s,
      questions: s.questions.sort((a, b) => a.sortOrder - b.sortOrder),
    }));
}

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
  const resolved = resolveModuleKey(moduleKey);
  const base = {
    engine: 'dynamic',
    attemptId,
    assignmentId,
    moduleKey: resolved,
    moduleTitle: mod.title,
    timeLimitSec: timeLimitSec ?? 900,
    startedAt,
    resumed,
    questions: mod.questions.map((q) => serializeQuestion(q, resolved)),
    answeredQuestionIds: [],
  };

  if (resolved === 'terman') {
    base.assessmentMode = 'terman';
    base.termanSeries = buildTermanSeriesPayload(mod.questions);
    base.totalSeries = base.termanSeries.length;
  }

  if (resolved === 'sales_sjt') {
    base.assessmentMode = 'sales_sjt';
    base.totalScenarios = mod.questions.length;
  }

  return base;
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

export async function completeDynamicAttempt(userId, attemptId, options = {}) {
  const timedOut = !!options.timedOut;
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id: attemptId, assignment: { candidate: { userId } } },
    include: {
      assignment: { include: { candidate: { select: { organizationId: true } } } },
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
  const mk = attempt.moduleKey || '';
  const resolvedKey = resolveModuleKey(mk);

  const questionCount =
    resolvedKey === 'terman'
      ? (mod?.questions || []).length
      : (mod?.questions || []).length;

  if (resolvedKey !== 'terman' && !timedOut) {
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
  }

  const submittedAt = new Date();
  const reliability = computeAttemptSpeedReliability({
    startedAt: attempt.startedAt,
    submittedAt,
    questionCount: questionCount || attempt.candidateResponses.length || 1,
  });
  const assignment = attempt.assignment;
  const prevCompleted = readCompletedModules(assignment);
  const nextCompleted =
    resolvedKey && !prevCompleted.includes(resolvedKey)
      ? [...prevCompleted, resolvedKey]
      : prevCompleted;
  let selected = selectedModuleKeys(assignment).map((k) => resolveModuleKey(k));
  if (!selected.length && resolvedKey) selected = [resolvedKey];
  const allDone =
    selected.length > 0 && selected.every((k) => nextCompleted.includes(k));
  const organizationId = assignment.candidate.organizationId;
  const previousAssignmentStatus = assignment.status;

  let attemptScores = null;
  let interpretation = {
    verdict: 'Módulo completado',
    badge: '✓',
    description: `Completaste el módulo ${mod?.title || mk}.`,
  };

  if (resolvedKey === 'cleaver') {
    const cleaverRows = await prisma.candidateResponse.findMany({
      where: { attemptId: attempt.id },
      include: {
        moreOption: true,
        lessOption: true,
        question: { select: { sortOrder: true } },
      },
    });
    cleaverRows.sort((a, b) => a.question.sortOrder - b.question.sortOrder);
    const cleaverResponses = cleaverRows;

    const scoring = scoreCleaverResponses(
      cleaverResponses.map((r) => ({
        questionId: r.questionId,
        moreOptionId: r.moreOptionId,
        lessOptionId: r.lessOptionId,
        moreOption: r.moreOption,
        lessOption: r.lessOption,
      })),
    );

    attemptScores = buildCleaverAttemptScores(scoring);
    const { total } = scoring;
    const dominant = ['D', 'I', 'S', 'C']
      .map((k) => ({ k, v: total[k] }))
      .sort((a, b) => b.v - a.v)[0];
    interpretation = {
      verdict: 'Perfil Cleaver calculado',
      badge: '◈',
      description: `Perfil total dominante: ${dominant.k} (${dominant.v >= 0 ? '+' : ''}${dominant.v}). Revisa el gráfico Más / Menos / Total.`,
      cleaverProfile: dominant.k,
    };
  }

  if (resolvedKey === 'terman') {
    const termanRows = await prisma.candidateResponse.findMany({
      where: { attemptId: attempt.id },
      include: {
        selectedOption: true,
        question: { select: { metadata: true, sortOrder: true } },
      },
    });
    const scoring = scoreTermanResponses(termanRows);
    attemptScores = buildTermanAttemptScores(scoring);
    const topSeries = [...scoring.series].sort((a, b) => b.percent - a.percent)[0];
    interpretation = {
      verdict: 'Evaluación cognitiva calificada',
      badge: '◈',
      description: `Puntaje bruto ${scoring.rawScore}/${scoring.totalQuestions} (${scoring.percentCorrect}% aciertos). ${
        topSeries ? `Serie más fuerte: ${topSeries.name}.` : ''
      } CI oficial en calibración.`,
      termanRawScore: scoring.rawScore,
    };
  }

  if (resolvedKey === 'sales_sjt') {
    const sjtRows = await prisma.candidateResponse.findMany({
      where: { attemptId: attempt.id },
      include: {
        selectedOption: true,
        question: { select: { metadata: true, sortOrder: true } },
      },
    });
    const scoring = scoreSjtSalesResponses(sjtRows);
    attemptScores = buildSjtSalesAttemptScores(scoring);
    interpretation = {
      verdict: scoring.profileLabel,
      badge: '◈',
      description: scoring.profileDescription,
      profileLabel: scoring.profileLabel,
      profileDescription: scoring.profileDescription,
      profileKey: scoring.profileKey,
      global: scoring.percentScore,
      sjtRawScore: scoring.rawScore,
      sjtMaxScore: scoring.maxPossible,
    };
  }

  let persistedScores = attemptScores?.scores ?? null;
  let persistedFlags = [];
  if (attemptScores?.scores) {
    const merged = applyReliabilityToAttemptPayload(
      attemptScores.scores,
      [],
      reliability,
    );
    persistedScores = merged.scores;
    persistedFlags = merged.flags;
  } else if (reliability.isUnreliableSpeed) {
    const merged = applyReliabilityToAttemptPayload(null, [], reliability);
    persistedScores = merged.scores;
    persistedFlags = merged.flags;
  }

  await prisma.$transaction(async (tx) => {
    await tx.assessmentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'submitted',
        submittedAt,
        scores: persistedScores ?? undefined,
        interpretation,
        flags: persistedFlags.length ? persistedFlags : undefined,
      },
    });
    await applyAssignmentCompletionUpdate(tx, {
      assignmentId: assignment.id,
      organizationId,
      previousStatus: previousAssignmentStatus,
      nextCompleted,
      allDone,
    });
  });

  return {
    ok: true,
    moduleKey: mk,
    assignmentCompleted: allDone,
    message: 'Módulo enviado correctamente.',
    scores: attemptScores?.scores ?? null,
    interpretation,
  };
}

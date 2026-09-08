/**
 * Inspección read-only de un AssessmentAttempt (diagnóstico POST /complete).
 *
 * Uso:
 *   node server/scripts/inspect-attempt.mjs <attemptId>
 *
 * Requiere DATABASE_URL en server/.env o entorno.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { resolveModuleKey } from '../src/utils/moduleCatalog.js';
import { resolveOptionDimension } from '../src/services/cleaverScoring.service.js';
import { CLEAVER_TETRAD_COUNT } from '../src/data/cleaverData.js';
import { TERMAN_MAX_RAW_SCORE } from '../src/data/termanData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const attemptId = process.argv[2];
if (!attemptId) {
  console.error('Uso: node server/scripts/inspect-attempt.mjs <attemptId>');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL no configurada.');
  process.exit(1);
}

const prisma = new PrismaClient();

function auditCleaverResponses(rows) {
  const issues = [];
  const keySources = new Set();
  let invalidMetadata = 0;
  let unscoredMore = 0;
  let unscoredLess = 0;
  let sameOptionId = 0;

  for (const row of rows) {
    if (row.moreOptionId && row.moreOptionId === row.lessOptionId) {
      sameOptionId++;
      issues.push({ questionId: row.questionId, type: 'same_option_id', optionId: row.moreOptionId });
      continue;
    }
    try {
      const more = resolveOptionDimension(row.moreOption, 'more');
      const less = resolveOptionDimension(row.lessOption, 'less');
      keySources.add(more.source);
      keySources.add(less.source);
      if (!more.dimension) unscoredMore++;
      if (!less.dimension) unscoredLess++;
    } catch (err) {
      invalidMetadata++;
      issues.push({
        questionId: row.questionId,
        type: err.message,
        moreOptionId: row.moreOptionId,
        lessOptionId: row.lessOptionId,
        details: err.details ?? null,
      });
    }
  }

  return {
    invalidMetadata,
    sameOptionId,
    unscoredMore,
    unscoredLess,
    keySources: [...keySources].sort(),
    issues,
  };
}

function auditTermanResponses(rows) {
  let withSelection = 0;
  let missingMeta = 0;
  for (const row of rows) {
    if (row.selectedOptionId) withSelection++;
    if (!row.question?.metadata) missingMeta++;
  }
  return { withSelection, missingMeta, total: rows.length };
}

async function main() {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: {
      assignment: {
        include: {
          candidate: {
            include: {
              organization: { select: { id: true, name: true, credits: true, blocked: true } },
            },
          },
        },
      },
      candidateResponses: {
        include: {
          question: { select: { id: true, type: true, sortOrder: true, moduleId: true, metadata: true } },
          selectedOption: { select: { id: true, sortOrder: true, metadata: true, value: true } },
          moreOption: { select: { id: true, sortOrder: true, metadata: true, value: true } },
          lessOption: { select: { id: true, sortOrder: true, metadata: true, value: true } },
        },
      },
    },
  });

  if (!attempt) {
    console.log(JSON.stringify({ found: false, attemptId }, null, 2));
    return;
  }

  const rawMk = attempt.moduleKey || '';
  const resolvedKey = resolveModuleKey(rawMk);
  const assignment = attempt.assignment;
  const org = assignment?.candidate?.organization;

  const mod = await prisma.evaluationModule.findFirst({
    where: { key: resolvedKey, isActive: true },
    include: { questions: { where: { isActive: true }, select: { id: true, type: true } } },
  });

  const expectedQuestions = mod?.questions?.length ?? 0;
  const responseCount = attempt.candidateResponses.length;
  const answeredQuestionIds = new Set(attempt.candidateResponses.map((r) => r.questionId));
  const missingQuestionIds = (mod?.questions || [])
    .map((q) => q.id)
    .filter((id) => !answeredQuestionIds.has(id));

  let moduleAudit = null;
  if (resolvedKey === 'cleaver') {
    moduleAudit = {
      kind: 'cleaver',
      expectedTetrads: CLEAVER_TETRAD_COUNT,
      ...auditCleaverResponses(attempt.candidateResponses),
    };
  } else if (resolvedKey === 'terman') {
    moduleAudit = {
      kind: 'terman',
      expectedItems: TERMAN_MAX_RAW_SCORE,
      ...auditTermanResponses(attempt.candidateResponses),
    };
  }

  const selectedModules = Array.isArray(assignment?.selectedModules)
    ? assignment.selectedModules.map((x) => resolveModuleKey(String(x)))
    : [];
  const completedModules = Array.isArray(assignment?.completedModules)
    ? assignment.completedModules.map((x) => String(x))
    : [];
  const completedModulesResolved = completedModules.map((x) => resolveModuleKey(x));

  const siblingAttempts = await prisma.assessmentAttempt.findMany({
    where: { assignmentId: assignment.id },
    select: {
      id: true,
      moduleKey: true,
      status: true,
      submittedAt: true,
    },
    orderBy: { startedAt: 'asc' },
  });

  const report = {
    found: true,
    attemptId: attempt.id,
    moduleKey: {
      raw: rawMk,
      resolved: resolvedKey,
      logWouldShow: resolvedKey,
      aliasMismatch: rawMk !== resolvedKey,
    },
    status: attempt.status,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    responses: {
      count: responseCount,
      expectedActiveQuestions: expectedQuestions,
      missingQuestionIds: missingQuestionIds.slice(0, 10),
      missingCount: missingQuestionIds.length,
    },
    moduleAudit,
    assignment: {
      id: assignment.id,
      status: assignment.status,
      creditDeducted: assignment.creditDeducted,
      selectedModules,
      completedModules,
      completedModulesResolved,
    },
    organization: org
      ? { id: org.id, name: org.name, credits: org.credits, blocked: org.blocked }
      : null,
    siblingAttempts,
    inferredCompleteFailure: null,
  };

  if (org && org.credits < 1 && assignment.status !== 'completed') {
    const allSelectedDone =
      selectedModules.length > 0 &&
      selectedModules.every((k) => {
        const raw = completedModules.includes(k);
        const resolved = completedModulesResolved.includes(k);
        return raw || resolved || k === resolvedKey;
      });
    report.inferredCompleteFailure = {
      hypothesis: 'NO_CREDITS',
      note: 'Si billing pre-cbeb7fe cobra dentro de la tx y credits=0, falla al allDone=true.',
      orgCredits: org.credits,
    };
  }

  if (moduleAudit?.invalidMetadata > 0 || moduleAudit?.sameOptionId > 0) {
    report.inferredCompleteFailure = {
      hypothesis: 'VALIDATION_ERROR',
      cleaverIssues: moduleAudit,
    };
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

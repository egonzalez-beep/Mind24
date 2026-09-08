/**
 * Auditoría read-only del banco Cleaver en BD frente a la clave M/L canónica.
 *
 * Uso:
 *   node server/scripts/audit-cleaver-question.mjs [questionId] [attemptId]
 *
 * Sin argumentos audita el banco completo. Nunca escribe.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import {
  CLEAVER_TETRAD_COUNT,
  cleaverBankValidation,
  cleaverBlockByOrder,
  cleaverOptionMetadataEquals,
} from '../src/data/cleaverData.js';
import { resolveOptionDimension } from '../src/services/cleaverScoring.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const questionId = process.argv[2];
const attemptId = process.argv[3];

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL no configurada.');
  process.exit(1);
}

const prisma = new PrismaClient();

function questionOrder(question) {
  const meta = question?.metadata;
  const declared =
    meta && typeof meta === 'object' && !Array.isArray(meta)
      ? Number(meta.order ?? meta.blockNumber)
      : Number.NaN;
  if (Number.isInteger(declared) && declared >= 1 && declared <= CLEAVER_TETRAD_COUNT) {
    return declared;
  }
  return Number(question?.sortOrder) + 1;
}

function describeOption(option) {
  const meta = option.metadata && typeof option.metadata === 'object' ? option.metadata : {};
  return {
    id: option.id,
    label: option.label,
    value: option.value,
    keySchema: meta.keySchema ?? null,
    keyStatus: meta.keyStatus ?? null,
    dimensionMore: Object.prototype.hasOwnProperty.call(meta, 'dimensionMore') ? meta.dimensionMore : undefined,
    dimensionLess: Object.prototype.hasOwnProperty.call(meta, 'dimensionLess') ? meta.dimensionLess : undefined,
    legacyDimension: meta.dimension ?? null,
  };
}

function auditQuestion(question) {
  const order = questionOrder(question);
  const block = cleaverBlockByOrder(order);
  const drift = [];

  if (!block) {
    drift.push({ type: 'unknown_block', order });
    return { order, drift, canonical: false };
  }

  const canonicalByLabel = new Map(block.options.map((o) => [o.text, o]));
  for (const option of question.options) {
    const canonical = canonicalByLabel.get(option.label);
    if (!canonical) {
      drift.push({ type: 'label_not_in_bank', optionId: option.id, label: option.label });
      continue;
    }
    if (!cleaverOptionMetadataEquals(option.metadata, canonical.metadata)) {
      drift.push({
        type: 'metadata_drift',
        optionId: option.id,
        label: option.label,
        persisted: option.metadata,
        canonical: canonical.metadata,
      });
    }
    if ((option.value ?? '') !== canonical.value) {
      drift.push({
        type: 'value_drift',
        optionId: option.id,
        label: option.label,
        persisted: option.value,
        canonical: canonical.value,
      });
    }
  }

  if (question.options.length !== block.options.length) {
    drift.push({ type: 'option_count', persisted: question.options.length, expected: block.options.length });
  }

  return { order, drift, canonical: drift.length === 0 };
}

async function main() {
  const allCleaver = await prisma.question.findMany({
    where: { type: 'CLEAVER_MATRIX', isActive: true },
    include: { options: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { sortOrder: 'asc' },
  });

  const perQuestion = allCleaver.map((q) => {
    const audit = auditQuestion(q);
    return {
      questionId: q.id,
      sortOrder: q.sortOrder,
      blockOrder: audit.order,
      inSyncWithCanonicalKey: audit.canonical,
      drift: audit.drift,
    };
  });

  const outOfSync = perQuestion.filter((q) => !q.inSyncWithCanonicalKey);

  let focusQuestion = null;
  if (questionId) {
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: {
        module: { select: { key: true, title: true } },
        options: { orderBy: { sortOrder: 'asc' } },
      },
    });
    focusQuestion = question
      ? {
          id: question.id,
          text: question.text,
          sortOrder: question.sortOrder,
          blockOrder: questionOrder(question),
          moduleKey: question.module?.key,
          metadata: question.metadata,
          options: question.options.map(describeOption),
          audit: auditQuestion(question),
        }
      : { error: 'QUESTION_NOT_FOUND', questionId };
  }

  let response = null;
  if (attemptId && questionId) {
    const row = await prisma.candidateResponse.findUnique({
      where: { attemptId_questionId: { attemptId, questionId } },
      include: { moreOption: true, lessOption: true },
    });
    if (row) {
      const resolve = (option, role) => {
        try {
          const res = resolveOptionDimension(option, role);
          return { dimension: res.dimension, source: res.source, error: null };
        } catch (err) {
          return { dimension: undefined, source: null, error: err.message };
        }
      };
      const more = resolve(row.moreOption, 'more');
      const less = resolve(row.lessOption, 'less');
      response = {
        attemptId,
        more: { optionId: row.moreOptionId, label: row.moreOption?.label, ...more },
        less: { optionId: row.lessOptionId, label: row.lessOption?.label, ...less },
        sameOptionId: row.moreOptionId === row.lessOptionId,
        scorable: !more.error && !less.error,
      };
    }
  }

  console.log(
    JSON.stringify(
      {
        canonicalBank: {
          ok: cleaverBankValidation.ok,
          summary: cleaverBankValidation.summary,
          warnings: cleaverBankValidation.warnings,
        },
        database: {
          activeTetrads: allCleaver.length,
          expectedTetrads: CLEAVER_TETRAD_COUNT,
          inSyncWithCanonicalKey: outOfSync.length === 0,
          outOfSyncCount: outOfSync.length,
          outOfSync,
        },
        focusQuestion,
        candidateResponse: response,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

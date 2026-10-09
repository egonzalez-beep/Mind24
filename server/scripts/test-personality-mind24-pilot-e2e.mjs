/**
 * Personalidad Mind24 — smoke piloto end-to-end (catálogo, asignación, motor, scoring).
 * Ejecutar: node server/scripts/test-personality-mind24-pilot-e2e.mjs
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://test:test@127.0.0.1:5432/test';

import {
  PERSONALIDAD_MIND24_DIMENSIONS,
  PERSONALIDAD_MIND24_SCALE,
  personalityPilotItemsFlat,
  personalityProductionItemsFlat,
  personalityQuestionCount,
  personalitySyncableItemsFlat,
} from '../src/data/personalityMind24Data.js';
import {
  ASSIGNABLE_MODULE_KEYS,
  DEFAULT_SELECTED_MODULES,
  MODULE_CATALOG,
  filterAssignableModuleKeys,
  isModuleActiveInDb,
  isOfferableModuleKey,
} from '../src/utils/moduleCatalog.js';
import { ensurePersonalityMind24Questions } from '../src/services/evaluationCatalog.service.js';
import {
  assertNoPersonalityScoringMetadata,
  serializeQuestion,
} from '../src/services/dynamicAssessment.service.js';
import {
  buildPersonalityApplicationQualityMeta,
  buildPersonalityMind24AttemptScores,
  computePersonalityMind24Completeness,
  scorePersonalityMind24Responses,
} from '../src/services/personalityMind24Scoring.service.js';
import {
  mergePersonalityAttemptResults,
  orderQuestionsByPresentation,
  personalityExpectedItemsFromQuestions,
  readPersonalityPresentationOrder,
  resolvePersonalityPresentationOrder,
} from '../src/services/personalityMind24Presentation.service.js';

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function createMockDb() {
  let questionSeq = 0;
  let optionSeq = 0;
  const questions = new Map();
  const modules = new Map([['mod-pm24', { id: 'mod-pm24', description: '' }]]);
  const db = {
    evaluationModule: {
      async findUnique({ where, select }) {
        const mod = modules.get(where.id);
        if (!mod) return null;
        if (!select) return { ...mod };
        const out = {};
        for (const key of Object.keys(select)) {
          if (select[key]) out[key] = mod[key];
        }
        return out;
      },
      async update({ where, data }) {
        const mod = modules.get(where.id);
        Object.assign(mod, data);
        return mod;
      },
    },
    question: {
      async count({ where }) {
        let n = 0;
        for (const q of questions.values()) {
          if (q.moduleId !== where.moduleId) continue;
          if (where.type && q.type !== where.type) continue;
          if (where.isActive != null && q.isActive !== where.isActive) continue;
          n += 1;
        }
        return n;
      },
      async findMany({ where, include }) {
        const rows = [];
        for (const q of questions.values()) {
          if (where.moduleId && q.moduleId !== where.moduleId) continue;
          if (where.type && q.type !== where.type) continue;
          if (where.id?.in && !where.id.in.includes(q.id)) continue;
          const row = { ...q, options: [...q.options.values()].sort((a, b) => a.sortOrder - b.sortOrder) };
          if (!include?.options) delete row.options;
          rows.push(row);
        }
        return rows.sort((a, b) => a.sortOrder - b.sortOrder);
      },
      async create({ data }) {
        const id = `q-${++questionSeq}`;
        const options = new Map();
        if (data.options?.create) {
          for (const opt of data.options.create) {
            const oid = `o-${++optionSeq}`;
            options.set(oid, { id: oid, questionId: id, ...opt });
          }
        }
        const record = {
          id,
          moduleId: data.moduleId,
          type: data.type,
          text: data.text,
          metadata: data.metadata,
          sortOrder: data.sortOrder,
          isActive: true,
          options,
        };
        questions.set(id, record);
        return record;
      },
      async update({ where, data }) {
        const q = questions.get(where.id);
        Object.assign(q, data);
        return q;
      },
      async delete({ where }) {
        questions.delete(where.id);
      },
    },
    questionOption: {
      async create({ data }) {
        const id = `o-${++optionSeq}`;
        const q = questions.get(data.questionId);
        const opt = { id, ...data };
        q.options.set(id, opt);
        return opt;
      },
      async update({ where, data }) {
        for (const q of questions.values()) {
          const opt = q.options.get(where.id);
          if (opt) {
            Object.assign(opt, data);
            return opt;
          }
        }
        throw new Error('option not found');
      },
    },
    _questions: questions,
  };
  return db;
}

function dbQuestionsFromSync(db) {
  return [...db._questions.values()].map((q) => ({
    ...q,
    options: [...q.options.values()].sort((a, b) => a.sortOrder - b.sortOrder),
  }));
}

console.log('\n=== Personalidad Mind24 — piloto E2E (Fase 4B) ===\n');

console.log('--- [1] Banco y módulo activo ---\n');

check(personalityPilotItemsFlat().length === 80, '80 ítems pilot');
check(personalityProductionItemsFlat().length === 0, '0 production');
check(personalitySyncableItemsFlat().length === 80, '80 syncable');
check(personalityQuestionCount() === 0, 'personalityQuestionCount sigue production-only (0)');
check(MODULE_CATALOG.personalidad_mind24.comingSoon === false, 'comingSoon false');
check(isOfferableModuleKey('personalidad_mind24') === true, 'ofertable');
check(isModuleActiveInDb('personalidad_mind24') === true, 'isModuleActiveInDb true');
check(ASSIGNABLE_MODULE_KEYS.includes('personalidad_mind24'), 'en ASSIGNABLE_MODULE_KEYS');
check(
  !DEFAULT_SELECTED_MODULES.includes('personalidad_mind24'),
  'no preseleccionada en DEFAULT_SELECTED_MODULES',
);
check(isOfferableModuleKey('personalidad_mind24') === true, 'sí ofertable si admin la elige');
check(
  filterAssignableModuleKeys(['personalidad_mind24', 'cleaver']).length === 2,
  'filterAssignableModuleKeys mixto',
);

console.log('\n--- [2] Sync catálogo 80×5 ---\n');

const db = createMockDb();
const sync1 = await ensurePersonalityMind24Questions(db, 'mod-pm24');
check(sync1.skipped === false, 'sync: not skipped');
check(sync1.expected === 80, 'sync: expected 80');
check(sync1.created === 80, 'sync: created 80');
check(db._questions.size === 80, 'BD: 80 questions');
const ids = new Set([...db._questions.values()].map((q) => q.metadata.personalityItemId));
check(ids.size === 80, '80 personalityItemId únicos');
let opts = 0;
for (const q of db._questions.values()) opts += q.options.size;
check(opts === 400, '400 opciones totales');

const sync2 = await ensurePersonalityMind24Questions(db, 'mod-pm24');
check(sync2.created === 0, 'idempotencia sync');

console.log('\n--- [3] Start payload candidato (80, sanitizado) ---\n');

const catalogQs = dbQuestionsFromSync(db);
const attempt = { id: 'att-e2e', results: null };
const resolved = resolvePersonalityPresentationOrder(attempt, catalogQs, {
  random: () => 0.42,
});
check(resolved.presentationOrder.length === 80, 'presentationOrder 80');
const ordered = orderQuestionsByPresentation(catalogQs, resolved.presentationOrder);
check(ordered.length === 80, 'payload 80 preguntas');

const clientPayload = ordered.map((q) => serializeQuestion(q, 'personalidad_mind24'));
check(clientPayload.length === 80, 'serialize 80');
check(
  clientPayload.every((q) => q.type === 'MULTIPLE_CHOICE' && q.options.length === 5),
  'MULTIPLE_CHOICE × 5 opciones',
);
check(
  clientPayload[0].options[0].label === PERSONALIDAD_MIND24_SCALE.optionLabels[0],
  'Likert label 1',
);
const forbidden = assertNoPersonalityScoringMetadata({ questions: clientPayload });
check(forbidden.length === 0, 'metadata sanitizada');

console.log('\n--- [4] Resume mismo orden ---\n');

const stored = mergePersonalityAttemptResults(null, resolved.presentationOrder);
const attemptResume = { id: 'att-e2e', results: stored };
const resolved2 = resolvePersonalityPresentationOrder(attemptResume, catalogQs);
check(resolved2.created === false, 'resume: no recrea orden');
check(
  JSON.stringify(resolved2.presentationOrder) === JSON.stringify(resolved.presentationOrder),
  'resume: mismo presentationOrder',
);

console.log('\n--- [5] Completion 79/80 vs 80/80 ---\n');

const expectedItems = personalityExpectedItemsFromQuestions(ordered);
const rows79 = ordered.slice(0, 79).map((q, idx) => ({
  questionId: q.id,
  question: { metadata: q.metadata },
  selectedOption: { value: String((idx % 5) + 1), sortOrder: idx % 5 },
}));
const scored79 = scorePersonalityMind24Responses(rows79, { expectedItems });
check(scored79.form.totalItemsExpected === 80, 'form frozen totalItemsExpected 80');
const comp79 = computePersonalityMind24Completeness(
  ordered.map((q) => q.id),
  rows79.map((r) => ({ questionId: r.questionId })),
);
check(comp79.answeredCount === 79, 'completeness 79/80');
check(comp79.unansweredCount === 1, 'incompleto a 79 (1 omitida)');

const rows80 = ordered.map((q, idx) => ({
  questionId: q.id,
  question: { metadata: q.metadata },
  selectedOption: { value: String((idx % 5) + 1), sortOrder: idx % 5 },
}));
const scored80 = scorePersonalityMind24Responses(rows80, { expectedItems });
check(scored80.form.totalItemsExpected === 80, '80/80 totalItemsExpected');
for (const dim of PERSONALIDAD_MIND24_DIMENSIONS) {
  const d = scored80.dimensions[dim.dimensionId];
  check(d.nAnswered === 8 && d.nExpected === 8, `${dim.dimensionId}: 8/8`);
  check(d.scaleMin === 1 && d.scaleMax === 5, `${dim.dimensionId}: escala 1–5`);
  check(d.mean != null, `${dim.dimensionId}: mean presente`);
}
check(scored80.global === undefined, 'sin global');

const reliabilityFast = {
  isUnreliableSpeed: true,
  avgSecondsPerQuestion: 0.1,
  elapsedMs: 800,
  questionCount: 80,
};
const comp80 = computePersonalityMind24Completeness(
  ordered.map((q) => q.id),
  rows80.map((r) => ({ questionId: r.questionId })),
);
const aq = buildPersonalityApplicationQualityMeta(reliabilityFast, comp80);
check(aq.reliability?.isUnreliableSpeed === undefined, 'sin isUnreliableSpeed');
check(aq.completeness?.answeredCount === 80, 'AQ completeness 80');

const persisted = buildPersonalityMind24AttemptScores(scored80, aq);
check(persisted.instrument === 'personalidad_mind24', 'scores.instrument');
check(persisted.scores.form.totalItemsExpected === 80, 'persist form.totalItemsExpected');
check(!('global' in persisted.scores), 'scores sin global');
check(
  readPersonalityPresentationOrder({ results: stored })?.length === 80,
  'presentationOrder persistible en attempt',
);

console.log(
  failed === 0
    ? '\n✓ Piloto Personalidad Mind24 E2E — OK.\n'
    : `\n✗ ${failed} fallo(s).\n`,
);
process.exit(failed === 0 ? 0 : 1);

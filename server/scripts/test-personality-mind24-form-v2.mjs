/**
 * Personalidad Mind24 — forma activa v2 (60) vs legacy v1 (80).
 * node server/scripts/test-personality-mind24-form-v2.mjs
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://test:test@127.0.0.1:5432/test';

import {
  PERSONALIDAD_MIND24_ACTIVE_FORM_ITEM_IDS,
  PERSONALIDAD_MIND24_ACTIVE_FORM_VERSION,
  PERSONALIDAD_MIND24_DIMENSIONS,
  PERSONALIDAD_MIND24_LEGACY_FORM_VERSION,
  PERSONALIDAD_MIND24_MODULE_KEY,
  PERSONALIDAD_MIND24_RESERVE_FORM_ITEM_IDS,
  PERSONALIDAD_MIND24_SCALE,
  filterPersonalityCatalogQuestionsToActiveForm,
  getPersonalityMind24ActiveFormItems,
  getPersonalityMind24ReserveFormItems,
  personalityMind24BankItemsFlat,
  personalitySyncableItemsFlat,
  validatePersonalityMind24FormPartition,
} from '../src/data/personalityMind24Data.js';
import { ensurePersonalityMind24Questions } from '../src/services/evaluationCatalog.service.js';
import {
  buildPersonalityPresentationOrder,
  mergePersonalityAttemptResults,
  orderQuestionsByPresentation,
  readPersonalityFormMeta,
  readPersonalityPresentationOrder,
  resolvePersonalityAttemptForm,
  resolvePersonalityPresentationOrder,
} from '../src/services/personalityMind24Presentation.service.js';
import {
  computePersonalityMind24Completeness,
  scorePersonalityMind24Responses,
} from '../src/services/personalityMind24Scoring.service.js';
import {
  buildPersonalityMind24ModuleFragment,
  extractPersonalityMind24Scores,
} from '../src/reports/fragments/personalityMind24Report.fragment.js';

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function dbQuestionsFromItems(items) {
  return items.map((item, idx) => ({
    id: `db-q-${item.itemId}`,
    moduleId: 'mod-pm24',
    type: 'MULTIPLE_CHOICE',
    text: item.text,
    sortOrder: item.sortOrder ?? idx + 1,
    metadata: {
      personalityItemId: item.itemId,
      dimensionId: item.dimensionId,
      direction: item.direction,
      bankStatus: item.bankStatus,
    },
    options: PERSONALIDAD_MIND24_SCALE.optionLabels.map((label, j) => ({
      id: `opt-${item.itemId}-${j + 1}`,
      label,
      value: String(j + 1),
      sortOrder: j,
    })),
  }));
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
          if (where.isActive != null && q.isActive !== where.isActive) continue;
          if (where.id?.in && !where.id.in.includes(q.id)) continue;
          const row = {
            ...q,
            options: [...q.options.values()].sort((a, b) => a.sortOrder - b.sortOrder),
          };
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

function buildReportScores(totalItemsExpected, itemsPerDimension) {
  const dimensions = {};
  for (const dim of PERSONALIDAD_MIND24_DIMENSIONS) {
    dimensions[dim.dimensionId] = {
      dimensionId: dim.dimensionId,
      label: dim.label,
      mean: 3.0,
      nAnswered: itemsPerDimension,
      nExpected: itemsPerDimension,
      scaleMin: 1,
      scaleMax: 5,
    };
  }
  return {
    instrument: PERSONALIDAD_MIND24_MODULE_KEY,
    catalogVersion: itemsPerDimension === 6 ? 2 : 1,
    form: { itemsPerDimension, totalItemsExpected },
    dimensions,
    meta: {
      applicationQuality: {
        completeness: {
          expectedCount: totalItemsExpected,
          answeredCount: totalItemsExpected,
        },
      },
    },
  };
}

console.log('\n=== Personalidad Mind24 — forma activa v2 (Fase 4D) ===\n');

console.log('--- A/B/C: banco, activa, reserva ---\n');

const partition = validatePersonalityMind24FormPartition();
check(partition.ok, `validatePersonalityMind24FormPartition (${partition.errors[0] || 'ok'})`);
check(personalityMind24BankItemsFlat().length === 80, 'banco: 80 ítems');
check(getPersonalityMind24ActiveFormItems().length === 60, 'activa: 60 ítems');
check(getPersonalityMind24ReserveFormItems().length === 20, 'reserva: 20 ítems');
const activeIds = new Set(getPersonalityMind24ActiveFormItems().map((i) => i.itemId));
const reserveIds = new Set(getPersonalityMind24ReserveFormItems().map((i) => i.itemId));
check(
  PERSONALIDAD_MIND24_ACTIVE_FORM_ITEM_IDS.every((id) => activeIds.has(id)),
  'shortlist activa exacta',
);
check(
  PERSONALIDAD_MIND24_RESERVE_FORM_ITEM_IDS.every((id) => reserveIds.has(id)),
  'shortlist reserva exacta',
);
for (const rid of reserveIds) {
  check(!activeIds.has(rid), `reserva ${rid} no está en activa`);
}

console.log('\n--- D: nuevo intento 60 ---\n');

const bankQs = dbQuestionsFromItems(
  personalitySyncableItemsFlat().map((i) => ({ ...i, bankStatus: 'pilot' })),
);
const activeQs = filterPersonalityCatalogQuestionsToActiveForm(bankQs);
check(activeQs.length === 60, 'filtro catálogo → 60');
const resolved60 = resolvePersonalityPresentationOrder({ results: null }, activeQs);
check(resolved60.presentationOrder.length === 60, 'presentationOrder nuevo = 60');
const perDim60 = new Map();
for (const qid of resolved60.presentationOrder) {
  const q = activeQs.find((x) => x.id === qid);
  const dim = q.metadata.dimensionId;
  perDim60.set(dim, (perDim60.get(dim) || 0) + 1);
}
for (const dim of PERSONALIDAD_MIND24_DIMENSIONS) {
  check(perDim60.get(dim.dimensionId) === 6, `nuevo intento dim ${dim.dimensionId}: 6`);
}

console.log('\n--- E: completion 60 ---\n');

const ordered60 = orderQuestionsByPresentation(activeQs, resolved60.presentationOrder);
const rows59 = ordered60.slice(0, 59).map((q) => ({
  questionId: q.id,
  question: { metadata: q.metadata },
  selectedOption: { value: '3', sortOrder: 2 },
}));
const scored59 = scorePersonalityMind24Responses(rows59, {
  expectedItems: getPersonalityMind24ActiveFormItems(),
  formVersion: PERSONALIDAD_MIND24_ACTIVE_FORM_VERSION,
});
check(scored59.form.totalItemsExpected === 60, 'scoring expected 60');
check(scored59.dimensions.logro_persistencia.nExpected === 6, 'nExpected dim = 6');
const comp59 = computePersonalityMind24Completeness(
  ordered60.map((q) => q.id),
  rows59.map((r) => ({ questionId: r.questionId })),
);
check(comp59.answeredCount === 59, '59/60 incomplete');

console.log('\n--- F: legacy 80 congelado ---\n');

const legacyQs = bankQs;
const order80 = buildPersonalityPresentationOrder(legacyQs, { random: () => 0.5 });
check(order80.length === 80, 'legacy order 80');
const attemptLegacy = {
  id: 'att-legacy',
  results: mergePersonalityAttemptResults(null, order80, {
    formVersion: PERSONALIDAD_MIND24_LEGACY_FORM_VERSION,
  }),
};
const metaLegacy = readPersonalityFormMeta(attemptLegacy);
check(metaLegacy.formVersion === PERSONALIDAD_MIND24_LEGACY_FORM_VERSION, 'formVersion legacy 1');
check(metaLegacy.totalItemsExpected === 80, 'legacy totalItemsExpected 80');

const shrinkResolve = resolvePersonalityPresentationOrder(attemptLegacy, activeQs);
check(shrinkResolve.frozen === true, 'legacy no migra a 60');
check(shrinkResolve.presentationOrder.length === 80, 'legacy conserva 80 IDs');

const mockDb80 = createMockDb();
for (const q of legacyQs) mockDb80._questions.set(q.id, q);
const frozenForm = await resolvePersonalityAttemptForm(mockDb80, attemptLegacy, activeQs);
check(frozenForm.questions.length === 80, 'resume legacy: 80 preguntas');

console.log('\n--- G: reporte conteos dinámicos ---\n');

const att60 = { scores: buildReportScores(60, 6) };
const att80 = { scores: buildReportScores(80, 8) };
const ex60 = extractPersonalityMind24Scores(att60);
const ex80 = extractPersonalityMind24Scores(att80);
check(ex60 != null && ex60.form.totalItemsExpected === 60, 'extract 60');
check(ex80 != null && ex80.form.totalItemsExpected === 80, 'extract legacy 80');
const html60 = buildPersonalityMind24ModuleFragment({ scores: ex60, submittedAt: '12 oct 2026' });
const html80 = buildPersonalityMind24ModuleFragment({ scores: ex80, submittedAt: '12 oct 2026' });
check(html60.includes('Aplicación completa: 60/60 respuestas.'), 'reporte v2: 60/60');
check(html80.includes('Aplicación completa: 80/80 respuestas.'), 'reporte legacy: 80/80');

console.log('\n--- H: intro/progreso no hardcodean 80 ---\n');

const fs = await import('fs');
const path = await import('path');
const { fileURLToPath } = await import('url');
const indexPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf8');
check(!indexHtml.includes('80 preguntas'), 'index: sin literal "80 preguntas"');
check(!indexHtml.includes('80 reactivos'), 'index: sin literal "80 reactivos"');
check(indexHtml.includes('questions.length') || indexHtml.includes('totalQuestions'), 'index: total derivado del intento');

console.log('\n--- I: sync idempotente (80 en BD, 60 activos) ---\n');

const db = createMockDb();
const sync1 = await ensurePersonalityMind24Questions(db, 'mod-pm24');
const sync2 = await ensurePersonalityMind24Questions(db, 'mod-pm24');
check(sync1.expected === 80, 'sync expected 80 bank');
check(sync2.created === 0, 'sync idempotente');
check(db._questions.size === 80, 'BD mantiene 80 questions');
const syncedQs = [...db._questions.values()].map((q) => ({
  ...q,
  options: [...q.options.values()].sort((a, b) => a.sortOrder - b.sortOrder),
}));
check(filterPersonalityCatalogQuestionsToActiveForm(syncedQs).length === 60, 'activos 60 post-sync');

console.log(
  failed === 0
    ? `\n✓ Forma activa v2 — ${PERSONALIDAD_MIND24_ACTIVE_FORM_ITEM_IDS.length} ítems OK.\n`
    : `\n✗ ${failed} fallo(s).\n`,
);
process.exitCode = failed ? 1 : 0;

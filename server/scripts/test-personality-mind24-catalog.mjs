/**
 * Regresión — catálogo Personalidad Mind24 (draft / pilot / production / sync BD).
 * Ejecutar: node server/scripts/test-personality-mind24-catalog.mjs
 */
import {
  PERSONALIDAD_MIND24_ITEMS,
  PERSONALIDAD_MIND24_SCALE,
  personalityDraftItemsFlat,
  personalityExpectedCountByDimension,
  personalityItemsFlat,
  personalityPilotItemsFlat,
  personalityProductionItemsFlat,
  personalityQuestionCount,
  personalitySyncableItemsFlat,
  personalitySyncableQuestionCount,
  validatePersonalityMind24ItemBank,
} from '../src/data/personalityMind24Data.js';
import {
  ensurePersonalityMind24Questions,
  personalityMind24LikertOptionsCreatePayload,
} from '../src/services/evaluationCatalog.service.js';
import { scorePersonalityMind24Responses } from '../src/services/personalityMind24Scoring.service.js';

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
  /** @type {Map<string, object>} */
  const questions = new Map();
  /** @type {Map<string, object>} */
  const modules = new Map([['mod-pm24', { id: 'mod-pm24', description: '' }]]);

  const db = {
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
          if (q.moduleId !== where.moduleId) continue;
          if (where.type && q.type !== where.type) continue;
          if (where.isActive != null && q.isActive !== where.isActive) continue;
          const row = { ...q };
          if (include?.options) {
            row.options = [...q.options.values()].sort(
              (a, b) => a.sortOrder - b.sortOrder,
            );
          }
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
        if (!q) throw new Error('question not found');
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
        if (!q) throw new Error('question not found');
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
    _questions: questions,
  };
  return db;
}

console.log('\n=== Personalidad Mind24 — catálogo (Fase 4A.2) ===\n');

const bank = validatePersonalityMind24ItemBank();
check(bank.ok, 'banco: validatePersonalityMind24ItemBank');
if (!bank.ok) {
  for (const e of bank.errors) console.error(`       ${e}`);
}

check(PERSONALIDAD_MIND24_ITEMS.length === 80, 'piloto: 80 ítems en código (dim. 1–10, banco v1)');
check(
  PERSONALIDAD_MIND24_ITEMS.every((i) => i.bankStatus === 'pilot'),
  'piloto: todos bankStatus pilot',
);
check(personalityDraftItemsFlat().length === 0, 'accessor: 0 draft');
check(personalityPilotItemsFlat().length === 80, 'accessor: 80 pilot');
check(personalityProductionItemsFlat().length === 0, 'accessor: 0 production');
check(personalitySyncableItemsFlat().length === 80, 'accessor: 80 syncable (pilot)');
check(personalityQuestionCount() === 60, 'personalityQuestionCount = 60 (forma activa v2)');
check(personalitySyncableQuestionCount() === 80, 'personalitySyncableQuestionCount = 80');

const ids = new Set(PERSONALIDAD_MIND24_ITEMS.map((i) => i.itemId));
check(ids.size === PERSONALIDAD_MIND24_ITEMS.length, 'itemId únicos');

const sorts = new Set(PERSONALIDAD_MIND24_ITEMS.map((i) => i.sortOrder));
check(sorts.size === PERSONALIDAD_MIND24_ITEMS.length, 'sortOrder únicos');

const inverseCount = PERSONALIDAD_MIND24_ITEMS.filter((i) => i.direction === 'inverse').length;
check(inverseCount === 10, 'piloto: 10 inversos');

console.log('\n--- CASO A: banco pilot completo → sync 80 ---\n');

const dbFullPilot = createMockDb();
const fullFirst = await ensurePersonalityMind24Questions(dbFullPilot, 'mod-pm24');
check(fullFirst.skipped === false, 'pilot full: no skipped');
check(fullFirst.expected === 80, 'pilot full: expected = 80');
check(fullFirst.created === 80, 'pilot full: 80 Questions creadas');
check(dbFullPilot._questions.size === 80, 'pilot full: 80 preguntas en BD mock');
let optionCount = 0;
for (const q of dbFullPilot._questions.values()) optionCount += q.options.size;
check(optionCount === 400, 'pilot full: 400 QuestionOption');

const fullSecond = await ensurePersonalityMind24Questions(dbFullPilot, 'mod-pm24');
check(fullSecond.created === 0, 'pilot full idempotencia: created = 0');
check(dbFullPilot._questions.size === 80, 'pilot full idempotencia: sigue 80 preguntas');

console.log('\n--- CASO A2: solo draft en fixture → sync omitido ---\n');

const dbDraftOnly = createMockDb();
const skipResult = await ensurePersonalityMind24Questions(dbDraftOnly, 'mod-pm24', [
  { ...PERSONALIDAD_MIND24_ITEMS[0], bankStatus: 'draft' },
]);
check(skipResult.skipped === true, 'draft fixture: skipped = true');
check(skipResult.reason === 'empty_item_bank', 'draft fixture: reason empty_item_bank');
check(dbDraftOnly._questions.size === 0, 'draft fixture: sin preguntas');

console.log('\n--- CASO B: fixture 1 ítem pilot ---\n');

const pilotOne = {
  ...PERSONALIDAD_MIND24_ITEMS[0],
  bankStatus: 'pilot',
};
const dbPilot = createMockDb();
const pilotFirst = await ensurePersonalityMind24Questions(dbPilot, 'mod-pm24', [pilotOne]);
check(pilotFirst.skipped === false, 'pilot: no skipped');
check(pilotFirst.created === 1, 'pilot: 1 Question creada');
check(pilotFirst.expected === 1, 'pilot: expected = 1');
check(dbPilot._questions.size === 1, 'pilot: 1 pregunta persistida');

const [[, qPilot]] = [...dbPilot._questions.entries()];
check(qPilot.type === 'MULTIPLE_CHOICE', 'pilot: tipo MULTIPLE_CHOICE');
check(qPilot.metadata?.personalityItemId === pilotOne.itemId, 'pilot: metadata personalityItemId');
check(qPilot.metadata?.dimensionId === pilotOne.dimensionId, 'pilot: metadata dimensionId');
check(qPilot.metadata?.direction === pilotOne.direction, 'pilot: metadata direction');
check(qPilot.metadata?.bankStatus === 'pilot', 'pilot: metadata bankStatus');
check(qPilot.options.size === 5, 'pilot: 5 QuestionOption');

const likertCanon = personalityMind24LikertOptionsCreatePayload();
const optsSorted = [...qPilot.options.values()].sort((a, b) => a.sortOrder - b.sortOrder);
for (let j = 0; j < 5; j += 1) {
  check(optsSorted[j].label === likertCanon[j].label, `pilot: label opción ${j + 1}`);
  check(optsSorted[j].value === String(j + 1), `pilot: value opción ${j + 1}`);
}

console.log('\n--- CASO C: fixture production ---\n');

const productionOne = {
  ...PERSONALIDAD_MIND24_ITEMS[1],
  bankStatus: 'production',
};
const dbProd = createMockDb();
const prodFirst = await ensurePersonalityMind24Questions(dbProd, 'mod-pm24', [productionOne]);
check(prodFirst.created === 1, 'production: sincronizable (1 creada)');
check(prodFirst.skipped === false, 'production: no skipped');

console.log('\n--- CASO D: idempotencia ---\n');

const pilotSecond = await ensurePersonalityMind24Questions(dbPilot, 'mod-pm24', [pilotOne]);
check(pilotSecond.created === 0, 'idempotencia: created = 0 en 2.ª pasada');
check(dbPilot._questions.size === 1, 'idempotencia: sigue 1 pregunta');
const idsAfter = [...dbPilot._questions.values()].map((q) => q.id);
const pilotThird = await ensurePersonalityMind24Questions(dbPilot, 'mod-pm24', [pilotOne]);
const idsAfterThird = [...dbPilot._questions.values()].map((q) => q.id);
check(idsAfterThird[0] === idsAfter[0], 'idempotencia: question id estable');

console.log('\n--- CASO F: reconciliación de contenido (mismo conteo) ---\n');

const dbReconcile = createMockDb();
const reconcileBase = {
  ...PERSONALIDAD_MIND24_ITEMS[5],
  bankStatus: 'pilot',
};
const reconcileFirst = await ensurePersonalityMind24Questions(dbReconcile, 'mod-pm24', [
  reconcileBase,
]);
check(reconcileFirst.created === 1, 'reconcile: sync inicial 1 creada');
const reconcileId = [...dbReconcile._questions.values()][0].id;
const staleText = [...dbReconcile._questions.values()][0].text;

const reconcileUpdated = {
  ...reconcileBase,
  text: `${reconcileBase.text} (texto revisado)`,
  direction: reconcileBase.direction === 'direct' ? 'inverse' : 'direct',
};
check(reconcileUpdated.text !== staleText, 'reconcile: fixture con texto distinto');

const reconcileSecond = await ensurePersonalityMind24Questions(dbReconcile, 'mod-pm24', [
  reconcileUpdated,
]);
check(reconcileSecond.created === 0, 'reconcile: sin duplicar (created = 0)');
check(dbReconcile._questions.size === 1, 'reconcile: sigue 1 pregunta');

const qReconciled = [...dbReconcile._questions.values()][0];
check(qReconciled.id === reconcileId, 'reconcile: mismo question id');
check(qReconciled.text === reconcileUpdated.text, 'reconcile: texto actualizado en fila existente');
check(
  qReconciled.metadata?.direction === reconcileUpdated.direction,
  'reconcile: metadata direction actualizada',
);

console.log('\n--- CASO E: pilot + production; draft excluido ---\n');

const pilotItem = { ...PERSONALIDAD_MIND24_ITEMS[2], bankStatus: 'pilot' };
const prodItem = { ...PERSONALIDAD_MIND24_ITEMS[3], bankStatus: 'production' };
const draftItem = { ...PERSONALIDAD_MIND24_ITEMS[4], bankStatus: 'draft' };
const dbMix = createMockDb();
const mixResult = await ensurePersonalityMind24Questions(dbMix, 'mod-pm24', [
  pilotItem,
  prodItem,
  draftItem,
]);
check(mixResult.expected === 2, 'mix: expected 2 (draft excluido del fixture sync)');
check(mixResult.created === 2, 'mix: 2 preguntas creadas');
check(dbMix._questions.size === 2, 'mix: 2 en BD');

console.log('\n--- Expected counts (scoring flexible) ---\n');

const allItems = personalityItemsFlat();
const byDim80 = personalityExpectedCountByDimension(allItems);
check(byDim80.logro_persistencia === 8, 'expected dim.1 con 80 ítems = 8');
check(
  personalityExpectedCountByDimension([]).logro_persistencia === 0,
  'expected vacío con arreglo vacío',
);

function rowsForItems(items) {
  return items.map((item) => ({
    questionId: item.itemId,
    question: {
      metadata: {
        personalityItemId: item.itemId,
        dimensionId: item.dimensionId,
        direction: item.direction,
      },
    },
    selectedOption: { value: '4', sortOrder: 3 },
  }));
}

const scoredAll = scorePersonalityMind24Responses(rowsForItems(allItems), {
  expectedItems: allItems,
});
check(scoredAll.form.totalItemsExpected === 80, 'scoring form: totalItemsExpected 80');
check(scoredAll.form.itemsPerDimension === 8, 'scoring form: itemsPerDimension 8');
check(scoredAll.dimensions.logro_persistencia.nExpected === 8, 'scoring: nExpected dim. 1 = 8');
check(scoredAll.dimensions.logro_persistencia.nAnswered === 8, 'scoring: 8 respuestas dim. 1');
check(scoredAll.global === undefined, 'scoring: sin global');

const scoredSyncDefault = scorePersonalityMind24Responses(rowsForItems(allItems));
check(
  scoredSyncDefault.form.totalItemsExpected === 60,
  'scoring default (forma activa v2): totalItemsExpected 60',
);

const likertLabels = PERSONALIDAD_MIND24_SCALE.optionLabels;
check(likertLabels.length === 5, 'Likert: 5 etiquetas en catálogo');

console.log(
  failed === 0
    ? '\n✓ Catálogo Personalidad Mind24 — OK.\n'
    : `\n✗ ${failed} fallo(s).\n`,
);
process.exit(failed === 0 ? 0 : 1);

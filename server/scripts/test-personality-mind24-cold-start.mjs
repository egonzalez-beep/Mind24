/**
 * Cold start — Personalidad Mind24: 0 preguntas, módulo inactivo → bootstrap sync → isActive true.
 * Ejecutar: node server/scripts/test-personality-mind24-cold-start.mjs
 */
import {
  ensurePersonalityMind24Questions,
  reconcilePersonalityMind24ModuleActive,
} from '../src/services/evaluationCatalog.service.js';
import { isModuleActiveInDb } from '../src/utils/moduleCatalog.js';

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function createColdStartDb() {
  let questionSeq = 0;
  let optionSeq = 0;
  const questions = new Map();
  const modules = new Map([
    [
      'personalidad_mind24',
      {
        id: 'mod-pm24',
        key: 'personalidad_mind24',
        title: 'Personalidad Mind24',
        description: '',
        isActive: false,
      },
    ],
  ]);

  return {
    evaluationModule: {
      async findUnique({ where, select }) {
        const mod = [...modules.values()].find((m) => m.id === where.id || m.key === where.key);
        if (!mod) return null;
        if (!select) return { ...mod };
        const out = {};
        for (const key of Object.keys(select)) {
          if (select[key]) out[key] = mod[key];
        }
        return out;
      },
      async update({ where, data }) {
        const mod = modules.get('personalidad_mind24');
        if (where.id && mod.id !== where.id) throw new Error('module not found');
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
          if (q.moduleId !== where.moduleId) continue;
          if (where.type && q.type !== where.type) continue;
          const row = { ...q };
          if (include?.options) {
            row.options = [...q.options.values()].sort((a, b) => a.sortOrder - b.sortOrder);
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
    _modules: modules,
  };
}

console.log('\n=== Personalidad Mind24 — cold start (Fase 4B) ===\n');

console.log('--- Orden bootstrap (referencia) ---\n');
console.log('  1. upsertModules → EvaluationModule (isActive desde catálogo)');
console.log('  2. ensurePersonalityMind24Questions → 80×5 Likert');
console.log('  3. reconcilePersonalityMind24ModuleActive → isActive tras sync\n');

check(isModuleActiveInDb('personalidad_mind24') === true, 'catálogo: módulo elegible para activación');

const db = createColdStartDb();
check(db._questions.size === 0, 'inicial: 0 preguntas Personalidad');
check(db._modules.get('personalidad_mind24').isActive === false, 'inicial: isActive false');

const sync = await ensurePersonalityMind24Questions(db, 'mod-pm24');
check(sync.skipped === false, 'sync: skipped false');
check(sync.expected === 80, 'sync: expected 80');
check(sync.created === 80, 'sync: created 80');
check(db._questions.size === 80, 'final: 80 preguntas');
let opts = 0;
for (const q of db._questions.values()) opts += q.options.size;
check(opts === 400, 'final: 400 opciones');

const rec = await reconcilePersonalityMind24ModuleActive(db, 'mod-pm24', sync);
check(rec.reconciled === true, 'reconcile ejecutado');
check(rec.isActive === true, 'reconcile: isActive true');
check(db._modules.get('personalidad_mind24').isActive === true, 'BD: EvaluationModule.isActive true');

const sync2 = await ensurePersonalityMind24Questions(db, 'mod-pm24');
check(sync2.created === 0, 'segunda pasada: idempotente');
check(db._modules.get('personalidad_mind24').isActive === true, 'isActive se mantiene tras re-sync');

console.log(
  failed === 0
    ? '\n✓ Cold start Personalidad Mind24 — OK.\n'
    : `\n✗ ${failed} fallo(s).\n`,
);
process.exit(failed === 0 ? 0 : 1);

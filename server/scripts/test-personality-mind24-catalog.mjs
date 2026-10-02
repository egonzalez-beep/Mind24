/**
 * Regresión — catálogo Personalidad Mind24 (ítems draft + sync skeleton).
 * Ejecutar: node server/scripts/test-personality-mind24-catalog.mjs
 */
import {
  PERSONALIDAD_MIND24_ITEMS,
  personalityProductionItemsFlat,
  personalityQuestionCount,
  validatePersonalityMind24ItemBank,
} from '../src/data/personalityMind24Data.js';
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

console.log('\n=== Personalidad Mind24 — catálogo (Fase 2A) ===\n');

const bank = validatePersonalityMind24ItemBank();
check(bank.ok, 'banco: validatePersonalityMind24ItemBank');
if (!bank.ok) {
  for (const e of bank.errors) console.error(`       ${e}`);
}

check(PERSONALIDAD_MIND24_ITEMS.length === 8, 'piloto: 8 ítems en código');
check(
  PERSONALIDAD_MIND24_ITEMS.every((i) => i.bankStatus === 'draft'),
  'piloto: todos bankStatus draft',
);
check(personalityProductionItemsFlat().length === 0, 'ningún draft en production flat');
check(personalityQuestionCount() === 0, 'personalityQuestionCount = 0 (sin sync BD)');

const ids = new Set(PERSONALIDAD_MIND24_ITEMS.map((i) => i.itemId));
check(ids.size === PERSONALIDAD_MIND24_ITEMS.length, 'itemId únicos');

const sorts = new Set(PERSONALIDAD_MIND24_ITEMS.map((i) => i.sortOrder));
check(sorts.size === PERSONALIDAD_MIND24_ITEMS.length, 'sortOrder únicos');

const inverseCount = PERSONALIDAD_MIND24_ITEMS.filter((i) => i.direction === 'inverse').length;
check(inverseCount === 1, 'piloto: 1 inverso (pm24_006)');

const rows = PERSONALIDAD_MIND24_ITEMS.map((item) => ({
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
const scored = scorePersonalityMind24Responses(rows);
check(scored.dimensions.logro_persistencia.nAnswered === 8, 'scoring: 8 respuestas dim. 1');
check(scored.dimensions.logro_persistencia.mean != null, 'scoring: mean calculado');
check(scored.global === undefined, 'scoring: sin global tras ítems draft');

console.log(
  failed === 0
    ? '\n✓ Catálogo Personalidad Mind24 — OK.\n'
    : `\n✗ ${failed} fallo(s).\n`,
);
process.exit(failed === 0 ? 0 : 1);

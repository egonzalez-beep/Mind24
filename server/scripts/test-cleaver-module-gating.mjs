/**
 * Verifica que Cleaver vuelva a ser asignable tras retirar comingSoon,
 * sin afectar a los demás módulos.
 * Ejecutar: node server/scripts/test-cleaver-module-gating.mjs
 */
import {
  ASSIGNABLE_MODULE_KEYS,
  DEFAULT_SELECTED_MODULES,
  MODULE_CATALOG,
  filterAssignableModuleKeys,
  isCandidateLobbyModuleKey,
  isComingSoonModuleKey,
  isModuleActiveInDb,
  isOfferableModuleKey,
} from '../src/utils/moduleCatalog.js';
import { errorHandler } from '../src/middleware/error.middleware.js';
import { cleaverBankValidation } from '../src/data/cleaverData.js';

let failed = 0;
let passed = 0;

function check(cond, msg, extra) {
  if (cond) {
    passed++;
    console.log(`  OK  ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL ${msg}`);
    if (extra !== undefined) console.log(`       ${JSON.stringify(extra)}`);
  }
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n=== Cleaver — reactivación como módulo asignable ===');

console.log('\n[1] Estado declarado del catálogo');
check(MODULE_CATALOG.cleaver.comingSoon === false, 'cleaver.comingSoon = false');
check(isComingSoonModuleKey('cleaver') === false, 'isComingSoonModuleKey("cleaver") = false');
check(isComingSoonModuleKey('disc') === false, 'alias "disc" tampoco está comingSoon');
check(
  cleaverBankValidation.summary.fullyVerified === true,
  'la clave M/L sigue 24/24 verified_ml',
  cleaverBankValidation.summary,
);

console.log('\n[2] Puerta de nuevas asignaciones abierta');
check(isOfferableModuleKey('cleaver') === true, 'cleaver es ofertable');
check(isOfferableModuleKey('disc') === true, 'alias "disc" es ofertable');
check(
  eq(filterAssignableModuleKeys(['cleaver']), ['cleaver']),
  'filterAssignableModuleKeys(["cleaver"]) → ["cleaver"]',
);
check(
  eq(filterAssignableModuleKeys(['disc']), ['cleaver']),
  'alias "disc" se resuelve a cleaver en nuevas asignaciones',
);
check(
  eq(filterAssignableModuleKeys(['honestidad', 'cleaver', 'terman']), [
    'honestidad',
    'cleaver',
    'terman',
  ]),
  'selección mixta incluye cleaver',
  filterAssignableModuleKeys(['honestidad', 'cleaver', 'terman']),
);
check(DEFAULT_SELECTED_MODULES.includes('cleaver'), 'DEFAULT_SELECTED_MODULES incluye cleaver');
check(
  eq(DEFAULT_SELECTED_MODULES, [
    'honestidad',
    'cleaver',
    'terman',
    'sales_sjt',
    'digital_interview',
  ]),
  'DEFAULT_SELECTED_MODULES restaura los 5 módulos asignables',
  DEFAULT_SELECTED_MODULES,
);

console.log('\n[3] INVALID_MODULES responde 400, no 500 (defensa intacta)');
{
  let status = null;
  const res = {
    headersSent: false,
    status(s) {
      status = s;
      return this;
    },
    json() {
      return this;
    },
  };
  const err = Object.assign(new Error('Ningún módulo seleccionado está disponible para asignación.'), {
    code: 'INVALID_MODULES',
  });
  errorHandler(err, { originalUrl: '/api/org/assignments', params: {} }, res, () => {});
  check(status === 400, 'errorHandler mapea INVALID_MODULES a 400', status);
}

console.log('\n[4] Motor y lobby operables');
check(isModuleActiveInDb('cleaver') === true, 'el módulo sigue activo en BD');
check(
  MODULE_CATALOG.cleaver.runnableWhileComingSoon === true,
  'runnableWhileComingSoon se conserva (inerte con comingSoon=false)',
);
check(isCandidateLobbyModuleKey('cleaver') === true, 'el lobby muestra cleaver');

console.log('\n[5] Los demás módulos no cambian');
for (const key of ['honestidad', 'terman', 'sales_sjt', 'digital_interview']) {
  check(isOfferableModuleKey(key) === true, `${key} sigue ofertable`);
  check(isModuleActiveInDb(key) === true, `${key} sigue activo en BD`);
  check(isComingSoonModuleKey(key) === false, `${key} no es comingSoon`);
}
check(isModuleActiveInDb('medida') === true, 'medida sigue activo en BD');
check(isOfferableModuleKey('medida') === false, 'medida sigue fuera de asignación directa (sales hook)');
check(isModuleActiveInDb('mrr') === false, 'módulo retirado sigue inactivo');
check(
  eq(ASSIGNABLE_MODULE_KEYS, ['honestidad', 'cleaver', 'terman', 'sales_sjt', 'digital_interview']),
  'ASSIGNABLE_MODULE_KEYS intacto',
  ASSIGNABLE_MODULE_KEYS,
);

console.log('\n[6] Un módulo comingSoon sin runnableWhileComingSoon sí se desactiva');
{
  const original = MODULE_CATALOG.terman.comingSoon;
  MODULE_CATALOG.terman.comingSoon = true;
  check(isModuleActiveInDb('terman') === false, 'comingSoon sin flag runnable → inactivo en BD');
  check(isOfferableModuleKey('terman') === false, 'comingSoon → no ofertable');
  if (original === undefined) delete MODULE_CATALOG.terman.comingSoon;
  else MODULE_CATALOG.terman.comingSoon = original;
  check(isModuleActiveInDb('terman') === true, 'terman restaurado');
}

console.log(
  failed === 0
    ? `\n✓ ${passed} aserciones OK.\n`
    : `\n✗ ${failed} fallo(s) de ${passed + failed} aserciones.\n`,
);
process.exit(failed === 0 ? 0 : 1);

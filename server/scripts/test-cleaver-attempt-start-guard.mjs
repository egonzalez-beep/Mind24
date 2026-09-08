/**
 * Guarda de inicio de intento tras reactivar Cleaver.
 *
 * Con comingSoon=false, Cleaver se comporta como el resto: se puede crear un
 * intento nuevo o reanudar uno in_progress. No se crean duplicados de un
 * intento ya en curso. Un intento submitted no es reanudable en esta capa;
 * startAttempt lo bloquea vía MODULE_ALREADY_COMPLETED si el módulo ya está
 * en completedModules.
 *
 * Ejecutar: node server/scripts/test-cleaver-attempt-start-guard.mjs
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://test:test@127.0.0.1:5432/test';

const { pickResumableAttempt, resolveStartableAttempt } = await import(
  '../src/services/attempt.service.js'
);
const { isComingSoonModuleKey, resolveModuleKey } = await import('../src/utils/moduleCatalog.js');

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

const attempt = (id, moduleKey, status, startedAt = '2026-01-01T00:00:00Z') => ({
  id,
  moduleKey,
  status,
  startedAt: new Date(startedAt),
  timeLimitSec: null,
});

console.log('\n=== Guarda de inicio — Cleaver reactivado ===');

console.log('\n[0] Precondición');
check(isComingSoonModuleKey('cleaver') === false, 'cleaver ya no está comingSoon');
check(resolveModuleKey('disc') === 'cleaver', 'alias disc → cleaver');

console.log('\n[1] Cleaver + attempt existente → reanuda, no duplica');
{
  const attempts = [attempt('a1', 'cleaver', 'in_progress')];
  const resumable = resolveStartableAttempt('cleaver', attempts);
  check(resumable?.id === 'a1', 'reanuda el intento en curso', resumable);
}

console.log('\n[2] Alias `disc` resuelto para crear o reanudar');
{
  check(
    resolveStartableAttempt('disc', []) === null,
    'disc sin intentos → null (se permite crear, startAttempt resuelve a cleaver)',
  );
  const storedAsCleaver = [attempt('a3', 'cleaver', 'in_progress')];
  check(
    resolveStartableAttempt('cleaver', storedAsCleaver)?.id === 'a3',
    'pedir cleaver reanuda el attempt guardado como cleaver',
  );
}

console.log('\n[3] Cleaver sin attempt → permite crear');
{
  check(resolveStartableAttempt('cleaver', []) === null, 'sin intentos → null (crear)');
  check(resolveStartableAttempt('cleaver', undefined) === null, 'lista ausente → null (crear)');
  check(
    resolveStartableAttempt('cleaver', [attempt('t1', 'terman', 'in_progress')]) === null,
    'un intento de otro módulo no se confunde con Cleaver',
  );
}

console.log('\n[4] Attempt submitted existente → no es reanudable (no duplica en esta capa)');
{
  check(
    resolveStartableAttempt('cleaver', [attempt('done', 'cleaver', 'submitted')]) === null,
    'intento submitted no se reanuda',
  );
  check(
    pickResumableAttempt([attempt('done', 'cleaver', 'submitted')], 'cleaver') === null,
    'pickResumableAttempt ignora estados no in_progress',
  );
}

console.log('\n[5] Otros módulos → sin cambios');
for (const key of ['honestidad', 'terman', 'sales_sjt', 'digital_interview']) {
  check(
    resolveStartableAttempt(key, []) === null,
    `${key} sin intentos → null (se permite crear uno nuevo)`,
  );
  check(
    resolveStartableAttempt(key, [attempt('x', key, 'in_progress')])?.id === 'x',
    `${key} con intento en curso → lo reanuda`,
  );
  check(
    resolveStartableAttempt(key, [attempt('y', key, 'submitted')]) === null,
    `${key} con intento submitted → null`,
  );
}
check(
  resolveStartableAttempt('terman', [attempt('z', 'conocimientos', 'in_progress')]) === null,
  'terman NO gana coincidencia por alias (comportamiento previo intacto)',
);

console.log('\n[6] Selección determinista con varios intentos en curso');
{
  const attempts = [
    attempt('early', 'cleaver', 'in_progress', '2026-01-01T00:00:00Z'),
    attempt('late', 'cleaver', 'in_progress', '2026-02-01T00:00:00Z'),
  ];
  check(resolveStartableAttempt('cleaver', attempts)?.id === 'early', 'toma el primero de la lista');
}

console.log(
  failed === 0
    ? `\n✓ ${passed} aserciones OK.\n`
    : `\n✗ ${failed} fallo(s) de ${passed + failed} aserciones.\n`,
);
process.exit(failed === 0 ? 0 : 1);

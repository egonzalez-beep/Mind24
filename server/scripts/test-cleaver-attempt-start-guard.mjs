/**
 * Guarda de inicio de intento para módulos `comingSoon` (hoy: Cleaver).
 *
 * Regla: se puede REANUDAR un intento existente, nunca CREAR uno nuevo.
 * Ejecutar: node server/scripts/test-cleaver-attempt-start-guard.mjs
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://test:test@127.0.0.1:5432/test';

const { pickResumableAttempt, resolveStartableAttempt } = await import(
  '../src/services/attempt.service.js'
);
const { errorHandler } = await import('../src/middleware/error.middleware.js');
const { isComingSoonModuleKey } = await import('../src/utils/moduleCatalog.js');

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

function expectUnavailable(moduleKey, attempts, msg) {
  try {
    resolveStartableAttempt(moduleKey, attempts);
  } catch (err) {
    check(
      err.code === 'MODULE_UNAVAILABLE' &&
        err.message === 'Esta evaluación se encuentra temporalmente no disponible.',
      msg,
      { code: err.code, message: err.message },
    );
    return err;
  }
  check(false, msg, 'no lanzó MODULE_UNAVAILABLE');
  return null;
}

const attempt = (id, moduleKey, status, startedAt = '2026-01-01T00:00:00Z') => ({
  id,
  moduleKey,
  status,
  startedAt: new Date(startedAt),
  timeLimitSec: null,
});

console.log('\n=== Guarda de inicio — módulos comingSoon ===');

console.log('\n[0] Precondición');
check(isComingSoonModuleKey('cleaver') === true, 'cleaver está comingSoon');

console.log('\n[1] Cleaver comingSoon + attempt existente → permitido');
{
  const attempts = [attempt('a1', 'cleaver', 'in_progress')];
  const resumable = resolveStartableAttempt('cleaver', attempts);
  check(resumable?.id === 'a1', 'reanuda el intento en curso', resumable);
}

console.log('\n[2] Alias `disc` + attempt existente → permitido');
{
  const storedAsAlias = [attempt('a2', 'disc', 'in_progress')];
  check(
    resolveStartableAttempt('cleaver', storedAsAlias)?.id === 'a2',
    'attempt guardado como "disc" se reanuda al pedir "cleaver"',
  );
  const requestedAsAlias = [attempt('a3', 'cleaver', 'in_progress')];
  check(
    resolveStartableAttempt('disc', requestedAsAlias)?.id === 'a3',
    'pedir "disc" reanuda el attempt guardado como "cleaver"',
  );
  check(
    resolveStartableAttempt('disc', storedAsAlias)?.id === 'a2',
    'alias en ambos lados también reanuda',
  );
}

console.log('\n[3] Cleaver comingSoon + sin attempt → rechazado');
{
  expectUnavailable('cleaver', [], 'sin intentos → MODULE_UNAVAILABLE');
  expectUnavailable('cleaver', undefined, 'lista ausente → MODULE_UNAVAILABLE');
  expectUnavailable('disc', [], 'alias sin intentos → MODULE_UNAVAILABLE');
  expectUnavailable(
    'cleaver',
    [attempt('t1', 'terman', 'in_progress')],
    'un intento de otro módulo no habilita Cleaver',
  );
}

console.log('\n[4] Attempt submitted existente → no crea duplicado');
{
  expectUnavailable(
    'cleaver',
    [attempt('done', 'cleaver', 'submitted')],
    'intento submitted no es reanudable → se rechaza en vez de duplicar',
  );
  check(
    pickResumableAttempt([attempt('done', 'cleaver', 'submitted')], 'cleaver', {
      matchAliases: true,
    }) === null,
    'pickResumableAttempt ignora estados no in_progress',
  );
}

console.log('\n[5] Ninguna escritura parcial al rechazar');
{
  check(
    resolveStartableAttempt.constructor.name === 'Function',
    'resolveStartableAttempt es sincrónica (no puede haber escrito en BD antes de lanzar)',
    resolveStartableAttempt.constructor.name,
  );
  let threwSynchronously = false;
  try {
    const out = resolveStartableAttempt('cleaver', []);
    check(false, 'debía lanzar', out);
  } catch {
    threwSynchronously = true;
  }
  check(threwSynchronously, 'el rechazo ocurre de forma sincrónica, antes de la transacción');
}

console.log('\n[6] Otros módulos → sin cambios');
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
    `${key} con intento submitted → null (comportamiento previo)`,
  );
}
check(
  resolveStartableAttempt('terman', [attempt('z', 'conocimientos', 'in_progress')]) === null,
  'terman NO gana coincidencia por alias (comportamiento previo intacto)',
);

console.log('\n[7] Selección determinista con varios intentos en curso');
{
  const attempts = [
    attempt('early', 'cleaver', 'in_progress', '2026-01-01T00:00:00Z'),
    attempt('late', 'cleaver', 'in_progress', '2026-02-01T00:00:00Z'),
  ];
  check(resolveStartableAttempt('cleaver', attempts)?.id === 'early', 'toma el primero de la lista');
  check(
    resolveStartableAttempt('cleaver', attempts)?.id ===
      resolveStartableAttempt('cleaver', attempts)?.id,
    'resultado estable entre llamadas',
  );
}

console.log('\n[8] MODULE_UNAVAILABLE responde 503 con mensaje claro');
{
  let status = null;
  let body = null;
  const res = {
    headersSent: false,
    status(s) {
      status = s;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  const err = Object.assign(new Error('Esta evaluación se encuentra temporalmente no disponible.'), {
    code: 'MODULE_UNAVAILABLE',
  });
  errorHandler(err, { originalUrl: '/api/me/assignments/abc/start', params: {} }, res, () => {});
  check(status === 503, 'status 503', status);
  check(body?.error === 'MODULE_UNAVAILABLE', 'error code en el payload', body);
  check(
    body?.message === 'Esta evaluación se encuentra temporalmente no disponible.',
    'mensaje visible para el candidato',
    body,
  );
}

console.log(
  failed === 0
    ? `\n✓ ${passed} aserciones OK.\n`
    : `\n✗ ${failed} fallo(s) de ${passed + failed} aserciones.\n`,
);
process.exit(failed === 0 ? 0 : 1);

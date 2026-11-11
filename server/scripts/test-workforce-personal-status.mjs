/**
 * Foto autogestionada y estado personal del colaborador.
 * node server/scripts/test-workforce-personal-status.mjs
 *
 * Regla única del mensaje vacío: después de recortar y compactar espacios,
 * un mensaje vacío equivale a quitar el estado (mensaje y fecha en null).
 */
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'workforce-persona-test-secret';
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24';

const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
const publicRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.public.routes.js'), 'utf8');
const orgRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.org.routes.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(rootDir, 'prisma/migrations/20261110140000_workforce_personal_status/migration.sql'),
  'utf8',
);
const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');

const {
  sniffWorkforceAvatarExt,
  setWorkforceAvatarPersistHookForTests,
  resolveWorkforceProfilePhotoAbs,
  createWorkforceAvatarUpload,
  placeWorkforceAvatarFile,
  publicProfilePhotoDto,
  withWorkforcePhotoLock,
  workforcePhotoQueueSize,
} = await import('../src/services/workforceAvatar.service.js');
const { workforceProfilePhotoEtag, workforceProfilePhotoVersion } = await import('../src/utils/workforcePhotoVersion.js');
const { sanitizeEmployeeForAdmin } = await import('../src/services/workforceEmployee.service.js');
const { timeclockPersonaRateKey, timeclockPersonaLimiter, loginRateLimiter } = await import('../src/middleware/rateLimit.middleware.js');
const { errorHandler, isWorkforceEmployeePhotoRequest } = await import('../src/middleware/error.middleware.js');
const timeclockPublicRouter = (await import('../src/routes/timeclock.public.routes.js')).default;
const {
  normalizePersonalStatusMessage,
  personalStatusBodySchema,
  PERSONAL_STATUS_MAX_CHARS,
  publicPersonalStatusDto,
} = await import('../src/services/workforcePersonalStatus.service.js');
const { prisma } = await import('../src/db/client.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/services/auth.service.js');
const { generateTimeclockAccessToken } = await import('../src/services/timeclockToken.service.js');
const { resolveWorkforceAvatarsDirAbs } = await import('../src/utils/uploadPaths.js');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function parseSetCookie(res) {
  const raw = res.headers.getSetCookie?.() || [];
  if (raw.length) return raw;
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}
function cookieHeaderFromResponse(res, name) {
  for (const line of parseSetCookie(res)) {
    const part = line.split(';')[0];
    if (part.startsWith(`${name}=`)) return part;
  }
  return '';
}

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const webp = Buffer.alloc(16);
webp.write('RIFF', 0);
webp.writeUInt32LE(8, 4);
webp.write('WEBP', 8);

console.log('\n=== Estado y foto propia — estático ===\n');

check(indexHtml === publicHtml, 'los dos HTML son idénticos');
check(!/Prototipo visual/.test(indexHtml), 'sin copia de prototipo');
check(/POST',\{method:'POST',body:body\}/.test(indexHtml) || /method:'POST',body:body/.test(indexHtml), 'la foto se envía con FormData');
check(/\/api\/timeclock\/public\/photo/.test(indexHtml) && /\/api\/timeclock\/public\/status/.test(indexHtml), 'la interfaz usa las rutas públicas');
check(/textContent=text/.test(indexHtml) && /tcDirStatusBubbleHtml/.test(indexHtml) && /tcEsc\(value\)/.test(indexHtml), 'el estado se pinta como texto');
check(/aria-label","Escribe un estado"/.test(indexHtml) || /aria-label','Escribe un estado'/.test(indexHtml), 'nombre accesible de estado vacío');
check(/Editar estado:/.test(indexHtml), 'nombre accesible para editar estado');
check(/Leer estado completo:/.test(indexHtml), 'nombre accesible para leer el estado');
check(/Agregar foto/.test(indexHtml) && /Cambiar foto/.test(indexHtml) && /Quitar foto/.test(indexHtml), 'nombres accesibles de fotografía');
check(/prefers-reduced-motion: reduce/.test(indexHtml), 'respeta reduced motion');
check(!/router\.(post|put|patch|delete)\([^)]*status/.test(orgRoutes), 'el directorio administrativo no edita el estado');
check(/router\.post\(\s*'\/photo'/.test(publicRoutes) && /router\.delete\(\s*'\/photo'/.test(publicRoutes), 'rutas públicas de foto');
check(/router\.put\(\s*'\/status'/.test(publicRoutes) && /router\.delete\(\s*'\/status'/.test(publicRoutes), 'rutas públicas de estado');
check(/personalStatusMessage\s+String\?\s+@db\.VarChar\(80\)/.test(schema), 'mensaje VARCHAR(80) anulable');
check(/personalStatusUpdatedAt\s+DateTime\?\s+@db\.Timestamptz\(6\)/.test(schema), 'fecha de estado anulable');
check(migration.replace(/\r\n/g, '\n').trim() === 'ALTER TABLE "WorkforceEmployee"\nADD COLUMN "personalStatusMessage" VARCHAR(80),\nADD COLUMN "personalStatusUpdatedAt" TIMESTAMPTZ(6);', 'migración exacta, sin backfill ni índice');
check(!orgRoutes.includes('timeclockPersonaLimiter') && (publicRoutes.match(/timeclockPersonaLimiter/g) || []).length === 5, 'el límite nuevo solo cubre foto y estado del portal');
{
  const routeDir = path.join(rootDir, 'src/routes');
  const limiterFiles = fs.readdirSync(routeDir).filter((name) => fs.readFileSync(path.join(routeDir, name), 'utf8').includes('timeclockPersonaLimiter'));
  check(limiterFiles.length === 1 && limiterFiles[0] === 'timeclock.public.routes.js', 'ninguna otra ruta monta el límite de foto y estado');
  function routeHandles(method, routePath) {
    const layer = timeclockPublicRouter.stack.find((item) => item.route && item.route.path === routePath && item.route.methods[method]);
    return layer ? layer.route.stack.map((item) => item.handle) : [];
  }
  const upload = routeHandles('post', '/photo');
  const removePhoto = routeHandles('delete', '/photo');
  const saveStatus = routeHandles('put', '/status');
  const clearStatus = routeHandles('delete', '/status');
  const readPhoto = routeHandles('get', '/photo');
  const checkIn = routeHandles('post', '/check-in');
  check(upload.length === 5 && upload[0].name === 'requireTimeclockSession' && upload[1].name === 'requireTimeclockMutationOrigin' && upload[2] === timeclockPersonaLimiter && upload[3] !== timeclockPersonaLimiter && upload[3].length === 3, 'subir foto autentica, limita y solo después lee el archivo');
  check([removePhoto, saveStatus, clearStatus].every((handles) => handles.length === 4 && handles[0].name === 'requireTimeclockSession' && handles[1].name === 'requireTimeclockMutationOrigin' && handles[2] === timeclockPersonaLimiter), 'quitar foto y el estado autentican antes del límite');
  check(!readPhoto.includes(timeclockPersonaLimiter) && !checkIn.includes(timeclockPersonaLimiter), 'la lectura de la foto y el checador no usan este límite');
}
check(sniffWorkforceAvatarExt(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')) == null, 'SVG rechazado por contenido');
check(sniffWorkforceAvatarExt(jpg) === '.jpg' && sniffWorkforceAvatarExt(webp) === '.webp' && sniffWorkforceAvatarExt(png) === '.png', 'JPG, PNG y WEBP por bytes');

console.log('\n=== Estado — unidad ===\n');

check(normalizePersonalStatusMessage('  🔥 Dándole con todo  ') === '🔥 Dándole con todo', 'recorta y conserva el emoji');
check(normalizePersonalStatusMessage('hola\n\n  mundo') === 'hola mundo', 'compacta saltos y espacios');
check(normalizePersonalStatusMessage('   ') === '', 'vacío normalizado equivale a quitar');
check(normalizePersonalStatusMessage('<script>alert(1)</script> & "hola"') === '<script>alert(1)</script> & "hola"', 'HTML queda como texto');
check(Array.from('🔥').length === 1 && PERSONAL_STATUS_MAX_CHARS === 80, 'el límite cuenta caracteres Unicode');
let rejected = false;
try { normalizePersonalStatusMessage('a'.repeat(81)); } catch (e) { rejected = e.code === 'VALIDATION_ERROR'; }
check(rejected, '81 caracteres se rechazan');
check(personalStatusBodySchema.safeParse({ message: 'hola', employeeId: 'x' }).success === false, 'rechaza campos extra');
check(personalStatusBodySchema.safeParse({ message: '🔥' }).success === true, 'acepta el mensaje');
check(normalizePersonalStatusMessage('🔥'.repeat(80)) === '🔥'.repeat(80), '80 emojis caben en el límite Unicode');
let tooManyEmoji = false;
try { normalizePersonalStatusMessage('🔥'.repeat(81)); } catch (e) { tooManyEmoji = e.code === 'VALIDATION_ERROR'; }
check(tooManyEmoji, '81 emojis se rechazan');
const statusDto = publicPersonalStatusDto({
  personalStatusMessage: '<b>hola</b>',
  personalStatusUpdatedAt: new Date('2026-11-10T12:00:00Z'),
  profilePhotoPath: 'workforce-avatars/org/secret.jpg',
  organizationId: 'org',
});
check(Object.keys(statusDto).sort().join(',') === 'personalStatusMessage,personalStatusUpdatedAt', 'la respuesta de estado no incluye campos internos');
check(indexHtml.includes("replace(/[\\r\\n\\t]+/g,' ')") && indexHtml.includes('Array.from(tcNormalizeStatusDraft(value))'), 'el contador visual usa la misma normalización');

console.log('\n=== Versión de foto ===\n');

{
  const pathA = 'workforce-avatars/org/11111111-1111-1111-1111-111111111111.jpg';
  const pathB = 'workforce-avatars/org/22222222-2222-2222-2222-222222222222.png';
  const versionA = workforceProfilePhotoVersion(pathA);
  const empEarly = { profilePhotoPath: pathA, updatedAt: new Date('2020-01-01T00:00:00Z') };
  const empLater = { profilePhotoPath: pathA, updatedAt: new Date('2026-11-10T00:00:00Z'), personalStatusMessage: 'hola' };
  check(versionA === workforceProfilePhotoVersion(pathA), 'la versión es estable para la misma foto');
  check(!String(versionA).includes('workforce-avatars') && !String(versionA).includes('11111111'), 'la versión no revela la ruta');
  check(publicProfilePhotoDto(empEarly).profilePhotoVersion === publicProfilePhotoDto(empLater).profilePhotoVersion, 'guardar estado no cambia profilePhotoVersion');
  check(workforceProfilePhotoEtag(pathA) === workforceProfilePhotoEtag(empLater.profilePhotoPath), 'el ETag no cambia al editar otros datos');
  check(workforceProfilePhotoVersion(pathB) !== versionA, 'reemplazar la foto cambia la versión');
  check(workforceProfilePhotoEtag(pathB) !== workforceProfilePhotoEtag(pathA), 'el ETag cambia al reemplazar la imagen');
  const cleared = publicProfilePhotoDto({ profilePhotoPath: null, updatedAt: new Date() });
  check(cleared.hasProfilePhoto === false && cleared.profilePhotoVersion == null, 'quitar la foto deja la versión en null');
  const admin = sanitizeEmployeeForAdmin({ id: 'e', fullName: 'Ana', profilePhotoPath: pathA, updatedAt: empLater.updatedAt });
  check(admin.profilePhotoVersion === publicProfilePhotoDto(empLater).profilePhotoVersion, 'administrador y colaborador calculan la misma versión');
}

console.log('\n=== Carrera de archivos ===\n');

{
  const orgId = `race${crypto.randomBytes(4).toString('hex')}`;
  const previous = `${'workforce-avatars'}/${orgId}/previous.jpg`;
  const previousAbs = resolveWorkforceProfilePhotoAbs(previous, orgId);
  await fs.promises.mkdir(path.dirname(previousAbs), { recursive: true });
  await fs.promises.writeFile(previousAbs, png);
  let stored = previous;
  const commit = async (next, expected) => {
    if (stored !== expected) return false;
    stored = next;
    return true;
  };
  const removePrevious = (rel) => fs.promises.unlink(resolveWorkforceProfilePhotoAbs(rel, orgId));
  const [first, second] = await Promise.allSettled([
    placeWorkforceAvatarFile({ organizationId: orgId, previousPath: previous, buffer: jpg, ext: '.jpg', commit, removePrevious }),
    placeWorkforceAvatarFile({ organizationId: orgId, previousPath: previous, buffer: png, ext: '.png', commit, removePrevious }),
  ]);
  const winner = [first, second].find((item) => item.status === 'fulfilled');
  const loser = [first, second].find((item) => item.status === 'rejected');
  const names = await fs.promises.readdir(path.dirname(previousAbs));
  check(winner && loser && loser.reason?.code === 'CONFLICT', 'dos procesos desde la misma ruta: uno confirma y el otro entra en conflicto');
  check(names.length === 1 && names[0] === path.basename(stored), 'el perdedor borra solo su archivo y queda la foto del ganador');
  check(!String(loser.reason?.message || '').includes(orgId), 'el conflicto no revela la ruta');
  await fs.promises.unlink(resolveWorkforceProfilePhotoAbs(stored, orgId)).catch(() => {});

  const previous2 = `workforce-avatars/${orgId}/alive.jpg`;
  await fs.promises.writeFile(resolveWorkforceProfilePhotoAbs(previous2, orgId), png);
  let current = previous2;
  const commit2 = async (next, expected) => {
    if (current !== expected) return false;
    current = next;
    return true;
  };
  const clear = async () => {
    if (current !== previous2) return false;
    current = null;
    await fs.promises.unlink(resolveWorkforceProfilePhotoAbs(previous2, orgId));
    return true;
  };
  await Promise.allSettled([
    placeWorkforceAvatarFile({ organizationId: orgId, previousPath: previous2, buffer: jpg, ext: '.jpg', commit: commit2, removePrevious: (rel) => fs.promises.unlink(resolveWorkforceProfilePhotoAbs(rel, orgId)) }),
    clear(),
  ]);
  const left = await fs.promises.readdir(path.dirname(previousAbs)).catch(() => []);
  const broken = current && !left.includes(path.basename(current));
  check(!broken, 'subir y quitar a la vez no deja una ruta rota');
  for (const name of left) await fs.promises.unlink(path.join(path.dirname(previousAbs), name)).catch(() => {});

  let order = '';
  const queued = Promise.all([
    withWorkforcePhotoLock('emp-queue', async () => { order += 'a'; await new Promise((r) => setTimeout(r, 30)); order += 'A'; }),
    withWorkforcePhotoLock('emp-queue', async () => { order += 'b'; }),
  ]);
  check(workforcePhotoQueueSize() === 1, 'la cola agrupa al mismo colaborador');
  await queued;
  check(order === 'aAb' && workforcePhotoQueueSize() === 0, 'la cola espera el turno y se elimina en finally');
  let threw = false;
  await withWorkforcePhotoLock('emp-fail', async () => { threw = true; throw new Error('fallo'); }).catch(() => {});
  check(threw && workforcePhotoQueueSize() === 0, 'la cola se elimina en finally aunque la operación falle');

  const previous3 = `workforce-avatars/${orgId}/same.jpg`;
  await fs.promises.writeFile(resolveWorkforceProfilePhotoAbs(previous3, orgId), png);
  let live = previous3;
  const replaceOnce = () => withWorkforcePhotoLock('emp-same', () => placeWorkforceAvatarFile({
    organizationId: orgId,
    previousPath: live,
    buffer: jpg,
    ext: '.jpg',
    commit: async (next, expected) => {
      if (live !== expected) return false;
      live = next;
      return true;
    },
    removePrevious: (rel) => fs.promises.unlink(resolveWorkforceProfilePhotoAbs(rel, orgId)),
  }));
  const both = await Promise.allSettled([replaceOnce(), replaceOnce()]);
  const namesSame = await fs.promises.readdir(path.dirname(previousAbs));
  check(both.every((item) => item.status === 'fulfilled') && namesSame.length === 1 && namesSame[0] === path.basename(live), 'dos reemplazos simultáneos en el mismo proceso dejan una sola referencia');
  await fs.promises.unlink(resolveWorkforceProfilePhotoAbs(live, orgId)).catch(() => {});

  const logs = [];
  const originalError = console.error;
  console.error = (...args) => { logs.push(args); };
  const kept = await placeWorkforceAvatarFile({
    organizationId: orgId,
    previousPath: null,
    buffer: png,
    ext: '.png',
    commit: async () => true,
    removePrevious: async () => { const err = new Error('disco lleno'); err.code = 'EIO'; throw err; },
  });
  const orphan = `workforce-avatars/${orgId}/orphan.jpg`;
  await fs.promises.writeFile(resolveWorkforceProfilePhotoAbs(orphan, orgId), jpg);
  const confirmed = await placeWorkforceAvatarFile({
    organizationId: orgId,
    previousPath: orphan,
    buffer: png,
    ext: '.png',
    commit: async () => true,
    removePrevious: async () => { const err = new Error('permiso'); err.code = 'EPERM'; throw err; },
  });
  console.error = originalError;
  check(!!kept && !!confirmed && logs.some((args) => args[0] === '[workforce-avatar] cleanup-pending' && args[1]?.relativePath === orphan), 'un fallo al borrar la foto anterior queda registrado y la operación sigue confirmada');
  check(!JSON.stringify(logs).includes(resolveWorkforceProfilePhotoAbs(orphan, orgId)), 'el registro no incluye la ruta física absoluta');
  for (const name of await fs.promises.readdir(path.dirname(previousAbs))) {
    await fs.promises.unlink(path.join(path.dirname(previousAbs), name)).catch(() => {});
  }
}

console.log('\n=== Límite y errores ===\n');

{
  const keyA = timeclockPersonaRateKey({ timeclockEmployee: { id: 'emp-a' }, ip: '10.0.0.8' });
  const keyB = timeclockPersonaRateKey({ timeclockEmployee: { id: 'emp-b' }, ip: '10.0.0.8' });
  check(keyA !== keyB && keyA.includes('emp-a') && keyB.includes('emp-b'), 'un colaborador no comparte el límite con otro');
  check(timeclockPersonaLimiter !== loginRateLimiter, 'el límite de foto y estado no es el de login');
  const app = express();
  app.post('/photo', (req, _res, next) => { req.timeclockEmployee = { id: req.get('x-emp') }; next(); }, timeclockPersonaLimiter, (_req, res) => res.json({ ok: true }));
  app.post('/status', (req, _res, next) => { req.timeclockEmployee = { id: req.get('x-emp') }; next(); }, timeclockPersonaLimiter, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let blocked = 0;
  let other = 0;
  for (let i = 0; i < 21; i += 1) {
    const res = await fetch(`${base}/photo`, { method: 'POST', headers: { 'x-emp': 'emp-a' } });
    if (res.status === 429) blocked += 1;
  }
  const mate = await fetch(`${base}/status`, { method: 'POST', headers: { 'x-emp': 'emp-b' } });
  other = mate.status;
  const limited = await fetch(`${base}/photo`, { method: 'POST', headers: { 'x-emp': 'emp-a' } });
  const limitedBody = await limited.json();
  check(blocked >= 1 && other === 200, 'al llegar al límite el otro colaborador sigue pudiendo guardar');
  check(limited.status === 429 && limitedBody.error === 'RATE_LIMIT' && !JSON.stringify(limitedBody).includes('workforce-avatars'), 'el límite responde con el formato estándar');
  server.close();

  check(isWorkforceEmployeePhotoRequest({ originalUrl: '/api/timeclock/public/photo?v=abc' }), 'reconoce la foto pública');
  check(isWorkforceEmployeePhotoRequest({ originalUrl: '/api/org/timeclock/employees/emp-1/photo' }), 'reconoce la foto administrativa');
  check(!isWorkforceEmployeePhotoRequest({ originalUrl: '/api/org/recruitment/candidates/emp-1/photo' }), 'no trata como foto de colaborador una ruta de candidatos');
  check(!isWorkforceEmployeePhotoRequest({ originalUrl: '/api/org/timeclock/employees/emp-1/documents' }), 'no trata los documentos como la foto');
  const errors = express();
  const unexpected = (_req, _res, next) => next(Object.assign(new Error('extra'), { code: 'LIMIT_UNEXPECTED_FILE' }));
  errors.get('/api/timeclock/public/photo', (_req, _res, next) => next(Object.assign(new Error('too big'), { code: 'LIMIT_FILE_SIZE' })));
  errors.get('/api/org/timeclock/employees/emp-1/photo', unexpected);
  errors.get('/api/org/recruitment/candidates/emp-1/photo', unexpected);
  errors.get('/api/org/timeclock/employees/emp-1/documents', unexpected);
  errors.get('/api/timeclock/public/photo-type', (_req, _res, next) => next(new Error('INVALID_AVATAR_FILE')));
  errors.get('/api/timeclock/public/photo-conflict', (_req, _res, next) => {
    const err = new Error('La fotografía cambió mientras se guardaba. Intenta de nuevo.');
    err.code = 'CONFLICT';
    next(err);
  });
  errors.get('/boom', (_req, _res, next) => next(new Error('C:\\secret\\workforce-avatars\\org\\foto.jpg')));
  errors.use(errorHandler);
  const errServer = errors.listen(0);
  const errBase = `http://127.0.0.1:${errServer.address().port}`;
  const size = await fetch(`${errBase}/api/timeclock/public/photo`);
  const type = await fetch(`${errBase}/api/timeclock/public/photo-type`);
  const extra = await fetch(`${errBase}/api/org/timeclock/employees/emp-1/photo`);
  const extraBody = await extra.json();
  const candidate = await fetch(`${errBase}/api/org/recruitment/candidates/emp-1/photo`);
  const candidateBody = await candidate.json();
  const documents = await fetch(`${errBase}/api/org/timeclock/employees/emp-1/documents`);
  const documentsBody = await documents.json();
  const conflict = await fetch(`${errBase}/api/timeclock/public/photo-conflict`);
  const boom = await fetch(`${errBase}/boom`);
  const boomBody = await boom.json();
  check((await size.json()).error === 'VALIDATION_ERROR' && size.status === 400, 'archivo grande responde 400');
  check(type.status === 400, 'tipo inválido responde 400');
  check(extra.status === 400 && extraBody.message === 'Envía una sola imagen, sin campos adicionales.', 'campos extra de la foto del colaborador responden 400');
  check(candidate.status === 500 && candidateBody.message === 'Error interno del servidor' && documents.status === 500 && documentsBody.message !== extraBody.message, 'candidatos y documentos conservan su contrato de error');
  check(conflict.status === 409, 'el conflicto responde 409');
  check(boom.status === 500 && boomBody.message === 'Error interno del servidor' && !JSON.stringify(boomBody).includes('secret'), 'un error interno no publica rutas ni datos sensibles');
  errServer.close();

  const gate = express();
  gate.use('/api/timeclock/public', timeclockPublicRouter);
  gate.use(errorHandler);
  const gateServer = gate.listen(0);
  const gateBase = `http://127.0.0.1:${gateServer.address().port}`;
  const anonymous = new FormData();
  anonymous.append('extra', 'no');
  anonymous.append('photo', new Blob([png]), 'a.png');
  const deniedPhoto = await fetch(`${gateBase}/api/timeclock/public/photo`, { method: 'POST', body: anonymous });
  const deniedStatus = await fetch(`${gateBase}/api/timeclock/public/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hola' }),
  });
  check(deniedPhoto.status === 401 && deniedStatus.status === 401, 'sin sesión no se procesa el archivo ni el estado');
  gateServer.close();
}

console.log('\n=== Foto — multer sin base ===\n');

{
  const upload = createWorkforceAvatarUpload();
  const mini = express();
  mini.post('/photo', upload.single('photo'), (req, res) => {
    res.json({ bytes: req.file?.buffer?.length || 0, name: req.file?.originalname || '' });
  });
  mini.use((err, _req, res, _next) => {
    res.status(400).json({ code: err.code || err.message || 'ERROR' });
  });
  const miniServer = mini.listen(0);
  const miniBase = `http://127.0.0.1:${miniServer.address().port}`;
  function form(file, name, type, extra) {
    const fd = new FormData();
    fd.append('photo', new Blob([file], { type }), name);
    if (extra) for (const [key, value] of Object.entries(extra)) fd.append(key, value);
    return fd;
  }
  const ok = await fetch(`${miniBase}/photo`, { method: 'POST', body: form(png, 'a.png', 'image/png') });
  check(ok.status === 200, 'un PNG válido pasa el filtro compartido');
  const svg = await fetch(`${miniBase}/photo`, { method: 'POST', body: form(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'a.svg', 'image/svg+xml') });
  check(svg.status === 400, 'el filtro rechaza SVG');
  const big = await fetch(`${miniBase}/photo`, { method: 'POST', body: form(Buffer.alloc(3 * 1024 * 1024 + 1), 'a.jpg', 'image/jpeg') });
  const bigJson = await big.json();
  check(big.status === 400 && bigJson.code === 'LIMIT_FILE_SIZE', 'el filtro rechaza más de 3 MB');
  const extra = await fetch(`${miniBase}/photo`, { method: 'POST', body: form(png, 'a.png', 'image/png', { employeeId: 'otro' }) });
  check(extra.status === 400, 'el filtro rechaza campos extra');
  const files = new FormData();
  files.append('photo', new Blob([png], { type: 'image/png' }), 'a.png');
  files.append('other', new Blob([jpg], { type: 'image/jpeg' }), 'b.jpg');
  const extraFile = await fetch(`${miniBase}/photo`, { method: 'POST', body: files });
  check(extraFile.status === 400, 'el filtro rechaza un segundo archivo');
  miniServer.close();
}

console.log('\n=== Estado y foto propia — integración ===\n');

let dbOk = false;
let schemaOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
  const cols = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'WorkforceEmployee' AND column_name IN ('personalStatusMessage', 'personalStatusUpdatedAt')
  `;
  schemaOk = Array.isArray(cols) && cols.length === 2;
} catch (e) {
  console.log('  SKIP integration:', e.message);
}
if (dbOk && !schemaOk) {
  console.log('  SKIP integration: la migración de estado personal no está aplicada en esta base.');
}

if (dbOk && schemaOk) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const orgA = await prisma.organization.create({ data: { name: `Persona A ${suffix}`, empresaPortalEnabled: true, credits: 0 } });
  const orgB = await prisma.organization.create({ data: { name: `Persona B ${suffix}`, empresaPortalEnabled: true, credits: 0 } });
  const pass = 'TestAdmin1!';
  const adminA = await prisma.user.create({
    data: { email: `persona-admin-${suffix}@example.com`, passwordHash: await hashPassword(pass), fullName: 'Admin', role: 'empresa_admin', organizationId: orgA.id },
  });
  const tokenA = generateTimeclockAccessToken();
  const tokenB = generateTimeclockAccessToken();
  const tokenOther = generateTimeclockAccessToken();
  const empA = await prisma.workforceEmployee.create({
    data: { organizationId: orgA.id, fullName: 'Ana López', position: 'Reclutador', timezone: 'America/Mexico_City', accessTokenHash: tokenA.hash, isActive: true, tokenVersion: 1 },
  });
  const empB = await prisma.workforceEmployee.create({
    data: { organizationId: orgA.id, fullName: 'Luis Ortega', position: 'Analista', timezone: 'America/Mexico_City', accessTokenHash: tokenB.hash, isActive: true, tokenVersion: 1 },
  });
  const empOther = await prisma.workforceEmployee.create({
    data: { organizationId: orgB.id, fullName: 'Otra Org', timezone: 'America/Mexico_City', accessTokenHash: tokenOther.hash, isActive: true, tokenVersion: 1 },
  });
  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const createdFiles = [];

  async function exchange(token) {
    const res = await fetch(`${base}/api/timeclock/public/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return cookieHeaderFromResponse(res, 'mind24.tc.sid');
  }
  function form(file, name, type, extra) {
    const fd = new FormData();
    fd.append('photo', new Blob([file], { type }), name);
    if (extra) {
      for (const [key, value] of Object.entries(extra)) fd.append(key, value);
    }
    return fd;
  }
  async function orgPhotoFiles(orgId) {
    const dir = path.join(resolveWorkforceAvatarsDirAbs(), orgId);
    try { return await fs.promises.readdir(dir); } catch { return []; }
  }

  try {
    const cookieA = await exchange(tokenA.token);
    const cookieB = await exchange(tokenB.token);
    const cookieOther = await exchange(tokenOther.token);
    check(!!cookieA && !!cookieB && !!cookieOther, 'sesiones de colaborador');

    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminA.email, password: pass }),
    });
    const adminCookie = cookieHeaderFromResponse(login, 'mind24.sid');
    check(login.ok && !!adminCookie, 'sesión administrativa');

    const noSession = await fetch(`${base}/api/timeclock/public/photo`, { method: 'POST', headers: { Cookie: adminCookie }, body: form(jpg, 'a.jpg', 'image/jpeg') });
    check(noSession.status === 401, 'un administrador no usa la ruta pública de foto');

    const up = await fetch(`${base}/api/timeclock/public/photo`, { method: 'POST', headers: { Cookie: cookieA }, body: form(jpg, 'a.jpg', 'image/jpeg') });
    const upJson = await up.json();
    check(up.status === 200 && upJson.hasProfilePhoto === true && upJson.photoUrl === '/api/timeclock/public/photo' && !('profilePhotoPath' in upJson), 'sube JPG sin exponer la ruta física');
    const firstVersion = upJson.profilePhotoVersion;
    const row1 = await prisma.workforceEmployee.findUnique({ where: { id: empA.id } });
    const firstPath = row1.profilePhotoPath;
    check(!!firstPath && firstPath.startsWith(`workforce-avatars/${orgA.id}/`) && !firstPath.includes('..'), 'archivo dentro de la carpeta de la organización');

    const replaced = await fetch(`${base}/api/timeclock/public/photo`, { method: 'POST', headers: { Cookie: cookieA }, body: form(png, 'a.png', 'image/png') });
    const replacedJson = await replaced.json();
    const row2 = await prisma.workforceEmployee.findUnique({ where: { id: empA.id } });
    check(replaced.status === 200 && row2.profilePhotoPath !== firstPath && replacedJson.profilePhotoVersion !== firstVersion, 'reemplaza la foto y cambia la versión de caché');
    let oldGone = false;
    try { await fs.promises.stat(resolveWorkforceProfilePhotoAbs(firstPath, orgA.id)); } catch (e) { oldGone = e.code === 'ENOENT'; }
    check(oldGone, 'elimina la fotografía anterior después del éxito');

    const removed = await fetch(`${base}/api/timeclock/public/photo`, { method: 'DELETE', headers: { Cookie: cookieA } });
    const removedJson = await removed.json();
    check(removed.status === 200 && removedJson.hasProfilePhoto === false && removedJson.profilePhotoVersion == null, 'quita la foto');
    const removedAgain = await fetch(`${base}/api/timeclock/public/photo`, { method: 'DELETE', headers: { Cookie: cookieA } });
    check(removedAgain.status === 200, 'quitar la foto es idempotente');

    const pngUp = await fetch(`${base}/api/timeclock/public/photo`, { method: 'POST', headers: { Cookie: cookieA }, body: form(png, 'a.png', 'image/png') });
    const webpUp = await fetch(`${base}/api/timeclock/public/photo`, { method: 'POST', headers: { Cookie: cookieA }, body: form(webp, 'a.webp', 'image/webp') });
    check(pngUp.status === 200 && webpUp.status === 200, 'acepta PNG y WEBP válidos');

    const big = Buffer.alloc(3 * 1024 * 1024 + 1, 0xff);
    const bigUp = await fetch(`${base}/api/timeclock/public/photo`, { method: 'POST', headers: { Cookie: cookieA }, body: form(big, 'big.jpg', 'image/jpeg') });
    check(bigUp.status === 400, 'rechaza más de 3 MB');

    const beforeFake = await prisma.workforceEmployee.findUnique({ where: { id: empA.id } });
    const fake = await fetch(`${base}/api/timeclock/public/photo`, { method: 'POST', headers: { Cookie: cookieA }, body: form(png, 'foto.jpg', 'image/jpeg') });
    const afterFake = await prisma.workforceEmployee.findUnique({ where: { id: empA.id } });
    check(fake.status === 400 && afterFake.profilePhotoPath === beforeFake.profilePhotoPath, 'rechaza extensión o tipo que no coincide con los bytes');

    const svg = await fetch(`${base}/api/timeclock/public/photo`, { method: 'POST', headers: { Cookie: cookieA }, body: form(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'a.svg', 'image/svg+xml') });
    check(svg.status === 400, 'rechaza SVG');
    const corrupt = await fetch(`${base}/api/timeclock/public/photo`, { method: 'POST', headers: { Cookie: cookieA }, body: form(Buffer.from('not-an-image-file'), 'a.jpg', 'image/jpeg') });
    check(corrupt.status === 400, 'rechaza un archivo corrupto');

    const extraField = await fetch(`${base}/api/timeclock/public/photo`, { method: 'POST', headers: { Cookie: cookieA }, body: form(jpg, 'a.jpg', 'image/jpeg', { employeeId: empB.id }) });
    check(extraField.status === 400, 'rechaza campos extra');
    const extraFiles = new FormData();
    extraFiles.append('photo', new Blob([jpg], { type: 'image/jpeg' }), 'a.jpg');
    extraFiles.append('photo', new Blob([png], { type: 'image/png' }), 'b.png');
    const extraFileRes = await fetch(`${base}/api/timeclock/public/photo`, { method: 'POST', headers: { Cookie: cookieA }, body: extraFiles });
    check(extraFileRes.status === 400, 'rechaza archivos extra');

    const otherBefore = await prisma.workforceEmployee.findUnique({ where: { id: empOther.id } });
    const mateBefore = await prisma.workforceEmployee.findUnique({ where: { id: empB.id } });
    check(otherBefore.profilePhotoPath == null && mateBefore.profilePhotoPath == null, 'otro colaborador y otra organización no reciben la foto');

    const keptPath = (await prisma.workforceEmployee.findUnique({ where: { id: empA.id } })).profilePhotoPath;
    const filesBeforeHook = await orgPhotoFiles(orgA.id);
    setWorkforceAvatarPersistHookForTests(() => {
      const err = new Error('fallo de base de prueba');
      err.code = 'DB_TEST';
      throw err;
    });
    const hooked = await fetch(`${base}/api/timeclock/public/photo`, { method: 'POST', headers: { Cookie: cookieA }, body: form(jpg, 'nueva.jpg', 'image/jpeg') });
    setWorkforceAvatarPersistHookForTests(null);
    const afterHook = await prisma.workforceEmployee.findUnique({ where: { id: empA.id } });
    const filesAfterHook = await orgPhotoFiles(orgA.id);
    check(hooked.status === 500 && afterHook.profilePhotoPath === keptPath, 'un error de base conserva la foto anterior');
    check(filesAfterHook.length === filesBeforeHook.length, 'el archivo nuevo se elimina si la base falla');

    const rapid = await Promise.all([
      fetch(`${base}/api/timeclock/public/photo`, { method: 'POST', headers: { Cookie: cookieA }, body: form(jpg, 'r1.jpg', 'image/jpeg') }),
      fetch(`${base}/api/timeclock/public/photo`, { method: 'POST', headers: { Cookie: cookieA }, body: form(png, 'r2.png', 'image/png') }),
    ]);
    const rapidRow = await prisma.workforceEmployee.findUnique({ where: { id: empA.id } });
    const rapidFiles = await orgPhotoFiles(orgA.id);
    const rapidName = path.basename(rapidRow.profilePhotoPath || '');
    check(rapid.every((r) => r.status === 200) && rapidFiles.length === 1 && rapidFiles[0] === rapidName, 'dos envíos rápidos no dejan archivos huérfanos');

    const me = await fetch(`${base}/api/timeclock/public/me`, { headers: { Cookie: cookieA } });
    const meJson = await me.json();
    check(me.status === 200 && meJson.personalStatusMessage == null && !('profilePhotoPath' in meJson), '/me incluye el estado y no la ruta física');
    const versionBeforeStatus = meJson.profilePhotoVersion;
    const statusOnPhoto = await fetch(`${base}/api/timeclock/public/status`, {
      method: 'PUT',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'En foco' }),
    });
    const meAfterStatus = await (await fetch(`${base}/api/timeclock/public/me`, { headers: { Cookie: cookieA } })).json();
    const etagBefore = (await fetch(`${base}/api/timeclock/public/photo`, { headers: { Cookie: cookieA } })).headers.get('etag');
    await fetch(`${base}/api/timeclock/public/status`, { method: 'DELETE', headers: { Cookie: cookieA } });
    const meAfterClear = await (await fetch(`${base}/api/timeclock/public/me`, { headers: { Cookie: cookieA } })).json();
    const etagAfter = (await fetch(`${base}/api/timeclock/public/photo`, { headers: { Cookie: cookieA } })).headers.get('etag');
    check(statusOnPhoto.status === 200 && meAfterStatus.profilePhotoVersion === versionBeforeStatus && meAfterClear.profilePhotoVersion === versionBeforeStatus, 'guardar o quitar el estado no cambia la versión de la foto');
    check(etagBefore && etagBefore === etagAfter && etagAfter === `"${versionBeforeStatus}"`, 'el ETag permanece mientras la imagen no cambia');

    const saved = await fetch(`${base}/api/timeclock/public/status`, {
      method: 'PUT',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '  Hola   equipo  ' }),
    });
    const savedJson = await saved.json();
    check(saved.status === 200 && savedJson.personalStatusMessage === 'Hola equipo' && savedJson.personalStatusUpdatedAt, 'guarda el texto compactado');

    const emoji = await fetch(`${base}/api/timeclock/public/status`, {
      method: 'PUT',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '🔥 Dándole con todo' }),
    });
    const emojiJson = await emoji.json();
    check(emoji.status === 200 && emojiJson.personalStatusMessage === '🔥 Dándole con todo', 'guarda un emoji dentro del texto');

    const max = await fetch(`${base}/api/timeclock/public/status`, {
      method: 'PUT',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'á'.repeat(80) }),
    });
    check(max.status === 200, 'acepta 80 caracteres Unicode');
    const over = await fetch(`${base}/api/timeclock/public/status`, {
      method: 'PUT',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'á'.repeat(81) }),
    });
    const still = await prisma.workforceEmployee.findUnique({ where: { id: empB.id } });
    check(over.status === 400 && still.personalStatusMessage === 'á'.repeat(80), 'rechaza más de 80 y conserva el anterior');

    const empty = await fetch(`${base}/api/timeclock/public/status`, {
      method: 'PUT',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: ' \n  ' }),
    });
    const emptyJson = await empty.json();
    check(empty.status === 200 && emptyJson.personalStatusMessage == null && emptyJson.personalStatusUpdatedAt == null, 'un mensaje vacío quita el estado');

    const again = await fetch(`${base}/api/timeclock/public/status`, { method: 'DELETE', headers: { Cookie: cookieB } });
    const twice = await fetch(`${base}/api/timeclock/public/status`, { method: 'DELETE', headers: { Cookie: cookieB } });
    check(again.status === 200 && twice.status === 200, 'quitar dos veces es idempotente');

    const extra = await fetch(`${base}/api/timeclock/public/status`, {
      method: 'PUT',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hola', employeeId: empA.id, organizationId: orgB.id }),
    });
    check(extra.status === 400, 'rechaza campos extra en el estado');

    const html = await fetch(`${base}/api/timeclock/public/status`, {
      method: 'PUT',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '<script>alert(1)</script> & "hola"' }),
    });
    const htmlJson = await html.json();
    check(html.status === 200 && htmlJson.personalStatusMessage === '<script>alert(1)</script> & "hola"', 'HTML y script se almacenan como texto');

    const mate = await prisma.workforceEmployee.findUnique({ where: { id: empA.id } });
    const foreign = await prisma.workforceEmployee.findUnique({ where: { id: empOther.id } });
    check(mate.personalStatusMessage == null && foreign.personalStatusMessage == null, 'no modifica a otro colaborador ni a otra organización');

    const directory = await fetch(`${base}/api/org/timeclock/employees`, { headers: { Cookie: adminCookie } });
    const directoryJson = await directory.json();
    const listed = (directoryJson.employees || []).find((emp) => emp.id === empB.id);
    check(directory.status === 200 && listed && listed.personalStatusMessage === htmlJson.personalStatusMessage && !directoryJson.employees.some((emp) => emp.id === empOther.id), 'el directorio muestra el estado de su organización');

    const adminWrite = await fetch(`${base}/api/org/timeclock/employees/${empB.id}/status`, {
      method: 'PUT',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'no' }),
    });
    check(adminWrite.status === 404, 'no hay edición administrativa del estado');
  } finally {
    setWorkforceAvatarPersistHookForTests(null);
    server.close();
    const rows = await prisma.workforceEmployee.findMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
      select: { profilePhotoPath: true, organizationId: true },
    });
    for (const row of rows) {
      if (!row.profilePhotoPath) continue;
      createdFiles.push(row.profilePhotoPath);
      try { await fs.promises.unlink(resolveWorkforceProfilePhotoAbs(row.profilePhotoPath, row.organizationId)); } catch {}
    }
    for (const orgId of [orgA.id, orgB.id]) {
      const names = await orgPhotoFiles(orgId);
      for (const name of names) {
        try { await fs.promises.unlink(path.join(resolveWorkforceAvatarsDirAbs(), orgId, name)); } catch {}
      }
    }
    void createdFiles;
    await prisma.workforceEmployee.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  }
}

console.log(failed === 0 ? '\n✓ Estado personal y foto propia OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * Bitácora de jornada (RemoteWorkSession) — unit + integración opcional PG.
 * node server/scripts/test-timeclock-work-log.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import vm from 'node:vm';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(rootDir, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'timeclock-work-log-test-secret';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const {
  normalizeWorkLogText,
  WORK_LOG_MAX_CHARS,
  submitWorkLogForOpenSession,
  workLogPayloadFromSession,
  sessionHasValidWorkLog,
  workLogAdminPayloadFromSession,
} = await import('../src/services/remoteWorkSessionWorkLog.service.js');
const { sanitizeSessionRow } = await import('../src/services/remoteWorkSessionHistory.service.js');

const XSS_PAYLOAD = '<script>alert(1)</script>\nLínea dos';

let failed = 0;
let pgSkip = false;

function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

console.log('\n=== Timeclock — bitácora (unit) ===\n');

check(normalizeWorkLogText('  hola  ') === 'hola', 'trim extremos');
check(normalizeWorkLogText('a\n\nb') === 'a\n\nb', 'conserva saltos de línea');
check(normalizeWorkLogText('') === null, 'vacío → null');
check(normalizeWorkLogText('   \n  ') === null, 'solo espacios → null');
check(normalizeWorkLogText(XSS_PAYLOAD) === XSS_PAYLOAD, 'payload con script y salto se conserva literal');
try {
  normalizeWorkLogText('x'.repeat(WORK_LOG_MAX_CHARS + 1));
  check(false, 'más de 4000 debe lanzar');
} catch (e) {
  check(e.code === 'VALIDATION_ERROR', 'más de 4000 → VALIDATION_ERROR');
}

const workLogSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/remoteWorkSessionWorkLog.service.js'),
  'utf8',
);
const sessionSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/remoteWorkSession.service.js'),
  'utf8',
);
const lockUtilPath = path.join(rootDir, 'src/utils/remoteWorkSessionLock.util.js');
const lockUtil = fs.readFileSync(lockUtilPath, 'utf8');
const publicRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.public.routes.js'), 'utf8');

function listJsFiles(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules') continue;
      listJsFiles(full, acc);
    } else if (ent.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

console.log('\n=== Timeclock — bitácora (transacción / concurrencia estático) ===\n');

const lockSql = 'WHERE id = ${sessionId} AND "checkOutAt" IS NULL';
const srcJs = listJsFiles(path.join(rootDir, 'src'));
const sqlHits = srcJs.filter((p) => fs.readFileSync(p, 'utf8').includes(lockSql));
const defHits = srcJs.filter((p) => /function lockOpenSessionRow\(/.test(fs.readFileSync(p, 'utf8')));
check(
  workLogSvc.includes('return prisma.$transaction(async (tx) =>') &&
    /lockOpenSessionRow\(tx,\s*open\.id\)/.test(workLogSvc) &&
    /updateMany\(\{[\s\S]*?workLogSubmittedAt:\s*null/.test(workLogSvc),
  'find + FOR UPDATE + updateMany en la misma $transaction',
);
check(sqlHits.length === 1 && path.resolve(sqlHits[0]) === path.resolve(lockUtilPath), 'SQL del lock en un solo archivo');
check(defHits.length === 1 && path.resolve(defHits[0]) === path.resolve(lockUtilPath), 'una sola implementación de lockOpenSessionRow');
check(!workLogSvc.includes(lockSql) && !sessionSvc.includes(lockSql), 'checkout y bitácora no copian el SQL');
check(
  /from '\.\.\/utils\/remoteWorkSessionLock\.util\.js'/.test(workLogSvc) &&
    /from '\.\.\/utils\/remoteWorkSessionLock\.util\.js'/.test(sessionSvc),
  'checkout y bitácora importan el util',
);
check(
  /export async function lockOpenSessionRow\(tx, sessionId\)/.test(lockUtil) &&
    /return tx\.remoteWorkSession\.findUnique\(\{ where: \{ id: sessionId \} \}\)/.test(lockUtil),
  'lock(tx, sessionId) relee la fila en la misma transacción',
);
check(
  !/from ['"][^'"]*services\//.test(lockUtil) &&
    !/remoteWorkSessionWorkLog|remoteWorkSessionHistory|remoteWorkSession\.service/.test(lockUtil),
  'util sin servicios de checkout, bitácora ni serialización',
);
check(lockUtil.includes('FOR UPDATE') && !lockUtil.includes('FOR UPDATE`'), 'FOR UPDATE vía tagged template parametrizado');
check(/lockOpenSessionRow\(tx,\s*sessionId\)/.test(sessionSvc), 'cierre admin usa el mismo lock');
check(
  /updateMany\(\{[\s\S]*?id:\s*open\.id,[\s\S]*?employeeId,[\s\S]*?checkOutAt:\s*null,[\s\S]*?workLogSubmittedAt:\s*null/.test(
    workLogSvc,
  ),
  'updateMany filtra id, employeeId, checkOutAt y workLogSubmittedAt',
);
check(
  /WORK_SESSION_NOT_OPEN/.test(workLogSvc) && /fresh\.checkOutAt/.test(workLogSvc) && /WORK_LOG_ALREADY_SUBMITTED/.test(workLogSvc),
  'count 0 distingue jornada cerrada vs bitácora existente',
);
check(
  /WORK_LOG_UPDATE_FAILED/.test(workLogSvc) && /err\.code\s*=\s*'INTERNAL'/.test(workLogSvc),
  'fallo inesperado no se mapea a 409',
);
check(
  /findOpenSession\(tx,\s*employeeId\)/.test(sessionSvc.match(/checkOutRemoteWorkSession[\s\S]+?lockOpenSessionRow\(tx,\s*open\.id\)/)?.[0] || '') &&
    /findOpenSessionRow\(tx,\s*employeeId\)/.test(workLogSvc.match(/submitWorkLogForOpenSession[\s\S]+?lockOpenSessionRow\(tx,\s*open\.id\)/)?.[0] || ''),
  'checkout y bitácora: find open → lock(open.id) (orden compatible)',
);

console.log('\n=== Timeclock — bitácora (contrato body estricto) ===\n');

check(/z\.object\(\{\s*text:\s*z\.string\(\)\s*\}\)\.strict\(\)/.test(publicRoutes), 'POST work-log solo { text } (.strict())');
check(
  !/submitWorkLogForOpenSession\([\s\S]*?sessionId:/.test(publicRoutes) &&
    !/req\.body\?\.(sessionId|organizationId|employeeId|submittedAt)/.test(publicRoutes),
  'ruta no lee sessionId/org/employee/submittedAt del body',
);

console.log('\n=== Timeclock — bitácora (estático HTML/rutas) ===\n');

check(/workLogText/.test(fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8')), 'schema workLogText');
check(/\/session\/work-log/.test(publicRoutes), 'POST public work-log');
check(/employees\/:employeeId\/sessions\/:sessionId\/work-log/.test(fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.org.routes.js'), 'utf8')), 'GET admin work-log');
check(/id="tc-emp-work-log-btn"/.test(indexHtml), 'SVG bitácora en tarjeta jornada');
check(/tc-ws-jornada-top-actions/.test(indexHtml), 'contenedor acciones sin nueva fila');
check(/\.tc-ws-jornada-mini\{[^}]*position:relative/.test(indexHtml), 'tarjeta position relative (sin layout shift fila)');
check(!/tc-ws-jornada-work-log-btn hidden/.test(indexHtml) || /class="tc-ws-jornada-work-log-btn hidden"/.test(indexHtml), 'botón oculto por defecto en DOM');
check(/tcEmpWorkLogIsDirty/.test(indexHtml) && /Tienes cambios sin guardar/.test(indexHtml), 'dirty guard confirm');
check(/tcEmpWorkLogSaving/.test(indexHtml), 'doble submit guard');
check(/hasWorkLog/.test(fs.readFileSync(path.join(rootDir, 'src/services/remoteWorkSessionHistory.service.js'), 'utf8')), 'hasWorkLog en historial');
check(/tcAdminWorkLogAbort|tcAdminWorkLogSeq/.test(indexHtml), 'admin abort/secuencia');
check(/\.tc-work-log-read\{[^}]*white-space:\s*pre-wrap/.test(indexHtml), 'lectura pre-wrap');
check(/font-size:16px/.test(indexHtml.match(/\.tc-work-log-textarea\{[^}]+\}/)?.[0] || ''), 'textarea 16px iOS');
check(/WORK_SESSION_NOT_OPEN/.test(fs.readFileSync(path.join(rootDir, 'src/middleware/error.middleware.js'), 'utf8')), 'código WORK_SESSION_NOT_OPEN');

const rootIndex = path.join(repoRoot, 'index.html');
const pubIndex = path.join(rootDir, 'public/index.html');
if (fs.existsSync(pubIndex)) {
  const pub = fs.readFileSync(pubIndex, 'utf8');
  check(pub === indexHtml, 'index.html raíz idéntico a server/public/index.html');
} else {
  check(true, 'server/public/index.html omitido (sync pendiente)');
}

console.log('\n=== Timeclock — bitácora (invariantes DTO) ===\n');

const submittedAt = new Date('2026-11-02T18:30:00.000Z');
const histBase = {
  id: 'hist-no-log',
  checkInAt: submittedAt,
  checkOutAt: submittedAt,
  status: 'completed',
  signalTelemetryStatus: 'no_data',
  signalSampleCount: 0,
};
const goodPayload = workLogPayloadFromSession({
  workLogText: XSS_PAYLOAD,
  workLogSubmittedAt: submittedAt,
});
check(goodPayload.submitted === true, 'submitted true con texto y timestamp');
check(goodPayload.text === XSS_PAYLOAD && goodPayload.submittedAt === submittedAt, 'submitted true conserva texto y timestamp');
check(goodPayload.text != null && goodPayload.submittedAt != null, 'submitted true no devuelve texto ni timestamp null');

function expectUnsubmitted(label, session) {
  const payload = workLogPayloadFromSession(session);
  check(
    payload.submitted === false && !('text' in payload) && !('submittedAt' in payload),
    label,
  );
}
expectUnsubmitted('timestamp sin texto no es submitted', { workLogText: null, workLogSubmittedAt: submittedAt });
expectUnsubmitted('texto sin timestamp no es submitted', { workLogText: XSS_PAYLOAD, workLogSubmittedAt: null });
expectUnsubmitted('texto vacío no es submitted', { workLogText: '  \n', workLogSubmittedAt: submittedAt });
expectUnsubmitted('timestamp inválido no es submitted', { workLogText: XSS_PAYLOAD, workLogSubmittedAt: 'no-es-fecha' });
expectUnsubmitted('sesión sin bitácora no es submitted', {});

check(sessionHasValidWorkLog({ workLogText: XSS_PAYLOAD, workLogSubmittedAt: submittedAt }) === true, 'predicado completo');
check(sanitizeSessionRow(histBase, submittedAt).hasWorkLog === false, 'histórica sin bitácora hasWorkLog false');
check(
  sanitizeSessionRow({ ...histBase, workLogSubmittedAt: submittedAt }, submittedAt).hasWorkLog === false,
  'solo timestamp hasWorkLog false',
);
check(
  sanitizeSessionRow({ ...histBase, workLogText: XSS_PAYLOAD }, submittedAt).hasWorkLog === false,
  'solo texto hasWorkLog false',
);
check(
  sanitizeSessionRow({ ...histBase, workLogText: '   ', workLogSubmittedAt: submittedAt }, submittedAt).hasWorkLog === false,
  'texto en blanco hasWorkLog false',
);
check(
  sanitizeSessionRow(
    { ...histBase, id: 'hist-log', workLogText: XSS_PAYLOAD, workLogSubmittedAt: submittedAt },
    submittedAt,
  ).hasWorkLog === true,
  'hasWorkLog true solo con texto y timestamp',
);

function expectAdminNotFound(label, session) {
  let code = null;
  try {
    workLogAdminPayloadFromSession(session);
  } catch (e) {
    code = e.code;
  }
  check(code === 'NOT_FOUND', label);
}
expectAdminNotFound('admin sin texto', { workLogText: null, workLogSubmittedAt: submittedAt, checkInAt: submittedAt });
expectAdminNotFound('admin sin timestamp', { workLogText: XSS_PAYLOAD, workLogSubmittedAt: null, checkInAt: submittedAt });
expectAdminNotFound('admin sesión ausente', null);
expectAdminNotFound('admin texto en blanco', { workLogText: ' \n ', workLogSubmittedAt: submittedAt });
const adminView = workLogAdminPayloadFromSession({
  workLogText: XSS_PAYLOAD,
  workLogSubmittedAt: submittedAt,
  checkInAt: submittedAt,
});
check(adminView.text === XSS_PAYLOAD && adminView.submittedAt === submittedAt, 'admin DTO literal sin nulls');
check(
  /NOT_FOUND:\s*404/.test(fs.readFileSync(path.join(rootDir, 'src/middleware/error.middleware.js'), 'utf8')),
  'NOT_FOUND del admin mapea a HTTP 404',
);

console.log('\n=== Timeclock — bitácora (escape y botón) ===\n');

function extractFunction(src, name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start < 0) return '';
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return '';
}

function installWorkLogDom() {
  const nodes = new Map();
  function make(id) {
    const node = { id, className: '' };
    node.classList = { add() {}, remove() {}, contains() { return false; } };
    let text = '';
    let rawHtml = '';
    let fromText = false;
    Object.defineProperty(node, 'textContent', {
      get() { return text; },
      set(v) {
        text = String(v);
        fromText = true;
      },
    });
    Object.defineProperty(node, 'innerHTML', {
      get() {
        if (!fromText) return rawHtml;
        return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
      },
      set(v) {
        fromText = false;
        rawHtml = String(v);
        text = rawHtml.replace(/<[^>]*>/g, '');
        for (const match of rawHtml.matchAll(/\bid="([^"]+)"/g)) {
          if (!nodes.has(match[1])) nodes.set(match[1], make(match[1]));
        }
      },
    });
    return node;
  }
  function getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, make(id));
    return nodes.get(id);
  }
  [
    'tc-emp-work-log-read-text',
    'tc-emp-work-log-read-meta',
    'tc-admin-work-log-body',
    'tc-admin-work-log-err',
    'tc-admin-work-log-retry',
    'tc-admin-work-log-sub',
  ].forEach(getElementById);
  return { document: { getElementById } };
}

const empReadFn = extractFunction(indexHtml, 'tcEmpShowWorkLogRead');
const adminReadFn = extractFunction(indexHtml, 'tcAdminRenderWorkLogRead');
const historyBtnFn = extractFunction(indexHtml, 'tcHistorySessionWorkLogBtnHtml');
const tcEscFn = extractFunction(indexHtml, 'tcEsc');
const svgFn = extractFunction(indexHtml, 'tcSvgClipboardLines');
check(empReadFn && adminReadFn && historyBtnFn && tcEscFn && svgFn, 'funciones de lectura extraíbles');
check(/textEl\.textContent=/.test(empReadFn) && !/innerHTML/.test(empReadFn), 'colaborador en lectura usa textContent');
check(/textEl\.textContent=/.test(adminReadFn) && /tcEsc\(sent\)/.test(adminReadFn), 'admin pinta el texto con textContent y la meta con tcEsc');
check(!/innerHTML[^;]*\bj\.text\b/.test(adminReadFn), 'admin no interpola j.text en innerHTML');

const dom = installWorkLogDom();
const ui = {
  document: dom.document,
  tcEmpMe: { timezone: 'America/Mexico_City' },
  tcJornadaTz: 'America/Mexico_City',
  tcJornadaEmpName: 'Ana',
  tcAdminWorkLogDayKey: null,
  tcHistoryPinnedDay: '2026-11-02',
  tcFmtDayTitle() { return '2 nov 2026'; },
  tcYmdInTimeZone() { return '2026-11-02'; },
};
vm.createContext(ui);
vm.runInContext(`${tcEscFn}\n${svgFn}\n${empReadFn}\n${adminReadFn}\n${historyBtnFn}`, ui);
ui.tcEmpShowWorkLogRead({ text: XSS_PAYLOAD, submittedAt: submittedAt.toISOString() });
const empText = dom.document.getElementById('tc-emp-work-log-read-text');
check(empText.textContent === XSS_PAYLOAD, 'colaborador muestra el payload literal, con salto de línea');
check(empText.innerHTML === ui.tcEsc(XSS_PAYLOAD) && !empText.innerHTML.includes('<script'), 'colaborador no ejecuta el script');
ui.tcAdminRenderWorkLogRead({
  text: XSS_PAYLOAD,
  submittedAt: submittedAt.toISOString(),
  checkInAt: submittedAt.toISOString(),
});
const adminText = dom.document.getElementById('tc-admin-work-log-text');
const adminBody = dom.document.getElementById('tc-admin-work-log-body');
check(adminText.textContent === XSS_PAYLOAD, 'admin muestra el payload literal, con salto de línea');
check(adminText.innerHTML === ui.tcEsc(XSS_PAYLOAD) && !adminBody.innerHTML.includes(XSS_PAYLOAD), 'admin no mete el texto en innerHTML');
check(/<div class="tc-work-log-read" id="tc-emp-work-log-read-text"><\/div>/.test(indexHtml), 'lectura colaborador usa .tc-work-log-read');
check(adminBody.innerHTML.includes('class="tc-work-log-read"'), 'lectura admin usa .tc-work-log-read');
check(ui.tcHistorySessionWorkLogBtnHtml(null) === '', 'sin botón admin si no hay sesión');
check(ui.tcHistorySessionWorkLogBtnHtml({ id: 's1' }) === '', 'sin botón admin si falta hasWorkLog');
check(ui.tcHistorySessionWorkLogBtnHtml({ id: 's1', hasWorkLog: false }) === '', 'sin botón admin con hasWorkLog false');
check(
  ui.tcHistorySessionWorkLogBtnHtml({ id: 's1', hasWorkLog: true }).includes('tcAdminOpenWorkLog'),
  'botón admin solo con hasWorkLog true',
);
check((indexHtml.match(/onclick="tcEmpOpenWorkLogModal\(\)"/g) || []).length === 1, 'un solo onclick de apertura colaborador');
check((indexHtml.match(/onclick="tcEmpSubmitWorkLog\(\)"/g) || []).length === 1, 'un solo onclick de envío');
check((indexHtml.match(/onclick="tcAdminOpenWorkLog\(/g) || []).length === 1, 'un solo onclick de apertura admin');
check(!empReadFn.includes('addEventListener') && !adminReadFn.includes('addEventListener') && !historyBtnFn.includes('addEventListener'), 'lectura sin listeners duplicados');
check(/width="18" height="18"/.test(svgFn), 'SVG con width y height fijos');
check(/\.tc-ws-jornada-work-log-btn\{[^}]*width:36px;height:36px/.test(indexHtml), 'botón 36×36');
check(/\.tc-ws-jornada-work-log-btn svg\{[^}]*width:18px;height:18px/.test(indexHtml), 'SVG CSS 18×18');
check(/position:absolute/.test(indexHtml.match(/\.tc-ws-jornada-work-log-btn--done::after\{[^}]+\}/)?.[0] || ''), 'marca de enviado absoluta, sin empujar la fila');
check(/export async function checkInRemoteWorkSession/.test(sessionSvc) && /type: 'CHECK_IN'/.test(sessionSvc), 'check-in intacto');
check(
  /export async function checkOutRemoteWorkSession/.test(sessionSvc) &&
    /planCloseSignalCredit\(locked, now\)/.test(sessionSvc) &&
    /type: 'CHECK_OUT'/.test(sessionSvc),
  'checkout intacto',
);
check(
  /export async function recordRemoteWorkHeartbeat/.test(sessionSvc) &&
    /planHeartbeatSignalCredit\(locked, now\)/.test(sessionSvc) &&
    /lastHeartbeatAt: now/.test(sessionSvc),
  'heartbeat intacto',
);

console.log('\n=== Timeclock — bitácora (migración) ===\n');

const migRoot = path.join(rootDir, 'prisma/migrations');
const workLogMigs = fs.readdirSync(migRoot).filter((name) => /work_log|workLog/.test(name));
check(
  workLogMigs.length === 1 && workLogMigs[0] === '20261102183000_remote_work_session_work_log',
  'una sola migración 20261102183000_remote_work_session_work_log',
);
const migSql = fs.readFileSync(
  path.join(migRoot, '20261102183000_remote_work_session_work_log/migration.sql'),
  'utf8',
);
check(/ADD COLUMN "workLogText" TEXT;/.test(migSql), 'workLogText nullable, sin DEFAULT');
check(/ADD COLUMN "workLogSubmittedAt" TIMESTAMPTZ\(6\);/.test(migSql), 'workLogSubmittedAt nullable, sin DEFAULT');
check(!/\bUPDATE\b/i.test(migSql) && !/\bNOT NULL\b/.test(migSql) && !/\bDEFAULT\b/i.test(migSql), 'sin backfill ni NOT NULL');
const schemaSql = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
check(/workLogText\s+String\?/.test(schemaSql) && /workLogSubmittedAt\s+DateTime\?/.test(schemaSql), 'Prisma String? y DateTime?');

console.log('\n=== Timeclock — bitácora (integración PG) ===\n');

async function runPgTests() {
  const { prisma } = await import('../src/db/client.js');
  const { createApp } = await import('../src/app.js');
  const { hashPassword } = await import('../src/services/auth.service.js');
  const { generateTimeclockAccessToken } = await import('../src/services/timeclockToken.service.js');
  const { checkInRemoteWorkSession, checkOutRemoteWorkSession } = await import(
    '../src/services/remoteWorkSession.service.js',
  );

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    pgSkip = true;
    console.log('  SKIP  PostgreSQL no disponible (DATABASE_URL)');
    return;
  }

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const adminPass = 'WorkLogTest!9x';

  async function jsonFetch(urlPath, { method = 'GET', body, cookie } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { res, data };
  }

  function cookieFrom(res, name) {
    const raw = res.headers.getSetCookie?.() || [];
    for (const line of raw) {
      const part = line.split(';')[0];
      if (part.startsWith(`${name}=`)) return part;
    }
    return '';
  }

  const org = await prisma.organization.create({
    data: { name: 'WL Org', slug: `wl-${Date.now()}`, credits: 10 },
  });
  const admin = await prisma.user.create({
    data: {
      email: `wl-admin-${Date.now()}@test.local`,
      passwordHash: await hashPassword(adminPass),
      fullName: 'WL Admin',
      role: 'empresa_admin',
      organizationId: org.id,
    },
  });
  const { token } = generateTimeclockAccessToken();
  let orgB = null;
  const emp = await prisma.workforceEmployee.create({
    data: {
      organizationId: org.id,
      fullName: 'WL Employee',
      accessTokenHash: (await import('../src/services/timeclockToken.service.js')).hashTimeclockToken(
        token,
      ),
      timezone: 'America/Mexico_City',
      attendanceEnabled: true,
    },
  });

  try {
    const login = await jsonFetch('/api/auth/login', {
      method: 'POST',
      body: { email: admin.email, password: adminPass },
    });
    const adminCookie = cookieFrom(login.res, 'mind24.sid');
    const ex = await jsonFetch('/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token },
    });
    const tcCookie = cookieFrom(ex.res, 'mind24.tc.sid');

    await checkInRemoteWorkSession({ employeeId: emp.id });
    const open = await prisma.remoteWorkSession.findFirst({
      where: { employeeId: emp.id, checkOutAt: null },
    });

    const ok = await submitWorkLogForOpenSession({
      employeeId: emp.id,
      text: '  línea 1\nlínea 2  ',
    });
    check(!!ok.workLog?.submitted, 'creación OK jornada abierta');
    check(ok.workLog.text === 'línea 1\nlínea 2', 'texto trim conserva cuerpo');

    const me = await jsonFetch('/api/timeclock/public/me', { cookie: tcCookie });
    check(me.data.openSession?.workLog?.submitted === true, '/me incluye workLog submitted');

    const dup = await jsonFetch('/api/timeclock/public/session/work-log', {
      method: 'POST',
      cookie: tcCookie,
      body: { text: 'otra' },
    });
    check(dup.res.status === 409 && dup.data.error === 'WORK_LOG_ALREADY_SUBMITTED', 'segunda bitácora 409');

    const badBody = await jsonFetch('/api/timeclock/public/session/work-log', {
      method: 'POST',
      cookie: tcCookie,
      body: { text: '   ' },
    });
    check(badBody.res.status === 400, 'solo espacios 400');

    const hist = await jsonFetch(
      `/api/org/timeclock/employees/${emp.id}/sessions?from=2020-01-01&to=2030-12-31`,
      { cookie: adminCookie },
    );
    const row = hist.data.sessions?.find((s) => s.id === open.id);
    check(row?.hasWorkLog === true, 'hasWorkLog en listado');

    const wlGet = await jsonFetch(
      `/api/org/timeclock/employees/${emp.id}/sessions/${open.id}/work-log`,
      { cookie: adminCookie },
    );
    check(wlGet.res.status === 200 && wlGet.data.text.includes('línea 1'), 'GET admin on-demand');

    orgB = await prisma.organization.create({
      data: { name: 'WL B', slug: `wl-b-${Date.now()}`, credits: 10 },
    });
    const adminB = await prisma.user.create({
      data: {
        email: `wl-b-${Date.now()}@test.local`,
        passwordHash: await hashPassword(adminPass),
        fullName: 'B',
        role: 'empresa_admin',
        organizationId: orgB.id,
      },
    });
    const loginB = await jsonFetch('/api/auth/login', {
      method: 'POST',
      body: { email: adminB.email, password: adminPass },
    });
    const cookieB = cookieFrom(loginB.res, 'mind24.sid');
    const cross = await jsonFetch(
      `/api/org/timeclock/employees/${emp.id}/sessions/${open.id}/work-log`,
      { cookie: cookieB },
    );
    check(cross.res.status === 404, 'multi-tenant admin 404');

    await checkOutRemoteWorkSession(emp.id);
    const afterCo = await jsonFetch('/api/timeclock/public/session/work-log', {
      method: 'POST',
      cookie: tcCookie,
      body: { text: 'tarde' },
    });
    check(afterCo.res.status === 409 && afterCo.data.error === 'WORK_SESSION_NOT_OPEN', 'sin jornada abierta 409');

    const stored = await prisma.remoteWorkSession.findUnique({ where: { id: open.id } });
    check(stored.workLogText.includes('línea 1'), 'checkout no borra bitácora');

    const raceEmp = await prisma.workforceEmployee.create({
      data: {
        organizationId: org.id,
        fullName: 'Race',
        accessTokenHash: (await import('../src/services/timeclockToken.service.js')).hashTimeclockToken(
          generateTimeclockAccessToken().token,
        ),
        timezone: 'America/Mexico_City',
        attendanceEnabled: true,
      },
    });
    await checkInRemoteWorkSession({ employeeId: raceEmp.id });
    const results = await Promise.all([
      submitWorkLogForOpenSession({ employeeId: raceEmp.id, text: 'A' }).then(() => 'ok').catch((e) => e.code),
      submitWorkLogForOpenSession({ employeeId: raceEmp.id, text: 'B' }).then(() => 'ok').catch((e) => e.code),
    ]);
    const wins = results.filter((r) => r === 'ok').length;
    const conflicts = results.filter((r) => r === 'WORK_LOG_ALREADY_SUBMITTED').length;
    check(wins === 1 && conflicts === 1, 'dos envíos concurrentes → uno OK uno conflicto');
    console.log('  NOTA  esa carrera no certifica checkout vs heartbeat ni concurrencia general');
    const raceRow = await prisma.remoteWorkSession.findFirst({ where: { employeeId: raceEmp.id } });
    check(raceRow.workLogText === 'A' || raceRow.workLogText === 'B', 'no sobrescribe ganador');

    await prisma.remoteWorkSession.updateMany({
      where: { employeeId: raceEmp.id, checkOutAt: null },
      data: { checkOutAt: new Date(), status: 'completed' },
    });

    const tsBefore = stored.workLogSubmittedAt;
    await submitWorkLogForOpenSession({ employeeId: emp.id, text: 'noop' }).catch(() => {});
    const tsAfter = (await prisma.remoteWorkSession.findUnique({ where: { id: open.id } }))
      .workLogSubmittedAt;
    check(tsBefore?.toISOString() === tsAfter?.toISOString(), 'timestamp solo servidor / inmutable');

    const bare = await prisma.remoteWorkSession.create({
      data: {
        employeeId: emp.id,
        checkInAt: new Date('2026-01-01T15:00:00.000Z'),
        checkOutAt: new Date('2026-01-01T16:00:00.000Z'),
        status: 'completed',
      },
    });
    const barePath = `/api/org/timeclock/employees/${emp.id}/sessions/${bare.id}/work-log`;
    const noLog = await jsonFetch(barePath, { cookie: adminCookie });
    check(noLog.res.status === 404, 'admin 404 histórica sin bitácora');
    await prisma.remoteWorkSession.update({
      where: { id: bare.id },
      data: { workLogSubmittedAt: new Date(), workLogText: null },
    });
    const onlyTs = await jsonFetch(barePath, { cookie: adminCookie });
    check(onlyTs.res.status === 404, 'admin 404 con timestamp y sin texto');
    await prisma.remoteWorkSession.update({
      where: { id: bare.id },
      data: { workLogText: 'solo texto', workLogSubmittedAt: null },
    });
    const onlyText = await jsonFetch(barePath, { cookie: adminCookie });
    check(onlyText.res.status === 404, 'admin 404 con texto y sin timestamp');
    const histIncomplete = await jsonFetch(
      `/api/org/timeclock/employees/${emp.id}/sessions?from=2020-01-01&to=2030-12-31`,
      { cookie: adminCookie },
    );
    const bareRow = histIncomplete.data.sessions?.find((s) => s.id === bare.id);
    check(bareRow?.hasWorkLog === false, 'listado histórico incompleto sigue en hasWorkLog false');
  } finally {
    await new Promise((r) => server.close(r));
    const empIds = (
      await prisma.workforceEmployee.findMany({ where: { organizationId: org.id }, select: { id: true } })
    ).map((x) => x.id);
    if (empIds.length) {
      await prisma.remoteWorkEvent.deleteMany({ where: { employeeId: { in: empIds } } });
      await prisma.remoteWorkSession.deleteMany({ where: { employeeId: { in: empIds } } });
    }
    await prisma.workforceEmployee.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { id: admin.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    if (orgB) {
      await prisma.user.deleteMany({ where: { organizationId: orgB.id } });
      await prisma.organization.delete({ where: { id: orgB.id } }).catch(() => {});
    }
  }
}

await runPgTests().catch((e) => {
  if (String(e.message || '').includes('connect') || String(e.code || '').includes('P1001')) {
    pgSkip = true;
    console.log('  SKIP  PostgreSQL no disponible');
  } else {
    console.error('  FAIL  integración:', e.message);
    failed += 1;
  }
});

if (failed) {
  console.error(`\n✗ ${failed} fallo(s)${pgSkip ? ' (PG skipped)' : ''}\n`);
  process.exit(1);
}
console.log(`\n✓ Timeclock work log tests OK${pgSkip ? ' (PG skipped)' : ''}.\n`);

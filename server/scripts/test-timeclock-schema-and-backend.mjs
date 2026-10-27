/**
 * Reloj checador remoto — Fase 1B (schema + backend).
 * Ejecutar: node server/scripts/test-timeclock-schema-and-backend.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'timeclock-test-session-secret';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const crypto = await import('crypto');
const { prisma } = await import('../src/db/client.js');
const {
  generateTimeclockAccessToken,
  hashTimeclockToken,
  TIMECLOCK_TOKEN_RAW_BYTES,
  buildTimeclockAccessLink,
  normalizeTimeclockPublicLinkBase,
  resolveTimeclockPublicLinkBase,
} = await import('../src/services/timeclockToken.service.js');
const {
  resolveCurrentWebSignal,
  WEB_SIGNAL_NO_SIGNAL_THRESHOLD_MS,
  webSignalFromVisibility,
} = await import('../src/services/timeclockWebSignal.service.js');
const { createApp } = await import('../src/app.js');
const { buildAdminJornadaPayload, workedDurationSec } = await import(
  '../src/services/remoteWorkSession.service.js'
);
const { hashPassword } = await import('../src/services/auth.service.js');
const {
  isTimeclockSessionCurrent,
  TIMECLOCK_SESSION_COOKIE,
} = await import('../src/middleware/timeclockSession.middleware.js');
const {
  employeeAttendanceEnabled,
  normalizeExpectedWorkMinutesInput,
  assertEmployeeAttendanceEligible,
  DEFAULT_EXPECTED_WORK_MINUTES,
} = await import('../src/services/workforceExpectedWork.service.js');

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

async function jsonFetch(base, path, { method = 'GET', body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${path}`, {
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

console.log('\n=== Timeclock 1B — unit ===\n');

const { token, hash } = generateTimeclockAccessToken();
check(token.length >= 40 && token.length <= 64, 'A/B token 32-byte base64url plausible length');
check(hash.length === 64 && /^[a-f0-9]+$/.test(hash), 'B hash SHA-256 hex only');
check(hashTimeclockToken(token) === hash, 'B hash deterministic');

const rawBuf = crypto.default.randomBytes(TIMECLOCK_TOKEN_RAW_BYTES);
check(rawBuf.length === 32, 'B token uses 32 random bytes');

check(
  normalizeTimeclockPublicLinkBase('https://mind24-production.up.railway.app') ===
    'https://mind24-production.up.railway.app/checador',
  'link base origin-only → /checador',
);
check(
  normalizeTimeclockPublicLinkBase('https://mind24-production.up.railway.app/checador/') ===
    'https://mind24-production.up.railway.app/checador',
  'link base strips trailing slash',
);
check(
  resolveTimeclockPublicLinkBase({
    TIMECLOCK_PUBLIC_LINK_BASE: 'https://mind24-production.up.railway.app/checador',
    NODE_ENV: 'production',
  }) === 'https://mind24-production.up.railway.app/checador',
  'explicit TIMECLOCK_PUBLIC_LINK_BASE wins',
);
check(
  resolveTimeclockPublicLinkBase({
    RAILWAY_PUBLIC_DOMAIN: 'mind24-production.up.railway.app',
    NODE_ENV: 'production',
  }) === 'https://mind24-production.up.railway.app/checador',
  'fallback RAILWAY_PUBLIC_DOMAIN',
);
check(
  resolveTimeclockPublicLinkBase({ NODE_ENV: 'development', PORT: '3000' }) ===
    'http://localhost:3000/checador',
  'dev fallback localhost',
);
let prodMissing = false;
try {
  resolveTimeclockPublicLinkBase({ NODE_ENV: 'production' });
} catch (e) {
  prodMissing = e.code === 'CONFIG_ERROR';
}
check(prodMissing, 'production without base throws CONFIG_ERROR');
check(
  !String(resolveTimeclockPublicLinkBase({ NODE_ENV: 'development' })).includes('mind24.mx'),
  'no silent mind24.mx fallback',
);
const sampleTok = 'A'.repeat(43);
check(
  buildTimeclockAccessLink(sampleTok, 'https://mind24-production.up.railway.app/checador') ===
    `https://mind24-production.up.railway.app/checador#${sampleTok}`,
  'accessLink keeps #TOKEN fragment',
);

const sessionRow = {
  checkOutAt: null,
  lastHeartbeatAt: new Date(Date.now() - 1000),
  lastVisibilityState: 'visible',
  lastWebSignal: 'connected',
};
check(resolveCurrentWebSignal(sessionRow) === 'connected', 'M web signal CONNECTED');
sessionRow.lastVisibilityState = 'hidden';
check(resolveCurrentWebSignal(sessionRow) === 'background', 'N web signal BACKGROUND');
sessionRow.lastHeartbeatAt = new Date(Date.now() - WEB_SIGNAL_NO_SIGNAL_THRESHOLD_MS - 1000);
check(resolveCurrentWebSignal(sessionRow) === 'no_signal', 'O NO_SIGNAL derived by time');
check(webSignalFromVisibility('hidden') === 'background', 'N visibility hidden → background');

check(TIMECLOCK_SESSION_COOKIE.name === 'mind24.tc.sid', 'cookie name mind24.tc.sid');
check(TIMECLOCK_SESSION_COOKIE.httpOnly === true, 'cookie HttpOnly');
check(TIMECLOCK_SESSION_COOKIE.sameSite === 'lax', 'cookie SameSite=lax');
check(TIMECLOCK_SESSION_COOKIE.path === '/api/timeclock/public', 'cookie Path público');

const sessionV1 = { employeeId: 'emp-1', tokenVersion: 1, organizationId: 'org-1' };
const empV1 = { id: 'emp-1', tokenVersion: 1 };
const empV2 = { id: 'emp-1', tokenVersion: 2 };
check(isTimeclockSessionCurrent(sessionV1, empV1) === true, 'G session tokenVersion=1 matches employee');
check(isTimeclockSessionCurrent(sessionV1, empV2) === false, 'G session tokenVersion=1 rejected after regenerate=2');

const closedAt = new Date('2026-10-15T18:00:00Z');
const closedSession = {
  id: 's1',
  checkInAt: new Date('2026-10-15T10:00:00Z'),
  checkOutAt: closedAt,
  status: 'completed',
  lastHeartbeatAt: new Date('2026-10-15T17:50:00Z'),
  lastWebSignal: 'connected',
};
const lastClosed = buildAdminJornadaPayload(null, closedSession);
check(lastClosed.shiftLifecycle === 'SHIFT_COMPLETED', 'admin last closed → SHIFT_COMPLETED');
check(lastClosed.session && lastClosed.session.checkOutAt, 'admin last closed includes checkOutAt');
check(workedDurationSec(closedSession) === 8 * 3600, 'admin duration 8h');
const none = buildAdminJornadaPayload(null, null);
check(none.shiftLifecycle === 'OFF_DUTY' && none.session == null, 'admin no sessions → OFF_DUTY');

console.log('\n=== Jornada esperada — unit ===\n');
check(DEFAULT_EXPECTED_WORK_MINUTES === 480, 'default expected work 8h');
check(employeeAttendanceEnabled({ expectedWorkMinutes: 480 }) === true, '480 min → attendance enabled');
check(employeeAttendanceEnabled({ expectedWorkMinutes: null }) === false, 'null → no attendance');
check(employeeAttendanceEnabled({ expectedWorkMinutes: 0 }) === false, '0 → no attendance');
check(normalizeExpectedWorkMinutesInput(360) === 360, 'normalize positive minutes');
check(normalizeExpectedWorkMinutesInput(0) === null, 'normalize 0 → null');
let attBlock = false;
try {
  assertEmployeeAttendanceEligible({ expectedWorkMinutes: null });
} catch (e) {
  attBlock = e.code === 'ATTENDANCE_NOT_CONFIGURED';
}
check(attBlock, 'assert blocks without jornada');

console.log('\n=== Timeclock 1B — integration (DB) ===\n');

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP integration:', e.message);
}

if (dbOk) {
  const suffix = crypto.default.randomBytes(4).toString('hex');
  const orgA = await prisma.organization.create({
    data: {
      name: `TC Test A ${suffix}`,
      empresaPortalEnabled: true,
      credits: 0,
    },
  });
  const orgB = await prisma.organization.create({
    data: {
      name: `TC Test B ${suffix}`,
      empresaPortalEnabled: true,
      credits: 0,
    },
  });
  const adminPass = 'TestAdmin1!';
  const adminA = await prisma.user.create({
    data: {
      email: `tc-admin-a-${suffix}@example.com`,
      passwordHash: await hashPassword(adminPass),
      fullName: 'Admin A',
      role: 'empresa_admin',
      organizationId: orgA.id,
    },
  });
  const adminB = await prisma.user.create({
    data: {
      email: `tc-admin-b-${suffix}@example.com`,
      passwordHash: await hashPassword(adminPass),
      fullName: 'Admin B',
      role: 'empresa_admin',
      organizationId: orgB.id,
    },
  });

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const loginA = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { email: adminA.email, password: adminPass },
    });
    const adminCookie = cookieHeaderFromResponse(loginA.res, 'mind24.sid');
    check(loginA.res.status === 200 && adminCookie, 'R admin login');

    const createEmp = await jsonFetch(base, '/api/org/timeclock/employees', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        fullName: 'Colaborador Uno',
        timezone: 'America/Tijuana',
        position: 'Analista',
      },
    });
    check(createEmp.res.status === 201, 'A create employee 201');
    check(createEmp.data.accessLink?.includes('#'), 'A access link with fragment');
    const secretToken = createEmp.data.accessLink.split('#')[1];
    const empId = createEmp.data.employee?.id;
    check(empId && secretToken, 'A employee id + secret token in response only');

    const stored = await prisma.workforceEmployee.findUnique({ where: { id: empId } });
    check(stored?.accessTokenHash === hashTimeclockToken(secretToken), 'T hash persisted not raw');
    check(!stored?.accessTokenHash?.includes(secretToken.slice(0, 8)), 'T no raw token in DB');
    check(stored?.expectedWorkMinutes === 480, 'create default expectedWorkMinutes 480');
    check(createEmp.data.employee?.attendanceEnabled === true, 'create employee attendanceEnabled');

    const createNoJornada = await jsonFetch(base, '/api/org/timeclock/employees', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        fullName: 'Sin jornada esperada',
        timezone: 'America/Tijuana',
        expectedWorkMinutes: null,
      },
    });
    check(createNoJornada.res.status === 201, 'create sin jornada 201');
    check(createNoJornada.data.employee?.attendanceEnabled === false, 'sin jornada attendanceEnabled false');
    const empNoId = createNoJornada.data.employee?.id;
    const tokenNo = createNoJornada.data.accessLink?.split('#')[1];
    const exNo = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: tokenNo },
    });
    const tcNo = cookieHeaderFromResponse(exNo.res, 'mind24.tc.sid');
    const meNo = await jsonFetch(base, '/api/timeclock/public/me', { cookie: tcNo });
    check(meNo.data.attendanceEnabled === false, 'public me attendanceEnabled false');
    const ciNo = await jsonFetch(base, '/api/timeclock/public/check-in', {
      method: 'POST',
      cookie: tcNo,
      body: {},
    });
    check(ciNo.res.status === 403 && ciNo.data?.error === 'ATTENDANCE_NOT_CONFIGURED', 'sin jornada check-in 403');

    const patchEw = await jsonFetch(base, `/api/org/timeclock/employees/${empNoId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { expectedWorkMinutes: 360 },
    });
    check(patchEw.res.status === 200 && patchEw.data.expectedWorkMinutes === 360, 'patch assign 6h jornada');
    const exNo2 = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: tokenNo },
    });
    const tcNo2 = cookieHeaderFromResponse(exNo2.res, 'mind24.tc.sid');
    const ciAfter = await jsonFetch(base, '/api/timeclock/public/check-in', {
      method: 'POST',
      cookie: tcNo2,
      body: {},
    });
    check(ciAfter.res.status === 201, 'check-in after jornada assigned');
    const coAfter = await jsonFetch(base, '/api/timeclock/public/check-out', {
      method: 'POST',
      cookie: tcNo2,
      body: {},
    });
    check(coAfter.res.status === 200, 'check-out after assigned jornada');
    const sessionsBeforeRemove = await prisma.remoteWorkSession.count({ where: { employeeId: empNoId } });
    check(sessionsBeforeRemove >= 1, 'history session exists');

    await jsonFetch(base, `/api/org/timeclock/employees/${empNoId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { expectedWorkMinutes: null },
    });
    const sessionsAfterRemove = await prisma.remoteWorkSession.count({ where: { employeeId: empNoId } });
    check(sessionsAfterRemove === sessionsBeforeRemove, 'remove jornada keeps session history');
    const exNo3 = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: tokenNo },
    });
    const tcNo3 = cookieHeaderFromResponse(exNo3.res, 'mind24.tc.sid');
    const ciBlocked = await jsonFetch(base, '/api/timeclock/public/check-in', {
      method: 'POST',
      cookie: tcNo3,
      body: {},
    });
    check(ciBlocked.res.status === 403, 'check-in blocked after jornada removed');

    const exchange = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: secretToken },
    });
    check(exchange.res.status === 200, 'C valid exchange');
    const tcCookie = cookieHeaderFromResponse(exchange.res, 'mind24.tc.sid');
    check(tcCookie.includes('mind24.tc.sid'), 'C timeclock session cookie');
    const setCookie = parseSetCookie(exchange.res).find((c) => c.startsWith('mind24.tc.sid=')) || '';
    check(/HttpOnly/i.test(setCookie), 'C cookie HttpOnly');
    check(/SameSite=Lax/i.test(setCookie), 'C cookie SameSite=Lax');
    check(/Path=\/api\/timeclock\/public/i.test(setCookie), 'C cookie Path');
    const exchangeAgain = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      cookie: tcCookie,
      body: { token: secretToken },
    });
    const tcCookieRotated = cookieHeaderFromResponse(exchangeAgain.res, 'mind24.tc.sid');
    check(
      exchangeAgain.res.status === 200 && tcCookieRotated && tcCookieRotated !== tcCookie,
      'C exchange regenerates session id',
    );

    const badEx = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: 'invalid-token-that-is-not-valid-base64url-format-xxx' },
    });
    check(badEx.res.status === 401, 'D invalid token');

    const regen = await jsonFetch(base, `/api/org/timeclock/employees/${empId}/regenerate-token`, {
      method: 'POST',
      cookie: adminCookie,
    });
    const newToken = regen.data.accessLink?.split('#')[1];
    check(regen.res.status === 200 && newToken !== secretToken, 'E regenerate new token');

    const oldSessionMe = await jsonFetch(base, '/api/timeclock/public/me', { cookie: tcCookie });
    check(oldSessionMe.res.status === 401, 'G tokenVersion invalidates old session');

    const revoked = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: secretToken },
    });
    check(revoked.res.status === 401, 'E token revoked after regenerate');

    const storedAfterRegen = await prisma.workforceEmployee.findUnique({ where: { id: empId } });
    check(storedAfterRegen?.tokenVersion === 2, 'G employee tokenVersion incremented to 2');

    const exNew = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: newToken },
    });
    check(exNew.res.status === 200, 'E new token works after regenerate');
    const tcCookieNew = cookieHeaderFromResponse(exNew.res, 'mind24.tc.sid');
    const meNew = await jsonFetch(base, '/api/timeclock/public/me', { cookie: tcCookieNew });
    check(meNew.res.status === 200, 'E new public session works');

    await jsonFetch(base, `/api/org/timeclock/employees/${empId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { isActive: false },
    });
    const disabledEx = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: newToken },
    });
    check(disabledEx.res.status === 403 || disabledEx.res.status === 401, 'F disabled employee blocked');
    await jsonFetch(base, `/api/org/timeclock/employees/${empId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { isActive: true },
    });
    const exActive = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: newToken },
    });
    const tcCookie3 = cookieHeaderFromResponse(exActive.res, 'mind24.tc.sid');

    const ci1 = await jsonFetch(base, '/api/timeclock/public/check-in', {
      method: 'POST',
      cookie: tcCookie3,
      body: {},
    });
    check(ci1.res.status === 201 && ci1.data.created === true, 'H check-in new');
    const checkInAt1 = ci1.data.session.checkInAt;

    const ci2 = await jsonFetch(base, '/api/timeclock/public/check-in', {
      method: 'POST',
      cookie: tcCookie3,
      body: {},
    });
    check(ci2.res.status === 200 && ci2.data.created === false, 'I duplicate check-in idempotent');
    check(ci2.data.session.id === ci1.data.session.id, 'I same open session');

    const eventsAfterOneCheckIn = await prisma.remoteWorkEvent.count({
      where: { employeeId: empId, type: 'CHECK_IN' },
    });
    check(eventsAfterOneCheckIn === 1, 'I single CHECK_IN event');

    const eventsBeforeHb = await prisma.remoteWorkEvent.count({
      where: { sessionId: ci1.data.session.id },
    });
    const hb = await jsonFetch(base, '/api/timeclock/public/heartbeat', {
      method: 'POST',
      cookie: tcCookie3,
      body: { visibilityState: 'visible' },
    });
    check(hb.res.status === 200 && hb.data.lastHeartbeatAt, 'K heartbeat updates lastHeartbeatAt');
    check(hb.data.webSignal === 'connected', 'M heartbeat visible → CONNECTED');
    const afterHb = await prisma.remoteWorkSession.findUnique({ where: { id: ci1.data.session.id } });
    check(afterHb.lastHeartbeatAt != null, 'K lastHeartbeatAt persisted');
    check(afterHb.checkInAt.toISOString() === checkInAt1, 'L heartbeat does not alter checkInAt');
    check(afterHb.checkOutAt == null && afterHb.status === 'open', 'L heartbeat does not close shift');

    const hbAgain = await jsonFetch(base, '/api/timeclock/public/heartbeat', {
      method: 'POST',
      cookie: tcCookie3,
      body: { visibilityState: 'visible' },
    });
    check(hbAgain.res.status === 200, 'K second heartbeat accepted');
    const eventsAfterSameVis = await prisma.remoteWorkEvent.count({
      where: { sessionId: ci1.data.session.id },
    });
    check(eventsAfterSameVis === eventsBeforeHb, 'K no event per heartbeat (same visibility)');

    const hbBg = await jsonFetch(base, '/api/timeclock/public/heartbeat', {
      method: 'POST',
      cookie: tcCookie3,
      body: { visibilityState: 'hidden' },
    });
    check(hbBg.data.webSignal === 'background', 'N heartbeat background signal');
    const afterBg = await prisma.remoteWorkSession.findUnique({ where: { id: ci1.data.session.id } });
    check(afterBg.checkInAt.toISOString() === checkInAt1 && afterBg.checkOutAt == null, 'L hidden HB does not alter jornada');

    const co1 = await jsonFetch(base, '/api/timeclock/public/check-out', {
      method: 'POST',
      cookie: tcCookie3,
      body: {},
    });
    check(co1.res.status === 200 && co1.data.session.checkOutAt, 'P checkout');
    const co2 = await jsonFetch(base, '/api/timeclock/public/check-out', {
      method: 'POST',
      cookie: tcCookie3,
      body: {},
    });
    check(co2.res.status === 200 && co2.data.alreadyClosed === true, 'Q checkout retry idempotent');

    const checkoutEvents = await prisma.remoteWorkEvent.count({
      where: { sessionId: ci1.data.session.id, type: 'CHECK_OUT' },
    });
    check(checkoutEvents === 1, 'Q single CHECK_OUT event');

    const loginB = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { email: adminB.email, password: adminPass },
    });
    const adminCookieB = cookieHeaderFromResponse(loginB.res, 'mind24.sid');
    const listB = await jsonFetch(base, '/api/org/timeclock/employees', { cookie: adminCookieB });
    check(
      !listB.data.employees?.some((e) => e.id === empId),
      'R org B cannot list org A employees',
    );
    const getB = await jsonFetch(base, `/api/org/timeclock/employees/${empId}`, { cookie: adminCookieB });
    check(getB.res.status === 404, 'R org B cannot read org A employee');
    const patchB = await jsonFetch(base, `/api/org/timeclock/employees/${empId}`, {
      method: 'PATCH',
      cookie: adminCookieB,
      body: { fullName: 'Hijack' },
    });
    check(patchB.res.status === 404, 'R org B cannot edit org A employee');
    const regenB = await jsonFetch(base, `/api/org/timeclock/employees/${empId}/regenerate-token`, {
      method: 'POST',
      cookie: adminCookieB,
    });
    check(regenB.res.status === 404, 'R org B cannot regenerate org A token');
    const closeB = await jsonFetch(base, `/api/org/timeclock/sessions/${ci1.data.session.id}/admin-close`, {
      method: 'POST',
      cookie: adminCookieB,
      body: { closeReason: 'intento de cierre cruzado' },
    });
    check(closeB.res.status === 404, 'R org B cannot admin-close org A session');

    const idxRows = await prisma.$queryRaw`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'RemoteWorkSession_one_open_per_employee'
    `;
    const idxDef = idxRows?.[0]?.indexdef || '';
    check(Array.isArray(idxRows) && idxRows.length === 1, 'partial unique index exists');
    check(
      /UNIQUE/i.test(idxDef) && /checkOutAt/i.test(idxDef) && /IS NULL/i.test(idxDef),
      'partial unique index WHERE checkOutAt IS NULL',
    );

    const exRace = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: newToken },
    });
    const tcRace = cookieHeaderFromResponse(exRace.res, 'mind24.tc.sid');
    const raceResults = await Promise.all(
      Array.from({ length: 5 }, () =>
        jsonFetch(base, '/api/timeclock/public/check-in', {
          method: 'POST',
          cookie: tcRace,
          body: {},
        }),
      ),
    );
    const openCount = await prisma.remoteWorkSession.count({
      where: { employeeId: empId, checkOutAt: null },
    });
    check(openCount === 1, 'J race check-in → one open session');
    check(raceResults.every((r) => r.res.status === 200 || r.res.status === 201), 'J race all succeed');
    const createdFlags = raceResults.map((r) => r.data?.created);
    check(createdFlags.filter(Boolean).length <= 1, 'J at most one created=true');
    check(createdFlags.some((c) => c === false), 'J at least one recovered existing session');
    const raceSessionId = raceResults.find((r) => r.data?.session?.id)?.data.session.id;
    const raceCheckIns = await prisma.remoteWorkEvent.count({
      where: { sessionId: raceSessionId, type: 'CHECK_IN' },
    });
    check(raceCheckIns === 1, 'J single CHECK_IN after race');

    const me = await jsonFetch(base, '/api/timeclock/public/me', { cookie: tcRace });
    check(me.data.serverTime && me.data.shiftLifecycle === 'SHIFT_OPEN', 'S serverTime on me');

    await prisma.remoteWorkSession.updateMany({
      where: { employeeId: empId, checkOutAt: null },
      data: { checkOutAt: new Date(), status: 'completed' },
    });
  } finally {
    await new Promise((r) => server.close(r));
    const empIds = (
      await prisma.workforceEmployee.findMany({
        where: { organizationId: { in: [orgA.id, orgB.id] } },
        select: { id: true },
      })
    ).map((x) => x.id);
    if (empIds.length) {
      await prisma.remoteWorkEvent.deleteMany({ where: { employeeId: { in: empIds } } });
      await prisma.remoteWorkSession.deleteMany({ where: { employeeId: { in: empIds } } });
    }
    await prisma.workforceEmployee.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminA.id, adminB.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  }
}

console.log(failed === 0 ? '\n✓ Timeclock 1B tests OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

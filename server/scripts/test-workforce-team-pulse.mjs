/**
 * Pulso de hoy — Gestión de equipo.
 * node server/scripts/test-workforce-team-pulse.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'team-pulse-test-secret';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');
const orgRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.org.routes.js'), 'utf8');
const pulseSvc = fs.readFileSync(path.join(rootDir, 'src/services/teamPulse.service.js'), 'utf8');

const { mergeOrgTaskCountsFromGroupBy, getTeamPulseForOrganization } = await import(
  '../src/services/teamPulse.service.js'
);
const { prisma } = await import('../src/db/client.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/services/auth.service.js');

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

async function jsonFetch(base, urlPath, { method = 'GET', body, cookie } = {}) {
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

console.log('\n=== Pulso de hoy — estático ===\n');

check(/router\.get\('\/team-pulse'/.test(orgRoutes), 'route GET team-pulse');
check(/getTeamPulseForOrganization/.test(orgRoutes), 'route usa servicio pulse');
check(/tc-pulse-btn/.test(indexHtml) && /Pulso de hoy/.test(indexHtml), 'botón Pulso de hoy');
check(/tc-page-head-actions/.test(indexHtml), 'botón junto a agregar colaborador');
check(/tc-pulse-popover/.test(indexHtml) && /tcToggleTeamPulse/.test(indexHtml), 'popover flotante');
check(/tcCloseTeamPulse/.test(indexHtml) && /Escape/.test(indexHtml), 'cierre escape y helper');
check(!/location\.reload\(/.test(indexHtml.match(/function tcOpenTeamPulse[\s\S]{0,600}/)?.[0] || ''), 'sin reload al abrir pulso');
check(/Promise\.all/.test(pulseSvc), 'consultas agregadas en paralelo');
check(/dueAt:\s*\{\s*lt:/.test(pulseSvc), 'vencidas derivadas dueAt');
check(/isActive:\s*true/.test(pulseSvc), 'en jornada solo colaboradores habilitados');
check(/Completadas totales/.test(indexHtml), 'copy completadas totales');

console.log('\n=== Pulso de hoy — unit ===\n');

const merged = mergeOrgTaskCountsFromGroupBy([
  { status: 'PENDING', _count: { _all: 4 } },
  { status: 'IN_PROGRESS', _count: { _all: 2 } },
  { status: 'COMPLETED', _count: { _all: 9 } },
]);
check(merged.pending === 4 && merged.inProgress === 2 && merged.completed === 9, 'merge conteos tareas');

const { endOfCalendarDayInTimeZone } = await import('../src/utils/workforceDueDate.js');
const dueEnd = endOfCalendarDayInTimeZone('2026-10-20', 'America/Mexico_City');
const midDueDay = new Date('2026-10-20T20:00:00.000Z');
check(dueEnd && dueEnd.getTime() > midDueDay.getTime(), 'fecha límite vence al terminar el día TZ');
check(dueEnd && dueEnd.getTime() < new Date('2026-10-21T08:00:00.000Z').getTime(), 'fin de día antes del día siguiente');

console.log('\n=== Pulso de hoy — integration (DB) ===\n');

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP integration:', e.message);
}

if (dbOk) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const now = new Date('2026-10-18T18:00:00.000Z');
  const pastDue = new Date('2026-10-17T12:00:00.000Z');
  const orgA = await prisma.organization.create({
    data: { name: `Pulse A ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const orgB = await prisma.organization.create({
    data: { name: `Pulse B ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const adminPass = 'TestAdmin1!';
  const adminA = await prisma.user.create({
    data: {
      email: `pulse-admin-${suffix}@example.com`,
      passwordHash: await hashPassword(adminPass),
      fullName: 'Admin Pulse',
      role: 'empresa_admin',
      organizationId: orgA.id,
    },
  });
  const empActive = await prisma.workforceEmployee.create({
    data: {
      organizationId: orgA.id,
      fullName: 'Activo',
      timezone: 'America/Mexico_City',
      accessTokenHash: crypto.randomBytes(32).toString('hex'),
      isActive: true,
      tokenVersion: 1,
    },
  });
  await prisma.workforceEmployee.create({
    data: {
      organizationId: orgA.id,
      fullName: 'Inactivo',
      timezone: 'America/Mexico_City',
      accessTokenHash: crypto.randomBytes(32).toString('hex'),
      isActive: false,
      tokenVersion: 1,
    },
  });
  const empB = await prisma.workforceEmployee.create({
    data: {
      organizationId: orgB.id,
      fullName: 'Otra org',
      timezone: 'America/Mexico_City',
      accessTokenHash: crypto.randomBytes(32).toString('hex'),
      isActive: true,
      tokenVersion: 1,
    },
  });

  const empInactiveOpen = await prisma.workforceEmployee.create({
    data: {
      organizationId: orgA.id,
      fullName: 'Inactivo en jornada',
      timezone: 'America/Mexico_City',
      accessTokenHash: crypto.randomBytes(32).toString('hex'),
      isActive: false,
      tokenVersion: 1,
    },
  });
  await prisma.remoteWorkSession.create({
    data: {
      employeeId: empActive.id,
      checkInAt: new Date('2026-10-18T14:00:00.000Z'),
      checkOutAt: null,
    },
  });
  await prisma.remoteWorkSession.create({
    data: {
      employeeId: empInactiveOpen.id,
      checkInAt: new Date('2026-10-18T14:00:00.000Z'),
      checkOutAt: null,
    },
  });

  await prisma.workforceTask.createMany({
    data: [
      {
        organizationId: orgA.id,
        employeeId: empActive.id,
        title: 'P',
        status: 'PENDING',
        position: 1000,
        archivedAt: null,
      },
      {
        organizationId: orgA.id,
        employeeId: empActive.id,
        title: 'Over',
        status: 'IN_PROGRESS',
        position: 2000,
        dueAt: pastDue,
        startedAt: pastDue,
        archivedAt: null,
      },
      {
        organizationId: orgA.id,
        employeeId: empActive.id,
        title: 'Due today',
        status: 'PENDING',
        position: 2500,
        dueAt: endOfCalendarDayInTimeZone('2026-10-18', 'America/Mexico_City'),
        archivedAt: null,
      },
      {
        organizationId: orgA.id,
        employeeId: empActive.id,
        title: 'Done arch',
        status: 'COMPLETED',
        position: 3000,
        completedAt: now,
        archivedAt: now,
      },
      {
        organizationId: orgB.id,
        employeeId: empB.id,
        title: 'Foreign',
        status: 'PENDING',
        position: 1000,
        archivedAt: null,
      },
    ],
  });

  const pulseA = await getTeamPulseForOrganization(orgA.id, now);
  check(pulseA.collaborators === 1, 'colaboradores habilitados');
  check(pulseA.onShiftNow === 1, 'en jornada ahora sin inactivos');
  check(pulseA.pending === 2 && pulseA.inProgress === 1, 'pending e in progress');
  check(pulseA.overdue === 1, 'vencidas derivadas sin vencer el mismo día límite');
  check(pulseA.completed === 1, 'completadas incluye archivada');

  const pulseB = await getTeamPulseForOrganization(orgB.id, now);
  check(pulseB.pending === 1 && pulseB.onShiftNow === 0, 'aislamiento multi-org');

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { email: adminA.email, password: adminPass },
    });
    const cookie = cookieHeaderFromResponse(login.res, 'mind24.sid');
    const http = await jsonFetch(base, '/api/org/timeclock/team-pulse', { cookie });
    check(http.res.status === 200 && http.data.pulse?.completed === 1, 'GET team-pulse API');
  } finally {
    server.close();
    await prisma.workforceTask.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.remoteWorkSession.deleteMany({
      where: { employeeId: { in: [empActive.id, empInactiveOpen.id, empB.id] } },
    });
    await prisma.workforceEmployee.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { organizationId: orgA.id } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  }
}

console.log(failed === 0 ? '\n✓ Team pulse tests OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

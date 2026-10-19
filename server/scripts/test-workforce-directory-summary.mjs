/**
 * Directorio Gestión de equipo — resumen de actividades por colaborador.
 * node server/scripts/test-workforce-directory-summary.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'workforce-directory-test-secret';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');
const empSvc = fs.readFileSync(path.join(rootDir, 'src/services/workforceEmployee.service.js'), 'utf8');
const summarySvc = fs.readFileSync(path.join(rootDir, 'src/services/workforceTaskSummary.service.js'), 'utf8');

const {
  mergeTaskSummaryFromGroupByRows,
  aggregateWorkforceTaskSummariesForOrg,
} = await import('../src/services/workforceTaskSummary.service.js');
const { listWorkforceEmployees } = await import('../src/services/workforceEmployee.service.js');
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

console.log('\n=== Directorio — estático ===\n');

check(/<th class="tc-emp-th-num">Pendientes<\/th>/.test(indexHtml), 'header Pendientes');
check(/<th class="tc-emp-th-num">En progreso<\/th>/.test(indexHtml), 'header En progreso');
check(/<th class="tc-emp-th-num">Completadas<\/th>/.test(indexHtml), 'header Completadas');
check(!/<th>Zona horaria<\/th>/.test(indexHtml), 'sin columna Zona horaria en directorio');
check(/tcDirTaskChipHtml/.test(indexHtml) && /tc-dir-task-chip/.test(indexHtml), 'microchips directorio');
check(!/tcLoadEmployees[\s\S]{0,800}emp\.timezone/.test(indexHtml), 'directorio no renderiza timezone');
check(/taskSummary/.test(empSvc), 'listado enriquecido taskSummary');
check(/aggregateWorkforceTaskSummariesForOrg/.test(empSvc), 'un agregado por org en listado');
check(/employeeIdsWithOpenShiftForOrganization/.test(empSvc), 'jornada abierta agregada en listado');
check(/hasOpenShift/.test(empSvc), 'hasOpenShift en listado');
check(/groupBy/.test(summarySvc) && /aggregateWorkforceTaskSummariesForOrg/.test(summarySvc), 'groupBy agregado tareas');
check(/tc-emp-th-status">Jornada/.test(indexHtml), 'columna Jornada en directorio');
check(/tcDirJornadaStatusHtml/.test(indexHtml) && /En jornada/.test(indexHtml) && /Fuera de jornada/.test(indexHtml), 'estados jornada directorio');
check(!/tcDirJornadaStatusHtml[\s\S]{0,200}Activo/.test(indexHtml), 'sin Activo como estado laboral');

console.log('\n=== Directorio — unit merge ===\n');

const map = mergeTaskSummaryFromGroupByRows([
  { employeeId: 'e1', status: 'PENDING', _count: { _all: 2 } },
  { employeeId: 'e1', status: 'IN_PROGRESS', _count: { _all: 1 } },
  { employeeId: 'e1', status: 'COMPLETED', _count: { _all: 5 } },
  { employeeId: 'e2', status: 'COMPLETED', _count: { _all: 3 } },
]);
check(map.get('e1').pending === 2, 'pending count');
check(map.get('e1').inProgress === 1, 'in progress count');
check(map.get('e1').completed === 5, 'completed histórico');
check(map.get('e2').completed === 3, 'completed por empleado');

console.log('\n=== Directorio — integration (DB) ===\n');

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP integration:', e.message);
}

if (dbOk) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const orgA = await prisma.organization.create({
    data: { name: `Dir A ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const orgB = await prisma.organization.create({
    data: { name: `Dir B ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const adminPass = 'TestAdmin1!';
  const adminA = await prisma.user.create({
    data: {
      email: `dir-admin-${suffix}@example.com`,
      passwordHash: await hashPassword(adminPass),
      fullName: 'Admin Dir',
      role: 'empresa_admin',
      organizationId: orgA.id,
    },
  });
  const empA = await prisma.workforceEmployee.create({
    data: {
      organizationId: orgA.id,
      fullName: 'Colab Dir',
      timezone: 'America/Mexico_City',
      accessTokenHash: crypto.randomBytes(32).toString('hex'),
      tokenVersion: 1,
      isActive: true,
    },
  });
  const empB = await prisma.workforceEmployee.create({
    data: {
      organizationId: orgB.id,
      fullName: 'Otra Org',
      timezone: 'America/Mexico_City',
      accessTokenHash: crypto.randomBytes(32).toString('hex'),
      tokenVersion: 1,
      isActive: true,
    },
  });

  const now = new Date();
  await prisma.workforceTask.createMany({
    data: [
      {
        organizationId: orgA.id,
        employeeId: empA.id,
        title: 'P1',
        status: 'PENDING',
        position: 1000,
        archivedAt: null,
      },
      {
        organizationId: orgA.id,
        employeeId: empA.id,
        title: 'P2 arch',
        status: 'PENDING',
        position: 2000,
        archivedAt: now,
      },
      {
        organizationId: orgA.id,
        employeeId: empA.id,
        title: 'Prog',
        status: 'IN_PROGRESS',
        position: 1000,
        startedAt: now,
        archivedAt: null,
      },
      {
        organizationId: orgA.id,
        employeeId: empA.id,
        title: 'Done live',
        status: 'COMPLETED',
        position: 1000,
        completedAt: now,
        archivedAt: null,
      },
      {
        organizationId: orgA.id,
        employeeId: empA.id,
        title: 'Done arch',
        status: 'COMPLETED',
        position: 2000,
        completedAt: now,
        archivedAt: now,
      },
      {
        organizationId: orgB.id,
        employeeId: empB.id,
        title: 'Foreign',
        status: 'COMPLETED',
        position: 1000,
        completedAt: now,
        archivedAt: null,
      },
    ],
  });

  const agg = await aggregateWorkforceTaskSummariesForOrg(orgA.id);
  const sumA = agg.get(empA.id);
  check(sumA.pending === 1, 'pending excluye archivadas');
  check(sumA.inProgress === 1, 'in progress activas');
  check(sumA.completed === 2, 'completed incluye archivadas');

  const aggB = await aggregateWorkforceTaskSummariesForOrg(orgB.id);
  check(aggB.get(empB.id)?.completed === 1 && !aggB.has(empA.id), 'aislamiento multi-org agregado');

  let listed = await listWorkforceEmployees(orgA.id);
  let row = listed.find((e) => e.id === empA.id);
  check(row?.taskSummary?.pending === 1 && row.taskSummary.completed === 2, 'listWorkforceEmployees taskSummary');
  check(row?.hasOpenShift === false, 'hasOpenShift false sin sesión');

  await prisma.remoteWorkSession.create({
    data: { employeeId: empA.id, checkInAt: now, checkOutAt: null },
  });
  listed = await listWorkforceEmployees(orgA.id);
  row = listed.find((e) => e.id === empA.id);
  check(row?.hasOpenShift === true, 'hasOpenShift true con jornada abierta');

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { email: adminA.email, password: adminPass },
    });
    const cookie = cookieHeaderFromResponse(login.res, 'mind24.sid');
    const listHttp = await jsonFetch(base, '/api/org/timeclock/employees', { cookie });
    check(listHttp.res.status === 200, 'GET employees');
    const httpRow = (listHttp.data.employees || []).find((e) => e.id === empA.id);
    check(httpRow?.taskSummary?.inProgress === 1, 'API expone inProgress');
    check(!listHttp.data.employees?.some((e) => e.id === empB.id), 'API solo org A');
  } finally {
    server.close();
    await prisma.workforceTask.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.remoteWorkSession.deleteMany({ where: { employeeId: empA.id } });
    await prisma.workforceEmployee.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { organizationId: orgA.id } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  }
}

console.log(failed === 0 ? '\n✓ Workforce directory summary tests OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

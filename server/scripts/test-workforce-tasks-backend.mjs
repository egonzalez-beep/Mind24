/**
 * Actividades workforce — modelo + API (1A).
 * Ejecutar: node server/scripts/test-workforce-tasks-backend.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'workforce-tasks-test-secret';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
const orgRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.org.routes.js'), 'utf8');
const publicRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.public.routes.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');
const migrationSql = fs.readFileSync(
  path.join(rootDir, 'prisma/migrations/20261018160000_workforce_tasks/migration.sql'),
  'utf8',
);

const {
  canEmployeeChangeTaskStatus,
  applyWorkforceTaskStatusTimestamps,
  WORKFORCE_TASK_STATUSES,
} = await import('../src/services/workforceTask.service.js');
const { prisma } = await import('../src/db/client.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/services/auth.service.js');
const { hashTimeclockToken } = await import('../src/services/timeclockToken.service.js');

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

console.log('\n=== Workforce tasks 1A — estático ===\n');

check(/model WorkforceTask/.test(schema), 'modelo WorkforceTask');
check(/model WorkforceTaskEvent/.test(schema), 'modelo WorkforceTaskEvent');
check(/WorkforceTaskStatus/.test(schema), 'enum status');
check(/CREATE TABLE "WorkforceTask"/.test(migrationSql), 'migración WorkforceTask');
check(/\/employees\/:id\/tasks/.test(orgRoutes), 'POST/GET admin tasks route');
check(/router\.patch\('\/tasks\/:taskId'/.test(orgRoutes), 'PATCH admin task');
check(/router\.get\('\/tasks'/.test(publicRoutes), 'GET public tasks');
check(/router\.patch\(\s*'\/tasks\/:taskId'/.test(publicRoutes), 'PATCH public task');
check(/tcAdminFetchEmployeeTasks/.test(indexHtml), 'helper admin fetchTasks');
check(/tcPublicFetchTasks/.test(indexHtml), 'helper public fetchTasks');
check(/tcAdminUpdateTaskStatus/.test(indexHtml), 'helper updateTaskStatus');
check(/tcAdminUpdateTaskPosition/.test(indexHtml), 'helper updateTaskPosition');

console.log('\n=== Workforce tasks 1A — unit ===\n');

check(WORKFORCE_TASK_STATUSES.join(',') === 'PENDING,IN_PROGRESS,COMPLETED', 'estados controlados');
check(canEmployeeChangeTaskStatus('PENDING', 'IN_PROGRESS'), 'empleado PENDING→IN_PROGRESS');
check(canEmployeeChangeTaskStatus('IN_PROGRESS', 'COMPLETED'), 'empleado IN_PROGRESS→COMPLETED');
check(!canEmployeeChangeTaskStatus('COMPLETED', 'PENDING'), 'COMPLETED terminal empleado');

const now = new Date('2026-10-18T12:00:00.000Z');
const ts1 = applyWorkforceTaskStatusTimestamps(
  { status: 'PENDING', startedAt: null, completedAt: null },
  'IN_PROGRESS',
  now,
);
check(ts1.startedAt?.getTime() === now.getTime(), 'startedAt al entrar IN_PROGRESS');
const ts2 = applyWorkforceTaskStatusTimestamps(
  { status: 'IN_PROGRESS', startedAt: now, completedAt: null },
  'COMPLETED',
  now,
);
check(ts2.completedAt?.getTime() === now.getTime(), 'completedAt al completar');
const ts3 = applyWorkforceTaskStatusTimestamps(
  { status: 'COMPLETED', startedAt: now, completedAt: now },
  'PENDING',
  now,
);
check(ts3.completedAt === null, 'admin limpia completedAt al reabrir');

console.log('\n=== Workforce tasks 1A — integration (DB) ===\n');

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
    data: { name: `WF A ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const orgB = await prisma.organization.create({
    data: { name: `WF B ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const adminPass = 'TestAdmin1!';
  const adminA = await prisma.user.create({
    data: {
      email: `wf-admin-a-${suffix}@example.com`,
      passwordHash: await hashPassword(adminPass),
      fullName: 'Admin A',
      role: 'empresa_admin',
      organizationId: orgA.id,
    },
  });
  await prisma.user.create({
    data: {
      email: `wf-admin-b-${suffix}@example.com`,
      passwordHash: await hashPassword(adminPass),
      fullName: 'Admin B',
      role: 'empresa_admin',
      organizationId: orgB.id,
    },
  });

  const { token: tokA, hash: hashA } = (await import('../src/services/timeclockToken.service.js')).generateTimeclockAccessToken();
  const empA = await prisma.workforceEmployee.create({
    data: {
      organizationId: orgA.id,
      fullName: 'Colab A',
      timezone: 'America/Mexico_City',
      accessTokenHash: hashA,
      tokenVersion: 1,
      isActive: true,
    },
  });
  const { token: tokB } = (await import('../src/services/timeclockToken.service.js')).generateTimeclockAccessToken();
  const empB = await prisma.workforceEmployee.create({
    data: {
      organizationId: orgB.id,
      fullName: 'Colab B',
      timezone: 'America/Mexico_City',
      accessTokenHash: hashTimeclockToken(tokB),
      tokenVersion: 1,
      isActive: true,
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
    check(loginA.res.status === 200 && adminCookie, 'admin login');

    const createTask = await jsonFetch(base, `/api/org/timeclock/employees/${empA.id}/tasks`, {
      method: 'POST',
      cookie: adminCookie,
      body: { title: 'Informe semanal', description: 'Detalle' },
    });
    check(createTask.res.status === 201, 'crear actividad admin');
    const taskId = createTask.data.task?.id;
    check(taskId && createTask.data.task.status === 'PENDING', 'status inicial PENDING');

    const listAdmin = await jsonFetch(base, `/api/org/timeclock/employees/${empA.id}/tasks`, {
      cookie: adminCookie,
    });
    check(listAdmin.res.status === 200 && listAdmin.data.tasks?.length === 1, 'listar admin');

    const ex = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: tokA },
    });
    const tcCookie = cookieHeaderFromResponse(ex.res, 'mind24.tc.sid');
    check(ex.res.status === 200 && tcCookie, 'sesión colaborador');

    const listEmp = await jsonFetch(base, '/api/timeclock/public/tasks', { cookie: tcCookie });
    check(listEmp.res.status === 200 && listEmp.data.tasks?.length === 1, 'listar empleado activa');

    const toProg = await jsonFetch(base, `/api/timeclock/public/tasks/${taskId}`, {
      method: 'PATCH',
      cookie: tcCookie,
      body: { status: 'IN_PROGRESS' },
    });
    check(toProg.res.status === 200 && toProg.data.task.status === 'IN_PROGRESS', 'PENDING→IN_PROGRESS');
    check(!!toProg.data.task.startedAt, 'startedAt server-side');

    const toDone = await jsonFetch(base, `/api/timeclock/public/tasks/${taskId}`, {
      method: 'PATCH',
      cookie: tcCookie,
      body: { status: 'COMPLETED' },
    });
    check(toDone.res.status === 200 && toDone.data.task.completedAt, 'IN_PROGRESS→COMPLETED');

    const listAfterComplete = await jsonFetch(base, '/api/timeclock/public/tasks', { cookie: tcCookie });
    check(
      listAfterComplete.res.status === 200 && listAfterComplete.data.tasks?.length === 0,
      'completada fuera de bandeja pública',
    );

    const listAdminCompleted = await jsonFetch(
      base,
      `/api/org/timeclock/employees/${empA.id}/tasks?status=COMPLETED`,
      { cookie: adminCookie },
    );
    check(listAdminCompleted.data.tasks?.length === 1, 'admin ve completada');

    const reactivateBlocked = await jsonFetch(base, `/api/timeclock/public/tasks/${taskId}`, {
      method: 'PATCH',
      cookie: tcCookie,
      body: { status: 'PENDING' },
    });
    check(reactivateBlocked.res.status === 400, 'empleado no reactiva COMPLETED');

    const adminReopen = await jsonFetch(base, `/api/org/timeclock/tasks/${taskId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { status: 'PENDING' },
    });
    check(adminReopen.res.status === 200 && adminReopen.data.task.completedAt == null, 'admin corrige estado');

    const movePos = await jsonFetch(base, `/api/org/timeclock/tasks/${taskId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { position: 5000 },
    });
    check(movePos.data.task?.position === 5000, 'position admin');

    const archive = await jsonFetch(base, `/api/org/timeclock/tasks/${taskId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { archive: true },
    });
    check(archive.res.status === 200 && archive.data.task.archivedAt, 'archivedAt set');
    const rowStill = await prisma.workforceTask.findUnique({ where: { id: taskId } });
    check(!!rowStill, 'archivado no borra registro');

    const events = await prisma.workforceTaskEvent.findMany({ where: { taskId } });
    check(events.some((e) => e.type === 'TASK_CREATED'), 'evento TASK_CREATED');
    check(events.some((e) => e.type === 'TASK_STATUS_CHANGED'), 'evento TASK_STATUS_CHANGED');
    check(events.some((e) => e.type === 'TASK_ARCHIVED'), 'evento TASK_ARCHIVED');

    const otherOrgList = await jsonFetch(base, `/api/org/timeclock/employees/${empB.id}/tasks`, {
      cookie: adminCookie,
    });
    check(otherOrgList.res.status === 404, 'aislamiento org admin');

    await prisma.workforceEmployee.update({ where: { id: empA.id }, data: { isActive: false } });
    const disabledPatch = await jsonFetch(base, `/api/timeclock/public/tasks/${taskId}`, {
      method: 'PATCH',
      cookie: tcCookie,
      body: { status: 'IN_PROGRESS' },
    });
    check(disabledPatch.res.status === 401 || disabledPatch.res.status === 403, 'colaborador desactivado bloqueado');
  } finally {
    server.close();
    const taskIds = (
      await prisma.workforceTask.findMany({
        where: { organizationId: { in: [orgA.id, orgB.id] } },
        select: { id: true },
      })
    ).map((t) => t.id);
    if (taskIds.length) {
      await prisma.workforceTaskEvent.deleteMany({ where: { taskId: { in: taskIds } } });
    }
    await prisma.workforceTask.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.workforceEmployee.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  }
}

console.log(failed === 0 ? '\n✓ Workforce tasks backend tests OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * Inbox laboral + feed combinado + notif admin meta reportada.
 * node server/scripts/test-workforce-collaborator-inbox.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(serverDir, '..');
dotenv.config({ path: path.join(serverDir, '.env') });
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'wf-inbox-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(serverDir, 'prisma/schema.prisma'), 'utf8');
const taskSvc = fs.readFileSync(path.join(serverDir, 'src/services/workforceTask.service.js'), 'utf8');
const goalSvc = fs.readFileSync(path.join(serverDir, 'src/services/workforceGoal.service.js'), 'utf8');
const feedSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/workforceCollaboratorNovedadesFeed.service.js'),
  'utf8',
);
const inboxSvc = fs.readFileSync(path.join(serverDir, 'src/services/workforceWorkplaceInbox.service.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

console.log('\n=== Inbox colaborador — estático ===\n');

check(/WorkforceWorkplaceInboxEventType/.test(schema), 'enum inbox');
check(/TASK_ASSIGNED/.test(schema) && /GOAL_ASSIGNED/.test(schema), 'tipos inbox');
check(/emitWorkplaceInboxTaskAssigned/.test(taskSvc), 'hook actividad creada');
check(/emitWorkplaceInboxGoalAssigned/.test(goalSvc), 'hook meta creada');
check(/organizationId_dedupeKey/.test(inboxSvc) && /\.upsert\(/.test(inboxSvc), 'inbox upsert dedupe');
check(!/P2002/.test(inboxSvc), 'inbox sin catch P2002');
check(!/isOrganizationDedupeKeyConflict/.test(inboxSvc), 'inbox sin helper P2002');
check(/listCollaboratorNovedadesFeed/.test(feedSvc), 'feed combinado');
check(/SOURCE_RECRUITMENT.*row\.id/.test(feedSvc) && /SOURCE_WORKPLACE.*row\.id/.test(feedSvc), 'ids compuestos DTO');
check(/markAllCollaboratorNovedadesRead/.test(feedSvc), 'read-all combinado');
check(/authLogout[\s\S]*mind24NotifStopPolling/.test(indexHtml), 'stop polling authLogout');
check(/superadminLogout[\s\S]*mind24NotifStopPolling/.test(indexHtml), 'stop polling superadminLogout');
check(/tcEmpStopWsPolling/.test(indexHtml.match(/function tcEmpStopTimers[\s\S]*?^}/m)?.[0] || ''), 'gate detiene ws poll');

const quickGoAct = indexHtml.match(/function tcEmpQuickGoActivities\(\)\{[\s\S]*?\n\}/)?.[0] || '';
const novedadesOpen = indexHtml.match(/function tcEmpNovedadesOpenItem\([\s\S]*?\n\}/)?.[0] || '';
check(/TASK_ASSIGNED[\s\S]*tcEmpQuickGoActivities/.test(novedadesOpen), 'TASK_ASSIGNED navega a Actividades');
check(/void tcEmpLoadTasksSilent\(true\)/.test(quickGoAct), 'Actividades carga inmediata forzada');
check(!/TC_EMP_WS_POLL_MS|20000/.test(quickGoAct), 'navegación actividades no espera tick 20s');
check(!/location\.reload|window\.reload/.test(quickGoAct), 'navegación actividades sin reload página');
check(!/setInterval/.test(quickGoAct), 'navegación actividades sin nuevo polling');
check(/GOAL_ASSIGNED[\s\S]*tcEmpQuickGoGoals/.test(novedadesOpen), 'GOAL_ASSIGNED sigue yendo a Metas');
check(/tcEmpQuickGoCandidates/.test(novedadesOpen), 'Reclutamiento sigue yendo a Candidatos');
check(!/tcEmpNovedadesMarkRead|novedades.*\/read/i.test(novedadesOpen), 'clic novedad no marca leída individual');
const publicHtml = fs.readFileSync(path.join(serverDir, 'public/index.html'), 'utf8');
check(publicHtml === indexHtml, 'index.html idéntico a server/public/index.html');

function cookieHeaderFromResponse(res, name) {
  const raw = res.headers.getSetCookie?.() || [];
  const list = raw.length ? raw : res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [];
  for (const c of list) {
    const m = c.match(new RegExp(`${name}=([^;]+)`));
    if (m) return `${name}=${m[1]}`;
  }
  return '';
}

async function jsonFetch(base, urlPath, { method = 'GET', body, cookie } = {}) {
  const hdr = {};
  if (cookie) hdr.Cookie = cookie;
  if (body != null) {
    hdr['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(base + urlPath, { method, headers: hdr, body });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { res, data, text };
}

console.log('\n=== Inbox colaborador — integración ===\n');

let dbOk = false;
try {
  const { prisma } = await import('../src/db/client.js');
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP integration:', e.message?.split('\n')[0] || e);
}

async function cleanupOrg(orgId) {
  const { prisma } = await import('../src/db/client.js');
  if (!orgId) return;
  await prisma.orgNotification.deleteMany({ where: { organizationId: orgId } });
  await prisma.workforceWorkplaceInbox.deleteMany({ where: { organizationId: orgId } });
  await prisma.workforceRecruitmentNovedad.deleteMany({ where: { organizationId: orgId } });
  await prisma.workforceGoalPeriod.deleteMany({ where: { organizationId: orgId } });
  await prisma.workforceGoal.deleteMany({ where: { organizationId: orgId } });
  await prisma.workforceTask.deleteMany({ where: { organizationId: orgId } });
  await prisma.workforceEmployee.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

if (dbOk) {
  const { prisma } = await import('../src/db/client.js');
  const { createWorkforceTaskForEmployee } = await import('../src/services/workforceTask.service.js');
  const {
    createWorkforceGoalForEmployee,
    reportWorkforceGoalPeriod,
    ensureWorkforceGoalPeriodsUpToDate,
  } = await import('../src/services/workforceGoal.service.js');
  const { createApp } = await import('../src/app.js');
  const { hashPassword } = await import('../src/services/auth.service.js');
  const { generateTimeclockAccessToken } = await import('../src/services/timeclockToken.service.js');

  const suffix = crypto.randomBytes(4).toString('hex');
  const org = await prisma.organization.create({
    data: { name: `Inbox ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const pass = 'TestAdmin1!';
  const adminUser = await prisma.user.create({
    data: {
      email: `admin-inbox-${suffix}@example.com`,
      passwordHash: await hashPassword(pass),
      role: 'empresa_admin',
      organizationId: org.id,
      fullName: 'Admin Inbox',
    },
  });
  const { token: tcTok, hash: tcHash } = generateTimeclockAccessToken();
  const emp = await prisma.workforceEmployee.create({
    data: {
      organizationId: org.id,
      fullName: 'Colaborador Inbox',
      timezone: 'America/Mexico_City',
      accessTokenHash: tcHash,
      tokenVersion: 1,
      isActive: true,
      expectedWorkMinutes: 480,
    },
  });
  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ex = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: tcTok },
    });
    const tcCookie = cookieHeaderFromResponse(ex.res, 'mind24.tc.sid');

    const task = await createWorkforceTaskForEmployee({
      organizationId: org.id,
      employeeId: emp.id,
      createdByUserId: adminUser.id,
      title: `Act ${suffix}`,
      description: null,
      dueAt: null,
    });
    const inboxTask = await prisma.workforceWorkplaceInbox.count({
      where: { organizationId: org.id, dedupeKey: `task_assigned:${task.id}` },
    });
    check(inboxTask === 1, 'actividad crea 1 inbox');

    await createWorkforceTaskForEmployee({
      organizationId: org.id,
      employeeId: emp.id,
      createdByUserId: adminUser.id,
      title: `Act2 ${suffix}`,
    });
    const inboxDup = await prisma.workforceWorkplaceInbox.count({
      where: { organizationId: org.id, recipientWorkforceEmployeeId: emp.id },
    });
    check(inboxDup === 2, 'segunda actividad suma inbox');

    const goal = await createWorkforceGoalForEmployee({
      organizationId: org.id,
      employeeId: emp.id,
      createdByUserId: adminUser.id,
      title: `Meta ${suffix}`,
      description: null,
      goalType: 'COMPLIANCE',
      periodicity: 'DAILY',
      startDate: '2026-10-01',
      endDate: null,
    });
    const inboxGoal = await prisma.workforceWorkplaceInbox.count({
      where: { dedupeKey: `goal_assigned:${goal.id}` },
    });
    check(inboxGoal === 1, 'meta crea 1 inbox');

    const goalRow = await prisma.workforceGoal.findFirst({
      where: { id: goal.id },
    });
    await ensureWorkforceGoalPeriodsUpToDate(goalRow, emp, new Date('2026-10-15T12:00:00.000Z'));
    const afterEnsure = await prisma.workforceWorkplaceInbox.count({
      where: { organizationId: org.id, eventType: 'GOAL_ASSIGNED' },
    });
    check(afterEnsure === 1, 'ensure periodos no duplica inbox meta');

    const unread = await jsonFetch(base, '/api/timeclock/public/novedades/unread-count', { cookie: tcCookie });
    check(unread.data.unreadCount >= 3, 'unread suma fuentes');

    const list = await jsonFetch(base, '/api/timeclock/public/novedades?limit=30', { cookie: tcCookie });
    check(list.data.novedades?.length >= 3, 'feed combinado listado');
    const sources = new Set((list.data.novedades || []).map((n) => n.source));
    check(sources.has('workplace'), 'feed incluye workplace');

    await jsonFetch(base, '/api/timeclock/public/novedades/read-all', {
      method: 'POST',
      cookie: tcCookie,
      body: {},
    });
    const unreadAfter = await jsonFetch(base, '/api/timeclock/public/novedades/unread-count', {
      cookie: tcCookie,
    });
    check(unreadAfter.data.unreadCount === 0, 'read-all limpia ambas fuentes');

    const period = await prisma.workforceGoalPeriod.findFirst({
      where: { goalId: goal.id },
    });
    await reportWorkforceGoalPeriod({
      employee: emp,
      periodId: period.id,
      binaryResult: 'MET',
      employeeComment: null,
    });
    const orgNotif = await prisma.orgNotification.findFirst({
      where: { organizationId: org.id, type: 'GOAL_PERIOD_REPORTED' },
    });
    check(!!orgNotif && /cumplió/.test(orgNotif.message), 'admin MET mensaje');

    await reportWorkforceGoalPeriod({
      employee: emp,
      periodId: period.id,
      binaryResult: 'NOT_MET',
    });
    const orgNotifCount = await prisma.orgNotification.count({
      where: { organizationId: org.id, type: 'GOAL_PERIOD_REPORTED' },
    });
    check(orgNotifCount === 1, 're-reporte no duplica admin notif');
  } finally {
    server.close();
    await cleanupOrg(org.id);
  }
}

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Workforce collaborator inbox tests OK.\n');

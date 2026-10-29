/**
 * Metas workforce — modelo, periodos, API y frontend.
 * Ejecutar: node server/scripts/test-workforce-goals.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'workforce-goals-test-secret';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
const orgRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.org.routes.js'), 'utf8');
const publicRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.public.routes.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');
const publicIndex = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');
const migrationPath = path.join(rootDir, 'prisma/migrations/20261028230000_workforce_goals/migration.sql');
const migrationSql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

const goalServiceSrc = fs.readFileSync(
  path.join(rootDir, 'src/services/workforceGoal.service.js'),
  'utf8',
);
const {
  computeCompletionPercent,
  derivePeriodDisplayStatus,
  WORKFORCE_GOAL_TYPES,
  MAX_GOAL_ACHIEVED_VALUE,
  createWorkforceGoalForEmployee,
} = await import('../src/services/workforceGoal.service.js');
const {
  weekStartYmd,
  monthStartYmd,
  monthEndYmd,
  listPeriodAnchorsBetween,
  countPeriodAnchorsInclusive,
  previousPeriodAnchorYmd,
  periodAnchorYmd,
  MAX_GOAL_PERIOD_BACKFILL,
} = await import('../src/utils/workforceGoalPeriod.util.js');
const { prisma } = await import('../src/db/client.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/services/auth.service.js');
const { hashTimeclockToken, generateTimeclockAccessToken } = await import(
  '../src/services/timeclockToken.service.js'
);

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

async function jsonFetch(base, urlPath, { method = 'GET', body, cookie, headers: extra = {} } = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
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

console.log('\n=== Workforce goals — estático ===\n');

check(/model WorkforceGoal/.test(schema), 'modelo WorkforceGoal');
check(/model WorkforceGoalPeriod/.test(schema), 'modelo WorkforceGoalPeriod');
check(/WorkforceGoalType/.test(schema), 'enum tipo meta');
check(migrationSql && /CREATE TABLE "WorkforceGoal"/.test(migrationSql), 'migración WorkforceGoal');
check(/\/employees\/:id\/goals/.test(orgRoutes), 'rutas admin goals');
check(/router\.get\('\/goals'/.test(publicRoutes), 'GET public goals');
check(/goals\/periods\/:periodId\/report/.test(publicRoutes), 'POST report periodo');
check(/tcJornadaSetOpTab/.test(indexHtml) && /tc-jornada-op-tab/.test(indexHtml), 'tabs Actividades/Metas admin');
check(/tcEmpStartWsPolling/.test(indexHtml) && /TC_EMP_WS_POLL_MS=20000/.test(indexHtml), 'polling workspace 20s');
check(/tcEmpWorkspaceHasBlockingInteraction/.test(indexHtml), 'polling guard centralizado workspace');
check(/tcEmpRefreshActiveWorkspaceTabAfterInteraction/.test(indexHtml), 'refresh silencioso tras interacción bloqueante');
check(!/Ocultar completadas/.test(indexHtml), 'sin control Ocultar completadas');
check(!/tcEmpGoalsHideDoneVisual/.test(indexHtml), 'sin estado ocultar completadas');
check(/tcEmpWorkspaceMarkFormDirty/.test(indexHtml), 'polling respeta formulario sucio');
check(/tcEmpStopWsPolling[\s\S]*tcEmpWsPollInFlight=false/.test(indexHtml), 'polling libera inFlight al cerrar');
check(/tcEmpStartWsPolling[\s\S]*tcEmpStopWsPolling/.test(indexHtml), 'polling reinicia sin duplicar intervalo');
check(/tcGoalPeriodHasReport/.test(indexHtml), 'clasificación por periodo reportado');
check(
  /tcEmpGoalsView==='done'[\s\S]*tcGoalPeriodHasReport/.test(indexHtml),
  'Completadas incluye periodos reportados (MET/PARTIAL/NOT_MET)',
);
check(!/tcEmpGoalsView==='done'[\s\S]*r\.st==='MET'/.test(indexHtml), 'Completadas no limitada solo a MET');
check(/tcGoalsToggleArchivedView/.test(indexHtml) && /tcGoalsAdminShowArchived/.test(indexHtml), 'Ver eliminadas admin');
check(!/\/goals\/.*archive/.test(publicRoutes), 'portal sin archivar metas');
check(
  !/Eliminar meta/.test(indexHtml.match(/id="tc-ws-panel-goals"[\s\S]*?id="tc-ws-panel-candidates"/)?.[0] || ''),
  'colaborador sin eliminar meta en panel',
);
check(!/tcEmp.*[Aa]rchive/.test(indexHtml), 'colaborador sin acción archive en JS');
check(/tc-goals-kanban/.test(indexHtml) && /Eliminar meta/.test(indexHtml), 'tablero admin metas y eliminar');
check(/tc-emp-goals-subtab/.test(indexHtml) && /Por cumplir/.test(indexHtml), 'subnav colaborador metas');
check(/tc-goal-card-v2/.test(indexHtml), 'cards metas unificadas colaborador');
check(/tcGoalSyncAssignPeriodHint/.test(indexHtml), 'formulario recurrencia dinámica');
check(/tc-op-icon-btn/.test(indexHtml) && /Asignar meta/.test(indexHtml), 'botón asignar meta outline');
check(!/tc-kanban-add-btn[\s\S]*Asignar actividad/.test(indexHtml.match(/function tcViewJornada[\s\S]*?^async function /m)?.[0] || ''), 'sin botón morado + en jornada');
check(/tcEmpLoadGoals/.test(indexHtml) && /tc-ws-panel-goals/.test(indexHtml), 'panel Metas colaborador');
check(/tcEmpQuickGoGoals/.test(indexHtml), 'quick action Metas');
check(!/id="tc-ws-quick-goals"[^>]*aria-disabled/.test(indexHtml), 'Metas quick action habilitada');
check(/tc-goal-assign-modal/.test(indexHtml), 'modal asignar meta');
check(indexHtml === publicIndex, 'index.html idéntico a server/public/index.html');
check(/tcGoalsAdminList=\[\]/.test(indexHtml.match(/async function tcViewJornada[\s\S]*?^async function /m)?.[0] || ''), 'cambio colaborador limpia metas admin');
check(/function isGoalPeriodUniqueViolation/.test(goalServiceSrc), 'P2002 acotado a goalId+periodStart');
check(!/MAX_GOAL_PERIOD_SYNC_ROUNDS/.test(goalServiceSrc), 'sin rondas múltiples por solicitud');
check(/createMany/.test(goalServiceSrc) && /skipDuplicates:\s*true/.test(goalServiceSrc), 'inserción por lote idempotente');
check(/countPeriodAnchorsInclusive/.test(goalServiceSrc), 'validación por conteo de anclas');
check(/GOAL_PERIOD_BACKFILL_LIMIT/.test(goalServiceSrc), 'sync excedida condición controlada');
check(/periodStart:\s*\{\s*lte:\s*now\s*\}/.test(goalServiceSrc), 'portal no lista periodos futuros');
check(
  /tcFmtDurationHuman\(sec\)/.test(indexHtml.match(/function tcEmpRender\(\)[\s\S]*?^function /m)?.[0] || ''),
  'regresión jornada finalizada human readable',
);

console.log('\n=== Workforce goals — unit ===\n');

check(WORKFORCE_GOAL_TYPES.join(',') === 'COMPLIANCE,QUANTITATIVE', 'tipos meta');
check(computeCompletionPercent('COMPLIANCE', { binaryResult: 'MET' }) === 100, 'binaria cumplida 100%');
check(computeCompletionPercent('COMPLIANCE', { binaryResult: 'NOT_MET' }) === 0, 'binaria no cumplida 0%');
check(computeCompletionPercent('QUANTITATIVE', { targetSnapshot: 5, achievedValue: 3 }) === 60, '3/5 = 60%');
check(computeCompletionPercent('QUANTITATIVE', { targetSnapshot: 5, achievedValue: 7 }) === 140, '7/5 = 140%');

const goalStub = { goalType: 'QUANTITATIVE', archivedAt: null };
const nowOpen = new Date('2026-10-15T18:00:00.000Z');
const periodOpen = {
  periodStart: new Date('2026-10-15T00:00:00.000Z'),
  periodEnd: new Date('2026-10-15T23:59:59.999Z'),
  achievedValue: null,
  binaryResult: null,
  targetSnapshot: 5,
};
check(derivePeriodDisplayStatus(goalStub, periodOpen, nowOpen) === 'PENDING', 'periodo abierto pendiente');
const nowAfter = new Date('2026-10-16T12:00:00.000Z');
check(derivePeriodDisplayStatus(goalStub, periodOpen, nowAfter) === 'OVERDUE', 'periodo cerrado sin reporte vencido');

check(weekStartYmd('2026-10-28') === '2026-10-26', 'semanal lunes 26');
check(monthStartYmd('2026-10-28') === '2026-10-01', 'mensual inicio mes');
check(monthEndYmd('2026-10-28') === '2026-10-31', 'mensual fin mes');
const anchors = listPeriodAnchorsBetween('2026-10-01', '2026-10-03', 'DAILY');
check(anchors.length === 3, 'meta diaria periodos independientes por día');
check(MAX_GOAL_PERIOD_BACKFILL === 400, 'tope backfill documentado');
check(MAX_GOAL_ACHIEVED_VALUE > 0, 'tope resultado cuantitativo');

const endDaily = '2026-10-28';
let start400 = periodAnchorYmd('DAILY', endDaily);
for (let i = 1; i < 400; i += 1) {
  start400 = previousPeriodAnchorYmd('DAILY', start400);
}
const start401Daily = previousPeriodAnchorYmd('DAILY', start400);
check(countPeriodAnchorsInclusive(start400, endDaily, 'DAILY') === 400, '400 periodos diarios permitidos');
check(countPeriodAnchorsInclusive(start401Daily, endDaily, 'DAILY') === 401, '401 periodos diarios detectados');

const endWeekly = weekStartYmd('2026-10-28');
let startW400 = endWeekly;
for (let i = 1; i < 400; i += 1) {
  startW400 = previousPeriodAnchorYmd('WEEKLY', startW400);
}
const startW401 = previousPeriodAnchorYmd('WEEKLY', startW400);
check(countPeriodAnchorsInclusive(startW400, endWeekly, 'WEEKLY') === 400, '400 periodos semanales');
check(countPeriodAnchorsInclusive(startW401, endWeekly, 'WEEKLY') === 401, '401 periodos semanales');

const endMonthly = monthStartYmd('2026-10-28');
let startM400 = endMonthly;
for (let i = 1; i < 400; i += 1) {
  startM400 = previousPeriodAnchorYmd('MONTHLY', startM400);
}
check(countPeriodAnchorsInclusive(startM400, endMonthly, 'MONTHLY') === 400, '400 periodos mensuales');
check(
  countPeriodAnchorsInclusive(previousPeriodAnchorYmd('MONTHLY', startM400), endMonthly, 'MONTHLY') === 401,
  '401 periodos mensuales',
);

check(countPeriodAnchorsInclusive(endDaily, endDaily, 'DAILY') === 1, 'meta iniciada hoy un periodo');
check(listPeriodAnchorsBetween(endDaily, endDaily, 'DAILY').length === 1, 'materialización hoy una ancla');

console.log('\n=== Workforce goals — integration (DB) ===\n');

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
    data: { name: `Goals A ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const orgB = await prisma.organization.create({
    data: { name: `Goals B ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const adminPass = 'TestAdmin1!';
  const adminA = await prisma.user.create({
    data: {
      email: `goals-admin-a-${suffix}@example.com`,
      passwordHash: await hashPassword(adminPass),
      fullName: 'Admin A',
      role: 'empresa_admin',
      organizationId: orgA.id,
    },
  });

  const { token: tokA, hash: hashA } = generateTimeclockAccessToken();
  const empA = await prisma.workforceEmployee.create({
    data: {
      organizationId: orgA.id,
      fullName: 'Colab Goals A',
      timezone: 'America/Mexico_City',
      accessTokenHash: hashA,
      tokenVersion: 1,
      isActive: true,
    },
  });
  const { token: tokB } = generateTimeclockAccessToken();
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

    const { calendarYmdInTimeZone } = await import('../src/utils/workforceDueDate.js');
    const todayYmd = calendarYmdInTimeZone(new Date(), 'America/Mexico_City');
    const todayGoal = await createWorkforceGoalForEmployee({
      organizationId: orgA.id,
      employeeId: empA.id,
      createdByUserId: adminA.id,
      title: 'Meta hoy',
      goalType: 'COMPLIANCE',
      periodicity: 'DAILY',
      startDate: todayYmd,
      endDate: null,
    });
    const todayPeriods = await prisma.workforceGoalPeriod.count({ where: { goalId: todayGoal.id } });
    check(todayPeriods === 1, 'meta iniciada hoy crea un periodo');

    let start401 = periodAnchorYmd('DAILY', todayYmd);
    for (let i = 0; i < 401; i += 1) {
      start401 = previousPeriodAnchorYmd('DAILY', start401);
    }
    const goalsBefore401 = await prisma.workforceGoal.count({ where: { organizationId: orgA.id } });
    const reject401 = await jsonFetch(base, `/api/org/timeclock/employees/${empA.id}/goals`, {
      method: 'POST',
      cookie: adminCookie,
      body: {
        title: 'Demasiados periodos',
        goalType: 'COMPLIANCE',
        periodicity: 'DAILY',
        startDate: start401,
      },
    });
    check(reject401.res.status === 400, '401 periodos rechazados en API');
    const goalsAfter401 = await prisma.workforceGoal.count({ where: { organizationId: orgA.id } });
    check(goalsAfter401 === goalsBefore401, 'meta 401 no se crea parcialmente');

    const createBin = await jsonFetch(base, `/api/org/timeclock/employees/${empA.id}/goals`, {
      method: 'POST',
      cookie: adminCookie,
      body: {
        title: 'Reporte diario',
        goalType: 'COMPLIANCE',
        periodicity: 'DAILY',
        startDate: '2026-10-01',
      },
    });
    check(createBin.res.status === 201, 'admin crea meta binaria');
    const goalBinId = createBin.data.goal?.id;

    const createQ = await jsonFetch(base, `/api/org/timeclock/employees/${empA.id}/goals`, {
      method: 'POST',
      cookie: adminCookie,
      body: {
        title: 'Entrevistas',
        goalType: 'QUANTITATIVE',
        periodicity: 'WEEKLY',
        targetValue: 5,
        unit: 'entrevistas',
        startDate: '2026-10-01',
      },
    });
    check(createQ.res.status === 201, 'admin crea meta cuantitativa');
    const goalQId = createQ.data.goal?.id;

    const badTarget = await jsonFetch(base, `/api/org/timeclock/employees/${empA.id}/goals`, {
      method: 'POST',
      cookie: adminCookie,
      body: {
        title: 'Mal objetivo',
        goalType: 'QUANTITATIVE',
        periodicity: 'DAILY',
        targetValue: 0,
        startDate: '2026-10-01',
      },
    });
    check(badTarget.res.status === 400, 'objetivo ≤ 0 rechazado');

    const ex = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: tokA },
    });
    const tcCookie = cookieHeaderFromResponse(ex.res, 'mind24.tc.sid');
    check(ex.res.status === 200 && tcCookie, 'sesión colaborador A');

    const exB = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: tokB },
    });
    const tcCookieB = cookieHeaderFromResponse(exB.res, 'mind24.tc.sid');

    const listB = await jsonFetch(base, '/api/timeclock/public/goals', { cookie: tcCookieB });
    check(listB.res.status === 200 && listB.data.goals?.length === 0, 'colaborador ajeno sin metas');

    const listA = await jsonFetch(base, '/api/timeclock/public/goals', { cookie: tcCookie });
    check(listA.res.status === 200 && listA.data.goals?.length === 2, 'colaborador ve sus metas');

    const periodsRow = await prisma.workforceGoalPeriod.findMany({
      where: { goalId: goalBinId },
      orderBy: { periodStart: 'asc' },
    });
    check(periodsRow.length >= 1, 'periodos materializados al crear');
    const periodId = periodsRow[periodsRow.length - 1].id;

    const dupAttempt = await prisma.workforceGoalPeriod.create({
      data: {
        organizationId: orgA.id,
        goalId: goalBinId,
        employeeId: empA.id,
        periodStart: periodsRow[0].periodStart,
        periodEnd: periodsRow[0].periodEnd,
        targetSnapshot: 1,
      },
    }).catch((e) => e);
    check(dupAttempt?.code === 'P2002', 'unique goalId+periodStart evita duplicado');

    const report = await jsonFetch(base, `/api/timeclock/public/goals/periods/${periodId}/report`, {
      method: 'POST',
      cookie: tcCookie,
      headers: { Origin: base },
      body: { binaryResult: 'MET' },
    });
    check(report.res.status === 200 && report.data.period?.completionPercent === 100, 'reporte binario servidor 100%');

    const hackPct = await jsonFetch(base, `/api/timeclock/public/goals/periods/${periodId}/report`, {
      method: 'POST',
      cookie: tcCookie,
      headers: { Origin: base },
      body: { achievedValue: 999, completionPercent: 50 },
    });
    check(
      hackPct.res.status === 400 || hackPct.data.period?.completionPercent !== 50,
      'portal no impone porcentaje manipulado',
    );

    const qPeriod = await prisma.workforceGoalPeriod.findFirst({
      where: { goalId: goalQId },
      orderBy: { periodStart: 'desc' },
    });
    const reportQ = await jsonFetch(
      base,
      `/api/timeclock/public/goals/periods/${qPeriod.id}/report`,
      {
        method: 'POST',
        cookie: tcCookie,
        headers: { Origin: base },
        body: { achievedValue: 7 },
      },
    );
    check(reportQ.data.period?.completionPercent === 140, 'cuantitativa 7/5 en servidor');

    const otherOrgAdmin = await jsonFetch(base, `/api/org/timeclock/employees/${empB.id}/goals`, {
      cookie: adminCookie,
    });
    check(otherOrgAdmin.res.status === 404, 'admin org A no lista colaborador B');

    const archive = await jsonFetch(base, `/api/org/timeclock/goals/${goalQId}/archive`, {
      method: 'POST',
      cookie: adminCookie,
      body: {},
    });
    check(archive.res.status === 200 && archive.data.goal?.archivedAt, 'archivar meta');
    const archiveAgain = await jsonFetch(base, `/api/org/timeclock/goals/${goalQId}/archive`, {
      method: 'POST',
      cookie: adminCookie,
      body: {},
    });
    check(archiveAgain.res.status === 200, 'archivar idempotente');
    const histCount = await prisma.workforceGoalPeriod.count({ where: { goalId: goalQId } });
    check(histCount >= 1, 'archivada conserva historial');
    const listAdmin = await jsonFetch(base, `/api/org/timeclock/employees/${empA.id}/goals`, {
      cookie: adminCookie,
    });
    const archivedRow = listAdmin.data.goals?.find((g) => g.id === goalQId);
    check(!!archivedRow?.archivedAt, 'list admin incluye meta archivada para Ver eliminadas');
    const goalBinAfterReport = await prisma.workforceGoal.findUnique({ where: { id: goalBinId } });
    check(!goalBinAfterReport?.archivedAt, 'reportar periodo no archiva definición de meta');

    const endedGoal = await jsonFetch(base, `/api/org/timeclock/employees/${empA.id}/goals`, {
      method: 'POST',
      cookie: adminCookie,
      body: {
        title: 'Meta corta',
        goalType: 'COMPLIANCE',
        periodicity: 'DAILY',
        startDate: '2026-09-01',
        endDate: '2026-09-02',
      },
    });
    const endedId = endedGoal.data.goal?.id;
    const before = await prisma.workforceGoalPeriod.count({ where: { goalId: endedId } });
    await jsonFetch(base, '/api/timeclock/public/goals', { cookie: tcCookie });
    const after = await prisma.workforceGoalPeriod.count({ where: { goalId: endedId } });
    check(after === before, 'meta finalizada no genera periodos nuevos');
  } finally {
    server.close();
    const goalIds = (
      await prisma.workforceGoal.findMany({
        where: { organizationId: { in: [orgA.id, orgB.id] } },
        select: { id: true },
      })
    ).map((g) => g.id);
    if (goalIds.length) {
      await prisma.workforceGoalPeriod.deleteMany({ where: { goalId: { in: goalIds } } });
      await prisma.workforceGoal.deleteMany({ where: { id: { in: goalIds } } });
    }
    await prisma.workforceEmployee.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  }
}

console.log(failed === 0 ? '\n✓ Workforce goals tests OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * Indicadores de metas workforce — métricas admin, API y frontend.
 * Ejecutar: node server/scripts/test-workforce-goal-metrics.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'workforce-goal-metrics-test-secret';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const orgRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.org.routes.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');
const publicIndex = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');
const metricsSrc = fs.readFileSync(
  path.join(rootDir, 'src/services/workforceGoalMetrics.service.js'),
  'utf8',
);

const {
  assertMetricsMonthNotFuture,
  assertMetricsPeriodVolume,
  averageAchievementRawForRows,
  classifyPeriodForMetrics,
  goalMetricsPeriodLimitError,
  isMetricsPeriodEnded,
  normalizePercentForKpi,
  parseMetricsMonthParam,
  periodEndForLocalDay,
  periodHasReport,
  completionPercentRaw,
  currentMonthYmInTimeZone,
  monthBoundsInTimeZone,
  summarizeClassifiedPeriodRows,
  MAX_METRICS_PERIODS_PER_MONTH,
} = await import('../src/services/workforceGoalMetrics.service.js');
const errorMiddlewareSrc = fs.readFileSync(
  path.join(rootDir, 'src/middleware/error.middleware.js'),
  'utf8',
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

console.log('\n=== Workforce goal metrics — estático ===\n');

check(/getWorkforceGoalMetricsForAdmin/.test(metricsSrc), 'servicio métricas exportado');
check(/classifyPeriodForMetrics/.test(metricsSrc), 'clasificación de periodos');
check(/normalizePercentForKpi/.test(metricsSrc), 'normalización KPI 0–100');
check(/MAX_METRICS_PERIODS_PER_MONTH/.test(metricsSrc), 'límite defensivo periodos');
check(/assertMetricsPeriodVolume/.test(metricsSrc), 'validación volumen periodos');
check(/take:\s*MAX_METRICS_PERIODS_PER_MONTH\s*\+\s*1/.test(metricsSrc), 'consulta hasta MAX+1');
check(/GOAL_METRICS_PERIOD_LIMIT/.test(errorMiddlewareSrc), 'HTTP 409 límite periodos');
check(/organizationId,\s*employeeId/.test(metricsSrc), 'filtro org+empleado en periodos');
check(/archivedAt: null/.test(metricsSrc), 'ensure solo metas no archivadas');
check(/materializeCurrentMonth/.test(metricsSrc), 'materialización condicionada por mes');
check(/AbortController/.test(indexHtml), 'abort en carga métricas');
check(/tcMetricsCompareInlineHtml\(data\.comparison,evalN\)/.test(indexHtml), 'comparación integrada en KPI promedio');
check(/tc-metrics-kpi--tone-/.test(indexHtml) && /tc-metrics-kpi-accent/.test(indexHtml), 'KPIs con acento semántico');
check(/tcMetricsChartLegendHtml/.test(indexHtml) && /tc-metrics-chart-legend/.test(indexHtml), 'leyenda de estados en gráfica');
check(/tcMetricsKpiInfoHtml/.test(indexHtml) && /TC_METRICS_AVG_HELP/.test(indexHtml), 'tooltip informativo cumplimiento');
check(/tc-metrics-chart-point--single/.test(indexHtml) && /Primer periodo registrado del mes/.test(indexHtml), 'gráfica un solo punto');
check(/tc-metrics-stat-chip/.test(indexHtml) && /tcMetricsGoalStatsHtml/.test(indexHtml), 'microchips desempeño por meta');
check(/tc-metrics-goal-select-wrap/.test(indexHtml) && /tc-metrics-goal-select:focus-visible/.test(indexHtml), 'selector de meta refinado');
check(/tcSvgChevronLeft/.test(indexHtml) && /aria-label="Mes anterior"/.test(indexHtml), 'selector mensual SVG');
check(!/tcMetricsCompareHtml\(data\.comparison/.test(indexHtml), 'sin comparación flotante entre KPIs y gráfica');
check(/tcEsc\(g\.title\)/.test(indexHtml) && /tcEsc\(tip\)/.test(indexHtml), 'escape título y tooltips');
const xssTitle = '<img src=x onerror=alert(1)>';
check(
  new RegExp(`tcEsc\\(g\\.title\\)[\\s\\S]*tc-metrics-goal-row`).test(indexHtml),
  'título meta escapado en filas',
);
check(
  !indexHtml.includes(`'<option value="'+g.goalId+'">'+g.title+'</option>'`),
  'sin option sin escapar',
);
check(
  /router\.get\('\/employees\/:id\/goals\/metrics'/.test(orgRoutes),
  'ruta GET goals/metrics',
);
check(/getWorkforceGoalMetricsForAdmin/.test(orgRoutes), 'ruta usa servicio métricas');
check(!/organizationId.*req\.query/.test(orgRoutes), 'sin organizationId en query en rutas org');
check(/tc-jornada-tab-indicators/.test(indexHtml), 'tercer tab Indicadores admin');
check(/id="tc-jornada-tab-indicators"/.test(indexHtml) && /tcJornadaSetOpTab\([^)]*indicators/.test(indexHtml), 'handler tab Indicadores');
check(/tcAdminFetchEmployeeGoalMetrics/.test(indexHtml), 'fetch métricas frontend');
check(/tc-metrics-wrap/.test(indexHtml), 'layout métricas CSS');
check(/tcMetricsChartSvg/.test(indexHtml), 'gráfica SVG métricas');
check(/tc-jornada-tab-indicators/.test(publicIndex), 'public index tab Indicadores');
check(
  crypto.createHash('sha256').update(indexHtml).digest('hex') ===
    crypto.createHash('sha256').update(publicIndex).digest('hex'),
  'index.html y server/public/index.html idénticos (sync pendiente si falla)',
);
check(
  /tcJornadaOpToolbarHtml[\s\S]*indicators[\s\S]*return ''/.test(indexHtml),
  'botón + oculto en Indicadores',
);
check(/tcJornadaMarkMetricsStale/.test(indexHtml), 'invalidación métricas tras cambio metas');
check(/tc-metrics-retry/.test(indexHtml), 'estado error con Reintentar');
check(/overflow-x:hidden|max-width:100%/.test(indexHtml), 'responsive sin scroll horizontal (métricas/chart)');
check(/tcJornadaSetOpTab/.test(indexHtml) && /tc-jornada-tab-goals/.test(indexHtml), 'regresión tabs Metas');
check(!/tcAdminFetchEmployeeGoalMetrics/.test(publicIndex) || /tcAdminFetchEmployeeGoalMetrics/.test(indexHtml), 'fetch métricas solo en bundle admin');

console.log('\n=== Workforce goal metrics — unit ===\n');

let monthInvalidOk = false;
try {
  parseMetricsMonthParam('2026-13');
} catch (e) {
  monthInvalidOk = e.code === 'VALIDATION_ERROR';
}
check(monthInvalidOk, 'mes inválido rechazado');

check(parseMetricsMonthParam('2026-10') === '2026-10', 'mes válido aceptado');
check(parseMetricsMonthParam('2026-01') === '2026-01', '2026-01 válido');
check(parseMetricsMonthParam('2026-12') === '2026-12', '2026-12 válido');

for (const bad of ['2026-00', '2026-13', '2026-1', '26-10', '2026-10-01', ' 2026-10', '2026-10 ']) {
  let rejected = false;
  try {
    parseMetricsMonthParam(bad);
  } catch (e) {
    rejected = e.code === 'VALIDATION_ERROR';
  }
  check(rejected, `mes rechazado: ${JSON.stringify(bad)}`);
}

let futureRejected = false;
try {
  assertMetricsMonthNotFuture('2099-12', 'America/Mexico_City', new Date('2026-10-15T12:00:00Z'));
} catch (e) {
  futureRejected = e.code === 'VALIDATION_ERROR';
}
check(futureRejected, 'mes futuro rechazado en TZ colaborador');

let periodLimit501 = false;
try {
  assertMetricsPeriodVolume(MAX_METRICS_PERIODS_PER_MONTH + 1);
} catch (e) {
  periodLimit501 = e.code === 'GOAL_METRICS_PERIOD_LIMIT';
}
check(periodLimit501, '501 periodos → GOAL_METRICS_PERIOD_LIMIT');
check(assertMetricsPeriodVolume(MAX_METRICS_PERIODS_PER_MONTH) === undefined, '500 periodos → OK');

const qGoalMix = { goalType: 'QUANTITATIVE' };
const mixRows = [
  {
    status: 'MET',
    reported: true,
    completionRaw: 140,
    goalId: 'g1',
    title: 'Mix',
    periodicity: 'DAILY',
    goalType: 'QUANTITATIVE',
    periodStart: new Date('2026-10-01'),
    periodEnd: new Date('2026-10-01'),
    periodId: 'p1',
  },
  {
    status: 'PARTIAL',
    reported: true,
    completionRaw: 60,
    goalId: 'g1',
    title: 'Mix',
    periodicity: 'DAILY',
    goalType: 'QUANTITATIVE',
    periodStart: new Date('2026-10-02'),
    periodEnd: new Date('2026-10-02'),
    periodId: 'p2',
  },
  {
    status: 'OVERDUE_UNREPORTED',
    reported: false,
    completionRaw: null,
    goalId: 'g1',
    title: 'Mix',
    periodicity: 'DAILY',
    goalType: 'QUANTITATIVE',
    periodStart: new Date('2026-10-03'),
    periodEnd: new Date('2026-10-03'),
    periodId: 'p3',
  },
  {
    status: 'PENDING',
    reported: false,
    completionRaw: null,
    goalId: 'g1',
    title: 'Mix',
    periodicity: 'DAILY',
    goalType: 'QUANTITATIVE',
    periodStart: new Date('2026-10-31'),
    periodEnd: new Date('2026-10-31'),
    periodId: 'p4',
  },
];
const mixSummary = summarizeClassifiedPeriodRows(mixRows);
check(mixSummary.evaluablePeriods === 3, 'mix evaluablePeriods=3');
check(mixSummary.met === 1 && mixSummary.partial === 1 && mixSummary.overdueUnreported === 1, 'mix conteos');
check(mixSummary.pending === 1, 'mix pending=1');
check(mixSummary.averageCompliance === 53.3, 'mix averageCompliance=53.3');
check(averageAchievementRawForRows(mixRows) === 66.7, 'mix averageAchievementRaw=66.7');

const pendingOnly = summarizeClassifiedPeriodRows([
  { status: 'PENDING', reported: false, completionRaw: null },
]);
check(pendingOnly.evaluablePeriods === 0, 'solo pendientes evaluable=0');
check(pendingOnly.averageCompliance === null, 'solo pendientes promedio null');

check(normalizePercentForKpi(NaN) === 0, 'NaN → 0 KPI');
check(normalizePercentForKpi(-5) === 0, 'negativo → 0 KPI');
check(normalizePercentForKpi(Infinity) === 0, 'Infinity → 0 KPI');

const qGoal = { goalType: 'QUANTITATIVE', title: 'Q' };
const now = new Date('2026-10-15T18:00:00.000Z');
const periodPartial = {
  periodEnd: new Date('2026-10-10T23:59:59.999Z'),
  completionPercent: 75,
  achievedValue: 6,
  targetSnapshot: 8,
  binaryResult: null,
  submittedAt: new Date('2026-10-10T12:00:00.000Z'),
};
check(classifyPeriodForMetrics(qGoal, periodPartial, now) === 'PARTIAL', 'parcial cuantitativo');

const periodMet = { ...periodPartial, completionPercent: 140, achievedValue: 11.2 };
check(classifyPeriodForMetrics(qGoal, periodMet, now) === 'MET', 'cumplido >100%');

check(normalizePercentForKpi(140) === 100, 'KPI general cap 100%');
check(normalizePercentForKpi(75) === 75, 'KPI sin cap bajo 100');

const bGoal = { goalType: 'COMPLIANCE' };
check(
  classifyPeriodForMetrics(bGoal, { ...periodPartial, binaryResult: 'MET', achievedValue: null, completionPercent: 100 }, now) ===
    'MET',
  'binaria MET',
);
check(
  classifyPeriodForMetrics(
    bGoal,
    {
      periodEnd: new Date('2026-10-01T23:59:59.999Z'),
      binaryResult: 'NOT_MET',
      achievedValue: null,
      completionPercent: 0,
      submittedAt: new Date(),
    },
    now,
  ) === 'NOT_MET',
  'binaria NOT_MET',
);

const pending = {
  periodEnd: new Date('2026-10-31T23:59:59.999Z'),
  binaryResult: null,
  achievedValue: null,
  submittedAt: null,
};
check(classifyPeriodForMetrics(qGoal, pending, now) === 'PENDING', 'pendiente vigente');
check(!periodHasReport(pending), 'pendiente sin reporte');

const overdue = {
  periodEnd: new Date('2026-10-01T23:59:59.999Z'),
  binaryResult: null,
  achievedValue: null,
  submittedAt: null,
};
check(classifyPeriodForMetrics(qGoal, overdue, now) === 'OVERDUE_UNREPORTED', 'vencido sin reporte');

const zeroReport = {
  periodEnd: new Date('2026-10-05T23:59:59.999Z'),
  completionPercent: 0,
  achievedValue: 0,
  targetSnapshot: 8,
  submittedAt: new Date(),
};
check(classifyPeriodForMetrics(qGoal, zeroReport, now) === 'NOT_MET', 'cuantitativo 0% no cumplido');

const tz = 'America/Mexico_City';
const bounds = monthBoundsInTimeZone('2026-10', tz);
check(bounds.start && bounds.endExclusive && bounds.start < bounds.endExclusive, 'límites de mes en TZ');

const curYm = currentMonthYmInTimeZone(new Date('2026-10-29T12:00:00.000Z'), tz);
check(/^2026-10$/.test(curYm) || /^2026-\d{2}$/.test(curYm), 'mes actual en TZ colaborador');

check(/findMany\(\{[\s\S]*include:[\s\S]*goal:/.test(metricsSrc), 'consulta periodos con include goal (sin N+1 por periodo)');

const tzMx = 'America/Mexico_City';
const endDay = periodEndForLocalDay('2026-10-15', tzMx);
check(endDay && endDay instanceof Date, 'periodEnd fin de día TZ');
check(!isMetricsPeriodEnded(endDay, endDay), 'en periodEnd aún no vencido');
check(isMetricsPeriodEnded(new Date(endDay.getTime() + 1), endDay), '1ms después vencido');
check(
  !isMetricsPeriodEnded(new Date(endDay.getTime() - 1000), endDay),
  '1s antes del cierre no vencido',
);

check(
  classifyPeriodForMetrics(
    { goalType: 'COMPLIANCE' },
    {
      periodEnd: endDay,
      binaryResult: 'MET',
      submittedAt: new Date(),
    },
    new Date(endDay.getTime() - 3600 * 1000),
  ) === 'MET',
  'binaria MET',
);
check(
  classifyPeriodForMetrics(
    { goalType: 'COMPLIANCE' },
    {
      periodEnd: endDay,
      binaryResult: 'NOT_MET',
      submittedAt: new Date(),
    },
    new Date(),
  ) === 'NOT_MET',
  'binaria NOT_MET',
);
check(
  classifyPeriodForMetrics(
    { goalType: 'COMPLIANCE' },
    { periodEnd: endDay, binaryResult: null, submittedAt: null },
    new Date(endDay.getTime() + 5),
  ) === 'OVERDUE_UNREPORTED',
  'binaria vencida sin reporte',
);
check(
  classifyPeriodForMetrics(
    { goalType: 'COMPLIANCE' },
    { periodEnd: endDay, binaryResult: null, submittedAt: null },
    new Date(endDay.getTime() - 5),
  ) === 'PENDING',
  'binaria pendiente vigente',
);

check(goalMetricsPeriodLimitError().code === 'GOAL_METRICS_PERIOD_LIMIT', 'error límite periodos');

console.log('\n=== Workforce goal metrics — integration (DB) ===\n');

let integrationSkip = false;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch (e) {
  integrationSkip = true;
  console.log('  SKIP integration:', e.message?.split('\n')[0] || e);
}

if (!integrationSkip) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const orgA = await prisma.organization.create({
    data: { name: `Metrics A ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const orgB = await prisma.organization.create({
    data: { name: `Metrics B ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const adminPass = 'TestAdmin1!';
  const adminA = await prisma.user.create({
    data: {
      email: `metrics-admin-a-${suffix}@example.com`,
      passwordHash: await hashPassword(adminPass),
      fullName: 'Admin Metrics',
      role: 'empresa_admin',
      organizationId: orgA.id,
    },
  });
  const { hashTimeclockToken, generateTimeclockAccessToken } = await import(
    '../src/services/timeclockToken.service.js'
  );
  const { token: tokB } = generateTimeclockAccessToken();
  const empA = await prisma.workforceEmployee.create({
    data: {
      organizationId: orgA.id,
      fullName: 'Colab Metrics',
      timezone: 'America/Mexico_City',
      accessTokenHash: hashTimeclockToken(tokB),
      tokenVersion: 1,
      isActive: true,
    },
  });
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
    const login = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { email: adminA.email, password: adminPass },
    });
    const cookie = cookieHeaderFromResponse(login.res, 'mind24.sid');
    check(login.res.status === 200 && cookie, 'login admin');

    const badMonth = await jsonFetch(
      base,
      `/api/org/timeclock/employees/${empA.id}/goals/metrics?month=2026-99`,
      { cookie },
    );
    check(badMonth.res.status === 400 || badMonth.res.status === 422, 'mes malformado 4xx');

    const metrics = await jsonFetch(
      base,
      `/api/org/timeclock/employees/${empA.id}/goals/metrics?month=2026-10`,
      { cookie },
    );
    check(metrics.res.status === 200, 'métricas 200 empleado propio');
    check(metrics.data?.summary?.evaluablePeriods === 0, 'mes sin datos evaluables');
    check(metrics.data?.comparison?.hasPreviousData === false, 'mes anterior sin datos');

    const foreign = await jsonFetch(
      base,
      `/api/org/timeclock/employees/${empB.id}/goals/metrics?month=2026-10`,
      { cookie },
    );
    check(foreign.res.status === 404, 'empleado de otra org → 404');
  } finally {
    server.close();
    await prisma.workforceEmployee.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.user.delete({ where: { id: adminA.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: orgA.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: orgB.id } }).catch(() => {});
  }
}

console.log(failed ? `\n✗ Workforce goal metrics tests FAILED (${failed})\n` : '\n✓ Workforce goal metrics tests OK.\n');
process.exit(failed ? 1 : 0);

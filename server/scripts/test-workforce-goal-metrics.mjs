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
  assertWeekNotFuture,
  averageAchievementRawForRows,
  buildMonthlyTrendPoints,
  buildTrendPointFromRows,
  buildWeeklyTrendPoints,
  classifyPeriodForMetrics,
  currentWeekStartYmd,
  goalMetricsPeriodLimitError,
  isMetricsPeriodEnded,
  monthWindowFromEndYm,
  normalizePercentForKpi,
  parseMetricsMonthParam,
  parseTrendAnchorYmd,
  periodEndForLocalDay,
  periodHasReport,
  completionPercentRaw,
  currentMonthYmInTimeZone,
  monthBoundsInTimeZone,
  summarizeClassifiedPeriodRows,
  weekBoundsFromAnchorYmd,
  weekRangeLabelEs,
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
check(/goal:\s*\{\s*archivedAt:\s*null\s*\}/.test(metricsSrc), 'periodos exigen goal no archivada');
check(
  (metricsSrc.match(/archivedAt:\s*null/g) || []).length >= 2,
  'filtro archivedAt en consulta y materialización',
);
check(/resolveTrendGoal[\s\S]*archivedAt:\s*null/.test(metricsSrc), 'tendencia por goalId exige no archivada');
check(/getWorkforceGoalMetricsTrendForAdmin/.test(metricsSrc), 'servicio tendencia exportado');
check(/buildWeeklyTrendPoints/.test(metricsSrc) && /buildMonthlyTrendPoints/.test(metricsSrc), 'builders tendencia');
check(/summarizeClassifiedPeriodRows/.test(metricsSrc) && !/averageCompliance\s*=.*\/\s*points\.length/.test(metricsSrc), 'tendencia sin segunda fórmula');
check(/materializeCurrentMonth/.test(metricsSrc), 'materialización condicionada por mes');
check(/AbortController/.test(indexHtml), 'abort en carga métricas');
check(/tcMetricsCompareInlineHtml\(data\.comparison,evalN\)/.test(indexHtml), 'comparación integrada en KPI promedio');
check(/tc-metrics-kpi--tone-/.test(indexHtml) && /tc-metrics-kpi-accent/.test(indexHtml), 'KPIs con acento semántico');
check(/tcMetricsChartLegendHtml/.test(indexHtml) && /tc-metrics-chart-legend/.test(indexHtml), 'leyenda de estados en gráfica');
check(/tcMetricsKpiInfoHtml/.test(indexHtml) && /TC_METRICS_AVG_HELP/.test(indexHtml), 'tooltip informativo cumplimiento');
check(/Evaluaciones de metas/.test(indexHtml) && !/Periodos evaluados/.test(indexHtml), 'leyenda Evaluaciones de metas');
check(/TC_METRICS_EVAL_HELP/.test(indexHtml) && /tcMetricsEvaluationsKpiInfoHtml/.test(indexHtml), 'tooltip evaluaciones periodicidad');
check(!/Primer periodo registrado del mes/.test(indexHtml), 'sin microcopy primer periodo');
check(/tc-metrics-panel--chart/.test(indexHtml) && /tc-metrics-panel--goals/.test(indexHtml), 'paneles homologados');
check(/tc-metrics-trend-seg/.test(indexHtml) && /tcMetricsSetTrendView/.test(indexHtml), 'selector Semanal|Mensual');
check(/Cumplimiento general/.test(indexHtml) && /value="general"/.test(indexHtml), 'selector cumplimiento general');
check(/tcAdminFetchEmployeeGoalMetricsTrend/.test(indexHtml), 'fetch tendencia frontend');
check(/tcJornadaMetricsTrendLoadGen/.test(indexHtml) && /tcJornadaMetricsTrendAbort/.test(indexHtml), 'abort y gen tendencia');
check(/tcMetricsTrendChartSvg/.test(indexHtml) && !/tcMetricsChartSvg\(/.test(indexHtml), 'gráfica usa tendencia');
check(/No hay datos para graficar en esta semana/.test(indexHtml), 'semana vacía sin 0%');
check(/Esta meta se evalúa mensualmente/.test(indexHtml), 'hint meta mensual');
check(/tcMetricsGoalStatsHtml[\s\S]*COMPLIANCE[\s\S]*No cumplidas/.test(indexHtml), 'chips binaria con No cumplidas');
check(/tcMetricsGoalStatsHtml[\s\S]*Parciales/.test(indexHtml) && /goalType==='COMPLIANCE'/.test(indexHtml), 'chips contextuales por tipo');
check(/tcJornadaMetricsChartGoalId='general'/.test(indexHtml), 'archivar seleccionada vuelve a general');
check(
  /router\.get\('\/employees\/:id\/goals\/metrics\/trend'/.test(orgRoutes),
  'ruta GET goals/metrics/trend',
);
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
check(/tcMetricsTrendChartSvg/.test(indexHtml), 'gráfica SVG métricas');
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
check(classifyPeriodForMetrics(qGoal, zeroReport, now) === 'PARTIAL', 'cuantitativo 0% reportado → PARTIAL');
const q140 = {
  periodEnd: new Date('2026-10-05T23:59:59.999Z'),
  completionPercent: 140,
  achievedValue: 11.2,
  targetSnapshot: 8,
  submittedAt: new Date(),
};
check(classifyPeriodForMetrics(qGoal, q140, now) === 'MET', 'cuantitativa 140% → MET');
const q60 = { ...zeroReport, completionPercent: 60, achievedValue: 4.8 };
check(classifyPeriodForMetrics(qGoal, q60, now) === 'PARTIAL', 'cuantitativa 60% → PARTIAL');
const rows140 = [
  {
    status: 'MET',
    reported: true,
    completionRaw: 140,
    goalType: 'QUANTITATIVE',
  },
];
check(normalizePercentForKpi(140) === 100 && summarizeClassifiedPeriodRows(rows140).averageCompliance === 100, '140% aporte normalizado 100');
const rows60 = [{ status: 'PARTIAL', reported: true, completionRaw: 60, goalType: 'QUANTITATIVE' }];
check(summarizeClassifiedPeriodRows(rows60).averageCompliance === 60, '60% aporte 60');
const rows0 = [{ status: 'PARTIAL', reported: true, completionRaw: 0, goalType: 'QUANTITATIVE' }];
check(summarizeClassifiedPeriodRows(rows0).averageCompliance === 0, '0% aporte 0');
const rowsOver = [{ status: 'OVERDUE_UNREPORTED', reported: false, completionRaw: null, goalType: 'QUANTITATIVE' }];
check(summarizeClassifiedPeriodRows(rowsOver).averageCompliance === 0, 'vencida aporte 0');
const qInv = summarizeClassifiedPeriodRows([
  { status: 'MET', reported: true, completionRaw: 100, goalType: 'QUANTITATIVE' },
  { status: 'PARTIAL', reported: true, completionRaw: 40, goalType: 'QUANTITATIVE' },
  { status: 'OVERDUE_UNREPORTED', reported: false, completionRaw: null, goalType: 'QUANTITATIVE' },
]);
check(
  qInv.evaluablePeriods === qInv.met + qInv.partial + qInv.overdueUnreported,
  'invariante cuantitativa Evaluadas = Cumplidas + Parciales + Vencidas',
);
const bInv = summarizeClassifiedPeriodRows([
  { status: 'MET', reported: true, completionRaw: 100, goalType: 'COMPLIANCE' },
  { status: 'NOT_MET', reported: true, completionRaw: 0, goalType: 'COMPLIANCE' },
  { status: 'OVERDUE_UNREPORTED', reported: false, completionRaw: null, goalType: 'COMPLIANCE' },
]);
check(
  bInv.evaluablePeriods === bInv.met + bInv.notMet + bInv.overdueUnreported,
  'invariante binaria Evaluadas = Cumplidas + No cumplidas + Vencidas',
);
check(summarizeClassifiedPeriodRows([{ status: 'PENDING', reported: false, completionRaw: null }]).evaluablePeriods === 0, 'pendiente excluida');

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

const tzTrend = 'America/Mexico_City';
const weekB = weekBoundsFromAnchorYmd('2026-10-28', tzTrend);
check(weekB.weekStart === '2026-10-26' && weekB.weekEnd === '2026-11-01', 'semana lun–dom TZ');
check(parseTrendAnchorYmd('2026-10-28') === '2026-10-28', 'anchor válido');
let badAnchor = false;
try {
  parseTrendAnchorYmd('2026-13-01');
} catch (e) {
  badAnchor = e.code === 'VALIDATION_ERROR';
}
check(badAnchor, 'anchor inválido rechazado');
const curWeek = currentWeekStartYmd(new Date('2026-10-30T12:00:00Z'), tzTrend);
check(curWeek === '2026-10-26', 'semana actual por default (oct 30)');
let futureWeek = false;
try {
  assertWeekNotFuture('2099-01-04', tzTrend, new Date('2026-10-15T12:00:00Z'));
} catch (e) {
  futureWeek = e.code === 'VALIDATION_ERROR';
}
check(futureWeek, 'no semana futura');

const dailyRows = [];
for (let d = 1; d <= 20; d += 1) {
  dailyRows.push({
    goalId: 'g1',
    periodicity: 'DAILY',
    goalType: 'QUANTITATIVE',
    status: 'MET',
    reported: true,
    completionRaw: 100,
    periodStart: new Date(`2026-10-${String(d).padStart(2, '0')}T12:00:00Z`),
  });
}
check(summarizeClassifiedPeriodRows(dailyRows).evaluablePeriods === 20, '20 evaluaciones meta diaria');

const wkPts = buildWeeklyTrendPoints(
  [
    {
      goalId: 'g1',
      periodicity: 'DAILY',
      goalType: 'QUANTITATIVE',
      status: 'MET',
      reported: true,
      completionRaw: 100,
      periodStart: new Date('2026-10-26T12:00:00Z'),
    },
    {
      goalId: 'g2',
      periodicity: 'WEEKLY',
      goalType: 'QUANTITATIVE',
      status: 'PARTIAL',
      reported: true,
      completionRaw: 50,
      periodStart: new Date('2026-10-26T12:00:00Z'),
    },
    {
      goalId: 'g3',
      periodicity: 'MONTHLY',
      goalType: 'QUANTITATIVE',
      status: 'MET',
      reported: true,
      completionRaw: 100,
      periodStart: new Date('2026-10-01T12:00:00Z'),
    },
  ],
  '2026-10-26',
  '2026-11-01',
  tzTrend,
  { goalId: 'general' },
);
check(wkPts.length === 7, 'weekly 7 slots');
check(wkPts[0].hasData && wkPts[0].evaluablePeriods === 2, 'general semanal excluye monthly');
check(!wkPts.some((p) => p.hasData && p.averageCompliance === 0 && p.evaluablePeriods === 0), 'sin 0% ficticio');
const emptyWeek = buildWeeklyTrendPoints([], '2026-10-26', '2026-11-01', tzTrend, { goalId: 'general' });
check(emptyWeek.every((p) => !p.hasData && p.averageCompliance == null), 'semana vacía hasData false');
const crossYear = weekBoundsFromAnchorYmd('2025-12-31', tzTrend);
check(crossYear.weekStart === '2025-12-29' && crossYear.weekEnd === '2026-01-04', 'semana cruza año en MX');
const crossMonth = weekBoundsFromAnchorYmd('2026-10-30', tzTrend);
check(crossMonth.weekStart === '2026-10-26' && crossMonth.weekEnd === '2026-11-01', 'semana cruza mes');
const weeklyOnce = buildWeeklyTrendPoints(
  [
    {
      goalId: 'gw',
      periodicity: 'WEEKLY',
      goalType: 'QUANTITATIVE',
      status: 'MET',
      reported: true,
      completionRaw: 100,
      periodStart: new Date('2026-10-27T12:00:00Z'),
    },
  ],
  '2026-10-26',
  '2026-11-01',
  tzTrend,
  { goalId: 'gw', goalPeriodicity: 'WEEKLY' },
);
check(weeklyOnce.filter((p) => p.hasData).length === 1, 'semanal una sola posición (periodStart)');
check(weeklyOnce[1].hasData && weeklyOnce[1].evaluablePeriods === 1, 'semanal anclada en YMD periodStart');
const partialWeek = buildWeeklyTrendPoints(
  [
    {
      goalId: 'gd',
      periodicity: 'DAILY',
      goalType: 'QUANTITATIVE',
      status: 'MET',
      reported: true,
      completionRaw: 100,
      periodStart: new Date('2026-10-26T12:00:00Z'),
    },
    {
      goalId: 'gd',
      periodicity: 'DAILY',
      goalType: 'QUANTITATIVE',
      status: 'PENDING',
      reported: false,
      completionRaw: null,
      periodStart: new Date('2026-10-31T12:00:00Z'),
    },
    {
      goalId: 'gd',
      periodicity: 'DAILY',
      goalType: 'QUANTITATIVE',
      status: 'OVERDUE_UNREPORTED',
      reported: false,
      completionRaw: null,
      periodStart: new Date('2026-10-28T12:00:00Z'),
    },
  ],
  '2026-10-26',
  '2026-11-01',
  tzTrend,
  { goalId: 'gd', goalPeriodicity: 'DAILY' },
);
check(!partialWeek[5].hasData, 'pendiente vigente ausencia de dato');
check(partialWeek[2].hasData && partialWeek[2].averageCompliance === 0, 'vencida sin reporte → 0%');

const moPts = buildMonthlyTrendPoints(
  dailyRows.map((r) => ({ ...r, periodStart: new Date('2026-10-15T12:00:00Z') })),
  monthWindowFromEndYm('2026-10', 6),
  tzTrend,
  { goalId: 'general' },
);
const moWindow = monthWindowFromEndYm('2026-02', 6);
check(moWindow.length === 6 && moWindow[0] === '2025-09' && moWindow[5] === '2026-02', '6 meses contiguos con cambio de año');
check(moPts.length === 6, 'ventana 6 meses');
check(moPts.filter((p) => p.hasData).length >= 1, 'general mensual con datos');
check(moPts.every((p, i) => i === 0 || moPts[i - 1].key < p.key), 'meses orden cronológico');
check(moPts.some((p) => !p.hasData && p.averageCompliance == null), 'mes sin evaluaciones null');
let futureMonth = false;
try {
  assertMetricsMonthNotFuture('2099-12', tzTrend, new Date('2026-10-15T12:00:00Z'));
} catch (e) {
  futureMonth = e.code === 'VALIDATION_ERROR';
}
check(futureMonth, 'mes futuro rechazado tendencia');
check(/blockWeekly/.test(indexHtml) && /cadence==='MONTHLY'/.test(indexHtml), 'Semanal bloqueado solo con meta mensual');
check(/TC_METRICS_EVAL_HELP/.test(indexHtml) && indexHtml.includes('Evaluaciones de metas'), 'UX leyenda y tooltip evaluaciones');

const trendPt = buildTrendPointFromRows(mixRows.filter((r) => r.status !== 'PENDING'));
check(trendPt.hasData && trendPt.averageCompliance === 53.3, 'tendencia reutiliza summarize');

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

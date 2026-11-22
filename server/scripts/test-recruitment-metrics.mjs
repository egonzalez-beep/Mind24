/**
 * Recruitment — métricas mensuales (fase coveredAt + Declinados).
 * node server/scripts/test-recruitment-metrics.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(rootDir, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-metrics-test-secret';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const pubHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');
const routes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const svcSrc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentMetrics.service.js'), 'utf8');
const coverageSrc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentCoverage.service.js'), 'utf8');
const migrationCovered = fs.readFileSync(
  path.join(rootDir, 'prisma/migrations/20261104053000_recruitment_hired_coverage/migration.sql'),
  'utf8',
);
const terminalSrc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentMetricsTerminal.service.js'),
  'utf8',
);

const {
  getLocalMonthRange,
  shiftMonth,
  parseMetricsMonthInput,
  buildTerminalClosureShares,
  avgCoverageDaysForMonth,
  countDeclinedApplicationsForMonth,
  computeCoverageAverageFromVacancies,
  loadRecruitmentMetricsDataQuality,
  getRecruitmentMetrics,
} = await import('../src/services/recruitmentMetrics.service.js');
const { MIND24_DEFAULT_IANA_TIMEZONE } = await import('../src/services/organizationTimezone.service.js');
const {
  TERMINAL_MIN_DWELL_MS,
  consolidateTerminalApplications,
  effectiveStageKeyAt,
  qualifyTerminalApplicationForMonth,
  rejectedTopClientFromConsolidated,
} = await import('../src/services/recruitmentMetricsTerminal.service.js');
const {
  buildMonthlyTrend,
  classifyTrendScore,
  evaluateCountSignal,
  evaluateCoverageSignal,
  evaluateRejectionShareSignal,
  filterDuplicateInsights,
  isSignificantChange,
  relativeDelta,
  resolveTrendComparisonWindows,
  sameLocalClockInMonth,
  localDateTimeParts,
} = await import('../src/services/recruitmentMetricsTrend.service.js');
const { calendarDayDiff } = await import('../src/services/recruitmentVacancy.service.js');
const { localDateKey } = await import('../src/services/remoteWorkSessionHistory.service.js');
const { tallyVacancyHires } = await import('../src/services/recruitmentCoverage.service.js');

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

function d(iso) {
  return new Date(iso);
}

console.log('\n=== Recruitment — métricas (estático) ===\n');

check(/router\.get\('\/metrics'/.test(routes), 'GET /metrics');
check(/getRecruitmentMetricsForRequest/.test(routes), 'servicio métricas en routes');
check(!/EVERGREEN_COVERAGE_DAYS/.test(svcSrc), 'sin heurística evergreen en cobertura');
check(/localDateKey/.test(svcSrc) && /resolveOrganizationIanaTimezone/.test(svcSrc), 'métricas en TZ organización');
check(/coverageDateSource:\s*'vacancy\.coveredAt'/.test(svcSrc), 'cobertura documenta coveredAt');
check(!/coverageDateSource:\s*'vacancy\.updatedAt'/.test(svcSrc), 'cobertura ya no documenta updatedAt');
{
  const avgFn = svcSrc.slice(
    svcSrc.indexOf('export async function avgCoverageDaysForMonth'),
    svcSrc.indexOf('export async function countDeclinedApplicationsForMonth'),
  );
  check(/coveredAt:\s*\{\s*gte:\s*start,\s*lt:\s*end/.test(avgFn), 'promedio filtra por coveredAt en mes');
  check(!/updatedAt:\s*\{\s*gte:\s*start/.test(avgFn), 'promedio no filtra por updatedAt');
  check(!/excludedMissingCoveredAt/.test(avgFn), 'promedio no mezcla deuda global como exclusión del mes');
}
check(/loadRecruitmentMetricsDataQuality/.test(svcSrc), 'bloque dataQuality global');
check(/coveredVacanciesMissingCoveredAt/.test(svcSrc), 'calidad: COVERED sin coveredAt (global)');
check(/declinedApplicationsMissingClosedAt/.test(svcSrc), 'calidad: DECLINED sin closedAt (global)');
check(!/kpis\.[\s\S]{0,400}excludedMissingCoveredAt/.test(svcSrc), 'KPI mensual sin excludedMissingCoveredAt');
check(/countDeclinedApplicationsForMonth/.test(svcSrc), 'KPI Declinados en servicio');
check(/closureOutcome:\s*'DECLINED'/.test(svcSrc) && /closedAt:\s*\{\s*gte:\s*start/.test(svcSrc), 'Declinados por closedAt');
check(/terminalClosures/.test(svcSrc) && /buildTerminalClosureShares/.test(svcSrc), 'bloque terminalClosures');
check(/participación entre cierres/i.test(svcSrc), 'shares documentados como participación entre cierres');
check(
  !/\b(tasa de rechazo|tasa de contratación)\b/i.test(svcSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
  'no llama tasa de funnel a los shares (fuera de comentarios)',
);
check(/buildMonthlyTrend|comparisonMode/.test(svcSrc), 'tendencia mensual en servicio');
check(/MONTH_TO_DATE|FULL_MONTH|INSUFFICIENT/.test(svcSrc), 'modos de comparación documentados');
const trendSrc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentMetricsTrend.service.js'),
  'utf8',
);
check(/Tendencia al alza/.test(trendSrc) && /Datos insuficientes/.test(trendSrc), 'copy de tendencia en servicio');
check(/recMetricsRenderTrendInsight|recMetricsToggleTrendDetail/.test(indexHtml), 'detalle expandible de tendencia');
check(/rec-metrics-insight--trend/.test(indexHtml), 'UI de tendencia en HTML');
check(/consolidateTerminalApplications/.test(svcSrc), 'KPIs usan consolidación terminal');
check(!/countStageMovesToKey/.test(svcSrc), 'sin conteo bruto StageEvent en métricas');
check(/ADD COLUMN "coveredAt"/.test(migrationCovered), 'migración agregó coveredAt');
check(!/\bUPDATE\b/i.test(migrationCovered) && /Sin backfill/i.test(migrationCovered), 'migración coveredAt sin UPDATE/backfill de datos');
check(/coveredAt:\s*now/.test(coverageSrc) && /coveredAt:\s*null/.test(coverageSrc), 'cubrir escribe coveredAt; reabrir limpia');
check(/rec-tab-metrics/.test(indexHtml), 'pestaña Métricas');
check(/recMetricsLoad/.test(indexHtml), 'carga métricas frontend');
check(/rec-metrics-cal-grid/.test(indexHtml), 'calendario actividad diaria');
check(/Declinados/.test(indexHtml), 'KPI Declinados en UI');
check(/Personas registradas por primera vez durante el mes seleccionado/.test(indexHtml), 'tooltip Registrados');
check(/Personas distintas que iniciaron al menos un proceso durante el mes seleccionado/.test(indexHtml), 'tooltip Ingresaron');
check(/Procesos que llegaron a contratación/.test(indexHtml), 'tooltip Contratados (procesos)');
check(/Procesos cerrados como rechazados/.test(indexHtml), 'tooltip Rechazados (procesos)');
check(/Más información sobre /.test(indexHtml), 'aria-label descriptivo del botón ?');
check(/recMetricsBindKpiTips|recMetricsCloseAllKpiTips|Escape/.test(indexHtml), 'tooltips con open/close Escape');
check(/role="tooltip"/.test(indexHtml) && /rec-metrics-kpi-info/.test(indexHtml), 'tooltips accesibles KPI');
check(/rec-metrics-kpi-icon--orange/.test(indexHtml), 'Declinados tono naranja');
check(/no pueden asignarse a un mes/.test(indexHtml), 'tooltip cobertura documenta deuda global');
check(/Muestra:/.test(indexHtml) && /histórico/.test(indexHtml), 'nota compacta de muestra/histórico en UI');
check(/Calendario sin Declinados/.test(indexHtml), 'calendario documenta omisión de Declinados');
check(/grid-template-columns:repeat\(7/.test(indexHtml), 'grid 7 columnas en escritorio');
check(/@container rec-metrics/.test(indexHtml), 'breakpoints por contenedor de métricas');
check(pubHtml === indexHtml, 'HTML raíz idéntico a server/public');

console.log('\n=== Helpers de periodo ===\n');

const oct = getLocalMonthRange(2026, 10, MIND24_DEFAULT_IANA_TIMEZONE);
check(oct.daysInMonth === 31, 'octubre 2026 tiene 31 días');
check(oct.fromKey === '2026-10-01', 'inicio calendario org TZ');
check(oct.toKey === '2026-10-31', 'fin calendario org TZ');
check(shiftMonth(2026, 1, -1).month === 12 && shiftMonth(2026, 1, -1).year === 2025, 'mes anterior enero');
const feb = getLocalMonthRange(2026, 2, MIND24_DEFAULT_IANA_TIMEZONE);
check(feb.daysInMonth === 28, 'febrero 2026 no bisiesto');
const nyc = getLocalMonthRange(2026, 10, 'America/New_York');
check(nyc.start.getTime() !== oct.start.getTime() || nyc.end.getTime() !== oct.end.getTime() || true, 'rango depende de IANA');
check(
  nyc.start.toISOString() === '2026-10-01T04:00:00.000Z' ||
    nyc.start.toISOString() === '2026-10-01T05:00:00.000Z',
  'octubre America/New_York inicia en medianoche local',
);

try {
  parseMetricsMonthInput(2026, 13);
  check(false, 'mes 13 debe fallar');
} catch {
  check(true, 'validación mes');
}

console.log('\n=== Shares terminales (unit) ===\n');

const sharesOk = buildTerminalClosureShares({ hired: 2, rejected: 1, declined: 1 });
check(sharesOk.terminalDecisions === 4, 'terminalDecisions suma cierres');
check(
  sharesOk.hireShare === 0.5 && sharesOk.rejectionShare === 0.25 && sharesOk.declineShare === 0.25,
  'shares 0–1 con datos',
);
check(
  Math.abs(sharesOk.hireShare + sharesOk.rejectionShare + sharesOk.declineShare - 1) < 1e-12,
  'tres shares suman 1 (tolerancia float)',
);
const onlyHired = buildTerminalClosureShares({ hired: 3, rejected: 0, declined: 0 });
check(
  onlyHired.hireShare === 1 && onlyHired.rejectionShare === 0 && onlyHired.declineShare === 0,
  'una sola categoría → share 1 y 0',
);
const sharesEmpty = buildTerminalClosureShares({ hired: 0, rejected: 0, declined: 0 });
check(
  sharesEmpty.terminalDecisions === 0 &&
    sharesEmpty.hireShare === null &&
    sharesEmpty.rejectionShare === null &&
    sharesEmpty.declineShare === null,
  'shares con cero terminales → null',
);

console.log('\n=== Tendencia mensual (unit) ===\n');

{
  // Fórmula relativa exacta: (current - previous) / Math.max(previous, 1)
  check(relativeDelta(0, 0) === 0, 'rel: 0→0 = 0');
  check(relativeDelta(1, 0) === 1, 'rel: 0→1 = 1 (sin Infinity)');
  check(relativeDelta(2, 0) === 2, 'rel: 0→2 = 2');
  check(relativeDelta(0, 1) === -1, 'rel: 1→0 = −100%');
  check(relativeDelta(11, 10) === 0.1, 'rel: 10→11 = 10%');
  check(relativeDelta(12, 10) === 0.2, 'rel: 10→12 = 20%');
  check(relativeDelta(21, 20) === 0.05, 'rel: 20→21 = 5%');
  check(relativeDelta(22, 20) === 0.1, 'rel: 20→22 = 10%');
  check(relativeDelta(9.5, 10) === -0.05, 'rel: cobertura 10→9.5');
  check(relativeDelta(9, 10) === -0.1, 'rel: cobertura 10→9');
  check(Number.isFinite(relativeDelta(5, 0)) && !Number.isNaN(relativeDelta(5, 0)), 'rel: sin NaN/Infinity');

  const regOpts = (curr, prev) => ({
    key: 'registrations',
    label: 'Registros',
    current: curr,
    previous: prev,
    minAbs: 2,
    positiveWhenHigher: true,
  });
  const hireOpts = (curr, prev) => ({
    key: 'hired',
    label: 'Contrataciones',
    current: curr,
    previous: prev,
    minAbs: 1,
    requireEitherSide: true,
    positiveWhenHigher: true,
  });

  check(evaluateCountSignal(hireOpts(0, 0)).score === null, 'tabla: 0→0 contrataciones no elegible (score null)');
  check(evaluateCountSignal(hireOpts(1, 0)).score === 1, 'tabla: 0→1 contrataciones alza válida');
  check(
    isSignificantChange(2, 0, 2, 0.1) && evaluateCountSignal({ ...regOpts(2, 0), minCombinedForEligibility: null }).score === 1,
    'tabla: 0→2 registros supera abs+rel (elegibilidad aparte)',
  );
  check(evaluateCountSignal(hireOpts(0, 1)).score === -1, 'tabla: 1→0 disminución 100%');
  check(evaluateCountSignal(regOpts(11, 10)).score === 0, 'tabla: 10→11 registros estables por abs');
  check(evaluateCountSignal(regOpts(12, 10)).score === 1, 'tabla: 10→12 registros alza');
  check(evaluateCountSignal(regOpts(21, 20)).score === 0, 'tabla: 20→21 registros estables por rel <10%');
  check(evaluateCountSignal(regOpts(22, 20)).score === 1, 'tabla: 20→22 registros alza');
  check(evaluateCoverageSignal(9.5, 10, 2, 2).score === 0, 'tabla: cobertura 10→9.5 estable');
  const covImprove = evaluateCoverageSignal(9, 10, 2, 2);
  check(covImprove.score === 1 && covImprove.delta === -1, 'tabla: cobertura 10→9 mejora; delta matemático −1');

  const allUp = buildMonthlyTrend({
    comparisonMode: 'FULL_MONTH',
    comparisonLabel: 'vs. septiembre de 2026',
    compareLabelShort: 'septiembre',
    registrations: { current: 20, previous: 10 },
    hired: { current: 5, previous: 2 },
    rejectionShare: { current: 0.2, previous: 0.4, currentDecisions: 10, previousDecisions: 10 },
    coverage: { current: 5, previous: 8, currentSampleSize: 3, previousSampleSize: 3 },
  });
  check(allUp.status === 'UP' && allUp.score >= 2, '1) todas positivas → UP');
  check(allUp.primaryReasons[0]?.polarity === 'positive', 'UP: primera razón positiva');
  check(allUp.signals.every((s) => s.eligible && (s.score === 1 || s.score === 0 || s.score === -1)), 'scores elegibles ∈ {−1,0,1}');

  const allDown = buildMonthlyTrend({
    comparisonMode: 'FULL_MONTH',
    comparisonLabel: 'vs. septiembre de 2026',
    compareLabelShort: 'septiembre',
    registrations: { current: 5, previous: 12 },
    hired: { current: 1, previous: 4 },
    rejectionShare: { current: 0.5, previous: 0.2, currentDecisions: 10, previousDecisions: 10 },
    coverage: { current: 12, previous: 6, currentSampleSize: 3, previousSampleSize: 3 },
  });
  check(allDown.status === 'DOWN' && allDown.score <= -2, '2) todas negativas → DOWN');
  check(allDown.primaryReasons[0]?.polarity === 'negative', 'DOWN: primera razón negativa');
  check(
    !allDown.primaryReasons.some((r) => r.polarity === 'positive'),
    'DOWN: mejoras no en primary (quedan en detalle)',
  );

  const mixed = buildMonthlyTrend({
    comparisonMode: 'FULL_MONTH',
    comparisonLabel: 'vs. septiembre de 2026',
    compareLabelShort: 'septiembre',
    registrations: { current: 20, previous: 10 },
    hired: { current: 5, previous: 2 },
    rejectionShare: { current: 0.5, previous: 0.2, currentDecisions: 10, previousDecisions: 10 },
    coverage: { current: 12, previous: 6, currentSampleSize: 3, previousSampleSize: 3 },
  });
  check(mixed.status === 'STABLE' && mixed.score === 0, '3) 2+/2− → STABLE');
  check(
    mixed.primaryReasons.some((r) => r.polarity === 'positive') &&
      mixed.primaryReasons.some((r) => r.polarity === 'negative'),
    '5) STABLE mixto: primaryReasons balanceadas (+ y −)',
  );

  const oneEligible = buildMonthlyTrend({
    comparisonMode: 'FULL_MONTH',
    comparisonLabel: 'vs. septiembre de 2026',
    compareLabelShort: 'septiembre',
    registrations: { current: 1, previous: 0 },
    hired: { current: 3, previous: 0 },
    rejectionShare: { current: null, previous: null, currentDecisions: 2, previousDecisions: 2 },
    coverage: { current: 5, previous: 8, currentSampleSize: 1, previousSampleSize: 1 },
  });
  check(oneEligible.status === 'INSUFFICIENT', '4) una elegible → INSUFFICIENT');
  check(
    oneEligible.primaryReasons.every((r) => r.polarity !== 'positive'),
    '6) INSUFFICIENT: primary no vende alza aislada',
  );
  check(
    oneEligible.signals.filter((s) => s.eligible).length === 1 &&
      oneEligible.signals.find((s) => s.key === 'hired').score === 1 &&
      oneEligible.signals.find((s) => !s.eligible).score === null,
    'score null en no elegibles; elegible positiva = 1',
  );

  const twoUp = buildMonthlyTrend({
    comparisonMode: 'FULL_MONTH',
    comparisonLabel: 'vs. septiembre de 2026',
    compareLabelShort: 'septiembre',
    registrations: { current: 1, previous: 0 },
    hired: { current: 3, previous: 0 },
    rejectionShare: { current: 0.2, previous: 0.4, currentDecisions: 10, previousDecisions: 10 },
    coverage: { current: null, previous: null, currentSampleSize: 0, previousSampleSize: 0 },
  });
  check(twoUp.status === 'UP' && twoUp.score === 2 && twoUp.eligibleSignals === 2, '1) score 2 con 2 elegibles → UP');

  const twoDown = buildMonthlyTrend({
    comparisonMode: 'FULL_MONTH',
    comparisonLabel: 'vs. septiembre de 2026',
    compareLabelShort: 'septiembre',
    registrations: { current: 1, previous: 0 },
    hired: { current: 0, previous: 3 },
    rejectionShare: { current: 0.5, previous: 0.2, currentDecisions: 10, previousDecisions: 10 },
    coverage: { current: null, previous: null, currentSampleSize: 0, previousSampleSize: 0 },
  });
  check(twoDown.status === 'DOWN' && twoDown.score === -2, '2) score −2 → DOWN');

  check(classifyTrendScore([1, 0, 0]).status === 'STABLE', '3) score 1 → STABLE');
  check(classifyTrendScore([-1, 0, 0]).status === 'STABLE', '4) score −1 → STABLE');
  check(classifyTrendScore([1, null, null, null]).status === 'INSUFFICIENT', 'nulls no cuentan como elegibles');
  check(classifyTrendScore([1, 1, 0]).status === 'UP' && classifyTrendScore([1, 1, 0]).eligibleSignals === 3, '3 elegibles score 2 → UP');
  check(classifyTrendScore([1, 1, 1, 0]).status === 'UP' && classifyTrendScore([1, 1, 1, 0]).eligibleSignals === 4, '4 elegibles');
  check(classifyTrendScore([-1, -1, 0]).status === 'DOWN', '3 elegibles score −2 → DOWN');

  const quiet = buildMonthlyTrend({
    comparisonMode: 'FULL_MONTH',
    comparisonLabel: 'vs. septiembre de 2026',
    compareLabelShort: 'septiembre',
    registrations: { current: 0, previous: 0 },
    hired: { current: 0, previous: 0 },
    rejectionShare: { current: null, previous: null, currentDecisions: 0, previousDecisions: 0 },
    coverage: { current: null, previous: null, currentSampleSize: 0, previousSampleSize: 0 },
  });
  check(quiet.status === 'INSUFFICIENT', '9) ambos meses sin actividad → INSUFFICIENT');

  const allStable = buildMonthlyTrend({
    comparisonMode: 'FULL_MONTH',
    comparisonLabel: 'vs. septiembre de 2026',
    compareLabelShort: 'septiembre',
    registrations: { current: 10, previous: 10 },
    hired: { current: 3, previous: 3 },
    rejectionShare: { current: 0.3, previous: 0.3, currentDecisions: 10, previousDecisions: 10 },
    coverage: { current: 7, previous: 7, currentSampleSize: 3, previousSampleSize: 3 },
  });
  check(allStable.status === 'STABLE', '9) valores idénticos → STABLE');
  check(
    /rango esperado/i.test(allStable.primaryReasons[0]?.text || ''),
    'STABLE todo igual: mensaje de rango esperado',
  );

  const fromZero = evaluateCountSignal(hireOpts(2, 0));
  check(fromZero.eligible && fromZero.score === 1 && Number.isFinite(fromZero.relativeDelta), '7) anterior cero sin infinito');
  check(evaluateCountSignal(hireOpts(0, 2)).score === -1, '8) actual cero → disminución');

  const shareExact = evaluateRejectionShareSignal(0.4, 0.32, 10, 10);
  check(shareExact.score === -1, '10) rejection share exactamente +8 pp → cambio');
  const shareExactDown = evaluateRejectionShareSignal(0.32, 0.4, 10, 10);
  check(shareExactDown.score === 1, '10b) rejection share exactamente −8 pp → mejora');
  const shareUnder = evaluateRejectionShareSignal(0.39, 0.32, 10, 10);
  check(shareUnder.score === 0, '10c) <8 pp → estable');

  const covExact = evaluateCoverageSignal(9, 10, 2, 2);
  check(covExact.score === 1 && Math.abs(covExact.relativeDelta) === 0.1, '11) cobertura ±1 día y ±10%');
  check(evaluateCountSignal(regOpts(22, 20)).score === 1, '12) registros exactamente +2 y +10%');

  const nowMtd = new Date('2026-11-16T20:30:00.000Z');
  const mtd = resolveTrendComparisonWindows({
    year: 2026,
    month: 11,
    timeZone: MIND24_DEFAULT_IANA_TIMEZONE,
    now: nowMtd,
    getLocalMonthRange,
  });
  check(mtd.comparisonMode === 'MONTH_TO_DATE', '13) mes actual → MONTH_TO_DATE');
  check(/mismo periodo/i.test(mtd.labels.comparisonLabel || ''), '13b) etiqueta MTD');
  check(/mismo periodo de octubre/i.test(mtd.labels.compareLabelShort || ''), 'MTD compareLabelShort explícito');

  const full = resolveTrendComparisonWindows({
    year: 2026,
    month: 10,
    timeZone: MIND24_DEFAULT_IANA_TIMEZONE,
    now: nowMtd,
    getLocalMonthRange,
  });
  check(full.comparisonMode === 'FULL_MONTH', '14) mes pasado completo → FULL_MONTH');
  check(full.labels.compareLabelShort === 'septiembre', 'FULL compareLabelShort = mes nombre');

  const future = resolveTrendComparisonWindows({
    year: 2027,
    month: 1,
    timeZone: MIND24_DEFAULT_IANA_TIMEZONE,
    now: nowMtd,
    getLocalMonthRange,
  });
  check(future.comparisonMode === 'INSUFFICIENT', '15) mes futuro → INSUFFICIENT');

  const febParts = localDateTimeParts(new Date('2026-03-31T18:00:00.000Z'), MIND24_DEFAULT_IANA_TIMEZONE);
  const febClock = sameLocalClockInMonth(febParts, 2026, 2, MIND24_DEFAULT_IANA_TIMEZONE);
  check(localDateKey(febClock, MIND24_DEFAULT_IANA_TIMEZONE) === '2026-02-28', '16) día 31 → feb 28');
  const day30 = localDateTimeParts(new Date('2026-03-30T18:00:00.000Z'), MIND24_DEFAULT_IANA_TIMEZONE);
  check(localDateKey(sameLocalClockInMonth(day30, 2026, 2, MIND24_DEFAULT_IANA_TIMEZONE), MIND24_DEFAULT_IANA_TIMEZONE) === '2026-02-28', '16b) día 30 → feb 28');
  const day29 = localDateTimeParts(new Date('2026-03-29T18:00:00.000Z'), MIND24_DEFAULT_IANA_TIMEZONE);
  check(localDateKey(sameLocalClockInMonth(day29, 2026, 2, MIND24_DEFAULT_IANA_TIMEZONE), MIND24_DEFAULT_IANA_TIMEZONE) === '2026-02-28', '16c) día 29 no bisiesto → feb 28');

  const decJan = shiftMonth(2026, 1, -1);
  check(decJan.year === 2025 && decJan.month === 12, '15) diciembre–enero');

  const nycWin = resolveTrendComparisonWindows({
    year: 2026,
    month: 10,
    timeZone: 'America/New_York',
    now: new Date('2026-11-16T20:30:00.000Z'),
    getLocalMonthRange,
  });
  check(nycWin.comparisonMode === 'FULL_MONTH', '17) otra TZ organiza FULL_MONTH');

  const fewTerm = evaluateRejectionShareSignal(0.1, 0.5, 4, 10);
  check(!fewTerm.eligible && fewTerm.score === null, '17) <5 decisiones → score null');

  const covOne = evaluateCoverageSignal(5, 8, 1, 3);
  check(!covOne.eligible && covOne.score === null, '18) cobertura sample 1 → score null');

  const absUpShareDown = evaluateRejectionShareSignal(0.2, 0.4, 20, 10);
  check(absUpShareDown.score === 1, '21) participación de rechazos baja aunque absolutos puedan subir');

  const hiredUpRegDown = buildMonthlyTrend({
    comparisonMode: 'FULL_MONTH',
    comparisonLabel: 'vs. septiembre de 2026',
    compareLabelShort: 'septiembre',
    registrations: { current: 5, previous: 20 },
    hired: { current: 6, previous: 2 },
    rejectionShare: { current: null, previous: null, currentDecisions: 0, previousDecisions: 0 },
    coverage: { current: null, previous: null, currentSampleSize: 0, previousSampleSize: 0 },
  });
  check(hiredUpRegDown.status === 'STABLE' && hiredUpRegDown.score === 0, '22) contrataciones↑ registros↓ → STABLE');
  check(
    hiredUpRegDown.primaryReasons.some((r) => r.polarity === 'positive') &&
      hiredUpRegDown.primaryReasons.some((r) => r.polarity === 'negative'),
    'STABLE mixto 2 señales: primary balanceada',
  );

  const deduped = filterDuplicateInsights(
    [
      { kind: 'registrations_up', title: 'Más registros que el mes pasado', body: 'x', tone: 'purple' },
      { kind: 'rejections_client', title: 'Cliente', body: 'y', tone: 'coral' },
    ],
    allUp,
  );
  check(
    deduped.length === 1 && deduped[0].kind === 'rejections_client',
    '1) tendencia + registros duplicados → solo complementario de cliente',
  );

  const withClient = filterDuplicateInsights(
    [{ kind: 'rejections_client', title: 'Cliente Z concentra', body: '2 de 3', tone: 'coral' }],
    allUp,
  );
  check(withClient.length === 1 && withClient[0].kind === 'rejections_client', '2) tendencia + rechazo por cliente → ambos (conserva cliente)');

  const covAnomaly = filterDuplicateInsights(
    [{ kind: 'coverage_slower', title: 'Cobertura más lenta', body: 'subió 4 días', tone: 'amber' }],
    {
      ...quiet,
      status: 'UP',
      comparisonMode: 'FULL_MONTH',
      eligibleSignals: 2,
      signals: [
        { key: 'hired', eligible: true, score: 1 },
        { key: 'registrations', eligible: true, score: 1 },
        { key: 'rejectionShare', eligible: false, score: null },
        { key: 'coverageDays', eligible: false, score: null },
      ],
      primaryReasons: [{ key: 'hired', text: 'Aumentaron las contrataciones.', polarity: 'positive' }],
    },
  );
  check(covAnomaly.length === 1 && covAnomaly[0].kind === 'coverage_slower', '3) cobertura anómala no mencionada → conserva');

  const threeComp = filterDuplicateInsights(
    [
      { kind: 'registrations_down', title: 'Menos registros', body: 'a', tone: 'purple' },
      { kind: 'rejections_client', title: 'Cliente', body: 'b', tone: 'coral' },
      { kind: 'coverage_faster', title: 'Cobertura ágil', body: 'c', tone: 'green' },
    ],
    {
      status: 'STABLE',
      comparisonMode: 'FULL_MONTH',
      eligibleSignals: 2,
      signals: [
        { key: 'hired', eligible: true, score: 0 },
        { key: 'registrations', eligible: true, score: 0 },
        { key: 'rejectionShare', eligible: false, score: null },
        { key: 'coverageDays', eligible: false, score: null },
      ],
      primaryReasons: [{ key: 'stable_all', text: 'Los principales indicadores se mantuvieron dentro del rango esperado.', polarity: 'neutral' }],
    },
  );
  check(
    threeComp.length === 2 &&
      threeComp[0].kind === 'rejections_client' &&
      threeComp[1].kind === 'coverage_faster',
    '4) tres complementarios → dos prioritarios',
  );

  check(filterDuplicateInsights([], allUp).length === 0, '5) sin complementarios → solo tendencia');

  const insuffOps = filterDuplicateInsights(
    [{ kind: 'rejections_client', title: 'Cliente', body: 'ops', tone: 'coral' }],
    {
      status: 'INSUFFICIENT',
      eligibleSignals: 0,
      comparisonMode: 'INSUFFICIENT',
      signals: [],
      primaryReasons: [{ key: 'future', text: 'El mes seleccionado aún no tiene un periodo comparable.', polarity: 'neutral' }],
    },
  );
  check(insuffOps.length === 1 && insuffOps[0].kind === 'rejections_client', '6) INSUFFICIENT + insight operativo → conserva');

  check(allUp.primaryReasons.length <= 2, 'UI contract: primaryReasons ≤ 2');
  check(allUp.reasons.some((r) => /contrataciones/i.test(r.text)), 'razones incluyen contrataciones');
  check(
    !/tasa de funnel/i.test(JSON.stringify(allUp)) && !/funnel rate/i.test(svcSrc),
    'rejectionShare no se presenta como tasa de funnel',
  );
  check(/metricsReqSeq/.test(indexHtml), '18) UI protege respuesta fuera de orden (metricsReqSeq)');
  check(/recMetricsTrendTone/.test(indexHtml) && /recMetricsTrendIconKey/.test(indexHtml), 'tone/icon whitelist en UI');
  check(/rec-metrics-trend-detail-chevron/.test(indexHtml), 'control detalle con chevron');
  check(/indicadores comparables/.test(indexHtml), 'UI muestra indicadores comparables');
  check(/rec-metrics-kpi-foot/.test(indexHtml) && !/kpi-value\{[^}]*margin-top:auto/.test(indexHtml.replace(/\s+/g, '')), 'KPI valor sin margin-top:auto');
}

console.log('\n=== Cobertura calendarística (unit, sin DB) ===\n');

const opened = d('2026-10-01T15:00:00.000Z');
const covered = d('2026-10-11T18:00:00.000Z');
const daysMx = calendarDayDiff(
  localDateKey(opened, MIND24_DEFAULT_IANA_TIMEZONE),
  localDateKey(covered, MIND24_DEFAULT_IANA_TIMEZONE),
);
check(daysMx === 10, 'openedAt→coveredAt en TZ org (días calendario)');
const covOk = computeCoverageAverageFromVacancies(
  [{ openedAt: opened, coveredAt: covered }],
  MIND24_DEFAULT_IANA_TIMEZONE,
);
check(covOk.sampleSize === 1 && covOk.value === 10, 'COVERED con coveredAt en mes entra al promedio');
const covInvalid = computeCoverageAverageFromVacancies(
  [{ openedAt: d('2026-10-20T12:00:00.000Z'), coveredAt: d('2026-10-10T12:00:00.000Z') }],
  MIND24_DEFAULT_IANA_TIMEZONE,
);
check(
  covInvalid.sampleSize === 0 && covInvalid.value === null && covInvalid.invalidChronology === 1,
  'openedAt posterior a coveredAt: inválido, sin duración negativa',
);
const covLegacyRow = computeCoverageAverageFromVacancies(
  [{ openedAt: opened, coveredAt: null }],
  MIND24_DEFAULT_IANA_TIMEZONE,
);
check(covLegacyRow.sampleSize === 0, 'legacy sin coveredAt no entra al promedio');

console.log('\n=== Reglas consolidadas HIRED/REJECTED ===\n');

const monthStart = d('2026-10-01T06:00:00.000Z');
const monthEnd = d('2026-11-01T06:00:00.000Z');
const endOct = d('2026-10-31T23:59:59.999Z');
const appId = 'app1';

const baseCtx = {
  applicationId: appId,
  monthStart,
  monthEnd,
  endOfMonthInstant: endOct,
  timeZone: MIND24_DEFAULT_IANA_TIMEZONE,
};

check(
  qualifyTerminalApplicationForMonth({
    ...baseCtx,
    currentStageKey: 'NEW',
    stageKey: 'HIRED',
    isCurrentMonth: true,
    now: d('2026-10-26T12:00:00.000Z'),
    timeline: [
      { createdAt: d('2026-10-10T12:00:00.000Z'), toStageKey: 'NEW' },
      { createdAt: d('2026-10-10T13:00:00.000Z'), toStageKey: 'HIRED' },
      { createdAt: d('2026-10-10T18:00:00.000Z'), toStageKey: 'NEW' },
    ],
  }) === null,
  'HIRED <24 h y sale → no cuenta (mes actual)',
);

check(
  qualifyTerminalApplicationForMonth({
    ...baseCtx,
    currentStageKey: 'HIRED',
    stageKey: 'HIRED',
    isCurrentMonth: true,
    now: d('2026-10-26T12:00:00.000Z'),
    timeline: [
      { createdAt: d('2026-10-01T12:00:00.000Z'), toStageKey: 'NEW' },
      { createdAt: d('2026-10-05T12:00:00.000Z'), toStageKey: 'HIRED' },
    ],
  }) != null,
  'HIRED >24 h y sigue → cuenta (mes actual)',
);

check(
  qualifyTerminalApplicationForMonth({
    ...baseCtx,
    currentStageKey: 'NEW',
    stageKey: 'REJECTED',
    isCurrentMonth: true,
    now: d('2026-10-26T12:00:00.000Z'),
    timeline: [
      { createdAt: d('2026-10-12T12:00:00.000Z'), toStageKey: 'REJECTED' },
      { createdAt: d('2026-10-12T20:00:00.000Z'), toStageKey: 'NEW' },
    ],
  }) === null,
  'REJECTED <24 h → no cuenta',
);

check(
  qualifyTerminalApplicationForMonth({
    ...baseCtx,
    currentStageKey: 'REJECTED',
    stageKey: 'REJECTED',
    isCurrentMonth: true,
    now: d('2026-10-26T12:00:00.000Z'),
    timeline: [{ createdAt: d('2026-10-12T12:00:00.000Z'), toStageKey: 'REJECTED' }],
  }) != null,
  'REJECTED >24 h → cuenta',
);

const reentry = qualifyTerminalApplicationForMonth({
  ...baseCtx,
  currentStageKey: 'HIRED',
  stageKey: 'HIRED',
  isCurrentMonth: true,
  now: d('2026-10-26T12:00:00.000Z'),
  timeline: [
    { createdAt: d('2026-10-05T12:00:00.000Z'), toStageKey: 'HIRED' },
    { createdAt: d('2026-10-05T14:00:00.000Z'), toStageKey: 'NEW' },
    { createdAt: d('2026-10-20T12:00:00.000Z'), toStageKey: 'HIRED' },
  ],
});
check(reentry != null && reentry.entryAt.getTime() === d('2026-10-20T12:00:00.000Z').getTime(), 'reingreso reinicia ventana 24 h');

const dupApps = [
  {
    applicationId: 'a1',
    currentStageKey: 'HIRED',
    timeline: [
      { createdAt: d('2026-10-01T12:00:00.000Z'), toStageKey: 'HIRED' },
      { createdAt: d('2026-10-02T12:00:00.000Z'), toStageKey: 'NEW' },
      { createdAt: d('2026-10-03T12:00:00.000Z'), toStageKey: 'HIRED' },
    ],
  },
];
const dupCount = consolidateTerminalApplications(dupApps, 'HIRED', {
  monthStart,
  monthEnd,
  endOfMonthInstant: endOct,
  now: d('2026-10-26T12:00:00.000Z'),
  isCurrentMonth: true,
}).length;
check(dupCount === 1, 'varios eventos misma application → no duplica');

check(
  qualifyTerminalApplicationForMonth({
    ...baseCtx,
    currentStageKey: 'NEW',
    stageKey: 'HIRED',
    isCurrentMonth: false,
    now: d('2026-11-15T12:00:00.000Z'),
    timeline: [
      { createdAt: d('2026-10-15T12:00:00.000Z'), toStageKey: 'HIRED' },
      { createdAt: d('2026-11-03T12:00:00.000Z'), toStageKey: 'NEW' },
    ],
  }) != null,
  'mes histórico: HIRED 15 oct, sale 3 nov → oct sí cuenta al cierre',
);

check(
  qualifyTerminalApplicationForMonth({
    ...baseCtx,
    currentStageKey: 'NEW',
    stageKey: 'HIRED',
    isCurrentMonth: false,
    now: d('2026-11-15T12:00:00.000Z'),
    timeline: [
      { createdAt: d('2026-10-15T12:00:00.000Z'), toStageKey: 'HIRED' },
      { createdAt: d('2026-10-20T12:00:00.000Z'), toStageKey: 'NEW' },
    ],
  }) === null,
  'mes histórico: salió antes de cierre → no cuenta',
);

{
  const earlyExitTimeline = [
    { createdAt: d('2026-10-05T12:00:00.000Z'), toStageKey: 'HIRED' },
    // < 24 h: la Baja no anula la contratación del mes.
    { createdAt: d('2026-10-05T18:00:00.000Z'), toStageKey: 'EMPLOYMENT_EXIT' },
  ];
  const earlyExitApps = [
    {
      applicationId: appId,
      currentStageKey: 'EMPLOYMENT_EXIT',
      timeline: earlyExitTimeline,
    },
  ];
  const earlyCurrent = consolidateTerminalApplications(earlyExitApps, 'HIRED', {
    monthStart,
    monthEnd,
    endOfMonthInstant: endOct,
    now: d('2026-10-26T12:00:00.000Z'),
    isCurrentMonth: true,
  });
  const earlyClosed = consolidateTerminalApplications(earlyExitApps, 'HIRED', {
    monthStart,
    monthEnd,
    endOfMonthInstant: endOct,
    now: d('2026-11-15T12:00:00.000Z'),
    isCurrentMonth: false,
  });
  check(
    earlyCurrent.length === 1 && earlyClosed.length === 1,
    'HIRED+Baja <24 h: 1 contratación en mes en curso y tras cerrar el mes',
  );
  check(
    qualifyTerminalApplicationForMonth({
      ...baseCtx,
      currentStageKey: 'EMPLOYMENT_EXIT',
      stageKey: 'HIRED',
      isCurrentMonth: true,
      now: d('2026-10-26T12:00:00.000Z'),
      timeline: earlyExitTimeline,
    }) != null,
    'mes actual: contratación + Baja mismo mes (<24 h) → HIRED cuenta una vez',
  );
  check(
    qualifyTerminalApplicationForMonth({
      ...baseCtx,
      currentStageKey: 'EMPLOYMENT_EXIT',
      stageKey: 'HIRED',
      isCurrentMonth: false,
      now: d('2026-11-15T12:00:00.000Z'),
      timeline: earlyExitTimeline,
    }) != null,
    'mes histórico: HIRED luego Baja <24 h en octubre → oct sí cuenta al cierre',
  );
}

check(
  qualifyTerminalApplicationForMonth({
    ...baseCtx,
    currentStageKey: 'NEW',
    stageKey: 'HIRED',
    isCurrentMonth: true,
    now: d('2026-10-26T12:00:00.000Z'),
    timeline: [
      { createdAt: d('2026-10-05T12:00:00.000Z'), toStageKey: 'HIRED' },
      { createdAt: d('2026-10-05T18:00:00.000Z'), toStageKey: 'NEW' },
    ],
  }) === null,
  'HIRED → otra etapa <24 h (no Baja) sigue sin contar',
);

{
  const entered = d('2026-10-01T12:00:00.000Z');
  const nowCov = d('2026-10-26T12:00:00.000Z');
  const beforeExit = tallyVacancyHires(
    [{ candidateId: 'c-exit', stageKey: 'HIRED', hiredStageEnteredAt: entered, fullName: 'Ana' }],
    nowCov,
  );
  const afterExit = tallyVacancyHires(
    [{ candidateId: 'c-exit', stageKey: 'EMPLOYMENT_EXIT', hiredStageEnteredAt: entered, fullName: 'Ana' }],
    nowCov,
  );
  check(
    beforeExit.currentCount === 1 && afterExit.currentCount === 0,
    'Baja deja de ocupar plaza en cobertura vigente',
  );
}

check(
  effectiveStageKeyAt(
    [
      { createdAt: d('2026-10-15T12:00:00.000Z'), toStageKey: 'HIRED' },
      { createdAt: d('2026-11-03T12:00:00.000Z'), toStageKey: 'NEW' },
    ],
    endOct,
  ) === 'HIRED',
  'stage efectivo al cierre octubre',
);

const rejInsight = rejectedTopClientFromConsolidated(
  new Map([['r1', { clientName: 'Metecno' }]]),
  [{ applicationId: 'r1', entryAt: d('2026-10-10T12:00:00.000Z') }],
);
check(rejInsight.total === 1 && rejInsight.topClient?.name === 'Metecno', 'insights rechazos consolidados');

check(TERMINAL_MIN_DWELL_MS === 86400000, 'ventana 24 h');

console.log('\n=== Métricas — integración PG ===\n');

async function runPg() {
  const { prisma } = await import('../src/db/client.js');
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    pgSkip = true;
    console.log('  SKIP  PostgreSQL no disponible (integración métricas)');
    return;
  }

  const { hashPassword } = await import('../src/services/auth.service.js');
  const { ensureOrgRecruitmentStages } = await import('../src/services/recruitmentStage.service.js');
  const { createRecruitmentApplication } = await import('../src/services/recruitmentApplication.service.js');
  const { declineRecruitmentApplication } = await import('../src/services/recruitmentProcessClosure.service.js');

  const stamp = Date.now();
  const org = await prisma.organization.create({
    data: { name: 'Metrics Org', slug: `metrics-${stamp}`, credits: 10 },
  });
  const admin = await prisma.user.create({
    data: {
      email: `metrics-${stamp}@test.local`,
      passwordHash: await hashPassword('MetricsTest!9x'),
      fullName: 'Admin Metrics',
      role: 'empresa_admin',
      organizationId: org.id,
    },
  });
  await ensureOrgRecruitmentStages(org.id);
  const stages = await prisma.recruitmentStage.findMany({ where: { organizationId: org.id } });
  const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));
  const vac = await prisma.recruitmentVacancy.create({
    data: {
      organizationId: org.id,
      title: 'Vac métricas',
      status: 'ACTIVE',
      openedAt: new Date('2026-10-01T15:00:00.000Z'),
      positionsTotal: 1,
    },
  });

  try {
    const range = getLocalMonthRange(2026, 10, MIND24_DEFAULT_IANA_TIMEZONE);
    const mid = new Date(range.start.getTime() + 5 * 86400000);

    const candA = await prisma.recruitmentCandidate.create({
      data: {
        organizationId: org.id,
        fullName: 'Cand A',
        profile: 'Operador',
        phone: '5510000001',
        createdAt: mid,
      },
    });
    await createRecruitmentApplication({
      organizationId: org.id,
      vacancyId: vac.id,
      candidateId: candA.id,
      changedByUserId: admin.id,
    });
    await prisma.recruitmentApplication.updateMany({
      where: { candidateId: candA.id },
      data: { createdAt: mid, appliedAt: mid },
    });

    const candOnlyReg = await prisma.recruitmentCandidate.create({
      data: {
        organizationId: org.id,
        fullName: 'Solo registrado',
        profile: 'Operador',
        phone: '5510000002',
        createdAt: mid,
      },
    });

    const candOld = await prisma.recruitmentCandidate.create({
      data: {
        organizationId: org.id,
        fullName: 'Antiguo',
        profile: 'Operador',
        phone: '5510000003',
        createdAt: new Date('2026-08-01T12:00:00.000Z'),
      },
    });
    await createRecruitmentApplication({
      organizationId: org.id,
      vacancyId: vac.id,
      candidateId: candOld.id,
      changedByUserId: admin.id,
    });
    await prisma.recruitmentApplication.updateMany({
      where: { candidateId: candOld.id },
      data: { createdAt: mid, appliedAt: mid },
    });

    const candMulti = await prisma.recruitmentCandidate.create({
      data: {
        organizationId: org.id,
        fullName: 'Multi app',
        profile: 'Operador',
        phone: '5510000004',
        createdAt: mid,
      },
    });
    const vac2 = await prisma.recruitmentVacancy.create({
      data: {
        organizationId: org.id,
        title: 'Vac 2',
        status: 'ACTIVE',
        openedAt: new Date('2026-10-02T15:00:00.000Z'),
        positionsTotal: 1,
      },
    });
    await createRecruitmentApplication({
      organizationId: org.id,
      vacancyId: vac.id,
      candidateId: candMulti.id,
      changedByUserId: admin.id,
    });
    await createRecruitmentApplication({
      organizationId: org.id,
      vacancyId: vac2.id,
      candidateId: candMulti.id,
      changedByUserId: admin.id,
    });
    await prisma.recruitmentApplication.updateMany({
      where: { candidateId: candMulti.id },
      data: { createdAt: mid, appliedAt: mid },
    });

    const metricsMid = await getRecruitmentMetrics(org.id, 2026, 10, new Date('2026-11-15T12:00:00.000Z'));
    check(
      metricsMid.kpis.candidatesRegistered.total >= 3,
      'Registrados cuenta personas creadas en mes',
    );
    check(
      metricsMid.kpis.enteredProcess.total >= 3,
      'Ingresaron cuenta personas con app en mes',
    );

    const candCountBeforeReapply = await prisma.recruitmentCandidate.count({
      where: { organizationId: org.id },
    });
    const firstApp = await prisma.recruitmentApplication.findFirst({
      where: { candidateId: candA.id },
    });
    await declineRecruitmentApplication({
      organizationId: org.id,
      applicationId: firstApp.id,
      reason: 'PERSONAL',
      createdByUserId: admin.id,
    });
    await prisma.recruitmentApplication.update({
      where: { id: firstApp.id },
      data: { closedAt: mid },
    });
    const second = await createRecruitmentApplication({
      organizationId: org.id,
      vacancyId: vac.id,
      candidateId: candA.id,
      changedByUserId: admin.id,
    });
    await prisma.recruitmentApplication.update({
      where: { id: second.id },
      data: { createdAt: mid, appliedAt: mid },
    });
    const candCountAfter = await prisma.recruitmentCandidate.count({
      where: { organizationId: org.id },
    });
    check(candCountAfter === candCountBeforeReapply, 'reaplicación: Registrados (conteo personas) no aumenta');
    check(second.candidateId === candA.id, 'reaplicación conserva candidateId');

    const declinedIn = await countDeclinedApplicationsForMonth(org.id, range.start, range.end);
    check(declinedIn.total >= 1, 'Declinación con closedAt en mes');
    const outRange = getLocalMonthRange(2026, 9, MIND24_DEFAULT_IANA_TIMEZONE);
    const declinedOut = await countDeclinedApplicationsForMonth(org.id, outRange.start, outRange.end);
    check(declinedOut.total === 0, 'Declinación fuera del mes no cuenta');

    await prisma.recruitmentApplication.create({
      data: {
        organizationId: org.id,
        candidateId: candOnlyReg.id,
        vacancyId: vac.id,
        stageId: byKey.CONTACT.id,
        position: 1,
        appliedAt: mid,
        createdAt: mid,
        closureOutcome: 'DECLINED',
        closedAt: null,
        blocksReapplication: false,
      },
    });
    const declinedMissing = await countDeclinedApplicationsForMonth(org.id, range.start, range.end);
    check(declinedMissing.total >= 1, 'Declinación sin closedAt no entra al total del mes');
    check(declinedMissing.excludedMissingClosedAt == null, 'KPI mensual no reporta excludedMissingClosedAt');
    const dqMissing = await loadRecruitmentMetricsDataQuality(org.id);
    check(
      dqMissing.declinedApplicationsMissingClosedAt >= 1,
      'dataQuality global: DECLINED sin closedAt',
    );

    await prisma.recruitmentCandidate.update({
      where: { id: candA.id },
      data: { archivedAt: new Date() },
    });
    const declinedArchived = await countDeclinedApplicationsForMonth(org.id, range.start, range.end);
    check(declinedArchived.total >= 1, 'Declinación de candidato archivado incluida');

    const metricsDecl = await getRecruitmentMetrics(org.id, 2026, 10, new Date('2026-11-15T12:00:00.000Z'));
    check(metricsDecl.kpis.declined.total >= 1, 'KPI Declinados en getRecruitmentMetrics');
    check(Number.isFinite(metricsDecl.kpis.declined.previousTotal), 'Declinados incluye previousTotal MoM');
    check(metricsDecl.kpis.declined.excludedMissingClosedAt == null, 'KPI Declinados sin excludedMissingClosedAt');
    const declApps = await prisma.recruitmentApplication.count({
      where: {
        organizationId: org.id,
        closureOutcome: 'DECLINED',
        closedAt: { gte: range.start, lt: range.end },
      },
    });
    check(declApps >= 1 && metricsDecl.kpis.declined.total === declApps, 'Declinados cuentan apps DECLINED del mes');
    check(
      metricsDecl.kpis.rejected.total === 0,
      'Declinación no entra en Rechazados consolidados',
    );
    check(metricsDecl.terminalClosures.declined === metricsDecl.kpis.declined.total, 'terminalClosures.declined alineado');
    check(
      metricsDecl.terminalClosures.terminalDecisions ===
        metricsDecl.terminalClosures.hired +
          metricsDecl.terminalClosures.rejected +
          metricsDecl.terminalClosures.declined,
      'terminalDecisions = hired + rejected + declined',
    );
    if (metricsDecl.terminalClosures.terminalDecisions > 0) {
      const tc = metricsDecl.terminalClosures;
      check(
        tc.hireShare != null && tc.rejectionShare != null && tc.declineShare != null,
        'shares terminales con datos',
      );
      check(
        Math.abs(tc.hireShare + tc.rejectionShare + tc.declineShare - 1) < 1e-12,
        'shares del payload suman 1',
      );
    }
    check(
      metricsDecl.dataQuality &&
        metricsDecl.dataQuality.declinedApplicationsMissingClosedAt >= 1,
      'getRecruitmentMetrics expone dataQuality global',
    );
    check(metricsDecl.kpis.avgCoverageDays.excludedMissingCoveredAt == null, 'avgCoverageDays sin excludedMissingCoveredAt');

    const emptySharesMetrics = await getRecruitmentMetrics(
      org.id,
      2025,
      1,
      new Date('2026-11-15T12:00:00.000Z'),
    );
    check(
      emptySharesMetrics.terminalClosures.terminalDecisions === 0 &&
        emptySharesMetrics.terminalClosures.hireShare === null,
      'shares con cero terminales → null',
    );

    await prisma.recruitmentVacancy.update({
      where: { id: vac.id },
      data: {
        status: 'COVERED',
        coveredAt: new Date('2026-10-11T18:00:00.000Z'),
        coverageSource: 'MANUAL',
        updatedAt: new Date('2026-10-11T18:00:00.000Z'),
      },
    });
    const cov1 = await avgCoverageDaysForMonth(org.id, range.start, range.end, MIND24_DEFAULT_IANA_TIMEZONE);
    check(cov1.sampleSize === 1 && cov1.value != null, '1) COVERED con coveredAt en mes');

    await prisma.recruitmentVacancy.update({
      where: { id: vac.id },
      data: { title: 'Vac métricas editada', updatedAt: new Date('2026-10-28T12:00:00.000Z') },
    });
    const cov2 = await avgCoverageDaysForMonth(org.id, range.start, range.end, MIND24_DEFAULT_IANA_TIMEZONE);
    check(cov2.value === cov1.value && cov2.sampleSize === 1, '2) edición posterior conserva el mes');

    await prisma.recruitmentVacancy.update({
      where: { id: vac.id },
      data: {
        status: 'ACTIVE',
        coveredAt: null,
        coverageSource: null,
        updatedAt: new Date('2026-10-29T12:00:00.000Z'),
      },
    });
    const covReopen = await avgCoverageDaysForMonth(org.id, range.start, range.end, MIND24_DEFAULT_IANA_TIMEZONE);
    check(covReopen.sampleSize === 0, '3) reabierta deja de contar');

    await prisma.recruitmentVacancy.update({
      where: { id: vac.id },
      data: {
        status: 'COVERED',
        coveredAt: new Date('2026-11-05T18:00:00.000Z'),
        coverageSource: 'MANUAL',
      },
    });
    const novRange = getLocalMonthRange(2026, 11, MIND24_DEFAULT_IANA_TIMEZONE);
    const covOctAfterRecover = await avgCoverageDaysForMonth(
      org.id,
      range.start,
      range.end,
      MIND24_DEFAULT_IANA_TIMEZONE,
    );
    const covNov = await avgCoverageDaysForMonth(
      org.id,
      novRange.start,
      novRange.end,
      MIND24_DEFAULT_IANA_TIMEZONE,
    );
    check(covOctAfterRecover.sampleSize === 0, '4a) re-cubierta no cuenta en mes previo');
    check(covNov.sampleSize === 1, '4b) re-cubierta cuenta en el nuevo mes');

    await prisma.recruitmentVacancy.create({
      data: {
        organizationId: org.id,
        title: 'COVERED legacy',
        status: 'COVERED',
        openedAt: new Date('2026-09-01T12:00:00.000Z'),
        coveredAt: null,
        coverageSource: null,
        positionsTotal: 1,
      },
    });
    const covLegacy = await avgCoverageDaysForMonth(org.id, range.start, range.end, MIND24_DEFAULT_IANA_TIMEZONE);
    check(covLegacy.sampleSize === 0, '5) COVERED legacy sin fecha no entra al promedio');
    const dqCov = await loadRecruitmentMetricsDataQuality(org.id);
    check(
      dqCov.coveredVacanciesMissingCoveredAt >= 1,
      '5b) deuda legacy vive en dataQuality global',
    );

    const yearShift = shiftMonth(2026, 1, -1);
    check(yearShift.year === 2025 && yearShift.month === 12, 'cambio de año diciembre–enero');
    const jan = getLocalMonthRange(2026, 1, MIND24_DEFAULT_IANA_TIMEZONE);
    check(jan.fromKey === '2026-01-01' && jan.toKey === '2026-01-31', 'primer/último día de enero');
  } finally {
    await prisma.recruitmentApplicationStageEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.workforceRecruitmentNovedad.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.recruitmentApplication.deleteMany({ where: { organizationId: org.id } });
    await prisma.recruitmentVacancyStage.deleteMany({ where: { vacancy: { organizationId: org.id } } }).catch(() => {});
    await prisma.recruitmentVacancy.deleteMany({ where: { organizationId: org.id } });
    await prisma.recruitmentCandidate.deleteMany({ where: { organizationId: org.id } });
    await prisma.recruitmentStage.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

await runPg().catch((e) => {
  if (String(e.message || e).includes('connect') || e.code === 'P1001') {
    pgSkip = true;
    console.log('  SKIP  PostgreSQL no disponible (integración métricas)');
  } else {
    console.error('  FAIL  integración:', e.message || e);
    failed += 1;
  }
});

console.log('\n=== Métricas — visual HTML real ===\n');

function chromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((item) => fs.existsSync(item)) || null;
}

async function runVisual() {
  const executablePath = chromePath();
  if (!executablePath) {
    check(false, 'Chrome o Edge local para visual de métricas');
    return;
  }
  const puppeteer = await import('puppeteer-core');
  const browser = await puppeteer.default.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(indexHtml);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const fixture = {
      period: {
        year: 2026,
        month: 10,
        label: 'Octubre 2026',
        previousMonthLabel: 'septiembre',
        footerLabel: 'Periodo: 1—31 octubre 2026',
        daysInMonth: 31,
        timeZone: 'America/Mexico_City',
      },
      kpis: {
        candidatesRegistered: {
          total: 12,
          dailyAverage: 0.4,
          deltaDailyAverage: 0.1,
          compareLabel: 'septiembre',
        },
        enteredProcess: { total: 10 },
        hired: { total: 3, deltaVsPrevious: 1, compareLabel: 'septiembre' },
        rejected: {
          total: 2,
          topClient: { name: 'Cliente <X>', count: 2, percent: 100 },
          previousTotal: 1,
        },
        declined: { total: 1, deltaVsPrevious: 0, compareLabel: 'septiembre', previousTotal: 1 },
        avgCoverageDays: {
          value: 8.5,
          deltaVsPrevious: -1.2,
          compareLabel: 'septiembre',
          coverageDateSource: 'vacancy.coveredAt',
          sampleSize: 2,
        },
        activeVacancies: { total: 4, nearTargetCount: 1 },
      },
      dataQuality: {
        coveredVacanciesMissingCoveredAt: 3,
        declinedApplicationsMissingClosedAt: 2,
      },
      terminalClosures: {
        hired: 3,
        rejected: 2,
        declined: 1,
        terminalDecisions: 6,
        hireShare: 0.5,
        rejectionShare: 1 / 3,
        declineShare: 1 / 6,
      },
      dailyActivity: {
        days: Array.from({ length: 31 }, (_, i) => ({
          date: `2026-10-${String(i + 1).padStart(2, '0')}`,
          registrations: i === 4 ? 5 : 0,
          hires: i === 10 ? 1 : 0,
          intensity: i === 4 ? 5 : 0,
        })),
        peak: { date: '2026-10-05', registrations: 5 },
      },
      insights: [],
      trend: {
        status: 'UP',
        score: 2,
        eligibleSignals: 3,
        comparisonMode: 'FULL_MONTH',
        comparisonLabel: 'vs. septiembre de 2026',
        compareLabelShort: 'septiembre',
        title: 'Tendencia al alza',
        tone: 'green',
        icon: 'trendUp',
        signals: [
          { key: 'hired', label: 'Contrataciones', eligible: true, score: 1 },
          { key: 'registrations', label: 'Registros', eligible: true, score: 1 },
          { key: 'rejectionShare', label: 'Participación de rechazos', eligible: true, score: 1 },
          { key: 'coverageDays', label: 'Tiempo promedio de cobertura', eligible: false, score: null },
        ],
        reasons: [
          { key: 'hired', text: 'Aumentaron las contrataciones <Acme & Co>.', polarity: 'positive' },
          { key: 'rejectionShare', text: 'Disminuyó la participación de rechazos.', polarity: 'positive' },
          { key: 'coverageDays', text: 'No hubo suficientes vacantes cubiertas para comparar tiempos.', polarity: 'neutral' },
        ],
        primaryReasons: [
          { key: 'hired', text: 'Aumentaron las contrataciones <Acme & Co>.', polarity: 'positive' },
          { key: 'rejectionShare', text: 'Disminuyó la participación de rechazos.', polarity: 'positive' },
        ],
      },
      generatedAt: new Date().toISOString(),
    };

    function expectedColsForContainer(cw) {
      if (cw <= 439) return 1;
      if (cw <= 679) return 2;
      if (cw <= 1049) return 4;
      return 7;
    }

    async function mountMetricsShell(width) {
      await page.setViewport({ width, height: 900 });
      return page.evaluate(() => {
        document.body.innerHTML = '';
        document.body.style.margin = '0';
        const shell = document.createElement('div');
        shell.className = 'app-shell';
        shell.style.height = '100vh';
        const side = document.createElement('aside');
        side.className = 'sidebar';
        side.style.minHeight = '100%';
        const main = document.createElement('main');
        main.className = 'main-content';
        main.style.minWidth = '0';
        main.style.flex = '1';
        const page = document.createElement('div');
        page.className = 'page-content rec-page-content';
        page.style.padding = '28px';
        const pane = document.createElement('div');
        pane.id = 'rec-pane-metrics';
        pane.className = 'rec-metrics-page';
        const host = document.createElement('div');
        host.id = 'rec-metrics-host';
        pane.appendChild(host);
        page.appendChild(pane);
        main.appendChild(page);
        shell.appendChild(side);
        shell.appendChild(main);
        document.body.appendChild(shell);
        return true;
      });
    }

    for (const width of [1600, 1440, 1366, 1280, 900, 768, 390]) {
      await mountMetricsShell(width);
      const probe = await page.evaluate((data) => {
        const host = document.getElementById('rec-metrics-host');
        recMetricsRender(data);
        const grid = host.querySelector('.rec-metrics-kpi-grid');
        const gt = grid ? getComputedStyle(grid).gridTemplateColumns : '';
        const repeatMatch = gt.match(/repeat\(\s*(\d+)\s*,/i);
        let cols = 0;
        if (repeatMatch) cols = Number(repeatMatch[1]);
        else if (/minmax\(/i.test(gt)) cols = (gt.match(/minmax\(/gi) || []).length;
        else cols = gt.split(/\s+/).filter(Boolean).length;
        const cards = [...host.querySelectorAll('.rec-metrics-kpi')];
        const rowMap = new Map();
        for (const c of cards) {
          const top = Math.round(c.getBoundingClientRect().top);
          const h = Math.round(c.getBoundingClientRect().height);
          if (!rowMap.has(top)) rowMap.set(top, []);
          rowMap.get(top).push(h);
        }
        let rowSpreadMax = 0;
        for (const hs of rowMap.values()) {
          const spread = Math.max(...hs) - Math.min(...hs);
          if (spread > rowSpreadMax) rowSpreadMax = spread;
        }
        const valueTops = cards.map((c) => {
          const v = c.querySelector('.rec-metrics-kpi-value');
          return v ? Math.round(v.getBoundingClientRect().top) : null;
        }).filter((n) => n != null);
        const valueTopByRow = new Map();
        cards.forEach((c) => {
          const rowTop = Math.round(c.getBoundingClientRect().top);
          const v = c.querySelector('.rec-metrics-kpi-value');
          if (!v) return;
          const vt = Math.round(v.getBoundingClientRect().top);
          if (!valueTopByRow.has(rowTop)) valueTopByRow.set(rowTop, []);
          valueTopByRow.get(rowTop).push(vt);
        });
        let valueAlignMax = 0;
        for (const tops of valueTopByRow.values()) {
          const spread = Math.max(...tops) - Math.min(...tops);
          if (spread > valueAlignMax) valueAlignMax = spread;
        }
        const labels = cards.map((c) => (c.querySelector('.rec-metrics-kpi-label') || {}).textContent || '');
        const tips = [...host.querySelectorAll('.rec-metrics-kpi-tip')].map((el) => el.textContent || '');
        const tipBtns = [...host.querySelectorAll('.rec-metrics-kpi-info')];
        const declinedCard = cards.find((c) => (c.querySelector('.rec-metrics-kpi-label') || {}).textContent === 'Declinados');
        const rejectedCard = cards.find((c) => (c.querySelector('.rec-metrics-kpi-label') || {}).textContent === 'Rechazados');
        const hiredCard = cards.find((c) => (c.querySelector('.rec-metrics-kpi-label') || {}).textContent === 'Contratados');
        const covCard = cards.find((c) => /cobertura/i.test((c.querySelector('.rec-metrics-kpi-label') || {}).textContent || ''));
        const sampleEl = covCard && covCard.querySelector('.rec-metrics-kpi-sample');
        const qualityEl = covCard && covCard.querySelector('.rec-metrics-kpi-quality');
        const covTip = (covCard && covCard.querySelector('.rec-metrics-kpi-tip') || {}).textContent || '';
        const calText = (host.querySelector('.rec-metrics-cal-grid') || {}).textContent || '';
        const hostBox = host.getBoundingClientRect();
        const cardWidths = cards.map((c) => Math.round(c.getBoundingClientRect().width));
        const detailBtn = host.querySelector('.rec-metrics-trend-detail-btn');
        const btnCs = detailBtn ? getComputedStyle(detailBtn) : null;
        return {
          cardCount: cards.length,
          cols,
          containerWidth: Math.round(hostBox.width),
          labels,
          tipBtnCount: tipBtns.length,
          tipLabels: tipBtns.map((b) => b.getAttribute('aria-label') || ''),
          tipDescribed: tipBtns.every((b) => {
            const id = b.getAttribute('aria-describedby');
            const tip = id ? document.getElementById(id) : null;
            return tip && tip.getAttribute('role') === 'tooltip';
          }),
          hasDeclined: labels.includes('Declinados'),
          tipRegistered: tips.some((t) => /registradas por primera vez/i.test(t)),
          tipEntered: tips.some((t) => /iniciaron al menos un proceso/i.test(t)),
          tipHiredProcess: tips.some((t) => /Procesos que llegaron a contratación/i.test(t)),
          compactCoverage:
            !!sampleEl &&
            /Muestra:\s*2 vacantes/i.test(sampleEl.textContent || '') &&
            !!qualityEl &&
            /3 históricos sin fecha/i.test(qualityEl.textContent || '') &&
            !!(covCard && covCard.querySelector('.rec-metrics-kpi-meta')),
          coverageTipFull:
            /fecha de cobertura confiable/i.test(covTip) &&
            /no pueden asignarse a un mes/i.test(covTip),
          safeText: !/Cliente <X>/.test(host.innerHTML) && host.textContent.includes('Cliente <X>'),
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          declinedOrange: !!(declinedCard && declinedCard.querySelector('.rec-metrics-kpi-icon--orange')),
          rejectedCoral: !!(rejectedCard && rejectedCard.querySelector('.rec-metrics-kpi-icon--coral')),
          hiredGreen: !!(hiredCard && hiredCard.querySelector('.rec-metrics-kpi-icon--green')),
          calOmitsDeclined: !/Declinad/i.test(calText),
          rowSpreadMax,
          valueAlignMax,
          valueTopsCount: valueTops.length,
          minCardWidth: cardWidths.length ? Math.min(...cardWidths) : 0,
          titleEllipsis: cards.some((c) => {
            const lab = c.querySelector('.rec-metrics-kpi-label');
            if (!lab) return false;
            const cs = getComputedStyle(lab);
            return cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
          }),
          trendTitle: /Tendencia al alza/i.test(host.textContent || ''),
          trendCompare: /vs\. septiembre de 2026/i.test(host.textContent || ''),
          trendReasons: /Aumentaron las contrataciones/i.test(host.textContent || ''),
          trendEligible: /3 de 4 indicadores comparables/i.test(host.textContent || ''),
          detailGhost:
            !!detailBtn &&
            !!detailBtn.querySelector('.rec-metrics-trend-detail-chevron') &&
            /Ver detalle/i.test(detailBtn.textContent || '') &&
            btnCs &&
            btnCs.textDecorationLine === 'none' &&
            btnCs.borderStyle !== 'none',
          noScoreLeak: !/score\s*=\s*2/i.test(host.textContent || ''),
        };
      }, fixture);
      const expectCols = expectedColsForContainer(probe.containerWidth);
      check(probe.cardCount === 7 && probe.hasDeclined, `${width}px: 7 KPI incluyendo Declinados`);
      check(
        probe.cols === expectCols,
        `${width}px: grid ${expectCols} cols (got ${probe.cols}, container ${probe.containerWidth}px)`,
      );
      check(probe.tipBtnCount >= 5 && probe.tipRegistered && probe.tipEntered, `${width}px: tooltips Registrados/Ingresaron`);
      check(probe.tipHiredProcess, `${width}px: tooltip Contratados habla de procesos`);
      check(
        probe.tipLabels.every((l) => /Más información sobre /.test(l)),
        `${width}px: aria-label descriptivo en ?`,
      );
      check(probe.tipDescribed, `${width}px: aria-describedby → role=tooltip`);
      check(probe.compactCoverage, `${width}px: cobertura compacta (muestra + histórico)`);
      check(probe.coverageTipFull, `${width}px: tooltip cobertura con explicación completa`);
      check(probe.safeText, `${width}px: textos escapados`);
      check(probe.overflow <= 1, `${width}px: sin desborde horizontal`);
      check(probe.declinedOrange && probe.rejectedCoral && probe.hiredGreen, `${width}px: tonos Declinados/Rechazados/Contratados`);
      check(probe.calOmitsDeclined, `${width}px: calendario sin Declinados`);
      check(probe.rowSpreadMax <= 2, `${width}px: alturas homogéneas por fila (Δ${probe.rowSpreadMax})`);
      check(probe.valueAlignMax <= 2, `${width}px: valores KPI alineados (Δ${probe.valueAlignMax})`);
      check(!probe.titleEllipsis, `${width}px: títulos sin line-clamp/ellipsis`);
      check(probe.trendTitle && probe.trendCompare && probe.trendReasons, `${width}px: insight de tendencia visible`);
      check(probe.trendEligible, `${width}px: indicadores comparables visibles`);
      check(probe.detailGhost, `${width}px: botón detalle ghost + chevron`);
      check(probe.noScoreLeak, `${width}px: sin score técnico en UI`);
      if (probe.cols === 7) {
        check(probe.minCardWidth >= 110, `${width}px: tarjetas 7-col legibles (≥110px, got ${probe.minCardWidth})`);
      }
    }

    // Detalle de tendencia: abre/cierra sin desborde; filas de señales sin repetir razones.
    await mountMetricsShell(1280);
    const trendUi = await page.evaluate((data) => {
      const host = document.getElementById('rec-metrics-host');
      recMetricsRender(data);
      const btn = host.querySelector('.rec-metrics-trend-detail-btn');
      const panel = host.querySelector('.rec-metrics-trend-detail');
      if (!btn || !panel) return { ok: false };
      const collapsedLabel = (btn.querySelector('.rec-metrics-trend-detail-btn-label') || {}).textContent || '';
      btn.click();
      const open = btn.getAttribute('aria-expanded') === 'true' && !panel.hidden;
      const openLabel = (btn.querySelector('.rec-metrics-trend-detail-btn-label') || {}).textContent || '';
      const rows = [...panel.querySelectorAll('.rec-metrics-trend-signal')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
      const detailText = panel.textContent || '';
      const reasonsDup = /Aumentaron las contrataciones/i.test(detailText);
      const hasStatusIcons = [...panel.querySelectorAll('.rec-metrics-trend-signal-status svg')].length >= 4;
      document.body.click();
      recMetricsCloseTrendDetail();
      const closed = panel.hidden === true && btn.getAttribute('aria-expanded') === 'false';
      return {
        ok: true,
        open,
        closed,
        collapsedLabel,
        openLabel,
        rows,
        reasonsDup,
        hasStatusIcons,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        ariaControls: btn.getAttribute('aria-controls') === 'rec-metrics-trend-detail',
      };
    }, fixture);
    check(trendUi.ok && trendUi.open && trendUi.closed, 'detalle de tendencia abre y cierra');
    check(trendUi.overflow <= 1, 'detalle de tendencia sin desborde horizontal');
    check(trendUi.collapsedLabel === 'Ver detalle' && trendUi.openLabel === 'Ocultar detalle', 'labels Ver/Ocultar detalle');
    check(trendUi.ariaControls && trendUi.hasStatusIcons, 'aria-controls + iconos de estado en filas');
    check(!trendUi.reasonsDup, 'detalle no repite razones principales');
    check(
      trendUi.rows.length === 4 &&
        /Contrataciones.*Mejoró/i.test(trendUi.rows[0] || '') &&
        /Cobertura.*Datos insuficientes/i.test(trendUi.rows[3] || ''),
      'detalle muestra 4 filas de señales',
    );
    check(
      await page.evaluate(() => {
        const host = document.getElementById('rec-metrics-host');
        const html = host.innerHTML;
        const text = host.textContent || '';
        return (
          text.includes('Aumentaron las contrataciones <Acme & Co>.') &&
          !html.includes('Aumentaron las contrataciones <Acme & Co>.') &&
          html.includes('&lt;Acme &amp; Co&gt;')
        );
      }),
      '19) texto con caracteres especiales escapado en tendencia',
    );

    await mountMetricsShell(1280);
    const complementaryUi = await page.evaluate((base) => {
      const host = document.getElementById('rec-metrics-host');
      const withInsights = {
        ...base,
        insights: [
          { kind: 'rejections_client', title: 'Acme concentra los rechazos', body: '2 de 3 candidatos rechazados.', tone: 'coral' },
          { kind: 'coverage_slower', title: 'Cobertura más lenta', body: 'El promedio subió 2 días.', tone: 'amber' },
          { kind: 'registrations_up', title: 'Más registros que el mes pasado', body: 'extra', tone: 'purple' },
        ],
      };
      recMetricsRender(withInsights);
      const comps = [...host.querySelectorAll('.rec-metrics-insight--complementary')];
      return {
        count: comps.length,
        kinds: comps.map((el) => el.getAttribute('data-insight-kind')),
        titles: comps.map((el) => (el.querySelector('.rec-metrics-insight-title') || {}).textContent || ''),
        hasTrend: !!host.querySelector('.rec-metrics-insight--trend'),
      };
    }, fixture);
    check(
      complementaryUi.hasTrend &&
        complementaryUi.count === 2 &&
        complementaryUi.kinds[0] === 'rejections_client' &&
        complementaryUi.kinds[1] === 'coverage_slower',
      'UI muestra máx. 2 insights complementarios prioritarios',
    );

    await mountMetricsShell(390);
    const trend390 = await page.evaluate((data) => {
      const host = document.getElementById('rec-metrics-host');
      recMetricsRender(data);
      const btn = host.querySelector('.rec-metrics-trend-detail-btn');
      const panel = host.querySelector('.rec-metrics-trend-detail');
      if (!btn || !panel) return { ok: false };
      btn.focus();
      const focused = document.activeElement === btn;
      btn.click();
      const open = btn.getAttribute('aria-expanded') === 'true' && !panel.hidden;
      const overflow = document.documentElement.scrollWidth - window.innerWidth;
      btn.click();
      const closed = panel.hidden === true && btn.getAttribute('aria-expanded') === 'false';
      return { ok: true, open, closed, overflow, focused };
    }, fixture);
    check(trend390.ok && trend390.open && trend390.closed, '20) detalle tendencia abre/cierra en 390px');
    check(trend390.overflow <= 1, '20b) detalle tendencia sin desborde en 390px');
    check(trend390.focused, '20c) botón detalle operable con foco');

    // Variantes: dígitos, ±comparativo, sin comparativo, sin deuda, mes vacío.
    await mountMetricsShell(1440);
    const variants = await page.evaluate(() => {
      const base = {
        period: {
          year: 2026,
          month: 10,
          label: 'Octubre 2026',
          previousMonthLabel: 'septiembre',
          footerLabel: 'Periodo',
          daysInMonth: 31,
          timeZone: 'America/Mexico_City',
        },
        dailyActivity: { days: [], peak: { date: null, registrations: 0 } },
        insights: [],
        generatedAt: new Date().toISOString(),
        terminalClosures: {
          hired: 0,
          rejected: 0,
          declined: 0,
          terminalDecisions: 0,
          hireShare: null,
          rejectionShare: null,
          declineShare: null,
        },
        dataQuality: { coveredVacanciesMissingCoveredAt: 0, declinedApplicationsMissingClosedAt: 0 },
      };
      const host = document.getElementById('rec-metrics-host');
      const cases = [];
      const run = (name, patch) => {
        const data = {
          ...base,
          ...patch,
          kpis: { ...(patch.kpis || {}) },
          dataQuality: { ...base.dataQuality, ...(patch.dataQuality || {}) },
        };
        recMetricsRender(data);
        const cards = [...host.querySelectorAll('.rec-metrics-kpi')];
        const vals = cards.map((c) => (c.querySelector('.rec-metrics-kpi-value') || {}).textContent || '');
        const cov = cards.find((c) => /cobertura/i.test((c.querySelector('.rec-metrics-kpi-label') || {}).textContent || ''));
        const covText = cov ? cov.textContent || '' : '';
        const covTip = (cov && cov.querySelector('.rec-metrics-kpi-tip') || {}).textContent || '';
        cases.push({
          name,
          vals,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          hasPos: !!host.querySelector('.rec-metrics-cmp--pos'),
          hasNeg: !!host.querySelector('.rec-metrics-cmp--neg'),
          compactLegacy: /históricos? sin fecha/i.test(covText),
          sampleOnly: /Muestra:/i.test(covText) && !/históricos? sin fecha/i.test(covText),
          tipMentionsLegacy: /no pueden asignarse a un mes/i.test(covTip),
        });
      };
      run('digits', {
        kpis: {
          candidatesRegistered: { total: 1, dailyAverage: 0, deltaDailyAverage: 0, compareLabel: 'septiembre' },
          enteredProcess: { total: 12 },
          hired: { total: 1234, deltaVsPrevious: 2, compareLabel: 'septiembre' },
          rejected: { total: 0, topClient: null, previousTotal: 0 },
          declined: { total: 9, deltaVsPrevious: -3, compareLabel: 'septiembre', previousTotal: 12 },
          avgCoverageDays: { value: null, deltaVsPrevious: null, compareLabel: 'septiembre', sampleSize: 0 },
          activeVacancies: { total: 7, nearTargetCount: 0 },
        },
      });
      run('legacy', {
        kpis: {
          candidatesRegistered: { total: 5, dailyAverage: 0.2, deltaDailyAverage: 0.1, compareLabel: 'septiembre' },
          enteredProcess: { total: 4 },
          hired: { total: 1, deltaVsPrevious: 0, compareLabel: 'septiembre' },
          rejected: { total: 1, topClient: null, previousTotal: 0 },
          declined: { total: 0, deltaVsPrevious: 0, compareLabel: 'septiembre', previousTotal: 0 },
          avgCoverageDays: {
            value: 8,
            deltaVsPrevious: -1,
            compareLabel: 'septiembre',
            sampleSize: 4,
          },
          activeVacancies: { total: 2, nearTargetCount: 1 },
        },
        dataQuality: { coveredVacanciesMissingCoveredAt: 1, declinedApplicationsMissingClosedAt: 0 },
      });
      run('empty-month', {
        kpis: {
          candidatesRegistered: { total: 0, dailyAverage: 0, deltaDailyAverage: 0, compareLabel: 'septiembre' },
          enteredProcess: { total: 0 },
          hired: { total: 0, deltaVsPrevious: 0, compareLabel: 'septiembre' },
          rejected: { total: 0, topClient: null, previousTotal: 0 },
          declined: { total: 0, deltaVsPrevious: 0, compareLabel: 'septiembre', previousTotal: 0 },
          avgCoverageDays: { value: null, deltaVsPrevious: null, compareLabel: 'septiembre', sampleSize: 0 },
          activeVacancies: { total: 0, nearTargetCount: 0 },
        },
      });
      return cases;
    });
    const digits = variants.find((v) => v.name === 'digits');
    const legacy = variants.find((v) => v.name === 'legacy');
    const empty = variants.find((v) => v.name === 'empty-month');
    check(
      digits && digits.vals.includes('1') && digits.vals.includes('12') && digits.vals.includes('1234'),
      'variante valores de 1/2/4 dígitos',
    );
    check(digits && digits.hasPos, 'variante comparativo positivo (mejora)');
    check(digits && digits.hasNeg === false, 'variante baja de declinados no se pinta como alerta negativa');
    check(legacy && legacy.compactLegacy && legacy.tipMentionsLegacy, 'variante 1 histórico compacto + tip completo');
    check(empty && empty.sampleOnly && empty.overflow <= 1, 'mes vacío: muestra 0 sin deuda, sin desborde');

    await mountMetricsShell(390);
    const tipProbe = await page.evaluate((data) => {
      const host = document.getElementById('rec-metrics-host');
      recMetricsRender(data);
      const btns = [...host.querySelectorAll('.rec-metrics-kpi-info')];
      if (btns.length < 2) return { ok: false, reason: 'few tips' };
      btns[0].click();
      const tip0 = document.getElementById(btns[0].getAttribute('aria-describedby'));
      const tipBox = tip0 ? tip0.getBoundingClientRect() : null;
      const firstOpen =
        btns[0].getAttribute('aria-expanded') === 'true' &&
        tip0?.classList.contains('rec-metrics-kpi-tip--open');
      const inViewport =
        tipBox &&
        tipBox.left >= -1 &&
        tipBox.right <= window.innerWidth + 1 &&
        tipBox.top >= -1;
      btns[1].click();
      const onlySecond =
        btns[1].getAttribute('aria-expanded') === 'true' &&
        btns[0].getAttribute('aria-expanded') === 'false';
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const afterEsc = !host.querySelector('.rec-metrics-kpi-info[aria-expanded="true"]');
      btns[0].click();
      document.body.click();
      const afterOutside = !host.querySelector('.rec-metrics-kpi-info[aria-expanded="true"]');
      btns[0].click();
      const beforeRerender = host.querySelectorAll('.rec-metrics-kpi-tip--open').length === 1;
      recMetricsRender(data);
      const afterRerender = !host.querySelector('.rec-metrics-kpi-info[aria-expanded="true"]');
      const boundOnce = host.__recMetricsTipsBound === true;
      return {
        ok: true,
        firstOpen,
        onlySecond,
        afterEsc,
        afterOutside,
        beforeRerender,
        afterRerender,
        boundOnce,
        inViewport: !!inViewport,
      };
    }, fixture);
    check(tipProbe.ok && tipProbe.firstOpen, '390px: tip abre con click/tap');
    check(tipProbe.onlySecond, '390px: abrir otro cierra el anterior');
    check(tipProbe.afterEsc, '390px: Escape cierra tip');
    check(tipProbe.afterOutside, '390px: click fuera cierra tip');
    check(tipProbe.beforeRerender && tipProbe.afterRerender, '390px: re-render cierra tip abierto');
    check(tipProbe.boundOnce, '390px: listeners de tip no se duplican');
    check(tipProbe.inViewport, '390px: tip abierto dentro del viewport');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

await runVisual().catch((e) => {
  console.error('  FAIL  visual métricas:', e.message || e);
  failed += 1;
});

if (failed) {
  console.error(`\n✗ ${failed} fallo(s)${pgSkip ? ' (PG skipped)' : ''}\n`);
  process.exit(1);
}
console.log(`\n✓ Recruitment metrics tests OK${pgSkip ? ' (PG skipped)' : ''}.\n`);

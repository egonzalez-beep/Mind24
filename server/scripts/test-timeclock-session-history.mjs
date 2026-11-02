/**
 * Historial de jornadas — calendario admin (unit + route estático).
 * Ejecutar: node server/scripts/test-timeclock-session-history.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  localDateKey,
  localMidnightUtc,
  utcRangeForLocalDateInclusive,
  groupSessionsByLocalDay,
  buildWeekSummary,
  buildConnectionSummaryForSessions,
  sanitizeSessionRow,
  weekRangeMonday,
  formatWeekRangeLabel,
  sessionsWithCheckInInLocalWeek,
} = await import('../src/services/remoteWorkSessionHistory.service.js');

const indexHtml = fs.readFileSync(path.join(root, '..', 'index.html'), 'utf8');
const historySvc = fs.readFileSync(
  path.join(root, 'src/services/remoteWorkSessionHistory.service.js'),
  'utf8',
);
const routesJs = fs.readFileSync(
  path.join(root, 'src/routes/timeclock.org.routes.js'),
  'utf8',
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

console.log('\n=== Timeclock — historial jornadas (unit) ===\n');

const tz = 'America/Mexico_City';
const lateUtc = new Date('2026-10-16T05:30:00.000Z');
check(localDateKey(lateUtc, tz) === '2026-10-15', 'TZ: check-in UTC cae en día local correcto');

const range = utcRangeForLocalDateInclusive('2026-10-01', '2026-10-31', tz);
check(range.start instanceof Date && range.end instanceof Date, 'rango UTC para mes local');
check(range.start < range.end, 'rango start < end');

const now = new Date('2026-10-15T20:00:00.000Z');
const closed = {
  id: 's1',
  checkInAt: new Date('2026-10-15T13:57:00.000Z'),
  checkOutAt: new Date('2026-10-15T15:19:00.000Z'),
  status: 'completed',
  signalTelemetryStatus: 'full',
  signalDurationSeconds: 3600,
  signalSampleCount: 10,
  lastHeartbeatAt: new Date('2026-10-15T15:00:00.000Z'),
  lastVisibilityState: 'visible',
};
const open = {
  id: 's2',
  checkInAt: new Date('2026-10-15T18:00:00.000Z'),
  checkOutAt: null,
  status: 'open',
  signalTelemetryStatus: 'partial',
  signalSampleCount: 2,
  signalTrackingStartedAt: new Date('2026-10-15T19:00:00.000Z'),
  signalDurationSeconds: 600,
  lastHeartbeatAt: new Date('2026-10-15T19:30:00.000Z'),
  lastVisibilityState: 'visible',
};
const days = groupSessionsByLocalDay([closed, open], tz, now);
check(days['2026-10-15'].sessionCount === 2, 'múltiples sesiones mismo día');
check(days['2026-10-15'].hasOpen === true, 'día con jornada abierta');
check(days['2026-10-15'].totalDurationSec > 0, 'duración total diaria');

const rowOpen = sanitizeSessionRow(open, now);
check(rowOpen.isOpen === true, 'jornada abierta flag');
check(rowOpen.durationSec != null, 'duración actual jornada abierta');

const week = buildWeekSummary([closed, open], tz, '2026-10-15', now);
check(week.sessionCount === 2, 'resumen semanal cuenta sesiones');
check(week.totalDurationSec > 0, 'resumen semanal duración total');
check(week.averageDurationSec != null, 'promedio por jornada');

const mon = weekRangeMonday('2026-10-15', tz);
check(mon.weekStart <= '2026-10-15' && mon.weekEnd >= '2026-10-15', 'semana contiene día ref');

const monthExtra = {
  id: 's3',
  checkInAt: new Date('2026-10-01T15:00:00.000Z'),
  checkOutAt: new Date('2026-10-01T23:00:00.000Z'),
  status: 'completed',
  signalTelemetryStatus: 'full',
  signalDurationSeconds: 7200,
  signalSampleCount: 20,
  lastHeartbeatAt: new Date('2026-10-01T22:00:00.000Z'),
  lastVisibilityState: 'visible',
};
const monthSessions = [closed, open, monthExtra];
const monthSummary = buildConnectionSummaryForSessions(
  monthSessions,
  tz,
  '2026-10-01',
  '2026-10-31',
  now,
);
const weekSessions = sessionsWithCheckInInLocalWeek(monthSessions, tz, '2026-10-15');
const weekConn = buildConnectionSummaryForSessions(
  weekSessions,
  tz,
  week.weekStart,
  week.weekEnd,
  now,
);
check(weekConn.sessionCountTotal === 2, 'ficha semanal: solo jornadas de la semana');
check(monthSummary.sessionCountTotal === 3, 'resumen mensual: más jornadas que la semana');
check(
  monthSummary.totalSignalDurationSec !== weekConn.totalSignalDurationSec ||
    monthSummary.sessionCountTotal > weekConn.sessionCountTotal,
  'ficha semanal distinta del resumen mensual',
);

const zeroDur = {
  id: 'z',
  checkInAt: new Date('2026-10-16T15:00:00.000Z'),
  checkOutAt: new Date('2026-10-16T15:00:00.000Z'),
  status: 'completed',
  signalTelemetryStatus: 'no_data',
  signalSampleCount: 0,
};
const weekWithZero = buildConnectionSummaryForSessions(
  [closed, zeroDur],
  tz,
  week.weekStart,
  week.weekEnd,
  now,
);
check(weekWithZero.sessionCountTotal === 1, 'duración 0 excluida del denominador Y');

const noFullWeek = buildConnectionSummaryForSessions(
  [open],
  tz,
  week.weekStart,
  week.weekEnd,
  now,
);
check(noFullWeek.sessionCountWithFullTelemetry === 0, 'semana sin sesiones full');
check(noFullWeek.overallConnectionEffectivePercent == null, 'cero full → conexión null (UI —)');

const mixedTelemetry = [
  {
    checkInAt: new Date('2026-10-10T15:00:00.000Z'),
    checkOutAt: new Date('2026-10-10T23:00:00.000Z'),
    signalTelemetryStatus: 'no_data',
    signalSampleCount: 0,
  },
  {
    checkInAt: new Date('2026-10-11T15:00:00.000Z'),
    checkOutAt: new Date('2026-10-11T23:00:00.000Z'),
    signalTelemetryStatus: 'partial',
    signalTrackingStartedAt: new Date('2026-10-11T20:00:00.000Z'),
    signalSampleCount: 2,
    signalDurationSeconds: 900,
    lastHeartbeatAt: new Date('2026-10-11T22:00:00.000Z'),
    lastVisibilityState: 'visible',
  },
];
const chartMix = buildConnectionSummaryForSessions(
  mixedTelemetry,
  tz,
  '2026-10-01',
  '2026-10-31',
  now,
);
const dayNo = chartMix.chartDaily.find((r) => r.date === '2026-10-10');
const dayPartial = chartMix.chartDaily.find((r) => r.date === '2026-10-11');
check(dayNo && dayNo.noSignalData && dayNo.signalSec == null, 'día no_data sin barra señal');
check(dayPartial && dayPartial.partialOnly && dayPartial.signalSec == null, 'día partial sin barra señal');

const fullPair = [
  {
    checkInAt: new Date('2026-10-12T15:00:00.000Z'),
    checkOutAt: new Date('2026-10-12T23:00:00.000Z'),
    signalTelemetryStatus: 'full',
    signalTrackingStartedAt: new Date('2026-10-12T15:00:00.000Z'),
    signalDurationSeconds: 3600,
    signalSampleCount: 8,
    lastHeartbeatAt: new Date('2026-10-12T22:00:00.000Z'),
    lastVisibilityState: 'visible',
  },
  {
    checkInAt: new Date('2026-10-13T15:00:00.000Z'),
    checkOutAt: new Date('2026-10-13T23:00:00.000Z'),
    signalTelemetryStatus: 'full',
    signalTrackingStartedAt: new Date('2026-10-13T15:00:00.000Z'),
    signalDurationSeconds: 3600,
    signalSampleCount: 8,
    lastHeartbeatAt: new Date('2026-10-13T22:00:00.000Z'),
    lastVisibilityState: 'visible',
  },
];
const fullSummary = buildConnectionSummaryForSessions(
  fullPair,
  tz,
  '2026-10-01',
  '2026-10-31',
  now,
);
check(
  fullSummary.sessionCountWithFullTelemetry === fullSummary.sessionCountTotal,
  'muestra completa → X === Y',
);

console.log('\n=== Timeclock — etiquetas semana (unit) ===\n');

const crossMonthLbl = formatWeekRangeLabel('2025-11-25', tz);
check(/nov/i.test(crossMonthLbl) && /dic/i.test(crossMonthLbl), 'semana cruzando mes (nov–dic)');
check(formatWeekRangeLabel('2025-10-20', tz) === '20–26 oct', 'misma semana compacta oct');
const crossYear = weekRangeMonday('2026-01-01', tz);
const crossYearLbl = formatWeekRangeLabel(crossYear.weekStart, tz);
check(/dic.*ene|ene.*dic/i.test(crossYearLbl), 'semana cruzando año (dic–ene)');

console.log('\n=== Timeclock — historial (estático) ===\n');

check(/employees\/:id\/sessions/.test(routesJs), 'route GET sessions');
check(/listEmployeeSessionsHistory/.test(routesJs), 'route usa listEmployeeSessionsHistory');
check(/weekConnectionSummary/.test(historySvc), 'payload incluye weekConnectionSummary');
check(/weekConnectionSummary/.test(indexHtml), 'frontend usa weekConnectionSummary');
check(/weekConnectionSummary[\s\S]*tcRenderHistoryKpiStrip|tcRenderHistoryKpiStrip[\s\S]*weekConnectionSummary/.test(indexHtml), 'KPI strip desde resumen semanal');
check(/connectionSummary[\s\S]*tcConnChartRender|tcRenderConnectionTrend[\s\S]*connectionSummary/.test(indexHtml), 'gráfica mensual conservada');
check(/Historial de jornadas/.test(indexHtml), 'toggle historial copy');
check(/tcToggleHistoryPanel/.test(indexHtml), 'abrir/cerrar historial flotante');
check(/tc-history-dialog hidden/.test(indexHtml), 'dialog colapsado por defecto');
check(/tc-history-backdrop/.test(indexHtml), 'backdrop historial');
check(/tc-jornada-meta/.test(indexHtml) && /id="tc-history-toggle"/.test(indexHtml), 'historial dentro del bloque Jornada');
check(!/tc-jornada-header-actions/.test(indexHtml), 'sin historial en esquina superior');
check(!/tc-history-panel/.test(indexHtml), 'sin panel inline en tarjeta');
check(/tc-history-day-panel/.test(indexHtml), 'detalle del día en flujo del modal');
check(!/tc-history-pinned/.test(indexHtml), 'sin panel absoluto sobre calendario');
check(/tcHistoryPinnedDay/.test(indexHtml), 'estado detalle por click');
check(/aria-controls="tc-history-dialog"/.test(indexHtml), 'aria-controls dialog');
check(/assertWorkforceEmployeeInOrg/.test(historySvc), 'historial valida empleado en org');
check(/\/employees\/.*\/sessions/.test(indexHtml), 'frontend fetch sessions');
check(/Duración de jornada/.test(indexHtml), 'wording duración de jornada');
check(!/Tiempo de conexión/.test(indexHtml), 'no label redundante Tiempo de conexión');
check(/Tiempo con señal/.test(indexHtml), 'historial muestra tiempo con señal');
check(/tcRenderHistoryKpiStrip|tc-history-kpi-strip/.test(indexHtml), 'ficha compacta KPI conexión');
check(/Tendencia de conexión/.test(indexHtml), 'desplegable tendencia de conexión');
check(!/Resumen de conexión/.test(indexHtml), 'sin título resumen de conexión');
check(/tcRenderConnectionTrend/.test(indexHtml), 'render solo tendencia');
check(!/Jornadas con medición completa/.test(indexHtml), 'sin KPI grande medición completa');
check(/Basado en .* jornadas con datos de conexión/.test(indexHtml), 'nota muestra parcial conexión');
check(/fullN<totalN/.test(indexHtml), 'nota solo si X < Y');
check(/fullN>0\?c\.overallConnectionEffectivePercent:null/.test(indexHtml), 'X=0 → conexión —');
check(!/Cobertura de conexión vs\. jornada esperada/.test(indexHtml), 'sin cobertura vs esperada en UI');
check(!/solo medición completa/.test(indexHtml), 'sin texto solo medición completa');
check(/Datos parciales de señal/.test(indexHtml), 'copy partial en gráfica');
check(/Sin datos de señal/.test(indexHtml), 'copy no_data en gráfica');
check(/tcConnChartSignalGapLabel/.test(indexHtml), 'helper gap señal gráfica');
check(/noSignalData/.test(indexHtml), 'frontend reconoce noSignalData');
check(/tcHistorySessionMetricsHtml/.test(indexHtml), 'detalle sesión estructurado');
check(!/tcHistorySignalExtraHtml/.test(indexHtml), 'sin helper detalle antiguo');
check(!/function tcHistorySessionMetricsHtml[\s\S]*?TC_SIGNAL_CONN_HELP/.test(indexHtml), 'sin párrafo ayuda en detalle historial');
check(/tcRefreshHistory/.test(indexHtml) && /aria-label="Actualizar historial"/.test(indexHtml), 'botón refresh historial');
check(/tcHistoryLoadSeq|tcHistoryFetchAbort/.test(indexHtml), 'secuencia/abort refresh');
check(/tcHistoryRefreshInFlight/.test(indexHtml), 'inFlight refresh');
check(/tcApplyHistoryPayload[\s\S]*scrollTop[\s\S]*trendOpen/.test(indexHtml), 'refresh conserva scroll y details');
check(/tcRefreshHistory[\s\S]*AbortError[\s\S]*return/.test(indexHtml), 'abort no muestra error refresh');
check(/payload===null[\s\S]*return/.test(indexHtml), 'respuesta vieja ignorada');
check(/tcCloseHistoryDialog[\s\S]*tcHistoryFetchAbort[\s\S]*abort/.test(indexHtml), 'cerrar modal aborta fetch');
check(/tc-history-dialog-body[\s\S]*overflow-y:auto/.test(indexHtml), 'scroll único en cuerpo modal');
check(!/tc-history-day-panel[\s\S]{0,200}overflow-y:auto/.test(indexHtml), 'sin scroll anidado en panel día');
check(/tcConnChartRows/.test(indexHtml) && /tcConnChartShowTip/.test(indexHtml), 'tooltips gráfica');
check(/tcFmtWeekRangeLabel/.test(indexHtml), 'etiquetas semana legibles');
check(/limit=tcConnChartMode/.test(indexHtml), 'límite barras diario/semanal');
check(/Promedio por jornada/.test(indexHtml), 'promedio por jornada en resumen semanal');
check(/Promedio diario jornada/.test(indexHtml), 'promedio diario jornada en KPI');
check(/tc-cal-prev/.test(indexHtml) && /tc-cal-next/.test(indexHtml), 'navegación mes');
check(/aria-label.*Mes anterior/.test(indexHtml), 'aria mes anterior');
check(/tc-cal-popover/.test(indexHtml), 'popover hover desktop');
check(/tc-cal-viewport/.test(indexHtml) && /tc-cal-pane/.test(indexHtml), 'transición local calendario');
check(/tcHistorySlideDir/.test(indexHtml), 'dirección slide mes');
check(/tc-cal-loading/.test(indexHtml) && /tcShowCalLoadingDelayed/.test(indexHtml), 'loading local sin blanquear');
check(/tc-jornada-card-header--compact/.test(indexHtml) && /tcCloseJornada/.test(indexHtml), 'header solo cierra jornada');

const publicHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
check(indexHtml === publicHtml, 'index.html y server/public/index.html idénticos');

console.log(failed === 0 ? '\n✓ Timeclock session history tests OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

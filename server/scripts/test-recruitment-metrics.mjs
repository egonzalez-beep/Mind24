/**
 * Recruitment — métricas mensuales.
 * node server/scripts/test-recruitment-metrics.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = fs.readFileSync(path.join(rootDir, '../index.html'), 'utf8');
const routes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const svcSrc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentMetrics.service.js'), 'utf8');
const terminalSrc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentMetricsTerminal.service.js'),
  'utf8',
);

const {
  getLocalMonthRange,
  shiftMonth,
  parseMetricsMonthInput,
} = await import('../src/services/recruitmentMetrics.service.js');
const { MIND24_DEFAULT_IANA_TIMEZONE } = await import('../src/services/organizationTimezone.service.js');
const {
  TERMINAL_MIN_DWELL_MS,
  consolidateTerminalApplications,
  effectiveStageKeyAt,
  qualifyTerminalApplicationForMonth,
  rejectedTopClientFromConsolidated,
} = await import('../src/services/recruitmentMetricsTerminal.service.js');

let failed = 0;
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
check(/coverageDateSource/.test(svcSrc), 'documentación V1 cobertura');
check(/consolidateTerminalApplications/.test(svcSrc), 'KPIs usan consolidación terminal');
check(!/countStageMovesToKey/.test(svcSrc), 'sin conteo bruto StageEvent en métricas');
check(/consolidatedHiredCurr/.test(svcSrc), 'calendario usa contrataciones consolidadas');
check(/rejectedTopClientFromConsolidated/.test(svcSrc), 'insights/rechazos consolidados');
check(/rec-tab-metrics/.test(indexHtml), 'pestaña Métricas');
check(/recMetricsLoad/.test(indexHtml), 'carga métricas frontend');
check(/rec-metrics-cal-grid/.test(indexHtml), 'calendario actividad diaria');
check(/Insights del mes/.test(indexHtml), 'panel insights');
check(/recMetricsChangeMonth/.test(indexHtml), 'navegación mensual');
check(/Ingresaron a proceso/.test(indexHtml), 'label Ingresaron a proceso');
check(/rec-metrics-cmp--pos/.test(indexHtml), 'color semántico positivo');

console.log('\n=== Helpers de periodo ===\n');

const oct = getLocalMonthRange(2026, 10, MIND24_DEFAULT_IANA_TIMEZONE);
check(oct.daysInMonth === 31, 'octubre 2026 tiene 31 días');
check(oct.fromKey === '2026-10-01', 'inicio calendario org TZ');
check(oct.toKey === '2026-10-31', 'fin calendario org TZ');
check(shiftMonth(2026, 1, -1).month === 12 && shiftMonth(2026, 1, -1).year === 2025, 'mes anterior enero');

try {
  parseMetricsMonthInput(2026, 13);
  check(false, 'mes 13 debe fallar');
} catch {
  check(true, 'validación mes');
}

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

console.log(failed ? `\n${failed} fallo(s)\n` : '\nTodo OK\n');
process.exit(failed ? 1 : 0);

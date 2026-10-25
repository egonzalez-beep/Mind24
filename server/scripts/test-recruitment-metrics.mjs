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

const {
  getLocalMonthRange,
  shiftMonth,
  parseMetricsMonthInput,
} = await import('../src/services/recruitmentMetrics.service.js');
const { MIND24_DEFAULT_IANA_TIMEZONE } = await import('../src/services/organizationTimezone.service.js');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

console.log('\n=== Recruitment — métricas (estático) ===\n');

check(/router\.get\('\/metrics'/.test(routes), 'GET /metrics');
check(/getRecruitmentMetricsForRequest/.test(routes), 'servicio métricas en routes');
check(!/EVERGREEN_COVERAGE_DAYS/.test(svcSrc), 'sin heurística evergreen en cobertura');
check(/localDateKey/.test(svcSrc) && /resolveOrganizationIanaTimezone/.test(svcSrc), 'métricas en TZ organización');
check(/coverageDateSource/.test(svcSrc), 'documentación V1 cobertura');
check(/rec-tab-metrics/.test(indexHtml), 'pestaña Métricas');
check(/recMetricsLoad/.test(indexHtml), 'carga métricas frontend');
check(/rec-metrics-cal-grid/.test(indexHtml), 'calendario actividad diaria');
check(/Insights del mes/.test(indexHtml), 'panel insights');
check(/recMetricsChangeMonth/.test(indexHtml), 'navegación mensual');

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

console.log(failed ? `\n${failed} fallo(s)\n` : '\nTodo OK\n');
process.exit(failed ? 1 : 0);

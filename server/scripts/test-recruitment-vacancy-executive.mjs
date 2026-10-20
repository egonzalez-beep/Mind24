/**
 * Recruitment 1B.5 — tablero ejecutivo en detalle de vacante.
 * node server/scripts/test-recruitment-vacancy-documents.mjs
 * node server/scripts/test-recruitment-vacancy-executive.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');
const vacancySvc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentVacancy.service.js'), 'utf8');

const {
  computeCoveragePercent,
  computeRejectionRatePercent,
  formatTargetObjectiveLabel,
  calendarDayDiff,
  buildExecutiveSnapshot,
  localTodayDateKey,
} = await import('../src/services/recruitmentVacancy.service.js');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

console.log('\n=== Recruitment 1B.5 — fórmulas ===\n');

check(computeCoveragePercent(20, 50) === 40, 'cobertura 20/50 = 40%');
check(computeCoveragePercent(60, 50) === 100, 'cobertura cap 100%');
check(computeRejectionRatePercent(2, 25) === 8, 'rechazo 2/25 = 8%');
check(computeRejectionRatePercent(0, 0) === null, 'rechazo sin total → null');
check(formatTargetObjectiveLabel(null) === 'Sin fecha objetivo', 'sin fecha objetivo');
check(formatTargetObjectiveLabel('2026-12-01', '2026-11-15').includes('restantes'), 'objetivo futuro');
check(formatTargetObjectiveLabel('2026-11-15', '2026-11-15') === 'Vence hoy', 'objetivo hoy');
check(formatTargetObjectiveLabel('2026-11-10', '2026-11-15').includes('Vencida hace'), 'objetivo vencida');
check(calendarDayDiff('2026-11-01', '2026-11-25') === 24, 'días calendario');

const snap = buildExecutiveSnapshot(
  {
    positionsTotal: 50,
    openedAt: new Date('2026-10-01T18:00:00.000Z'),
    targetCoverageDate: new Date(Date.UTC(2026, 11, 1)),
  },
  { total: 25, hired: 20, inProcess: 18, rejected: 2, finalists: 1 },
  '2026-11-15',
);
check(snap.coveragePercent === 40, 'snapshot cobertura');
check(snap.rejectionDisplay === '8%', 'snapshot rechazo');
check(snap.inProcess === 18, 'snapshot en proceso');

console.log('\n=== Recruitment 1B.5 — UI estática ===\n');

check(/rec-detail-edit-btn/.test(indexHtml), 'botón lápiz editar');
check(/aria-label="Editar vacante"/.test(indexHtml), 'aria-label editar');
check(!/rec-btn-edit[\s\S]*Editar/.test(indexHtml.match(/modal-rec-vacancy-detail[\s\S]*?modal-evaluacion/)?.[0] || ''), 'sin botón Editar texto');
check(/rec-detail-toolbar/.test(indexHtml), 'toolbar separada de cierre');
check(/rec-exec-kpis/.test(indexHtml), 'micro-KPIs');
check(/rec-kpi-coverage-bar/.test(indexHtml), 'barra cobertura');
check(/rec-detail-funnel/.test(indexHtml), 'distribución funnel');
check(/rec-detail-jd-trigger/.test(indexHtml), 'acordeón JD');
check(/recDetailResetAccordions/.test(indexHtml), 'JD cerrado al abrir');
check(/buildStageDistributionForVacancy|stageDistribution/.test(vacancySvc), 'backend stage distribution');
check(/buildExecutiveSnapshot/.test(vacancySvc), 'backend executive snapshot');
check(/rejected/.test(vacancySvc.match(/emptyApplicationSummary[\s\S]*?}/)?.[0] || ''), 'summary rejected');
check(/groupBy/.test(vacancySvc), 'agregación groupBy sin N+1 por KPI');

console.log('\n=== Regresiones ===\n');

function runRegression(script) {
  const r = spawnSync(process.execPath, [path.join('scripts', script)], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error((r.stdout || '') + (r.stderr || ''));
    check(false, script);
  } else {
    check(true, script);
  }
}

runRegression('test-recruitment-vacancies-frontend.mjs');
runRegression('test-recruitment-vacancy-documents.mjs');
runRegression('test-recruitment-backend.mjs');

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment vacancy executive 1B.5 tests OK.\n');

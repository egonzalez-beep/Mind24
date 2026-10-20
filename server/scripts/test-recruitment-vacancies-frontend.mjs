/**
 * Recruitment vacantes UI — 1B.1 / 1B.2 / 1B.3 / 1B.4 (estático).
 * node server/scripts/test-recruitment-vacancies-frontend.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');
const vacancyService = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentVacancy.service.js'),
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

const carouselBlock =
  indexHtml.match(/function recRenderCarousel[\s\S]*?function recSelectVacancy/)?.[0] || '';
const workspaceBlock =
  indexHtml.match(/id="rec-selected-panel"[\s\S]*?rec-pipeline-slot/)?.[0] || '';
const modalCssBlock = indexHtml.match(/\/\* ══════ MODALS ══════ \*\/[\s\S]*?\/\* ══════/)?.[0] || '';

console.log('\n=== Recruitment 1B.1 — base ===\n');

check(/view-dash-recruitment/.test(indexHtml), 'vista dash-recruitment');
check(/rec-section-top/.test(indexHtml) && !/rec-page-head/.test(indexHtml), 'sin encabezado duplicado en body');
check(/type="date" id="rec-form-opened"/.test(indexHtml), 'fecha apertura solo día');
check(/modal-rec-vacancy/.test(indexHtml) && /recSubmitVacancy/.test(indexHtml), 'modal crear/editar vacante');
check(/\+ Nueva vacante/.test(indexHtml), 'CTA nueva vacante');

console.log('\n=== Recruitment 1B.2 / 1B.3 — workspace limpio ===\n');

check(/rec-pipeline-slot/.test(workspaceBlock), 'slot pipeline reservado');
check(!/rec-ws-pulse/.test(workspaceBlock), 'sin pulso KPI en workspace');
check(!/recRenderWorkspacePulse/.test(indexHtml), 'sin render KPI workspace');
check(/Pipeline ·/.test(indexHtml.match(/function recRenderSelectedPanel[\s\S]*?^}/m)?.[0] || ''), 'kicker Pipeline · vacante');
check(!/rec-ws-jd-body/.test(workspaceBlock), 'JD fuera del workspace');
check(!/rec-ws-notes-body/.test(workspaceBlock), 'notas fuera del workspace');

console.log('\n=== Recruitment 1B.3 — cards vs detalle ===\n');

check(/rec-vac-detail-btn/.test(carouselBlock), 'icono ver detalle en card');
check(/Ver detalle de vacante/.test(carouselBlock), 'aria-label detalle');
check(/stopPropagation/.test(indexHtml.match(/function recOpenVacancyDetail[\s\S]*?^}/m)?.[0] || ''), 'detalle no propaga click');
check(/recOpenVacancyDetail/.test(carouselBlock), 'icono abre detalle');
check(/recSelectVacancy/.test(carouselBlock), 'card selecciona vacante');
check(!/rec-vac-stats/.test(carouselBlock), 'cards sin métricas');
check(/detailVacancyId/.test(indexHtml), 'estado detalle independiente');
check(/modal-rec-vacancy-detail/.test(indexHtml), 'modal detalle de vacante');
check(/rec-detail-jd/.test(indexHtml) && /rec-detail-notes/.test(indexHtml), 'JD y notas en detalle');
check(/recEditFromDetail/.test(indexHtml), 'editar desde detalle reutiliza formulario');
check(
  /keepSelection=vacancyId\?st\.selectedId/.test(indexHtml.match(/function recSubmitVacancy[\s\S]*?^}/m)?.[0] || ''),
  'guardar edición mantiene selección operativa',
);

console.log('\n=== Recruitment 1B.3 — glass scoped ===\n');

check(/\.modal-overlay\.rec-modal-glass/.test(indexHtml), 'clase glass recruitment');
check(/modal-rec-vacancy" class="modal-overlay rec-modal-glass/.test(indexHtml), 'glass en modal vacante');
check(/modal-rec-vacancy-detail" class="modal-overlay rec-modal-glass/.test(indexHtml), 'glass en modal detalle');
check(/rec-modal-scroll/.test(indexHtml), 'scrollbar fina scoped');
check(!/backdrop-filter:blur\(14px\)/.test(modalCssBlock.replace(/\.rec-modal-glass[\s\S]*?\}/g, '')), 'modales globales sin glass');

console.log('\n=== Recruitment 1B.4 — fecha objetivo y archivos ===\n');

check(/targetCoverageDate/.test(vacancyService), 'targetCoverageDate en servicio');
check(/rec-form-target-coverage/.test(indexHtml), 'campo fecha objetivo formulario');
check(/rec-detail-target-coverage/.test(indexHtml), 'fecha objetivo en detalle');
check(/rec-vac-docs-list/.test(indexHtml), 'sección archivos');
check(/recVacDocsSubmit/.test(indexHtml), 'upload archivos vacante');
check(/Podrás agregar archivos después/.test(indexHtml), 'hint sin upload en alta');

console.log('\n=== Backend summary ===\n');

check(/applicationSummary/.test(vacancyService), 'applicationSummary en servicio');

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

runRegression('test-recruitment-backend.mjs');
runRegression('test-candidate-api-confidentiality.mjs');
runRegression('test-workforce-tasks-backend.mjs');

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment vacancies frontend tests OK.\n');

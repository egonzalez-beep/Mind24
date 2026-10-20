/**
 * Recruitment 1B.1 — vacantes UI (estático).
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

console.log('\n=== Recruitment 1B.1 — frontend estático ===\n');

check(/view-dash-recruitment/.test(indexHtml), 'vista dash-recruitment');
check(/dash-recruitment/.test(indexHtml) && /VIEWS_NEED_EMPRESA_ADMIN/.test(indexHtml), 'vista en VIEWS admin');
check(/Reclutamiento/.test(indexHtml) && /Vacantes y candidatos/.test(indexHtml), 'header copy');
check(/rec-vacancy-carousel/.test(indexHtml) && /rec-vac-card/.test(indexHtml), 'carrusel cards');
check(/rec-filter-chip/.test(indexHtml) && /REC_FILTER_CHIPS/.test(indexHtml), 'filtros chips');
check(/modal-rec-vacancy/.test(indexHtml) && /rec-form-jd/.test(indexHtml), 'modal vacante');
check(/Job Description/.test(indexHtml) && /Perfil, requisitos, actividades/.test(indexHtml), 'ayuda JD');
check(/rec-form-responsible/.test(indexHtml) && /Sin responsable/.test(indexHtml), 'selector responsable');
check(/recSubmitVacancy/.test(indexHtml) && /recSyncPrimaryAssignee/.test(indexHtml), 'guardar + PRIMARY');
check(/recOpenVacancyModal\('edit'\)/.test(indexHtml), 'acción editar');
check(/Todavía no hay vacantes registradas/.test(indexHtml), 'empty state');
check(/mind24-notif-bell/.test(indexHtml.match(/view-dash-recruitment[\s\S]*?<\/main>/)?.[0] || ''), 'campana notificaciones');
check(/\+ Nueva vacante/.test(indexHtml), 'CTA nueva vacante');
check(!/location\.reload\(/.test(indexHtml.match(/function recSubmitVacancy[\s\S]*?^}/m)?.[0] || 'rec'), 'sin reload al guardar');

console.log('\n=== Recruitment 1B.2 — workspace ===\n');

check(/rec-workspace/.test(indexHtml) && /rec-ws-pulse/.test(indexHtml), 'workspace + pulso');
check(/recRenderWorkspacePulse/.test(indexHtml), 'KPIs desde applicationSummary');
check(/recCoverageMetrics/.test(indexHtml) && /rec-ws-cov-bar/.test(indexHtml), 'cobertura + barra');
check(/Descripción de la vacante/.test(indexHtml) && /recToggleJdAccordion/.test(indexHtml), 'acordeón JD cerrado por defecto');
check(/rec-ws-notes-body/.test(indexHtml) && /Sin notas adicionales/.test(indexHtml), 'bloque notas');
check(/recPickDefaultSelection/.test(indexHtml) && /recResolveSelectionInList/.test(indexHtml), 'selección automática');
check(/Responsable: Sin responsable/.test(indexHtml), 'copy responsable vacío');
check(/rec-pipeline-slot/.test(indexHtml) && !/próximamente/i.test(indexHtml.match(/view-dash-recruitment[\s\S]*?view-dash-timeclock/)?.[0] || ''), 'slot pipeline sin placeholder');
check(/recSelectVacancy[\s\S]*recRenderSelectedPanel/.test(indexHtml), 'card → workspace sin reload');

console.log('\n=== Recruitment 1B.1 — backend summary ===\n');

check(/applicationSummary/.test(vacancyService), 'applicationSummary en servicio');
check(/buildApplicationSummariesByVacancyId/.test(vacancyService), 'agregado sin N+1 por vacante');
check(/enrichVacancies/.test(vacancyService), 'enriquecer listado');

console.log('\n=== Recruitment 1B.1 — regresiones ===\n');

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
console.log('\n✓ Recruitment vacancies 1B.1 tests OK.\n');

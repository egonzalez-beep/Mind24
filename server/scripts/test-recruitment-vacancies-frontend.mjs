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
check(/rec-topbar-cluster/.test(indexHtml) && /rec-module-nav--inline/.test(indexHtml) && !/rec-page-head/.test(indexHtml), 'tabs Vacantes/Candidatos en topbar');
check(/type="date" id="rec-form-opened"/.test(indexHtml), 'fecha apertura solo día');
check(/modal-rec-vacancy/.test(indexHtml) && /recSubmitVacancy/.test(indexHtml), 'modal crear/editar vacante');
check(/\+ Nueva vacante/.test(indexHtml), 'CTA nueva vacante');

console.log('\n=== Recruitment 1B.2 / 1B.3 — workspace limpio ===\n');

check(/recKanbanLoad/.test(indexHtml) && /rec-kanban-board/.test(indexHtml), 'Kanban operativo en workspace');
check(!/rec-ws-pulse/.test(workspaceBlock), 'sin pulso KPI en workspace');
check(!/recRenderWorkspacePulse/.test(indexHtml), 'sin render KPI workspace');
check(/recUpdatePipelineHeader/.test(indexHtml) && /rec-pipeline-header/.test(workspaceBlock), 'header Pipeline compacto');
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

console.log('\n=== Recruitment 1B.5 — tablero ejecutivo ===\n');

const detailModalBlock =
  indexHtml.match(/id="modal-rec-vacancy-detail"[\s\S]*?id="modal-evaluacion"/)?.[0] || '';
check(/rec-detail-edit-btn/.test(detailModalBlock), 'editar icono lápiz');
check(/rec-exec-kpis/.test(detailModalBlock), 'KPIs ejecutivos en detalle');
check(/rec-detail-jd-trigger/.test(detailModalBlock), 'JD acordeón');
check(/recDetailResetAccordions/.test(indexHtml), 'acordeones reset al abrir');
check(/rec-detail-funnel/.test(detailModalBlock), 'funnel distribution UI');
check(/Distribución del proceso/.test(detailModalBlock), 'título funnel');
check(/Etapas del proceso/.test(detailModalBlock), 'sección etapas del proceso');
check(/recStagesOpenEditor/.test(indexHtml), 'configurador abre editor');
check(/recStagesSave/.test(indexHtml) && /Guardar etapas/.test(detailModalBlock), 'guardar etapas PUT');
check(/recStagesMoveRow/.test(indexHtml), 'fallback mover arriba/abajo');
check(/recStageIsRequiredKey|REC_REQUIRED_STAGE_KEYS/.test(indexHtml), 'etapas obligatorias UI');
check(/recStagesSubmitNewStage/.test(indexHtml), 'crear stage custom desde UI');
check(/recStagesPickExisting/.test(indexHtml), 'agregar stage existente');
check(/recStagesCancelEditor/.test(indexHtml), 'cancelar editor');
check(/rec-stage-drag/.test(indexHtml), 'drag handle CSS');
check(/Información general/.test(detailModalBlock), 'bloque información general');

console.log('\n=== Recruitment 1D.2 — cartera candidatos ===\n');

check(/rec-module-nav/.test(indexHtml), 'nav Vacantes/Candidatos');
check(/recSwitchModuleTab/.test(indexHtml), 'switch módulo recruitment');
check(/Cartera de candidatos/.test(indexHtml), 'título cartera');
check(/recCandLoadList/.test(indexHtml), 'paginación cartera');
check(/modal-rec-candidate-detail/.test(indexHtml), 'modal ficha candidato');
check(/modal-rec-candidate-form/.test(indexHtml), 'modal nuevo candidato');
check(/check-duplicates/.test(indexHtml), 'preflight duplicados UI');
check(/recCandUploadCvFile/.test(indexHtml), 'upload CV UI');
check(/max-width:min\(920px/.test(indexHtml), 'modal detalle más ancho');

console.log('\n=== Recruitment 1D.2.1 — flujo candidato/vacante ===\n');

check(/recCandAssignToVacancy/.test(indexHtml), 'asignar candidato a vacante UI');
check(/modal-rec-candidate-add-vacancy/.test(indexHtml), 'modal añadir a vacante');
check(/rec-cand-form-vacancy/.test(indexHtml), 'vacante opcional en alta');
check(/rec-cand-form-stage/.test(indexHtml), 'etapa inicial en alta');
check(/REC_CAND_PROFILE_OPTS/.test(indexHtml), 'catálogo profile UI');
check(/REC_CAND_SOURCE_OPTS/.test(indexHtml), 'catálogo source UI');
check(/Teléfono secundario/.test(indexHtml), 'whatsapp prioritario UX');
check(/rec-cand-form-profile2/.test(indexHtml) && !/Próximamente/.test(indexHtml.match(/rec-cand-form-profile2[\s\S]{0,200}/)?.[0]||''), 'profileSecondary habilitado');
check(/recCandSetOpErr/.test(indexHtml), 'mensaje fallo parcial vacante');
check(/Indica el WhatsApp del candidato/.test(indexHtml), 'UI exige WhatsApp');
check(/id="rec-cand-profile"[^>]*select|select id="rec-cand-profile"/.test(indexHtml), 'filtro profile select');

console.log('\n=== Recruitment 1G.1 — dashboard Vacantes + Pipeline ===\n');

check(/rec-global-q/.test(indexHtml) && !/rec-vac-local-q/.test(indexHtml) && /Buscar vacantes/.test(indexHtml), 'un solo buscador de vacantes en topbar');
check(/recVacCardIconSvg/.test(indexHtml) && /rec-vac-card-chip/.test(indexHtml), 'cards vacante compactas con iconos SVG');
check(/recCarouselScroll/.test(indexHtml) && /rec-carousel-range/.test(indexHtml), 'carrusel con rango y flechas');
check(/recKanbanToggleCol/.test(indexHtml) && /rec-kanban-col--collapsed/.test(indexHtml), 'columnas Kanban compactables');
check(/rec-kanban-col-title-group/.test(indexHtml) && /rec-kanban-col-collapse-btn/.test(indexHtml), 'stage title + count agrupados y control violeta');
check(/#view-dash-recruitment .rec-pipeline-slot/.test(indexHtml), 'Kanban flex viewport en Vacantes');
check(/rec-kanban-card-avatar/.test(indexHtml) && /recKanbanRelativeUpdated/.test(indexHtml), 'tarjetas Kanban premium');
check(/function recRenderFilters[\s\S]*count/.test(indexHtml), 'contadores en filtros de estado');
check(/rec-vac-selected-badge/.test(indexHtml), 'badge vacante seleccionada');

console.log('\n=== Backend summary ===\n');

check(/applicationSummary/.test(vacancyService), 'applicationSummary en servicio');
check(/executiveSnapshot/.test(vacancyService), 'executiveSnapshot en GET vacante');
check(/rejected/.test(vacancyService), 'rejected en summary');

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

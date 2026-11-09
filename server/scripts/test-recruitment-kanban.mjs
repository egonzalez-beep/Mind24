/**
 * Recruitment 1E.1 — Kanban operativo por vacante
 * node server/scripts/test-recruitment-kanban.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-kanban-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');
const routes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const appSvc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentApplication.service.js'), 'utf8');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

console.log('\n=== Recruitment 1E.1 — estático Kanban ===\n');

check(/router\.get\('\/vacancies\/:vacancyId\/applications'/.test(routes), 'GET applications por vacante');
check(/listRecruitmentApplicationsForVacancy/.test(routes), 'servicio list applications');
check(/recKanbanLoad/.test(indexHtml), 'carga Kanban UI');
check(/rec-kanban-board/.test(indexHtml), 'tablero Kanban CSS');
check(/recKanbanColDrop/.test(indexHtml), 'drop entre columnas');
check(/function recKanbanStageIconSvg/.test(indexHtml), 'iconos etapa colapsada');
check(/recKanbanToggleCol/.test(indexHtml), 'expand/collapse columnas');
check(/recKanbanRefreshRelated/.test(indexHtml), 'refresh ficha y detalle vacante');
check(/PATCH.*\/applications\/:id/.test(routes) || /router\.patch\('\/applications\/:id'/.test(routes), 'PATCH mover etapa');
check(/updatedAt.*desc/.test(appSvc), 'orden applications por updatedAt');

console.log('\n=== Recruitment Kanban — optimistic DnD ===\n');

const dropBlock = indexHtml.match(/async function recKanbanColDrop[\s\S]*?^function recKanbanCardClick/m)?.[0] || '';
check(/recKanbanMoveCardInDom/.test(indexHtml), 'movimiento DOM optimista');
check(/recKanbanSyncColCounts/.test(indexHtml), 'contadores columna sincronizados');
check(/kanbanPendingMoves/.test(indexHtml), 'bloqueo PATCH pendiente por application');
check(/recKanbanSilentReconcile/.test(indexHtml), 'reconciliación silenciosa post-PATCH');
check(/recKanbanRefreshRelatedPanels/.test(indexHtml), 'refresh paneles sin recargar Kanban');
check(!/recKanbanRender\(vacancyId\)/.test(dropBlock), 'drop no reconstruye Kanban completo');
check(!/recKanbanLoad\(vacancyId\)/.test(dropBlock), 'drop no dispara recKanbanLoad');
check(/No se pudo cambiar la etapa\. Intenta nuevamente\./.test(dropBlock), 'rollback con mensaje discreto');
check(/String\(fromStageId\)===String\(targetStageId\)/.test(dropBlock), 'misma etapa sin PATCH');
check(/rec-kanban-card--enter/.test(indexHtml) && /rec-kanban-col--drop-success/.test(indexHtml), 'microinteracciones drop');

console.log('\n=== Recruitment Kanban — polish semántico ===\n');

check(/recKanbanColSemanticMod\(stage\)/.test(indexHtml), 'columnas usan recKanbanColSemanticMod(stage)');
check(/key==='HIRED'/.test(indexHtml.match(/function recKanbanColSemanticMod[\s\S]*?^function /m)?.[0] || ''), 'semántica solo FINALIST/HIRED/REJECTED por key');
check(/rec-kanban-col--sem-finalist\.rec-kanban-col--collapsed/.test(indexHtml), 'colapsadas conservan semántica');

console.log('\n=== Recruitment Kanban — filtro fijo y autoscroll ===\n');

const dragStart = indexHtml.match(/function recKanbanCardDragStart[\s\S]*?^function recKanbanCardDragEnd/m)?.[0] || '';
const dragEnd = indexHtml.match(/function recKanbanCardDragEnd[\s\S]*?^function recKanbanColDragOver/m)?.[0] || '';
const dragOver = indexHtml.match(/function recKanbanColDragOver[\s\S]*?^function recKanbanColDragLeave/m)?.[0] || '';
check(!/recKanbanRevealEmptyForDrag/.test(indexHtml), 'el arrastre no abre etapas vacías');
check(!/kanbanDragging&&count===0/.test(indexHtml), 'una columna vacía no se abre por estar arrastrando');
check(!/sessionStorage\.setItem\(/.test(dragStart + dragEnd + dragOver + dropBlock), 'el arrastre no escribe la preferencia de etapas');
check(/dropEffect='none'/.test(dragOver), 'una columna oculta no es destino');
check(/recKanbanAutoScrollStop\(/.test(dragEnd) && /recKanbanAutoScrollStop\(/.test(dropBlock), 'soltar o cancelar detiene el autoscroll');
check(/async function recKanbanLoad[\s\S]{0,240}recKanbanAutoScrollStop/.test(indexHtml), 'cambiar de vacante detiene el autoscroll');
check(/function recSwitchModuleTab[\s\S]{0,280}recKanbanAutoScrollStop/.test(indexHtml), 'cambiar de pestaña detiene el autoscroll');
check(/name!=='dash-recruitment'&&window\.__REC_STATE/.test(indexHtml), 'salir de la vista detiene el autoscroll');
check(/kanbanDragScrollBound/.test(indexHtml), 'el listener de arrastre se registra una vez');
check(/kanbanEpoch/.test(dropBlock) && /kanbanEpoch!==moveEpoch/.test(dropBlock), 'una respuesta anterior no pisa un movimiento nuevo');
check(/requestAnimationFrame\(recKanbanAutoScrollTick\)/.test(indexHtml), 'autoscroll con un solo frame loop');
check(/recKanbanPrefersReducedMotion\(\)\?3:16/.test(indexHtml), 'menor velocidad si el usuario prefiere menos movimiento');
check(/scrollLeft/.test(indexHtml.match(/function recKanbanAutoScrollTick[\s\S]*?^function /m)?.[0] || ''), 'el autoscroll mueve el tablero, no la página');

console.log('\n=== Regresiones ===\n');

function runRegression(script) {
  const r = spawnSync(process.execPath, [path.join('scripts', script)], {
    cwd: rootDir,
    encoding: 'utf8',
    env: process.env,
  });
  if (r.status !== 0) {
    console.error((r.stdout || '') + (r.stderr || ''));
    check(false, script);
  } else {
    check(true, script);
  }
}

runRegression('test-recruitment-kanban-drag-visual.mjs');
runRegression('test-recruitment-vacancies-frontend.mjs');
runRegression('test-recruitment-backend.mjs');
runRegression('test-recruitment-candidate-application-flow.mjs');

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment Kanban 1E.1 tests OK.\n');

/**
 * Actividades 1B — Kanban admin + portal colaborador (estático).
 * Ejecutar: node server/scripts/test-workforce-tasks-frontend.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = fs.readFileSync(path.join(root, '..', 'index.html'), 'utf8');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

console.log('\n=== Workforce tasks 1B — frontend estático ===\n');

check(/tc-kanban-board/.test(indexHtml), 'Kanban presente');
check(/tc-kanban-col/.test(indexHtml) && /data-drop-status/.test(indexHtml), 'columnas Kanban');
check(/TC_KANBAN_STATUSES=\['PENDING','IN_PROGRESS','COMPLETED'\]/.test(indexHtml), 'tres columnas estados');
check(/Asignar actividad/.test(indexHtml) && /tcKanbanOpenAssign/.test(indexHtml), 'CTA Asignar actividad');
check(/tc-task-assign-modal/.test(indexHtml) && /tcKanbanSubmitAssign/.test(indexHtml), 'modal crear');
check(/tcAdminCreateEmployeeTask/.test(indexHtml), 'creación API admin');
check(/tcKanbanDragStart/.test(indexHtml) && /tcKanbanDrop/.test(indexHtml), 'drag entre estados');
check(/tcKanbanComputePosition/.test(indexHtml), 'reorder por position');
check(/tcKanbanApplyMove/.test(indexHtml) && /snapshot/.test(indexHtml), 'optimistic rollback');
check(/COMPLETED/.test(indexHtml) && /tcKanbanShowMoreCompleted/.test(indexHtml), 'admin ve completadas / ver más');
check(/tcPublicFetchTasks/.test(indexHtml), 'fetch colaborador');
check(/Mis actividades/.test(indexHtml) && /tc-emp-tasks/.test(indexHtml), 'UI colaborador');
check(/tcEmpTaskAction/.test(indexHtml) && /IN_PROGRESS/.test(indexHtml), 'colaborador inicia');
check(/✓ Completar/.test(indexHtml) && /COMPLETED/.test(indexHtml), 'colaborador completa');
check(/tc-emp-task-card--out/.test(indexHtml), 'retiro suave completada');
check(/archive:true/.test(indexHtml) && !/hard-delete|deleteTask/.test(indexHtml), 'archivar sin hard-delete');
check(/tc-kanban-col-body::-webkit-scrollbar/.test(indexHtml), 'scroll interno columnas');
check(/No hay actividades asignadas/.test(indexHtml), 'empty state admin');
check(/No tienes actividades pendientes/.test(indexHtml), 'empty state colaborador');
check(/tcKanbanMoveTask/.test(indexHtml) && /Mover a/.test(indexHtml), 'fallback accesible mover estado');
check(!/location\.reload\(/.test(indexHtml) || !/tcKanban.*reload/.test(indexHtml), 'kanban sin full-page reload');
check(/tc-history-dialog/.test(indexHtml) && /tcKanbanLoad/.test(indexHtml), 'historial y actividades coexisten');

console.log(failed === 0 ? '\n✓ Workforce tasks frontend tests OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

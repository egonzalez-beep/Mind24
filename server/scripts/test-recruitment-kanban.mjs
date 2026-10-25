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

runRegression('test-recruitment-vacancies-frontend.mjs');
runRegression('test-recruitment-backend.mjs');
runRegression('test-recruitment-candidate-application-flow.mjs');

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment Kanban 1E.1 tests OK.\n');

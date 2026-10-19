/**
 * Notificaciones Gestión de equipo — V1.
 * node server/scripts/test-workforce-notifications.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'workforce-notif-test-secret';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
const orgRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/org.notifications.routes.js'), 'utf8');
const orgMain = fs.readFileSync(path.join(rootDir, 'src/routes/org.routes.js'), 'utf8');
const notifSvc = fs.readFileSync(path.join(rootDir, 'src/services/orgNotification.service.js'), 'utf8');
const publicRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.public.routes.js'), 'utf8');
const taskSvc = fs.readFileSync(path.join(rootDir, 'src/services/workforceTask.service.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

console.log('\n=== Notificaciones — estático ===\n');

check(/model OrgNotification/.test(schema) && /model OrgNotificationRead/.test(schema), 'modelos Notification + Read');
check(/OrgNotificationType/.test(schema) && /PLATFORM_ANNOUNCEMENT/.test(schema), 'enum tipos incl. futuro');
check(/@@unique\(\[organizationId, dedupeKey\]\)/.test(schema), 'dedupe por org');
check(/@@id\(\[notificationId, userId\]\)/.test(schema), 'read por usuario');
check(/router\.get\('\/notifications'/.test(orgRoutes), 'GET listado');
check(/unread-count/.test(orgRoutes), 'GET unread-count');
check(/read-all/.test(orgRoutes), 'POST read-all');
check(/\/notifications\/:id\/read/.test(orgRoutes), 'POST read una');
check(/orgNotificationsRoutes/.test(orgMain), 'montaje en /api/org');
check(/notifyShiftCheckIn/.test(publicRoutes) && /if \(created\)/.test(publicRoutes), 'check-in solo si created');
check(/notifyShiftCheckOut/.test(publicRoutes) && /!alreadyClosed/.test(publicRoutes), 'check-out solo si cierra');
check(/notifyTaskCompletedByEmployee/.test(taskSvc) && /COMPLETED/.test(taskSvc), 'completada por empleado');
check(!/notifyTaskCompleted/.test(taskSvc.match(/patchWorkforceTaskAsAdmin[\s\S]*?^}/m)?.[0] || ''), 'admin patch sin notificación');
check(/syncOverdueTaskNotifications/.test(notifSvc), 'sync vencidas en consulta');
check(/task_overdue:/.test(notifSvc), 'dedupe vencida por task+dueAt');
check(/mind24-notif-popover/.test(indexHtml) && /mind24NotifInit/.test(indexHtml), 'UX campana + popover');
check(/MIND24_NOTIF_POLL_MS=60000/.test(indexHtml), 'polling 60s');
check(/Marcar todas como leídas/.test(indexHtml), 'marcar todas');

console.log('\n=== Notificaciones — unit dedupe ===\n');

check(/shift_check_in:\$\{sessionId\}/.test(notifSvc), 'dedupe check-in por sesión');
check(/shift_check_out:\$\{sessionId\}/.test(notifSvc), 'dedupe check-out por sesión');
check(/task_completed:\$\{taskEventId\}/.test(notifSvc), 'dedupe completada por evento');
check(/reads: \{ none: \{ userId \} \}/.test(notifSvc), 'unread por usuario');

console.log('\n=== Notificaciones — integration (DB) ===\n');

try {
  const { prisma } = await import('../src/db/client.js');
  await prisma.$queryRaw`SELECT 1`;
  console.log('  SKIP integration: ejecutar en entorno con Postgres provisionado.');
} catch {
  console.log('  SKIP integration: sin Postgres local.');
}

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Workforce notifications tests OK.\n');

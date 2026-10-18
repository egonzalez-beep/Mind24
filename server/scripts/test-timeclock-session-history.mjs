/**
 * Historial de jornadas — calendario admin (unit + route estático).
 * Ejecutar: node server/scripts/test-timeclock-session-history.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  localDateKey,
  localMidnightUtc,
  utcRangeForLocalDateInclusive,
  groupSessionsByLocalDay,
  buildWeekSummary,
  sanitizeSessionRow,
  weekRangeMonday,
} = await import('../src/services/remoteWorkSessionHistory.service.js');

const indexHtml = fs.readFileSync(path.join(root, '..', 'index.html'), 'utf8');
const routesJs = fs.readFileSync(
  path.join(root, 'src/routes/timeclock.org.routes.js'),
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

console.log('\n=== Timeclock — historial jornadas (unit) ===\n');

const tz = 'America/Mexico_City';
const lateUtc = new Date('2026-10-16T05:30:00.000Z');
check(localDateKey(lateUtc, tz) === '2026-10-15', 'TZ: check-in UTC cae en día local correcto');

const range = utcRangeForLocalDateInclusive('2026-10-01', '2026-10-31', tz);
check(range.start instanceof Date && range.end instanceof Date, 'rango UTC para mes local');
check(range.start < range.end, 'rango start < end');

const now = new Date('2026-10-15T20:00:00.000Z');
const closed = {
  id: 's1',
  checkInAt: new Date('2026-10-15T13:57:00.000Z'),
  checkOutAt: new Date('2026-10-15T15:19:00.000Z'),
  status: 'completed',
};
const open = {
  id: 's2',
  checkInAt: new Date('2026-10-15T18:00:00.000Z'),
  checkOutAt: null,
  status: 'open',
};
const days = groupSessionsByLocalDay([closed, open], tz, now);
check(days['2026-10-15'].sessionCount === 2, 'múltiples sesiones mismo día');
check(days['2026-10-15'].hasOpen === true, 'día con jornada abierta');
check(days['2026-10-15'].totalDurationSec > 0, 'duración total diaria');

const rowOpen = sanitizeSessionRow(open, now);
check(rowOpen.isOpen === true, 'jornada abierta flag');
check(rowOpen.durationSec != null, 'duración actual jornada abierta');

const week = buildWeekSummary([closed, open], tz, '2026-10-15', now);
check(week.sessionCount === 2, 'resumen semanal cuenta sesiones');
check(week.totalDurationSec > 0, 'resumen semanal duración total');
check(week.averageDurationSec != null, 'promedio por jornada');

const mon = weekRangeMonday('2026-10-15', tz);
check(mon.weekStart <= '2026-10-15' && mon.weekEnd >= '2026-10-15', 'semana contiene día ref');

console.log('\n=== Timeclock — historial (estático) ===\n');

check(/employees\/:id\/sessions/.test(routesJs), 'route GET sessions');
check(/listEmployeeSessionsHistory/.test(routesJs), 'route usa listEmployeeSessionsHistory');
check(/Historial de jornadas/.test(indexHtml), 'toggle historial copy');
check(/tcToggleHistoryPanel/.test(indexHtml), 'abrir/cerrar historial flotante');
check(/tc-history-dialog hidden/.test(indexHtml), 'dialog colapsado por defecto');
check(/tc-history-backdrop/.test(indexHtml), 'backdrop historial');
check(/tc-jornada-header-top/.test(indexHtml) && /id="tc-history-toggle"/.test(indexHtml), 'botón junto a título Jornada');
check(!/tc-history-panel/.test(indexHtml), 'sin panel inline en tarjeta');
check(/tc-history-pinned/.test(indexHtml), 'detalle anclado dentro del popover');
check(/tcHistoryPinnedDay/.test(indexHtml), 'estado detalle por click');
check(/aria-controls="tc-history-dialog"/.test(indexHtml), 'aria-controls dialog');
check(/assertWorkforceEmployeeInOrg/.test(
  fs.readFileSync(path.join(root, 'src/services/remoteWorkSessionHistory.service.js'), 'utf8'),
), 'historial valida empleado en org');
check(/\/employees\/.*\/sessions/.test(indexHtml), 'frontend fetch sessions');
check(/Duración de jornada/.test(indexHtml), 'wording duración de jornada');
check(!/Tiempo de conexión/.test(indexHtml), 'no tiempo de conexión');
check(/tc-cal-prev/.test(indexHtml) && /tc-cal-next/.test(indexHtml), 'navegación mes');
check(/aria-label.*Mes anterior/.test(indexHtml), 'aria mes anterior');
check(/tc-cal-popover/.test(indexHtml), 'popover hover desktop');

console.log(failed === 0 ? '\n✓ Timeclock session history tests OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

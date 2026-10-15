/**
 * Reloj checador remoto — Fase 1C (frontend MVP, estático).
 * Ejecutar: node server/scripts/test-timeclock-frontend-mvp.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'server/src/app.js'), 'utf8');
const orgService = fs.readFileSync(
  path.join(root, 'server/src/services/workforceEmployee.service.js'),
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

console.log('\n=== Timeclock 1C — frontend estático ===\n');

check(/app\.get\(\s*'\/checador'/.test(appJs), '/checador route in app.js');
check(!/app\.get\(\s*'\/checador\/:/.test(appJs), 'no /checador/:token route');
check(/sendFile\(indexHtmlAbs\)/.test(appJs), '/checador serves SPA HTML');

check(/id="view-timeclock"/.test(indexHtml), 'view-timeclock exists');
check(/timeclock:'view-timeclock'/.test(indexHtml), 'VIEWS.timeclock registered');
check(/tcIsChecadorPath/.test(indexHtml), 'pathname /checador detection');
check(/pathname\|\|''\)\.replace\(\/\\\/\+\$\/,''\)==='\/checador'/.test(indexHtml), 'pathname === /checador');

check(/\/api\/timeclock\/public\/exchange/.test(indexHtml), 'POST exchange');
check(/history\.replaceState\(null,\s*'',\s*'\/checador'\)/.test(indexHtml), 'replaceState strips hash');
check(/\/api\/timeclock\/public\/me/.test(indexHtml), 'GET /me');
check(!/localStorage\.setItem\([^)]*token/.test(indexHtml.match(/async function tcEmployeeBoot[\s\S]+?^}/m)?.[0] || ''), 'boot does not persist token');
check(!/sessionStorage\.setItem/.test(indexHtml.slice(indexHtml.indexOf('async function tcEmployeeBoot'), indexHtml.indexOf('async function tcEmpPrimaryAction'))), 'boot no sessionStorage token');

check(/Este enlace no es válido o la sesión ha expirado/.test(indexHtml), 'invalid session copy');
check(/Solicita un nuevo enlace a tu administrador/.test(indexHtml), 'ask admin for new link');

check(/CONTROL DE ASISTENCIA|Control de asistencia/.test(indexHtml), 'employee heading');
check(/Hola,/.test(indexHtml), 'greeting uses name');
check(/Registrar entrada/.test(indexHtml), 'check-in CTA');
check(/Tu horario de entrada será registrado automáticamente por Mind24/.test(indexHtml), 'check-in hint');
check(/Registrar salida/.test(indexHtml), 'check-out CTA');
check(/¿Deseas finalizar tu jornada\?/.test(indexHtml), 'checkout confirm');
check(/Jornada finalizada/.test(indexHtml), 'completed state stays on screen');
check(/const TC_HEARTBEAT_MS=45000/.test(indexHtml), 'heartbeat 45s');
check(/visibilitychange/.test(indexHtml), 'visibilitychange listener');
check(!/mousemove/.test(indexHtml.slice(indexHtml.indexOf('tcEmpSendHeartbeat'), indexHtml.indexOf('tcEmpLoadMe'))), 'no mousemove heartbeat');
check(/Con señal reciente/.test(indexHtml) && /Página en segundo plano/.test(indexHtml) && /Sin señal reciente/.test(indexHtml), 'signal labels');
check(!/Activo laboral/.test(indexHtml) && !/Inactivo laboral/.test(indexHtml), 'no labor activity copy');
check(
  /Mind24 registra tu horario de entrada y salida y la señal de conexión de esta página para control de asistencia\. No monitorea otras aplicaciones ni la actividad de tu equipo fuera de esta página\./.test(
    indexHtml,
  ),
  'privacy copy',
);
check(/Para una mejor experiencia, utiliza este módulo desde una computadora/.test(indexHtml), 'laptop-first notice');
check(/function tcClearSecretLink/.test(indexHtml), 'secret link cleanup');
check(/tcSecretLinkTemp=null/.test(indexHtml), 'clears JS secret on close');
check(!/window\.__TC_ACCESS_LINKS/.test(indexHtml), 'no persistent access-link map');
check(/Copiar enlace/.test(indexHtml) && /onclick="tcCopySecretLink\(\)"/.test(indexHtml), 'copy only on secret banner');
check(/buildAdminJornadaPayload/.test(orgService), 'admin uses last/open jornada helper');
check(/getLatestSessionForEmployee/.test(orgService), 'admin loads latest session if none open');
check(/onclick="tcViewJornada/.test(indexHtml) && /Duración/.test(indexHtml), 'admin jornada shows duration');
check(/tcEmployeeBoot/.test(indexHtml) && /mind24BootstrapSession/.test(indexHtml), 'boot wires /checador before admin session');
check(/tcPublicJson/.test(indexHtml), 'public API helper distinct from admin 401 redirect');
check(/\/api\/timeclock\/public\/check-in/.test(indexHtml) && /\/api\/timeclock\/public\/check-out/.test(indexHtml), 'check-in/out endpoints');
check(/tcEmpElapsed/.test(indexHtml) && /open\.checkInAt/.test(indexHtml), 'counter sourced from server checkInAt');

console.log(failed === 0 ? '\n✓ Timeclock 1C frontend tests OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

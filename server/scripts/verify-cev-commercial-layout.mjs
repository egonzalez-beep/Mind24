/**
 * Smoke estático: CTAs comerciales Crear evaluación (index.html raíz).
 * node server/scripts/verify-cev-commercial-layout.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const checks = [];
function ok(cond, msg) {
  checks.push({ ok: !!cond, msg });
}

ok(!html.includes('mind24_bienestar_upsell'), 'sin mind24_bienestar_upsell en catálogo');
ok(!html.includes('MIND24_CEV_FITNESS_UPSELL'), 'sin CTA fitness duplicado en columna módulos');
ok(!html.includes('id="cev-mod-commercial"'), 'sin contenedor comercial en columna módulos');
ok(!html.includes('id="cev-commercial-card"'), 'sin card comercial junto a módulos');
ok((html.match(/salesHook:true/g) || []).length === 1, 'una sola salesHook (medida) en MIND24_EVAL_MODULES');
const sidebar = html.match(/<aside\b[^>]*id="admin-sidebar"[^>]*>[\s\S]*?<\/aside>/)?.[0] ?? '';
ok(sidebar.includes('Mind Fitness · Bienestar Organizacional'), 'copy Mind Fitness presente en el menú compartido');
ok(sidebar.includes('Módulo a la medida'), 'copy Módulo a la medida presente en el menú compartido');
const fitnessIdx = sidebar.indexOf('id="cev-sidebar-fitness-cta"');
const medidaIdx = sidebar.indexOf('id="cev-sidebar-medida-cta"');
const cuentaIdx = sidebar.indexOf('sidebar-section-label">Cuenta');
ok(cuentaIdx >= 0 && fitnessIdx > cuentaIdx && medidaIdx > fitnessIdx, 'orden sidebar: Cuenta → Mind Fitness → Módulo a la Medida');

const adminStart = html.indexOf('id="view-dash-admin"');
const adminEnd = html.indexOf('<!-- ═', adminStart + 50);
const adminSlice = html.slice(adminStart, adminEnd > 0 ? adminEnd : adminStart + 80000);
ok(
  (adminSlice.match(/data-mind24-action="open-fitness-modal"/g) || []).length >= 1,
  'sidebar fitness sigue en Panel admin',
);

const initBlock = html.slice(
  html.indexOf('function mind24InitCrearEvalModules'),
  html.indexOf('function mind24InitCrearEvalModules') + 800,
);
ok(!initBlock.includes('cev-mod-commercial'), 'init: no rellena bloque comercial');
ok(initBlock.includes('if(mind24ModIsCommercialHook(mod))return'), 'init: hooks no van a #cev-mod-list');

ok(html.includes('mind24OpenFitnessModal'), 'modal fitness intacto');
ok(html.includes('mind24OpenMedidaModal'), 'modal medida intacto');
ok(html.includes('https://wa.me/524428339128'), 'WhatsApp ventas presente');
ok(
  html.includes('function mind24ModIsCommercialHook') &&
    html.includes('!mind24ModIsCommercialHook(mod)') &&
    html.includes('crearEvalGetSelectedModuleKeys'),
  'hooks excluidos de lógica assignable (patrón existente)',
);

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? 'OK' : 'FAIL'}  ${c.msg}`);
}
if (failed.length) {
  console.error(`\n${failed.length} fallo(s).`);
  process.exitCode = 1;
} else {
  console.log(`\n✓ ${checks.length} comprobaciones estáticas OK.`);
}

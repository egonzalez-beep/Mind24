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
ok(html.includes('MIND24_CEV_FITNESS_UPSELL'), 'CTA fitness UI-only definido');
ok(html.includes('Mind Fitness — Bienestar Organizacional'), 'copy Mind Fitness presente');
ok(html.includes('id="cev-mod-commercial"'), 'contenedor #cev-mod-commercial presente');
ok(html.includes('id="cev-commercial-card"'), 'card comercial presente');
ok(html.includes('.cev-mod-commercial{display:flex;flex-direction:column;gap:10px'), 'gap 10px en bloque comercial');
ok((html.match(/salesHook:true/g) || []).length === 1, 'una sola salesHook (medida) en MIND24_EVAL_MODULES');
ok(html.includes('#view-dash-crear-eval #cev-sidebar-fitness-cta{display:none'), 'sidebar fitness oculto solo en Crear evaluación');
ok(html.includes('id="cev-sidebar-fitness-cta"'), 'id sidebar fitness en vista Crear evaluación');

const crearEvalStart = html.indexOf('id="view-dash-crear-eval"');
ok(crearEvalStart >= 0, 'vista view-dash-crear-eval encontrada');
const crearEvalEnd = html.indexOf('<!-- ═', crearEvalStart + 50);
const crearSlice = html.slice(crearEvalStart, crearEvalEnd > 0 ? crearEvalEnd : crearEvalStart + 80000);

const adminStart = html.indexOf('id="view-dash-admin"');
const adminEnd = html.indexOf('<!-- ═', adminStart + 50);
const adminSlice = html.slice(adminStart, adminEnd > 0 ? adminEnd : adminStart + 80000);
ok(
  (adminSlice.match(/data-mind24-action="open-fitness-modal"/g) || []).length >= 1,
  'sidebar fitness sigue en Panel admin',
);

const initBlock = html.slice(
  html.indexOf('function mind24InitCrearEvalModules'),
  html.indexOf('function mind24InitCrearEvalModules') + 1200,
);
ok(initBlock.includes('MIND24_CEV_FITNESS_UPSELL'), 'init: fitness primero en comercial');
ok(initBlock.indexOf('MIND24_CEV_FITNESS_UPSELL') < initBlock.indexOf('mod.salesHook'), 'init: fitness antes que medida');
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

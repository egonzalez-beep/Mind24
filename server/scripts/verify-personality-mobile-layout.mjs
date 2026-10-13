/**
 * Smoke estático: Personalidad Mind24 — mobile polish v1 (index.html raíz).
 * node server/scripts/verify-personality-mobile-layout.mjs
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

ok(html.includes('viewport-fit=cover'), 'viewport-fit=cover para safe-area iOS');
ok(html.includes('eval-personalidad-mind24'), 'clase shell Personalidad en vista evaluación');
ok(html.includes('function mind24EvalApplyPersonalityShellClass'), 'helper aplica clase por moduleKey');
ok(html.includes("root.classList.toggle('eval-personalidad-mind24',mk==='personalidad_mind24')"), 'toggle scoped a personalidad_mind24');
ok(html.includes('eval-instr-pm24-scale'), 'bloque escala Likert con clase compactable');
ok(html.includes('id="evalMobileProg"'), 'progreso compacto móvil en topbar');
ok(html.includes('id="evalMobileProgText"'), 'texto progreso móvil');
ok(html.includes('id="evalMobileProgFill"'), 'barra progreso móvil');
ok(html.includes('evalMobileProg') && html.includes('is-active'), 'progreso móvil activable por JS');
ok(
  html.includes("mobText.textContent=lbl") || html.includes('mobText)mobText.textContent'),
  'sync progreso móvil en mind24EvalShellSync',
);
ok(html.includes('env(safe-area-inset-top'), 'safe-area top en topbar');
ok(html.includes('env(safe-area-inset-bottom'), 'safe-area bottom en nav/scr-dynamic');
ok(html.includes('#scr-dynamic .eval-nav .q-note{order:1'), 'nav móvil: nota en fila 1 (<=480px)');
ok(html.includes('#scr-dynamic .eval-nav #dynBtnPrev{order:2'), 'nav móvil: Anterior fila 2');
ok(html.includes('#scr-dynamic .eval-nav #dynBtnNext{order:3'), 'nav móvil: Siguiente/Finalizar fila 2');
const mobileBlock = html.slice(
  html.indexOf('Personalidad Mind24 — mobile polish'),
  html.indexOf('/* RESPONSIVE */'),
);
ok(mobileBlock.includes('#view-evaluacion #scr-dynamic.active{align-items:flex-start'), 'scr-dynamic móvil compartido (todos los dinámicos)');
ok(!mobileBlock.includes('.eval-personalidad-mind24 #scr-dynamic.active{align-items'), 'scr-dynamic flex-start no gated solo PM24');
ok(
  mobileBlock.includes('@media(max-width:480px)') &&
    mobileBlock.includes('#scr-dynamic .eval-nav') &&
    !mobileBlock.includes('.eval-personalidad-mind24 #scr-dynamic .eval-nav{'),
  'nav <=480px compartida (#scr-dynamic, no solo PM24)',
);
ok(html.includes('#scr-dynamic.active{align-items:flex-start'), 'scr-dynamic scroll: flex-start móvil');
ok(html.includes('.eval-personalidad-mind24 #scr-intro.active'), 'intro compacta scoped Personalidad');
ok(!html.includes('position:fixed') || !html.slice(html.indexOf('Personalidad Mind24 — mobile'), html.indexOf('/* RESPONSIVE */')).includes('#scr-dynamic .eval-nav{position:fixed'), 'sin nav fixed en bloque PM24 mobile');
ok(html.includes('id="dynBtnNext"') && html.includes('id="dynBtnPrev"') && html.includes('id="dynNote"'), 'IDs nav dinámico intactos');

const shellSync = html.slice(html.indexOf('function mind24EvalShellSync'), html.indexOf('function mind24EvalShellSync') + 2200);
ok(shellSync.includes('isPm24Shell'), 'progreso móvil usa flag Personalidad');
ok(!shellSync.includes('80'), 'sin hardcode 80 en sync shell');

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

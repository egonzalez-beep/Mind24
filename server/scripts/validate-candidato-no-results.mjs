/**
 * Validación estática: candidato no ve resultados tras finalizar módulo.
 * Ejecutar: node server/scripts/validate-candidato-no-results.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(__dirname, '../../index.html');
const html = fs.readFileSync(indexPath, 'utf8');

let failed = 0;

function fail(msg) {
  console.log('  FAIL:', msg);
  failed++;
}
function ok(msg) {
  console.log('  OK:', msg);
}

console.log('\n=== Validación estática candidato sin resultados ===\n');

// 1. No debe invocarse pantalla de resultados tras submit
if (/showScr\(['"]results['"]\)/.test(html)) {
  fail('showScr("results") aún presente en index.html');
} else {
  ok('sin showScr("results")');
}

// 2. Función central de post-submit
if (!html.includes('function mind24CandidatoAfterModuleSubmit')) {
  fail('falta mind24CandidatoAfterModuleSubmit');
} else {
  ok('mind24CandidatoAfterModuleSubmit definida');
}

// 3. Flujos conectados
const mustCall = [
  ['finishEval → mind24CandidatoAfterModuleSubmit', /function finishEval\([\s\S]*?mind24CandidatoAfterModuleSubmit/],
  ['mind24FinishDynamicAttempt → mind24CandidatoAfterModuleSubmit', /async function mind24FinishDynamicAttempt[\s\S]*?mind24CandidatoAfterModuleSubmit/],
  ['termanAdvanceSeries → mind24CandidatoAfterModuleSubmit', /async function termanAdvanceSeries[\s\S]*?mind24CandidatoAfterModuleSubmit/],
];

for (const [label, re] of mustCall) {
  if (!re.test(html)) fail(label + ' no conectado');
  else ok(label);
}

// 4. SJT ya no renderiza resultado al candidato en finish path
const finishDynamicBlock = html.match(/async function mind24FinishDynamicAttempt[\s\S]*?^}/m);
if (finishDynamicBlock && finishDynamicBlock[0].includes('mind24RenderSjtCompleteResult')) {
  fail('mind24FinishDynamicAttempt aún llama mind24RenderSjtCompleteResult');
} else {
  ok('SJT no renderiza resultado en finishDynamicAttempt');
}

// 5. Honestidad submit API intacto
if (!html.includes("'/submit'") && !html.includes('"/submit"')) {
  fail('ruta submit no encontrada en frontend');
} else {
  ok('POST submit presente en finishEval');
}

// 6. Errores no redirigen al lobby en finishEval
if (/catch\(err\)\{[^}]*mind24CandidatoAfterModuleSubmit/.test(html)) {
  fail('finishEval redirige al lobby en catch');
} else {
  ok('finishEval: error no dispara lobby');
}

const dynFinishBlock = html.match(/async function mind24FinishDynamicAttempt[\s\S]*?^}/m)?.[0] || '';
if (dynFinishBlock.includes('catch') && dynFinishBlock.match(/catch[\s\S]*?mind24CandidatoAfterModuleSubmit/)) {
  fail('mind24FinishDynamicAttempt redirige al lobby en catch');
} else {
  ok('mind24FinishDynamicAttempt: error no dispara lobby');
}

// 7. Banner se limpia tras mostrar
if (!html.includes('window.__CAND_LOBBY_SUCCESS_MSG=null')) {
  fail('banner no se limpia tras render');
} else {
  ok('banner de éxito se consume al renderizar lobby');
}

// 8. renderServerResult / calcResults no invocados desde finish paths
if (/renderServerResult\(/.test(html) && html.match(/function finishEval[\s\S]*?renderServerResult/)) {
  fail('finishEval aún llama renderServerResult');
} else {
  ok('finishEval no llama renderServerResult');
}

console.log(failed === 0 ? '\n✓ Validación estática OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

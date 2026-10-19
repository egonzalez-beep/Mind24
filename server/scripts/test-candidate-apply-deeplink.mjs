/**
 * Deep-link modal «Aplicar Evaluación» + mensaje candidato.
 * node server/scripts/test-candidate-apply-deeplink.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

console.log('\n=== Candidato — deep-link Aplicar Evaluación ===\n');

check(/MIND24_APPLY_EVAL_PARAM='apply'/.test(indexHtml), 'param apply');
check(/MIND24_APPLY_EVAL_VALUE='evaluation'/.test(indexHtml), 'valor evaluation');
check(/function mind24PublicApplyEvalUrl/.test(indexHtml), 'URL pública apply');
check(
  /function mind24PublicApplyEvalUrl[\s\S]*?MIND24_APPLY_EVAL_PARAM\+'='\+MIND24_APPLY_EVAL_VALUE/.test(indexHtml),
  'URL incluye ?apply=evaluation',
);
check(/function mind24MaybeOpenApplyEvalDeepLink/.test(indexHtml), 'procesador deep-link');
check(/mind24ClearApplyEvalDeepLink/.test(indexHtml) && /replaceState/.test(indexHtml.match(/function mind24ClearApplyEvalDeepLink[\s\S]*?^}/m)?.[0] || ''), 'limpia URL al cerrar');
check(/id==='modal-evaluacion'/.test(indexHtml) && /mind24ClearApplyEvalDeepLink/.test(indexHtml), 'closeModal eval limpia param');
check(/openModal\('modal-evaluacion'\)/.test(indexHtml.match(/function mind24OpenApplyEvalModalFromDeepLink[\s\S]*?^}/m)?.[0] || ''), 'deep-link abre modal evaluación');
check(/eval-nombre/.test(indexHtml.match(/function mind24OpenApplyEvalModalFromDeepLink[\s\S]*?^}/m)?.[0] || ''), 'foco en nombre');
check(
  /mind24BootstrapSession[\s\S]*mind24MaybeOpenApplyEvalDeepLink[\s\S]*\}\)\(\)/.test(indexHtml),
  'bootstrap procesa deep-link',
);
check(/Correo electrónico \(usuario\)/.test(indexHtml), 'label correo (usuario)');
check(!/Ya tengo cuenta MIND24/.test(indexHtml), 'sin enlace Ya tengo cuenta');
check(/function crearEvalBuildAccessSpeech/.test(indexHtml) && /mind24PublicApplyEvalUrl\(\)/.test(indexHtml), 'mensaje usa deep-link');
check(!/searchParams\.set\([^)]*email/i.test(indexHtml.match(/mind24ClearApplyEvalDeepLink[\s\S]*?mind24MaybeOpenApplyEvalDeepLink[\s\S]*?^}/m)?.[0] || indexHtml.slice(0, 500)), 'URL sin credenciales en deep-link helpers');

console.log('\n=== Candidato — regresión confidencialidad API ===\n');

const { spawnSync } = await import('node:child_process');
const conf = spawnSync(process.execPath, ['scripts/test-candidate-api-confidentiality.mjs'], {
  cwd: rootDir,
  encoding: 'utf8',
});
if (conf.status !== 0) {
  console.error(conf.stdout || conf.stderr || 'test-candidate-api-confidentiality falló');
  failed += 1;
} else {
  console.log((conf.stdout || '').split('\n').filter((l) => l.includes('OK') || l.includes('✓')).slice(-3).join('\n') || '  OK  confidentiality tests');
}

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Candidate apply deeplink tests OK.\n');

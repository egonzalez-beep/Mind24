/**
 * Navegación expediente candidato — pruebas deterministas (sin DB).
 * Ejecuta helpers del bloque REC_CAND_NAV_PURE_HELPERS en index.html (fuente única).
 * node server/scripts/test-recruitment-candidate-nav.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import vm from 'node:vm';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(rootDir, '..', 'index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf8');

const BLOCK_START = '// REC_CAND_NAV_PURE_HELPERS_START';
const BLOCK_END = '// REC_CAND_NAV_PURE_HELPERS_END';

const REQUIRED_HELPERS = [
  'recCandNavBuildPortfolioSnapshot',
  'recCandNavBuildKanbanSnapshot',
  'recCandNavComputePosition',
  'recCandNavComputeButtonDisabled',
  'recCandNavNavigateIndex',
  'recCandNavRemoveMissingFromSnapshot',
  'recCandNavPlanPipelineReconcileOnClose',
  'recCandNavShouldApplyDetailFetch',
  'recCandNavMarkPipelineDirtyPreserveSnapshot',
  'recCandNavIsObsComposerDirty',
];

function loadPureHelpersFromIndexHtml(html) {
  const i0 = html.indexOf(BLOCK_START);
  const i1 = html.indexOf(BLOCK_END);
  if (i0 < 0 || i1 < 0 || i1 <= i0) {
    throw new Error(
      `Bloque ${BLOCK_START} / ${BLOCK_END} no encontrado en index.html — los tests deterministas no pueden usar la implementación del navegador.`,
    );
  }
  const code = html.slice(i0 + BLOCK_START.length, i1).trim();
  const sandbox = { Map, Set };
  vm.runInNewContext(code, sandbox, {
    filename: 'index.html#REC_CAND_NAV_PURE_HELPERS',
  });
  for (const name of REQUIRED_HELPERS) {
    if (typeof sandbox[name] !== 'function') {
      throw new Error(
        `Helper ${name} ausente tras evaluar el bloque de index.html — no usar copia externa.`,
      );
    }
  }
  return sandbox;
}

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

console.log('\n=== Recruitment — navegación expediente (determinista, index.html) ===\n');

const helpersPath = path.join(rootDir, 'scripts', 'recruitment-candidate-nav.helpers.mjs');
check(
  !fs.existsSync(helpersPath),
  'sin recruitment-candidate-nav.helpers.mjs duplicado',
);

let H;
try {
  H = loadPureHelpersFromIndexHtml(indexHtml);
  check(true, 'bloque REC_CAND_NAV_PURE_HELPERS extraído y evaluado');
  check(
    REQUIRED_HELPERS.every((n) => typeof H[n] === 'function'),
    'todos los helpers requeridos existen en el sandbox (index.html)',
  );
} catch (e) {
  console.error(`  FAIL  ${e.message}`);
  failed += 1;
  process.exit(1);
}

const buildPortfolioNavSnapshot = H.recCandNavBuildPortfolioSnapshot;
const buildKanbanNavSnapshot = H.recCandNavBuildKanbanSnapshot;
const computeNavPosition = H.recCandNavComputePosition;
const computeNavButtonDisabled = H.recCandNavComputeButtonDisabled;
const navigateCandidateIndex = H.recCandNavNavigateIndex;
const removeMissingCandidateFromSnapshot = H.recCandNavRemoveMissingFromSnapshot;
const shouldApplyDetailFetch = H.recCandNavShouldApplyDetailFetch;
const planPipelineReconcileOnClose = H.recCandNavPlanPipelineReconcileOnClose;
const markPipelineDirtyPreserveSnapshot = H.recCandNavMarkPipelineDirtyPreserveSnapshot;
const isObsComposerDirty = H.recCandNavIsObsComposerDirty;

const portfolioRows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
check(
  JSON.stringify(buildPortfolioNavSnapshot(portfolioRows, 'b')) === JSON.stringify(['a', 'b', 'c']),
  'snapshot Cartera conserva orden recibido',
);
check(
  buildPortfolioNavSnapshot([{ id: 'x' }, { id: 'y' }], 'z').length === 1 &&
    buildPortfolioNavSnapshot([{ id: 'x' }, { id: 'y' }], 'z')[0] === 'z',
  'snapshot Cartera solo filas cargadas (openId fuera de lista → solo ese id)',
);
check(
  buildPortfolioNavSnapshot(portfolioRows.slice(0, 2), 'a').length === 2,
  'snapshot Cartera no incluye filas no cargadas',
);

const stages = [
  { stageId: 's1', stage: { id: 's1' }, position: 0 },
  { stageId: 's2', stage: { id: 's2' }, position: 1 },
];
const apps = [
  { id: 'app1', stageId: 's1', candidateId: 'c1' },
  { id: 'app2', stageId: 's1', candidateId: 'c2' },
  { id: 'app3', stageId: 's2', candidateId: 'c3' },
];
check(
  JSON.stringify(buildKanbanNavSnapshot(stages, apps, 'c2')) === JSON.stringify(['c1', 'c2', 'c3']),
  'snapshot Kanban respeta orden etapas y tarjetas',
);

const dupApps = [
  { id: 'app1', stageId: 's1', candidateId: 'c1' },
  { id: 'app1b', stageId: 's2', candidateId: 'c1' },
  { id: 'app2', stageId: 's2', candidateId: 'c2' },
];
check(
  JSON.stringify(buildKanbanNavSnapshot(stages, dupApps, 'c1')) === JSON.stringify(['c1', 'c2']),
  'IDs duplicados en Kanban una sola vez',
);

const ids = ['c1', 'c2', 'c3'];
let pos = computeNavPosition(ids, 'c1');
let btns = computeNavButtonDisabled(pos.index, pos.total, false);
check(btns.prevDisabled && !btns.nextDisabled, 'primer candidato: Anterior deshabilitado');
check(pos.label === '1 de 3', 'indicador N de M (primero)');

pos = computeNavPosition(ids, 'c3');
btns = computeNavButtonDisabled(pos.index, pos.total, false);
check(!btns.prevDisabled && btns.nextDisabled, 'último candidato: Siguiente deshabilitado');
check(pos.label === '3 de 3', 'indicador N de M (último)');

pos = computeNavPosition(['solo'], 'solo');
btns = computeNavButtonDisabled(pos.index, pos.total, false);
check(btns.prevDisabled && btns.nextDisabled, 'un candidato: ambos deshabilitados');
check(pos.label === '1 de 1', 'un candidato: 1 de 1');

check(navigateCandidateIndex(0, 1, 3) === 1, 'navegar siguiente incrementa posición');
check(navigateCandidateIndex(2, -1, 3) === 1, 'navegar anterior disminuye posición');
check(navigateCandidateIndex(0, -1, 3) === null, 'anterior en primero no navega');
check(navigateCandidateIndex(2, 1, 3) === null, 'siguiente en último no navega');

let rm = removeMissingCandidateFromSnapshot(['a', 'b', 'c'], 'b');
check(rm.nextIndex === 1 && rm.ids[rm.nextIndex] === 'c' && !rm.shouldClose, '404 conserva posición lógica (mismo índice → siguiente id)');

rm = removeMissingCandidateFromSnapshot(['a', 'b'], 'b');
check(rm.nextIndex === 0 && rm.ids[rm.nextIndex] === 'a' && !rm.shouldClose, '404 del último selecciona nuevo último');

rm = removeMissingCandidateFromSnapshot(['only'], 'only');
check(rm.shouldClose && rm.ids.length === 0, 'snapshot vacío cierra expediente');

check(shouldApplyDetailFetch(2, 2) === true, 'secuencia actual aplica respuesta');
check(shouldApplyDetailFetch(1, 2) === false, 'secuencia anterior no aplica si hay más reciente');

const st = { candNavIds: ['x', 'y'], candNavPipelineDirty: false };
const snap = markPipelineDirtyPreserveSnapshot(st);
check(JSON.stringify(snap) === JSON.stringify(['x', 'y']) && st.candNavPipelineDirty === true, 'cambiar etapa marca dirty sin reconstruir snapshot');
check(JSON.stringify(st.candNavIds) === JSON.stringify(['x', 'y']), 'snapshot intacto tras mark dirty');

st.candNavPipelineDirty = true;
const r1 = planPipelineReconcileOnClose(st);
const r2 = planPipelineReconcileOnClose(st);
check(r1.reconcile === true && r2.reconcile === false, 'cerrar con pipeline dirty reconcilia una sola vez');

check(isObsComposerDirty(false, 'texto') === false, 'confirm no si compositor cerrado');
check(isObsComposerDirty(true, '   ') === false, 'confirm no si compositor vacío');
check(isObsComposerDirty(true, ' borrador ') === true, 'confirm sí si hay texto');

console.log('\n=== Recruitment — navegación (estático mínimo) ===\n');
check(indexHtml.includes(BLOCK_START) && indexHtml.includes(BLOCK_END), 'delimitadores presentes en index.html');
check(/recCandRetryDetailLoad/.test(indexHtml), 'UI Reintentar carga expediente');
check(/rec-cand-detail-load-retry/.test(indexHtml), 'botón Reintentar en DOM');
check(/recCandDetailObsDirty/.test(indexHtml) && /recCandConfirmDiscardDetailEdits/.test(indexHtml), 'guard observaciones con confirm');

console.log('\n=== Recruitment — navegación (ubicación lateral viewport) ===\n');
const hostIdx = indexHtml.indexOf('id="rec-cand-detail-nav-host"');
const prevIdx = indexHtml.indexOf('id="rec-cand-nav-prev"');
const modalIdx = indexHtml.indexOf('id="modal-rec-candidate-detail"');
check(hostIdx >= 0 && prevIdx > hostIdx && modalIdx > prevIdx, 'flechas en #rec-cand-detail-nav-host antes del overlay modal');
const modalSlice = indexHtml.slice(modalIdx, modalIdx + 12000);
check(!modalSlice.includes('id="rec-cand-nav-prev"') && !modalSlice.includes('id="rec-cand-nav-next"'), 'Anterior/Siguiente no son hijos del overlay (evita fixed bajo backdrop-filter)');
check(/\.rec-cand-detail-nav-host\{[^}]*position:fixed[^}]*inset:0/.test(indexHtml), 'capa nav anclada al viewport (fixed inset 0)');
check(/#rec-cand-nav-prev\{[^}]*left:/.test(indexHtml) && /#rec-cand-nav-prev\{[^}]*right:auto/.test(indexHtml), 'Anterior anclado al borde izquierdo');
check(/#rec-cand-nav-next\{[^}]*right:/.test(indexHtml) && /#rec-cand-nav-next\{[^}]*left:auto/.test(indexHtml), 'Siguiente anclado al borde derecho');
check(/getElementById\('rec-cand-detail-nav-host'\)/.test(indexHtml), 'JS muestra/oculta capa nav con el expediente');

if (failed) {
  console.error(`\n✗ ${failed} fallo(s)\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment candidate nav deterministic tests OK.\n');

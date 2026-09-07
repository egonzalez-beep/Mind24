/**
 * Validación: orden intercalado c1–c5 y d1–d5 + contenido directas.
 * Ejecutar: node server/scripts/test-honestidad-question-order.mjs
 */
import { defaultDemoAssessmentConfig } from '../src/assessment/defaultDefinition.js';
import { scoreAssessment, resolveDenialReliability } from '../src/services/scoring.service.js';
import { fillBestLikertAnswers } from './honestidadTestHelpers.mjs';

const EXPECTED_PROMPTS = {
  d1: '¿Alguna vez has dicho una mentira, incluso si fue por una razón menor?',
  d2: '¿Alguna vez has cometido un error y preferido que nadie lo notara?',
  d3: '¿Alguna vez te has molestado por una crítica o comentario negativo sobre ti?',
  d4: '¿Alguna vez has perdido la paciencia con alguien y después consideraste que reaccionaste de más?',
  d5: '¿Alguna vez has incumplido una regla menor porque consideraste que no tendría consecuencias importantes?',
};

function buildSequentialFlat(cfg) {
  const flat = [];
  for (const sec of cfg.sections || []) {
    for (const q of sec.questions || []) {
      flat.push({ sectionId: sec.id, id: q.id, prompt: q.prompt, options: q.options, denialOptionIndex: q.denialOptionIndex });
    }
  }
  return flat;
}

function interleaveEmbedIntoBase(embed, base) {
  if (!embed.length) return base.slice();
  if (embed.length === 1) return [embed[0], ...base];
  const nE = embed.length;
  const nB = base.length;
  const total = nE + nB;
  const positions = [];
  for (let i = 0; i < nE; i++) {
    positions.push(Math.round(((i + 1) * total) / (nE + 1)) - 1);
  }
  const out = new Array(total);
  let bi = 0;
  let ei = 0;
  for (let pos = 0; pos < total; pos++) {
    if (ei < nE && pos === positions[ei]) out[pos] = embed[ei++];
    else out[pos] = base[bi++];
  }
  return out;
}

function interleaveHonestidadFlat(flat) {
  const cal = flat.filter((q) => q.sectionId === 'calibracion');
  const direct = flat.filter((q) => q.sectionId === 'directas');
  const principal = flat.filter((q) => q.sectionId === 'principal');
  const embed = [];
  const n = Math.max(cal.length, direct.length);
  for (let i = 0; i < n; i++) {
    if (direct[i]) embed.push(direct[i]);
    if (cal[i]) embed.push(cal[i]);
  }
  return interleaveEmbedIntoBase(embed, principal);
}

function buildAnswers(negDirCount, errCalCount, cfg) {
  const answers = {};
  for (let i = 1; i <= 5; i++) answers[`c${i}`] = i <= errCalCount ? 1 : 0;
  for (let i = 1; i <= 5; i++) answers[`d${i}`] = i <= negDirCount ? 1 : 0;
  fillBestLikertAnswers(cfg, answers);
  return answers;
}

const cfg = defaultDemoAssessmentConfig;
const sequential = buildSequentialFlat(cfg);
const interleaved = interleaveHonestidadFlat(sequential);
const ids = interleaved.map((q) => q.id);
const calIds = ['c1', 'c2', 'c3', 'c4', 'c5'];
const dirIds = ['d1', 'd2', 'd3', 'd4', 'd5'];

let failed = 0;
function fail(msg) {
  console.log('FAIL:', msg);
  failed++;
}

console.log('\n=== Honestidad — d1–d5 contenido y orden ===\n');

for (const [id, text] of Object.entries(EXPECTED_PROMPTS)) {
  const q = cfg.sections.find((s) => s.id === 'directas')?.questions?.find((x) => x.id === id);
  if (!q || q.prompt !== text) fail(`${id} prompt no coincide`);
  if (q?.options?.[1] !== 'No, nunca.') fail(`${id} opción negación incorrecta`);
  if (q?.denialOptionIndex !== 1) fail(`${id} denialOptionIndex != 1`);
}
console.log('OK: prompts y negación "No, nunca." en índice 1');

for (const cid of [...calIds, ...dirIds]) {
  if (ids.filter((id) => id === cid).length !== 1) fail(`${cid} no aparece exactamente una vez`);
}
console.log('OK: c1–c5 y d1–d5 aparecen una sola vez');

for (let i = 0; i < ids.length - 1; i++) {
  const a = ids[i];
  const b = ids[i + 1];
  if (a.startsWith('c') && b.startsWith('c')) fail(`cal consecutivas ${a} ${b}`);
  if (a.startsWith('d') && b.startsWith('d')) fail(`directas consecutivas ${a} ${b}`);
  if ((a.startsWith('c') && b.startsWith('d')) || (a.startsWith('d') && b.startsWith('c'))) {
    fail(`cal/directa consecutivas ${a} ${b}`);
  }
}
console.log('OK: sin bloques consecutivos c–c, d–d ni c–d');

const controlIdx = ids.map((id, i) => (/^[cd]\d/.test(id) ? i : -1)).filter((i) => i >= 0);
for (let i = 0; i < controlIdx.length - 1; i++) {
  if (controlIdx[i + 1] - controlIdx[i] < 3) fail(`controles muy próximos en ${controlIdx[i]} y ${controlIdx[i + 1]}`);
}
console.log('OK: separación mínima entre controles (>=3 ítems)');

const firstD = ids.findIndex((id) => id.startsWith('d'));
const lastD = ids.reduce((acc, id, i) => (id.startsWith('d') ? i : acc), -1);
if (firstD < 2 || lastD < 35) fail(`distribución d insuficiente (${firstD}, ${lastD})`);
else console.log('OK: d1–d5 distribuidas (primera en', firstD + ', última en', lastD + ')');

console.log('\nOrden visible:');
console.log(ids.join(' → '));

const baseline = scoreAssessment(cfg, buildAnswers(0, 0, cfg));
for (const negDir of [0, 2, 3, 4, 5]) {
  const r = scoreAssessment(cfg, buildAnswers(negDir, 0, cfg));
  const level = resolveDenialReliability(negDir).level;
  if (r.meta.negDir !== negDir) fail(`negDir conteo ${negDir}`);
  if (r.meta.denialReliability !== level) fail(`denialReliability negDir=${negDir}`);
  if (r.global !== baseline.global) fail(`global cambió con negDir=${negDir}`);
  if (negDir <= 2 && r.verdict === 'Prueba Inválida') fail(`negDir=${negDir} no debe invalidar`);
  if (negDir === 5 && r.verdict !== 'Prueba Inválida') fail('negDir=5 debe invalidar');
  if (negDir >= 3 && negDir <= 4 && r.verdict === 'Prueba Inválida') fail(`negDir=${negDir} no debe invalidar`);
}
console.log('\nOK: termómetro negación 0–2 / 3–4 / 5 intacto; global=', baseline.global + '%');

console.log(failed === 0 ? '\n✓ Validación OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

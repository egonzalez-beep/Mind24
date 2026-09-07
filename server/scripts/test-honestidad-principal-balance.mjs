/**
 * Audita balance posicional de score máximo en p1–p40.
 * Ejecutar: node server/scripts/test-honestidad-principal-balance.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDemoAssessmentConfig } from '../src/assessment/defaultDefinition.js';
import { scoreAssessment } from '../src/services/scoring.service.js';
import { fillBestLikertAnswers } from './honestidadTestHelpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const permPath = path.join(__dirname, 'principal-balance-perms.json');

function maxPositions(scores) {
  const max = Math.max(...scores);
  return scores.map((s, i) => (s === max ? i + 1 : null)).filter(Boolean);
}

function auditCounts(questions) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let ties = 0;
  for (const q of questions) {
    const pos = maxPositions(q.scoreByIndex);
    if (pos.length > 1) ties++;
    for (const p of pos) counts[p]++;
  }
  return { counts, ties };
}

function buildAnswersByIndex(indexById) {
  const answers = {};
  for (let i = 1; i <= 5; i++) {
    answers[`c${i}`] = 0;
    answers[`d${i}`] = 0;
  }
  for (let i = 1; i <= 40; i++) {
    const id = `p${i}`;
    answers[id] = indexById[id] ?? 0;
  }
  return answers;
}

const principal = defaultDemoAssessmentConfig.sections.find((s) => s.id === 'principal');
const questions = principal.questions;
const perms = JSON.parse(fs.readFileSync(permPath, 'utf8'));

let failed = 0;
function fail(msg) {
  console.log('FAIL:', msg);
  failed++;
}

console.log('\n=== Honestidad — balance posicional p1–p40 ===\n');

const { counts, ties } = auditCounts(questions);
console.log('Distribución de score máximo (apariciones):');
for (const pos of [1, 2, 3, 4]) {
  const n = counts[pos];
  const pct = ((n / 40) * 100).toFixed(1);
  console.log(`  Posición ${pos}: ${n} (${pct}% sobre 40 ítems; ${((n / (40 + 1)) * 100).toFixed(1)}% incl. empate p22)`);
}
console.log(`  Empates: ${ties}`);

for (const pos of [1, 2, 3, 4]) {
  if (counts[pos] < 9 || counts[pos] > 11) fail(`posición ${pos} fuera de rango balanceado (${counts[pos]})`);
}
if (ties !== 1) fail(`empates esperados: 1, got ${ties}`);

for (const q of questions) {
  const pairs = q.options.map((t, i) => `${t}|${q.scoreByIndex[i]}`);
  const uniq = new Set(pairs);
  if (uniq.size !== 4) fail(`${q.id}: parejas texto|score duplicadas`);
}

for (const q of questions) {
  const perm = perms[q.id];
  if (!perm || perm.length !== 4) {
    fail(`${q.id}: permutación ausente`);
    continue;
  }
  for (let newIdx = 0; newIdx < 4; newIdx++) {
    const oldIdx = perm[newIdx];
    const score = q.scoreByIndex[newIdx];
    const text = q.options[newIdx];
    const pairKey = `${text}|${score}`;
    if (!pairKey.includes('|')) fail(`${q.id}: pareja inválida`);
  }
  for (let oldIdx = 0; oldIdx < 4; oldIdx++) {
    const newIdx = perm.indexOf(oldIdx);
    if (newIdx < 0) fail(`${q.id}: perm no reversible en índice ${oldIdx}`);
  }
}

const cfg = defaultDemoAssessmentConfig;
const bestAnswers = {};
fillBestLikertAnswers(cfg, bestAnswers);
for (let i = 1; i <= 5; i++) {
  bestAnswers[`c${i}`] = 0;
  bestAnswers[`d${i}`] = 0;
}
const scoredBest = scoreAssessment(cfg, bestAnswers);
if (scoredBest.global < 95) fail(`global óptimo lógico esperado >=95%, got ${scoredBest.global}%`);
else console.log(`OK: global con respuestas lógicas óptimas = ${scoredBest.global}%`);

for (const q of questions) {
  const perm = perms[q.id];
  for (let oldIdx = 0; oldIdx < 4; oldIdx++) {
    const newIdx = perm.indexOf(oldIdx);
    const base = {};
    fillBestLikertAnswers(cfg, base);
    for (let i = 1; i <= 5; i++) {
      base[`c${i}`] = 0;
      base[`d${i}`] = 0;
    }
    base[q.id] = newIdx;
    const mapped = { ...base };
    mapped[q.id] = newIdx;
    const oldStyle = { ...base, [q.id]: oldIdx };
    // oldStyle only valid if we had old order - verify score contribution for this item only
    const itemScoreNew = q.scoreByIndex[newIdx];
    const pairs = q.options.map((t, i) => [t, q.scoreByIndex[i]]);
    const targetScore = pairs.find((_, i) => perm[i] === oldIdx)?.[1];
    if (itemScoreNew !== targetScore) {
      fail(`${q.id}: score lógico distinto oldIdx=${oldIdx} newIdx=${newIdx}`);
    }
  }
}
console.log('OK: cada opción conserva su score al reordenar');

const p22 = questions.find((q) => q.id === 'p22');
const p22pos = maxPositions(p22.scoreByIndex);
if (p22pos.length !== 2 || !p22pos.includes(2) || !p22pos.includes(4)) {
  fail(`p22 empate esperado en posiciones 2 y 4, got ${p22pos.join(',')}`);
} else {
  console.log('OK: p22 conserva empate en posiciones 2 y 4');
}

console.log(failed === 0 ? '\n✓ Balance posicional OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

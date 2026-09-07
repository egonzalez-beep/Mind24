/**
 * Aplica balance posicional fijo a p1–p40 (options + scoreByIndex pareados).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDemoAssessmentConfig } from '../src/assessment/defaultDefinition.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');

const PERMS = [
  [0, 1, 2, 3],
  [1, 2, 3, 0],
  [2, 3, 0, 1],
  [3, 0, 1, 2],
  [1, 0, 3, 2],
  [2, 0, 1, 3],
  [3, 1, 2, 0],
  [0, 2, 3, 1],
  [0, 3, 1, 2],
  [1, 3, 0, 2],
  [2, 1, 3, 0],
  [3, 2, 0, 1],
];

function maxPositions(scores) {
  const max = Math.max(...scores);
  return scores.map((s, i) => (s === max ? i + 1 : null)).filter(Boolean);
}

function findPermForTargets(scores, targetPositions) {
  for (const perm of PERMS) {
    const newScores = perm.map((i) => scores[i]);
    const pos = maxPositions(newScores);
    const posSet = new Set(pos);
    if (pos.length !== targetPositions.length) continue;
    if (targetPositions.every((t) => posSet.has(t))) return perm;
  }
  return null;
}

function applyPerm(q, perm) {
  return {
    options: perm.map((i) => q.options[i]),
    scoreByIndex: perm.map((i) => q.scoreByIndex[i]),
  };
}

function buildPlan(questions) {
  const targetCounts = { 1: 10, 2: 10, 3: 10, 4: 10 };
  const slotCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const plan = new Map();

  for (const q of questions) {
    const current = maxPositions(q.scoreByIndex);
    if (current.length > 1) {
      plan.set(q.id, [0, 1, 2, 3]);
      slotCounts[2]++;
      slotCounts[4]++;
      continue;
    }
    let bestPos = null;
    let bestLoad = Infinity;
    for (const pos of [1, 2, 3, 4]) {
      if (slotCounts[pos] >= targetCounts[pos]) continue;
      if (!findPermForTargets(q.scoreByIndex, [pos])) continue;
      if (slotCounts[pos] < bestLoad) {
        bestLoad = slotCounts[pos];
        bestPos = pos;
      }
    }
    if (bestPos == null) {
      for (const pos of [1, 2, 3, 4]) {
        if (findPermForTargets(q.scoreByIndex, [pos])) {
          bestPos = pos;
          break;
        }
      }
    }
    if (bestPos == null) throw new Error(`No perm for ${q.id}`);
    plan.set(q.id, findPermForTargets(q.scoreByIndex, [bestPos]));
    slotCounts[bestPos]++;
  }
  return plan;
}

function escJs(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function patchDefinitionQuestion(src, id, options, scoreByIndex) {
  const optStr = options.map((o) => `'${escJs(o)}'`).join(', ');
  const scoreStr = scoreByIndex.join(', ');
  const re = new RegExp(
    `(id: '${id}',[\\s\\S]*?options: \\[)[^\\]]*(\\],\\s*\\n\\s*scoreByIndex: \\[)[^\\]]*(\\],)`,
    'm',
  );
  if (!re.test(src)) throw new Error(`Block not found for ${id}`);
  return src.replace(re, `$1${optStr}$2${scoreStr}$3`);
}

function patchIndexQuestion(src, id, options, scoreByIndex) {
  const optStr = options.map((o) => `'${escJs(o)}'`).join(',');
  const scoreStr = scoreByIndex.join(',');
  const re = new RegExp(
    `(\\{id:'${id}'[\\s\\S]*?opciones:\\[)[^\\]]*(\\],puntajes:\\[)[^\\]]*(\\],)`,
    'm',
  );
  if (!re.test(src)) throw new Error(`Index block not found for ${id}`);
  return src.replace(re, `$1${optStr}$2${scoreStr}$3`);
}

const principal = defaultDemoAssessmentConfig.sections.find((s) => s.id === 'principal');
const original = principal.questions.map((q) => structuredClone(q));
const plan = buildPlan(original);

let defSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'assessment', 'defaultDefinition.js'), 'utf8');
let indexSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const reordered = {};
for (const q of original) {
  const perm = plan.get(q.id);
  const next = applyPerm(q, perm);
  reordered[q.id] = next;
  defSrc = patchDefinitionQuestion(defSrc, q.id, next.options, next.scoreByIndex);
  indexSrc = patchIndexQuestion(indexSrc, q.id, next.options, next.scoreByIndex);
}

fs.writeFileSync(path.join(__dirname, '..', 'src', 'assessment', 'defaultDefinition.js'), defSrc);
fs.writeFileSync(path.join(root, 'index.html'), indexSrc);
fs.writeFileSync(
  path.join(__dirname, 'principal-balance-perms.json'),
  JSON.stringify(Object.fromEntries(plan), null, 2),
);

const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
let ties = 0;
for (const q of original) {
  const n = reordered[q.id];
  const pos = maxPositions(n.scoreByIndex);
  if (pos.length > 1) ties++;
  for (const p of pos) counts[p]++;
}
console.log('Applied. New max distribution:', counts, 'ties:', ties);

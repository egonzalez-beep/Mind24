/**
 * Calcula permutaciones fijas para balancear posición del score máximo en p1–p40.
 * Uso: node server/scripts/compute-principal-balance.mjs
 */
import { defaultDemoAssessmentConfig } from '../src/assessment/defaultDefinition.js';

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

function applyPerm(q, perm) {
  const options = perm.map((i) => q.options[i]);
  const scoreByIndex = perm.map((i) => q.scoreByIndex[i]);
  return { ...q, options, scoreByIndex };
}

function maxPosAfter(scores) {
  const max = Math.max(...scores);
  return scores.map((s, i) => (s === max ? i + 1 : null)).filter(Boolean);
}

function findPermForTargets(scores, targetPositions) {
  const targets = new Set(targetPositions);
  for (const perm of PERMS) {
    const newScores = perm.map((i) => scores[i]);
    const pos = maxPosAfter(newScores);
    const posSet = new Set(pos);
    if (pos.length !== targetPositions.length) continue;
    if (targetPositions.every((t) => posSet.has(t))) return perm;
  }
  return null;
}

function auditQuestions(questions) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let ties = 0;
  for (const q of questions) {
    const pos = maxPositions(q.scoreByIndex);
    if (pos.length > 1) ties++;
    for (const p of pos) counts[p]++;
  }
  return { counts, ties, total: questions.length };
}

const principal = defaultDemoAssessmentConfig.sections.find((s) => s.id === 'principal');
const questions = principal.questions.slice();

const before = auditQuestions(questions);
console.log('BEFORE', before);

const targetCounts = { 1: 10, 2: 10, 3: 10, 4: 10 };
const slotCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };

const assignments = [];

for (const q of questions) {
  const current = maxPositions(q.scoreByIndex);
  const isTie = current.length > 1;

  if (isTie) {
    // p22: preservar empate; preferir posiciones 2 y 4 si encajan en balance
    const tieTargets = [2, 4];
    assignments.push({ id: q.id, targetPositions: tieTargets, tie: true });
    for (const t of tieTargets) slotCounts[t]++;
    continue;
  }

  let bestPos = null;
  let bestScore = Infinity;
  for (const pos of [1, 2, 3, 4]) {
    if (slotCounts[pos] >= targetCounts[pos]) continue;
    const perm = findPermForTargets(q.scoreByIndex, [pos]);
    if (!perm) continue;
    const load = slotCounts[pos];
    if (load < bestScore) {
      bestScore = load;
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
  if (bestPos == null) throw new Error(`No permutation for ${q.id}`);
  assignments.push({ id: q.id, targetPositions: [bestPos], tie: false });
  slotCounts[bestPos]++;
}

console.log('Slot counts', slotCounts);
console.log('Assignments sample', assignments.slice(0, 5));

const reordered = questions.map((q) => {
  const a = assignments.find((x) => x.id === q.id);
  const perm = findPermForTargets(q.scoreByIndex, a.targetPositions);
  if (!perm) throw new Error(`Failed apply ${q.id} -> ${a.targetPositions}`);
  return { perm, question: applyPerm(q, perm), assignment: a };
});

const after = auditQuestions(reordered.map((r) => r.question));
console.log('AFTER', after);

for (const { question: nq, perm } of reordered) {
  const oq = questions.find((q) => q.id === nq.id);
  const oldPairs = oq.options.map((t, i) => `${t}|${oq.scoreByIndex[i]}`);
  const newPairs = nq.options.map((t, i) => `${t}|${nq.scoreByIndex[i]}`);
  oldPairs.sort();
  newPairs.sort();
  if (JSON.stringify(oldPairs) !== JSON.stringify(newPairs)) {
    throw new Error(`Pair mismatch ${nq.id}`);
  }
  if (perm.join(',') === '0,1,2,3') continue;
  console.log(`${nq.id}: perm [${perm.join(',')}] -> max at ${maxPositions(nq.scoreByIndex).join(',')}`);
}

export const principalReorderPlan = reordered.map(({ question, perm, assignment }) => ({
  id: question.id,
  perm,
  assignment,
  options: question.options,
  scoreByIndex: question.scoreByIndex,
}));

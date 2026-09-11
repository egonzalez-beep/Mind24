/**
 * Regresión — análisis interpretativo Cleaver Enterprise Fase 1.
 * Ejecutar: node server/scripts/test-cleaver-profile-analysis.mjs
 */
import { scoreCleaverResponses } from '../src/services/cleaverScoring.service.js';
import {
  analyzeCleaverProfile,
  CLEAVER_LOW_DIFF_SPREAD_THRESHOLD,
  computeCleaverSpread,
  formatCleaverRankingLine,
  rankCleaverTotal,
} from '../src/reports/cleaverProfileAnalysis.js';
import { buildCleaverModuleFragment } from '../src/reports/cleaverReport.fragment.js';

let failed = 0;

function check(cond, msg) {
  if (cond) console.log(`  OK  ${msg}`);
  else {
    console.log(`  FAIL ${msg}`);
    failed++;
  }
}

function totalCase(label, total, expect) {
  const a = analyzeCleaverProfile(total);
  console.log(`\n--- ${label} ---`);
  console.log(`  code: ${a.profileCodeDisplay} | pattern: ${a.pattern} | spread: ${a.spread}`);
  console.log(`  primary: ${a.primary.keys.join(',')} | secondary: ${a.hasSecondary ? a.secondary.keys.join(',') : '—'}`);
  console.log(`  ranking: ${formatCleaverRankingLine(a.ranking)}`);
  console.log(`  synthesis (${a.synthesis.length} chars): ${a.synthesis.slice(0, 120)}…`);

  if (expect.code) check(a.profileCodeDisplay === expect.code, `${label}: código ${expect.code}`);
  if (expect.pattern) check(a.pattern === expect.pattern, `${label}: pattern ${expect.pattern}`);
  if (expect.primary) check(a.primary.keys.join(',') === expect.primary, `${label}: primary ${expect.primary}`);
  if (expect.spread != null) check(a.spread === expect.spread, `${label}: spread=${expect.spread}`);
  if (expect.hasSecondary === true) check(a.hasSecondary === true, `${label}: tiene secundaria`);
  if (expect.hasSecondary === false) check(a.hasSecondary === false, `${label}: sin secundaria forzada`);
  if (expect.balanced != null) check(a.isBalanced === expect.balanced, `${label}: balanced=${expect.balanced}`);
  if (expect.lowDiff != null) check(a.isLowDifferentiation === expect.lowDiff, `${label}: lowDiff=${expect.lowDiff}`);
  if (expect.rankingIncludes) check(formatCleaverRankingLine(a.ranking).includes(expect.rankingIncludes), `${label}: ranking contiene "${expect.rankingIncludes}"`);
  if (expect.synthesisExcludes) check(!a.synthesis.includes(expect.synthesisExcludes), `${label}: sin "${expect.synthesisExcludes}"`);
  if (expect.sentencesMin) {
    const sentences = a.synthesis.split(/(?<=[.!?])\s+/).filter(Boolean);
    check(sentences.length >= expect.sentencesMin, `${label}: ≥${expect.sentencesMin} oraciones`);
  }
  return a;
}

console.log('\n=== Cleaver — análisis de perfil (Fase 1) ===\n');

totalCase('D claro', { D: 8, I: 0, S: -2, C: 1 }, {
  code: 'D / C',
  pattern: 'clear',
  primary: 'D',
  spread: 10,
  hasSecondary: true,
  balanced: false,
  lowDiff: false,
  sentencesMin: 3,
});

totalCase('I claro', { D: -1, I: 7, S: 0, C: -2 }, {
  code: 'I / S',
  pattern: 'clear',
  primary: 'I',
  spread: 9,
  hasSecondary: true,
  balanced: false,
  lowDiff: false,
  sentencesMin: 3,
});

totalCase('S claro', { D: -2, I: -1, S: 6, C: 0 }, {
  code: 'S / C',
  pattern: 'clear',
  primary: 'S',
  hasSecondary: true,
  balanced: false,
  lowDiff: false,
  sentencesMin: 3,
});

totalCase('C claro', { D: 0, I: -1, S: -2, C: 7 }, {
  code: 'C / D',
  pattern: 'clear',
  primary: 'C',
  hasSecondary: true,
  balanced: false,
  lowDiff: false,
  sentencesMin: 3,
});

totalCase('D/I spread=8', { D: 6, I: 4, S: -2, C: 0 }, {
  code: 'D / I',
  pattern: 'clear',
  primary: 'D',
  spread: 8,
  hasSecondary: true,
  rankingIncludes: 'D (+6) › I (+4) › C (0) › S (-2)',
  sentencesMin: 3,
});

check(
  computeCleaverSpread({ D: 6, I: 4, S: -2, C: 0 }) === 8,
  'computeCleaverSpread: 6 − (−2) = 8',
);

totalCase('D/C', { D: 5, C: 3, I: 0, S: -1 }, {
  code: 'D / C',
  pattern: 'clear',
  primary: 'D',
  hasSecondary: true,
  sentencesMin: 3,
});

totalCase('I/S', { I: 5, S: 4, D: 0, C: -1 }, {
  code: 'I / S',
  pattern: 'clear',
  primary: 'I',
  hasSecondary: true,
  sentencesMin: 3,
});

totalCase('S/C', { S: 5, C: 3, I: 0, D: -2 }, {
  code: 'S / C',
  pattern: 'clear',
  primary: 'S',
  hasSecondary: true,
  sentencesMin: 3,
});

totalCase('empate 1er lugar D=I', { D: 5, I: 5, S: -1, C: 0 }, {
  code: 'D · I',
  pattern: 'primary_tie',
  primary: 'D,I',
  hasSecondary: false,
  balanced: false,
  lowDiff: false,
  rankingIncludes: 'D (+5) = I (+5)',
  sentencesMin: 3,
});

totalCase('co-dominancia D=I S=0 C=-2', { D: 5, I: 5, S: 0, C: -2 }, {
  code: 'D · I',
  pattern: 'primary_tie',
  primary: 'D,I',
  balanced: false,
  lowDiff: false,
  rankingIncludes: 'D (+5) = I (+5)',
  sentencesMin: 3,
});

totalCase('co-dominancia triple NO equilibrado', { D: 5, I: 5, S: 5, C: -5 }, {
  code: 'D · I · S',
  pattern: 'primary_tie',
  primary: 'D,I,S',
  balanced: false,
  lowDiff: false,
  spread: 10,
  rankingIncludes: 'D (+5) = I (+5) = S (+5)',
  synthesisExcludes: 'entrevista estructurada',
  sentencesMin: 3,
});

totalCase('empate 2do lugar', { D: 6, I: 3, S: 3, C: -1 }, {
  code: 'D / I · S',
  pattern: 'secondary_tie',
  primary: 'D',
  hasSecondary: true,
  rankingIncludes: 'I (+3) = S (+3)',
  sentencesMin: 3,
});

totalCase('perfil equilibrado simétrico', { D: 2, I: 2, S: 2, C: 2 }, {
  code: 'Equilibrado',
  pattern: 'balanced',
  balanced: true,
  lowDiff: false,
  spread: 0,
  hasSecondary: false,
  rankingIncludes: 'D (+2) = I (+2) = S (+2) = C (+2)',
  sentencesMin: 2,
});

totalCase('poco diferenciado', { D: 2, I: 1, S: 1, C: 0 }, {
  code: 'Poco diferenciado',
  pattern: 'low_differentiation',
  balanced: false,
  lowDiff: true,
  spread: 2,
  hasSecondary: true,
  synthesisExcludes: 'entrevista estructurada',
  sentencesMin: 3,
});

totalCase('valores negativos', { D: -4, I: -2, S: 1, C: 0 }, {
  code: 'S / C',
  pattern: 'clear',
  primary: 'S',
  hasSecondary: true,
  sentencesMin: 3,
});

const detTotal = { D: 6, I: -1, S: -3, C: 2 };
const a1 = analyzeCleaverProfile(detTotal);
const a2 = analyzeCleaverProfile(detTotal);
check(JSON.stringify(a1) === JSON.stringify(a2), 'orden determinista — mismo input, mismo output');

const rank1 = rankCleaverTotal(detTotal);
check(rank1.map((r) => r.key).join(',') === 'D,C,I,S', 'ranking sort estable D,C,I,S');

const tieRank = formatCleaverRankingLine(rankCleaverTotal({ D: 5, I: 5, S: 0, C: -2 }));
check(tieRank === 'D (+5) = I (+5) › S (0) › C (-2)', `ranking empate: ${tieRank}`);

const secTieRank = formatCleaverRankingLine(rankCleaverTotal({ D: 6, I: 3, S: 3, C: -1 }));
check(secTieRank.includes('I (+3) = S (+3)'), 'ranking empate secundario con =');

const html = buildCleaverModuleFragment({
  scores: { most: { D: 8, I: 4, S: 3, C: 5 }, least: { D: 2, I: 5, S: 6, C: 3 }, total: detTotal },
  submittedAt: '10/09/2026',
});
check(html.includes('cle-exec'), 'PDF: bloque ejecutivo enterprise');
check(html.includes('Resultado ejecutivo'), 'PDF: sección ejecutiva');
check(!html.includes('module-icon">🎯'), 'PDF: sin emoji legacy');
check(html.includes('Perfil neto'), 'PDF: terminología perfil neto');
check(html.includes('cle-triad'), 'PDF: tríada M/L/T Fase 2');
check(!html.includes('bajo presión'), 'PDF: sin copy legacy bajo presión');
check(!html.includes('Vector de cambio conductual'), 'PDF: sin sección legacy vector');

console.log('\n--- Scoring intacto ---');
const baseline = scoreCleaverResponses([
  {
    questionId: 'q1',
    moreOptionId: 'a',
    lessOptionId: 'b',
    moreOption: {
      id: 'a',
      metadata: { keySchema: 'ml_v1', dimensionMore: 'D', dimensionLess: null },
    },
    lessOption: {
      id: 'b',
      metadata: { keySchema: 'ml_v1', dimensionMore: 'I', dimensionLess: 'I' },
    },
  },
]);
check(baseline.total.D === 1 && baseline.total.I === -1, 'scoring: total = most − least');
check(baseline.most.D === 1 && baseline.least.I === 1, 'scoring: most/least sin cambio');

console.log(`\nUmbral poco diferenciado: spread ≤ ${CLEAVER_LOW_DIFF_SPREAD_THRESHOLD}`);
console.log(failed === 0 ? '\n✓ Todos los escenarios pasaron.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * Regresión — reporte Cleaver Enterprise Fase 2.
 * Ejecutar: node server/scripts/test-cleaver-report-phase2.mjs
 */
import { scoreCleaverResponses } from '../src/services/cleaverScoring.service.js';
import { analyzeCleaverProfile } from '../src/reports/cleaverProfileAnalysis.js';
import { buildCleaverRhReading } from '../src/reports/cleaverRhInterpretation.js';
import { buildCleaverModuleFragment } from '../src/reports/cleaverReport.fragment.js';

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

const FORBIDDEN = [
  'bajo presión',
  'Bajo presión',
  'BAJO PRESIÓN',
  'Vector de cambio conductual',
  'motivación',
  'motivador',
  'comportamiento natural',
  'máscara',
  'adaptación psicológica',
  'keySources',
];

function assertNoForbidden(html, label) {
  for (const term of FORBIDDEN) {
    check(!html.includes(term), `${label}: sin "${term}"`);
  }
}

function buildFragment(total, most = null, least = null, meta) {
  const m = most ?? { D: total.D + 4, I: total.I + 3, S: total.S + 3, C: total.C + 3 };
  const l = least ?? { D: 4, I: 3, S: 3, C: 3 };
  const scores = { most: m, least: l, total };
  if (meta !== undefined) scores.meta = meta;
  return buildCleaverModuleFragment({
    scores,
    submittedAt: '11/09/2026',
  });
}

function scenario(label, total, expect) {
  console.log(`\n--- ${label} ---`);
  const analysis = analyzeCleaverProfile(total);
  const rh = buildCleaverRhReading(
    analysis,
    total,
    expect.most ?? { D: 8, I: 4, S: 3, C: 5 },
    expect.least ?? { D: 2, I: 5, S: 6, C: 3 },
  );
  const html = buildFragment(total, expect.most, expect.least, expect.meta);

  if (expect.code) check(analysis.profileCodeDisplay === expect.code, `${label}: código ${expect.code}`);
  if (expect.pattern) check(analysis.pattern === expect.pattern, `${label}: pattern ${expect.pattern}`);

  check(rh.strengths.length >= 2 && rh.strengths.length <= 3, `${label}: 2–3 fortalezas`);
  check(rh.attention.length >= 2 && rh.attention.length <= 3, `${label}: 2–3 puntos de atención`);
  check(Boolean(rh.areas.communication), `${label}: bloque comunicación`);
  check(Boolean(rh.areas.decisions), `${label}: bloque decisiones`);
  check(Boolean(rh.areas.norms), `${label}: bloque normas`);
  check(Boolean(rh.areas.teamwork), `${label}: bloque teamwork`);

  if (expect.strengthIncludes) {
    check(
      rh.strengths.some((s) => s.includes(expect.strengthIncludes)),
      `${label}: fortaleza contiene "${expect.strengthIncludes}"`,
    );
  }
  if (expect.pairDistinct) {
    check(rh.areas.communication !== expect.pairDistinct, `${label}: lectura distinta a ${expect.pairDistinct}`);
  }

  check(html.includes('cle-triad'), `${label}: tríada M/L/T`);
  check(html.includes('cle-mlt-panel'), `${label}: paneles M/L/T`);
  check(html.includes('Fortalezas conductuales'), `${label}: sección fortalezas`);
  check(html.includes('Puntos de atención'), `${label}: sección atención`);
  check(html.includes('Comunicación e interacción'), `${label}: área comunicación`);
  check(html.includes('Referencia técnica'), `${label}: zona técnica`);
  check(html.includes('cle-tech-table'), `${label}: tabla técnica`);
  check(!html.includes('change-grid'), `${label}: sin bloque legacy change-grid`);
  check(!html.includes('Perfil radar'), `${label}: sin radar redundante`);

  assertNoForbidden(html, label);

  if (expect.htmlIncludes) {
    for (const s of expect.htmlIncludes) check(html.includes(s), `${label}: HTML contiene "${s}"`);
  }
}

console.log('\n=== Cleaver — reporte Enterprise Fase 2 ===\n');

scenario('D/I claro', { D: 6, I: 4, C: 0, S: -2 }, {
  code: 'D / I',
  pattern: 'clear',
  strengthIncludes: 'iniciativa',
});

scenario('D/C claro', { D: 5, C: 3, I: 0, S: -1 }, {
  code: 'D / C',
  pattern: 'clear',
  strengthIncludes: 'calidad',
});

scenario('I/S claro', { I: 5, S: 4, D: 0, C: -1 }, {
  code: 'I / S',
  pattern: 'clear',
  strengthIncludes: 'calidez',
});

scenario('S/C claro', { S: 5, C: 3, I: 0, D: -2 }, {
  code: 'S / C',
  pattern: 'clear',
  strengthIncludes: 'constancia',
});

scenario('C/D claro', { C: 7, D: 0, I: -1, S: -2 }, {
  code: 'C / D',
  pattern: 'clear',
  strengthIncludes: 'precisión',
});

scenario('co-dominancia D=I', { D: 5, I: 5, S: 0, C: -2 }, {
  code: 'D · I',
  pattern: 'primary_tie',
  strengthIncludes: 'combinar',
});

scenario('perfil equilibrado', { D: 2, I: 2, S: 2, C: 2 }, {
  code: 'Equilibrado',
  pattern: 'balanced',
  strengthIncludes: 'flexibilidad',
});

scenario('poco diferenciado', { D: 2, I: 1, S: 1, C: 0 }, {
  code: 'Poco diferenciado',
  pattern: 'low_differentiation',
  strengthIncludes: 'versatilidad',
});

scenario('dimensiones negativas', { D: -4, I: -2, S: 1, C: 0 }, {
  code: 'S / C',
  pattern: 'clear',
});

console.log('\n--- M/L/T valores distintos ---');
const distinctHtml = buildFragment(
  { D: 8, I: -2, S: 3, C: -1 },
  { D: 10, I: 2, S: 6, C: 4 },
  { D: 2, I: 4, S: 3, C: 5 },
);
check(distinctHtml.includes('cle-mlt-panel-title">Más'), 'M/L/T: panel Más');
check(distinctHtml.includes('cle-mlt-panel-title">Menos'), 'M/L/T: panel Menos');
check(distinctHtml.includes('cle-mlt-panel-title">Perfil neto'), 'M/L/T: panel Perfil neto');
check(distinctHtml.includes('>10<') || distinctHtml.includes('>10</'), 'M/L/T: valor most D=10');
check(distinctHtml.includes('>-2<') || distinctHtml.includes('>-2</'), 'M/L/T: valor total I=-2');
check(distinctHtml.includes('width:42%'), 'M/L/T: escala fija — most D=10 → 42% (10/24)');
check(distinctHtml.includes('cle-mlt-zero'), 'M/L/T: marca de cero en perfil neto');

console.log('\n--- tabla técnica y meta ---');
const metaHtml = buildFragment(
  { D: 6, I: 4, C: 0, S: -2 },
  { D: 8, I: 4, S: 3, C: 5 },
  { D: 2, I: 5, S: 6, C: 3 },
  { tetradCount: 24, unscoredMore: 2, unscoredLess: 0 },
);
check(metaHtml.includes('24/24 tétradas completadas'), 'meta: tétradas');
check(metaHtml.includes('2 selección(es) Más sin puntuación'), 'meta: unscored Más');
check(!metaHtml.includes('unscoredLess'), 'meta: no muestra unscoredLess cuando es 0');
check(metaHtml.includes('<td class="num">8</td>'), 'tabla: most D');
check(metaHtml.includes('<td class="num strong">+6</td>') || metaHtml.includes('<td class="num strong">6</td>'), 'tabla: total D');

console.log('\n--- meta sin tetradCount ---');
const noMetaHtml = buildFragment(
  { D: 6, I: 4, C: 0, S: -2 },
  { D: 8, I: 4, S: 3, C: 5 },
  { D: 2, I: 5, S: 6, C: 3 },
  undefined,
);
check(!noMetaHtml.includes('tétradas completadas'), 'meta: omite completitud si no hay tetradCount');
check(noMetaHtml.includes('cle-tech-table'), 'meta: tabla técnica sigue presente sin meta');

console.log('\n--- D/I vs D/C lecturas distintas ---');
const diRh = buildCleaverRhReading(
  analyzeCleaverProfile({ D: 6, I: 4, C: 0, S: -2 }),
  { D: 6, I: 4, C: 0, S: -2 },
  { D: 8, I: 6, S: 3, C: 4 },
  { D: 2, I: 2, S: 3, C: 4 },
);
const dcRh = buildCleaverRhReading(
  analyzeCleaverProfile({ D: 5, C: 3, I: 0, S: -1 }),
  { D: 5, C: 3, I: 0, S: -1 },
  { D: 8, I: 4, S: 3, C: 5 },
  { D: 2, I: 5, S: 6, C: 3 },
);
check(diRh.areas.communication !== dcRh.areas.communication, 'D/I vs D/C: comunicación distinta');
check(diRh.areas.norms !== dcRh.areas.norms, 'D/I vs D/C: normas distintas');
check(diRh.strengths[0] !== dcRh.strengths[0], 'D/I vs D/C: fortalezas distintas');

console.log('\n--- scoring intacto ---');
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

console.log(failed === 0 ? '\n✓ Fase 2 — todos los escenarios pasaron.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

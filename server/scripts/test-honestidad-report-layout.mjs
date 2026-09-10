/**
 * Genera HTML de muestra del módulo Honestidad (normal, baja confiabilidad, inválida).
 * Ejecutar: node server/scripts/test-honestidad-report-layout.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDemoAssessmentConfig } from '../src/assessment/defaultDefinition.js';
import { scoreAssessment } from '../src/services/scoring.service.js';
import {
  applyHonestidadCalibrationReliabilityLayer,
  applyHonestidadSpeedReliabilityLayer,
  computeHonestidadDurationReliability,
} from '../src/services/attemptReliability.service.js';
import { buildHonestidadModuleFragment } from '../src/reports/honestidadReport.fragment.js';
import { buildUnifiedReportHtml } from '../src/reports/unifiedReport.template.js';
import { fillBestLikertAnswers } from './honestidadTestHelpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'output');

function buildAnswers({ errCal = 0, negDir = 0 } = {}) {
  const answers = {};
  ['c1', 'c2', 'c3', 'c4', 'c5'].forEach((id, i) => {
    answers[id] = i < errCal ? 1 : 0;
  });
  ['d1', 'd2', 'd3', 'd4', 'd5'].forEach((id, i) => {
    answers[id] = i < negDir ? 1 : 0;
  });
  fillBestLikertAnswers(defaultDemoAssessmentConfig, answers);
  return answers;
}

function layerAnswers(opts, elapsedSec = 240) {
  const scored = scoreAssessment(defaultDemoAssessmentConfig, buildAnswers(opts));
  const cal = applyHonestidadCalibrationReliabilityLayer({
    scored,
    flags: scored.flags,
    moduleKey: 'honestidad',
  });
  const startedAt = new Date('2026-01-01T12:00:00Z');
  const submittedAt = new Date(startedAt.getTime() + elapsedSec * 1000);
  const speedRel = computeHonestidadDurationReliability({ startedAt, submittedAt });
  return applyHonestidadSpeedReliabilityLayer({
    scored: cal.scores,
    flags: cal.flags,
    interpretation: cal.interpretation,
    reliability: speedRel,
    moduleKey: 'honestidad',
  });
}

const scenarios = [
  { slug: 'normal', label: 'Caso normal (Aprobatorio)', opts: {} },
  { slug: 'low-cal', label: 'Baja confiabilidad calibración', opts: { errCal: 3 } },
  { slug: 'invalid-neg', label: 'No interpretable (negDir=5)', opts: { negDir: 5 } },
];

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

for (const sc of scenarios) {
  const out = layerAnswers(sc.opts, sc.slug === 'invalid-neg' ? 240 : 240);
  const fragment = buildHonestidadModuleFragment({
    payload: {
      global: out.scores.global,
      dimensions: out.scores.dimensions,
      meta: out.scores.meta,
      interpretation: out.interpretation,
      flags: out.flags,
    },
    submittedAt: '09/09/2026 19:55',
  });

  const moduleOnly = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>Honestidad ${sc.slug}</title></head><body>${fragment}</body></html>`;
  const modulePath = path.join(OUT, `honestidad-${sc.slug}.html`);
  fs.writeFileSync(modulePath, moduleOnly, 'utf8');

  const unified = buildUnifiedReportHtml({
    organizationName: 'Demo Enterprise',
    candidateName: 'Candidato Demo',
    puesto: 'Analista',
    curp: '—',
    modulesAppliedLine: 'Honestidad (Mind24)',
    moduleCount: 1,
    completedAt: '09/09/2026',
    moduleCoverSummaries: [
      {
        moduleKey: 'honestidad',
        title: 'Honestidad (Mind24)',
        lines: [
          { label: 'Veredicto', value: out.interpretation.verdict },
          { label: 'Índice global', value: `${out.scores.global}%` },
        ],
      },
    ],
    moduleFragmentsHtml: fragment,
    generatedDate: '2026-09-09',
    logoDataUri: null,
  });
  const unifiedPath = path.join(OUT, `honestidad-${sc.slug}-full.html`);
  fs.writeFileSync(unifiedPath, unified, 'utf8');
  console.log(`✓ ${sc.label} → ${path.basename(unifiedPath)}`);
}

console.log(`\nMuestras en ${OUT}`);

import {
  SJT_SALES_MAX_POINTS,
  SJT_SALES_SCENARIO_COUNT,
  SJT_SALES_SCENARIOS,
} from '../data/sjtSalesData.js';

function performanceLevel(percent) {
  if (percent >= 90) return 'Excelente';
  if (percent >= 75) return 'Sólido';
  if (percent >= 60) return 'En desarrollo';
  return 'Requiere refuerzo';
}

/**
 * Califica respuestas SJT sumando puntos de la opción elegida (0–5 por escenario).
 * @param {Array<{ question: object, selectedOption: object|null }>} rows
 */
export function scoreSjtSalesResponses(rows) {
  const scenarioMap = {};
  for (const s of SJT_SALES_SCENARIOS) {
    scenarioMap[s.scenarioId] = {
      scenarioId: s.scenarioId,
      competence: s.competence,
      points: 0,
      maxPoints: Math.max(...s.options.map((o) => o.points), 0),
    };
  }

  let rawScore = 0;
  let maxPossible = 0;

  for (const row of rows) {
    const meta = row.question?.metadata;
    if (!meta || typeof meta !== 'object') continue;
    const scenarioId = meta.scenarioId;
    const entry = scenarioMap[scenarioId];
    if (!entry) continue;

    const optMeta = row.selectedOption?.metadata;
    const points =
      optMeta && typeof optMeta === 'object' && Number.isFinite(Number(optMeta.points))
        ? Number(optMeta.points)
        : 0;

    entry.points = points;
    rawScore += points;
    maxPossible += entry.maxPoints || 5;
  }

  const expectedScenarios = SJT_SALES_SCENARIO_COUNT;
  if (maxPossible < expectedScenarios * 5) {
    maxPossible = SJT_SALES_MAX_POINTS;
  }

  const scenarios = SJT_SALES_SCENARIOS.map((s) => {
    const entry = scenarioMap[s.scenarioId];
    const maxPts = entry.maxPoints || 5;
    const pts = entry.points || 0;
    const percent = maxPts > 0 ? Math.round((pts / maxPts) * 1000) / 10 : 0;
    return {
      scenarioId: s.scenarioId,
      competence: s.competence,
      points: pts,
      maxPoints: maxPts,
      percent,
    };
  });

  const percentScore =
    maxPossible > 0 ? Math.round((rawScore / maxPossible) * 1000) / 10 : 0;

  const strongest = [...scenarios].sort((a, b) => b.percent - a.percent)[0];
  const weakest = [...scenarios].sort((a, b) => a.percent - b.percent)[0];

  return {
    rawScore,
    maxPossible: maxPossible || SJT_SALES_MAX_POINTS,
    totalScenarios: expectedScenarios,
    percentScore,
    performanceLevel: performanceLevel(percentScore),
    scenarios,
    strongestCompetence: strongest?.competence || null,
    weakestCompetence: weakest?.competence || null,
  };
}

export function buildSjtSalesAttemptScores(scoring) {
  return {
    instrument: 'sales_sjt',
    scores: {
      rawScore: scoring.rawScore,
      maxPossible: scoring.maxPossible,
      totalScenarios: scoring.totalScenarios,
      percentScore: scoring.percentScore,
      performanceLevel: scoring.performanceLevel,
      scenarios: scoring.scenarios,
      strongestCompetence: scoring.strongestCompetence,
      weakestCompetence: scoring.weakestCompetence,
    },
    meta: {
      scoredAt: new Date().toISOString(),
      engine: 'sales_sjt',
    },
  };
}

import {
  SJT_SALES_MAX_POINTS,
  SJT_SALES_SCENARIO_COUNT,
  SJT_SALES_SCENARIOS,
} from '../data/sjtSalesData.js';

/** Macro-competencias comerciales (agrupan los 15 escenarios). */
export const SJT_SALES_MACRO_GROUPS = [
  {
    key: 'prospeccion_apertura',
    label: 'Prospección y Apertura',
    scenarioIds: ['sjt_sales_2', 'sjt_sales_5', 'sjt_sales_11'],
  },
  {
    key: 'negociacion_cierre',
    label: 'Negociación y Cierre',
    scenarioIds: ['sjt_sales_1', 'sjt_sales_3', 'sjt_sales_12', 'sjt_sales_13', 'sjt_sales_14'],
  },
  {
    key: 'fidelizacion_retencion',
    label: 'Fidelización y Retención',
    scenarioIds: ['sjt_sales_7', 'sjt_sales_8', 'sjt_sales_15'],
  },
  {
    key: 'etica_crisis',
    label: 'Ética y Manejo de Crisis',
    scenarioIds: ['sjt_sales_4', 'sjt_sales_6', 'sjt_sales_9', 'sjt_sales_10'],
  },
];

/** Perfiles comerciales oficiales según puntaje bruto (0–75). */
export const SJT_SALES_PROFILE_TIERS = [
  {
    min: 57,
    max: 75,
    key: 'consultor_estrategico',
    label: 'Consultor Estratégico',
    description:
      'Orientado a la creación de valor mutuo. Tiende a negociar basándose en datos y rentabilidad, priorizando la relación a largo plazo y manteniendo un alto estándar ético.',
  },
  {
    min: 42,
    max: 56,
    key: 'ejecutivo_cierre_agil',
    label: 'Ejecutivo de Cierre Ágil',
    description:
      'Orientado a resultados inmediatos y volumen. Muestra fuerte iniciativa para acelerar el ciclo de ventas. Podría priorizar concesiones comerciales bajo presión.',
  },
  {
    min: 27,
    max: 41,
    key: 'especialista_fidelizacion',
    label: 'Especialista en Fidelización',
    description:
      'Altamente empático y enfocado en el servicio al cliente. Excelente para mantener cuentas existentes, aunque podría mostrar cautela ante prospección en frío.',
  },
  {
    min: 0,
    max: 26,
    key: 'asesor_operativo',
    label: 'Asesor Operativo',
    description:
      'Perfil estructurado. Prefiere seguir flujos establecidos y permitir que el cliente guíe el ritmo de compra. Requiere acompañamiento para resolución de objeciones complejas.',
  },
];

/**
 * @param {number} rawScore Puntaje bruto 0–75
 */
/**
 * Agrupa puntajes por escenario en las 4 macro-competencias.
 * @param {Array<{ scenarioId: string, points?: number, maxPoints?: number }>} scenarios
 */
export function computeSjtSalesMacroCompetencies(scenarios) {
  const byId = new Map();
  for (const s of scenarios || []) {
    if (!s?.scenarioId) continue;
    byId.set(s.scenarioId, {
      points: Number(s.points) || 0,
      maxPoints: Number(s.maxPoints) || 5,
    });
  }

  return SJT_SALES_MACRO_GROUPS.map((group) => {
    let rawScore = 0;
    let maxPossible = 0;
    for (const scenarioId of group.scenarioIds) {
      const row = byId.get(scenarioId);
      if (!row) continue;
      rawScore += row.points;
      maxPossible += row.maxPoints;
    }
    const percent =
      maxPossible > 0 ? Math.round((rawScore / maxPossible) * 1000) / 10 : 0;
    return {
      key: group.key,
      label: group.label,
      rawScore,
      maxPossible,
      percent,
      scenarioIds: [...group.scenarioIds],
    };
  });
}

export function resolveSjtSalesProfile(rawScore) {
  const score = Math.max(
    0,
    Math.min(SJT_SALES_MAX_POINTS, Math.round(Number(rawScore) || 0)),
  );
  const tier = SJT_SALES_PROFILE_TIERS.find((t) => score >= t.min && score <= t.max);
  return tier || SJT_SALES_PROFILE_TIERS[SJT_SALES_PROFILE_TIERS.length - 1];
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

  const profile = resolveSjtSalesProfile(rawScore);
  const macroCompetencies = computeSjtSalesMacroCompetencies(scenarios);
  const strongestMacro = [...macroCompetencies].sort((a, b) => b.rawScore - a.rawScore)[0];
  const weakestMacro = [...macroCompetencies].sort((a, b) => a.rawScore - b.rawScore)[0];

  return {
    rawScore,
    maxPossible: maxPossible || SJT_SALES_MAX_POINTS,
    totalScenarios: expectedScenarios,
    percentScore,
    profileKey: profile.key,
    profileLabel: profile.label,
    profileDescription: profile.description,
    scenarios,
    macroCompetencies,
    strongestCompetence: strongestMacro?.label || null,
    weakestCompetence: weakestMacro?.label || null,
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
      profileKey: scoring.profileKey,
      profileLabel: scoring.profileLabel,
      profileDescription: scoring.profileDescription,
      scenarios: scoring.scenarios,
      macroCompetencies: scoring.macroCompetencies,
      strongestCompetence: scoring.strongestCompetence,
      weakestCompetence: scoring.weakestCompetence,
    },
    meta: {
      scoredAt: new Date().toISOString(),
      engine: 'sales_sjt',
    },
  };
}

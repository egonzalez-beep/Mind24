import { TERMAN_MAX_RAW_SCORE } from '../data/termanData.js';

/** Agrupación editorial descriptiva (no factores normativos). */
export const TERMAN_DESCRIPTIVE_GROUPS = {
  VERBAL: {
    label: 'Verbal',
    color: '#2563EB',
    bg: '#DBEAFE',
    series: ['serie_1', 'serie_3', 'serie_7', 'serie_8'],
  },
  LOGICO: {
    label: 'Lógico-Analítico',
    color: '#7C3AED',
    bg: '#EDE9FE',
    series: ['serie_2', 'serie_4', 'serie_6', 'serie_9'],
  },
  NUMERICO: {
    label: 'Numérico',
    color: '#059669',
    bg: '#D1FAE5',
    series: ['serie_5', 'serie_10'],
  },
};

export const TERMAN_DESCRIPTIVE_GROUP_NOTE =
  'Estas agrupaciones organizan los resultados por afinidad temática y no representan factores psicométricos normativos.';

const SERIES_ORDER = [
  'serie_1',
  'serie_2',
  'serie_3',
  'serie_4',
  'serie_5',
  'serie_6',
  'serie_7',
  'serie_8',
  'serie_9',
  'serie_10',
];

function stableSeriesOrder(a, b) {
  const ia = SERIES_ORDER.indexOf(a);
  const ib = SERIES_ORDER.indexOf(b);
  if (ia === -1 && ib === -1) return String(a).localeCompare(String(b));
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

/**
 * @typedef {{
 *   seriesId: string,
 *   name: string,
 *   correct: number,
 *   total: number,
 *   percent: number,
 *   rank: number,
 *   tiedKeys: string[],
 * }} TermanSeriesRankEntry
 */

function normalizeSeriesEntry(raw) {
  return {
    seriesId: String(raw?.seriesId || ''),
    name: String(raw?.name || raw?.seriesId || 'Serie'),
    correct: Number(raw?.correct) || 0,
    total: Number(raw?.total) || 0,
    percent: Number(raw?.percent) || 0,
  };
}

/**
 * @param {Array<object>} series
 * @returns {TermanSeriesRankEntry[]}
 */
export function rankTermanSeries(series) {
  const normalized = (Array.isArray(series) ? series : [])
    .map(normalizeSeriesEntry)
    .filter((s) => s.seriesId || s.name);

  const sorted = [...normalized].sort((a, b) => {
    if (b.percent !== a.percent) return b.percent - a.percent;
    return stableSeriesOrder(a.seriesId, b.seriesId);
  });

  const ranking = [];
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].percent < sorted[i - 1].percent) rank = i + 1;
    const tied = sorted.filter((e) => e.percent === sorted[i].percent).map((e) => e.seriesId);
    tied.sort(stableSeriesOrder);
    ranking.push({
      ...sorted[i],
      rank,
      tiedKeys: tied,
    });
  }
  return ranking;
}

function formatSeriesStat(entry) {
  const pct = entry.percent.toFixed(1);
  if (entry.total > 0) {
    return `«${entry.name}» (${pct}%; ${entry.correct}/${entry.total} aciertos)`;
  }
  return `«${entry.name}» (${pct}%)`;
}

function joinSeriesList(entries) {
  return entries.map(formatSeriesStat).join('; ');
}

function pickTopEntries(ranking, max = 3) {
  if (!ranking.length) return [];
  const topPct = ranking[0].percent;
  return ranking.filter((e) => e.percent === topPct).slice(0, max);
}

function pickBottomEntries(ranking, max = 3) {
  if (!ranking.length) return [];
  const bottomPct = ranking[ranking.length - 1].percent;
  const topPct = ranking[0].percent;
  if (bottomPct === topPct) return [];
  return ranking.filter((e) => e.percent === bottomPct).slice(0, max);
}

/** Agrupa ranking contiguo por mismo % (orden descendente preservado). */
function groupRankingByPercent(ranking) {
  const groups = [];
  for (const entry of ranking) {
    const last = groups[groups.length - 1];
    if (last && last.percent === entry.percent) {
      last.entries.push(entry);
    } else {
      groups.push({ percent: entry.percent, rank: entry.rank, entries: [entry] });
    }
  }
  return groups;
}

function pickSeriesFromGroups(groups, maxSeries, excludeIds = new Set()) {
  const picked = [];
  for (const g of groups) {
    for (const e of g.entries) {
      if (excludeIds.has(e.seriesId)) continue;
      picked.push(e);
      if (picked.length >= maxSeries) return picked;
    }
  }
  return picked;
}

/** Primeras 2 posiciones/grupos del ranking; máx. 3 series; respeta empates. */
function buildStrengthEntries(ranking) {
  const groups = groupRankingByPercent(ranking);
  if (groups.length <= 1) {
    return { entries: [], uniformDistribution: groups.length === 1 && ranking.length > 0 };
  }
  return {
    entries: pickSeriesFromGroups(groups.slice(0, 2), 3),
    uniformDistribution: false,
  };
}

/** Últimas 2 posiciones/grupos; máx. 3 series; sin repetir fortalezas. */
function buildAttentionEntries(ranking, strengthEntries) {
  const groups = groupRankingByPercent(ranking);
  if (groups.length <= 1) return [];
  const exclude = new Set(strengthEntries.map((e) => e.seriesId));
  const bottomGroups = groups.slice(-2).reverse();
  return pickSeriesFromGroups(bottomGroups, 3, exclude);
}

function strengthPhrase(entry, index) {
  const stat = formatSeriesStat(entry);
  if (index === 0) return `Mayor proporción de aciertos en ${stat}.`;
  return `Entre los resultados relativamente más sólidos se encuentra ${stat}.`;
}

function attentionPhrase(entry, index) {
  const stat = formatSeriesStat(entry);
  if (index === 0) return `Menor proporción de aciertos en ${stat}.`;
  return `Entre los resultados relativamente más bajos del intento se encuentra ${stat}.`;
}

export const TERMAN_UNIFORM_RH_MESSAGE =
  'Las series registraron la misma proporción de aciertos en este intento.';

/**
 * @param {object} scores — payload scores Terman (rawScore, percentCorrect, series, …)
 */
export function analyzeTermanCognitive(scores) {
  const rawScore = Number(scores?.rawScore) || 0;
  const totalQuestions = Number(scores?.totalQuestions) || TERMAN_MAX_RAW_SCORE;
  const percentCorrect = Number(scores?.percentCorrect) || 0;
  const ranking = rankTermanSeries(scores?.series);
  const hasSeries = ranking.length > 0;

  const topEntries = pickTopEntries(ranking, 3);
  const bottomEntries = pickBottomEntries(ranking, 3);
  const topTied = topEntries.length > 1 || (topEntries[0]?.tiedKeys?.length ?? 0) > 1;
  const bottomTied =
    bottomEntries.length > 1 || (bottomEntries[0]?.tiedKeys?.length ?? 0) > 1;

  const { entries: strengthEntries, uniformDistribution } = buildStrengthEntries(ranking);
  const uniformRhMessage = uniformDistribution ? TERMAN_UNIFORM_RH_MESSAGE : null;
  const attentionEntries = uniformDistribution
    ? []
    : buildAttentionEntries(ranking, strengthEntries);

  const strengths = strengthEntries.map((e, i) => strengthPhrase(e, i));
  const attention = attentionEntries.map((e, i) => attentionPhrase(e, i));

  const synthesisParts = [
    `El resultado global fue de ${rawScore} aciertos de ${totalQuestions} reactivos (${percentCorrect.toFixed(1)}% de aciertos).`,
  ];

  if (hasSeries) {
    if (topEntries.length) {
      const topLabel = topTied ? 'Las series con mayor proporción de aciertos fueron' : 'La serie con mayor proporción de aciertos fue';
      synthesisParts.push(`${topLabel} ${joinSeriesList(topEntries)}.`);
    }
    if (bottomEntries.length) {
      const bottomLabel = bottomTied
        ? 'Las series con menor proporción de aciertos fueron'
        : 'La serie con menor proporción de aciertos fue';
      synthesisParts.push(`${bottomLabel} ${joinSeriesList(bottomEntries)}.`);
    } else if (topEntries.length && !bottomEntries.length) {
      synthesisParts.push('Todas las series registraron la misma proporción de aciertos.');
    }
  } else {
    synthesisParts.push('No hay desglose por series disponible para este intento.');
  }

  const completionRate = Number(scores?.completionRate);
  const unansweredCount =
    scores?.unansweredCount != null
      ? Number(scores.unansweredCount)
      : Math.max(0, totalQuestions - (Number(scores?.answeredCount) || totalQuestions));
  const showCompleteness =
    scores?.answeredCount != null &&
    (unansweredCount > 0 || (Number.isFinite(completionRate) && completionRate < 100));

  const descriptiveGroups = Object.entries(TERMAN_DESCRIPTIVE_GROUPS).map(([key, cat]) => {
    const catSeries = ranking.filter((s) => cat.series.includes(s.seriesId));
    const avg =
      catSeries.length > 0
        ? catSeries.reduce((sum, s) => sum + s.percent, 0) / catSeries.length
        : null;
    return { key, ...cat, avg, series: catSeries };
  });

  return {
    rawScore,
    totalQuestions,
    percentCorrect,
    ranking,
    hasSeries,
    topEntries,
    bottomEntries,
    topTied,
    bottomTied,
    strengthEntries,
    attentionEntries,
    strengths,
    attention,
    uniformRhMessage,
    synthesis: synthesisParts.join(' '),
    showCompleteness,
    unansweredCount,
    completionRate,
    descriptiveGroups,
  };
}

export function getDescriptiveGroupForSeries(seriesId) {
  for (const cat of Object.values(TERMAN_DESCRIPTIVE_GROUPS)) {
    if (cat.series.includes(seriesId)) return cat;
  }
  return { label: 'General', color: '#6B7280', bg: '#F3F4F6' };
}

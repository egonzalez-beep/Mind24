import { SJT_SALES_MACRO_GROUPS } from '../services/sjtSalesScoring.service.js';
import { SJT_SALES_MAX_POINTS } from '../data/sjtSalesData.js';
import { resolveSjtSalesProfile } from '../services/sjtSalesScoring.service.js';

export const SJT_UNIFORM_AREA_RH_MESSAGE =
  'Los resultados por área presentan una distribución uniforme en este intento.';

const AREA_KEY_ORDER = SJT_SALES_MACRO_GROUPS.map((g) => g.key);

function stableAreaKeyOrder(a, b) {
  const ia = AREA_KEY_ORDER.indexOf(a.key);
  const ib = AREA_KEY_ORDER.indexOf(b.key);
  if (ia === -1 && ib === -1) return String(a.key).localeCompare(String(b.key));
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

function normalizeArea(raw) {
  return {
    key: String(raw?.key || ''),
    label: String(raw?.label || raw?.key || 'Área'),
    rawScore: Number(raw?.rawScore) || 0,
    maxPossible: Number(raw?.maxPossible) || 0,
    percent: Number(raw?.percent) || 0,
  };
}

/**
 * @param {Array<object>} macroCompetencies
 */
export function rankSjtMacroAreas(macroCompetencies) {
  const normalized = (Array.isArray(macroCompetencies) ? macroCompetencies : [])
    .map(normalizeArea)
    .filter((a) => a.key || a.label);

  const sorted = [...normalized].sort((a, b) => {
    if (b.percent !== a.percent) return b.percent - a.percent;
    return stableAreaKeyOrder(a, b);
  });

  const ranking = [];
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].percent < sorted[i - 1].percent) rank = i + 1;
    const tied = sorted.filter((e) => e.percent === sorted[i].percent).map((e) => e.key);
    tied.sort((a, b) => AREA_KEY_ORDER.indexOf(a) - AREA_KEY_ORDER.indexOf(b));
    ranking.push({
      ...sorted[i],
      rank,
      tiedKeys: tied,
    });
  }
  return ranking;
}

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

function pickAreasFromGroups(groups, maxAreas, excludeKeys = new Set()) {
  const picked = [];
  for (const g of groups) {
    for (const e of g.entries) {
      if (excludeKeys.has(e.key)) continue;
      picked.push(e);
      if (picked.length >= maxAreas) return picked;
    }
  }
  return picked;
}

/**
 * Grupo superior: todas las áreas empatadas si el top es empate;
 * si no, hasta 2 áreas de las 2 primeras posiciones/grupos.
 */
function buildStrengthAreaEntries(ranking) {
  const groups = groupRankingByPercent(ranking);
  if (groups.length <= 1) {
    return { entries: [], uniformDistribution: groups.length === 1 && ranking.length > 0 };
  }
  const topGroup = groups[0];
  if (topGroup.entries.length > 1) {
    return { entries: [...topGroup.entries], uniformDistribution: false };
  }
  return {
    entries: pickAreasFromGroups(groups.slice(0, 2), 2),
    uniformDistribution: false,
  };
}

/**
 * Grupo inferior: todas las empatadas en el bottom; si no, hasta 2 de las 2 últimas posiciones.
 */
function buildAttentionAreaEntries(ranking, strengthEntries) {
  const groups = groupRankingByPercent(ranking);
  if (groups.length <= 1) return [];
  const exclude = new Set(strengthEntries.map((e) => e.key));
  const bottomGroup = groups[groups.length - 1];
  if (bottomGroup.percent === groups[0].percent) return [];

  if (bottomGroup.entries.length > 1) {
    return bottomGroup.entries.filter((e) => !exclude.has(e.key));
  }
  const bottomGroups = groups.slice(-2).reverse();
  return pickAreasFromGroups(bottomGroups, 2, exclude);
}

function formatAreaStat(entry) {
  const pct = entry.percent.toFixed(1);
  if (entry.maxPossible > 0) {
    return `«${entry.label}» (${pct}%; ${entry.rawScore}/${entry.maxPossible} pts)`;
  }
  return `«${entry.label}» (${pct}%)`;
}

function joinAreaList(entries) {
  return entries.map((e) => e.label).join(' y ');
}

function strengthPhrase(entry, index) {
  const stat = formatAreaStat(entry);
  if (index === 0) return `Mayor proporción de puntos en ${stat}.`;
  return `Entre los resultados relativamente más sólidos se encuentra ${stat}.`;
}

function attentionPhrase(entry, index) {
  const stat = formatAreaStat(entry);
  if (index === 0) return `Menor proporción de puntos en ${stat}.`;
  return `Entre los resultados relativamente más bajos del intento se encuentra ${stat}.`;
}

function pickTopAreas(ranking) {
  if (!ranking.length) return [];
  const topPct = ranking[0].percent;
  return ranking.filter((e) => e.percent === topPct);
}

function pickBottomAreas(ranking) {
  if (!ranking.length) return [];
  const bottomPct = ranking[ranking.length - 1].percent;
  const topPct = ranking[0].percent;
  if (bottomPct === topPct) return [];
  return ranking.filter((e) => e.percent === bottomPct);
}

function buildComparativeSynthesis(profileLabel, ranking, topEntries, bottomEntries, topTied, bottomTied) {
  if (!ranking.length) {
    return 'No hay desglose por área situacional disponible para este intento.';
  }

  const uniformAll = ranking.length > 0 && ranking[0].percent === ranking[ranking.length - 1].percent;
  let text = `El perfil asignado es ${profileLabel}.`;

  if (uniformAll) {
    text += ' Los resultados por área presentan la misma proporción de puntos en este intento.';
    return text;
  }

  if (topEntries.length && bottomEntries.length) {
    const topNames = joinAreaList(topEntries);
    const bottomNames = joinAreaList(bottomEntries);
    const topLead = topTied
      ? 'Dentro de las áreas situacionales, los mayores resultados relativos se observaron en'
      : 'Dentro de las áreas situacionales, el mayor resultado relativo se observó en';
    const bottomLead = bottomTied
      ? 'las menores proporciones de puntos aparecieron en'
      : 'la menor proporción de puntos apareció en';
    text += ` ${topLead} ${topNames}, mientras que ${bottomLead} ${bottomNames}.`;
    return text.trim();
  }

  if (topEntries.length) {
    const names = joinAreaList(topEntries);
    const lead = topTied
      ? 'Dentro de las áreas situacionales, los mayores resultados relativos se observaron en'
      : 'Dentro de las áreas situacionales, el mayor resultado relativo se observó en';
    text += ` ${lead} ${names}.`;
  }

  return text.trim();
}

/**
 * @param {object} scores — payload SJT persistido
 */
export function analyzeSjtSales(scores) {
  const rawScore = Number(scores?.rawScore) || 0;
  const maxPossible = Number(scores?.maxPossible) || SJT_SALES_MAX_POINTS;
  const percentScore = Number(scores?.percentScore);
  const percentOfMax = Number.isFinite(percentScore)
    ? percentScore
    : maxPossible > 0
      ? Math.round((rawScore / maxPossible) * 1000) / 10
      : 0;

  let profileLabel = scores?.profileLabel || null;
  let profileDescription = scores?.profileDescription || null;
  let profileKey = scores?.profileKey || null;
  if (!profileLabel && scores?.rawScore != null) {
    const legacy = resolveSjtSalesProfile(scores.rawScore);
    profileLabel = legacy.label;
    profileDescription = legacy.description;
    profileKey = legacy.key;
  }
  profileLabel = profileLabel || '—';
  profileKey = profileKey || resolveSjtSalesProfile(rawScore).key;
  profileDescription =
    profileDescription ||
    'Descripción no disponible para este intento. Vuelva a calificar si el intento es reciente.';

  const macroCompetencies = Array.isArray(scores?.macroCompetencies) ? scores.macroCompetencies : [];
  const ranking = rankSjtMacroAreas(macroCompetencies);
  const hasAreas = ranking.length > 0;

  const topEntries = pickTopAreas(ranking, 2);
  const bottomEntries = pickBottomAreas(ranking, 2);
  const topTied = topEntries.length > 1 || (topEntries[0]?.tiedKeys?.length ?? 0) > 1;
  const bottomTied =
    bottomEntries.length > 1 || (bottomEntries[0]?.tiedKeys?.length ?? 0) > 1;

  const { entries: strengthEntries, uniformDistribution } = buildStrengthAreaEntries(ranking);
  const uniformRhMessage = uniformDistribution ? SJT_UNIFORM_AREA_RH_MESSAGE : null;
  const attentionEntries = uniformDistribution
    ? []
    : buildAttentionAreaEntries(ranking, strengthEntries);

  const strengths = strengthEntries.map((e, i) => strengthPhrase(e, i));
  const attention = attentionEntries.map((e, i) => attentionPhrase(e, i));

  const comparativeSynthesis = buildComparativeSynthesis(
    profileLabel,
    ranking,
    topEntries,
    bottomEntries,
    topTied,
    bottomTied,
  );

  return {
    rawScore,
    maxPossible,
    percentOfMax,
    profileKey,
    profileLabel,
    profileDescription,
    ranking,
    hasAreas,
    topEntries,
    bottomEntries,
    topTied,
    bottomTied,
    strengthEntries,
    attentionEntries,
    strengths,
    attention,
    uniformRhMessage,
    comparativeSynthesis,
  };
}

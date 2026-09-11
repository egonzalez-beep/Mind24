import { CLEAVER_DISC_KEYS } from '../data/cleaverDiscKey.js';

/** Etiqueta RH para la escala total = most − least. */
export const CLEAVER_NET_PROFILE_LABEL = 'Perfil neto';

/** Máxima dispersión (max−min) para considerar perfil poco diferenciado. */
export const CLEAVER_LOW_DIFF_SPREAD_THRESHOLD = 2;

/** @deprecated alias */
export const CLEAVER_BALANCE_SPREAD_THRESHOLD = CLEAVER_LOW_DIFF_SPREAD_THRESHOLD;

export const CLEAVER_DISC_META = {
  D: { label: 'Dominancia', color: '#7C3AED' },
  I: { label: 'Influencia', color: '#DB2777' },
  S: { label: 'Estabilidad', color: '#059669' },
  C: { label: 'Cumplimiento', color: '#2563EB' },
};

/**
 * @typedef {{ key: string, value: number, rank: number, tiedKeys: string[] }} CleaverRankEntry
 * @typedef {{ keys: string[], value: number, tied: boolean }} CleaverRankGroup
 * @typedef {'clear'|'primary_tie'|'balanced'|'low_differentiation'|'secondary_tie'|'single'} CleaverProfilePattern
 * @typedef {{
 *   ranking: CleaverRankEntry[],
 *   groups: CleaverRankGroup[],
 *   spread: number,
 *   pattern: CleaverProfilePattern,
 *   isBalanced: boolean,
 *   isLowDifferentiation: boolean,
 *   primary: CleaverRankGroup,
 *   secondary: CleaverRankGroup|null,
 *   hasSecondary: boolean,
 *   profileCode: string,
 *   profileCodeDisplay: string,
 *   synthesis: string,
 *   intensity: 'alta'|'moderada'|'baja',
 * }} CleaverProfileAnalysis
 */

/** Orden estable D → I → S → C (solo determinismo de sort, no jerarquía en empates). */
function stableKeyOrder(a, b) {
  return CLEAVER_DISC_KEYS.indexOf(a) - CLEAVER_DISC_KEYS.indexOf(b);
}

function normalizeTotal(total) {
  const out = {};
  for (const k of CLEAVER_DISC_KEYS) {
    out[k] = Number(total?.[k]) || 0;
  }
  return out;
}

/** spread = max(total) − min(total) sobre las cuatro dimensiones. */
export function computeCleaverSpread(total) {
  const t = normalizeTotal(total);
  const values = CLEAVER_DISC_KEYS.map((k) => t[k]);
  return Math.max(...values) - Math.min(...values);
}

/**
 * Ranking completo por perfil neto (total), descendente; empates resueltos por orden DISC.
 * @param {Record<string, number>} total
 * @returns {CleaverRankEntry[]}
 */
export function rankCleaverTotal(total) {
  const t = normalizeTotal(total);
  const sorted = CLEAVER_DISC_KEYS.map((key) => ({ key, value: t[key] })).sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    return stableKeyOrder(a.key, b.key);
  });

  const ranking = [];
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].value < sorted[i - 1].value) rank = i + 1;
    const tiedKeys = sorted.filter((e) => e.value === sorted[i].value).map((e) => e.key);
    ranking.push({
      key: sorted[i].key,
      value: sorted[i].value,
      rank,
      tiedKeys: [...tiedKeys].sort(stableKeyOrder),
    });
  }
  return ranking;
}

/**
 * Agrupa dimensiones por valor (descendente implícito vía ranking).
 * @param {CleaverRankEntry[]} ranking
 * @returns {CleaverRankGroup[]}
 */
export function groupCleaverRanking(ranking) {
  const groups = [];
  for (const entry of ranking) {
    const last = groups[groups.length - 1];
    if (last && last.value === entry.value) {
      if (!last.keys.includes(entry.key)) last.keys.push(entry.key);
    } else {
      groups.push({ keys: [entry.key], value: entry.value, tied: false });
    }
  }
  for (const g of groups) {
    g.keys.sort(stableKeyOrder);
    g.tied = g.keys.length > 1;
  }
  return groups;
}

function formatSigned(n) {
  return n > 0 ? `+${n}` : String(n);
}

function formatKeysList(keys) {
  return keys.map((k) => `${k} (${CLEAVER_DISC_META[k].label})`).join(', ');
}

function pairKey(primary, secondary) {
  return `${primary}|${secondary}`;
}

/** Narrativa curada por par ordenado (primera letra = mayor peso). */
const PAIR_NARRATIVE = {
  'D|I':
    'Combina impulso hacia resultados con facilidad para influir en otros. Suele moverse con energía, tomar la iniciativa y buscar acuerdos sin perder el foco en el objetivo. En equipo aporta dinamismo comercial y capacidad de arrastrar al grupo hacia metas concretas.',
  'D|S':
    'Mezcla orientación a resultados con disposición cooperativa. Puede ser directo y exigente, pero también paciente cuando el contexto lo requiere. En la práctica equilibra avance y contención del ritmo de trabajo.',
  'D|C':
    'Integra decisión y control de calidad. Tiende a exigir estándares mientras empuja el avance; valora tanto el logro como el cumplimiento de criterios. Puede ser firme en plazos sin descuidar el detalle relevante.',
  'I|D':
    'Prioriza la conexión interpersonal y la visibilidad, con un respaldo decidido para concretar. Comunica con soltura y suele movilizar recursos cuando hace falta cerrar. Aporta entusiasmo orientado a acción.',
  'I|S':
    'Destaca por calidez, escucha y constancia relacional. Construye confianza de forma gradual y prefiere ambientes donde la colaboración sea explícita. Suele ser accesible y coherente en el trato cotidiano.',
  'I|C':
    'Une sociabilidad con atención al detalle comunicativo. Puede ser persuasivo sin perder rigor en lo que promete o documenta. En contextos laborales combina contacto humano con mensajes bien estructurados.',
  'S|D':
    'Muestra base estable y cooperativa, complementada por firmeza cuando la situación lo exige. Prefiere acuerdos y continuidad, pero puede acelerar si el entorno lo demanda. Aporta contención con capacidad de empuje selectivo.',
  'S|I':
    'Enfatiza calma, apoyo y relaciones de confianza, con un matiz expresivo y cercano. Suele ser paciente, accesible y coherente en equipos de trabajo prolongado. Valora armonía y comunicación respetuosa.',
  'S|C':
    'Combina estabilidad con apego a procedimientos. Prefiere rutinas claras, previsibilidad y trabajo bien organizado. En operación cotidiana aporta constancia y cuidado por las reglas del juego.',
  'C|D':
    'Prioriza precisión, normas y análisis, con capacidad de decidir cuando hay datos suficientes. Puede ser metódico y exigente consigo y con el proceso. En entornos regulados aporta orden y criterio.',
  'C|I':
    'Fundamenta su estilo en rigor y claridad, con habilidad para explicar y alinear a otros. Suele preparar bien la información antes de comunicarla. Combina estructura con capacidad de influencia moderada.',
  'C|S':
    'Enfatiza cumplimiento, calidad y continuidad. Prefiere entornos predecibles donde las expectativas estén definidas. Aporta confiabilidad operativa y respeto por acuerdos establecidos.',
};

const SINGLE_NARRATIVE = {
  D: 'El perfil neto destaca Dominancia por encima del resto. Se observa tendencia a decidir con prontitud, orientarse a resultados y asumir el control de situaciones ambiguas. Las demás dimensiones quedan en segundo plano en este patrón.',
  I: 'El perfil neto destaca Influencia por encima del resto. Se observa tendencia a conectar, persuadir y mantener visibilidad en el entorno interpersonal. Las demás dimensiones acompañan con menor peso relativo.',
  S: 'El perfil neto destaca Estabilidad por encima del resto. Se observa tendencia a cooperar, sostener ritmos constantes y priorizar continuidad en las relaciones de trabajo. Las demás dimensiones acompañan con menor peso relativo.',
  C: 'El perfil neto destaca Cumplimiento por encima del resto. Se observa tendencia a seguir criterios, cuidar calidad y apoyarse en procedimientos claros. Las demás dimensiones acompañan con menor peso relativo.',
};

function intensityFromSpread(spread, primaryValue) {
  if (spread <= CLEAVER_LOW_DIFF_SPREAD_THRESHOLD) return 'baja';
  if (spread >= 6 || Math.abs(primaryValue) >= 6) return 'alta';
  return 'moderada';
}

function formatSpreadPhrase(spread) {
  return `dispersión: ${spread} puntos`;
}

function intensitySentence(intensity, spread) {
  if (intensity === 'alta') {
    return `La separación entre dimensiones es marcada (${formatSpreadPhrase(spread)}), lo que define un estilo conductual relativamente claro en el perfil neto.`;
  }
  if (intensity === 'moderada') {
    return `La separación entre dimensiones es moderada (${formatSpreadPhrase(spread)}), con un estilo reconocible aunque no extremo.`;
  }
  return `Las puntuaciones netas están próximas entre sí (${formatSpreadPhrase(spread)}), lo que sugiere un estilo menos polarizado.`;
}

function buildBalancedSynthesis(spread) {
  return [
    'Las cuatro dimensiones DISC presentan el mismo valor neto; el perfil se lee como simétrico.',
    'No emerge una dimensión predominante: la interpretación debe considerar las cuatro tendencias con peso equivalente.',
    intensitySentence('baja', spread),
  ].join(' ');
}

function buildLowDifferentiationSynthesis(primary, secondary, hasSecondary, spread) {
  const parts = [
    `${formatKeysList(primary.keys)} encabeza el rango superior (${formatSigned(primary.value)}), pero las diferencias entre dimensiones son reducidas.`,
    'El perfil presenta poca diferenciación entre dimensiones, por lo que la lectura debe centrarse en la combinación general y no en una sola tendencia predominante.',
  ];
  if (hasSecondary && secondary) {
    parts.push(
      `Como matiz de segundo nivel aparece ${formatKeysList(secondary.keys)} (${formatSigned(secondary.value)}).`,
    );
  }
  parts.push(intensitySentence('baja', spread));
  return parts.join(' ');
}

function buildPrimaryTieSynthesis(primary, secondary, spread) {
  const coLabels = formatKeysList(primary.keys);
  const parts = [
    `El perfil neto muestra co-dominancia entre ${coLabels} (valor neto ${formatSigned(primary.value)}).`,
    'No se fuerza una única dimensión principal: comparten el primer lugar con el mismo peso.',
  ];
  if (secondary && primary.keys.length === 2) {
    const sec = secondary.keys[0];
    parts.push(
      `Como matiz de segundo nivel aparece ${CLEAVER_DISC_META[sec].label} (${sec}, ${formatSigned(secondary.value)}).`,
    );
    const pk = pairKey(primary.keys[0], sec);
    const alt = pairKey(primary.keys[1], sec);
    if (PAIR_NARRATIVE[pk] || PAIR_NARRATIVE[alt]) {
      parts.push(PAIR_NARRATIVE[pk] || PAIR_NARRATIVE[alt]);
    }
  } else if (secondary && primary.keys.length >= 3) {
    parts.push(
      `Por debajo del trío co-dominante, ${formatKeysList(secondary.keys)} queda en un nivel neto ${formatSigned(secondary.value)}, claramente separado del grupo superior.`,
    );
  } else {
    parts.push(
      'La lectura debe centrarse en la combinación de esas dimensiones compartidas, más que en una sola etiqueta de perfil.',
    );
  }
  parts.push(intensitySentence(intensityFromSpread(spread, primary.value), spread));
  return parts.join(' ');
}

function buildClearSynthesis(primaryKey, secondaryKey, spread, secondaryTie, secondaryKeys) {
  const pMeta = CLEAVER_DISC_META[primaryKey];
  const pair = PAIR_NARRATIVE[pairKey(primaryKey, secondaryKey)] || '';
  const parts = [
    `El perfil neto está encabezado por ${pMeta.label} (${primaryKey}) como dimensión principal.`,
  ];
  if (secondaryKey && !secondaryTie) {
    const sMeta = CLEAVER_DISC_META[secondaryKey];
    parts.push(
      `Como dimensión secundaria aparece ${sMeta.label} (${secondaryKey}), aportando un matiz complementario al estilo predominante.`,
    );
    if (pair) parts.push(pair);
  } else if (secondaryTie && secondaryKeys?.length) {
    parts.push(
      `En segundo plano comparten peso ${formatKeysList(secondaryKeys)}; la lectura secundaria debe tomarse como matices paralelos, no como una sola dimensión.`,
    );
    if (pair) parts.push(pair);
  } else {
    parts.push(SINGLE_NARRATIVE[primaryKey] || '');
  }
  parts.push(intensitySentence(intensityFromSpread(spread, primaryKey), spread));
  return parts.filter(Boolean).join(' ');
}

function resolveProfileCode(groups, isBalanced, isLowDifferentiation, hasSecondary) {
  const primary = groups[0];
  const secondary = groups[1] ?? null;

  if (isBalanced) {
    return { profileCode: 'EQUILIBRADO', profileCodeDisplay: 'Equilibrado' };
  }

  if (isLowDifferentiation) {
    return { profileCode: 'POCO_DIFERENCIADO', profileCodeDisplay: 'Poco diferenciado' };
  }

  if (primary.tied) {
    return {
      profileCode: primary.keys.join('·'),
      profileCodeDisplay: primary.keys.join(' · '),
    };
  }

  const p = primary.keys[0];
  if (!hasSecondary || !secondary) {
    return { profileCode: p, profileCodeDisplay: p };
  }

  if (secondary.tied) {
    const sec = secondary.keys.join('·');
    return {
      profileCode: `${p}/${sec}`,
      profileCodeDisplay: `${p} / ${secondary.keys.join(' · ')}`,
    };
  }

  const s = secondary.keys[0];
  return {
    profileCode: `${p}/${s}`,
    profileCodeDisplay: `${p} / ${s}`,
  };
}

/**
 * Análisis interpretativo del perfil Cleaver a partir de `total` (most − least).
 *
 * Reglas:
 * - Ranking por valor neto desc; empate → orden D, I, S, C (solo sort).
 * - Equilibrado: las 4 dimensiones con el mismo valor neto.
 * - Poco diferenciado: spread (max−min) ≤ 2, sin ser equilibrado simétrico.
 * - Co-dominancia: empate en 1.er lugar (2 o 3 dimensiones), aunque haya separación con el resto.
 * - Secundaria: existe 2.º grupo cuando hay dominante única (sin umbral de gap adicional).
 *
 * @param {Record<string, number>} total
 * @returns {CleaverProfileAnalysis}
 */
export function analyzeCleaverProfile(total) {
  const ranking = rankCleaverTotal(total);
  const groups = groupCleaverRanking(ranking);
  const spread = computeCleaverSpread(total);

  const primary = groups[0];
  const secondary = groups[1] ?? null;

  const isBalanced = groups.length === 1;
  const isLowDifferentiation = !isBalanced && spread <= CLEAVER_LOW_DIFF_SPREAD_THRESHOLD;

  const primaryTie = primary.tied;
  const secondaryTie = secondary?.tied ?? false;

  const hasClearPrimary = !isBalanced && !primaryTie;
  const hasSecondary = hasClearPrimary && secondary != null;

  let pattern = 'clear';
  if (isBalanced) pattern = 'balanced';
  else if (primaryTie) pattern = 'primary_tie';
  else if (isLowDifferentiation) pattern = 'low_differentiation';
  else if (secondaryTie && hasSecondary) pattern = 'secondary_tie';
  else if (hasClearPrimary && !hasSecondary) pattern = 'single';

  const { profileCode, profileCodeDisplay } = resolveProfileCode(
    groups,
    isBalanced,
    isLowDifferentiation,
    hasSecondary,
  );

  let synthesis;
  if (isBalanced) {
    synthesis = buildBalancedSynthesis(spread);
  } else if (primaryTie) {
    synthesis = buildPrimaryTieSynthesis(primary, secondary, spread);
  } else if (isLowDifferentiation) {
    synthesis = buildLowDifferentiationSynthesis(primary, secondary, hasSecondary, spread);
  } else {
    synthesis = buildClearSynthesis(
      primary.keys[0],
      hasSecondary ? secondary.keys[0] : null,
      spread,
      secondaryTie && hasSecondary,
      secondary?.keys,
    );
  }

  const intensity = intensityFromSpread(spread, primary.value);

  return {
    ranking,
    groups,
    spread,
    pattern,
    isBalanced,
    isLowDifferentiation,
    primary,
    secondary: hasSecondary ? secondary : primaryTie ? secondary : null,
    hasSecondary,
    profileCode,
    profileCodeDisplay,
    synthesis,
    intensity,
  };
}

/** Primera dimensión del grupo líder (compatibilidad legacy; sort técnico). */
export function dominantDiscKey(total) {
  return analyzeCleaverProfile(total).primary.keys[0];
}

/** @deprecated Prefer analyzeCleaverProfile */
export function cleaverProfileSynthesis(total) {
  const analysis = analyzeCleaverProfile(total);
  const key = analysis.primary.keys[0];
  return {
    key,
    label: CLEAVER_DISC_META[key].label,
    text: analysis.synthesis,
    analysis,
  };
}

/** Ranking visual con empates: D (+5) = I (+5) › C (+1) › S (-2) */
export function formatCleaverRankingLine(ranking) {
  const groups = groupCleaverRanking(ranking);
  return groups
    .map((g) => g.keys.map((k) => `${k} (${formatSigned(g.value)})`).join(' = '))
    .join(' › ');
}

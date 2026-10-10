/**
 * Motor interpretativo descriptivo — Personalidad Mind24 (Fase 4C.3 v1).
 * Autodescripción de frecuencia conductual; sin normas ni juicios de competencia.
 */
import { PERSONALIDAD_MIND24_DIMENSIONS, PERSONALIDAD_MIND24_SCALE } from '../data/personalityMind24Data.js';
import { esc } from './reportUtils.js';

const SCALE_MIN = PERSONALIDAD_MIND24_SCALE.min;
const SCALE_MAX = PERSONALIDAD_MIND24_SCALE.max;

export const PERSONALITY_INTERPRETATION_FORBIDDEN = [
  /\bpercentil\b/i,
  /superior al promedio/i,
  /inferior al promedio/i,
  /nivel alto/i,
  /nivel bajo/i,
  /\bexcelente\b/i,
  /\bdeficiente\b/i,
  /\brecomendado\b/i,
  /no recomendado/i,
  /\bapto\b/i,
  /no apto/i,
  /\bcompatibilidad\b/i,
  /\bdiagn[oó]stico\b/i,
  /\btrastorno\b/i,
  /\bcompetencia\b/i,
  /\bpotencial\b/i,
];

/** @typedef {'lower'|'mixed'|'upper'} NarrativeStyleZone */

/**
 * @param {number} mean
 * @returns {{ label: string, band: string }|null}
 */
export function personalityFrequencyDescriptor(mean) {
  const n = Number(mean);
  if (!Number.isFinite(n) || n < SCALE_MIN || n > SCALE_MAX) return null;
  if (n <= 1.4) return { label: 'Nunca o casi nunca', band: '1.0-1.4' };
  if (n <= 2.4) return { label: 'Rara vez', band: '1.5-2.4' };
  if (n <= 3.4) return { label: 'A veces', band: '2.5-3.4' };
  if (n <= 4.4) return { label: 'Con frecuencia', band: '3.5-4.4' };
  return { label: 'Siempre o casi siempre', band: '4.5-5.0' };
}

/**
 * @param {number} mean
 * @returns {NarrativeStyleZone|null}
 */
export function personalityNarrativeStyleZone(mean) {
  const n = Number(mean);
  if (!Number.isFinite(n) || n < SCALE_MIN || n > SCALE_MAX) return null;
  if (n < 2.5) return 'lower';
  if (n < 3.5) return 'mixed';
  return 'upper';
}

/**
 * @typedef {{ lowerText: string, mixedText: string, upperText: string, summaryUpperTheme: string, summaryLowerTheme: string }} DimensionInterpretationCopy
 */

/** @type {Record<string, DimensionInterpretationCopy>} */
export const PERSONALITY_DIMENSION_INTERPRETATIONS = {
  logro_persistencia: {
    lowerText:
      'Las conductas asociadas con persistir y mantener seguimiento continuo aparecen con menor frecuencia. Puede ser más proclive a redistribuir esfuerzo, pausar tareas o cambiar el foco cuando el avance se dificulta, en lugar de mantener una misma línea de acción durante periodos prolongados.',
    mixedText:
      'El perfil sugiere una expresión variable de esta tendencia. Puede sostener el esfuerzo y seguimiento cuando la meta lo requiere, aunque también redistribuir atención o dejar temporalmente una tarea cuando cambian las condiciones o prioridades.',
    upperText:
      'El patrón sugiere una tendencia frecuente a mantener el esfuerzo orientado hacia resultados, retomar pendientes y continuar trabajando cuando una tarea se complica. Puede mostrarse especialmente atento a avanzar y cerrar asuntos iniciados.',
    summaryUpperTheme: 'persistencia orientada a resultados y seguimiento hasta cierre',
    summaryLowerTheme: 'redistribución de esfuerzo y pausas cuando el avance se dificulta',
  },
  orden_precision: {
    lowerText:
      'Tiende a trabajar de una manera más fluida y menos centrada en estructurar o revisar cada detalle. Puede privilegiar continuidad y avance sobre comprobaciones adicionales cuando considera que lo esencial ya está cubierto.',
    mixedText:
      'Combina organización y revisión con cierta flexibilidad para avanzar sin estructurar o comprobar cada aspecto en el mismo grado. El nivel de detalle puede variar según la tarea y su relevancia.',
    upperText:
      'Tiende a estructurar actividades, identificar discrepancias y dedicar atención a la revisión antes de considerar una tarea cerrada. Puede sentirse cómodo trabajando con secuencias y controles propios de organización.',
    summaryUpperTheme: 'organización del trabajo, detalle y revisión',
    summaryLowerTheme: 'avance fluido con menos énfasis en revisar cada detalle',
  },
  autonomia_decision: {
    lowerText:
      'Tiende a valorar más los puntos de revisión, la confirmación o el intercambio antes de avanzar en decisiones. Puede preferir contar con referencias adicionales o validación cuando existen varias alternativas posibles.',
    mixedText:
      'Puede trabajar de manera autónoma en situaciones conocidas y, al mismo tiempo, buscar puntos de validación cuando la decisión tiene mayor incertidumbre o impacto. Alterna criterio propio y consulta según el contexto.',
    upperText:
      'Tiende a avanzar con independencia una vez que comprende el resultado esperado, formar un criterio propio y tomar decisiones con la información disponible sin depender de validación constante.',
    summaryUpperTheme: 'autogestión y decisiones con criterio propio',
    summaryLowerTheme: 'validación e intercambio antes de decidir',
  },
  influencia_persuasion: {
    lowerText:
      'Tiende a expresar su postura sin invertir demasiado esfuerzo adicional en modificar la opinión de otras personas. Puede preferir dejar espacio al desacuerdo una vez que su punto ha sido comunicado.',
    mixedText:
      'Puede argumentar y buscar persuadir cuando considera importante una propuesta, aunque no necesariamente mantiene el esfuerzo persuasivo en todas las interacciones o desacuerdos.',
    upperText:
      'Tiende a desarrollar argumentos, reformular mensajes y buscar distintas maneras de lograr que sus ideas sean consideradas. Puede mantenerse activo en conversaciones donde existen opiniones diferentes.',
    summaryUpperTheme: 'argumentación y persuasión interpersonal',
    summaryLowerTheme: 'expresar postura sin énfasis persuasivo adicional',
  },
  sociabilidad_colaboracion: {
    lowerText:
      'Tiende a concentrarse principalmente en sus propias responsabilidades y puede preferir interacciones funcionales o apoyo bajo solicitud antes que una participación continua en el trabajo de los demás.',
    mixedText:
      'Puede colaborar y coordinarse adecuadamente cuando la tarea lo requiere, alternando participación grupal con periodos de trabajo más independiente.',
    upperText:
      'Tiende a establecer contacto directo, intercambiar información y mantenerse involucrado en la coordinación con otras personas. También puede ofrecer apoyo de manera espontánea cuando el trabajo es compartido.',
    summaryUpperTheme: 'coordinación colaborativa y apoyo en trabajo compartido',
    summaryLowerTheme: 'foco en responsabilidades propias e interacciones más funcionales',
  },
  liderazgo_equipos: {
    lowerText:
      'Tiende a concentrarse en su contribución individual cuando existen otras personas capaces de coordinar. Puede preferir estructuras donde la dirección general esté claramente asignada a otro integrante.',
    mixedText:
      'Puede asumir funciones de coordinación cuando la situación lo requiere, aunque también puede trabajar cómodamente cuando otra persona ya conduce al grupo.',
    upperText:
      'Tiende a involucrarse en la organización del trabajo colectivo, aclarar responsabilidades y ayudar a dar dirección cuando un grupo necesita coordinar su avance.',
    summaryUpperTheme: 'dirección y coordinación del trabajo colectivo',
    summaryLowerTheme: 'contribución individual con dirección asignada a otros',
  },
  apego_normas: {
    lowerText:
      'Tiende a utilizar con mayor frecuencia su propio criterio o formas alternativas de ejecución cuando considera que pueden cumplir el objetivo, en lugar de depender siempre de procedimientos previamente establecidos.',
    mixedText:
      'Combina el uso de procedimientos establecidos con cierta libertad para emplear criterios propios cuando la situación lo permite.',
    upperText:
      'Tiende a utilizar procedimientos, formatos y criterios establecidos como referencia habitual para ejecutar y cerrar el trabajo. Suele incorporar controles y secuencias definidas al flujo de sus actividades.',
    summaryUpperTheme: 'uso de procedimientos y controles establecidos',
    summaryLowerTheme: 'criterio propio y formas alternativas de ejecución',
  },
  regulacion_presion: {
    lowerText:
      'Tiende a necesitar mayor tiempo para recuperar concentración o distancia después de contratiempos, presión o resultados inesperados. Esto describe su forma habitual de recuperación y no implica incapacidad para desempeñarse bajo presión.',
    mixedText:
      'Generalmente puede recuperar el foco después de situaciones adversas, aunque determinadas condiciones de presión, crítica o frustración pueden requerirle más tiempo para reajustarse.',
    upperText:
      'Tiende a conservar una respuesta funcional ante situaciones exigentes y a recuperar el foco después de contratiempos, errores o críticas, aun cuando la situación continúe siendo incómoda.',
    summaryUpperTheme: 'regulación ante exigencia y recuperación tras contratiempos',
    summaryLowerTheme: 'recuperación más gradual tras contratiempos o presión',
  },
  dinamismo_iniciativa: {
    lowerText:
      'Tiende a adoptar un ritmo de trabajo más pausado, dedicar más tiempo a la transición o preparación entre actividades y evitar mantener una activación continua únicamente porque existan tareas disponibles.',
    mixedText:
      'Alterna periodos de ritmo activo con momentos de preparación o pausa antes de iniciar o cambiar de actividad. Su nivel de activación puede depender de las demandas del momento.',
    upperText:
      'Tiende a ponerse en movimiento cuando existe suficiente claridad, mantener actividad cuando hay tareas disponibles y enlazar actividades con pocas pausas entre ellas.',
    summaryUpperTheme: 'ritmo activo e inicio de tareas',
    summaryLowerTheme: 'ritmo pausado y transiciones más graduales',
  },
  adaptabilidad_cambio: {
    lowerText:
      'Tiende a dar mayor continuidad a métodos, prioridades o formas de trabajo ya conocidas y puede incorporar cambios de manera más gradual cuando el esquema existente todavía resulta funcional.',
    mixedText:
      'Puede ajustar su manera de trabajar cuando existe una razón clara para hacerlo, aunque también conserva métodos conocidos cuando continúan siendo funcionales.',
    upperText:
      'Tiende a modificar procedimientos, prioridades o estrategias cuando las condiciones cambian, incorporando nuevas formas de trabajo sin depender de mantener el esquema inicial.',
    summaryUpperTheme: 'ajuste de métodos y prioridades ante cambios',
    summaryLowerTheme: 'continuidad de métodos conocidos con cambios graduales',
  },
};

export const HOMOGENEOUS_PROFILE_SUMMARY_TEXT =
  'No se observan contrastes amplios entre las dimensiones evaluadas. El perfil presenta una distribución relativamente homogénea dentro de la escala observada.';

export const DIMENSION_RESULT_UNAVAILABLE = 'Resultado dimensional no disponible.';

function formatMeanOneDecimal(mean) {
  const n = Number(mean);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(1);
}

function joinSpanishList(items) {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} y ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

function uniqueThemes(rows, themeKey) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const copy = PERSONALITY_DIMENSION_INTERPRETATIONS[row.dimensionId];
    if (!copy) continue;
    const theme = copy[themeKey];
    if (!theme || seen.has(theme)) continue;
    seen.add(theme);
    out.push(theme);
  }
  return out;
}

/**
 * @param {Array<object>} dimensionRows — orden canónico
 * @param {{ hasContrast: boolean, moreExpressed: Array<object>, lessExpressed: Array<object> }} trends
 * @returns {{ paragraphs: string[], isHomogeneous: boolean }}
 */
export function buildPersonalityProfileSummary(dimensionRows, trends) {
  if (!trends?.hasContrast) {
    return { paragraphs: [HOMOGENEOUS_PROFILE_SUMMARY_TEXT], isHomogeneous: true };
  }

  const topNames = trends.moreExpressed.map((r) => r.label);
  const bottomNames = trends.lessExpressed.map((r) => r.label);
  const upperThemes = uniqueThemes(trends.moreExpressed, 'summaryUpperTheme');
  const lowerThemes = uniqueThemes(trends.lessExpressed, 'summaryLowerTheme');

  const p1 =
    `Dentro del propio perfil, las tendencias relativamente más expresadas se concentran en ${joinSpanishList(topNames)}. ` +
    `Esto sugiere una mayor presencia relativa de conductas asociadas con ${joinSpanishList(upperThemes)}.`;

  const p2 =
    `En contraste, ${joinSpanishList(bottomNames)} aparecen con menor expresión relativa, lo que puede reflejar una preferencia por ${joinSpanishList(lowerThemes)}.`;

  return { paragraphs: [p1, p2], isHomogeneous: false };
}

/**
 * @param {string} dimensionId
 * @param {number} mean
 * @returns {string}
 */
export function personalityDimensionNarrative(dimensionId, mean) {
  const zone = personalityNarrativeStyleZone(mean);
  const copy = PERSONALITY_DIMENSION_INTERPRETATIONS[dimensionId];
  if (!zone || !copy) return DIMENSION_RESULT_UNAVAILABLE;
  if (zone === 'lower') return copy.lowerText;
  if (zone === 'mixed') return copy.mixedText;
  return copy.upperText;
}

/**
 * @param {object} row — dimensionRow
 * @returns {{ meanLabel: string, frequencyLabel: string|null, narrative: string }}
 */
export function buildDimensionInterpretationView(row) {
  const mean = Number(row.mean);
  const freq = personalityFrequencyDescriptor(mean);
  if (!freq) {
    return {
      meanLabel: '—',
      frequencyLabel: null,
      narrative: DIMENSION_RESULT_UNAVAILABLE,
    };
  }
  return {
    meanLabel: `${formatMeanOneDecimal(mean)} / ${SCALE_MAX}`,
    frequencyLabel: freq.label,
    narrative: personalityDimensionNarrative(row.dimensionId, mean),
  };
}

/** Texto agregado de todas las narrativas (tests de lenguaje prohibido). */
export function allPersonalityInterpretationCopyText() {
  const chunks = [HOMOGENEOUS_PROFILE_SUMMARY_TEXT, DIMENSION_RESULT_UNAVAILABLE];
  for (const copy of Object.values(PERSONALITY_DIMENSION_INTERPRETATIONS)) {
    chunks.push(copy.lowerText, copy.mixedText, copy.upperText);
  }
  return chunks.join('\n');
}

/**
 * @param {Array<object>} dimensionRows
 * @param {{ hasContrast: boolean, moreExpressed: Array<object>, lessExpressed: Array<object> }} trends
 */
export function buildPersonalityInterpretationSectionHtml(dimensionRows, trends) {
  const summary = buildPersonalityProfileSummary(dimensionRows, trends);
  const summaryHtml = summary.paragraphs.map((p) => `<p class="pm24-interpret-p">${esc(p)}</p>`).join('\n');

  const rowsHtml = dimensionRows
    .map((row) => {
      const view = buildDimensionInterpretationView(row);
      const freqLine =
        view.frequencyLabel != null
          ? `<span class="pm24-interpret-freq"><span class="pm24-interpret-freq-k">Frecuencia observada</span> ${esc(view.meanLabel)} · ${esc(view.frequencyLabel)}</span>`
          : `<span class="pm24-interpret-freq">${esc(view.meanLabel)}</span>`;
      return `<article class="pm24-interpret-row">
  <div class="pm24-interpret-hd">
    <h4 class="pm24-interpret-dim">${esc(row.label)}</h4>
    ${freqLine}
  </div>
  <p class="pm24-interpret-narr">${esc(view.narrative)}</p>
</article>`;
    })
    .join('\n');

  return `<div class="pm24-interpret-slot">
  <div class="section pm24-interpret-section">
    <div class="section-title">Interpretación del perfil</div>
    <div class="pm24-interpret-block">
      <h3 class="pm24-interpret-heading">Síntesis del perfil</h3>
      ${summaryHtml}
    </div>
    <div class="pm24-interpret-block">
      <h3 class="pm24-interpret-heading">Lectura por dimensión</h3>
      <div class="pm24-interpret-list">${rowsHtml}</div>
    </div>
  </div>
</div>`;
}

/** Validación: las 10 dimensionId del catálogo tienen copy completo. */
export function assertInterpretationCatalogComplete() {
  for (const def of PERSONALIDAD_MIND24_DIMENSIONS) {
    const copy = PERSONALITY_DIMENSION_INTERPRETATIONS[def.dimensionId];
    if (!copy?.lowerText || !copy?.mixedText || !copy?.upperText) {
      throw new Error(`Interpretación incompleta: ${def.dimensionId}`);
    }
  }
}

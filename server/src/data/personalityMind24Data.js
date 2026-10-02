/**
 * Catálogo — Personalidad laboral Mind24 (clave: personalidad_mind24).
 * Formulario v1 fijo: 6 reactivos × 10 dimensiones (60 ítems production).
 * Banco de desarrollo: draft | pilot | production (sin selección aleatoria en v1).
 */

export const PERSONALIDAD_MIND24_CATALOG_VERSION = 1;

export const PERSONALIDAD_MIND24_MODULE_KEY = 'personalidad_mind24';

/** Ítems activos en formulario de producción por dimensión. */
export const PERSONALIDAD_MIND24_ITEMS_PER_DIMENSION = 6;

/** Total previsto del formulario fijo v1. */
export const PERSONALIDAD_MIND24_FORM_ITEM_COUNT =
  PERSONALIDAD_MIND24_ITEMS_PER_DIMENSION * 10;

export const PERSONALIDAD_MIND24_BANK_STATUSES = ['draft', 'pilot', 'production'];

export const PERSONALIDAD_MIND24_ITEM_DIRECTIONS = ['direct', 'inverse'];

export const PERSONALIDAD_MIND24_SCALE = {
  min: 1,
  max: 5,
  optionLabels: [
    'Nunca o casi nunca',
    'Rara vez',
    'A veces',
    'Con frecuencia',
    'Siempre o casi siempre',
  ],
};

/** Dimensiones definitivas v1 (orden de presentación). */
export const PERSONALIDAD_MIND24_DIMENSIONS = [
  {
    dimensionId: 'logro_persistencia',
    sortOrder: 1,
    label: 'Orientación al logro y persistencia',
  },
  {
    dimensionId: 'orden_precision',
    sortOrder: 2,
    label: 'Orden y precisión',
  },
  {
    dimensionId: 'autonomia_decision',
    sortOrder: 3,
    label: 'Autonomía y seguridad para decidir',
  },
  {
    dimensionId: 'influencia_persuasion',
    sortOrder: 4,
    label: 'Influencia y persuasión interpersonal',
  },
  {
    dimensionId: 'sociabilidad_colaboracion',
    sortOrder: 5,
    label: 'Sociabilidad y colaboración',
  },
  {
    dimensionId: 'liderazgo_equipos',
    sortOrder: 6,
    label: 'Liderazgo y dirección de equipos',
  },
  {
    dimensionId: 'apego_normas',
    sortOrder: 7,
    label: 'Apego a normas y procesos',
  },
  {
    dimensionId: 'regulacion_presion',
    sortOrder: 8,
    label: 'Regulación bajo presión y tolerancia a la frustración',
  },
  {
    dimensionId: 'dinamismo_iniciativa',
    sortOrder: 9,
    label: 'Dinamismo e iniciativa laboral',
  },
  {
    dimensionId: 'adaptabilidad_cambio',
    sortOrder: 10,
    label: 'Adaptabilidad y flexibilidad ante el cambio',
  },
];

const DIMENSION_IDS = new Set(PERSONALIDAD_MIND24_DIMENSIONS.map((d) => d.dimensionId));

/**
 * Banco de reactivos (vacío hasta fase de redacción).
 * @typedef {object} PersonalityMind24ItemDef
 * @property {string} itemId
 * @property {string} dimensionId
 * @property {'direct'|'inverse'} direction
 * @property {number} sortOrder
 * @property {string} text
 * @property {'draft'|'pilot'|'production'} bankStatus
 */

/** @type {PersonalityMind24ItemDef[]} */
export const PERSONALIDAD_MIND24_ITEMS = [];

export function personalityDimensionById(dimensionId) {
  return PERSONALIDAD_MIND24_DIMENSIONS.find((d) => d.dimensionId === dimensionId) || null;
}

export function personalityItemsFlat() {
  return [...PERSONALIDAD_MIND24_ITEMS].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Ítems que conforman el formulario fijo v1 (solo bankStatus production). */
export function personalityProductionItemsFlat() {
  return personalityItemsFlat().filter((item) => item.bankStatus === 'production');
}

export function personalityQuestionCount() {
  return personalityProductionItemsFlat().length;
}

export function personalityExpectedCountByDimension() {
  const counts = Object.fromEntries(
    PERSONALIDAD_MIND24_DIMENSIONS.map((d) => [d.dimensionId, 0]),
  );
  for (const item of personalityProductionItemsFlat()) {
    if (counts[item.dimensionId] != null) counts[item.dimensionId] += 1;
  }
  return counts;
}

export function validatePersonalityMind24Item(item) {
  const errors = [];
  if (!item?.itemId) errors.push('missing itemId');
  if (!item?.dimensionId || !DIMENSION_IDS.has(item.dimensionId)) {
    errors.push('invalid dimensionId');
  }
  if (!PERSONALIDAD_MIND24_ITEM_DIRECTIONS.includes(item?.direction)) {
    errors.push('invalid direction');
  }
  if (!Number.isFinite(Number(item?.sortOrder))) errors.push('invalid sortOrder');
  if (!PERSONALIDAD_MIND24_BANK_STATUSES.includes(item?.bankStatus)) {
    errors.push('invalid bankStatus');
  }
  return errors;
}

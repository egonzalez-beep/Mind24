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
export const PERSONALIDAD_MIND24_ITEMS = [
  {
    itemId: 'pm24_001',
    dimensionId: 'logro_persistencia',
    direction: 'direct',
    sortOrder: 101,
    text: 'Cuando tengo varios pendientes abiertos, concentro primero mi esfuerzo en los que más contribuyen al resultado acordado.',
    bankStatus: 'draft',
  },
  {
    itemId: 'pm24_002',
    dimensionId: 'logro_persistencia',
    direction: 'direct',
    sortOrder: 102,
    text: 'Mientras avanzo en una tarea, verifico si lo que estoy haciendo sigue acercándome al resultado esperado.',
    bankStatus: 'draft',
  },
  {
    itemId: 'pm24_003',
    dimensionId: 'logro_persistencia',
    direction: 'direct',
    sortOrder: 103,
    text: 'Cuando aparecen tareas secundarias durante un trabajo, vuelvo a centrar mi esfuerzo en el objetivo principal.',
    bankStatus: 'draft',
  },
  {
    itemId: 'pm24_004',
    dimensionId: 'logro_persistencia',
    direction: 'direct',
    sortOrder: 104,
    text: 'Cuando una tarea se complica más de lo previsto, hago nuevos intentos antes de dejarla pendiente.',
    bankStatus: 'draft',
  },
  {
    itemId: 'pm24_005',
    dimensionId: 'logro_persistencia',
    direction: 'direct',
    sortOrder: 105,
    text: 'Si una tarea requiere más intentos de los previstos, suelo mantener el trabajo en ella aunque avance más lento de lo que tenía previsto.',
    bankStatus: 'draft',
  },
  {
    itemId: 'pm24_006',
    dimensionId: 'logro_persistencia',
    direction: 'inverse',
    sortOrder: 106,
    text: 'Después de varios intentos sin avance en una tarea, suelo dejarla en pausa y concentrarme temporalmente en otras actividades.',
    bankStatus: 'draft',
  },
  {
    itemId: 'pm24_007',
    dimensionId: 'logro_persistencia',
    direction: 'direct',
    sortOrder: 107,
    text: 'Después de completar la parte principal de una tarea, doy seguimiento a los pendientes relacionados hasta dejarlos cerrados.',
    bankStatus: 'draft',
  },
  {
    itemId: 'pm24_008',
    dimensionId: 'logro_persistencia',
    direction: 'direct',
    sortOrder: 108,
    text: 'Cuando dejo una tarea a medias para atender otra prioridad, procuro retomarla después hasta cerrarla.',
    bankStatus: 'draft',
  },
  {
    itemId: 'pm24_009',
    dimensionId: 'orden_precision',
    direction: 'direct',
    sortOrder: 201,
    text: 'Antes de abordar varios pendientes del mismo trabajo, defino el orden en que los iré atendiendo.',
    bankStatus: 'draft',
  },
  {
    itemId: 'pm24_010',
    dimensionId: 'orden_precision',
    direction: 'direct',
    sortOrder: 202,
    text: 'Mientras trabajo con varios archivos o materiales, suelo dedicar algo de tiempo a mantenerlos organizados en lugar de ordenarlos hasta que termino.',
    bankStatus: 'draft',
  },
  {
    itemId: 'pm24_011',
    dimensionId: 'orden_precision',
    direction: 'direct',
    sortOrder: 203,
    text: 'Cuando una tarea implica varios pasos, los ordeno antes de comenzar a ejecutarlos.',
    bankStatus: 'draft',
  },
  {
    itemId: 'pm24_012',
    dimensionId: 'orden_precision',
    direction: 'direct',
    sortOrder: 204,
    text: 'Al contrastar partes de un mismo trabajo, detecto cuando los datos o las cifras no cuadran entre sí.',
    bankStatus: 'draft',
  },
  {
    itemId: 'pm24_013',
    dimensionId: 'orden_precision',
    direction: 'direct',
    sortOrder: 205,
    text: 'Mientras avanzo, me doy cuenta si falta algún dato o pieza que necesito para seguir con lo que estoy haciendo.',
    bankStatus: 'draft',
  },
  {
    itemId: 'pm24_014',
    dimensionId: 'orden_precision',
    direction: 'direct',
    sortOrder: 206,
    text: 'Noto diferencias pequeñas en cifras o detalles cuando podrían alterar el resultado del trabajo.',
    bankStatus: 'draft',
  },
  {
    itemId: 'pm24_015',
    dimensionId: 'orden_precision',
    direction: 'direct',
    sortOrder: 207,
    text: 'Antes de cerrar una tarea, suelo dedicar un momento adicional a revisar los puntos que considero más relevantes.',
    bankStatus: 'draft',
  },
  {
    itemId: 'pm24_016',
    dimensionId: 'orden_precision',
    direction: 'inverse',
    sortOrder: 208,
    text: 'Cuando considero que una tarea ya cumple con lo necesario, prefiero avanzar a la siguiente actividad en lugar de hacer una revisión adicional.',
    bankStatus: 'draft',
  },
];

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
  const text = typeof item?.text === 'string' ? item.text.trim() : '';
  if (!text) errors.push('empty text');
  return errors;
}

/**
 * Validación del banco en código (IDs, sortOrder, draft vs production).
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validatePersonalityMind24ItemBank(items = PERSONALIDAD_MIND24_ITEMS) {
  const errors = [];
  const itemIds = new Set();
  const sortOrders = new Set();

  for (const item of items) {
    const itemErrors = validatePersonalityMind24Item(item);
    if (itemErrors.length) {
      errors.push(`${item?.itemId || '?'}: ${itemErrors.join(', ')}`);
    }
    if (item?.itemId) {
      if (itemIds.has(item.itemId)) errors.push(`duplicate itemId: ${item.itemId}`);
      itemIds.add(item.itemId);
    }
    if (Number.isFinite(Number(item?.sortOrder))) {
      const so = Number(item.sortOrder);
      if (sortOrders.has(so)) errors.push(`duplicate sortOrder: ${so}`);
      sortOrders.add(so);
    }
  }

  return { ok: errors.length === 0, errors };
}

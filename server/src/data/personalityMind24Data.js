/**
 * Catálogo — Personalidad laboral Mind24 (clave: personalidad_mind24).
 * Banco total: 80 reactivos (10 dimensiones × 8 en banco).
 * Forma activa v2: 60 reactivos (6 por dimensión) — shortlist aprobada.
 * Reserva: 20 reactivos (permanecen en banco/BD, no entran en intentos nuevos).
 * Forma legacy v1 (intentos congelados): 80 reactivos, 8 por dimensión.
 */

export const PERSONALIDAD_MIND24_CATALOG_VERSION = 2;

/** Versión de forma congelada en intento (metadata results.personalityMind24.formVersion). */
export const PERSONALIDAD_MIND24_LEGACY_FORM_VERSION = 1;
export const PERSONALIDAD_MIND24_ACTIVE_FORM_VERSION = 2;

export const PERSONALIDAD_MIND24_LEGACY_ITEMS_PER_DIMENSION = 8;
export const PERSONALIDAD_MIND24_BANK_ITEM_COUNT = 80;
export const PERSONALIDAD_MIND24_RESERVE_ITEM_COUNT = 20;

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

/** Shortlist definitiva — forma activa v2 (60). */
export const PERSONALIDAD_MIND24_ACTIVE_FORM_ITEM_IDS = [
  'pm24_002',
  'pm24_003',
  'pm24_004',
  'pm24_006',
  'pm24_007',
  'pm24_008',
  'pm24_009',
  'pm24_010',
  'pm24_012',
  'pm24_013',
  'pm24_015',
  'pm24_016',
  'pm24_017',
  'pm24_019',
  'pm24_021',
  'pm24_022',
  'pm24_023',
  'pm24_024',
  'pm24_025',
  'pm24_026',
  'pm24_029',
  'pm24_030',
  'pm24_031',
  'pm24_032',
  'pm24_033',
  'pm24_034',
  'pm24_036',
  'pm24_037',
  'pm24_039',
  'pm24_040',
  'pm24_042',
  'pm24_043',
  'pm24_044',
  'pm24_046',
  'pm24_047',
  'pm24_048',
  'pm24_050',
  'pm24_051',
  'pm24_052',
  'pm24_054',
  'pm24_055',
  'pm24_056',
  'pm24_058',
  'pm24_059',
  'pm24_060',
  'pm24_062',
  'pm24_063',
  'pm24_064',
  'pm24_065',
  'pm24_067',
  'pm24_068',
  'pm24_069',
  'pm24_071',
  'pm24_072',
  'pm24_073',
  'pm24_074',
  'pm24_076',
  'pm24_077',
  'pm24_079',
  'pm24_080',
];

/** Banco de reserva v2 (20) — no eliminar del catálogo ni de BD. */
export const PERSONALIDAD_MIND24_RESERVE_FORM_ITEM_IDS = [
  'pm24_001',
  'pm24_005',
  'pm24_011',
  'pm24_014',
  'pm24_018',
  'pm24_020',
  'pm24_027',
  'pm24_028',
  'pm24_035',
  'pm24_038',
  'pm24_041',
  'pm24_045',
  'pm24_049',
  'pm24_053',
  'pm24_057',
  'pm24_061',
  'pm24_066',
  'pm24_070',
  'pm24_075',
  'pm24_078',
];

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
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_002',
    dimensionId: 'logro_persistencia',
    direction: 'direct',
    sortOrder: 102,
    text: 'Mientras avanzo en una tarea, verifico si lo que estoy haciendo sigue acercándome al resultado esperado.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_003',
    dimensionId: 'logro_persistencia',
    direction: 'direct',
    sortOrder: 103,
    text: 'Cuando aparecen tareas secundarias durante un trabajo, vuelvo a centrar mi esfuerzo en el objetivo principal.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_004',
    dimensionId: 'logro_persistencia',
    direction: 'direct',
    sortOrder: 104,
    text: 'Cuando una tarea se complica más de lo previsto, hago nuevos intentos antes de dejarla pendiente.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_005',
    dimensionId: 'logro_persistencia',
    direction: 'direct',
    sortOrder: 105,
    text: 'Si una tarea requiere más intentos de los previstos, suelo mantener el trabajo en ella aunque avance más lento de lo que tenía previsto.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_006',
    dimensionId: 'logro_persistencia',
    direction: 'inverse',
    sortOrder: 106,
    text: 'Después de varios intentos sin avance en una tarea, suelo dejarla en pausa y concentrarme temporalmente en otras actividades.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_007',
    dimensionId: 'logro_persistencia',
    direction: 'direct',
    sortOrder: 107,
    text: 'Después de completar la parte principal de una tarea, doy seguimiento a los pendientes relacionados hasta dejarlos cerrados.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_008',
    dimensionId: 'logro_persistencia',
    direction: 'direct',
    sortOrder: 108,
    text: 'Cuando dejo una tarea a medias para atender otra prioridad, procuro retomarla después hasta cerrarla.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_009',
    dimensionId: 'orden_precision',
    direction: 'direct',
    sortOrder: 201,
    text: 'Antes de abordar varios pendientes del mismo trabajo, defino el orden en que los iré atendiendo.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_010',
    dimensionId: 'orden_precision',
    direction: 'direct',
    sortOrder: 202,
    text: 'Mientras trabajo con varios archivos o materiales, suelo dedicar algo de tiempo a mantenerlos organizados en lugar de ordenarlos hasta que termino.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_011',
    dimensionId: 'orden_precision',
    direction: 'direct',
    sortOrder: 203,
    text: 'Cuando una tarea implica varios pasos, los ordeno antes de comenzar a ejecutarlos.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_012',
    dimensionId: 'orden_precision',
    direction: 'direct',
    sortOrder: 204,
    text: 'Al contrastar partes de un mismo trabajo, detecto cuando los datos o las cifras no cuadran entre sí.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_013',
    dimensionId: 'orden_precision',
    direction: 'direct',
    sortOrder: 205,
    text: 'Mientras avanzo, me doy cuenta si falta algún dato o pieza que necesito para seguir con lo que estoy haciendo.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_014',
    dimensionId: 'orden_precision',
    direction: 'direct',
    sortOrder: 206,
    text: 'Noto diferencias pequeñas en cifras o detalles cuando podrían alterar el resultado del trabajo.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_015',
    dimensionId: 'orden_precision',
    direction: 'direct',
    sortOrder: 207,
    text: 'Antes de cerrar una tarea, suelo dedicar un momento adicional a revisar los puntos que considero más relevantes.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_016',
    dimensionId: 'orden_precision',
    direction: 'inverse',
    sortOrder: 208,
    text: 'Cuando considero que una tarea ya cumple con lo necesario, prefiero avanzar a la siguiente actividad en lugar de hacer una revisión adicional.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_017',
    dimensionId: 'autonomia_decision',
    direction: 'direct',
    sortOrder: 301,
    text: 'Después de quedar claro el resultado esperado, suelo avanzar por mi cuenta hasta que aparece algo que realmente requiere consulta.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_018',
    dimensionId: 'autonomia_decision',
    direction: 'direct',
    sortOrder: 302,
    text: 'Cuando surge una duda cotidiana en mi trabajo, suelo explorar primero una solución por mi cuenta antes de pedir apoyo.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_019',
    dimensionId: 'autonomia_decision',
    direction: 'inverse',
    sortOrder: 303,
    text: 'Para avanzar con claridad en mi trabajo, me resulta útil tener revisiones frecuentes de avance con mi responsable.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_020',
    dimensionId: 'autonomia_decision',
    direction: 'direct',
    sortOrder: 304,
    text: 'Ante varias formas razonables de hacer una tarea, suelo elegir una antes de buscar una segunda opinión.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_021',
    dimensionId: 'autonomia_decision',
    direction: 'direct',
    sortOrder: 305,
    text: 'Con la información disponible, suelo decidir entre las opciones presentes aunque queden aspectos sin cerrar por completo.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_022',
    dimensionId: 'autonomia_decision',
    direction: 'direct',
    sortOrder: 306,
    text: 'Cuando dos alternativas me parecen igualmente viables, suelo elegir una y trabajar a partir de ella.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_023',
    dimensionId: 'autonomia_decision',
    direction: 'direct',
    sortOrder: 307,
    text: 'Antes de asumir la conclusión de otras personas, suelo formar mi propia lectura de la situación.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_024',
    dimensionId: 'autonomia_decision',
    direction: 'direct',
    sortOrder: 308,
    text: 'Cuando recibo una recomendación sobre cómo proceder, suelo contrastarla con lo que yo observo antes de seguirla.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_025',
    dimensionId: 'influencia_persuasion',
    direction: 'direct',
    sortOrder: 401,
    text: 'Cuando una propuesta de trabajo genera opiniones distintas, suelo exponer las razones por las que considero que puede funcionar.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_026',
    dimensionId: 'influencia_persuasion',
    direction: 'direct',
    sortOrder: 402,
    text: 'Cuando quiero que una idea sea tomada en cuenta, suelo desarrollar los argumentos que la respaldan en lugar de limitarme a plantearla.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_027',
    dimensionId: 'influencia_persuasion',
    direction: 'direct',
    sortOrder: 403,
    text: 'Cuando alguien expresa una postura distinta sobre un tema de trabajo, suelo explicar los motivos de mi punto de vista.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_028',
    dimensionId: 'influencia_persuasion',
    direction: 'direct',
    sortOrder: 404,
    text: 'Cuando alguien no está convencido de una propuesta, suelo buscar otra manera de explicarle sus ventajas.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_029',
    dimensionId: 'influencia_persuasion',
    direction: 'direct',
    sortOrder: 405,
    text: 'Cuando noto que la otra persona no entendió lo que planteo, suelo reformular mi explicación antes de insistir con las mismas palabras.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_030',
    dimensionId: 'influencia_persuasion',
    direction: 'direct',
    sortOrder: 406,
    text: 'Según con quién hable, suelo destacar distintos aspectos de una misma propuesta.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_031',
    dimensionId: 'influencia_persuasion',
    direction: 'direct',
    sortOrder: 407,
    text: 'Cuando una propuesta queda sin una decisión clara, suelo aportar argumentos para ayudar a que la conversación avance hacia una conclusión.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_032',
    dimensionId: 'influencia_persuasion',
    direction: 'inverse',
    sortOrder: 408,
    text: 'Cuando una persona mantiene una opinión diferente después de escuchar mi punto, suelo dejar el tema ahí en lugar de buscar otro argumento.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_033',
    dimensionId: 'sociabilidad_colaboracion',
    direction: 'direct',
    sortOrder: 501,
    text: 'Cuando necesito coordinar algo con una persona que no conozco bien, suelo iniciar el contacto directamente.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_034',
    dimensionId: 'sociabilidad_colaboracion',
    direction: 'direct',
    sortOrder: 502,
    text: 'Al integrarme a un grupo de trabajo nuevo, suelo participar en los intercambios necesarios para entender cómo se trabaja.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_035',
    dimensionId: 'sociabilidad_colaboracion',
    direction: 'direct',
    sortOrder: 503,
    text: 'Cuando me falta información para avanzar en algo compartido, suelo acudir directamente a la persona involucrada.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_036',
    dimensionId: 'sociabilidad_colaboracion',
    direction: 'direct',
    sortOrder: 504,
    text: 'Cuando mi trabajo afecta lo que otra persona hará después, suelo mantenerla al tanto de los cambios relevantes.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_037',
    dimensionId: 'sociabilidad_colaboracion',
    direction: 'direct',
    sortOrder: 505,
    text: 'En trabajos compartidos, suelo hacer pausas breves para poner en común avances con los demás en lugar de esperar hasta el final para coordinarnos.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_038',
    dimensionId: 'sociabilidad_colaboracion',
    direction: 'direct',
    sortOrder: 506,
    text: 'Cuando una tarea depende de varias personas, suelo alinear mi parte con lo que necesitan las demás para continuar.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_039',
    dimensionId: 'sociabilidad_colaboracion',
    direction: 'direct',
    sortOrder: 507,
    text: 'Cuando alguien del equipo tiene una duda sobre algo que conozco, suelo dedicar un momento a orientarlo antes de continuar con lo mío.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_040',
    dimensionId: 'sociabilidad_colaboracion',
    direction: 'inverse',
    sortOrder: 508,
    text: 'Cuando cada persona tiene claramente definida su parte, prefiero concentrarme en la mía y ofrecer apoyo en las demás solo cuando me lo solicitan.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_041',
    dimensionId: 'liderazgo_equipos',
    direction: 'direct',
    sortOrder: 601,
    text: 'Cuando varias personas necesitan definir cómo continuar con una tarea, suelo participar en ordenar los siguientes pasos.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_042',
    dimensionId: 'liderazgo_equipos',
    direction: 'direct',
    sortOrder: 602,
    text: 'Cuando un trabajo grupal queda sin una dirección clara, suelo proponer una forma de organizar el avance.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_043',
    dimensionId: 'liderazgo_equipos',
    direction: 'direct',
    sortOrder: 603,
    text: 'Cuando un grupo tiene claro qué debe lograr pero nadie está coordinando el arranque, suelo asumir temporalmente la organización de los primeros pasos.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_044',
    dimensionId: 'liderazgo_equipos',
    direction: 'direct',
    sortOrder: 604,
    text: 'Cuando varias personas participan en una misma entrega, suelo ayudar a aclarar qué necesita avanzar primero para que el resto pueda continuar.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_045',
    dimensionId: 'liderazgo_equipos',
    direction: 'direct',
    sortOrder: 605,
    text: 'En trabajos donde intervienen varias personas, suelo señalar las dependencias entre partes para que cada quien sepa qué esperar.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_046',
    dimensionId: 'liderazgo_equipos',
    direction: 'direct',
    sortOrder: 606,
    text: 'Cuando en un trabajo compartido hay responsabilidades que se traslapan, suelo ayudar a aclarar quién se encargará de cada parte.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_047',
    dimensionId: 'liderazgo_equipos',
    direction: 'direct',
    sortOrder: 607,
    text: 'Después de que un grupo acuerda un plan, suelo mantenerme atento al avance general además de concentrarme en mi propia parte.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_048',
    dimensionId: 'liderazgo_equipos',
    direction: 'inverse',
    sortOrder: 608,
    text: 'Cuando el trabajo de un grupo ya tiene participantes capaces, prefiero concentrarme en mi propia parte y dejar la coordinación a otra persona.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_049',
    dimensionId: 'apego_normas',
    direction: 'direct',
    sortOrder: 701,
    text: 'Cuando una actividad ya tiene un método establecido, suelo comenzar por ese método antes de explorar otra forma de hacerla.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_050',
    dimensionId: 'apego_normas',
    direction: 'direct',
    sortOrder: 702,
    text: 'Cuando una tarea incluye una secuencia de pasos definida, suelo seguirla antes de resolverla por mi propio criterio.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_051',
    dimensionId: 'apego_normas',
    direction: 'direct',
    sortOrder: 703,
    text: 'Si hay un procedimiento definido para un trabajo que ya conozco, suelo utilizarlo en lugar de improvisar los pasos sobre la marcha.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_052',
    dimensionId: 'apego_normas',
    direction: 'direct',
    sortOrder: 704,
    text: 'Cuando existe un criterio establecido para considerar una tarea terminada, suelo tomarlo como referencia aunque mi forma personal de evaluarla sea distinta.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_053',
    dimensionId: 'apego_normas',
    direction: 'direct',
    sortOrder: 705,
    text: 'Cuando distintas personas entregan un trabajo comparable, suelo utilizar los parámetros comunes en lugar de un criterio propio.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_054',
    dimensionId: 'apego_normas',
    direction: 'direct',
    sortOrder: 706,
    text: 'Si hay un formato establecido para presentar un trabajo, suelo usarlo aunque me resulte más natural otro esquema.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_055',
    dimensionId: 'apego_normas',
    direction: 'direct',
    sortOrder: 707,
    text: 'Cuando un proceso incluye un punto de revisión o autorización antes de continuar, suelo incorporarlo al flujo de trabajo en lugar de avanzar de un tirón.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_056',
    dimensionId: 'apego_normas',
    direction: 'inverse',
    sortOrder: 708,
    text: 'Cuando una tarea incluye varios puntos de control, prefiero avanzar de forma continua y concentrar las revisiones al final cuando es posible.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_057',
    dimensionId: 'regulacion_presion',
    direction: 'direct',
    sortOrder: 801,
    text: 'Cuando una conversación laboral se vuelve tensa, suelo cuidar la forma en que respondo aunque el intercambio siga siendo exigente.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_058',
    dimensionId: 'regulacion_presion',
    direction: 'direct',
    sortOrder: 802,
    text: 'Cuando algo me molesta durante el trabajo, suelo darme un momento antes de responder si la situación lo permite.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_059',
    dimensionId: 'regulacion_presion',
    direction: 'direct',
    sortOrder: 803,
    text: 'Cuando coinciden varias demandas urgentes, suelo evitar que la presión de una situación cambie la forma en que atiendo las demás.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_060',
    dimensionId: 'regulacion_presion',
    direction: 'direct',
    sortOrder: 804,
    text: 'Después de un contratiempo, suelo volver a concentrarme en lo que estoy haciendo aunque todavía tenga presente lo ocurrido.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_061',
    dimensionId: 'regulacion_presion',
    direction: 'direct',
    sortOrder: 805,
    text: 'Cuando cometo un error durante una jornada, suelo separar lo ocurrido de las tareas que siguen en lugar de continuar repasándolo mientras trabajo.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_062',
    dimensionId: 'regulacion_presion',
    direction: 'inverse',
    sortOrder: 806,
    text: 'Después de un resultado que me toma por sorpresa, suelo necesitar un tiempo antes de volver a concentrarme en el trabajo.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_063',
    dimensionId: 'regulacion_presion',
    direction: 'direct',
    sortOrder: 807,
    text: 'Cuando una propuesta en la que trabajé no es aceptada, suelo poder continuar con el siguiente asunto sin quedarme demasiado tiempo en ese resultado.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_064',
    dimensionId: 'regulacion_presion',
    direction: 'direct',
    sortOrder: 808,
    text: 'Después de recibir una observación crítica inesperada sobre mi trabajo, suelo volver al tema con suficiente distancia para seguir trabajando en él.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_065',
    dimensionId: 'dinamismo_iniciativa',
    direction: 'direct',
    sortOrder: 901,
    text: 'Cuando durante la jornada hay varias actividades disponibles y ninguna requiere atención inmediata, suelo mantenerme atendiendo alguna de ellas en lugar de esperar a que surja algo prioritario.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_066',
    dimensionId: 'dinamismo_iniciativa',
    direction: 'direct',
    sortOrder: 902,
    text: 'Durante periodos con varias tareas disponibles, suelo mantenerme atendiendo alguna de ellas en lugar de dejar espacios largos entre actividades.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_067',
    dimensionId: 'dinamismo_iniciativa',
    direction: 'direct',
    sortOrder: 903,
    text: 'Cuando en la jornada aparecen ratos sin una actividad inmediata, suelo pasarme a algo pendiente que pueda atender en ese momento.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_068',
    dimensionId: 'dinamismo_iniciativa',
    direction: 'direct',
    sortOrder: 904,
    text: 'Cuando ya entiendo lo necesario para empezar una tarea, suelo dar un primer paso práctico antes de seguir afinando cómo la abordaré.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_069',
    dimensionId: 'dinamismo_iniciativa',
    direction: 'direct',
    sortOrder: 905,
    text: 'Cuando una tarea puede ponerse en marcha con la información disponible, suelo iniciar la parte que ya está definida aunque queden detalles menores por precisar.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_070',
    dimensionId: 'dinamismo_iniciativa',
    direction: 'direct',
    sortOrder: 906,
    text: 'Cuando me indican qué hacer y no falta información clave, suelo empezar a ejecutarlo en lugar de posponer el inicio.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_071',
    dimensionId: 'dinamismo_iniciativa',
    direction: 'direct',
    sortOrder: 907,
    text: 'Cuando termino una parte de mi trabajo, suelo enlazar con la siguiente sin necesitar una pausa larga entre ambas.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_072',
    dimensionId: 'dinamismo_iniciativa',
    direction: 'inverse',
    sortOrder: 908,
    text: 'Cuando termino una tarea, suelo tomarme un tiempo antes de comenzar la siguiente aunque ya sepa qué sigue.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_073',
    dimensionId: 'adaptabilidad_cambio',
    direction: 'direct',
    sortOrder: 1001,
    text: 'Cuando cambia la forma en que debe hacerse una tarea, suelo ajustar mi manera de trabajar después de entender el nuevo esquema.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_074',
    dimensionId: 'adaptabilidad_cambio',
    direction: 'direct',
    sortOrder: 1002,
    text: 'Cuando se introduce una nueva forma de trabajo, suelo empezar a incorporarla aunque todavía me resulte más familiar la anterior.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_075',
    dimensionId: 'adaptabilidad_cambio',
    direction: 'direct',
    sortOrder: 1003,
    text: 'Cuando aparecen condiciones nuevas en cómo debe ejecutarse un trabajo, suelo adaptar los pasos que suelo usar a esas condiciones.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_076',
    dimensionId: 'adaptabilidad_cambio',
    direction: 'direct',
    sortOrder: 1004,
    text: 'Cuando cambia una prioridad durante la jornada, suelo reorganizar lo que estaba atendiendo para reflejar la nueva necesidad.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_077',
    dimensionId: 'adaptabilidad_cambio',
    direction: 'direct',
    sortOrder: 1005,
    text: 'Si una tarea que iba después se vuelve necesaria para que otras puedan avanzar, suelo cambiar el orden previsto.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_078',
    dimensionId: 'adaptabilidad_cambio',
    direction: 'direct',
    sortOrder: 1006,
    text: 'Cuando cambia qué necesita resolverse primero, suelo ajustar el orden previsto aunque ya hubiera comenzado otra actividad.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_079',
    dimensionId: 'adaptabilidad_cambio',
    direction: 'direct',
    sortOrder: 1007,
    text: 'Cuando un método deja de ajustarse a las condiciones del trabajo, suelo modificarlo en lugar de mantenerlo solo porque ya había empezado así.',
    bankStatus: 'pilot',
  },
  {
    itemId: 'pm24_080',
    dimensionId: 'adaptabilidad_cambio',
    direction: 'inverse',
    sortOrder: 1008,
    text: 'Cuando una forma de trabajo me ha funcionado bien, prefiero mantenerla mientras sea posible antes de cambiar a otra.',
    bankStatus: 'pilot',
  },
];

export function personalityDimensionById(dimensionId) {
  return PERSONALIDAD_MIND24_DIMENSIONS.find((d) => d.dimensionId === dimensionId) || null;
}

export function personalityItemsFlat() {
  return [...PERSONALIDAD_MIND24_ITEMS].sort((a, b) => a.sortOrder - b.sortOrder);
}

const SYNCABLE_BANK_STATUSES = new Set(['pilot', 'production']);

function personalityItemsWithBankStatus(bankStatus) {
  return personalityItemsFlat().filter((item) => item.bankStatus === bankStatus);
}

/** Ítems en edición (no sincronizables a BD). */
export function personalityDraftItemsFlat() {
  return personalityItemsWithBankStatus('draft');
}

/** Ítems piloto (sincronizables). */
export function personalityPilotItemsFlat() {
  return personalityItemsWithBankStatus('pilot');
}

/** Ítems que conforman el formulario fijo v1 (solo bankStatus production). */
export function personalityProductionItemsFlat() {
  return personalityItemsWithBankStatus('production');
}

/** pilot ∪ production — excluye draft (banco completo sincronizable a BD, 80). */
export function personalityMind24SyncableItemsFlat() {
  return personalityItemsFlat().filter((item) => SYNCABLE_BANK_STATUSES.has(item.bankStatus));
}

/** Alias corto alineado con otros módulos. */
export function personalitySyncableItemsFlat() {
  return personalityMind24SyncableItemsFlat();
}

/** Banco total en código (alias explícito para reportes/sync). */
export function personalityMind24BankItemsFlat() {
  return personalitySyncableItemsFlat();
}

/** Forma legacy v1 congelada: los 80 ítems sincronizables (8 por dimensión). */
export function personalityLegacyFormItemsFlat() {
  return personalitySyncableItemsFlat();
}

const _personalityItemById = () => new Map(PERSONALIDAD_MIND24_ITEMS.map((i) => [i.itemId, i]));

/** Forma activa v2 — exactamente los 60 IDs aprobados. */
export function getPersonalityMind24ActiveFormItems() {
  const byId = _personalityItemById();
  return PERSONALIDAD_MIND24_ACTIVE_FORM_ITEM_IDS.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`PERSONALITY_ACTIVE_FORM_MISSING_ITEM:${id}`);
    return item;
  });
}

/** Ítems de reserva (20) — permanecen en banco, excluidos de intentos nuevos. */
export function getPersonalityMind24ReserveFormItems() {
  const byId = _personalityItemById();
  return PERSONALIDAD_MIND24_RESERVE_FORM_ITEM_IDS.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`PERSONALITY_RESERVE_FORM_MISSING_ITEM:${id}`);
    return item;
  });
}

/** Preguntas activas en forma v2 (live). */
export function personalityQuestionCount() {
  return getPersonalityMind24ActiveFormItems().length;
}

/** Preguntas sincronizables en BD (banco 80). */
export function personalitySyncableQuestionCount() {
  return personalitySyncableItemsFlat().length;
}

export function personalityActiveFormQuestionCount() {
  return getPersonalityMind24ActiveFormItems().length;
}

/**
 * Conteo esperado por dimensión a partir de un subconjunto de ítems.
 * @param {typeof PERSONALIDAD_MIND24_ITEMS} [items] default: production
 */
export function personalityExpectedCountByDimension(items) {
  const source =
    items === undefined ? personalityProductionItemsFlat() : Array.isArray(items) ? items : [];
  const counts = Object.fromEntries(
    PERSONALIDAD_MIND24_DIMENSIONS.map((d) => [d.dimensionId, 0]),
  );
  for (const item of source) {
    if (counts[item.dimensionId] != null) counts[item.dimensionId] += 1;
  }
  return counts;
}

/** Conteo esperado por dimensión del conjunto sincronizable actual. */
export function personalitySyncableExpectedCountByDimension() {
  return personalityExpectedCountByDimension(personalitySyncableItemsFlat());
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

/**
 * Valida banco 80, forma activa 60, reserva 20 y shortlists aprobadas.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validatePersonalityMind24FormPartition() {
  const errors = [];
  const bank = personalityMind24BankItemsFlat();
  const active = getPersonalityMind24ActiveFormItems();
  const reserve = getPersonalityMind24ReserveFormItems();
  const bankIds = new Set(bank.map((i) => i.itemId));
  const activeIds = new Set(active.map((i) => i.itemId));
  const reserveIds = new Set(reserve.map((i) => i.itemId));

  if (bank.length !== PERSONALIDAD_MIND24_BANK_ITEM_COUNT) {
    errors.push(`bank count ${bank.length} !== ${PERSONALIDAD_MIND24_BANK_ITEM_COUNT}`);
  }
  if (active.length !== PERSONALIDAD_MIND24_FORM_ITEM_COUNT) {
    errors.push(`active form ${active.length} !== ${PERSONALIDAD_MIND24_FORM_ITEM_COUNT}`);
  }
  if (reserve.length !== PERSONALIDAD_MIND24_RESERVE_ITEM_COUNT) {
    errors.push(`reserve ${reserve.length} !== ${PERSONALIDAD_MIND24_RESERVE_ITEM_COUNT}`);
  }
  for (const id of PERSONALIDAD_MIND24_ACTIVE_FORM_ITEM_IDS) {
    if (!bankIds.has(id)) errors.push(`active id not in bank: ${id}`);
    if (reserveIds.has(id)) errors.push(`active id also reserve: ${id}`);
  }
  for (const id of PERSONALIDAD_MIND24_RESERVE_FORM_ITEM_IDS) {
    if (!bankIds.has(id)) errors.push(`reserve id not in bank: ${id}`);
    if (activeIds.has(id)) errors.push(`reserve id also active: ${id}`);
  }
  for (const id of bankIds) {
    if (!activeIds.has(id) && !reserveIds.has(id)) {
      errors.push(`bank item neither active nor reserve: ${id}`);
    }
  }
  const activeByDim = personalityExpectedCountByDimension(active);
  for (const dim of PERSONALIDAD_MIND24_DIMENSIONS) {
    if (activeByDim[dim.dimensionId] !== PERSONALIDAD_MIND24_ITEMS_PER_DIMENSION) {
      errors.push(
        `active dim ${dim.dimensionId}: ${activeByDim[dim.dimensionId]} !== ${PERSONALIDAD_MIND24_ITEMS_PER_DIMENSION}`,
      );
    }
  }
  const legacyByDim = personalityExpectedCountByDimension(personalityLegacyFormItemsFlat());
  for (const dim of PERSONALIDAD_MIND24_DIMENSIONS) {
    if (legacyByDim[dim.dimensionId] !== PERSONALIDAD_MIND24_LEGACY_ITEMS_PER_DIMENSION) {
      errors.push(
        `legacy dim ${dim.dimensionId}: ${legacyByDim[dim.dimensionId]} !== ${PERSONALIDAD_MIND24_LEGACY_ITEMS_PER_DIMENSION}`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Filtra preguntas BD al formulario activo v2 (por metadata.personalityItemId). */
export function filterPersonalityCatalogQuestionsToActiveForm(catalogQuestions) {
  const activeIds = new Set(getPersonalityMind24ActiveFormItems().map((i) => i.itemId));
  return (catalogQuestions || []).filter((q) => {
    const meta = q?.metadata && typeof q.metadata === 'object' ? q.metadata : {};
    const itemId = meta.personalityItemId;
    return itemId && activeIds.has(String(itemId));
  });
}

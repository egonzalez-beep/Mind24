/**
 * Clave DISC — Test Cleaver (manual español).
 *
 * El instrumento se califica con DOS claves independientes: la palabra elegida
 * como MÁS y la elegida como MENOS pueden apuntar a escalas distintas, y una
 * selección puede ser válida sin sumar a ninguna escala (`null`).
 *
 * `CLEAVER_ML_KEY` contiene únicamente los bloques cuya clave MÁS/MENOS está
 * verificada contra plantillas de calificación. Los bloques ausentes se
 * resuelven desde `CLEAVER_LEGACY_DIMENSIONS` (una sola dimensión por adjetivo,
 * heredada del mapeo anterior) y quedan marcados `pending_ml`: no se inventa
 * clave M/L para ellos.
 *
 * No alterar los textos del instrumento.
 */

export const CLEAVER_DISC_KEYS = ['D', 'I', 'S', 'C'];

/** Esquema de metadata de opción soportado por el scorer M/L. */
export const CLEAVER_KEY_SCHEMA = 'ml_v1';

/** Estado de verificación psicométrica de la clave de un bloque. */
export const CLEAVER_KEY_STATUS = {
  VERIFIED: 'verified_ml',
  PENDING: 'pending_ml',
};

export const CLEAVER_KEY_STATUSES = Object.values(CLEAVER_KEY_STATUS);

/**
 * Claves MÁS/MENOS verificadas, indexadas por número de bloque (tétrada).
 * `null` = selección válida que no puntúa en esa escala.
 */
export const CLEAVER_ML_KEY = {
  18: {
    Conforme: { dimensionMore: null, dimensionLess: 'S' },
    Confiable: { dimensionMore: 'I', dimensionLess: 'I' },
    Pacífico: { dimensionMore: 'C', dimensionLess: 'C' },
    Positivo: { dimensionMore: 'D', dimensionLess: 'D' },
  },
};

/**
 * Mapeo heredado de una dimensión por adjetivo. Se usa como clave M/L simétrica
 * (`dimensionMore === dimensionLess`) para los bloques todavía sin verificar.
 * Conservar como registro auditable del banco anterior.
 */
export const CLEAVER_LEGACY_DIMENSIONS = {
  Persuasivo: 'I',
  Gentil: 'S',
  Humilde: 'C',
  Original: 'D',
  Agresivo: 'D',
  'Alma de la fiesta': 'I',
  Comodino: 'S',
  Temeroso: 'C',
  Agradable: 'S',
  'Temeroso de Dios': 'C',
  Tenaz: 'D',
  Atractivo: 'I',
  Cauteloso: 'C',
  Determinado: 'D',
  Convincente: 'I',
  Bonachón: 'S',
  Dócil: 'C',
  Atrevido: 'D',
  Leal: 'S',
  Encantador: 'I',
  Dispuesto: 'S',
  Deseoso: 'I',
  Consecuente: 'C',
  Entusiasta: 'D',
  'Fuerza de voluntad': 'D',
  'Mente abierta': 'C',
  Complaciente: 'S',
  Animoso: 'I',
  Confiado: 'I',
  Simpatizador: 'S',
  Tolerante: 'C',
  Afirmativo: 'D',
  Ecuánime: 'S',
  Preciso: 'C',
  Nervioso: 'D',
  Jovial: 'I',
  Disciplinado: 'C',
  Generoso: 'S',
  Persistente: 'D',
  Competitivo: 'D',
  Alegre: 'I',
  Considerado: 'S',
  Armonioso: 'C',
  Admirable: 'I',
  Bondadoso: 'S',
  Resignado: 'C',
  'Carácter firme': 'D',
  Obediente: 'S',
  Quisquilloso: 'C',
  Inconquistable: 'D',
  Juguetón: 'I',
  Respetuoso: 'C',
  Emprendedor: 'D',
  Optimista: 'I',
  Servicial: 'S',
  Valiente: 'D',
  Inspirador: 'I',
  Sumiso: 'S',
  Tímido: 'C',
  Adaptable: 'C',
  Disputador: 'D',
  Indiferente: 'S',
  'Sangre liviana': 'I',
  Amiguero: 'I',
  Paciente: 'S',
  'Confianza en sí mismo': 'D',
  'Mesurado para hablar': 'C',
  Conforme: 'S',
  Confiable: 'S',
  Pacífico: 'C',
  Positivo: 'D',
  Aventurero: 'D',
  Receptivo: 'C',
  Cordial: 'I',
  Moderado: 'S',
  Indulgente: 'S',
  Esteta: 'C',
  Vigoroso: 'D',
  Sociable: 'I',
  Parlanchín: 'I',
  Controlado: 'S',
  Convencional: 'C',
  Decisivo: 'D',
  Cohibido: 'S',
  Exacto: 'C',
  Franco: 'D',
  'Buen compañero': 'I',
  Diplomático: 'C',
  Audaz: 'D',
  Refinado: 'I',
  Satisfecho: 'S',
  Inquieto: 'D',
  Popular: 'I',
  'Buen vecino': 'S',
  Devoto: 'C',
};

/** Bloques con clave MÁS/MENOS verificada. */
export function verifiedCleaverBlockOrders() {
  return Object.keys(CLEAVER_ML_KEY)
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

export function isVerifiedCleaverBlock(blockOrder) {
  return Object.prototype.hasOwnProperty.call(CLEAVER_ML_KEY, String(blockOrder));
}

/**
 * Resuelve la clave MÁS/MENOS de un adjetivo dentro de una tétrada concreta.
 * La clave real del instrumento es posicional, por eso requiere el bloque.
 *
 * @returns {{ dimensionMore: string|null, dimensionLess: string|null, keyStatus: string }}
 */
export function mlKeyForCleaverWord(blockOrder, text) {
  const verifiedBlock = CLEAVER_ML_KEY[blockOrder];
  const verified = verifiedBlock ? verifiedBlock[text] : undefined;

  if (verified) {
    return {
      dimensionMore: verified.dimensionMore ?? null,
      dimensionLess: verified.dimensionLess ?? null,
      keyStatus: CLEAVER_KEY_STATUS.VERIFIED,
    };
  }

  if (verifiedBlock) {
    throw new Error(
      `Cleaver: el bloque ${blockOrder} tiene clave M/L verificada pero falta la palabra "${text}"`,
    );
  }

  const legacy = CLEAVER_LEGACY_DIMENSIONS[text];
  if (!legacy || !CLEAVER_DISC_KEYS.includes(legacy)) {
    throw new Error(`Cleaver: falta clave DISC para la palabra "${text}" (bloque ${blockOrder})`);
  }

  return {
    dimensionMore: legacy,
    dimensionLess: legacy,
    keyStatus: CLEAVER_KEY_STATUS.PENDING,
  };
}

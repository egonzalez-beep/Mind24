/**
 * Clave DISC — Test Cleaver, 24 tétradas.
 *
 * El instrumento se califica con DOS claves independientes: la palabra elegida
 * como MÁS y la elegida como MENOS pueden apuntar a escalas distintas, y una
 * selección puede ser válida sin sumar a ninguna escala (`null`).
 *
 * Las 192 celdas (96 palabras × 2 roles) están verificadas contra tres
 * transcripciones públicas independientes de la plantilla de calificación:
 *
 *   F1  plantilla posicional — idoc.pub/documents/plantilla-cleaver-gen5oe35z1lo
 *   F2  listas por columna, Psic. Samantha Coria — idoc.pub/documents/
 *       plantilla-para-calificar-test-cleaver-vlr02yz95plz
 *   F3  plantilla ya calificada, "Instrumentos para el Diagnóstico Psicológico
 *       en Producción y Consumo", lám. 34 — slideshare.net/slideshow/
 *       test-cleaver-manual-y-cuadernillot/100335528
 *
 * F2 y F3 concuerdan en las 192 celdas y usan la misma edición del instrumento
 * que este banco. F1 pertenece a otra edición (dice "Capaz de ver belleza" por
 * "Esteta", "Contrariador" por "Disputador") y difiere en dos celdas —
 * bloque 18 "Confiable" MÁS y bloque 19 "Cordial" MÁS —, donde prevalece la
 * edición que corresponde a nuestro banco.
 *
 * La clave es posicional: se resuelve por (bloque, palabra), nunca por palabra
 * suelta. "Animoso" aparece en los bloques 7 y 10 con claves MÁS distintas.
 *
 * No alterar los textos del instrumento.
 */

export const CLEAVER_DISC_KEYS = ['D', 'I', 'S', 'C'];

/** Esquema de metadata de opción soportado por el scorer M/L. */
export const CLEAVER_KEY_SCHEMA = 'ml_v1';

/**
 * Estado de verificación psicométrica de la clave de un bloque.
 * `PENDING` ya no se emite desde este archivo; se conserva porque la BD puede
 * contener filas anteriores a la sincronización de la clave completa.
 */
export const CLEAVER_KEY_STATUS = {
  VERIFIED: 'verified_ml',
  PENDING: 'pending_ml',
};

export const CLEAVER_KEY_STATUSES = Object.values(CLEAVER_KEY_STATUS);

/**
 * Claves MÁS/MENOS por número de bloque (tétrada) y texto exacto del adjetivo.
 * `null` = selección válida que no puntúa en esa escala.
 */
export const CLEAVER_ML_KEY = {
  1: {
    Persuasivo: { dimensionMore: 'I', dimensionLess: null },
    Gentil: { dimensionMore: 'S', dimensionLess: 'S' },
    Humilde: { dimensionMore: 'C', dimensionLess: 'C' },
    Original: { dimensionMore: null, dimensionLess: 'D' },
  },
  2: {
    Agresivo: { dimensionMore: 'D', dimensionLess: null },
    'Alma de la fiesta': { dimensionMore: 'I', dimensionLess: 'I' },
    Comodino: { dimensionMore: 'S', dimensionLess: 'S' },
    Temeroso: { dimensionMore: null, dimensionLess: 'C' },
  },
  3: {
    Agradable: { dimensionMore: null, dimensionLess: 'S' },
    'Temeroso de Dios': { dimensionMore: 'C', dimensionLess: 'C' },
    Tenaz: { dimensionMore: 'D', dimensionLess: 'D' },
    Atractivo: { dimensionMore: 'I', dimensionLess: 'I' },
  },
  4: {
    Cauteloso: { dimensionMore: 'C', dimensionLess: 'C' },
    Determinado: { dimensionMore: 'D', dimensionLess: null },
    Convincente: { dimensionMore: 'I', dimensionLess: 'I' },
    Bonachón: { dimensionMore: 'S', dimensionLess: null },
  },
  5: {
    Dócil: { dimensionMore: null, dimensionLess: 'C' },
    Atrevido: { dimensionMore: 'D', dimensionLess: 'D' },
    Leal: { dimensionMore: 'S', dimensionLess: null },
    Encantador: { dimensionMore: 'I', dimensionLess: 'I' },
  },
  6: {
    Dispuesto: { dimensionMore: 'S', dimensionLess: null },
    Deseoso: { dimensionMore: null, dimensionLess: null },
    Consecuente: { dimensionMore: 'C', dimensionLess: 'C' },
    Entusiasta: { dimensionMore: null, dimensionLess: 'D' },
  },
  7: {
    'Fuerza de voluntad': { dimensionMore: null, dimensionLess: 'D' },
    'Mente abierta': { dimensionMore: 'C', dimensionLess: null },
    Complaciente: { dimensionMore: 'S', dimensionLess: 'S' },
    Animoso: { dimensionMore: 'I', dimensionLess: 'I' },
  },
  8: {
    Confiado: { dimensionMore: 'I', dimensionLess: null },
    Simpatizador: { dimensionMore: null, dimensionLess: 'S' },
    Tolerante: { dimensionMore: null, dimensionLess: 'C' },
    Afirmativo: { dimensionMore: 'D', dimensionLess: 'D' },
  },
  9: {
    Ecuánime: { dimensionMore: 'S', dimensionLess: 'S' },
    Preciso: { dimensionMore: 'C', dimensionLess: 'C' },
    Nervioso: { dimensionMore: null, dimensionLess: 'D' },
    Jovial: { dimensionMore: null, dimensionLess: 'I' },
  },
  10: {
    Disciplinado: { dimensionMore: 'C', dimensionLess: null },
    Generoso: { dimensionMore: 'S', dimensionLess: 'S' },
    Animoso: { dimensionMore: null, dimensionLess: 'I' },
    Persistente: { dimensionMore: 'D', dimensionLess: 'D' },
  },
  11: {
    Competitivo: { dimensionMore: 'D', dimensionLess: 'D' },
    Alegre: { dimensionMore: null, dimensionLess: 'I' },
    Considerado: { dimensionMore: 'S', dimensionLess: 'S' },
    Armonioso: { dimensionMore: null, dimensionLess: 'C' },
  },
  12: {
    Admirable: { dimensionMore: 'I', dimensionLess: null },
    Bondadoso: { dimensionMore: 'S', dimensionLess: null },
    Resignado: { dimensionMore: null, dimensionLess: 'C' },
    'Carácter firme': { dimensionMore: 'D', dimensionLess: 'D' },
  },
  13: {
    Obediente: { dimensionMore: 'S', dimensionLess: null },
    Quisquilloso: { dimensionMore: null, dimensionLess: 'C' },
    Inconquistable: { dimensionMore: 'D', dimensionLess: 'D' },
    Juguetón: { dimensionMore: 'I', dimensionLess: 'I' },
  },
  14: {
    Respetuoso: { dimensionMore: 'C', dimensionLess: null },
    Emprendedor: { dimensionMore: 'D', dimensionLess: 'D' },
    Optimista: { dimensionMore: 'I', dimensionLess: 'I' },
    Servicial: { dimensionMore: 'S', dimensionLess: 'S' },
  },
  15: {
    Valiente: { dimensionMore: 'D', dimensionLess: null },
    Inspirador: { dimensionMore: 'I', dimensionLess: null },
    Sumiso: { dimensionMore: null, dimensionLess: 'S' },
    Tímido: { dimensionMore: null, dimensionLess: 'C' },
  },
  16: {
    Adaptable: { dimensionMore: 'C', dimensionLess: null },
    Disputador: { dimensionMore: 'D', dimensionLess: 'D' },
    Indiferente: { dimensionMore: null, dimensionLess: 'S' },
    'Sangre liviana': { dimensionMore: 'I', dimensionLess: 'I' },
  },
  17: {
    Amiguero: { dimensionMore: 'I', dimensionLess: 'I' },
    Paciente: { dimensionMore: 'S', dimensionLess: 'S' },
    'Confianza en sí mismo': { dimensionMore: 'D', dimensionLess: 'D' },
    'Mesurado para hablar': { dimensionMore: 'C', dimensionLess: null },
  },
  18: {
    Conforme: { dimensionMore: null, dimensionLess: 'S' },
    Confiable: { dimensionMore: 'S', dimensionLess: 'I' },
    Pacífico: { dimensionMore: 'C', dimensionLess: 'C' },
    Positivo: { dimensionMore: 'D', dimensionLess: 'D' },
  },
  19: {
    Aventurero: { dimensionMore: 'D', dimensionLess: 'D' },
    Receptivo: { dimensionMore: 'C', dimensionLess: null },
    Cordial: { dimensionMore: null, dimensionLess: 'I' },
    Moderado: { dimensionMore: 'S', dimensionLess: 'S' },
  },
  20: {
    Indulgente: { dimensionMore: 'S', dimensionLess: 'S' },
    Esteta: { dimensionMore: null, dimensionLess: 'C' },
    Vigoroso: { dimensionMore: 'D', dimensionLess: 'D' },
    Sociable: { dimensionMore: 'I', dimensionLess: 'I' },
  },
  21: {
    Parlanchín: { dimensionMore: 'I', dimensionLess: 'I' },
    Controlado: { dimensionMore: 'S', dimensionLess: 'S' },
    Convencional: { dimensionMore: null, dimensionLess: 'C' },
    Decisivo: { dimensionMore: 'D', dimensionLess: 'D' },
  },
  22: {
    Cohibido: { dimensionMore: null, dimensionLess: 'S' },
    Exacto: { dimensionMore: 'C', dimensionLess: null },
    Franco: { dimensionMore: 'D', dimensionLess: 'D' },
    'Buen compañero': { dimensionMore: 'I', dimensionLess: 'I' },
  },
  23: {
    Diplomático: { dimensionMore: 'C', dimensionLess: null },
    Audaz: { dimensionMore: 'D', dimensionLess: 'D' },
    Refinado: { dimensionMore: null, dimensionLess: 'I' },
    Satisfecho: { dimensionMore: 'S', dimensionLess: 'S' },
  },
  24: {
    Inquieto: { dimensionMore: 'D', dimensionLess: 'D' },
    Popular: { dimensionMore: 'I', dimensionLess: 'I' },
    'Buen vecino': { dimensionMore: 'S', dimensionLess: 'S' },
    Devoto: { dimensionMore: 'C', dimensionLess: 'C' },
  },
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
 * No existe respaldo heredado: una palabra ausente de la clave es un error de
 * banco, nunca una dimensión inferida.
 *
 * @returns {{ dimensionMore: string|null, dimensionLess: string|null, keyStatus: string }}
 */
export function mlKeyForCleaverWord(blockOrder, text) {
  const block = CLEAVER_ML_KEY[blockOrder];
  if (!block) {
    throw new Error(`Cleaver: no hay clave M/L para el bloque ${blockOrder}`);
  }

  const entry = block[text];
  if (!entry) {
    throw new Error(
      `Cleaver: el bloque ${blockOrder} no declara clave M/L para la palabra "${text}"`,
    );
  }

  return {
    dimensionMore: entry.dimensionMore ?? null,
    dimensionLess: entry.dimensionLess ?? null,
    keyStatus: CLEAVER_KEY_STATUS.VERIFIED,
  };
}

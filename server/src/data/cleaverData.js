/**
 * Instrumento Cleaver oficial — 24 tétradas (96 selecciones, 95 adjetivos únicos).
 *
 * Los textos son estandarizados: no alterarlos. La clave DISC se resuelve por
 * (bloque, palabra) porque el instrumento distingue la selección MÁS de la
 * selección MENOS; ver `cleaverDiscKey.js`.
 */
import {
  CLEAVER_KEY_SCHEMA,
  mlKeyForCleaverWord,
} from './cleaverDiscKey.js';
import { assertValidCleaverBank } from './cleaverBankValidation.js';

export const CLEAVER_TETRAD_COUNT = 24;

/** Incrementar cuando cambie la clave DISC o el banco Cleaver (sella el catálogo en prod). */
export const CLEAVER_CATALOG_VERSION = 3;

/** Palabras por tétrada, en el orden del instrumento. */
export const CLEAVER_TETRAD_WORDS = [
  ['Persuasivo', 'Gentil', 'Humilde', 'Original'],
  ['Agresivo', 'Alma de la fiesta', 'Comodino', 'Temeroso'],
  ['Agradable', 'Temeroso de Dios', 'Tenaz', 'Atractivo'],
  ['Cauteloso', 'Determinado', 'Convincente', 'Bonachón'],
  ['Dócil', 'Atrevido', 'Leal', 'Encantador'],
  ['Dispuesto', 'Deseoso', 'Consecuente', 'Entusiasta'],
  ['Fuerza de voluntad', 'Mente abierta', 'Complaciente', 'Animoso'],
  ['Confiado', 'Simpatizador', 'Tolerante', 'Afirmativo'],
  ['Ecuánime', 'Preciso', 'Nervioso', 'Jovial'],
  ['Disciplinado', 'Generoso', 'Animoso', 'Persistente'],
  ['Competitivo', 'Alegre', 'Considerado', 'Armonioso'],
  ['Admirable', 'Bondadoso', 'Resignado', 'Carácter firme'],
  ['Obediente', 'Quisquilloso', 'Inconquistable', 'Juguetón'],
  ['Respetuoso', 'Emprendedor', 'Optimista', 'Servicial'],
  ['Valiente', 'Inspirador', 'Sumiso', 'Tímido'],
  ['Adaptable', 'Disputador', 'Indiferente', 'Sangre liviana'],
  ['Amiguero', 'Paciente', 'Confianza en sí mismo', 'Mesurado para hablar'],
  ['Conforme', 'Confiable', 'Pacífico', 'Positivo'],
  ['Aventurero', 'Receptivo', 'Cordial', 'Moderado'],
  ['Indulgente', 'Esteta', 'Vigoroso', 'Sociable'],
  ['Parlanchín', 'Controlado', 'Convencional', 'Decisivo'],
  ['Cohibido', 'Exacto', 'Franco', 'Buen compañero'],
  ['Diplomático', 'Audaz', 'Refinado', 'Satisfecho'],
  ['Inquieto', 'Popular', 'Buen vecino', 'Devoto'],
];

/** Metadata canónica de una opción, tal como debe persistirse en QuestionOption. */
export function cleaverOptionSpec(blockOrder, text) {
  const { dimensionMore, dimensionLess, keyStatus } = mlKeyForCleaverWord(blockOrder, text);
  const symmetric = dimensionMore !== null && dimensionMore === dimensionLess;

  const metadata = {
    keySchema: CLEAVER_KEY_SCHEMA,
    keyStatus,
    dimensionMore,
    dimensionLess,
  };
  if (symmetric) metadata.dimension = dimensionMore;

  return {
    text,
    /** Columna `value`: letra DISC solo cuando la clave es simétrica y no nula. */
    value: symmetric ? dimensionMore : '',
    metadata,
  };
}

export const cleaverBlocks = CLEAVER_TETRAD_WORDS.map((words, index) => {
  const order = index + 1;
  return {
    order,
    options: words.map((text) => cleaverOptionSpec(order, text)),
  };
});

/** Resultado de la validación estructural ejecutada al importar el banco. */
export const cleaverBankValidation = assertValidCleaverBank(cleaverBlocks);

const blocksByOrder = new Map(cleaverBlocks.map((block) => [block.order, block]));

export function cleaverBlockByOrder(order) {
  return blocksByOrder.get(Number(order)) ?? null;
}

const METADATA_FIELDS = ['keySchema', 'keyStatus', 'dimensionMore', 'dimensionLess', 'dimension'];

/** Compara metadata persistida contra la canónica, ignorando el orden de claves. */
export function cleaverOptionMetadataEquals(stored, canonical) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return false;
  for (const field of METADATA_FIELDS) {
    const hasStored = Object.prototype.hasOwnProperty.call(stored, field);
    const hasCanonical = Object.prototype.hasOwnProperty.call(canonical, field);
    if (hasStored !== hasCanonical) return false;
    if (hasCanonical && stored[field] !== canonical[field]) return false;
  }
  return true;
}

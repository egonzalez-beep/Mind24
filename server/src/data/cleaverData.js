/**
 * Bloques Cleaver (CLEAVER_MATRIX) — palabras con dimensión DISC por opción.
 * D = Dominancia, I = Influencia, S = Estabilidad, C = Cumplimiento.
 */
export const cleaverBlocks = [
  {
    blockNumber: 1,
    options: [
      { text: 'Persuasivo', dimension: 'I' },
      { text: 'Gentil', dimension: 'S' },
      { text: 'Humilde', dimension: 'C' },
      { text: 'Original', dimension: 'D' },
    ],
  },
  {
    blockNumber: 2,
    options: [
      { text: 'Agresivo', dimension: 'D' },
      { text: 'Alma de la fiesta', dimension: 'I' },
      { text: 'Comodino', dimension: 'S' },
      { text: 'Temeroso', dimension: 'C' },
    ],
  },
  {
    blockNumber: 3,
    options: [
      { text: 'Agradable', dimension: 'I' },
      { text: 'Temeroso de Dios', dimension: 'C' },
      { text: 'Tenaz', dimension: 'D' },
      { text: 'Atractivo', dimension: 'I' },
    ],
  },
  {
    blockNumber: 4,
    options: [
      { text: 'Animoso', dimension: 'I' },
      { text: 'Complaciente', dimension: 'S' },
      { text: 'Juguetón', dimension: 'I' },
      { text: 'Moderado', dimension: 'C' },
    ],
  },
];

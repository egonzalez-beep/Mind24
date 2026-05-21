/**
 * Instrumento Cleaver oficial — 24 tétradas (96 adjetivos).
 * Dimensiones DISC según clave del manual Cleaver (español).
 */
import { dimensionForCleaverWord } from './cleaverDiscKey.js';

export const CLEAVER_TETRAD_COUNT = 24;

function opt(text) {
  const dimension = dimensionForCleaverWord(text);
  return { text, metadata: { dimension } };
}

export const cleaverBlocks = [
  {
    order: 1,
    options: [opt('Persuasivo'), opt('Gentil'), opt('Humilde'), opt('Original')],
  },
  {
    order: 2,
    options: [
      opt('Agresivo'),
      opt('Alma de la fiesta'),
      opt('Comodino'),
      opt('Temeroso'),
    ],
  },
  {
    order: 3,
    options: [
      opt('Agradable'),
      opt('Temeroso de Dios'),
      opt('Tenaz'),
      opt('Atractivo'),
    ],
  },
  {
    order: 4,
    options: [
      opt('Cauteloso'),
      opt('Determinado'),
      opt('Convincente'),
      opt('Bonachón'),
    ],
  },
  {
    order: 5,
    options: [opt('Dócil'), opt('Atrevido'), opt('Leal'), opt('Encantador')],
  },
  {
    order: 6,
    options: [
      opt('Dispuesto'),
      opt('Deseoso'),
      opt('Consecuente'),
      opt('Entusiasta'),
    ],
  },
  {
    order: 7,
    options: [
      opt('Fuerza de voluntad'),
      opt('Mente abierta'),
      opt('Complaciente'),
      opt('Animoso'),
    ],
  },
  {
    order: 8,
    options: [
      opt('Confiado'),
      opt('Simpatizador'),
      opt('Tolerante'),
      opt('Afirmativo'),
    ],
  },
  {
    order: 9,
    options: [opt('Ecuánime'), opt('Preciso'), opt('Nervioso'), opt('Jovial')],
  },
  {
    order: 10,
    options: [
      opt('Disciplinado'),
      opt('Generoso'),
      opt('Animoso'),
      opt('Persistente'),
    ],
  },
  {
    order: 11,
    options: [
      opt('Competitivo'),
      opt('Alegre'),
      opt('Considerado'),
      opt('Armonioso'),
    ],
  },
  {
    order: 12,
    options: [
      opt('Admirable'),
      opt('Bondadoso'),
      opt('Resignado'),
      opt('Carácter firme'),
    ],
  },
  {
    order: 13,
    options: [
      opt('Obediente'),
      opt('Quisquilloso'),
      opt('Inconquistable'),
      opt('Juguetón'),
    ],
  },
  {
    order: 14,
    options: [
      opt('Respetuoso'),
      opt('Emprendedor'),
      opt('Optimista'),
      opt('Servicial'),
    ],
  },
  {
    order: 15,
    options: [opt('Valiente'), opt('Inspirador'), opt('Sumiso'), opt('Tímido')],
  },
  {
    order: 16,
    options: [
      opt('Adaptable'),
      opt('Disputador'),
      opt('Indiferente'),
      opt('Sangre liviana'),
    ],
  },
  {
    order: 17,
    options: [
      opt('Amiguero'),
      opt('Paciente'),
      opt('Confianza en sí mismo'),
      opt('Mesurado para hablar'),
    ],
  },
  {
    order: 18,
    options: [
      opt('Conforme'),
      opt('Confiable'),
      opt('Pacífico'),
      opt('Positivo'),
    ],
  },
  {
    order: 19,
    options: [
      opt('Aventurero'),
      opt('Receptivo'),
      opt('Cordial'),
      opt('Moderado'),
    ],
  },
  {
    order: 20,
    options: [
      opt('Indulgente'),
      opt('Esteta'),
      opt('Vigoroso'),
      opt('Sociable'),
    ],
  },
  {
    order: 21,
    options: [
      opt('Parlanchín'),
      opt('Controlado'),
      opt('Convencional'),
      opt('Decisivo'),
    ],
  },
  {
    order: 22,
    options: [
      opt('Cohibido'),
      opt('Exacto'),
      opt('Franco'),
      opt('Buen compañero'),
    ],
  },
  {
    order: 23,
    options: [
      opt('Diplomático'),
      opt('Audaz'),
      opt('Refinado'),
      opt('Satisfecho'),
    ],
  },
  {
    order: 24,
    options: [
      opt('Inquieto'),
      opt('Popular'),
      opt('Buen vecino'),
      opt('Devoto'),
    ],
  },
];

if (cleaverBlocks.length !== CLEAVER_TETRAD_COUNT) {
  throw new Error(
    `cleaverData: se esperaban ${CLEAVER_TETRAD_COUNT} tétradas, hay ${cleaverBlocks.length}`,
  );
}

for (const block of cleaverBlocks) {
  if (!block.options || block.options.length !== 4) {
    throw new Error(`cleaverData: tétrada ${block.order} debe tener exactamente 4 opciones`);
  }
  for (const o of block.options) {
    if (!o.metadata?.dimension) {
      throw new Error(`cleaverData: falta dimension en tétrada ${block.order} — ${o.text}`);
    }
  }
}

/**
 * Banco Terman-Merrill (demo / estructura base).
 * 10 series con tiempo límite estricto por bloque.
 */

export const TERMAN_CATALOG_VERSION = 1;

export const TERMAN_SERIES = [
  {
    seriesId: 'serie_1',
    name: 'Información',
    timeLimitSeconds: 120,
    instruction:
      'Responde con la opción correcta. Tienes tiempo limitado; al terminar el cronómetro avanzarás automáticamente.',
    questions: [
      {
        id: 't_1_1',
        text: 'El iniciador de nuestra guerra de independencia fue:',
        options: ['Morelos', 'Zaragoza', 'Iturbide', 'Hidalgo'],
        correct: 3,
      },
      {
        id: 't_1_2',
        text: 'La capital de Francia es:',
        options: ['Lyon', 'París', 'Marsella', 'Burdeos'],
        correct: 1,
      },
    ],
  },
  {
    seriesId: 'serie_2',
    name: 'Comprensión',
    timeLimitSeconds: 180,
    instruction: 'Lee cada enunciado y elige la respuesta que mejor complete la idea.',
    questions: [
      {
        id: 't_2_1',
        text: 'El médico cura al enfermo, así como el maestro…',
        options: ['alumno', 'enseña al', 'libro', 'escuela'],
        correct: 1,
      },
      {
        id: 't_2_2',
        text: 'La llave abre la puerta, así como el código…',
        options: ['cierra', 'desbloquea el', 'rompe', 'papel'],
        correct: 1,
      },
    ],
  },
  {
    seriesId: 'serie_3',
    name: 'Vocabulario',
    timeLimitSeconds: 120,
    instruction: 'Selecciona la palabra más cercana en significado a la palabra dada.',
    questions: [
      {
        id: 't_3_1',
        text: 'Abundancia es lo contrario de:',
        options: ['riqueza', 'escasez', 'exceso', 'plenty'],
        correct: 1,
      },
      {
        id: 't_3_2',
        text: 'Prudente es lo contrario de:',
        options: ['cauteloso', 'temerario', 'sabio', 'calmado'],
        correct: 1,
      },
    ],
  },
  {
    seriesId: 'serie_4',
    name: 'Síntesis',
    timeLimitSeconds: 180,
    instruction: 'Identifica la relación entre conceptos y completa la analogía.',
    questions: [
      {
        id: 't_4_1',
        text: 'Día es a noche como verano es a:',
        options: ['calor', 'invierno', 'sol', 'estación'],
        correct: 1,
      },
      {
        id: 't_4_2',
        text: 'Libro es a leer como música es a:',
        options: ['escuchar', 'bailar', 'cantar', 'sonido'],
        correct: 0,
      },
    ],
  },
  {
    seriesId: 'serie_5',
    name: 'Concentración',
    timeLimitSeconds: 120,
    instruction: 'Presta atención a los detalles y responde con precisión.',
    questions: [
      {
        id: 't_5_1',
        text: '¿Cuántas veces aparece la letra "a" en la palabra "analítica"?',
        options: ['2', '3', '4', '5'],
        correct: 2,
      },
      {
        id: 't_5_2',
        text: 'Si 3, 6, 9 es una secuencia, el siguiente número es:',
        options: ['10', '11', '12', '15'],
        correct: 2,
      },
    ],
  },
  {
    seriesId: 'serie_6',
    name: 'Análisis',
    timeLimitSeconds: 180,
    instruction: 'Razona la relación entre las partes y elige la respuesta lógica.',
    questions: [
      {
        id: 't_6_1',
        text: 'Todos los cuadrados son rectángulos. Algunos rectángulos son rojos. Por tanto:',
        options: [
          'Todos los cuadrados son rojos',
          'Algunos cuadrados pueden ser rojos',
          'Ningún cuadrado es rojo',
          'Los rectángulos no son cuadrados',
        ],
        correct: 1,
      },
      {
        id: 't_6_2',
        text: 'Si A es mayor que B y B es mayor que C, entonces:',
        options: ['C es mayor que A', 'A es mayor que C', 'B es menor que C', 'No hay orden'],
        correct: 1,
      },
    ],
  },
  {
    seriesId: 'serie_7',
    name: 'Abstracción',
    timeLimitSeconds: 120,
    instruction: 'Generaliza el patrón o la regla implícita en cada ítem.',
    questions: [
      {
        id: 't_7_1',
        text: '2, 4, 8, 16, … el siguiente valor es:',
        options: ['20', '24', '32', '18'],
        correct: 2,
      },
      {
        id: 't_7_2',
        text: 'Círculo, triángulo, cuadrado… la figura con lados curvos es:',
        options: ['triángulo', 'cuadrado', 'círculo', 'rectángulo'],
        correct: 2,
      },
    ],
  },
  {
    seriesId: 'serie_8',
    name: 'Planeación',
    timeLimitSeconds: 180,
    instruction: 'Elige la secuencia o acción que mejor resuelve el problema planteado.',
    questions: [
      {
        id: 't_8_1',
        text: 'Para llegar puntual a una cita, lo primero es:',
        options: ['salir tarde', 'calcular el tiempo de traslado', 'cancelar', 'dormir más'],
        correct: 1,
      },
      {
        id: 't_8_2',
        text: 'Orden lógico: planear → ___ → ejecutar → revisar',
        options: ['improvisar', 'preparar recursos', 'abandonar', 'olvidar'],
        correct: 1,
      },
    ],
  },
  {
    seriesId: 'serie_9',
    name: 'Organización',
    timeLimitSeconds: 120,
    instruction: 'Ordena mentalmente la información y selecciona la respuesta coherente.',
    questions: [
      {
        id: 't_9_1',
        text: 'Orden cronológico correcto (de menor a mayor duración):',
        options: ['hora, día, semana', 'día, hora, semana', 'semana, día, hora', 'hora, semana, día'],
        correct: 0,
      },
      {
        id: 't_9_2',
        text: 'Categoría que agrupa: manzana, pera, uva:',
        options: ['verduras', 'frutas', 'granos', 'lácteos'],
        correct: 1,
      },
    ],
  },
  {
    seriesId: 'serie_10',
    name: 'Aritmética',
    timeLimitSeconds: 480,
    instruction: 'Resuelve operaciones numéricas con rapidez y exactitud.',
    questions: [
      {
        id: 't_10_1',
        text: '12 × 8 =',
        options: ['86', '94', '96', '104'],
        correct: 2,
      },
      {
        id: 't_10_2',
        text: '144 ÷ 12 =',
        options: ['10', '11', '12', '14'],
        correct: 2,
      },
    ],
  },
];

export function termanQuestionCount() {
  return TERMAN_SERIES.reduce((n, s) => n + s.questions.length, 0);
}

export function termanTotalTimeSeconds() {
  return TERMAN_SERIES.reduce((n, s) => n + s.timeLimitSeconds, 0);
}

/** Aplana preguntas con metadatos de serie para seed en BD. */
export function termanQuestionsFlat() {
  const rows = [];
  let sortOrder = 0;
  for (let si = 0; si < TERMAN_SERIES.length; si++) {
    const series = TERMAN_SERIES[si];
    for (let qi = 0; qi < series.questions.length; qi++) {
      const q = series.questions[qi];
      rows.push({
        sortOrder: sortOrder++,
        termanItemId: q.id,
        text: q.text,
        correctIndex: q.correct,
        options: q.options,
        seriesId: series.seriesId,
        seriesName: series.name,
        seriesIndex: si,
        seriesTimeLimitSeconds: series.timeLimitSeconds,
        seriesInstruction: series.instruction,
        questionIndexInSeries: qi,
      });
    }
  }
  return rows;
}

/**
 * Banco oficial — Evaluación Cognitiva Analítica Mind24 (clave interna: terman).
 * 10 series · 50 reactivos · tiempos estrictos por bloque.
 */

export const TERMAN_CATALOG_VERSION = 2;

export const TERMAN_MAX_RAW_SCORE = 50;

export const TERMAN_SERIES = [
  {
    seriesId: 'serie_1',
    name: 'Información General',
    instructions:
      'Seleccione la opción que complete correctamente la afirmación. Trabaje con rapidez y precisión.',
    timeLimitSeconds: 120,
    questions: [
      {
        id: 'cog_1_1',
        text: 'El oxígeno, a temperatura ambiente, es un:',
        options: ['Líquido', 'Metal', 'Gas', 'Mineral'],
        correct: 2,
      },
      {
        id: 'cog_1_2',
        text: 'Un barómetro es un instrumento que sirve para medir la:',
        options: ['Humedad', 'Presión atmosférica', 'Velocidad del viento', 'Temperatura'],
        correct: 1,
      },
      {
        id: 'cog_1_3',
        text: 'El proceso biológico por el cual las plantas producen su propio alimento se denomina:',
        options: ['Respiración', 'Fotosíntesis', 'Polinización', 'Germinación'],
        correct: 1,
      },
      {
        id: 'cog_1_4',
        text: 'La capital de Australia es:',
        options: ['Sídney', 'Melbourne', 'Canberra', 'Brisbane'],
        correct: 2,
      },
      {
        id: 'cog_1_5',
        text: "El autor de la novela 'Cien años de soledad' es:",
        options: ['Jorge Luis Borges', 'Mario Vargas Llosa', 'Gabriel García Márquez', 'Julio Cortázar'],
        correct: 2,
      },
    ],
  },
  {
    seriesId: 'serie_2',
    name: 'Juicio y Sentido Común',
    instructions:
      'Evalúe cada escenario corporativo y seleccione la acción o justificación MÁS lógica y prioritaria.',
    timeLimitSeconds: 120,
    questions: [
      {
        id: 'cog_2_1',
        text: 'Si descubre un conato de incendio en su área de trabajo, la acción inmediata más prioritaria es:',
        options: [
          'Asegurar los documentos confidenciales del área',
          'Notificar de inmediato a los servicios de emergencia o brigadas',
          'Intentar extinguir el fuego para minimizar daños a la empresa',
          'Evacuar al personal sin dar aviso para evitar pánico',
        ],
        correct: 1,
      },
      {
        id: 'cog_2_2',
        text: 'Una empresa realiza respaldos de información diarios, aunque nunca haya perdido datos. La razón MÁS importante es:',
        options: [
          'Cumplir con un requisito de espacio del departamento de TI',
          'Garantizar la continuidad operativa y prevenir pérdidas críticas',
          'Optimizar la velocidad de los servidores locales',
          'Generar reportes diarios de actividad para la gerencia',
        ],
        correct: 1,
      },
      {
        id: 'cog_2_3',
        text: 'El objetivo fundamental de establecer políticas internas dentro de una organización es:',
        options: [
          'Estandarizar procesos para garantizar orden y predictibilidad',
          'Proporcionar a Recursos Humanos herramientas para sancionar',
          'Reducir la creatividad de los colaboradores operativos',
          'Acelerar la ejecución de tareas diarias sin supervisión',
        ],
        correct: 0,
      },
      {
        id: 'cog_2_4',
        text: 'Si un colaborador no comprende claramente una instrucción directa y urgente de su supervisor, la acción más profesional es:',
        options: [
          'Delegar la tarea a un compañero con más experiencia',
          'Ejecutarla según su propio criterio para demostrar proactividad',
          'Solicitar una aclaración inmediata antes de iniciar la ejecución',
          'Posponer la tarea hasta que el supervisor ofrezca más detalles',
        ],
        correct: 2,
      },
      {
        id: 'cog_2_5',
        text: 'La razón principal por la que las instituciones financieras solicitan comprobantes de ingresos al otorgar créditos es:',
        options: [
          'Cumplir con protocolos de marketing interno',
          'Evaluar la capacidad de pago y mitigar el riesgo de morosidad',
          'Clasificar el estrato social de sus clientes activos',
          'Aumentar los requisitos burocráticos para filtrar solicitudes',
        ],
        correct: 1,
      },
    ],
  },
  {
    seriesId: 'serie_3',
    name: 'Vocabulario',
    instructions:
      'Seleccione la palabra que comparta la mayor SIMILITUD (sinónimo) o indique la mayor OPOSICIÓN (antónimo) según se indique.',
    timeLimitSeconds: 120,
    questions: [
      {
        id: 'cog_3_1',
        text: "Seleccione el sinónimo más adecuado para la palabra 'Minucioso':",
        options: ['Exhaustivo', 'Superficial', 'Dinámico', 'Extenso'],
        correct: 0,
      },
      {
        id: 'cog_3_2',
        text: "Identifique el antónimo directo de la palabra 'Frecuente':",
        options: ['Intermitente', 'Inusual', 'Habitual', 'Continuo'],
        correct: 1,
      },
      {
        id: 'cog_3_3',
        text: "Seleccione el sinónimo más adecuado para la palabra 'Sistemático':",
        options: ['Caótico', 'Metódico', 'Creativo', 'Impredecible'],
        correct: 1,
      },
      {
        id: 'cog_3_4',
        text: "Identifique el antónimo directo de la palabra 'Contraer':",
        options: ['Reducir', 'Expandir', 'Flexionar', 'Ajustar'],
        correct: 1,
      },
      {
        id: 'cog_3_5',
        text: "Seleccione el sinónimo más adecuado para la palabra 'Efímero':",
        options: ['Perpetuo', 'Transitorio', 'Pesado', 'Arraigado'],
        correct: 1,
      },
    ],
  },
  {
    seriesId: 'serie_4',
    name: 'Lógica y Síntesis',
    instructions:
      'Lea las premisas y determine si la conclusión final es Verdadera, Falsa, o si la información es Insuficiente para afirmarlo.',
    timeLimitSeconds: 180,
    questions: [
      {
        id: 'cog_4_1',
        text: 'Todos los gerentes de área tienen título universitario. Patricia tiene título universitario. Por lo tanto, Patricia es gerente de área.',
        options: ['Verdadero', 'Falso', 'Insuficiente'],
        correct: 2,
      },
      {
        id: 'cog_4_2',
        text: 'El proveedor A entrega más rápido que el proveedor B. El proveedor C entrega más lento que el proveedor B. Por lo tanto, el proveedor A es el más rápido de los tres.',
        options: ['Verdadero', 'Falso', 'Insuficiente'],
        correct: 0,
      },
      {
        id: 'cog_4_3',
        text: 'Ningún sistema seguro tiene contraseñas por defecto. El sistema Alpha tiene contraseñas por defecto. Por lo tanto, el sistema Alpha no es seguro.',
        options: ['Verdadero', 'Falso', 'Insuficiente'],
        correct: 0,
      },
      {
        id: 'cog_4_4',
        text: 'Si las ventas de la empresa bajan, se recorta el presupuesto de marketing. El presupuesto de marketing fue recortado. Por lo tanto, las ventas bajaron.',
        options: ['Verdadero', 'Falso', 'Insuficiente'],
        correct: 2,
      },
      {
        id: 'cog_4_5',
        text: 'Todos los proyectos aprobados pasaron por auditoría. El Proyecto X no pasó por auditoría. Por lo tanto, el Proyecto X no está aprobado.',
        options: ['Verdadero', 'Falso', 'Insuficiente'],
        correct: 0,
      },
    ],
  },
  {
    seriesId: 'serie_5',
    name: 'Aritmética y Razonamiento Numérico',
    instructions:
      'Resuelva los siguientes problemas matemáticos. Se evalúa su agilidad mental; no se permite el uso de calculadora.',
    timeLimitSeconds: 300,
    questions: [
      {
        id: 'cog_5_1',
        text: 'Un equipo de 4 personas termina un reporte en 6 horas. Si el equipo se reduce a 3 personas trabajando al mismo ritmo, ¿cuántas horas tardarán?',
        options: ['4 horas', '6 horas', '8 horas', '9 horas'],
        correct: 2,
      },
      {
        id: 'cog_5_2',
        text: 'Un producto cuesta $100. Sube de precio un 20%. Al mes siguiente, el nuevo precio recibe un descuento del 20%. ¿Cuál es el precio final?',
        options: ['$100', '$96', '$104', '$120'],
        correct: 1,
      },
      {
        id: 'cog_5_3',
        text: 'Una máquina procesa 15 registros en 5 minutos. ¿Cuántos registros procesarán 3 máquinas iguales trabajando juntas durante 10 minutos?',
        options: ['45', '60', '90', '150'],
        correct: 2,
      },
      {
        id: 'cog_5_4',
        text: 'Si gastas un tercio de tu presupuesto mensual en licencias de software, y te sobran $10,000, ¿de cuánto era tu presupuesto inicial?',
        options: ['$12,000', '$15,000', '$20,000', '$30,000'],
        correct: 1,
      },
      {
        id: 'cog_5_5',
        text: 'Una empresa reparte un bono de $12,000 entre dos empleados en proporción 2:1. ¿Cuánto dinero recibe el empleado al que le tocó la mayor parte?',
        options: ['$6,000', '$8,000', '$9,000', '$10,000'],
        correct: 1,
      },
    ],
  },
  {
    seriesId: 'serie_6',
    name: 'Juicio Práctico y Resolución',
    instructions:
      'Seleccione la opción que represente la decisión ejecutiva o corporativa MÁS lógica y prudente para cada escenario.',
    timeLimitSeconds: 120,
    questions: [
      {
        id: 'cog_6_1',
        text: 'Una empresa tiene presupuesto limitado y debe elegir entre renovar computadoras lentas o comprar sillas ergonómicas. El criterio más lógico para decidir es:',
        options: [
          'Lo que sea más económico a corto plazo',
          'El resultado de una votación informal entre el equipo',
          'El impacto directo que cada opción tenga en la productividad general',
          'Lo que beneficie directamente a los altos directivos',
        ],
        correct: 2,
      },
      {
        id: 'cog_6_2',
        text: 'Al recibir una queja de un cliente muy molesto en las redes sociales de la empresa, la respuesta más profesional debe ser:',
        options: [
          'Eliminar el comentario para proteger la imagen de la marca',
          'Demostrarle públicamente con datos que él está equivocado',
          'Ofrecer una disculpa empática y llevar la conversación a un canal privado',
          'Ignorar el comentario hasta que el cliente se tranquilice por sí solo',
        ],
        correct: 2,
      },
      {
        id: 'cog_6_3',
        text: 'Si un proyecto crítico se retrasa porque un proveedor clave no entregó a tiempo, la acción prioritaria del líder de proyecto es:',
        options: [
          'Notificar al cliente culpando exclusivamente al proveedor',
          'Buscar alternativas inmediatas para mitigar el impacto antes de penalizar al proveedor',
          'Detener todas las operaciones del equipo hasta que el proveedor entregue',
          'Exigir al equipo interno que cubra el trabajo del proveedor sin importar su rol',
        ],
        correct: 1,
      },
      {
        id: 'cog_6_4',
        text: 'Al planificar el lanzamiento de un software, el equipo de marketing descubre que la competencia lanzará un producto idéntico la misma semana. La estrategia más prudente es:',
        options: [
          'Cancelar el lanzamiento permanentemente',
          'Analizar rápidamente nuestro diferenciador para ajustar el mensaje de venta',
          'Reducir el precio un 50% inmediatamente para ganar el mercado',
          'Lanzar el producto sin cambios y esperar la reacción de los usuarios',
        ],
        correct: 1,
      },
      {
        id: 'cog_6_5',
        text: 'Si las ventas mensuales de un producto caen drásticamente sin previo aviso, el primer paso lógico de la gerencia debe ser:',
        options: [
          'Despedir a los ejecutivos de cuenta con peores números',
          'Ofrecer descuentos masivos a toda la base de prospectos',
          'Diagnosticar la causa raíz analizando métricas de mercado y feedback',
          'Duplicar el presupuesto de publicidad en redes sociales de inmediato',
        ],
        correct: 2,
      },
    ],
  },
  {
    seriesId: 'serie_7',
    name: 'Analogías',
    instructions:
      'Determine la relación entre las dos primeras palabras y elija la opción que establezca la misma relación con la tercera palabra.',
    timeLimitSeconds: 120,
    questions: [
      {
        id: 'cog_7_1',
        text: 'Director es a Empresa como Capitán es a...',
        options: ['Océano', 'Barco', 'Tripulación', 'Navegación'],
        correct: 1,
      },
      {
        id: 'cog_7_2',
        text: 'Vender es a Ingreso como Comprar es a...',
        options: ['Producto', 'Gasto', 'Cliente', 'Ahorro'],
        correct: 1,
      },
      {
        id: 'cog_7_3',
        text: 'Capacitación es a Habilidad como Mantenimiento es a...',
        options: ['Falla', 'Taller', 'Durabilidad', 'Herramienta'],
        correct: 2,
      },
      {
        id: 'cog_7_4',
        text: 'Cimiento es a Edificio como Planificación es a...',
        options: ['Proyecto', 'Presupuesto', 'Fracaso', 'Oficina'],
        correct: 0,
      },
      {
        id: 'cog_7_5',
        text: 'Candado es a Seguridad como Respaldo (Backup) es a...',
        options: ['Computadora', 'Continuidad', 'Internet', 'Velocidad'],
        correct: 1,
      },
    ],
  },
  {
    seriesId: 'serie_8',
    name: 'Ordenamiento Lógico',
    instructions:
      'Ordene mentalmente las siguientes palabras para formar una oración con sentido. Luego, determine si la afirmación resultante es Verdadera o Falsa.',
    timeLimitSeconds: 180,
    questions: [
      {
        id: 'cog_8_1',
        text: 'rentables siempre empresas las son',
        options: ['Verdadero', 'Falso'],
        correct: 1,
      },
      {
        id: 'cog_8_2',
        text: 'errores la previene cuidadosa planificación',
        options: ['Verdadero', 'Falso'],
        correct: 0,
      },
      {
        id: 'cog_8_3',
        text: 'urgentes importantes tareas todas son las',
        options: ['Verdadero', 'Falso'],
        correct: 1,
      },
      {
        id: 'cog_8_4',
        text: 'líderes los delegar buenos saben',
        options: ['Verdadero', 'Falso'],
        correct: 0,
      },
      {
        id: 'cog_8_5',
        text: 'garantiza el siempre éxito esfuerzo el',
        options: ['Verdadero', 'Falso'],
        correct: 1,
      },
    ],
  },
  {
    seriesId: 'serie_9',
    name: 'Clasificación',
    instructions:
      'Identifique y seleccione la palabra que NO pertenece al mismo grupo o categoría que las demás.',
    timeLimitSeconds: 120,
    questions: [
      {
        id: 'cog_9_1',
        text: '¿Qué concepto no pertenece al grupo?',
        options: ['Contabilidad', 'Finanzas', 'Mantenimiento', 'Tesorería'],
        correct: 2,
      },
      {
        id: 'cog_9_2',
        text: '¿Qué término no pertenece al grupo?',
        options: ['Reclutamiento', 'Selección', 'Entrevista', 'Producción'],
        correct: 3,
      },
      {
        id: 'cog_9_3',
        text: '¿Qué elemento no pertenece al grupo?',
        options: ['Impresora', 'Monitor', 'Teclado', 'Software'],
        correct: 3,
      },
      {
        id: 'cog_9_4',
        text: '¿Qué acción no pertenece al grupo?',
        options: ['Planificar', 'Ejecutar', 'Ignorar', 'Evaluar'],
        correct: 2,
      },
      {
        id: 'cog_9_5',
        text: '¿Qué palabra no pertenece al grupo?',
        options: ['Euro', 'Dólar', 'Yen', 'Cheque'],
        correct: 3,
      },
    ],
  },
  {
    seriesId: 'serie_10',
    name: 'Seriación Numérica',
    instructions:
      'Analice la secuencia numérica y seleccione el número que continúa lógicamente la serie.',
    timeLimitSeconds: 240,
    questions: [
      {
        id: 'cog_10_1',
        text: '2, 4, 8, 16, ___',
        options: ['24', '32', '64', '20'],
        correct: 1,
      },
      {
        id: 'cog_10_2',
        text: '1, 3, 6, 10, ___',
        options: ['12', '14', '15', '16'],
        correct: 2,
      },
      {
        id: 'cog_10_3',
        text: '50, 48, 44, 38, 30, ___',
        options: ['20', '22', '24', '28'],
        correct: 0,
      },
      {
        id: 'cog_10_4',
        text: '2, 5, 11, 23, ___',
        options: ['46', '47', '48', '50'],
        correct: 1,
      },
      {
        id: 'cog_10_5',
        text: '3, 4, 7, 11, 18, ___',
        options: ['25', '27', '29', '31'],
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
    const instructionText = series.instructions || series.instruction || '';
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
        seriesInstruction: instructionText,
        questionIndexInSeries: qi,
      });
    }
  }
  return rows;
}

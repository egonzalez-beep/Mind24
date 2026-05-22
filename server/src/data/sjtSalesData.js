/**
 * Banco oficial — Simulador de Escenarios Comerciales (SJT) · clave: sales_sjt.
 * 10 escenarios · puntuación ponderada 0–5 por ítem (máx. 50 pts).
 */

export const SJT_SALES_CATALOG_VERSION = 1;

export const SJT_SALES_MAX_POINTS = 50;

export const SJT_SALES_SCENARIO_COUNT = 10;

/** Tiempo sugerido para completar los 10 escenarios (segundos). */
export const SJT_SALES_TIME_LIMIT_SECONDS = 30 * 60;

export const SJT_SALES_SCENARIOS = [
  {
    scenarioId: 'sjt_sales_1',
    competence: 'Manejo de Objeciones (Precio)',
    text: "El prospecto te dice: 'Me encanta la plataforma, pero la competencia me ofrece algo casi igual por un 30% menos. ¿Pueden igualar el precio?' ¿Cuál es tu respuesta INMEDIATA?",
    options: [
      {
        text: "Aislar la objeción: 'Aparte del precio, ¿hay alguna otra duda? Revisemos cuánto te costaría a largo plazo no tener nuestra función exclusiva.'",
        points: 5,
      },
      {
        text: 'Decirle que es imposible bajar el precio y que si no tienen presupuesto, no son nuestro cliente ideal.',
        points: 3,
      },
      {
        text: 'Pedirle unos minutos para hablar con tu gerente y ver si le pueden autorizar un 20% o 25% de descuento.',
        points: 1,
      },
      {
        text: 'Hablar mal de la competencia, resaltando que su tecnología es obsoleta y se va a arrepentir.',
        points: 0,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_2',
    competence: 'Estrategia de Seguimiento (Ghosting)',
    text: 'Tuviste una reunión excelente. Enviaste la propuesta... y el prospecto desapareció. Ha pasado una semana y no responde llamadas ni correos. ¿Qué haces?',
    options: [
      {
        text: "Enviar un 'Break-up email': 'Asumo que esto ya no es prioridad. Cierro tu expediente por ahora. Búscame cuando estés listo.'",
        points: 5,
      },
      { text: 'Pausar el contacto y esperar un mes completo para no parecer desesperado ni molestarlo.', points: 1 },
      {
        text: 'Llamar directamente a su jefe o buscarlo en sus redes sociales personales para pedirle una respuesta.',
        points: 0,
      },
      {
        text: "Enviar un mensaje diciendo: '¿Tuviste oportunidad de revisarlo? Si firmas hoy te doy un mes gratis'.",
        points: 3,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_3',
    competence: 'Control del Ciclo de Venta',
    text: "El cliente te dice: 'Todo se ve perfecto, mándame la información al correo y yo lo reviso la próxima semana con mi equipo para avisarte.' ¿Cómo respondes?",
    options: [
      { text: "'¡Claro que sí! Te mando la info y quedo a la espera de tus comentarios.'", points: 1 },
      {
        text: "'Te la envío enseguida. Para no perseguirnos, ¿agendamos de una vez una llamada de 10 minutos el próximo jueves para resolver dudas?'",
        points: 5,
      },
      { text: "'Si quieres te hago un descuento extra ahorita mismo si me firmas antes de colgar.'", points: 0 },
      {
        text: "'Sinceramente, los clientes que dicen que lo van a revisar, nunca lo revisan. ¿Cuál es la verdadera duda hoy?'",
        points: 3,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_4',
    competence: 'Ética y Urgencia (Zona Gris)',
    text: 'Es el último día del mes y te falta una venta para cobrar tu bono. Un prospecto dice: \'Firmo hoy mismo si me prometes que el software hace [X función]\'. Sabes que esa función tardará 6 meses en salir. ¿Qué haces?',
    options: [
      {
        text: 'Le prometes que sí lo hace. Cobras tu bono y dejas que el soporte maneje la queja cuando se dé cuenta.',
        points: 0,
      },
      {
        text: 'Le dices que no lo hace y le sugieres que mejor no compre la plataforma para evitarle problemas.',
        points: 1,
      },
      {
        text: 'Le dices la verdad y le ofreces un descuento temporal por los primeros 6 meses hasta que la función esté lista.',
        points: 5,
      },
      {
        text: "Le dices que la función 'está en fase beta oculta', evadiendo la respuesta directa para que firme rápido.",
        points: 0,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_5',
    competence: 'Manejo de Gatekeepers',
    text: "Haces una llamada en frío. La recepcionista dice: 'El Director está muy ocupado, envíe su portafolio a info@empresa.com y si le interesa, le llamamos.' ¿Qué haces?",
    options: [
      {
        text: "Tratarla con respeto, explicarle el valor y preguntar: '¿Cuál sería el mejor momento o vía para que él vea esto sin quitarle tiempo?'",
        points: 5,
      },
      {
        text: 'Enviar el correo a info@empresa.com y poner un recordatorio para llamar el mes que viene.',
        points: 1,
      },
      {
        text: "Exigir con tono de autoridad que te comuniquen porque es una llamada 'agendada previamente' (mintiendo).",
        points: 0,
      },
      { text: "Decirle: 'Es un tema urgente de facturación para él, pásamelo por favor'.", points: 3 },
    ],
  },
  {
    scenarioId: 'sjt_sales_6',
    competence: 'Resolución de Conflictos',
    text: 'Un cliente VIP llama furioso porque su implementación lleva una semana de retraso y amenaza con cancelar el contrato. ¿Cuál es tu primera acción?',
    options: [
      {
        text: 'Escucharlo sin interrumpir, validar su frustración, disculparte y presentarle un plan de acción inmediato con fechas exactas.',
        points: 5,
      },
      {
        text: 'Explicarle rápidamente que el retraso fue culpa del departamento de logística/sistemas para proteger tu relación con él.',
        points: 0,
      },
      {
        text: 'Ofrecerle un mes de servicio gratuito inmediatamente para calmarlo antes de revisar qué pasó.',
        points: 3,
      },
      {
        text: 'Decirle que vas a escalar su caso con tu gerente de inmediato y pedirle que espere la llamada de un superior.',
        points: 1,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_7',
    competence: 'Manejo de Expectativas (Scope Creep)',
    text: "El cliente exige que se incluya una función adicional sin costo, argumentando que 'se lo prometieron verbalmente'. El contrato no lo incluye. ¿Cómo lo manejas?",
    options: [
      {
        text: "Decirle firmemente: 'Lo siento, pero si no está en el contrato firmado, no podemos entregarlo. Son políticas de la empresa'.",
        points: 1,
      },
      {
        text: 'Comprender su confusión, revisar el contrato con él y ofrecerle un esquema de pago preferencial por esa función extra.',
        points: 5,
      },
      {
        text: 'Hablar con operaciones para que le den la función gratis y evitar que el cliente deje una mala reseña pública.',
        points: 0,
      },
      {
        text: 'Decirle que lo vas a revisar, esperando que al pasar las semanas el cliente se olvide de esa petición.',
        points: 3,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_8',
    competence: 'Comunicación de Malas Noticias',
    text: 'La empresa aumentará precios un 15% el próximo mes. Debes comunicárselo a un cliente muy sensible al precio. ¿Cuál es la mejor estrategia?',
    options: [
      {
        text: 'Llamarlo proactivamente, agradecer su lealtad, explicarle el valor del ajuste y darle un mes de gracia antes del cambio.',
        points: 5,
      },
      {
        text: 'Enviar un correo masivo estándar desde la cuenta genérica notificando el ajuste legalmente.',
        points: 1,
      },
      {
        text: 'Esperar a que le llegue la nueva factura y, si se queja, ofrecerle absorber el 5% del aumento para que no cancele.',
        points: 3,
      },
      {
        text: 'Decirle en secreto que la economía está mal y te obligaron a subir el precio, pero que tú estás de su lado.',
        points: 0,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_9',
    competence: 'Manejo del Tiempo y Priorización',
    text: 'Viernes 4:00 PM. Tienes 3 tareas urgentes: 1) Prospecto pide cotización, 2) Cliente reporta falla operativa crítica, 3) Gerente pide tu reporte. ¿En qué orden atiendes?',
    options: [
      {
        text: 'Primero el prospecto (ventas son prioridad), luego la falla del cliente, y al final el reporte del gerente.',
        points: 3,
      },
      {
        text: 'Primero el reporte del gerente, luego la falla del cliente, y dejas la cotización del prospecto para el lunes.',
        points: 1,
      },
      {
        text: 'Primero la falla del cliente (retención), luego la cotización (crecimiento), y negociar la entrega del reporte al final del día.',
        points: 5,
      },
      {
        text: 'Hacer las tres cosas al mismo tiempo a medias para que nadie se queje de falta de respuesta.',
        points: 0,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_10',
    competence: 'Comunicación en Crisis Masiva',
    text: 'La plataforma sufre una caída masiva. Clientes exigen respuestas por WhatsApp y redes sociales. ¿Cómo procedes?',
    options: [
      {
        text: 'Ignorar los mensajes temporalmente hasta que el equipo técnico resuelva el problema para dar una respuesta definitiva.',
        points: 1,
      },
      {
        text: 'Responder solo a las cuentas más grandes (Key Accounts) porque son las que dejan más dinero a la empresa.',
        points: 3,
      },
      {
        text: 'Enviar un mensaje de difusión empático confirmando que el equipo ya trabaja en ello, y comprometerse a dar una actualización en 60 minutos.',
        points: 5,
      },
      {
        text: 'Decir a los clientes que fue un ataque cibernético externo (aunque sea falso) para quitarle la culpa a la empresa.',
        points: 0,
      },
    ],
  },
];

export function sjtSalesQuestionCount() {
  return SJT_SALES_SCENARIOS.length;
}

export function sjtSalesTotalTimeSeconds() {
  return SJT_SALES_TIME_LIMIT_SECONDS;
}

/** Filas para seed en BD (metadata con competencia; puntos en opción). */
export function sjtSalesQuestionsFlat() {
  return SJT_SALES_SCENARIOS.map((scenario, index) => {
    const maxPoints = Math.max(...scenario.options.map((o) => o.points), 0);
    return {
      sortOrder: index,
      scenarioId: scenario.scenarioId,
      text: scenario.text,
      competence: scenario.competence,
      scenarioIndex: index,
      maxPoints,
      options: scenario.options.map((opt, j) => ({
        label: opt.text,
        points: opt.points,
        sortOrder: j,
      })),
    };
  });
}

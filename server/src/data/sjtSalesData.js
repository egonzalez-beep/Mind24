/**
 * Banco oficial — Simulador de Escenarios Comerciales (SJT) · clave: sales_sjt.
 * 15 escenarios · puntuación ponderada 0–5 por ítem (máx. 75 pts).
 */

export const SJT_SALES_CATALOG_VERSION = 2;

export const SJT_SALES_MAX_POINTS = 75;

export const SJT_SALES_SCENARIO_COUNT = 15;

/** Tiempo sugerido para completar los 15 escenarios (segundos). */
export const SJT_SALES_TIME_LIMIT_SECONDS = 45 * 60;

export const SJT_SALES_SCENARIOS = [
  {
    scenarioId: 'sjt_sales_1',
    competence: 'Manejo de Objeciones (Precio vs Valor)',
    text: "El prospecto te dice: 'Me encanta la plataforma, pero la competencia me ofrece algo casi igual por un 30% menos. ¿Pueden igualar el precio?' ¿Cuál es tu respuesta INMEDIATA?",
    options: [
      {
        text: "Aislar la objeción: 'Aparte del precio, ¿hay alguna otra duda? Revisemos cuánto te costaría a largo plazo no tener nuestra función exclusiva.'",
        points: 5,
      },
      {
        text: 'Indicar que por políticas internas los precios son fijos, y enviar el tarifario oficial para su revisión detallada.',
        points: 0,
      },
      {
        text: 'Solicitar unos minutos para hablar con tu gerente y revisar si excepcionalmente le pueden autorizar un descuento para igualar la oferta.',
        points: 1,
      },
      {
        text: 'Explicar que aunque existen opciones más económicas, la mayoría de clientes terminan valorando la estabilidad y acompañamiento postventa.',
        points: 3,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_2',
    competence: 'Estrategia de Seguimiento (Ghosting)',
    text: 'Tuviste una reunión excelente. Enviaste la propuesta... y el prospecto desapareció. Ha pasado una semana y no responde llamadas ni correos. ¿Qué haces?',
    options: [
      {
        text: "Enviar un 'Break-up email': 'Asumo que esto ya no es prioridad. Cierro tu expediente por ahora. Búscame cuando estés listo para avanzar.'",
        points: 5,
      },
      {
        text: 'Programar un recordatorio en el CRM para intentar contactarlo nuevamente el próximo trimestre cuando haya nuevo presupuesto.',
        points: 0,
      },
      {
        text: "Enviar un correo educado comentando: '¿Tuviste oportunidad de revisarlo? Quedo a tu entera disposición para cualquier duda.'",
        points: 1,
      },
      {
        text: 'Enviar un correo compartiendo un caso de éxito similar para reactivar la conversación con nuevo valor.',
        points: 3,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_3',
    competence: 'Control del Ciclo de Venta',
    text: "El cliente te dice: 'Todo se ve perfecto, mándame la información al correo y yo lo reviso la próxima semana con mi equipo para avisarte.' ¿Cómo respondes?",
    options: [
      {
        text: 'Agradecer su tiempo, enviar la información de inmediato y solicitar que te confirme de recibido.',
        points: 0,
      },
      {
        text: "'Te la envío enseguida. Para no perseguirnos, ¿agendamos de una vez una breve llamada de 10 minutos el próximo jueves para resolver dudas?'",
        points: 5,
      },
      {
        text: "'Se la envío con gusto. Estaré dándole seguimiento el lunes a primera hora para ver qué opinó su equipo.'",
        points: 1,
      },
      {
        text: "'Antes de enviarlo, ¿hay algún punto que todavía te genere duda para asegurarme de mandarte información alineada?'",
        points: 3,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_4',
    competence: 'Ética y Expectativas (Zona Gris)',
    text: "Un prospecto dice: 'Firmo hoy mismo si el software hace [X función]'. Sabes que esa función no existe y tardará 6 meses en salir. ¿Qué haces?",
    options: [
      {
        text: 'Indicar que esa función está mapeada en el plan anual de la empresa, sugiriendo que firme ahora para asegurar el precio actual.',
        points: 0,
      },
      {
        text: 'Le dices que actualmente no la tiene y le sugieres amablemente que reevalúe la compra para evitarle problemas operativos.',
        points: 1,
      },
      {
        text: 'Hablarle con transparencia sobre el tiempo de desarrollo y ofrecerle una solución temporal manual o un descuento por los primeros meses.',
        points: 5,
      },
      {
        text: "Mencionar que la función 'está en fase beta', enfocando la conversación en las herramientas que sí están disponibles para no perder el cierre.",
        points: 3,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_5',
    competence: 'Manejo de Gatekeepers (Recepción)',
    text: "Haces una llamada en frío. La recepcionista dice: 'El Director está muy ocupado, envíe su portafolio a info@empresa.com y nosotros le llamamos.' ¿Qué haces?",
    options: [
      {
        text: "Tratarla con respeto, explicarle brevemente el valor y preguntar: '¿Cuál sería el mejor momento o vía para que él vea esto sin quitarle tiempo?'",
        points: 5,
      },
      {
        text: 'Acatar la instrucción, enviar el correo corporativo y documentar la interacción en el sistema para mantener el orden.',
        points: 0,
      },
      {
        text: 'Agradecerle su atención, enviar la información y programar una tarea para dar seguimiento con ella la próxima semana.',
        points: 1,
      },
      {
        text: 'Comentarle brevemente el motivo corporativo de la llamada y pedir orientación sobre el mejor canal para presentarlo correctamente.',
        points: 3,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_6',
    competence: 'Resolución de Conflictos (Cliente VIP)',
    text: 'Un cliente VIP llama furioso porque su implementación lleva una semana de retraso y amenaza con cancelar el contrato. ¿Cuál es tu primera acción?',
    options: [
      {
        text: 'Escuchar activamente, validar su frustración, disculparte y presentarle un plan de acción inmediato con fechas exactas.',
        points: 5,
      },
      {
        text: 'Solicitarle un correo formal con su queja para poder escalarlo oficialmente con el departamento de operaciones.',
        points: 0,
      },
      {
        text: 'Ofrecerle un mes de servicio gratuito o una bonificación inmediata para calmar la tensión antes de revisar qué pasó internamente.',
        points: 1,
      },
      {
        text: 'Asegurarle que comprendes su molestia y que notificarás a tu gerente para que se ponga en contacto con él lo antes posible.',
        points: 3,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_7',
    competence: 'Manejo de Expectativas (Scope Creep)',
    text: "El cliente exige que se incluya una función adicional sin costo, argumentando que 'alguien de ventas se lo prometió'. El contrato no lo incluye. ¿Cómo lo manejas?",
    options: [
      {
        text: 'Explicarle que por auditoría interna no es posible habilitar funciones que no estén estipuladas en el contrato firmado.',
        points: 0,
      },
      {
        text: 'Comprender su confusión, revisar juntos el contrato y ofrecerle un esquema de pago preferencial para habilitar esa función.',
        points: 5,
      },
      {
        text: 'Escalar el caso con el área de operaciones solicitando que se le otorgue la función para evitar una mala reseña o la pérdida del cliente.',
        points: 1,
      },
      {
        text: 'Decirle que revisarás el caso con dirección, esperando ganar tiempo y que la urgencia del cliente por esa función disminuya.',
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
        text: 'Llamarlo proactivamente, agradecer su lealtad, explicarle cómo el ajuste garantiza el servicio y darle un mes de gracia antes del cambio.',
        points: 5,
      },
      {
        text: 'Asegurarte de que el departamento de cobranza le envíe la notificación oficial por correo con los fundamentos legales del ajuste.',
        points: 0,
      },
      {
        text: 'Contactarlo anticipadamente explicando el ajuste y revisar juntos alternativas para minimizar el impacto operativo.',
        points: 3,
      },
      {
        text: 'Llamarlo para notificarle el cambio, enfatizando que es una directriz corporativa global en la que tú no tienes injerencia.',
        points: 1,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_9',
    competence: 'Priorización Operativa',
    text: 'Viernes 4:00 PM. Tienes 3 urgencias: 1) Prospecto pide cotización, 2) Cliente reporta falla operativa crítica, 3) Gerente pide tu reporte semanal. ¿En qué orden atiendes?',
    options: [
      {
        text: 'Primero el prospecto (generación de ingresos), luego la falla del cliente, y al final el reporte del gerente.',
        points: 1,
      },
      {
        text: 'Primero el reporte del gerente (cumplimiento interno), luego la falla del cliente, y dejas la cotización del prospecto para el lunes.',
        points: 0,
      },
      {
        text: 'Primero la falla del cliente (retención), luego la cotización (crecimiento), y negocias la entrega del reporte para el final del día.',
        points: 5,
      },
      {
        text: 'Atiendes la falla del cliente y delegas la cotización a un compañero para poder terminar tu reporte a tiempo.',
        points: 3,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_10',
    competence: 'Comunicación en Crisis Masiva',
    text: 'La plataforma sufre una caída masiva. Clientes exigen respuestas por WhatsApp y redes sociales. ¿Cómo procedes?',
    options: [
      {
        text: 'Esperar a tener el diagnóstico técnico completo del área de IT antes de emitir cualquier comunicado, para no dar información errónea.',
        points: 0,
      },
      {
        text: 'Responder prioritariamente a las cuentas clave (Key Accounts) para asegurar los contratos más grandes, pidiéndoles paciencia.',
        points: 3,
      },
      {
        text: 'Enviar un mensaje de difusión confirmando que el equipo trabaja en ello y comprometerse a dar una actualización en 60 minutos.',
        points: 5,
      },
      {
        text: 'Redirigir educadamente a los clientes hacia los canales oficiales de soporte técnico para que los especialistas manejen la contingencia.',
        points: 1,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_11',
    competence: 'Prospección B2B (Cold Outreach)',
    text: 'Vas a enviar un correo en frío a un Director General (CEO) para ofrecer tu software. ¿Cuál es el enfoque principal de tu mensaje?',
    options: [
      {
        text: 'Un mensaje de 4 párrafos detallando la historia de tu empresa, todas las certificaciones que tienen y un PDF adjunto.',
        points: 0,
      },
      {
        text: 'Compartir brevemente cómo ayudaron a una empresa similar y preguntar si ese reto también existe hoy en su operación.',
        points: 3,
      },
      {
        text: 'Un mensaje corto (3-4 líneas) mencionando un problema específico de su industria y preguntando si es una prioridad resolverlo hoy.',
        points: 5,
      },
      {
        text: 'Un saludo cordial, una breve presentación tuya y una invitación abierta a tomar un café virtual cuando él tenga disponibilidad.',
        points: 1,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_12',
    competence: 'Manejo de Competencia en Demo',
    text: 'Durante una demostración, el cliente menciona que su proveedor actual hace exactamente lo mismo. ¿Cómo reaccionas?',
    options: [
      {
        text: 'Continuar con la demostración según el guion establecido, mostrando todas las características para que él mismo note la diferencia.',
        points: 0,
      },
      {
        text: "Preguntar con genuina curiosidad: 'Si hacen exactamente lo mismo, ¿qué te motivó a tomar esta reunión con nosotros hoy?'",
        points: 5,
      },
      {
        text: 'Destacar inmediatamente las tres debilidades más conocidas del proveedor actual para desposicionarlo frente al cliente.',
        points: 3,
      },
      {
        text: 'Estar de acuerdo con él para generar empatía y decirle que nuestra principal ventaja competitiva será el servicio al cliente.',
        points: 1,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_13',
    competence: 'Negociación con Compras (Procurement)',
    text: 'El usuario final ya aprobó tu producto, pero el departamento de Compras te exige un 15% de descuento adicional o bloquean el contrato. ¿Qué haces?',
    options: [
      {
        text: 'Aceptar el descuento para no entorpecer el proceso legal y asegurar que la venta se cierre este mismo mes.',
        points: 3,
      },
      {
        text: 'Solicitar al departamento legal de tu empresa que se ponga en contacto con ellos para revisar los términos del contrato.',
        points: 0,
      },
      {
        text: 'Avisarle al usuario final que su área de Compras está bloqueando el proyecto, esperando que él resuelva el problema internamente.',
        points: 1,
      },
      {
        text: "Intercambiar valor: 'Puedo revisar el descuento, pero a cambio necesitaríamos que el contrato se firme a 2 años en lugar de 1.'",
        points: 5,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_14',
    competence: 'Venta Consultiva (Diagnóstico)',
    text: "Un prospecto te pide directamente: 'Mándame una cotización para 50 licencias'. Tú no sabes para qué las va a usar. ¿Qué haces?",
    options: [
      {
        text: 'Generar la cotización estándar inmediatamente y enviarla con un correo de seguimiento para demostrar rapidez y eficiencia.',
        points: 0,
      },
      {
        text: 'Enviar una cotización preliminar y proponer una breve llamada posterior para validar requerimientos.',
        points: 3,
      },
      {
        text: "Agradecer el interés y solicitar una llamada de 5 minutos: 'Para enviarte la cotización exacta, necesito entender qué problema buscan resolver.'",
        points: 5,
      },
      {
        text: 'Enviar una presentación corporativa general junto con la lista de precios públicos para que él mismo arme su presupuesto.',
        points: 1,
      },
    ],
  },
  {
    scenarioId: 'sjt_sales_15',
    competence: 'Transición a Customer Success',
    text: 'Acabas de cerrar un contrato grande. El cliente está emocionado. ¿Cuál es el siguiente paso inmediato?',
    options: [
      {
        text: "Agendar una reunión de 'Kick-off' donde presentas formalmente al cliente con su Account Manager, asegurando una transición suave.",
        points: 5,
      },
      {
        text: 'Celebrar el cierre, enviar la factura y enfocarte de inmediato en buscar a tu próximo prospecto para llegar a la meta.',
        points: 3,
      },
      {
        text: 'Darle tu número personal de WhatsApp diciéndole que, sin importar lo que pase, tú siempre serás su contacto directo.',
        points: 1,
      },
      {
        text: 'Enviar un correo agradeciendo la confianza y copiar al equipo de soporte para que ellos se encarguen de los siguientes pasos operativos.',
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

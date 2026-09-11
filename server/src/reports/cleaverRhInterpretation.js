import { CLEAVER_DISC_KEYS } from '../data/cleaverDiscKey.js';
import { CLEAVER_DISC_META } from './cleaverProfileAnalysis.js';

/** @typedef {import('./cleaverProfileAnalysis.js').CleaverProfileAnalysis} CleaverProfileAnalysis */

function pairKey(a, b) {
  return `${a}|${b}`;
}

function dimLabel(k) {
  return CLEAVER_DISC_META[k].label;
}

function topKeysByScore(scores, n = 2) {
  return [...CLEAVER_DISC_KEYS]
    .map((k) => ({ k, v: Number(scores[k]) || 0 }))
    .sort((a, b) => b.v - a.v || CLEAVER_DISC_KEYS.indexOf(a.k) - CLEAVER_DISC_KEYS.indexOf(b.k))
    .slice(0, n)
    .map((e) => e.k);
}

function isLow(total, key) {
  const vals = CLEAVER_DISC_KEYS.map((k) => Number(total[k]) || 0);
  const min = Math.min(...vals);
  const v = Number(total[key]) || 0;
  return v <= min + 1;
}

function isHigh(total, key) {
  const vals = CLEAVER_DISC_KEYS.map((k) => Number(total[k]) || 0);
  const max = Math.max(...vals);
  const v = Number(total[key]) || 0;
  return v >= max - 1 && v > 0;
}

/** Narrativa RH por par ordenado (primaria|secundaria). */
const PAIR_RH = {
  'D|I': {
    strengths: [
      'Puede aportar iniciativa y energía para mover acuerdos hacia resultados concretos.',
      'Suele combinar decisión con capacidad de influir y movilizar a otros en el entorno laboral.',
    ],
    attention: [
      'En contextos que exigen detalle o revisión prolongada, puede tender a acelerar el cierre.',
      'Conviene observar si la velocidad de decisión deja fuera matices relevantes para el equipo.',
    ],
    communication:
      'Tiende a comunicarse de forma directa y movilizadora, con énfasis en convencer y avanzar la conversación hacia acuerdos.',
    decisions:
      'Puede preferir decidir con rapidez y orientación a metas; el ritmo suele ser alto cuando hay claridad de objetivo.',
    norms:
      'Cuando el cumplimiento neto es moderado o bajo, puede priorizar velocidad y acuerdo por encima de revisión exhaustiva.',
    teamwork:
      'En equipo puede dinamizar el grupo y buscar consenso activo, aunque conviene equilibrar el impulso con escucha.',
  },
  'D|C': {
    strengths: [
      'Puede integrar orientación a resultados con atención a criterios y estándares de calidad.',
      'Suele ser firme en plazos sin descuidar por completo el detalle relevante al objetivo.',
    ],
    attention: [
      'En determinados contextos puede exigir simultáneamente avance y perfección, generando tensión de expectativas.',
      'Conviene observar si la exigencia normativa ralentiza decisiones que el entorno requiere ágiles.',
    ],
    communication:
      'Tiende a ser claro y orientado a criterios; puede combinar mensajes directos con referencias a reglas o calidad esperada.',
    decisions:
      'Puede decidir con firmeza cuando hay datos o criterios suficientes; valora avanzar sin saltarse controles importantes.',
    norms:
      'Suele mostrar apego a procedimientos y calidad; puede cuestionar atajos que comprometan el estándar acordado.',
    teamwork:
      'En equipo puede empujar metas y también señalar desvíos; conviene acordar prioridades para evitar fricción por doble exigencia.',
  },
  'D|S': {
    strengths: [
      'Puede combinar impulso hacia objetivos con disposición cooperativa y continuidad relacional.',
      'Suele equilibrar avance y contención del ritmo según lo que el contexto laboral demande.',
    ],
    attention: [
      'Cuando aumenta la exigencia de resultados, puede oscilar entre firmeza y preferencia por acuerdos lentos.',
      'Conviene observar si delega demasiado o, al contrario, acelera sin alinear al equipo.',
    ],
    communication:
      'Puede alternar mensajes directos con un tono más conciliador; busca combinar claridad de objetivo y respeto al interlocutor.',
    decisions:
      'Tiende a decidir con determinación, modulada por preferencia por estabilidad; puede tardar más si percibe impacto en el equipo.',
    norms:
      'Suele respetar acuerdos y rutinas establecidas; puede flexibilizar normas menores si el avance lo justifica.',
    teamwork:
      'En equipo puede aportar empuje selectivo sobre una base cooperativa; valora continuidad y acuerdos previos.',
  },
  'I|D': {
    strengths: [
      'Puede destacar por conexión interpersonal respaldada por capacidad de concretar y cerrar.',
      'Suele movilizar recursos y personas con entusiasmo orientado a la acción.',
    ],
    attention: [
      'En contextos muy analíticos, puede priorizar visibilidad y acuerdo rápido sobre profundidad técnica.',
      'Conviene observar si la energía comunicativa desplaza tiempo para seguimiento estructurado.',
    ],
    communication:
      'Tiende a ser expresivo, cercano y persuasivo; puede combinar calidez con mensajes orientados a resultados.',
    decisions:
      'Puede decidir impulsado por consenso y oportunidad social, con respaldo decidido cuando hace falta ejecutar.',
    norms:
      'Cuando el cumplimiento neto es bajo, puede priorizar relación y velocidad sobre documentación detallada.',
    teamwork:
      'En equipo suele ser accesible y motivador; puede impulsar al grupo hacia metas visibles y compartidas.',
  },
  'I|S': {
    strengths: [
      'Puede aportar calidez, escucha y constancia en las relaciones de trabajo.',
      'Suele construir confianza de forma gradual y mantener un trato coherente en el día a día.',
    ],
    attention: [
      'En contextos de cambio brusco, puede preferir adaptación gradual y conviene observar tiempos de transición.',
      'Puede evitar confrontación directa; en temas sensibles conviene explicitar expectativas con claridad.',
    ],
    communication:
      'Tiende a comunicarse de forma amable, accesible y orientada a la armonía; valora el tono y la continuidad del trato.',
    decisions:
      'Puede preferir decisiones consensuadas y pausadas; el ritmo suele ser moderado cuando hay implicación relacional.',
    norms:
      'Suele respetar acuerdos y expectativas compartidas; puede ser flexible con normas secundarias si preservan la relación.',
    teamwork:
      'En equipo puede ser soporte estable y conector social; favorece ambientes donde la colaboración sea explícita.',
  },
  'I|C': {
    strengths: [
      'Puede combinar sociabilidad con rigor en lo que comunica o documenta.',
      'Suele ser persuasivo sin perder estructura en mensajes relevantes para el trabajo.',
    ],
    attention: [
      'Puede alternar entre espontaneidad social y exigencia de precisión; conviene alinear qué nivel de detalle se espera.',
      'En contextos muy informales, puede sentir que se relajan estándares que considera importantes.',
    ],
    communication:
      'Tiende a preparar y estructurar la información antes de compartirla, con habilidad para explicar y alinear.',
    decisions:
      'Puede decidir después de contrastar datos y impacto en personas; busca equilibrio entre claridad y aceptación.',
    norms:
      'Suele valorar procedimientos claros en comunicación y entregables; puede señalar inconsistencias en lo acordado.',
    teamwork:
      'En equipo puede ser puente entre personas y criterios; aporta contacto humano con atención al detalle compartido.',
  },
  'S|I': {
    strengths: [
      'Puede aportar calma, apoyo y relaciones de confianza con un matiz expresivo y cercano.',
      'Suele ser paciente y coherente en equipos de trabajo prolongado.',
    ],
    attention: [
      'Ante urgencias marcadas, puede necesitar más tiempo para reorganizar su ritmo habitual.',
      'Conviene observar si la preferencia por armonía retrasa conversaciones difíciles necesarias.',
    ],
    communication:
      'Tiende a un estilo respetuoso y constante, con disposición a mantener contacto frecuente y cordial.',
    decisions:
      'Puede preferir estabilidad y acuerdos previos; decide con más confianza cuando el cambio es gradual.',
    norms:
      'Suele apego a rutinas y acuerdos establecidos; valora previsibilidad en roles y expectativas.',
    teamwork:
      'En equipo puede ser ancla relacional y facilitador de clima; favorece continuidad y confianza mutua.',
  },
  'S|C': {
    strengths: [
      'Puede aportar constancia operativa y respeto por procedimientos en el trabajo cotidiano.',
      'Suele preferir entornos predecibles donde las expectativas estén definidas.',
    ],
    attention: [
      'En contextos muy dinámicos, puede resistir cambios de última hora o ambigüedad normativa.',
      'Conviene observar si la preferencia por lo estable limita iniciativas necesarias fuera del guion.',
    ],
    communication:
      'Tiende a comunicarse con mesura y claridad sobre acuerdos; prefiere mensajes alineados a lo establecido.',
    decisions:
      'Puede decidir de forma pausada, apoyándose en reglas y continuidad; el ritmo suele ser constante.',
    norms:
      'Suele mostrar alto apego a calidad, orden y cumplimiento; valora que las reglas se apliquen con coherencia.',
    teamwork:
      'En equipo puede ser confiable y metódico; aporta estabilidad y cuidado por acuerdos de largo plazo.',
  },
  'S|D': {
    strengths: [
      'Puede combinar base cooperativa con firmeza selectiva cuando la situación lo exige.',
      'Suele equilibrar continuidad y capacidad de empuje puntual hacia objetivos.',
    ],
    attention: [
      'Puede alternar entre contención y aceleración; conviene observar cuándo prioriza acuerdo frente a avance.',
      'En entornos muy competitivos, puede sentir tensión entre estabilidad y exigencia de resultados.',
    ],
    communication:
      'Tiende a ser mesurado y respetuoso, con capacidad de ser más directo cuando el contexto lo requiere.',
    decisions:
      'Puede decidir con prudencia habitual y acelerar si percibe riesgo de estancamiento o plazos críticos.',
    norms:
      'Suele respetar acuerdos y rutinas; puede flexibilizar temporalmente normas menores ante plazos ajustados de entrega.',
    teamwork:
      'En equipo puede sostener clima estable y empujar en momentos clave; valora acuerdos previos al cambiar de ritmo.',
  },
  'C|I': {
    strengths: [
      'Puede fundamentar su estilo en rigor y claridad, con habilidad para explicar y alinear a otros.',
      'Suele preparar bien la información antes de comunicar decisiones o criterios.',
    ],
    attention: [
      'Puede invertir tiempo en precisión antes de socializar cambios; conviene observar ventanas de comunicación.',
      'En contextos muy informales, puede percibir falta de estructura en interacciones clave.',
    ],
    communication:
      'Tiende a ser estructurado y didáctico; combina datos y criterios con disposición moderada a influir.',
    decisions:
      'Puede decidir cuando hay información suficiente; equilibra análisis con necesidad de alinear al grupo.',
    norms:
      'Suele valorar calidad, trazabilidad y mensajes consistentes con lo acordado formalmente.',
    teamwork:
      'En equipo puede aportar orden y claridad explicativa; ayuda a traducir criterios técnicos a lenguaje compartido.',
  },
  'C|D': {
    strengths: [
      'Puede aportar precisión, análisis y capacidad de decidir cuando hay criterios claros.',
      'Suele ser metódico y exigente con procesos sin renunciar por completo al avance.',
    ],
    attention: [
      'Puede ser crítico con ambigüedad o atajos; conviene observar si la exigencia frena iniciativas válidas.',
      'En contextos muy veloces, puede necesitar explicitar qué nivel de control es imprescindible.',
    ],
    communication:
      'Tiende a comunicar con base en hechos y reglas; puede ser directo cuando detecta desviaciones importantes.',
    decisions:
      'Puede decidir de forma fundamentada y firme si los datos respaldan el curso; valora criterios explícitos.',
    norms:
      'Suele mostrar alto apego a calidad y procedimiento; puede cuestionar entregables incompletos o inconsistentes.',
    teamwork:
      'En equipo puede aportar orden y criterio; conviene acordar prioridades para equilibrar control y velocidad.',
  },
  'C|S': {
    strengths: [
      'Puede aportar confiabilidad operativa, cumplimiento y respeto por acuerdos establecidos.',
      'Suele preferir entornos donde roles, reglas y continuidad estén claros.',
    ],
    attention: [
      'Ante cambios frecuentes de prioridad, puede necesitar reorientación explícita de criterios.',
      'Conviene observar si la preferencia por lo predecible limita experimentación necesaria.',
    ],
    communication:
      'Tiende a ser claro y consistente; prefiere mensajes alineados a lo acordado y documentado.',
    decisions:
      'Puede decidir de forma prudente y secuencial; valora estabilidad y evidencia antes de variar curso.',
    norms:
      'Suele enfatizar calidad, orden y cumplimiento; puede ser referencia para mantener estándares compartidos.',
    teamwork:
      'En equipo puede ser pilar de constancia y confianza; favorece acuerdos sostenidos y roles definidos.',
  },
};

const SINGLE_RH = {
  D: {
    strengths: [
      'Puede aportar orientación a resultados y disposición a tomar la iniciativa.',
      'Suele ser directo al abordar objetivos y responsabilidades claras.',
    ],
    attention: [
      'En contextos colaborativos prolongados, puede tender a centralizar decisiones.',
      'Conviene observar si el impulso por avanzar reduce espacio para alineación detallada.',
    ],
    communication: 'Tiende a ser directo y orientado al punto; prioriza claridad de objetivo sobre elaboración extensa.',
    decisions: 'Puede decidir con rapidez cuando hay meta definida; el ritmo suele ser alto en situaciones ambiguas.',
    norms: 'Cuando otras dimensiones netas son bajas, puede flexibilizar detalle normativo en favor de avance.',
    teamwork: 'En equipo puede empujar metas y asumir liderazgo situacional; conviene acordar reparto de decisiones.',
  },
  I: {
    strengths: [
      'Puede aportar cercanía, entusiasmo y facilidad para conectar con distintos interlocutores.',
      'Suele mantener visibilidad y dinamismo en interacciones laborales.',
    ],
    attention: [
      'En tareas muy solitarias o técnicas, puede necesitar más estructura para sostener foco.',
      'Conviene observar si la preferencia por interacción compite con seguimiento documental.',
    ],
    communication: 'Tiende a ser expresivo y accesible; valora el contacto frecuente y el tono positivo.',
    decisions: 'Puede decidir impulsado por consenso e impacto relacional; prefiere escenarios con buy-in visible.',
    norms: 'Cuando el cumplimiento neto es bajo, puede priorizar acuerdo interpersonal sobre formalización exhaustiva.',
    teamwork: 'En equipo suele ser conector social; puede energizar al grupo en momentos de baja visibilidad.',
  },
  S: {
    strengths: [
      'Puede aportar paciencia, cooperación y continuidad en relaciones de trabajo.',
      'Suele ser constante y accesible en dinámicas de equipo prolongadas.',
    ],
    attention: [
      'Ante cambios bruscos, puede necesitar tiempo para reacomodar su ritmo habitual.',
      'Conviene observar si evita conversaciones directas cuando hay desacuerdo persistente.',
    ],
    communication: 'Tiende a un estilo calmado y respetuoso; prefiere escuchar antes de imponer posición.',
    decisions: 'Puede preferir decisiones consensuadas y estables; el ritmo suele ser moderado y constante.',
    norms: 'Suele respetar acuerdos y rutinas; valora previsibilidad en expectativas compartidas.',
    teamwork: 'En equipo puede ser soporte confiable; favorece armonía y continuidad en roles.',
  },
  C: {
    strengths: [
      'Puede aportar precisión, orden y atención a calidad en entregables y procesos.',
      'Suele ser coherente con criterios y reglas cuando están definidos.',
    ],
    attention: [
      'En entornos muy cambiantes, puede sentir tensión con ambigüedad o falta de estándares.',
      'Conviene observar si la búsqueda de exactitud retrasa comunicación o cierre de tareas.',
    ],
    communication: 'Tiende a ser estructurado y basado en hechos; prefiere mensajes precisos y verificables.',
    decisions: 'Puede decidir apoyándose en datos y procedimiento; valora evidencia antes de variar curso.',
    norms: 'Suele enfatizar cumplimiento y calidad; puede señalar desviaciones respecto a lo acordado.',
    teamwork: 'En equipo puede aportar confiabilidad metódica; ayuda a mantener estándares compartidos.',
  },
};

const PATTERN_RH = {
  balanced: {
    strengths: [
      'Puede adaptarse con flexibilidad cuando ninguna tendencia DISC domina claramente el perfil neto.',
      'Suele mostrar capacidad de leer el contexto sin quedar anclado a un solo estilo conductual.',
    ],
    attention: [
      'Conviene observar en qué situaciones emerge con más fuerza cada dimensión, dado el equilibrio del perfil.',
      'En roles muy especializados, puede necesitar referencias explícitas de prioridades conductuales.',
    ],
    communication:
      'Tiende a modular el estilo comunicativo según interlocutor y contexto, sin un patrón único claramente dominante.',
    decisions:
      'Puede decidir apoyándose en el equilibrio del perfil; conviene explicitar criterios cuando se requiera velocidad o detalle.',
    norms:
      'Suele mostrar apego moderado a normas; la exigencia de calidad dependerá del énfasis relativo de C en el perfil.',
    teamwork:
      'En equipo puede alternar roles según necesidad; valora acuerdos claros sobre expectativas mutuas.',
  },
  low_differentiation: {
    strengths: [
      'Puede mostrar versatilidad conductual al no marcar una sola dimensión con amplio margen.',
      'Suele integrar matices de varias tendencias DISC en su forma de trabajar.',
    ],
    attention: [
      'Conviene observar qué dimensiones emergen en situaciones concretas, dado el perfil poco diferenciado.',
      'En contextos que exigen estilo muy definido, puede necesitar mayor claridad de expectativas.',
    ],
    communication:
      'Tiende a combinar elementos de varias dimensiones; la comunicación puede variar según interlocutor y tema.',
    decisions:
      'Puede decidir considerando varios factores a la vez; el ritmo puede ser moderado por falta de polarización clara.',
    norms:
      'Suele mostrar cumplimiento proporcional al peso relativo de C; conviene explicitar estándares cuando importen.',
    teamwork:
      'En equipo puede ajustarse a distintos estilos; la lectura debe apoyarse en observación situacional.',
  },
  co_dominant: {
    strengths: [
      'Puede combinar con fluidez las dimensiones que comparten el primer lugar en el perfil neto.',
      'Suele aportar un estilo integrado más que una sola tendencia aislada.',
    ],
    attention: [
      'Conviene observar cuál de las dimensiones co-dominantes emerge con más fuerza según contexto.',
      'En situaciones que exigen priorizar un solo estilo, puede necesitar acuerdos explícitos de enfoque.',
    ],
    communication:
      'Tiende a reflejar la combinación de dimensiones co-dominantes; el tono puede alternar según la situación.',
    decisions:
      'Puede decidir ponderando las dimensiones empatadas; conviene clarificar qué criterio pesa más en cada caso.',
    norms:
      'Suele modular exigencia normativa según la mezcla co-dominante; C aportará más peso si forma parte del grupo.',
    teamwork:
      'En equipo puede aportar múltiples fortalezas simultáneas; valora contextos donde la combinación sea útil.',
  },
};

function applyModulators(block, total, keyStr) {
  const out = {
    ...block,
    strengths: [...block.strengths],
    attention: [...block.attention],
  };
  if ((keyStr === 'D|I' || keyStr === 'I|D') && isLow(total, 'C')) {
    out.norms =
      'Con cumplimiento neto bajo o moderado, puede priorizar velocidad y acuerdo por encima de revisión exhaustiva de detalle.';
  } else if ((keyStr === 'D|I' || keyStr === 'I|D') && isHigh(total, 'C')) {
    out.norms =
      'Cuando C acompaña con peso relativo, puede equilibrar velocidad con mayor atención a criterios y calidad.';
  }
  return out;
}

function resolveContentBlock(analysis, total) {
  if (analysis.isBalanced) return PATTERN_RH.balanced;
  if (analysis.isLowDifferentiation) return PATTERN_RH.low_differentiation;
  if (analysis.primary.tied) return PATTERN_RH.co_dominant;

  const primary = analysis.primary.keys[0];
  if (analysis.hasSecondary && analysis.secondary && !analysis.secondary.tied) {
    const secondary = analysis.secondary.keys[0];
    const keyStr = pairKey(primary, secondary);
    const block = PAIR_RH[keyStr] || PAIR_RH[pairKey(secondary, primary)];
    if (block) return applyModulators(block, total, keyStr);
  }

  return SINGLE_RH[primary] || PATTERN_RH.low_differentiation;
}

function buildMostLeastContext(most, least, total, analysis) {
  const topMost = topKeysByScore(most, 1)[0];
  const topLeast = topKeysByScore(least, 1)[0];
  const dominantNet = analysis.primary.keys[0];
  const parts = [];

  if (topMost && (most[topMost] > 0)) {
    parts.push(
      `Dentro de los rasgos que más reconoce en sí mismo aparecen estilos asociados a ${dimLabel(topMost)} (${topMost}).`,
    );
  }
  if (topLeast && least[topLeast] > 0 && topLeast !== topMost) {
    parts.push(
      `Tiende a identificarse menos con estilos asociados a ${dimLabel(topLeast)} (${topLeast}).`,
    );
  }
  if (parts.length === 0) return null;
  if (parts.length === 1 && topMost === dominantNet && !analysis.primary.tied) return null;
  return parts.join(' ');
}

/**
 * Lectura RH Fase 2: fortalezas, atención, áreas laborales y contexto M/L prudente.
 *
 * @param {CleaverProfileAnalysis} analysis
 * @param {Record<string, number>} total
 * @param {Record<string, number>} most
 * @param {Record<string, number>} least
 */
export function buildCleaverRhReading(analysis, total, most, least) {
  const block = resolveContentBlock(analysis, total);
  const mostLeastContext = buildMostLeastContext(most, least, total, analysis);

  return {
    strengths: block.strengths.slice(0, 3),
    attention: block.attention.slice(0, 3),
    areas: {
      communication: block.communication,
      decisions: block.decisions,
      norms: block.norms,
      teamwork: block.teamwork,
    },
    mostLeastContext,
  };
}

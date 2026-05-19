import { MODULE_CATALOG, MIND24_MODULE_KEYS } from '../src/utils/moduleCatalog.js';

/**
 * Preguntas placeholder por tipo — validación visual del motor dinámico.
 */
const PLACEHOLDER_QUESTIONS = [
  {
    moduleKey: 'habilidades_especificas',
    type: 'MULTIPLE_CHOICE',
    text: '[Demo] Ante un cliente insatisfecho, ¿cuál es tu primer paso?',
    options: [
      { label: 'Escuchar con calma y pedir detalles', value: 'a' },
      { label: 'Derivar de inmediato sin escuchar', value: 'b' },
      { label: 'Ignorar el comentario', value: 'c' },
    ],
  },
  {
    moduleKey: 'cleaver',
    type: 'CLEAVER_MATRIX',
    text: '[Demo] Selecciona la palabra que MÁS y MENOS te representa en el trabajo.',
    metadata: { instruction: 'No puedes elegir la misma palabra en ambas columnas.' },
    options: [
      { label: 'Decidido', value: 'decidido' },
      { label: 'Empático', value: 'empatico' },
      { label: 'Metódico', value: 'metodico' },
      { label: 'Entusiasta', value: 'entusiasta' },
    ],
  },
  {
    moduleKey: 'entrevista_digital',
    type: 'AUDIO_RECORDING',
    text: '[Demo] Graba un audio de 30–60 segundos: ¿Por qué te interesa este puesto?',
    metadata: { maxDurationSec: 60, placeholder: 'Pulsa grabar cuando estés listo.' },
  },
  {
    moduleKey: 'medida',
    type: 'OPEN_TEXT',
    text: '[Demo] Describe brevemente una situación donde resolviste un problema en equipo.',
    metadata: { maxLength: 500, placeholder: 'Escribe tu respuesta aquí…' },
  },
];

export async function seedEvaluationEngine(prisma) {
  await prisma.candidateResponse.deleteMany();
  await prisma.questionOption.deleteMany();
  await prisma.question.deleteMany();
  await prisma.evaluationModule.deleteMany();

  const moduleIdByKey = {};

  for (let i = 0; i < MIND24_MODULE_KEYS.length; i++) {
    const key = MIND24_MODULE_KEYS[i];
    const cat = MODULE_CATALOG[key];
    const mod = await prisma.evaluationModule.create({
      data: {
        key,
        title: cat.label,
        description: cat.description,
        icon: cat.icon,
        sortOrder: i,
      },
    });
    moduleIdByKey[key] = mod.id;
  }

  for (let i = 0; i < PLACEHOLDER_QUESTIONS.length; i++) {
    const spec = PLACEHOLDER_QUESTIONS[i];
    const moduleId = moduleIdByKey[spec.moduleKey];
    if (!moduleId) continue;

    await prisma.question.create({
      data: {
        moduleId,
        type: spec.type,
        text: spec.text,
        metadata: spec.metadata ?? undefined,
        sortOrder: i,
        options: spec.options
          ? {
              create: spec.options.map((o, j) => ({
                label: o.label,
                value: o.value,
                sortOrder: j,
              })),
            }
          : undefined,
      },
    });
  }

  console.log('Evaluation engine seeded:', {
    modules: MIND24_MODULE_KEYS.length,
    placeholderQuestions: PLACEHOLDER_QUESTIONS.length,
  });
}

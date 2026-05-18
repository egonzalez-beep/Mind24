/** Catálogo corporativo Mind24 — keys alineadas con crear-eval y lobby. */
export const MIND24_MODULE_KEYS = [
  'honestidad',
  'cleaver',
  'cognitivo',
  'mrr',
  'habilidades_especificas',
  'entrevista_digital',
  'medida',
];

/** Keys legacy (asignaciones antiguas) → catálogo actual. */
const LEGACY_ALIASES = {
  habilidades: 'habilidades_especificas',
  conocimientos: 'cognitivo',
  disc: 'cleaver',
  ie: 'mrr',
  liderazgo: 'medida',
};

export const MODULE_CATALOG = {
  honestidad: {
    label: 'Batería de Honestidad (Exclusivo Mind24)',
    description:
      'Detecta blindaje moral, lealtad y riesgos de corrupción. Evaluación propietaria antifraude.',
    icon: '🛡️',
    estimatedMinutes: null,
    featured: true,
    sectionIds: ['calibracion', 'directas', 'principal'],
  },
  cleaver: {
    label: 'Comportamiento (CLEAVER)',
    description: 'Predice la reacción bajo presión y adaptabilidad al puesto.',
    icon: '🎯',
    estimatedMinutes: null,
    sectionIds: ['principal'],
    questionIdRange: [1, 7],
  },
  cognitivo: {
    label: 'Potencial Cognitivo (TERMAN & RAVEN)',
    description: 'Mide el IQ, capacidad de aprendizaje y juicio ejecutivo.',
    icon: '🧠',
    estimatedMinutes: null,
    sectionIds: ['principal'],
    questionIdRange: [8, 14],
  },
  mrr: {
    label: 'Personalidad MRR',
    description: 'Identifica líderes resilientes capaces de innovar bajo demanda.',
    icon: '🌟',
    estimatedMinutes: null,
    sectionIds: ['principal'],
    questionIdRange: [15, 22],
  },
  habilidades_especificas: {
    label: 'Habilidades Específicas',
    description: 'Evaluaciones de impacto para Ventas y Atención al Cliente.',
    icon: '📊',
    estimatedMinutes: null,
    sectionIds: ['principal'],
    questionIdRange: [23, 30],
  },
  entrevista_digital: {
    label: 'Entrevista Digital',
    description: 'Filtro asíncrono automatizado de preguntas clave sin intervención humana.',
    icon: '🎤',
    estimatedMinutes: null,
    sectionIds: ['principal'],
    questionIdRange: [31, 36],
  },
  medida: {
    label: 'Módulo a la Medida',
    description: 'Digitalizamos tus pruebas técnicas o procesos de Onboarding corporativo.',
    icon: '🛠️',
    estimatedMinutes: null,
    sectionIds: ['principal'],
    questionIdRange: [37, 40],
  },
};

export const DEFAULT_SELECTED_MODULES = [...MIND24_MODULE_KEYS];

export function resolveModuleKey(key) {
  const k = String(key || '').trim();
  return LEGACY_ALIASES[k] || k;
}

export function moduleMetaForKey(key) {
  const resolved = resolveModuleKey(key);
  const m = MODULE_CATALOG[resolved];
  if (m) return { key: resolved, ...m };
  return {
    key: resolved,
    label: resolved,
    description: '',
    icon: '◈',
    estimatedMinutes: null,
    sectionIds: [],
  };
}

export function moduleLabelMap() {
  const out = {};
  for (const k of MIND24_MODULE_KEYS) {
    out[k] = MODULE_CATALOG[k].label;
  }
  for (const [legacy, target] of Object.entries(LEGACY_ALIASES)) {
    out[legacy] = MODULE_CATALOG[target]?.label || legacy;
  }
  return out;
}

function questionNum(id) {
  const m = /^p(\d+)$/i.exec(String(id || ''));
  return m ? parseInt(m[1], 10) : null;
}

/** Filtra el instrumento JSON a un solo módulo para intentos independientes. */
export function filterConfigByModule(config, moduleKey) {
  const meta = moduleMetaForKey(moduleKey);
  const base = config && typeof config === 'object' ? config : {};
  const allowedSectionIds = new Set(meta.sectionIds || []);
  const [qMin, qMax] = meta.questionIdRange || [null, null];

  const sections = (base.sections || [])
    .filter((sec) => allowedSectionIds.has(sec.id))
    .map((sec) => {
      if (sec.id !== 'principal' || qMin == null) return sec;
      const questions = (sec.questions || []).filter((q) => {
        const n = questionNum(q.id);
        return n != null && n >= qMin && n <= qMax;
      });
      return { ...sec, questions };
    })
    .filter((sec) => (sec.questions || []).length > 0);

  const timeLimitSec =
    meta.estimatedMinutes != null && meta.estimatedMinutes > 0
      ? meta.estimatedMinutes * 60
      : base.meta?.timeLimitSec || 2700;

  return {
    ...base,
    meta: {
      ...(base.meta || {}),
      title: meta.label,
      introSubtitle:
        meta.description ||
        `Módulo: ${meta.label}. Responde con sinceridad; puedes volver al lobby al finalizar.`,
      timeLimitSec,
    },
    sections,
  };
}

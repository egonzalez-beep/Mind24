/** Catálogo corporativo Mind24 — keys alineadas con crear-eval y lobby. */
export const MIND24_MODULE_KEYS = [
  'honestidad',
  'cleaver',
  'terman',
  'sales_sjt',
  'digital_interview',
  'medida',
];

/** Módulos que pueden asignarse y ejecutarse hoy. */
export const ASSIGNABLE_MODULE_KEYS = ['honestidad', 'cleaver', 'terman', 'sales_sjt'];

export const DEFAULT_SELECTED_MODULES = [...ASSIGNABLE_MODULE_KEYS];

/** Módulos retirados del catálogo (solo lectura histórica). */
export const RETIRED_MODULE_KEYS = new Set(['mrr', 'habilidades_especificas']);

/** Keys legacy (asignaciones antiguas) → catálogo actual. */
const LEGACY_ALIASES = {
  habilidades: 'sales_sjt',
  habilidades_especificas: 'sales_sjt',
  conocimientos: 'terman',
  cognitivo: 'terman',
  raven: 'terman',
  disc: 'cleaver',
  liderazgo: 'medida',
  entrevista_digital: 'digital_interview',
};

const RETIRED_LABELS = {
  mrr: 'Personalidad MRR (retirado)',
  habilidades_especificas: 'Habilidades específicas (retirado)',
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
  terman: {
    label: 'Evaluación Cognitiva Analítica Mind24',
    description:
      'Batería cognitiva corporativa Mind24: razonamiento, vocabulario y lógica en 10 bloques cronometrados.',
    icon: '🧠',
    estimatedMinutes: null,
    sectionIds: ['principal'],
  },
  sales_sjt: {
    label: 'Simulador de Escenarios Comerciales (SJT)',
    description:
      'Juicio situacional en ventas, negociación y atención a clientes. 15 escenarios premium con puntuación ponderada (máx. 75 pts).',
    icon: '📊',
    estimatedMinutes: 30,
    sectionIds: ['principal'],
  },
  digital_interview: {
    label: 'Entrevista Digital Estructurada',
    description:
      'Filtro asíncrono con respuestas por nota de voz a preguntas clave del puesto (próxima fase).',
    icon: '🎤',
    estimatedMinutes: null,
    comingSoon: true,
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

export function resolveModuleKey(key) {
  const k = String(key || '').trim();
  if (RETIRED_MODULE_KEYS.has(k)) return k;
  return LEGACY_ALIASES[k] || k;
}

export function isRetiredModuleKey(key) {
  const rk = resolveModuleKey(key);
  return RETIRED_MODULE_KEYS.has(rk);
}

export function isComingSoonModuleKey(key) {
  const rk = resolveModuleKey(key);
  const cat = MODULE_CATALOG[rk];
  return Boolean(cat?.comingSoon);
}

export function isAssignableModuleKey(key) {
  const rk = resolveModuleKey(key);
  return ASSIGNABLE_MODULE_KEYS.includes(rk);
}

/** Filtra claves válidas para nuevas asignaciones. */
export function filterAssignableModuleKeys(keys) {
  if (!Array.isArray(keys)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of keys) {
    const rk = resolveModuleKey(String(raw));
    if (!ASSIGNABLE_MODULE_KEYS.includes(rk) || seen.has(rk)) continue;
    seen.add(rk);
    out.push(rk);
  }
  return out;
}

/** Módulos visibles en lobby de candidato (asignables con motor activo). */
export function isCandidateLobbyModuleKey(key) {
  return isAssignableModuleKey(key);
}

/** Persistencia en BD: activo solo si el módulo puede ejecutarse. */
export function isModuleActiveInDb(key) {
  if (RETIRED_MODULE_KEYS.has(key)) return false;
  const cat = MODULE_CATALOG[key];
  if (!cat || cat.comingSoon) return false;
  if (ASSIGNABLE_MODULE_KEYS.includes(key)) return true;
  if (key === 'medida') return true;
  return false;
}

/** Único módulo que puede usar el instrumento JSON legacy (AssessmentDefinition.config). */
export function isLegacyJsonModule(moduleKey) {
  return resolveModuleKey(moduleKey) === 'honestidad';
}

export function moduleMetaForKey(key) {
  const resolved = resolveModuleKey(key);
  if (RETIRED_MODULE_KEYS.has(resolved)) {
    return {
      key: resolved,
      label: RETIRED_LABELS[resolved] || resolved,
      description: '',
      icon: '◈',
      estimatedMinutes: null,
      retired: true,
      sectionIds: [],
    };
  }
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

/** Nombre corto para tablas del dashboard. */
export const MODULE_TABLE_LABELS = {
  honestidad: 'Honestidad',
  cleaver: 'Cleaver',
  terman: 'Eval. Cognitiva Mind24',
  sales_sjt: 'SJT Comercial',
  digital_interview: 'Entrevista',
  medida: 'A la medida',
};

/** Nombre amigable para reportes PDF. */
export const MODULE_REPORT_LABELS = {
  honestidad: 'Honestidad',
  cleaver: 'Comportamiento',
  terman: 'Evaluación Cognitiva Analítica Mind24',
  sales_sjt: 'Simulador de Escenarios Comerciales (SJT)',
  digital_interview: 'Entrevista Digital Estructurada',
  medida: 'Módulo a la medida',
};

export function moduleTableLabel(key) {
  const rk = resolveModuleKey(key);
  if (RETIRED_MODULE_KEYS.has(rk)) return RETIRED_LABELS[rk] || rk;
  return MODULE_TABLE_LABELS[rk] || moduleMetaForKey(rk).label;
}

export function moduleReportLabel(key) {
  const rk = resolveModuleKey(key);
  if (RETIRED_MODULE_KEYS.has(rk)) return RETIRED_LABELS[rk] || rk;
  return MODULE_REPORT_LABELS[rk] || moduleMetaForKey(rk).label;
}

/** Lista legible en español: "A, B y C". */
export function formatModuleListSpanish(keys, labelFn = moduleReportLabel) {
  const labels = [...new Set(keys.map((k) => labelFn(k)).filter(Boolean))];
  if (!labels.length) return '—';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} y ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
}

export function moduleLabelMap() {
  const out = {};
  for (const k of MIND24_MODULE_KEYS) {
    out[k] = MODULE_CATALOG[k].label;
  }
  for (const [legacy, target] of Object.entries(LEGACY_ALIASES)) {
    out[legacy] = MODULE_CATALOG[target]?.label || legacy;
  }
  for (const [rk, label] of Object.entries(RETIRED_LABELS)) {
    out[rk] = label;
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

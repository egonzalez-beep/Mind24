/** Catálogo UI de módulos (keys alineadas con crear-eval). */
export const MODULE_CATALOG = {
  habilidades: {
    label: 'Habilidades',
    icon: '⚡',
    estimatedMinutes: 15,
    sectionIds: ['calibracion', 'directas'],
  },
  conocimientos: {
    label: 'Conocimientos',
    icon: '📚',
    estimatedMinutes: 20,
    sectionIds: ['principal'],
    questionIdRange: [1, 14],
  },
  disc: {
    label: 'Perfil DISC',
    icon: '🎯',
    estimatedMinutes: 15,
    sectionIds: ['principal'],
    questionIdRange: [15, 28],
  },
  ie: {
    label: 'Inteligencia emocional',
    icon: '🧠',
    estimatedMinutes: 15,
    sectionIds: ['principal'],
    questionIdRange: [29, 35],
  },
  liderazgo: {
    label: 'Liderazgo',
    icon: '🏆',
    estimatedMinutes: 15,
    sectionIds: ['principal'],
    questionIdRange: [36, 40],
  },
};

export function moduleMetaForKey(key) {
  const m = MODULE_CATALOG[key];
  if (m) return { key, ...m };
  return {
    key,
    label: key,
    icon: '◈',
    estimatedMinutes: 10,
    sectionIds: [],
  };
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

  const minutes = meta.estimatedMinutes || 10;
  return {
    ...base,
    meta: {
      ...(base.meta || {}),
      title: meta.label,
      introSubtitle: `Módulo: ${meta.label}. Responde con sinceridad; puedes volver al lobby al finalizar.`,
      timeLimitSec: minutes * 60,
    },
    sections,
  };
}

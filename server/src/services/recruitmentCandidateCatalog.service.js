/** Catálogos y normalización de candidatos (Recruitment 1D.2.1). */

export const RECRUITMENT_CANDIDATE_SOURCE_OPTIONS = [
  'Indeed',
  'OCC',
  'Computrabajo',
  'LinkedIn',
  'Facebook / Meta',
  'Referido',
  'Bolsa de empleo',
  'Base propia',
  'Otro',
];

export const RECRUITMENT_CANDIDATE_PROFILE_OPTIONS = [
  'Ventas',
  'Atención a clientes',
  'Administrativo',
  'Contabilidad / Finanzas',
  'Recursos Humanos',
  'Logística / Almacén',
  'Mantenimiento',
  'Producción / Operativo',
  'Calidad',
  'Seguridad',
  'Transporte',
  'Tecnología',
  'Otro',
];

function trimOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export function normalizeRecruitmentCandidateFullName(fullName) {
  const collapsed = String(fullName ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (collapsed.length < 2) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Indica el nombre completo del candidato.';
    throw err;
  }
  return collapsed
    .split(' ')
    .map((word) => {
      if (!word) return '';
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/** Guarda source canónico; detalle libre solo en sourceOther cuando source === 'Otro'. */
export function resolveRecruitmentCandidateSourceFields(source, sourceOther) {
  const s = trimOrNull(source);
  if (!s) return { source: null, sourceOther: null };
  if (s === 'Otro') {
    const other = trimOrNull(sourceOther);
    if (!other) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Indica la fuente cuando seleccionas Otro.';
      throw err;
    }
    return { source: 'Otro', sourceOther: other.slice(0, 120) };
  }
  if (!RECRUITMENT_CANDIDATE_SOURCE_OPTIONS.includes(s)) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Fuente de reclutamiento no válida.';
    throw err;
  }
  return { source: s, sourceOther: null };
}

/** Guarda profile canónico; detalle libre solo en profileOther cuando profile === 'Otro'. */
export function resolveRecruitmentCandidateProfileFields(profile, profileOther) {
  const p = trimOrNull(profile);
  if (!p) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Indica el perfil principal.';
    throw err;
  }
  if (p === 'Otro') {
    const other = trimOrNull(profileOther);
    if (!other) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Indica el perfil cuando seleccionas Otro.';
      throw err;
    }
    return { profile: 'Otro', profileOther: other.slice(0, 300) };
  }
  if (!RECRUITMENT_CANDIDATE_PROFILE_OPTIONS.includes(p)) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Perfil principal no válido.';
    throw err;
  }
  return { profile: p, profileOther: null };
}

/**
 * Perfil secundario opcional. Sin columna profileSecondaryOther: si elige Otro, el texto
 * custom se guarda en profileSecondary (no afecta filtros de cartera).
 */
export function resolveRecruitmentCandidateProfileSecondary(profileSecondary, profileSecondaryOther) {
  const p = trimOrNull(profileSecondary);
  if (!p) return null;
  if (p === 'Otro') {
    const other = trimOrNull(profileSecondaryOther);
    if (!other) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Indica el perfil secundario cuando seleccionas Otro.';
      throw err;
    }
    return other.slice(0, 300);
  }
  if (!RECRUITMENT_CANDIDATE_PROFILE_OPTIONS.includes(p)) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Perfil secundario no válido.';
    throw err;
  }
  return p;
}

/**
 * WhatsApp o teléfono (legacy): al menos uno. Fallbacks para phone NOT NULL.
 */
export function resolveRecruitmentCandidatePhoneFields({ whatsapp, phone }) {
  const wa = trimOrNull(whatsapp);
  const ph = trimOrNull(phone);
  if (!wa && !ph) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Indica WhatsApp o teléfono de contacto.';
    throw err;
  }
  if (wa && wa.length < 5) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Indica un WhatsApp válido.';
    throw err;
  }
  if (ph && ph.length < 5) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Teléfono secundario no válido.';
    throw err;
  }
  if (wa && !ph) {
    return { whatsapp: wa.slice(0, 40), phone: wa.slice(0, 40) };
  }
  if (!wa && ph) {
    return { whatsapp: ph.slice(0, 40), phone: ph.slice(0, 40) };
  }
  return {
    whatsapp: wa.slice(0, 40),
    phone: (ph || wa).slice(0, 40),
  };
}

export function prepareRecruitmentCandidateWritePayload(raw, { partial = false } = {}) {
  const out = {};
  if (raw.fullName != null || !partial) {
    out.fullName = normalizeRecruitmentCandidateFullName(raw.fullName);
  }
  if (raw.profile != null || !partial) {
    Object.assign(out, resolveRecruitmentCandidateProfileFields(raw.profile, raw.profileOther));
  }
  if (raw.profileSecondary !== undefined || !partial) {
    out.profileSecondary =
      raw.profileSecondary === undefined && partial
        ? undefined
        : resolveRecruitmentCandidateProfileSecondary(
            raw.profileSecondary,
            raw.profileSecondaryOther,
          );
  }
  if (raw.whatsapp != null || raw.phone != null || !partial) {
    const phones = resolveRecruitmentCandidatePhoneFields({
      whatsapp: raw.whatsapp,
      phone: raw.phone,
    });
    out.whatsapp = phones.whatsapp;
    out.phone = phones.phone;
  }
  if (raw.source !== undefined || !partial) {
    if (raw.source === undefined && partial) {
      /* skip */
    } else {
      const src = resolveRecruitmentCandidateSourceFields(raw.source, raw.sourceOther);
      out.source = src.source;
      out.sourceOther = src.sourceOther;
    }
  }
  if (raw.email !== undefined) out.email = raw.email;
  if (raw.city !== undefined) out.city = trimOrNull(raw.city);
  if (raw.state !== undefined) out.state = trimOrNull(raw.state);
  if (raw.locality !== undefined) out.locality = trimOrNull(raw.locality);
  if (raw.neighborhood !== undefined) out.neighborhood = trimOrNull(raw.neighborhood);
  if (raw.notes !== undefined) out.notes = raw.notes;
  return out;
}

/** @deprecated use resolveRecruitmentCandidateProfileFields */
export function resolveRecruitmentCandidateProfile(profile, profileOther) {
  return resolveRecruitmentCandidateProfileFields(profile, profileOther).profile;
}

/** @deprecated use resolveRecruitmentCandidateSourceFields */
export function resolveRecruitmentCandidateSource(source, sourceOther) {
  return resolveRecruitmentCandidateSourceFields(source, sourceOther).source;
}

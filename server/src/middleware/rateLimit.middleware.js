import rateLimit from 'express-rate-limit';

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMIT', message: 'Demasiados intentos. Espera unos minutos.' },
});

export const apiSoftLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

export const timeclockExchangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMIT', message: 'Demasiados intentos de acceso al checador.' },
});

export const timeclockCheckInLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMIT', message: 'Demasiadas solicitudes. Espera un momento.' },
});

/** Solo el análisis administrativo de CV. Aislado del de vacantes y de la creación. */
export const recruitmentCandidateResumeParseLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: { error: 'RATE_LIMIT', message: 'Demasiados análisis de CV. Espera unos minutos.' },
  keyGenerator(req) {
    const userId = req.session && req.session.userId != null ? String(req.session.userId) : '';
    if (!userId || userId.length > 128 || /[\r\n]/.test(userId)) return 'resume-parse:anonymous';
    return `resume-parse:user:${userId}`;
  },
});

/** Solo el parseo de CV del portal. No comparte cupo con el checador ni acepta una clave del cliente. */
export const recruitmentPortalResumeParseLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: { error: 'RATE_LIMIT', message: 'Demasiados análisis de CV. Espera unos minutos.' },
  keyGenerator(req) {
    const employeeId = req.timeclockEmployee && req.timeclockEmployee.id != null ? String(req.timeclockEmployee.id) : '';
    if (!employeeId || employeeId.length > 128 || /[\r\n]/.test(employeeId)) return 'resume-parse:portal:anonymous';
    return `resume-parse:portal:${employeeId}`;
  },
});

/** Solo el análisis de vacante. La clave sale de la sesión, no de un campo del cliente. */
export const recruitmentVacancyExtractLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: { error: 'RATE_LIMIT', message: 'Demasiados análisis de vacantes. Espera unos minutos.' },
  keyGenerator(req) {
    const userId = req.session && req.session.userId != null ? String(req.session.userId) : '';
    if (!userId || userId.length > 128 || /[\r\n]/.test(userId)) return 'vacancy-extract:anonymous';
    return `vacancy-extract:user:${userId}`;
  },
});

/**
 * Solo las mutaciones de foto y estado del portal.
 * No se monta en login, checador, candidatos ni notificaciones.
 * La clave une al colaborador de la sesión con su IP: un colaborador no gasta el cupo de otro.
 * MemoryStore rota sus mapas al cerrar la ventana, así que las claves vencidas se descartan.
 */
export function timeclockPersonaRateKey(req) {
  const rawId = req.timeclockEmployee && req.timeclockEmployee.id != null ? String(req.timeclockEmployee.id) : '';
  const employeeId = rawId && rawId.length <= 128 && !/[\r\n]/.test(rawId) ? rawId : 'anonymous';
  const ip = String(req.ip || '').replace(/[\r\n]/g, '').slice(0, 80) || 'unknown';
  return `persona:${employeeId}:${ip}`;
}

export const timeclockPersonaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: { error: 'RATE_LIMIT', message: 'Demasiadas solicitudes. Espera un momento.' },
  keyGenerator: timeclockPersonaRateKey,
});

/** ~45 s entre heartbeats → hasta ~2/min; margen amplio para reintentos. */
export const timeclockHeartbeatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMIT', message: 'Demasiados heartbeats.' },
});

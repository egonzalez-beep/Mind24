import { ZodError } from 'zod';

const STATUS = {
  INVALID_CREDENTIALS: 401,
  INVALID_CANDIDATE_ACCESS: 401,
  MODULE_KEY_REQUIRED: 400,
  MODULE_NOT_ASSIGNED: 403,
  MODULE_ALREADY_COMPLETED: 409,
  DYNAMIC_ENGINE_NOT_AVAILABLE: 404,
  MODULE_NOT_CONFIGURED: 503,
  MODULE_UNAVAILABLE: 503,
  ASSIGNMENT_REPORT_NOT_READY: 404,
  QUESTION_NOT_IN_MODULE: 400,
  CLEAVER_SAME_MORE_LESS: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  ORG_BLOCKED: 403,
  EMPRESA_NOT_PROVISIONED: 403,
  MASTER_LOGIN_DISABLED: 403,
  MASTER_ADMIN_REQUIRED: 403,
  NOT_CANDIDATE: 403,
  NOT_FOUND: 404,
  EMAIL_IN_USE: 409,
  ALREADY_COMPLETED: 409,
  INVALID_STATE: 409,
  CONFLICT: 409,
  NO_CREDITS: 403,
  DEFINITION_NOT_FOUND: 400,
  INVALID_MODULES: 400,
  INSUFFICIENT_CREDITS: 403,
  INCOMPLETE_ANSWERS: 400,
  INVALID_OPTION_INDEX: 400,
  VALIDATION_ERROR: 400,
  GOAL_PERIOD_BACKFILL_LIMIT: 409,
  GOAL_METRICS_PERIOD_LIMIT: 409,
  GOAL_METRICS_GOAL_LIMIT: 409,
  CONFIG_ERROR: 503,
  TIME_EXPIRED: 400,
  NOT_SUBMITTED: 400,
  RATE_LIMIT: 429,
  PARTIAL_DELETE: 500,
  ATTENDANCE_NOT_CONFIGURED: 403,
  WORK_SESSION_NOT_OPEN: 409,
  WORK_LOG_ALREADY_SUBMITTED: 409,
};

/** Foto administrativa o foto propia del portal. No alcanza otras rutas que contengan "photo". */
export function isWorkforceEmployeePhotoRequest(req) {
  const raw = String(req?.originalUrl || req?.url || '');
  const pathOnly = raw.split('?')[0].split('#')[0];
  if (pathOnly === '/api/timeclock/public/photo') return true;
  return /^\/api\/org\/timeclock\/employees\/[^/]+\/photo$/.test(pathOnly);
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Datos inválidos', details: err.flatten() });
  }
  // Multer de la foto del colaborador comparte este manejador.
  // La traducción queda en esas dos rutas; un 500 sigue ocultando el mensaje interno.
  if (
    err.code === 'LIMIT_UNEXPECTED_FILE' ||
    err.code === 'LIMIT_FILE_COUNT' ||
    err.code === 'LIMIT_FIELD_COUNT' ||
    err.code === 'LIMIT_UNEXPECTED_FIELD'
  ) {
    if (isWorkforceEmployeePhotoRequest(req)) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Envía una sola imagen, sin campos adicionales.',
      });
    }
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    const isDoc = String(req.originalUrl || '').includes('/documents');
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: isDoc ? 'El documento supera el límite de 10 MB.' : 'La imagen supera el límite de 3 MB.',
    });
  }
  if (err.message === 'INVALID_AVATAR_FILE') {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Formato de imagen no permitido. Use JPG, PNG o WEBP.' });
  }
  if (err.message === 'INVALID_DOCUMENT_FILE') {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Formato no permitido. Use PDF, JPG, PNG o WEBP.' });
  }
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'CONFLICT', message: 'El recurso ya existe.' });
  }
  const code = err.code || err.name;
  const status = STATUS[code] || (err.status && Number(err.status)) || 500;
  const payload = {
    error: code || 'INTERNAL',
    message: err.message && status !== 500 ? err.message : 'Error interno',
  };
  if (err.details) payload.details = err.details;
  if (status === 500) {
    console.error('[Mind24]', err.stack || err);
    payload.message = 'Error interno del servidor';
  }
  if (String(req.originalUrl || '').includes('/attempts/') && String(req.originalUrl || '').includes('/complete')) {
    console.error('[DIAG:http:complete]', {
      status,
      error: payload.error,
      message: payload.message,
      details: payload.details,
      attemptId: req.params?.attemptId,
    });
  }
  res.status(status).json(payload);
}

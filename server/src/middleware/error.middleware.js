import { ZodError } from 'zod';

const STATUS = {
  INVALID_CREDENTIALS: 401,
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
  NO_CREDITS: 400,
  DEFINITION_NOT_FOUND: 400,
  INSUFFICIENT_CREDITS: 400,
  INCOMPLETE_ANSWERS: 400,
  INVALID_OPTION_INDEX: 400,
  VALIDATION_ERROR: 400,
  TIME_EXPIRED: 400,
  NOT_SUBMITTED: 400,
  RATE_LIMIT: 429,
};

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Datos inválidos', details: err.flatten() });
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
  res.status(status).json(payload);
}

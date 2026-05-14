import dotenv from 'dotenv';

dotenv.config();

function req(name, fallback = undefined) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

/** Hash bcrypt de "mind24" (cost 12). En producción define SUPERADMIN_PASSWORD_HASH en Railway. */
const DEFAULT_SUPERADMIN_PASSWORD_BCRYPT =
  '$2a$12$fGvhXXwhWGjnpMIVR3et1uBjQ9akeFMNqKw9B4OWVhjEBqC00vE.y';

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 3000),
  DATABASE_URL: req('DATABASE_URL'),
  SESSION_SECRET:
    process.env.NODE_ENV === 'production'
      ? req('SESSION_SECRET')
      : process.env.SESSION_SECRET || 'dev-only-change-me',
  TRUST_PROXY:
    process.env.TRUST_PROXY === '1' ||
    process.env.TRUST_PROXY === 'true' ||
    process.env.NODE_ENV === 'production',
  /** Comma-separated origins for credentialed CORS (optional; same-origin if empty) */
  CLIENT_ORIGINS: (process.env.CLIENT_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** Único correo permitido para el panel de administrador general (superadmin). */
  SUPERADMIN_EMAIL: (process.env.SUPERADMIN_EMAIL || 'e.gonzalez@talento24.com').trim().toLowerCase(),
  /** bcrypt del password del superadmin; por defecto corresponde a "mind24". */
  SUPERADMIN_PASSWORD_BCRYPT: process.env.SUPERADMIN_PASSWORD_HASH || DEFAULT_SUPERADMIN_PASSWORD_BCRYPT,
};

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

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 3000),
  DATABASE_URL: req('DATABASE_URL'),
  /** Required in all environments; set in `server/.env` or the host (e.g. Railway). */
  SESSION_SECRET: req('SESSION_SECRET'),
  /** Bootstrap `master_admin` only if both are set and password is non-empty after trim. */
  PLATFORM_ADMIN_EMAIL: (process.env.PLATFORM_ADMIN_EMAIL || '').trim(),
  PLATFORM_ADMIN_PASSWORD: process.env.PLATFORM_ADMIN_PASSWORD ?? '',
  /** Optional demo org + users at startup; all four must be non-empty to enable. */
  BOOTSTRAP_DEMO_ADMIN_EMAIL: (process.env.BOOTSTRAP_DEMO_ADMIN_EMAIL || '').trim(),
  BOOTSTRAP_DEMO_ADMIN_PASSWORD: process.env.BOOTSTRAP_DEMO_ADMIN_PASSWORD ?? '',
  BOOTSTRAP_DEMO_CANDIDATE_EMAIL: (process.env.BOOTSTRAP_DEMO_CANDIDATE_EMAIL || '').trim(),
  BOOTSTRAP_DEMO_CANDIDATE_PASSWORD: process.env.BOOTSTRAP_DEMO_CANDIDATE_PASSWORD ?? '',
  TRUST_PROXY:
    process.env.TRUST_PROXY === '1' ||
    process.env.TRUST_PROXY === 'true' ||
    process.env.NODE_ENV === 'production',
  /** Comma-separated origins for credentialed CORS (optional; same-origin if empty) */
  CLIENT_ORIGINS: (process.env.CLIENT_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

import crypto from 'crypto';

/** 32 bytes → base64url (43 chars typical). */
export const TIMECLOCK_TOKEN_RAW_BYTES = 32;

export function generateTimeclockAccessToken() {
  const token = crypto.randomBytes(TIMECLOCK_TOKEN_RAW_BYTES).toString('base64url');
  const hash = hashTimeclockToken(token);
  return { token, hash };
}

export function hashTimeclockToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isPlausibleTimeclockTokenFormat(token) {
  if (typeof token !== 'string') return false;
  const t = token.trim();
  if (t.length < 40 || t.length > 64) return false;
  return /^[A-Za-z0-9_-]+$/.test(t);
}

export function timingSafeEqualHex(aHex, bHex) {
  if (typeof aHex !== 'string' || typeof bHex !== 'string') return false;
  if (aHex.length !== bHex.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(aHex, 'hex'), Buffer.from(bHex, 'hex'));
  } catch {
    return false;
  }
}

const CHECADOR_PATH = '/checador';

function configError(message) {
  const err = new Error(message);
  err.code = 'CONFIG_ERROR';
  return err;
}

/** Origin + /checador, sin fragmento ni token. */
export function normalizeTimeclockPublicLinkBase(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/#.*$/, '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    const host = String(u.hostname || '').toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal)) return '';
    return `${u.protocol}//${u.host}${CHECADOR_PATH}`;
  } catch {
    return '';
  }
}

/**
 * Base pública para accessLink. No deriva el origin del request HTTP.
 * Preferencia: TIMECLOCK_PUBLIC_LINK_BASE → RAILWAY_PUBLIC_DOMAIN → localhost (no prod).
 */
export function resolveTimeclockPublicLinkBase(env = process.env) {
  const explicit = String(env.TIMECLOCK_PUBLIC_LINK_BASE || '').trim();
  if (explicit) {
    const n = normalizeTimeclockPublicLinkBase(explicit);
    if (!n) {
      throw configError(
        'TIMECLOCK_PUBLIC_LINK_BASE inválida. Usa un origin https, p. ej. https://mind24-production.up.railway.app/checador.',
      );
    }
    return n;
  }

  const railway = String(env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (railway) {
    const n = normalizeTimeclockPublicLinkBase(railway);
    if (n) return n;
  }

  if ((env.NODE_ENV || 'development') !== 'production') {
    const port = String(env.PORT || '3000').trim() || '3000';
    return `http://localhost:${port}${CHECADOR_PATH}`;
  }

  throw configError(
    'Falta TIMECLOCK_PUBLIC_LINK_BASE. Define el origin público del checador, p. ej. https://mind24-production.up.railway.app/checador.',
  );
}

export function buildTimeclockAccessLink(token, baseUrl) {
  const base = normalizeTimeclockPublicLinkBase(baseUrl);
  if (!base || !token) {
    throw configError('No se puede construir el enlace público del checador.');
  }
  return `${base}#${token}`;
}

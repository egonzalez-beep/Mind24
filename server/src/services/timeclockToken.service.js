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

export function buildTimeclockAccessLink(token, baseUrl) {
  const base = (baseUrl || 'https://mind24.mx/checador').replace(/#.*$/, '').replace(/\/$/, '');
  return `${base}#${token}`;
}

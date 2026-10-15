import session from 'express-session';
import pgSession from 'connect-pg-simple';
import { env } from '../config/env.js';
import {
  assertEmployeeEligibleForTimeclock,
  loadWorkforceEmployeeForSession,
} from '../services/workforceEmployee.service.js';

const PgStore = pgSession(session);

/** Cookie pública del checador: independiente de mind24.sid. Secure solo en production. */
export const TIMECLOCK_SESSION_COOKIE = {
  name: 'mind24.tc.sid',
  httpOnly: true,
  sameSite: 'lax',
  path: '/api/timeclock/public',
  maxAge: 24 * 60 * 60 * 1000,
};

export function createTimeclockSessionMiddleware() {
  return session({
    store: new PgStore({
      conString: env.DATABASE_URL,
      createTableIfMissing: false,
    }),
    name: TIMECLOCK_SESSION_COOKIE.name,
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: env.TRUST_PROXY,
    cookie: {
      httpOnly: TIMECLOCK_SESSION_COOKIE.httpOnly,
      secure: env.NODE_ENV === 'production',
      sameSite: TIMECLOCK_SESSION_COOKIE.sameSite,
      path: TIMECLOCK_SESSION_COOKIE.path,
      maxAge: TIMECLOCK_SESSION_COOKIE.maxAge,
    },
  });
}

export function regenerateTimeclockSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

export function establishTimeclockSession(req, employee) {
  req.session.employeeId = employee.id;
  req.session.organizationId = employee.organizationId;
  req.session.tokenVersion = employee.tokenVersion;
}

/** Cookie previa queda inválida si tokenVersion no coincide (regenerate-token). */
export function isTimeclockSessionCurrent(session, employee) {
  if (!session?.employeeId || session.tokenVersion == null || !employee) return false;
  return session.employeeId === employee.id && session.tokenVersion === employee.tokenVersion;
}

export async function requireTimeclockSession(req, res, next) {
  const employeeId = req.session?.employeeId;
  const tokenVersion = req.session?.tokenVersion;
  if (!employeeId || tokenVersion == null) {
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Se requiere sesión del checador.' });
  }
  try {
    const emp = await loadWorkforceEmployeeForSession(employeeId);
    if (!emp) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Sesión inválida.' });
    }
    if (!isTimeclockSessionCurrent(req.session, emp)) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Enlace o sesión expirada. Solicita uno nuevo.' });
    }
    try {
      assertEmployeeEligibleForTimeclock(emp);
    } catch (e) {
      req.session.destroy(() => {});
      return next(e);
    }
    req.timeclockEmployee = emp;
    next();
  } catch (e) {
    next(e);
  }
}

/** POST mutaciones con cookie: validar Origin cuando hay cabecera. */
export function requireTimeclockMutationOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) {
    return next();
  }
  const allowed = new Set(env.CLIENT_ORIGINS);
  const host = req.get('host');
  if (host) {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }
  if (env.CLIENT_ORIGINS.length && !allowed.has(origin)) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Origen no permitido.' });
  }
  next();
}

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { assertEmpresaAdmin } from '../services/candidate.service.js';
import {
  activateKioskClock,
  createKioskEmployee,
  getKioskClock,
  identifyKioskEmployee,
  KIOSK_PUNCH_TYPES,
  recordKioskPunch,
  updateKioskEmployee,
} from '../services/kioskClock.service.js';

const employeeCode = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/).transform((code) => code.toUpperCase());
const credentials = z.object({
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  punchKey: z.string().regex(/^[0-9]{6}$/),
});
const punch = credentials.extend({
  type: z.enum(KIOSK_PUNCH_TYPES),
  revision: z.number().int().min(0).max(2_147_483_646),
  requestId: z.string().uuid().transform((id) => id.toLowerCase()),
});
const employeeChange = z.union([
  z.object({ isActive: z.boolean() }).strict(),
  z.object({ renewKey: z.literal(true) }).strict(),
]);

export const kioskClockOrgRoutes = Router();
export const kioskClockPublicRoutes = Router();

kioskClockOrgRoutes.use(async (req, res, next) => {
  try {
    const admin = await assertEmpresaAdmin(req.session.userId);
    req.kioskOrganizationId = admin.organizationId;
    res.set('Cache-Control', 'no-store');
    next();
  } catch (error) {
    next(error);
  }
});

kioskClockOrgRoutes.get('/', async (req, res, next) => {
  try {
    res.json({ clock: await getKioskClock(req.kioskOrganizationId) });
  } catch (error) {
    next(error);
  }
});

kioskClockOrgRoutes.post('/activate', async (req, res, next) => {
  try {
    res.json({ clock: await activateKioskClock(req.kioskOrganizationId) });
  } catch (error) {
    next(error);
  }
});

kioskClockOrgRoutes.post('/employees', async (req, res, next) => {
  try {
    const body = z.object({ code: employeeCode, fullName: z.string().trim().min(2).max(160) }).parse(req.body);
    res.status(201).json(await createKioskEmployee(req.kioskOrganizationId, body));
  } catch (error) {
    next(error);
  }
});

kioskClockOrgRoutes.patch('/employees/:id', async (req, res, next) => {
  try {
    const body = employeeChange.parse(req.body);
    res.json(await updateKioskEmployee(req.kioskOrganizationId, req.params.id, body));
  } catch (error) {
    next(error);
  }
});

const limitMessage = { error: 'RATE_LIMIT', message: 'Demasiados intentos. Espera unos minutos.' };
kioskClockPublicRoutes.use(rateLimit({
  windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false, message: limitMessage,
}));
const failedAttemptOptions = {
  windowMs: 5 * 60_000,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  message: limitMessage,
};
const failedIpLimiter = rateLimit({ ...failedAttemptOptions, max: 12 });
const failedClockLimiter = rateLimit({
  ...failedAttemptOptions,
  max: 30,
  keyGenerator: (req) => req.kioskInput.publicKey,
});

function kioskPublicPost(path, schema, operation) {
  kioskClockPublicRoutes.post(path, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    req.kioskInput = schema.parse(req.body);
    next();
  }, failedIpLimiter, failedClockLimiter, async (req, res, next) => {
    try {
      res.json(await operation(req.kioskInput));
    } catch (error) {
      next(error);
    }
  });
}

kioskPublicPost('/identificar', credentials, identifyKioskEmployee);
kioskPublicPost('/marcar', punch, recordKioskPunch);

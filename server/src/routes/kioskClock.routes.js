import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { assertEmpresaAdmin } from '../services/candidate.service.js';
import {
  activateKioskClock,
  createKioskEmployee,
  getKioskClock,
  getKioskDailyAttendance,
  getPublicKioskContext,
  identifyKioskEmployee,
  recordKioskPunch,
  updateKioskEmployee,
  updateKioskEmployeeSchedule,
} from '../services/kioskClock.service.js';
import { exportKioskWeekPdf } from '../services/kioskClockReport.service.js';
import { saveKioskAttendanceAdjustment } from '../services/kioskAttendanceAdjustment.service.js';
import { KIOSK_INCIDENTS, KIOSK_PUNCH_TYPES } from '../utils/kioskAttendance.util.js';

const employeeCode = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/).transform((code) => code.toUpperCase());
const shiftHours = z.object({
  start: z.string().length(5),
  end: z.string().length(5),
}).strict();
const workSchedule = shiftHours.extend({
  toleranceMinutes: z.number().int(),
  weekdays: z.array(z.number().int()).max(7),
  weekendHours: z.object({ '6': shiftHours.optional(), '7': shiftHours.optional() }).strict().optional(),
}).strict();
const kioskLink = z.object({
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
});
const credentials = kioskLink.extend({
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
const adjustmentBase = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestId: z.string().uuid().transform((id) => id.toLowerCase()),
  reason: z.string().trim().min(3).max(500),
});
const punchTime = {
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  nextDay: z.boolean(),
};
const adjustment = z.discriminatedUnion('action', [
  adjustmentBase.extend({ action: z.literal('JUSTIFY'), incident: z.enum(KIOSK_INCIDENTS) }).strict(),
  adjustmentBase.extend({
    action: z.literal('EDIT_PUNCH'), ordinal: z.number().int().positive(),
    previousAt: z.string().datetime(), ...punchTime,
  }).strict(),
  adjustmentBase.extend({
    action: z.literal('ADD_PUNCH'),
    events: z.union([
      z.tuple([z.object({ type: z.enum(KIOSK_PUNCH_TYPES), ...punchTime }).strict()]),
      z.tuple([
        z.object({ type: z.literal('CHECK_IN'), ...punchTime }).strict(),
        z.object({ type: z.literal('CHECK_OUT'), ...punchTime }).strict(),
      ]),
    ]),
  }).strict(),
]);

export const kioskClockOrgRoutes = Router();
export const kioskClockPublicRoutes = Router();

kioskClockOrgRoutes.use(async (req, res, next) => {
  try {
    const admin = await assertEmpresaAdmin(req.session.userId);
    req.kioskAdmin = admin;
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

kioskClockOrgRoutes.get('/daily', async (req, res, next) => {
  try {
    const { date } = z.object({ date: z.string().length(10).optional() }).parse(req.query);
    res.json(await getKioskDailyAttendance(req.kioskOrganizationId, date));
  } catch (error) {
    next(error);
  }
});

kioskClockOrgRoutes.get('/weekly/export', async (req, res, next) => {
  try {
    const { week } = z.object({ week: z.string().length(10) }).parse(req.query);
    const { buffer, filename } = await exportKioskWeekPdf(req.kioskOrganizationId, week);
    res.type('pdf').attachment(filename).send(buffer);
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
    const body = z.object({ code: employeeCode, fullName: z.string().trim().min(2).max(160), workSchedule }).parse(req.body);
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

kioskClockOrgRoutes.patch('/employees/:id/schedule', async (req, res, next) => {
  try {
    const body = workSchedule.parse(req.body);
    res.json(await updateKioskEmployeeSchedule(req.kioskOrganizationId, req.params.id, body));
  } catch (error) {
    next(error);
  }
});

kioskClockOrgRoutes.post('/employees/:id/attendance-adjustments', async (req, res, next) => {
  try {
    res.json(await saveKioskAttendanceAdjustment(req.kioskAdmin, req.params.id, adjustment.parse(req.body)));
  } catch (error) {
    next(error);
  }
});

const limitMessage = { error: 'RATE_LIMIT', message: 'Demasiados intentos. Espera unos minutos.' };
kioskClockPublicRoutes.use(rateLimit({
  windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false, message: limitMessage,
}));
kioskClockPublicRoutes.post('/contexto', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json(await getPublicKioskContext(kioskLink.strict().parse(req.body)));
  } catch (error) {
    next(error);
  }
});

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

import { Router } from 'express';
import { z } from 'zod';
import {
  establishTimeclockSession,
  regenerateTimeclockSession,
  requireTimeclockMutationOrigin,
  requireTimeclockSession,
} from '../middleware/timeclockSession.middleware.js';
import {
  timeclockCheckInLimiter,
  timeclockExchangeLimiter,
  timeclockHeartbeatLimiter,
} from '../middleware/rateLimit.middleware.js';
import {
  hashTimeclockToken,
  isPlausibleTimeclockTokenFormat,
  timingSafeEqualHex,
} from '../services/timeclockToken.service.js';
import {
  assertEmployeeEligibleForTimeclock,
  findEmployeeByTokenForExchange,
} from '../services/workforceEmployee.service.js';
import {
  checkInRemoteWorkSession,
  checkOutRemoteWorkSession,
  getOpenSessionForEmployee,
  recordRemoteWorkHeartbeat,
  resolveShiftLifecycle,
  summarizeOpenSession,
} from '../services/remoteWorkSession.service.js';
import {
  resolveCurrentWebSignal,
  webSignalLabel,
} from '../services/timeclockWebSignal.service.js';
import {
  listWorkforceTasksForEmployee,
  patchWorkforceTaskAsEmployee,
  WORKFORCE_TASK_STATUSES,
} from '../services/workforceTask.service.js';
import { streamWorkforceProfilePhoto } from '../services/workforceAvatar.service.js';
import { notifyShiftCheckIn, notifyShiftCheckOut } from '../services/orgNotification.service.js';

const router = Router();

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

function sessionToPublicMe(emp, openSession) {
  const now = new Date();
  const webSignal = openSession ? resolveCurrentWebSignal(openSession, now) : 'no_signal';
  const hasProfilePhoto = !!emp.profilePhotoPath;
  const profilePhotoVersion =
    hasProfilePhoto && emp.updatedAt ? new Date(emp.updatedAt).getTime() : null;
  return {
    fullName: emp.fullName,
    position: emp.position,
    department: emp.department,
    timezone: emp.timezone,
    shiftLifecycle: resolveShiftLifecycle(openSession),
    webSignal,
    webSignalLabel: webSignalLabel(webSignal),
    openSession: summarizeOpenSession(openSession, now),
    hasProfilePhoto,
    profilePhotoVersion,
    serverTime: now.toISOString(),
  };
}

router.post('/exchange', timeclockExchangeLimiter, async (req, res, next) => {
  try {
    const { token } = z.object({ token: z.string().min(1).max(128) }).parse(req.body);
    if (!isPlausibleTimeclockTokenFormat(token)) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Enlace inválido.' });
    }
    const emp = await findEmployeeByTokenForExchange(token.trim());
    if (!emp) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Enlace inválido.' });
    }
    const hash = hashTimeclockToken(token.trim());
    if (!timingSafeEqualHex(emp.accessTokenHash, hash)) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Enlace inválido.' });
    }
    assertEmployeeEligibleForTimeclock(emp);
    // Rota el sid antes de persistir identidad (no reutilizar sesión anónima previa).
    await regenerateTimeclockSession(req);
    establishTimeclockSession(req, emp);
    await saveSession(req);
    res.json({
      fullName: emp.fullName,
      position: emp.position,
      timezone: emp.timezone,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/me', requireTimeclockSession, async (req, res, next) => {
  try {
    const open = await getOpenSessionForEmployee(req.timeclockEmployee.id);
    res.json(sessionToPublicMe(req.timeclockEmployee, open));
  } catch (e) {
    next(e);
  }
});

router.get('/photo', requireTimeclockSession, async (req, res, next) => {
  try {
    const emp = req.timeclockEmployee;
    await streamWorkforceProfilePhoto(req, res, emp, emp.organizationId);
  } catch (e) {
    if (e?.code === 'ENOENT') {
      res.status(404).json({ error: 'Archivo de foto no encontrado.' });
      return;
    }
    next(e);
  }
});

router.post(
  '/check-in',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  timeclockCheckInLimiter,
  async (req, res, next) => {
    try {
      const ua = req.get('user-agent');
      const { session, created } = await checkInRemoteWorkSession({
        employeeId: req.timeclockEmployee.id,
        userAgent: ua,
        clientMetadata: req.body?.metadata ?? null,
      });
      if (created) {
        await notifyShiftCheckIn(req.timeclockEmployee, session.id);
      }
      res.status(created ? 201 : 200).json({
        session: {
          id: session.id,
          checkInAt: session.checkInAt,
          checkOutAt: session.checkOutAt,
          status: session.status,
        },
        created,
        serverTime: new Date().toISOString(),
      });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/check-out',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  timeclockCheckInLimiter,
  async (req, res, next) => {
    try {
      const { session, alreadyClosed } = await checkOutRemoteWorkSession(req.timeclockEmployee.id);
      if (!alreadyClosed) {
        await notifyShiftCheckOut(req.timeclockEmployee, session.id);
      }
      res.status(200).json({
        session: {
          id: session.id,
          checkInAt: session.checkInAt,
          checkOutAt: session.checkOutAt,
          status: session.status,
        },
        alreadyClosed,
        serverTime: new Date().toISOString(),
      });
    } catch (e) {
      next(e);
    }
  },
);

router.get('/tasks', requireTimeclockSession, async (req, res, next) => {
  try {
    const tasks = await listWorkforceTasksForEmployee(req.timeclockEmployee.id);
    res.json({ tasks });
  } catch (e) {
    next(e);
  }
});

router.patch(
  '/tasks/:taskId',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  async (req, res, next) => {
    try {
      const body = z
        .object({
          status: z.enum(WORKFORCE_TASK_STATUSES),
          expectedUpdatedAt: z.string().datetime().optional(),
        })
        .parse(req.body);
      const task = await patchWorkforceTaskAsEmployee({
        employeeId: req.timeclockEmployee.id,
        taskId: req.params.taskId,
        status: body.status,
        expectedUpdatedAt: body.expectedUpdatedAt,
      });
      res.json({ task });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/heartbeat',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  timeclockHeartbeatLimiter,
  async (req, res, next) => {
    try {
      const body = z
        .object({
          visibilityState: z.enum(['visible', 'hidden']),
          metadata: z.record(z.unknown()).optional(),
        })
        .parse(req.body ?? {});
      const result = await recordRemoteWorkHeartbeat({
        employeeId: req.timeclockEmployee.id,
        visibilityState: body.visibilityState,
        clientMetadata: body.metadata ?? null,
      });
      if (result.noop) {
        return res.status(200).json({ ok: true, noop: true, serverTime: new Date().toISOString() });
      }
      const webSignal = resolveCurrentWebSignal(result.session, new Date());
      res.json({
        ok: true,
        lastHeartbeatAt: result.session.lastHeartbeatAt,
        webSignal,
        webSignalLabel: webSignalLabel(webSignal),
        serverTime: new Date().toISOString(),
      });
    } catch (e) {
      next(e);
    }
  },
);

export default router;

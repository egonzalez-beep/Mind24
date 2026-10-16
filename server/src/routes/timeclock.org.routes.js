import { Router } from 'express';
import { z } from 'zod';
import { assertEmpresaAdmin } from '../services/candidate.service.js';
import {
  adminCloseRemoteWorkSession,
} from '../services/remoteWorkSession.service.js';
import { listEmployeeSessionsHistory } from '../services/remoteWorkSessionHistory.service.js';
import {
  createWorkforceEmployee,
  getWorkforceEmployeeForOrg,
  listWorkforceEmployees,
  regenerateWorkforceEmployeeToken,
  updateWorkforceEmployee,
} from '../services/workforceEmployee.service.js';

const router = Router();

router.post('/employees', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const body = z
      .object({
        fullName: z.string().min(2).max(200),
        employeeCode: z.string().max(64).optional().nullable(),
        position: z.string().max(200).optional().nullable(),
        department: z.string().max(200).optional().nullable(),
        timezone: z.string().min(1).max(64),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);
    const out = await createWorkforceEmployee(u.organizationId, body);
    res.status(201).json(out);
  } catch (e) {
    next(e);
  }
});

router.get('/employees', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const employees = await listWorkforceEmployees(u.organizationId);
    res.json({ employees });
  } catch (e) {
    next(e);
  }
});

router.get('/employees/:id', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const out = await getWorkforceEmployeeForOrg(u.organizationId, req.params.id);
    res.json(out);
  } catch (e) {
    next(e);
  }
});

router.get('/employees/:id/sessions', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const { from, to } = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(req.query);
    const out = await listEmployeeSessionsHistory({
      organizationId: u.organizationId,
      employeeId: req.params.id,
      fromKey: from,
      toKey: to,
    });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

router.patch('/employees/:id', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const body = z
      .object({
        fullName: z.string().min(2).max(200).optional(),
        employeeCode: z.string().max(64).optional().nullable(),
        position: z.string().max(200).optional().nullable(),
        department: z.string().max(200).optional().nullable(),
        timezone: z.string().min(1).max(64).optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);
    const employee = await updateWorkforceEmployee(u.organizationId, req.params.id, body);
    res.json({ employee });
  } catch (e) {
    next(e);
  }
});

router.post('/employees/:id/regenerate-token', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const out = await regenerateWorkforceEmployeeToken(u.organizationId, req.params.id);
    res.json(out);
  } catch (e) {
    next(e);
  }
});

router.post('/sessions/:id/admin-close', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const { closeReason } = z
      .object({ closeReason: z.string().min(3).max(2000) })
      .parse(req.body);
    const out = await adminCloseRemoteWorkSession({
      organizationId: u.organizationId,
      sessionId: req.params.id,
      closedByUserId: u.id,
      closeReason,
    });
    res.status(200).json({
      session: {
        id: out.session.id,
        checkInAt: out.session.checkInAt,
        checkOutAt: out.session.checkOutAt,
        status: out.session.status,
        closeReason: out.session.closeReason,
      },
      alreadyClosed: out.alreadyClosed,
    });
  } catch (e) {
    next(e);
  }
});

export default router;

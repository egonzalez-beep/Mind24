import { Router } from 'express';
import { z } from 'zod';
import { assertEmpresaAdmin } from '../services/candidate.service.js';
import {
  adminCloseRemoteWorkSession,
} from '../services/remoteWorkSession.service.js';
import { listEmployeeSessionsHistory } from '../services/remoteWorkSessionHistory.service.js';
import {
  assertWorkforceEmployeeInOrg,
  createWorkforceEmployee,
  getWorkforceEmployeeForOrg,
  listWorkforceEmployees,
  regenerateWorkforceEmployeeToken,
  updateWorkforceEmployee,
} from '../services/workforceEmployee.service.js';
import { resolveWorkforceTaskDueAtFromInput } from '../utils/workforceDueDate.js';
import {
  assertWorkforceTaskInOrg,
  createWorkforceTaskForEmployee,
  listWorkforceTasksForAdmin,
  patchWorkforceTaskAsAdmin,
  WORKFORCE_TASK_STATUSES,
} from '../services/workforceTask.service.js';
import { getTeamPulseForOrganization } from '../services/teamPulse.service.js';

const router = Router();

router.get('/team-pulse', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const pulse = await getTeamPulseForOrganization(u.organizationId);
    res.json({ pulse });
  } catch (e) {
    next(e);
  }
});

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

const taskStatusSchema = z.enum(WORKFORCE_TASK_STATUSES);

router.post('/employees/:id/tasks', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const body = z
      .object({
        title: z.string().min(1).max(200),
        description: z.string().max(4000).optional().nullable(),
        dueAt: z.string().datetime().optional().nullable(),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .nullable(),
      })
      .parse(req.body);
    const emp = await assertWorkforceEmployeeInOrg(req.params.id, u.organizationId);
    const dueResolved = resolveWorkforceTaskDueAtFromInput({
      dueDate: body.dueDate,
      dueAtIso: body.dueAt,
      timezone: emp.timezone,
    });
    const dueAt = dueResolved === undefined ? null : dueResolved;
    const task = await createWorkforceTaskForEmployee({
      organizationId: u.organizationId,
      employeeId: req.params.id,
      createdByUserId: u.id,
      title: body.title,
      description: body.description,
      dueAt,
    });
    res.status(201).json({ task });
  } catch (e) {
    next(e);
  }
});

router.get('/employees/:id/tasks', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const q = z
      .object({
        status: taskStatusSchema.optional(),
      })
      .parse(req.query);
    const tasks = await listWorkforceTasksForAdmin({
      organizationId: u.organizationId,
      employeeId: req.params.id,
      status: q.status,
    });
    res.json({ tasks });
  } catch (e) {
    next(e);
  }
});

router.patch('/tasks/:taskId', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const body = z
      .object({
        status: taskStatusSchema.optional(),
        position: z.number().int().optional(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(4000).optional().nullable(),
        dueAt: z.string().datetime().optional().nullable(),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .nullable(),
        archive: z.boolean().optional(),
        expectedUpdatedAt: z.string().datetime().optional(),
      })
      .parse(req.body);
    let dueAt;
    if (body.dueDate !== undefined || body.dueAt !== undefined) {
      const existing = await assertWorkforceTaskInOrg(req.params.taskId, u.organizationId);
      const emp = await assertWorkforceEmployeeInOrg(existing.employeeId, u.organizationId);
      if (body.dueDate === null && body.dueAt === null) {
        dueAt = null;
      } else {
        const dueResolved = resolveWorkforceTaskDueAtFromInput({
          dueDate: body.dueDate,
          dueAtIso: body.dueAt,
          timezone: emp.timezone,
        });
        dueAt = dueResolved === undefined ? null : dueResolved;
      }
    }
    const task = await patchWorkforceTaskAsAdmin({
      organizationId: u.organizationId,
      taskId: req.params.taskId,
      actorUserId: u.id,
      status: body.status,
      position: body.position,
      title: body.title,
      description: body.description,
      dueAt,
      archive: body.archive,
      expectedUpdatedAt: body.expectedUpdatedAt,
    });
    res.json({ task });
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

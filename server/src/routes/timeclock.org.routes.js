import { Router } from 'express';
import multer from 'multer';
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
  sanitizeEmployeeForAdmin,
  updateWorkforceEmployee,
} from '../services/workforceEmployee.service.js';
import {
  clearWorkforceEmployeeProfilePhoto,
  isAllowedWorkforceAvatarFile,
  saveWorkforceEmployeeProfilePhoto,
  streamWorkforceProfilePhoto,
  WORKFORCE_AVATAR_MAX_BYTES,
} from '../services/workforceAvatar.service.js';
import { resolveWorkforceTaskDueAtFromInput } from '../utils/workforceDueDate.js';
import {
  assertWorkforceTaskInOrg,
  createWorkforceTaskForEmployee,
  listWorkforceTasksForAdmin,
  patchWorkforceTaskAsAdmin,
  WORKFORCE_TASK_STATUSES,
} from '../services/workforceTask.service.js';
import {
  archiveWorkforceGoal,
  createWorkforceGoalForEmployee,
  listWorkforceGoalPeriodsForAdmin,
  listWorkforceGoalsForAdmin,
  WORKFORCE_GOAL_PERIODICITIES,
  WORKFORCE_GOAL_TYPES,
} from '../services/workforceGoal.service.js';
import {
  getWorkforceGoalMetricsForAdmin,
  getWorkforceGoalMetricsTrendForAdmin,
} from '../services/workforceGoalMetrics.service.js';
import { getTeamPulseForOrganization } from '../services/teamPulse.service.js';
import {
  createWorkforceDocument,
  deleteWorkforceDocument,
  isAllowedWorkforceDocumentFile,
  listWorkforceDocumentsForEmployee,
  streamWorkforceDocumentFile,
  WORKFORCE_DOCUMENT_CATEGORIES,
  WORKFORCE_DOCUMENT_MAX_BYTES,
  assertWorkforceDocumentInOrg,
} from '../services/workforceDocument.service.js';

const router = Router();

const workforceAvatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: WORKFORCE_AVATAR_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    cb(
      isAllowedWorkforceAvatarFile(file.mimetype, file.originalname)
        ? null
        : new Error('INVALID_AVATAR_FILE'),
      isAllowedWorkforceAvatarFile(file.mimetype, file.originalname),
    );
  },
});

const workforceDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: WORKFORCE_DOCUMENT_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    cb(
      isAllowedWorkforceDocumentFile(file.mimetype, file.originalname)
        ? null
        : new Error('INVALID_DOCUMENT_FILE'),
      isAllowedWorkforceDocumentFile(file.mimetype, file.originalname),
    );
  },
});

const workforceDocumentCategorySchema = z.enum(WORKFORCE_DOCUMENT_CATEGORIES);

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
        expectedWorkMinutes: z.number().int().min(0).max(960).nullable().optional(),
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

router.get('/employees/:id/photo', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const emp = await assertWorkforceEmployeeInOrg(req.params.id, u.organizationId);
    await streamWorkforceProfilePhoto(req, res, emp, u.organizationId);
  } catch (e) {
    if (e?.code === 'ENOENT') {
      res.status(404).json({ error: 'Archivo de foto no encontrado.' });
      return;
    }
    next(e);
  }
});

router.post('/employees/:id/photo', workforceAvatarUpload.single('photo'), async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    if (!req.file?.buffer?.length) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Selecciona una imagen JPG, PNG o WEBP.';
      throw err;
    }
    const updated = await saveWorkforceEmployeeProfilePhoto({
      organizationId: u.organizationId,
      employeeId: req.params.id,
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalName: req.file.originalname,
    });
    res.json({ employee: sanitizeEmployeeForAdmin(updated) });
  } catch (e) {
    next(e);
  }
});

router.delete('/employees/:id/photo', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const updated = await clearWorkforceEmployeeProfilePhoto(u.organizationId, req.params.id);
    res.json({ employee: sanitizeEmployeeForAdmin(updated) });
  } catch (e) {
    next(e);
  }
});

router.get('/employees/:id/documents', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const documents = await listWorkforceDocumentsForEmployee(u.organizationId, req.params.id);
    res.json({ documents });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/employees/:id/documents',
  workforceDocumentUpload.single('file'),
  async (req, res, next) => {
    try {
      const u = await assertEmpresaAdmin(req.session.userId);
      if (!req.file?.buffer?.length) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        err.message = 'Selecciona un archivo PDF o imagen.';
        throw err;
      }
      const fields = z
        .object({
          displayName: z.string().min(1).max(200),
          category: workforceDocumentCategorySchema.default('OTRO'),
        })
        .parse({
          displayName: req.body?.displayName ?? req.body?.name,
          category: req.body?.category ?? 'OTRO',
        });
      const document = await createWorkforceDocument({
        organizationId: u.organizationId,
        employeeId: req.params.id,
        uploadedByUserId: u.id,
        displayName: fields.displayName,
        category: fields.category,
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        originalName: req.file.originalname,
      });
      res.status(201).json({ document });
    } catch (e) {
      next(e);
    }
  },
);

router.get('/documents/:documentId/file', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const doc = await assertWorkforceDocumentInOrg(req.params.documentId, u.organizationId);
    await streamWorkforceDocumentFile(req, res, doc, u.organizationId);
  } catch (e) {
    if (e?.code === 'ENOENT') {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Archivo no encontrado.' });
      return;
    }
    next(e);
  }
});

router.delete('/documents/:documentId', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    await deleteWorkforceDocument(u.organizationId, req.params.documentId);
    res.json({ ok: true });
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
        expectedWorkMinutes: z.number().int().min(0).max(960).nullable().optional(),
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

const goalTypeSchema = z.enum(WORKFORCE_GOAL_TYPES);
const goalPeriodicitySchema = z.enum(WORKFORCE_GOAL_PERIODICITIES);
const goalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

router.post('/employees/:id/goals', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const body = z
      .object({
        title: z.string().min(1).max(200),
        description: z.string().max(4000).optional().nullable(),
        goalType: goalTypeSchema,
        periodicity: goalPeriodicitySchema,
        targetValue: z.number().finite().optional().nullable(),
        unit: z.string().max(64).optional().nullable(),
        startDate: goalDateSchema,
        endDate: goalDateSchema.optional().nullable(),
      })
      .parse(req.body);
    await assertWorkforceEmployeeInOrg(req.params.id, u.organizationId);
    const goal = await createWorkforceGoalForEmployee({
      organizationId: u.organizationId,
      employeeId: req.params.id,
      createdByUserId: u.id,
      title: body.title,
      description: body.description,
      goalType: body.goalType,
      periodicity: body.periodicity,
      targetValue: body.targetValue,
      unit: body.unit,
      startDate: body.startDate,
      endDate: body.endDate ?? null,
    });
    res.status(201).json({ goal });
  } catch (e) {
    next(e);
  }
});

router.get('/employees/:id/goals/metrics', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const { month } = z.object({ month: z.string().min(1).max(7) }).parse(req.query);
    const metrics = await getWorkforceGoalMetricsForAdmin({
      organizationId: u.organizationId,
      employeeId: req.params.id,
      month,
    });
    res.json(metrics);
  } catch (e) {
    next(e);
  }
});

router.get('/employees/:id/goals/metrics/trend', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const { view, anchor, goalId } = z
      .object({
        view: z.enum(['weekly', 'monthly']),
        anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        goalId: z.string().min(1).max(128),
      })
      .parse(req.query);
    const trend = await getWorkforceGoalMetricsTrendForAdmin({
      organizationId: u.organizationId,
      employeeId: req.params.id,
      view,
      anchor,
      goalId,
    });
    res.json(trend);
  } catch (e) {
    next(e);
  }
});

router.get('/employees/:id/goals', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const goals = await listWorkforceGoalsForAdmin({
      organizationId: u.organizationId,
      employeeId: req.params.id,
    });
    res.json({ goals });
  } catch (e) {
    next(e);
  }
});

router.get('/goals/:goalId/periods', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const out = await listWorkforceGoalPeriodsForAdmin({
      organizationId: u.organizationId,
      goalId: req.params.goalId,
    });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

router.post('/goals/:goalId/archive', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const goal = await archiveWorkforceGoal({
      organizationId: u.organizationId,
      goalId: req.params.goalId,
    });
    res.json({ goal });
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

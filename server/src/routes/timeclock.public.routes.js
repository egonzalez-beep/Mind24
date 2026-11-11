import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  establishTimeclockSession,
  regenerateTimeclockSession,
  requireTimeclockMutationOrigin,
  requireTimeclockSession,
} from '../middleware/timeclockSession.middleware.js';
import {
  recruitmentPortalResumeParseLimiter,
  timeclockCheckInLimiter,
  timeclockExchangeLimiter,
  timeclockHeartbeatLimiter,
  timeclockPersonaLimiter,
} from '../middleware/rateLimit.middleware.js';
import {
  hashTimeclockToken,
  isPlausibleTimeclockTokenFormat,
  timingSafeEqualHex,
} from '../services/timeclockToken.service.js';
import {
  assertEmployeeEligibleForTimeclock,
  assertEmployeeAttendanceEligible,
  employeeAttendanceEnabled,
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
import { submitWorkLogForOpenSession } from '../services/remoteWorkSessionWorkLog.service.js';
import {
  resolveCurrentWebSignal,
  webSignalLabel,
} from '../services/timeclockWebSignal.service.js';
import {
  listWorkforceTasksForEmployee,
  patchWorkforceTaskAsEmployee,
  WORKFORCE_TASK_STATUSES,
} from '../services/workforceTask.service.js';
import {
  clearWorkforceEmployeeProfilePhoto,
  createWorkforceAvatarUpload,
  publicProfilePhotoDto,
  saveWorkforceEmployeeProfilePhoto,
  streamWorkforceProfilePhoto,
} from '../services/workforceAvatar.service.js';
import {
  clearWorkforcePersonalStatus,
  personalStatusBodySchema,
  publicPersonalStatusDto,
  saveWorkforcePersonalStatus,
} from '../services/workforcePersonalStatus.service.js';
import { notifyShiftCheckIn, notifyShiftCheckOut } from '../services/orgNotification.service.js';
import {
  analyzeRecruitmentResumeUpload,
  recruitmentResumeParseUploadFailure,
} from '../services/recruitmentCandidateResumeParse.service.js';
import {
  countUnreadCollaboratorNovedades,
  listCollaboratorNovedadesFeed,
  markAllCollaboratorNovedadesRead,
} from '../services/workforceCollaboratorNovedadesFeed.service.js';
import { markWorkplaceInboxItemRead } from '../services/workforceWorkplaceInbox.service.js';
import {
  listWorkforceGoalPeriodsForEmployee,
  listWorkforceGoalsForEmployee,
  reportWorkforceGoalPeriod,
  WORKFORCE_GOAL_BINARY_RESULTS,
} from '../services/workforceGoal.service.js';
import {
  RECRUITMENT_CANDIDATE_RESUME_MAX_BYTES,
  isAllowedRecruitmentCandidateResumeFile,
  uploadRecruitmentCandidateResume,
} from '../services/recruitmentCandidateResume.service.js';
import {
  assertRecruitmentCandidateInOrg,
  assertRecruitmentCandidateRegisteredByWorkforceEmployee,
} from '../services/recruitmentCandidate.service.js';
import {
  createRecruitmentCandidateFromWorkforcePortal,
  findDuplicateCandidatesForWorkforcePortal,
  getEnabledVacancyStagesForWorkforcePortal,
  listActiveVacanciesForWorkforcePortal,
  listMyCandidatesForWorkforcePortal,
  workforceCandidateCreateSchema,
} from '../services/workforceRecruitmentPortal.service.js';

const router = Router();
const workforceAvatarUpload = createWorkforceAvatarUpload();

const workforceCandidateResumeFileFilter = (_req, file, cb) => {
  cb(
    isAllowedRecruitmentCandidateResumeFile(file.mimetype, file.originalname)
      ? null
      : new Error('INVALID_DOCUMENT_FILE'),
    isAllowedRecruitmentCandidateResumeFile(file.mimetype, file.originalname),
  );
};

const workforceCandidateResumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RECRUITMENT_CANDIDATE_RESUME_MAX_BYTES },
  fileFilter: workforceCandidateResumeFileFilter,
});

const workforceCandidateResumeParseUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RECRUITMENT_CANDIDATE_RESUME_MAX_BYTES, files: 1 },
  fileFilter: workforceCandidateResumeFileFilter,
});

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

function sessionToPublicMe(emp, openSession) {
  const now = new Date();
  const webSignal = openSession ? resolveCurrentWebSignal(openSession, now) : 'no_signal';
  return {
    employeeId: emp.id,
    organizationId: emp.organizationId,
    fullName: emp.fullName,
    position: emp.position,
    department: emp.department,
    timezone: emp.timezone,
    shiftLifecycle: resolveShiftLifecycle(openSession),
    webSignal,
    webSignalLabel: webSignalLabel(webSignal),
    openSession: summarizeOpenSession(openSession, now),
    attendanceEnabled: employeeAttendanceEnabled(emp),
    expectedWorkMinutes: employeeAttendanceEnabled(emp) ? emp.expectedWorkMinutes : null,
    ...publicProfilePhotoDto(emp),
    ...publicPersonalStatusDto(emp),
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
  '/photo',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  timeclockPersonaLimiter,
  workforceAvatarUpload.single('photo'),
  async (req, res, next) => {
    try {
      const emp = req.timeclockEmployee;
      if (!req.file?.buffer?.length) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        err.message = 'Selecciona una imagen JPG, PNG o WEBP.';
        throw err;
      }
      const updated = await saveWorkforceEmployeeProfilePhoto({
        organizationId: emp.organizationId,
        employeeId: emp.id,
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        originalName: req.file.originalname,
      });
      res.json(publicProfilePhotoDto(updated));
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/photo',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  timeclockPersonaLimiter,
  async (req, res, next) => {
    try {
      const emp = req.timeclockEmployee;
      if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        err.message = 'La solicitud no admite campos.';
        throw err;
      }
      const updated = await clearWorkforceEmployeeProfilePhoto(emp.organizationId, emp.id);
      res.json(publicProfilePhotoDto(updated));
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  '/status',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  timeclockPersonaLimiter,
  async (req, res, next) => {
    try {
      const emp = req.timeclockEmployee;
      const body = personalStatusBodySchema.parse(req.body);
      const updated = await saveWorkforcePersonalStatus({
        employeeId: emp.id,
        organizationId: emp.organizationId,
        message: body.message,
      });
      res.json(publicPersonalStatusDto(updated));
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/status',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  timeclockPersonaLimiter,
  async (req, res, next) => {
    try {
      const emp = req.timeclockEmployee;
      if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        err.message = 'La solicitud no admite campos.';
        throw err;
      }
      const updated = await clearWorkforcePersonalStatus({
        employeeId: emp.id,
        organizationId: emp.organizationId,
      });
      res.json(publicPersonalStatusDto(updated));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/check-in',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  timeclockCheckInLimiter,
  async (req, res, next) => {
    try {
      assertEmployeeAttendanceEligible(req.timeclockEmployee);
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
  '/session/work-log',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  timeclockCheckInLimiter,
  async (req, res, next) => {
    try {
      const body = z.object({ text: z.string() }).strict().parse(req.body ?? {});
      const { workLog } = await submitWorkLogForOpenSession({
        employeeId: req.timeclockEmployee.id,
        text: body.text,
      });
      res.status(201).json({
        workLog,
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

router.get('/recruitment/meta', requireTimeclockSession, async (req, res, next) => {
  try {
    const orgId = req.timeclockEmployee.organizationId;
    const { resolveOrganizationIanaTimezone } = await import(
      '../services/organizationTimezone.service.js'
    );
    const timeZone = await resolveOrganizationIanaTimezone(orgId);
    res.json({ timeZone });
  } catch (e) {
    next(e);
  }
});

router.get('/recruitment/vacancies', requireTimeclockSession, async (req, res, next) => {
  try {
    const orgId = req.timeclockEmployee.organizationId;
    const vacancies = await listActiveVacanciesForWorkforcePortal(orgId);
    res.json({ vacancies });
  } catch (e) {
    next(e);
  }
});

router.get('/recruitment/vacancies/:vacancyId/stages', requireTimeclockSession, async (req, res, next) => {
  try {
    const orgId = req.timeclockEmployee.organizationId;
    const config = await getEnabledVacancyStagesForWorkforcePortal(orgId, req.params.vacancyId);
    res.json(config);
  } catch (e) {
    next(e);
  }
});

router.post('/recruitment/candidates/check-duplicates', requireTimeclockSession, async (req, res, next) => {
  try {
    const orgId = req.timeclockEmployee.organizationId;
    const body = z
      .object({
        email: z.union([z.string().email(), z.literal(''), z.null()]).optional(),
        phone: z.union([z.string().max(40), z.literal(''), z.null()]).optional(),
        curp: z.union([z.string().max(40), z.literal(''), z.null()]).optional(),
      })
      .parse(req.body ?? {});
    const email = body.email && String(body.email).trim() ? body.email : undefined;
    const phone = body.phone && String(body.phone).trim() ? body.phone : undefined;
    const curp = body.curp && String(body.curp).trim() ? body.curp : undefined;
    if (!email && !phone && !curp) {
      res.json({ candidates: [], curpConflict: false });
      return;
    }
    const candidates = await findDuplicateCandidatesForWorkforcePortal(orgId, { email, phone, curp });
    res.json({
      curpConflict: candidates.curpConflict === true,
      candidates: candidates.map((c) => ({
        id: c.id,
        fullName: c.fullName,
        profile: c.profile,
        phone: c.phone,
        whatsapp: c.whatsapp,
        email: c.email,
        archivedAt: c.archivedAt,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/recruitment/candidates/resume/parse',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  recruitmentPortalResumeParseLimiter,
  (req, res, next) => {
    workforceCandidateResumeParseUpload.single('file')(req, res, (err) => {
      if (!err) return next();
      const mapped = recruitmentResumeParseUploadFailure(err);
      return res.status(mapped.status).json(mapped.body);
    });
  },
  async (req, res, next) => {
    try {
      if (!req.file?.buffer?.length) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        err.message = 'Selecciona un CV para analizar.';
        throw err;
      }
      const result = await analyzeRecruitmentResumeUpload({
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        originalName: req.file.originalname,
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  },
);

router.get('/recruitment/my-candidates', requireTimeclockSession, async (req, res, next) => {
  try {
    const orgId = req.timeclockEmployee.organizationId;
    const employeeId = req.timeclockEmployee.id;
    let previewFilter = typeof req.query.previewFilter === 'string' ? req.query.previewFilter.trim() : 'all';
    if (!['all', 'in_process', 'hired', 'rejected', 'declined'].includes(previewFilter)) {
      previewFilter = 'all';
    }
    const result = await listMyCandidatesForWorkforcePortal(orgId, employeeId, {
      previewFilter,
      limit: req.query.limit,
      cursor: req.query.cursor,
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/recruitment/candidates',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  timeclockCheckInLimiter,
  async (req, res, next) => {
    try {
      const orgId = req.timeclockEmployee.organizationId;
      const body = workforceCandidateCreateSchema.parse(req.body);
      const result = await createRecruitmentCandidateFromWorkforcePortal({
        organizationId: orgId,
        workforceEmployeeId: req.timeclockEmployee.id,
        body,
      });
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/recruitment/candidates/:candidateId/resume',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  timeclockCheckInLimiter,
  workforceCandidateResumeUpload.single('file'),
  async (req, res, next) => {
    try {
      const orgId = req.timeclockEmployee.organizationId;
      const employeeId = req.timeclockEmployee.id;
      const candidateId = req.params.candidateId;
      await assertRecruitmentCandidateRegisteredByWorkforceEmployee(
        candidateId,
        orgId,
        employeeId,
      );
      if (!req.file?.buffer?.length) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        err.message = 'Selecciona un CV admitido (PDF, DOC, DOCX o imagen).';
        throw err;
      }
      const resume = await uploadRecruitmentCandidateResume({
        organizationId: orgId,
        candidateId,
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        originalName: req.file.originalname,
        uploadedByWorkforceEmployeeId: employeeId,
      });
      res.status(201).json({ resume });
    } catch (e) {
      next(e);
    }
  },
);

router.get('/goals', requireTimeclockSession, async (req, res, next) => {
  try {
    const items = await listWorkforceGoalsForEmployee(req.timeclockEmployee);
    res.json({ goals: items });
  } catch (e) {
    next(e);
  }
});

router.get('/goals/:goalId/periods', requireTimeclockSession, async (req, res, next) => {
  try {
    const out = await listWorkforceGoalPeriodsForEmployee({
      employee: req.timeclockEmployee,
      goalId: req.params.goalId,
    });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/goals/periods/:periodId/report',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  async (req, res, next) => {
    try {
      const body = z
        .object({
          binaryResult: z.enum(WORKFORCE_GOAL_BINARY_RESULTS).optional(),
          achievedValue: z.number().finite().optional(),
          employeeComment: z.string().max(2000).optional().nullable(),
        })
        .parse(req.body ?? {});
      const period = await reportWorkforceGoalPeriod({
        employee: req.timeclockEmployee,
        periodId: req.params.periodId,
        binaryResult: body.binaryResult,
        achievedValue: body.achievedValue,
        employeeComment: body.employeeComment,
      });
      res.json({ period });
    } catch (e) {
      next(e);
    }
  },
);

router.get('/novedades', requireTimeclockSession, async (req, res, next) => {
  try {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(30).optional(),
        cursor: z.string().optional(),
      })
      .parse(req.query ?? {});
    const emp = req.timeclockEmployee;
    const result = await listCollaboratorNovedadesFeed({
      organizationId: emp.organizationId,
      recipientWorkforceEmployeeId: emp.id,
      limit: query.limit,
      cursor: query.cursor,
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/novedades/unread-count', requireTimeclockSession, async (req, res, next) => {
  try {
    const emp = req.timeclockEmployee;
    const unreadCount = await countUnreadCollaboratorNovedades(emp.organizationId, emp.id);
    res.json({ unreadCount });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/novedades/workplace/:id/read',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  async (req, res, next) => {
    try {
      const emp = req.timeclockEmployee;
      const result = await markWorkplaceInboxItemRead(emp.organizationId, emp.id, req.params.id);
      res.json(result);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/novedades/read-all',
  requireTimeclockSession,
  requireTimeclockMutationOrigin,
  async (req, res, next) => {
    try {
      const emp = req.timeclockEmployee;
      const result = await markAllCollaboratorNovedadesRead(emp.organizationId, emp.id);
      res.json(result);
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

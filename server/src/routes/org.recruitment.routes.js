import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { assertEmpresaAdmin } from '../services/candidate.service.js';
import {
  createRecruitmentCandidate,
  findPotentialDuplicateRecruitmentCandidates,
  getRecruitmentCandidate,
  listRecruitmentCandidates,
  updateRecruitmentCandidate,
} from '../services/recruitmentCandidate.service.js';
import {
  RECRUITMENT_CANDIDATE_RESUME_MAX_BYTES,
  assertRecruitmentCandidateResumeInOrg,
  deleteRecruitmentCandidateResume,
  getRecruitmentCandidateResume,
  isAllowedRecruitmentCandidateResumeFile,
  streamRecruitmentCandidateResumeFile,
  uploadRecruitmentCandidateResume,
} from '../services/recruitmentCandidateResume.service.js';
import {
  createRecruitmentVacancy,
  getRecruitmentVacancy,
  listRecruitmentVacancies,
  updateRecruitmentVacancy,
} from '../services/recruitmentVacancy.service.js';
import {
  createRecruitmentApplication,
  listRecruitmentApplicationsForVacancy,
  updateRecruitmentApplication,
} from '../services/recruitmentApplication.service.js';
import {
  listVacancyAssignees,
  removeVacancyAssignee,
  setVacancyAssignee,
} from '../services/recruitmentVacancyAssignee.service.js';
import {
  RECRUITMENT_VACANCY_STATUSES,
  createOrganizationRecruitmentStage,
} from '../services/recruitmentStage.service.js';
import {
  getVacancyStageConfiguration,
  updateVacancyStageConfiguration,
  listActiveOrganizationRecruitmentStages,
} from '../services/recruitmentVacancyStage.service.js';
import {
  RECRUITMENT_VACANCY_DOCUMENT_CATEGORIES,
  RECRUITMENT_VACANCY_DOCUMENT_MAX_BYTES,
  createRecruitmentVacancyDocument,
  deleteRecruitmentVacancyDocument,
  isAllowedRecruitmentVacancyDocumentFile,
  listRecruitmentVacancyDocuments,
  assertRecruitmentVacancyDocumentInOrg,
  streamRecruitmentVacancyDocumentFile,
} from '../services/recruitmentVacancyDocument.service.js';

const router = Router();

const dateOnlySchema = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]);

const vacancyCreateSchema = z.object({
  title: z.string().min(1).max(300),
  clientName: z.string().min(1).max(300),
  location: z.string().max(300).optional().nullable(),
  positionsTotal: z.number().int().min(1).max(9999),
  openedAt: z.string().datetime().optional(),
  targetCoverageDate: dateOnlySchema.optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'COVERED', 'CLOSED']).optional(),
  jobDescription: z.string().max(100_000).optional().nullable(),
  notes: z.string().max(20_000).optional().nullable(),
});

const recruitmentVacancyDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RECRUITMENT_VACANCY_DOCUMENT_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    cb(
      isAllowedRecruitmentVacancyDocumentFile(file.mimetype, file.originalname)
        ? null
        : new Error('INVALID_DOCUMENT_FILE'),
      isAllowedRecruitmentVacancyDocumentFile(file.mimetype, file.originalname),
    );
  },
});

const recruitmentCandidateResumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RECRUITMENT_CANDIDATE_RESUME_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    cb(
      isAllowedRecruitmentCandidateResumeFile(file.mimetype, file.originalname)
        ? null
        : new Error('INVALID_RESUME_FILE'),
      isAllowedRecruitmentCandidateResumeFile(file.mimetype, file.originalname),
    );
  },
});

const recruitmentVacancyDocumentCategorySchema = z.enum(RECRUITMENT_VACANCY_DOCUMENT_CATEGORIES);

const vacancyPatchSchema = vacancyCreateSchema.partial();

const candidateContactRefine = (data, ctx) => {
  const wa = data.whatsapp != null ? String(data.whatsapp).trim() : '';
  const ph = data.phone != null ? String(data.phone).trim() : '';
  if (!wa && !ph) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Indica WhatsApp o teléfono de contacto.',
      path: ['whatsapp'],
    });
  }
  if (wa && wa.length > 0 && wa.length < 5) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'WhatsApp no válido.',
      path: ['whatsapp'],
    });
  }
  if (ph && ph.length > 0 && ph.length < 5) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Teléfono no válido.',
      path: ['phone'],
    });
  }
};

const candidateWriteFields = {
  fullName: z.string().min(1).max(200),
  profile: z.string().min(1).max(300),
  profileOther: z.string().max(300).optional().nullable(),
  profileSecondary: z.string().max(300).optional().nullable(),
  profileSecondaryOther: z.string().max(300).optional().nullable(),
  whatsapp: z.string().max(40).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.union([z.string().email(), z.literal(''), z.null()]).optional(),
  city: z.string().max(120).optional().nullable(),
  state: z.string().max(120).optional().nullable(),
  source: z.string().max(120).optional().nullable(),
  sourceOther: z.string().max(120).optional().nullable(),
  notes: z.string().max(20_000).optional().nullable(),
};

const candidateCreateSchema = z.object(candidateWriteFields).superRefine(candidateContactRefine);

const candidatePatchSchema = z
  .object({
    ...candidateWriteFields,
    fullName: z.string().min(1).max(200).optional(),
    profile: z.string().min(1).max(300).optional(),
  })
  .partial()
  .extend({
    archived: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.whatsapp !== undefined) {
      const wa = data.whatsapp != null ? String(data.whatsapp).trim() : '';
      if (wa && wa.length < 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'WhatsApp no válido.',
          path: ['whatsapp'],
        });
      }
    }
    if (data.phone !== undefined) {
      const ph = data.phone != null ? String(data.phone).trim() : '';
      if (ph && ph.length < 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Teléfono no válido.',
          path: ['phone'],
        });
      }
    }
  });

router.get('/stages', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const stages = await listActiveOrganizationRecruitmentStages(u.organizationId);
    res.json({ stages });
  } catch (e) {
    next(e);
  }
});

router.post('/stages', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const body = z.object({ name: z.string().min(1).max(120) }).parse(req.body);
    const stage = await createOrganizationRecruitmentStage(u.organizationId, body.name);
    res.status(201).json({ stage });
  } catch (e) {
    next(e);
  }
});

router.post('/vacancies', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const body = vacancyCreateSchema.parse(req.body);
    const vacancy = await createRecruitmentVacancy(u.organizationId, body);
    res.status(201).json({ vacancy });
  } catch (e) {
    next(e);
  }
});

router.get('/vacancies', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
    if (status && !RECRUITMENT_VACANCY_STATUSES.includes(status)) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Filtro status inválido.';
      throw err;
    }
    const vacancies = await listRecruitmentVacancies(u.organizationId, { status });
    res.json({ vacancies });
  } catch (e) {
    next(e);
  }
});

router.get('/vacancies/:vacancyId/stages', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const config = await getVacancyStageConfiguration(u.organizationId, req.params.vacancyId);
    res.json(config);
  } catch (e) {
    next(e);
  }
});

router.put('/vacancies/:vacancyId/stages', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const body = z.object({ stageIds: z.array(z.string().min(1)).min(1) }).parse(req.body);
    const vacancyStages = await updateVacancyStageConfiguration(
      u.organizationId,
      req.params.vacancyId,
      body.stageIds,
    );
    res.json({ vacancyStages });
  } catch (e) {
    next(e);
  }
});

router.get('/vacancies/:id', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const vacancy = await getRecruitmentVacancy(u.organizationId, req.params.id);
    res.json({ vacancy });
  } catch (e) {
    next(e);
  }
});

router.patch('/vacancies/:id', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const body = vacancyPatchSchema.parse(req.body);
    const vacancy = await updateRecruitmentVacancy(u.organizationId, req.params.id, body);
    res.json({ vacancy });
  } catch (e) {
    next(e);
  }
});

router.get('/vacancies/:vacancyId/documents', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const documents = await listRecruitmentVacancyDocuments(u.organizationId, req.params.vacancyId);
    res.json({ documents });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/vacancies/:vacancyId/documents',
  recruitmentVacancyDocumentUpload.single('file'),
  async (req, res, next) => {
    try {
      const u = await assertEmpresaAdmin(req.session.userId);
      if (!req.file?.buffer?.length) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        err.message = 'Selecciona un archivo admitido (PDF, imagen u Office).';
        throw err;
      }
      const fields = z
        .object({
          displayName: z.string().min(1).max(200),
          category: recruitmentVacancyDocumentCategorySchema.default('OTHER'),
        })
        .parse({
          displayName: req.body?.displayName ?? req.body?.name,
          category: req.body?.category ?? 'OTHER',
        });
      const document = await createRecruitmentVacancyDocument({
        organizationId: u.organizationId,
        vacancyId: req.params.vacancyId,
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

router.get('/vacancy-documents/:documentId/file', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const doc = await assertRecruitmentVacancyDocumentInOrg(req.params.documentId, u.organizationId);
    await streamRecruitmentVacancyDocumentFile(req, res, doc, u.organizationId);
  } catch (e) {
    if (e?.code === 'ENOENT') {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Archivo no encontrado.' });
      return;
    }
    next(e);
  }
});

router.delete('/vacancy-documents/:documentId', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    await deleteRecruitmentVacancyDocument(u.organizationId, req.params.documentId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/vacancies/:vacancyId/assignees', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const assignees = await listVacancyAssignees(u.organizationId, req.params.vacancyId);
    res.json({ assignees });
  } catch (e) {
    next(e);
  }
});

router.post('/vacancies/:vacancyId/assignees', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const body = z
      .object({
        employeeId: z.string().min(1),
        role: z.enum(['PRIMARY', 'SUPPORT']),
      })
      .parse(req.body);
    const assignee = await setVacancyAssignee({
      organizationId: u.organizationId,
      vacancyId: req.params.vacancyId,
      employeeId: body.employeeId,
      role: body.role,
    });
    res.status(201).json({ assignee });
  } catch (e) {
    next(e);
  }
});

router.delete('/vacancies/:vacancyId/assignees/:assigneeId', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    await removeVacancyAssignee(u.organizationId, req.params.vacancyId, req.params.assigneeId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/candidates/check-duplicates', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const body = z
      .object({
        email: z.union([z.string().email(), z.literal(''), z.null()]).optional(),
        phone: z.union([z.string().max(40), z.literal(''), z.null()]).optional(),
      })
      .parse(req.body ?? {});
    const email = body.email && String(body.email).trim() ? body.email : undefined;
    const phone = body.phone && String(body.phone).trim() ? body.phone : undefined;
    if (!email && !phone) {
      res.json({ candidates: [] });
      return;
    }
    const candidates = await findPotentialDuplicateRecruitmentCandidates(u.organizationId, {
      email,
      phone,
    });
    res.json({
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

router.post('/candidates', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const body = candidateCreateSchema.parse(req.body);
    const candidate = await createRecruitmentCandidate(u.organizationId, body);
    res.status(201).json({ candidate });
  } catch (e) {
    next(e);
  }
});

router.get('/candidates', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const includeArchived = req.query.includeArchived === '1' || req.query.includeArchived === 'true';
    const contextVacancyId =
      typeof req.query.contextVacancyId === 'string' && req.query.contextVacancyId.trim()
        ? req.query.contextVacancyId.trim()
        : null;
    const result = await listRecruitmentCandidates(u.organizationId, {
      includeArchived,
      q: req.query.q,
      profile: req.query.profile,
      source: req.query.source,
      limit: req.query.limit,
      cursor: req.query.cursor,
      contextVacancyId,
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/candidates/:candidateId/resume', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const resume = await getRecruitmentCandidateResume(u.organizationId, req.params.candidateId);
    res.json({ resume });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/candidates/:candidateId/resume',
  recruitmentCandidateResumeUpload.single('file'),
  async (req, res, next) => {
    try {
      const u = await assertEmpresaAdmin(req.session.userId);
      if (!req.file?.buffer?.length) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        err.message = 'Selecciona un CV admitido (PDF, DOC, DOCX o imagen).';
        throw err;
      }
      const resume = await uploadRecruitmentCandidateResume({
        organizationId: u.organizationId,
        candidateId: req.params.candidateId,
        uploadedByUserId: u.id,
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        originalName: req.file.originalname,
      });
      res.status(201).json({ resume });
    } catch (e) {
      next(e);
    }
  },
);

router.get('/candidates/:candidateId/resume/file', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const doc = await assertRecruitmentCandidateResumeInOrg(
      u.organizationId,
      req.params.candidateId,
    );
    await streamRecruitmentCandidateResumeFile(
      req,
      res,
      doc,
      u.organizationId,
      req.params.candidateId,
    );
  } catch (e) {
    if (e?.code === 'ENOENT') {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Archivo no encontrado.' });
      return;
    }
    next(e);
  }
});

router.delete('/candidates/:candidateId/resume', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    await deleteRecruitmentCandidateResume(u.organizationId, req.params.candidateId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/candidates/:id', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const candidate = await getRecruitmentCandidate(u.organizationId, req.params.id);
    res.json({ candidate });
  } catch (e) {
    next(e);
  }
});

router.patch('/candidates/:id', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const body = candidatePatchSchema.parse(req.body);
    const candidate = await updateRecruitmentCandidate(u.organizationId, req.params.id, body);
    res.json({ candidate });
  } catch (e) {
    next(e);
  }
});

router.post('/vacancies/:vacancyId/applications', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const body = z
      .object({
        candidateId: z.string().min(1),
        stageId: z.string().min(1).optional(),
      })
      .parse(req.body);
    const application = await createRecruitmentApplication({
      organizationId: u.organizationId,
      vacancyId: req.params.vacancyId,
      candidateId: body.candidateId,
      changedByUserId: u.id,
      initialStageId: body.stageId,
    });
    res.status(201).json({ application });
  } catch (e) {
    next(e);
  }
});

router.get('/vacancies/:vacancyId/applications', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const applications = await listRecruitmentApplicationsForVacancy(u.organizationId, req.params.vacancyId);
    res.json({ applications });
  } catch (e) {
    next(e);
  }
});

router.patch('/applications/:id', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const body = z
      .object({
        stageId: z.string().min(1).optional(),
        position: z.number().int().optional(),
        notes: z.string().max(20_000).optional().nullable(),
      })
      .parse(req.body);
    const application = await updateRecruitmentApplication({
      organizationId: u.organizationId,
      applicationId: req.params.id,
      stageId: body.stageId,
      position: body.position,
      notes: body.notes,
      changedByUserId: u.id,
    });
    res.json({ application });
  } catch (e) {
    next(e);
  }
});

export default router;

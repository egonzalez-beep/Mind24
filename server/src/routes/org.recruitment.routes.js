import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { assertEmpresaAdmin } from '../services/candidate.service.js';
import {
  createRecruitmentCandidate,
  getRecruitmentCandidate,
  listRecruitmentCandidates,
  updateRecruitmentCandidate,
} from '../services/recruitmentCandidate.service.js';
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
import { RECRUITMENT_VACANCY_STATUSES } from '../services/recruitmentStage.service.js';
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

const recruitmentVacancyDocumentCategorySchema = z.enum(RECRUITMENT_VACANCY_DOCUMENT_CATEGORIES);

const vacancyPatchSchema = vacancyCreateSchema.partial();

const candidateCreateSchema = z.object({
  fullName: z.string().min(2).max(200),
  profile: z.string().min(1).max(300),
  phone: z.string().min(5).max(40),
  whatsapp: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  state: z.string().max(120).optional().nullable(),
  source: z.string().max(120).optional().nullable(),
  notes: z.string().max(20_000).optional().nullable(),
});

const candidatePatchSchema = candidateCreateSchema.partial().extend({
  archived: z.boolean().optional(),
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
    const candidates = await listRecruitmentCandidates(u.organizationId, { includeArchived });
    res.json({ candidates });
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
    const body = z.object({ candidateId: z.string().min(1) }).parse(req.body);
    const application = await createRecruitmentApplication({
      organizationId: u.organizationId,
      vacancyId: req.params.vacancyId,
      candidateId: body.candidateId,
      changedByUserId: u.id,
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

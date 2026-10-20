import { Router } from 'express';
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

const router = Router();

const vacancyCreateSchema = z.object({
  title: z.string().min(1).max(300),
  clientName: z.string().min(1).max(300),
  location: z.string().max(300).optional().nullable(),
  positionsTotal: z.number().int().min(1).max(9999),
  openedAt: z.string().datetime().optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'COVERED', 'CLOSED']).optional(),
  jobDescription: z.string().max(100_000).optional().nullable(),
  notes: z.string().max(20_000).optional().nullable(),
});

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

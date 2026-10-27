import { z } from 'zod';
import { prisma } from '../db/client.js';
import {
  createRecruitmentCandidate,
  findPotentialDuplicateRecruitmentCandidates,
} from './recruitmentCandidate.service.js';
import { createRecruitmentCandidateNote } from './recruitmentCandidateNote.service.js';
import { createRecruitmentApplication } from './recruitmentApplication.service.js';
import { assertRecruitmentVacancyInOrg } from './recruitmentVacancy.service.js';
import { getVacancyStageConfiguration } from './recruitmentVacancyStage.service.js';
import { listRecruitmentVacancies } from './recruitmentVacancy.service.js';

const candidateContactRefine = (data, ctx) => {
  const wa = data.whatsapp != null ? String(data.whatsapp).trim() : '';
  const ph = data.phone != null ? String(data.phone).trim() : '';
  if (!wa && !ph) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Indica el WhatsApp del candidato.',
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
  locality: z.string().max(120).optional().nullable(),
  neighborhood: z.string().max(120).optional().nullable(),
  source: z.string().max(120).optional().nullable(),
  sourceOther: z.string().max(120).optional().nullable(),
  notes: z.string().max(20_000).optional().nullable(),
};

export const workforceCandidateCreateSchema = z
  .object({
    ...candidateWriteFields,
    vacancyId: z.string().min(1).optional().nullable(),
    stageId: z.string().min(1).optional().nullable(),
    interviewDate: z.string().max(10).optional().nullable(),
    interviewTime: z.string().max(5).optional().nullable(),
  })
  .strict()
  .superRefine(candidateContactRefine);

export async function listActiveVacanciesForWorkforcePortal(organizationId) {
  const rows = await listRecruitmentVacancies(organizationId, { status: 'ACTIVE' });
  return rows.map((v) => ({ id: v.id, title: v.title, status: v.status }));
}

export async function getEnabledVacancyStagesForWorkforcePortal(organizationId, vacancyId) {
  const vacancy = await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  if (vacancy.status !== 'ACTIVE') {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La vacante no está disponible para alta de candidatos.';
    throw err;
  }
  const config = await getVacancyStageConfiguration(organizationId, vacancyId);
  const rows = (config.vacancyStages || []).filter((vs) => vs.isEnabled !== false);
  rows.sort((a, b) => (a.position || 0) - (b.position || 0));
  return {
    vacancy: { id: vacancy.id, title: vacancy.title, status: vacancy.status },
    vacancyStages: rows,
  };
}

async function resolveStageForVacancy(organizationId, vacancyId, stageId) {
  const config = await getEnabledVacancyStagesForWorkforcePortal(organizationId, vacancyId);
  const rows = config.vacancyStages || [];
  if (!rows.length) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La vacante no tiene etapas habilitadas.';
    throw err;
  }
  if (stageId) {
    const match = rows.find((vs) => (vs.stage?.id || vs.stageId) === stageId);
    if (!match) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'La etapa inicial no pertenece a esta vacante.';
      throw err;
    }
    return match.stage?.id || match.stageId;
  }
  const newRow = rows.find((vs) => vs.stage?.key === 'NEW');
  if (newRow) return newRow.stage?.id || newRow.stageId;
  const first = rows[0];
  return first.stage?.id || first.stageId;
}

export async function createRecruitmentCandidateFromWorkforcePortal({
  organizationId,
  workforceEmployeeId,
  body,
}) {
  const parsed = workforceCandidateCreateSchema.parse(body);
  const { vacancyId, stageId, notes, interviewDate, interviewTime, ...createPayload } = parsed;

  const employee = await prisma.workforceEmployee.findFirst({
    where: { id: workforceEmployeeId, organizationId, isActive: true },
    select: { id: true, fullName: true, profilePhotoPath: true },
  });
  if (!employee) {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    err.message = 'Acceso no disponible.';
    throw err;
  }

  let vacancyMeta = null;
  let stageName = null;
  if (vacancyId) {
    const vacancy = await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
    if (vacancy.status !== 'ACTIVE') {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Solo puedes asignar vacantes activas.';
      throw err;
    }
    vacancyMeta = { id: vacancy.id, title: vacancy.title };
  }

  const candidate = await createRecruitmentCandidate(organizationId, createPayload, {
    registeredByWorkforceEmployeeId: workforceEmployeeId,
  });

  const initialNote = typeof notes === 'string' && notes.trim() ? notes.trim() : null;
  if (initialNote) {
    await createRecruitmentCandidateNote(organizationId, candidate.id, null, initialNote, {
      authorWorkforceEmployeeId: workforceEmployeeId,
    });
  }

  if (vacancyId) {
    const resolvedStageId = await resolveStageForVacancy(organizationId, vacancyId, stageId || null);
    const st = await prisma.recruitmentStage.findFirst({
      where: { id: resolvedStageId, organizationId },
      select: { name: true, key: true },
    });
    const { resolveInterviewScheduledAtForOrg } = await import(
      './recruitmentInterviewSchedule.service.js'
    );
    const interviewSchedule = await resolveInterviewScheduledAtForOrg(
      organizationId,
      { interviewDate, interviewTime },
      { stageKey: st?.key },
    );
    await createRecruitmentApplication({
      organizationId,
      vacancyId,
      candidateId: candidate.id,
      changedByUserId: null,
      initialStageId: resolvedStageId,
      interviewScheduledAt: interviewSchedule?.scheduledAt ?? undefined,
      interviewTimeSpecified: interviewSchedule?.timeSpecified,
    });
    stageName = st?.name || st?.key || null;
  }

  const registeredBy = {
    id: employee.id,
    fullName: employee.fullName,
    hasProfilePhoto: !!employee.profilePhotoPath,
  };

  return {
    candidate: {
      ...candidate,
      registeredBy,
    },
    confirmation: {
      registeredByName: employee.fullName,
      candidateName: candidate.fullName,
      vacancyTitle: vacancyMeta?.title || null,
      stageName,
    },
  };
}

export async function findDuplicateCandidatesForWorkforcePortal(organizationId, { email, phone }) {
  const candidates = await findPotentialDuplicateRecruitmentCandidates(organizationId, {
    email,
    phone,
  });
  return candidates;
}

export async function listMyCandidatesForWorkforcePortal(
  organizationId,
  workforceEmployeeId,
  options = {},
) {
  const { listCandidatesRegisteredByWorkforceEmployee } = await import(
    './recruitmentCandidate.service.js'
  );
  return listCandidatesRegisteredByWorkforceEmployee(organizationId, workforceEmployeeId, options);
}

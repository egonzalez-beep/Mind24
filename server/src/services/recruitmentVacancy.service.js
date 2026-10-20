import { prisma } from '../db/client.js';
import { RECRUITMENT_VACANCY_STATUSES } from './recruitmentStage.service.js';

export function serializeRecruitmentVacancy(row) {
  return {
    id: row.id,
    title: row.title,
    clientName: row.clientName,
    location: row.location,
    positionsTotal: row.positionsTotal,
    openedAt: row.openedAt.toISOString(),
    status: row.status,
    jobDescription: row.jobDescription,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function assertRecruitmentVacancyInOrg(vacancyId, organizationId) {
  const row = await prisma.recruitmentVacancy.findFirst({
    where: { id: vacancyId, organizationId },
  });
  if (!row) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Vacante no encontrada.';
    throw err;
  }
  return row;
}

function parseOpenedAt(value) {
  if (value == null) return new Date();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'openedAt inválido.';
    throw err;
  }
  return d;
}

export async function createRecruitmentVacancy(organizationId, payload) {
  const positionsTotal = Number(payload.positionsTotal);
  if (!Number.isInteger(positionsTotal) || positionsTotal < 1) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'positionsTotal debe ser al menos 1.';
    throw err;
  }
  const row = await prisma.recruitmentVacancy.create({
    data: {
      organizationId,
      title: payload.title.trim(),
      clientName: payload.clientName.trim(),
      location: payload.location?.trim() || null,
      positionsTotal,
      openedAt: parseOpenedAt(payload.openedAt),
      status: payload.status && RECRUITMENT_VACANCY_STATUSES.includes(payload.status) ? payload.status : 'ACTIVE',
      jobDescription: payload.jobDescription?.trim() || null,
      notes: payload.notes?.trim() || null,
    },
  });
  return serializeRecruitmentVacancy(row);
}

export async function listRecruitmentVacancies(organizationId, { status } = {}) {
  const where = { organizationId };
  if (status && RECRUITMENT_VACANCY_STATUSES.includes(status)) {
    where.status = status;
  }
  const rows = await prisma.recruitmentVacancy.findMany({
    where,
    orderBy: [{ openedAt: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(serializeRecruitmentVacancy);
}

export async function getRecruitmentVacancy(organizationId, vacancyId) {
  const row = await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  return serializeRecruitmentVacancy(row);
}

export async function updateRecruitmentVacancy(organizationId, vacancyId, patch) {
  await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  const data = {};
  if (patch.title != null) data.title = patch.title.trim();
  if (patch.clientName != null) data.clientName = patch.clientName.trim();
  if (patch.location !== undefined) data.location = patch.location?.trim() || null;
  if (patch.positionsTotal != null) {
    const n = Number(patch.positionsTotal);
    if (!Number.isInteger(n) || n < 1) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'positionsTotal debe ser al menos 1.';
      throw err;
    }
    data.positionsTotal = n;
  }
  if (patch.openedAt != null) data.openedAt = parseOpenedAt(patch.openedAt);
  if (patch.status != null) {
    if (!RECRUITMENT_VACANCY_STATUSES.includes(patch.status)) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'status de vacante inválido.';
      throw err;
    }
    data.status = patch.status;
  }
  if (patch.jobDescription !== undefined) data.jobDescription = patch.jobDescription?.trim() || null;
  if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;

  const row = await prisma.recruitmentVacancy.update({
    where: { id: vacancyId },
    data,
  });
  return serializeRecruitmentVacancy(row);
}

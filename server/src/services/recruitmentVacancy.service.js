import { prisma } from '../db/client.js';
import { RECRUITMENT_VACANCY_STATUSES } from './recruitmentStage.service.js';

export function emptyApplicationSummary() {
  return { total: 0, inProcess: 0, finalists: 0, hired: 0 };
}

function summarizeApplications(applications) {
  const summary = emptyApplicationSummary();
  for (const app of applications) {
    summary.total += 1;
    const key = app.stage?.key;
    if (key === 'HIRED') summary.hired += 1;
    if (key === 'FINALIST') summary.finalists += 1;
    if (key !== 'HIRED' && key !== 'REJECTED') summary.inProcess += 1;
  }
  return summary;
}

async function buildApplicationSummariesByVacancyId(organizationId, vacancyIds) {
  const map = new Map(vacancyIds.map((id) => [id, emptyApplicationSummary()]));
  if (!vacancyIds.length) return map;

  const applications = await prisma.recruitmentApplication.findMany({
    where: { organizationId, vacancyId: { in: vacancyIds } },
    select: { vacancyId: true, stage: { select: { key: true } } },
  });

  const byVacancy = new Map();
  for (const id of vacancyIds) byVacancy.set(id, []);
  for (const app of applications) {
    const bucket = byVacancy.get(app.vacancyId);
    if (bucket) bucket.push(app);
  }
  for (const [id, apps] of byVacancy) {
    map.set(id, summarizeApplications(apps));
  }
  return map;
}

async function buildPrimaryAssigneesByVacancyId(organizationId, vacancyIds) {
  const map = new Map();
  if (!vacancyIds.length) return map;

  const rows = await prisma.recruitmentVacancyAssignee.findMany({
    where: { organizationId, vacancyId: { in: vacancyIds }, role: 'PRIMARY' },
    include: {
      employee: { select: { id: true, fullName: true, position: true, department: true } },
    },
  });
  for (const row of rows) {
    map.set(row.vacancyId, {
      assigneeId: row.id,
      employeeId: row.employeeId,
      role: row.role,
      employee: row.employee,
    });
  }
  return map;
}

function formatTargetCoverageDate(row) {
  if (!row.targetCoverageDate) return null;
  const d = row.targetCoverageDate;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseTargetCoverageDate(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!m) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'targetCoverageDate inválido; use YYYY-MM-DD.';
    throw err;
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function serializeRecruitmentVacancy(row, extras = {}) {
  return {
    id: row.id,
    title: row.title,
    clientName: row.clientName,
    location: row.location,
    positionsTotal: row.positionsTotal,
    openedAt: row.openedAt.toISOString(),
    targetCoverageDate: formatTargetCoverageDate(row),
    status: row.status,
    jobDescription: row.jobDescription,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    applicationSummary: extras.applicationSummary ?? emptyApplicationSummary(),
    primaryAssignee: extras.primaryAssignee ?? null,
  };
}

async function enrichVacancies(organizationId, rows) {
  const ids = rows.map((r) => r.id);
  const [summaryMap, assigneeMap] = await Promise.all([
    buildApplicationSummariesByVacancyId(organizationId, ids),
    buildPrimaryAssigneesByVacancyId(organizationId, ids),
  ]);
  return rows.map((row) =>
    serializeRecruitmentVacancy(row, {
      applicationSummary: summaryMap.get(row.id) ?? emptyApplicationSummary(),
      primaryAssignee: assigneeMap.get(row.id) ?? null,
    }),
  );
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
      ...(payload.targetCoverageDate !== undefined
        ? { targetCoverageDate: parseTargetCoverageDate(payload.targetCoverageDate) }
        : {}),
    },
  });
  const [vacancy] = await enrichVacancies(organizationId, [row]);
  return vacancy;
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
  return enrichVacancies(organizationId, rows);
}

export async function getRecruitmentVacancy(organizationId, vacancyId) {
  const row = await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  const [vacancy] = await enrichVacancies(organizationId, [row]);
  return vacancy;
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
  if (patch.targetCoverageDate !== undefined) {
    data.targetCoverageDate = parseTargetCoverageDate(patch.targetCoverageDate);
  }

  const row = await prisma.recruitmentVacancy.update({
    where: { id: vacancyId },
    data,
  });
  const [vacancy] = await enrichVacancies(organizationId, [row]);
  return vacancy;
}

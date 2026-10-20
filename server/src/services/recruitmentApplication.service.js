import { prisma } from '../db/client.js';
import { assertRecruitmentCandidateInOrg, serializeRecruitmentCandidate } from './recruitmentCandidate.service.js';
import { assertRecruitmentVacancyInOrg } from './recruitmentVacancy.service.js';
import {
  assertRecruitmentStageInOrg,
  getStageByKeyForOrg,
  serializeRecruitmentStage,
} from './recruitmentStage.service.js';

const POSITION_GAP = 1000;

async function nextPositionInStage(vacancyId, stageId, tx) {
  const agg = await tx.recruitmentApplication.aggregate({
    where: { vacancyId, stageId },
    _max: { position: true },
  });
  return (agg._max.position ?? 0) + POSITION_GAP;
}

function serializeApplication(row) {
  return {
    id: row.id,
    candidateId: row.candidateId,
    vacancyId: row.vacancyId,
    stageId: row.stageId,
    position: row.position,
    appliedAt: row.appliedAt.toISOString(),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    candidate: row.candidate ? serializeRecruitmentCandidate(row.candidate) : undefined,
    stage: row.stage ? serializeRecruitmentStage(row.stage) : undefined,
  };
}

async function recordStageEvent(tx, { organizationId, applicationId, fromStageId, toStageId, changedByUserId }) {
  return tx.recruitmentApplicationStageEvent.create({
    data: {
      organizationId,
      applicationId,
      fromStageId,
      toStageId,
      changedByUserId: changedByUserId ?? null,
    },
  });
}

export async function assertRecruitmentApplicationInOrg(applicationId, organizationId) {
  const row = await prisma.recruitmentApplication.findFirst({
    where: { id: applicationId, organizationId },
  });
  if (!row) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Postulación no encontrada.';
    throw err;
  }
  return row;
}

export async function createRecruitmentApplication({
  organizationId,
  vacancyId,
  candidateId,
  changedByUserId,
}) {
  await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  const candidate = await assertRecruitmentCandidateInOrg(candidateId, organizationId);
  if (candidate.archivedAt) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message =
      'No se puede asignar a vacante un candidato archivado. Desarchívalo antes de crear una nueva postulación.';
    throw err;
  }

  const duplicate = await prisma.recruitmentApplication.findUnique({
    where: { candidateId_vacancyId: { candidateId, vacancyId } },
  });
  if (duplicate) {
    const err = new Error('CONFLICT');
    err.code = 'CONFLICT';
    err.message = 'El candidato ya está asignado a esta vacante.';
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    const newStage = await getStageByKeyForOrg(organizationId, 'NEW', tx);
    const position = await nextPositionInStage(vacancyId, newStage.id, tx);
    const appliedAt = new Date();
    const app = await tx.recruitmentApplication.create({
      data: {
        organizationId,
        candidateId,
        vacancyId,
        stageId: newStage.id,
        position,
        appliedAt,
      },
      include: { candidate: true, stage: true },
    });
    await recordStageEvent(tx, {
      organizationId,
      applicationId: app.id,
      fromStageId: null,
      toStageId: newStage.id,
      changedByUserId,
    });
    return serializeApplication(app);
  });
}

export async function listRecruitmentApplicationsForVacancy(organizationId, vacancyId) {
  await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  await getStageByKeyForOrg(organizationId, 'NEW');
  const rows = await prisma.recruitmentApplication.findMany({
    where: { organizationId, vacancyId },
    include: { candidate: true, stage: true },
    orderBy: [{ stageId: 'asc' }, { position: 'asc' }, { appliedAt: 'asc' }],
  });
  return rows.map(serializeApplication);
}

export async function updateRecruitmentApplication({
  organizationId,
  applicationId,
  stageId,
  position,
  notes,
  changedByUserId,
}) {
  const existing = await assertRecruitmentApplicationInOrg(applicationId, organizationId);

  return prisma.$transaction(async (tx) => {
    const data = {};
    if (notes !== undefined) data.notes = notes?.trim() || null;
    if (position != null) data.position = position;

    let nextStageId = existing.stageId;
    if (stageId != null && stageId !== existing.stageId) {
      await assertRecruitmentStageInOrg(stageId, organizationId, tx);
      nextStageId = stageId;
      data.stageId = stageId;
      if (position == null) {
        data.position = await nextPositionInStage(existing.vacancyId, stageId, tx);
      }
    }

    const updated = await tx.recruitmentApplication.update({
      where: { id: applicationId },
      data,
      include: { candidate: true, stage: true },
    });

    if (stageId != null && stageId !== existing.stageId) {
      await recordStageEvent(tx, {
        organizationId,
        applicationId,
        fromStageId: existing.stageId,
        toStageId: stageId,
        changedByUserId,
      });
    }

    return serializeApplication(updated);
  });
}

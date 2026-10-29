import { prisma } from '../db/client.js';
import { assertRecruitmentCandidateInOrg, serializeRecruitmentCandidate } from './recruitmentCandidate.service.js';
import { assertRecruitmentVacancyInOrg } from './recruitmentVacancy.service.js';
import { getStageByKeyForOrg, serializeRecruitmentStage } from './recruitmentStage.service.js';
import {
  assertNewStageEnabledForVacancy,
  assertStageEnabledForVacancy,
  ensureVacancyRecruitmentStages,
} from './recruitmentVacancyStage.service.js';
import { resolveInterviewScheduledAtForApplicationUpdate } from './recruitmentInterviewSchedule.service.js';
import { emitWorkforceRecruitmentNovedadForStageEvent } from './workforceRecruitmentNovedad.service.js';

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
    interviewScheduledAt: row.interviewScheduledAt
      ? row.interviewScheduledAt.toISOString()
      : null,
    interviewTimeSpecified: row.interviewTimeSpecified !== false,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    candidate: row.candidate ? serializeRecruitmentCandidate(row.candidate) : undefined,
    stage: row.stage ? serializeRecruitmentStage(row.stage) : undefined,
  };
}

async function recordStageEvent(tx, { organizationId, applicationId, fromStageId, toStageId, changedByUserId }) {
  const stageEvent = await tx.recruitmentApplicationStageEvent.create({
    data: {
      organizationId,
      applicationId,
      fromStageId,
      toStageId,
      changedByUserId: changedByUserId ?? null,
    },
  });
  await emitWorkforceRecruitmentNovedadForStageEvent(tx, {
    stageEvent,
    applicationId,
    organizationId,
  });
  return stageEvent;
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
  initialStageId,
  interviewScheduledAt = undefined,
  interviewTimeSpecified = undefined,
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
    await ensureVacancyRecruitmentStages(organizationId, vacancyId, tx);
    const newStage = await assertNewStageEnabledForVacancy(organizationId, vacancyId, tx);
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
        ...(interviewScheduledAt != null
          ? {
              interviewScheduledAt,
              ...(interviewTimeSpecified !== undefined
                ? { interviewTimeSpecified }
                : {}),
            }
          : {}),
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

    const targetStageId =
      initialStageId && String(initialStageId).trim() && initialStageId !== newStage.id
        ? initialStageId
        : null;
    if (targetStageId) {
      await assertStageEnabledForVacancy(organizationId, vacancyId, targetStageId, tx);
      const targetStage = await tx.recruitmentStage.findFirst({
        where: { id: targetStageId, organizationId },
        select: { key: true },
      });
      const position = await nextPositionInStage(vacancyId, targetStageId, tx);
      const resolvedAt = resolveInterviewScheduledAtForApplicationUpdate({
        stageChanged: true,
        fromStageKey: newStage.key,
        toStageKey: targetStage?.key,
        existingInterviewScheduledAt: null,
        explicitInterviewScheduledAt: interviewScheduledAt,
      });
      const moveData = {
        stageId: targetStageId,
        position,
        interviewScheduledAt: resolvedAt,
      };
      if (resolvedAt != null && interviewTimeSpecified !== undefined) {
        moveData.interviewTimeSpecified = interviewTimeSpecified;
      }
      const moved = await tx.recruitmentApplication.update({
        where: { id: app.id },
        data: moveData,
        include: { candidate: true, stage: true },
      });
      await recordStageEvent(tx, {
        organizationId,
        applicationId: app.id,
        fromStageId: newStage.id,
        toStageId: targetStageId,
        changedByUserId,
      });
      return serializeApplication(moved);
    }

    return serializeApplication(app);
  });
}

export async function listRecruitmentApplicationsForVacancy(organizationId, vacancyId) {
  await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  await getStageByKeyForOrg(organizationId, 'NEW');
  const rows = await prisma.recruitmentApplication.findMany({
    where: { organizationId, vacancyId },
    include: { candidate: true, stage: true },
    orderBy: [{ updatedAt: 'desc' }, { position: 'asc' }, { appliedAt: 'desc' }],
  });
  return rows.map(serializeApplication);
}

export async function updateRecruitmentApplication({
  organizationId,
  applicationId,
  stageId,
  position,
  notes,
  interviewScheduledAt,
  interviewTimeSpecified,
  changedByUserId,
}) {
  const existingRow = await prisma.recruitmentApplication.findFirst({
    where: { id: applicationId, organizationId },
    include: { stage: { select: { key: true } } },
  });
  if (!existingRow) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Postulación no encontrada.';
    throw err;
  }
  const existing = existingRow;

  return prisma.$transaction(async (tx) => {
    const data = {};
    if (notes !== undefined) data.notes = notes?.trim() || null;
    if (position != null) data.position = position;

    const stageChanged = stageId != null && stageId !== existing.stageId;
    let toStageKey = existing.stage?.key ?? null;
    if (stageChanged) {
      await assertStageEnabledForVacancy(organizationId, existing.vacancyId, stageId, tx);
      const nextStage = await tx.recruitmentStage.findFirst({
        where: { id: stageId, organizationId },
        select: { key: true },
      });
      toStageKey = nextStage?.key ?? null;
      data.stageId = stageId;
      if (position == null) {
        data.position = await nextPositionInStage(existing.vacancyId, stageId, tx);
      }
    }

    const resolvedInterview = resolveInterviewScheduledAtForApplicationUpdate({
      stageChanged,
      fromStageKey: existing.stage?.key ?? null,
      toStageKey,
      existingInterviewScheduledAt: existing.interviewScheduledAt,
      explicitInterviewScheduledAt: interviewScheduledAt,
    });
    if (stageChanged || interviewScheduledAt !== undefined) {
      data.interviewScheduledAt = resolvedInterview;
      if (resolvedInterview == null) {
        data.interviewTimeSpecified = true;
      } else if (interviewTimeSpecified !== undefined) {
        data.interviewTimeSpecified = interviewTimeSpecified;
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

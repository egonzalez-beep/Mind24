import { prisma } from '../db/client.js';
import { assertRecruitmentCandidateInOrg, serializeRecruitmentCandidate } from './recruitmentCandidate.service.js';
import { assertRecruitmentVacancyInOrg } from './recruitmentVacancy.service.js';
import { getStageByKeyForOrg, serializeRecruitmentStage } from './recruitmentStage.service.js';
import {
  assertNewStageEnabledForVacancy,
  assertStageEnabledForVacancy,
  ensureVacancyRecruitmentStages,
} from './recruitmentVacancyStage.service.js';
import {
  applyRecruitmentInterviewFormChange,
  recordUnattributedInterviewSnapshot,
  isScheduledInterviewSlotConflict,
  INTERVIEW_SLOT_TAKEN_MESSAGE,
} from './recruitmentApplicationInterviewEvent.service.js';
import { cancelOpenStageNovedadWaits, stageNovedadEligibleAt } from './workforceRecruitmentNovedad.service.js';
import {
  assertRecruitmentProcessStageChangeAllowed,
  clearCandidateAutoArchive,
  closurePatchForStageMove,
  lockRecruitmentCandidateForProcessChange,
  kanbanVisibleApplicationWhere,
  syncCandidateAutoArchive,
} from './recruitmentProcessClosure.service.js';
import {
  HIRED_STAGE_KEY,
  nextHiredStageEnteredAt,
  reconcileVacancyCoverage,
  shouldRecordStageEvent,
} from './recruitmentCoverage.service.js';

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
    hiredStageEnteredAt: row.hiredStageEnteredAt ? row.hiredStageEnteredAt.toISOString() : null,
    notes: row.notes,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    closureOutcome: row.closureOutcome || null,
    closureReason: row.closureReason || null,
    closureNote: row.closureNote || null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    candidate: row.candidate ? serializeRecruitmentCandidate(row.candidate) : undefined,
    stage: row.stage ? serializeRecruitmentStage(row.stage) : undefined,
  };
}

async function recordStageEvent(tx, {
  organizationId,
  applicationId,
  fromStageId,
  toStageId,
  changedByUserId,
  scheduleNovedad = false,
  movedAt = new Date(),
}) {
  const armWait = scheduleNovedad
    && fromStageId
    && toStageId
    && fromStageId !== toStageId
    && changedByUserId;
  if (armWait) await cancelOpenStageNovedadWaits(tx, applicationId);
  return tx.recruitmentApplicationStageEvent.create({
    data: {
      organizationId,
      applicationId,
      fromStageId,
      toStageId,
      changedByUserId: changedByUserId ?? null,
      novedadEligibleAt: armWait ? stageNovedadEligibleAt(movedAt) : null,
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
  initialStageId,
  interviewScheduledAt = undefined,
  interviewTimeSpecified = undefined,
  db = null,
}) {
  const run = async (tx) => {
    await assertRecruitmentVacancyInOrg(vacancyId, organizationId, tx);
    await lockRecruitmentCandidateForProcessChange(tx, candidateId);
    const candidate = await assertRecruitmentCandidateInOrg(candidateId, organizationId, tx);
    if (candidate.archivedAt) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message =
        'No se puede asignar a vacante un candidato archivado. Desarchívalo antes de crear una nueva postulación.';
      throw err;
    }
    await clearCandidateAutoArchive(tx, candidateId);

    const duplicate = await tx.recruitmentApplication.findUnique({
      where: { candidateId_vacancyId: { candidateId, vacancyId } },
    });
    if (duplicate) {
      const err = new Error('CONFLICT');
      err.code = 'CONFLICT';
      err.message = 'El candidato ya está asignado a esta vacante.';
      throw err;
    }

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
      },
      include: { candidate: true, stage: true },
    });
    await recordStageEvent(tx, {
      organizationId,
      applicationId: app.id,
      fromStageId: null,
      toStageId: newStage.id,
      changedByUserId,
      scheduleNovedad: false,
    });

    const targetStageId =
      initialStageId && String(initialStageId).trim() && initialStageId !== newStage.id
        ? initialStageId
        : null;
    let current = app;
    if (targetStageId) {
      await assertStageEnabledForVacancy(organizationId, vacancyId, targetStageId, tx);
      const targetStage = await tx.recruitmentStage.findFirst({
        where: { id: targetStageId, organizationId },
        select: { key: true },
      });
      const position = await nextPositionInStage(vacancyId, targetStageId, tx);
      const moveData = {
        stageId: targetStageId,
        position,
        hiredStageEnteredAt: nextHiredStageEnteredAt({
          fromKey: newStage.key,
          toKey: targetStage?.key ?? null,
          previousEnteredAt: null,
          now: new Date(),
        }),
      };
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
        scheduleNovedad: false,
      });
      current = moved;
    }
    if (interviewScheduledAt != null && changedByUserId) {
      await applyRecruitmentInterviewFormChange(tx, {
        organizationId,
        applicationId: current.id,
        createdByUserId: changedByUserId,
        scheduledAt: interviewScheduledAt,
        timeSpecified: interviewTimeSpecified !== false,
      });
      current = await tx.recruitmentApplication.findFirst({
        where: { id: current.id, organizationId },
        include: { candidate: true, stage: true },
      });
    } else if (interviewScheduledAt != null) {
      await recordUnattributedInterviewSnapshot(tx, {
        organizationId,
        applicationId: current.id,
        scheduledAt: interviewScheduledAt,
        timeSpecified: interviewTimeSpecified !== false,
      });
      current = await tx.recruitmentApplication.findFirst({
        where: { id: current.id, organizationId },
        include: { candidate: true, stage: true },
      });
    }
    return serializeApplication(current);
  };
  let serialized;
  try {
    serialized = db ? await run(db) : await prisma.$transaction(run);
  } catch (err) {
    if (!isScheduledInterviewSlotConflict(err)) throw err;
    const error = new Error('CONFLICT');
    error.code = 'CONFLICT';
    error.message = INTERVIEW_SLOT_TAKEN_MESSAGE;
    throw error;
  }
  if (!db && serialized.stage?.key === HIRED_STAGE_KEY) {
    try {
      await reconcileVacancyCoverage(organizationId, vacancyId);
    } catch (err) {
      console.error('[recruitment-coverage]', err?.message || err);
    }
  }
  return serialized;
}

export async function listRecruitmentApplicationsForVacancy(organizationId, vacancyId) {
  await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  await getStageByKeyForOrg(organizationId, 'NEW');
  const rows = await prisma.recruitmentApplication.findMany({
    where: { organizationId, vacancyId, ...kanbanVisibleApplicationWhere() },
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
    include: {
      stage: { select: { key: true } },
      candidate: { select: { id: true, archivedAt: true } },
    },
  });
  if (!existingRow) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Postulación no encontrada.';
    throw err;
  }
  const existing = existingRow;

  let serialized;
  try {
    serialized = await prisma.$transaction(async (tx) => {
    const data = {};
    if (notes !== undefined) data.notes = notes?.trim() || null;
    if (position != null) data.position = position;

    const stageChanged = stageId != null && stageId !== existing.stageId;
    let toStageKey = existing.stage?.key ?? null;
    if (stageChanged && existing.candidate?.archivedAt) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Este candidato está archivado. Reactívalo para iniciar un nuevo proceso.';
      throw err;
    }
    assertRecruitmentProcessStageChangeAllowed({
      stageKey: existing.stage?.key,
      closureOutcome: existing.closureOutcome,
      stageChanged,
    });
    if (stageChanged) {
      await assertStageEnabledForVacancy(organizationId, existing.vacancyId, stageId, tx);
      const nextStage = await tx.recruitmentStage.findFirst({
        where: { id: stageId, organizationId },
        select: { key: true },
      });
      toStageKey = nextStage?.key ?? null;
      data.stageId = stageId;
      data.hiredStageEnteredAt = nextHiredStageEnteredAt({
        fromKey: existing.stage?.key ?? null,
        toKey: toStageKey,
        previousEnteredAt: existing.hiredStageEnteredAt ?? null,
        now: new Date(),
      });
      if (position == null) {
        data.position = await nextPositionInStage(existing.vacancyId, stageId, tx);
      }
    }

    Object.assign(
      data,
      closurePatchForStageMove({
        stageChanged,
        fromStageKey: existing.stage?.key,
        fromOutcome: existing.closureOutcome,
        toStageKey,
        now: new Date(),
      }),
    );

    const where = stageChanged
      ? { id: applicationId, organizationId, stageId: existing.stageId }
      : { id: applicationId, organizationId };
    let written = { count: 1 };
    if (Object.keys(data).length) {
      written = await tx.recruitmentApplication.updateMany({ where, data });
    }
    if (!shouldRecordStageEvent({ stageChanged, updatedCount: written.count })) {
      if (stageChanged || written.count !== 1) {
        const err = new Error('CONFLICT');
        err.code = 'CONFLICT';
        err.message = 'La etapa cambió en otra operación. Actualiza el tablero.';
        throw err;
      }
    }
    let updated = await tx.recruitmentApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: { candidate: true, stage: true },
    });

    if (shouldRecordStageEvent({ stageChanged, updatedCount: written.count })) {
      await recordStageEvent(tx, {
        organizationId,
        applicationId,
        fromStageId: existing.stageId,
        toStageId: stageId,
        changedByUserId,
        scheduleNovedad: true,
      });
    }
    if (stageChanged && written.count === 1) {
      await syncCandidateAutoArchive(tx, {
        organizationId,
        candidateId: existing.candidateId,
        now: new Date(),
      });
      if (toStageKey === 'HIRED' || toStageKey === 'REJECTED') {
        const { cancelScheduledInterviewsForClosedApplication } = await import(
          './recruitmentApplicationInterviewEvent.service.js'
        );
        await cancelScheduledInterviewsForClosedApplication(tx, {
          organizationId,
          applicationId,
          createdByUserId: changedByUserId,
          legacyScheduledAt: existing.interviewScheduledAt,
          legacyTimeSpecified: existing.interviewTimeSpecified,
          stageId: existing.stageId,
        });
        updated = await tx.recruitmentApplication.findFirst({
          where: { id: applicationId, organizationId },
          include: { candidate: true, stage: true },
        });
      }
    }
    const closedByMove = stageChanged && written.count === 1
      && (toStageKey === 'HIRED' || toStageKey === 'REJECTED');
    if (interviewScheduledAt !== undefined && !closedByMove) {
      await applyRecruitmentInterviewFormChange(tx, {
        organizationId,
        applicationId,
        createdByUserId: changedByUserId,
        scheduledAt: interviewScheduledAt,
        timeSpecified: interviewTimeSpecified !== false,
      });
      updated = await tx.recruitmentApplication.findFirst({
        where: { id: applicationId, organizationId },
        include: { candidate: true, stage: true },
      });
    }

    return serializeApplication(updated);
    });
  } catch (err) {
    if (!isScheduledInterviewSlotConflict(err)) throw err;
    const error = new Error('CONFLICT');
    error.code = 'CONFLICT';
    error.message = INTERVIEW_SLOT_TAKEN_MESSAGE;
    throw error;
  }
  const touchedHired =
    existing.stage?.key === HIRED_STAGE_KEY || serialized.stage?.key === HIRED_STAGE_KEY;
  if (stageId != null && stageId !== existing.stageId && touchedHired) {
    try {
      await reconcileVacancyCoverage(organizationId, existing.vacancyId);
    } catch (err) {
      console.error('[recruitment-coverage]', err?.message || err);
    }
  }
  return serialized;
}

import { prisma } from '../db/client.js';
import { assertRecruitmentCandidateInOrg, serializeRecruitmentCandidate } from './recruitmentCandidate.service.js';
import {
  assertRecruitmentVacancyInOrg,
  syncVacancyActiveQueueEmptiedAt,
} from './recruitmentVacancy.service.js';
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
  expectedBlocksReapplication,
  isBlocksReapplicationUniqueViolation,
  lockRecruitmentCandidateForProcessChange,
  kanbanVisibleApplicationWhere,
  reapplicationConflictMessage,
  selectOperationalApplicationsForVacancyKanban,
  syncCandidateAutoArchive,
} from './recruitmentProcessClosure.service.js';
import {
  HIRED_STAGE_KEY,
  assertRecruitmentHireCapacity,
  nextHiredStageEnteredAt,
  reconcileVacancyCoverage,
  shouldRecordStageEvent,
} from './recruitmentCoverage.service.js';
import { resolveOrganizationIanaTimezone } from './organizationTimezone.service.js';
import { localDateKey } from './remoteWorkSessionHistory.service.js';

const POSITION_GAP = 1000;
const EMPLOYMENT_START_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parsea AAAA-MM-DD real; null si inválida. */
export function parseEmploymentStartDateInput(raw) {
  const s = String(raw ?? '').trim();
  if (!EMPLOYMENT_START_DATE_RE.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return s;
}

/** Persiste Date @db.Date sin corrimiento de día (UTC midnight del calendario). */
export function employmentStartDateToPrisma(dateKey) {
  const key = parseEmploymentStartDateInput(dateKey);
  if (!key) return null;
  return new Date(`${key}T00:00:00.000Z`);
}

/** Serializa Date/@db.Date → AAAA-MM-DD estable. */
export function serializeEmploymentStartDate(value) {
  if (value == null) return null;
  if (typeof value === 'string' && EMPLOYMENT_START_DATE_RE.test(value.trim())) {
    return value.trim();
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function assertEmploymentStartDateForOrg(organizationId, raw, now = new Date()) {
  const key = parseEmploymentStartDateInput(raw);
  if (!key) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Indica una fecha de ingreso válida (AAAA-MM-DD).';
    throw err;
  }
  const timeZone = await resolveOrganizationIanaTimezone(organizationId);
  const today = localDateKey(now, timeZone);
  if (key > today) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La fecha de ingreso no puede ser posterior a hoy.';
    throw err;
  }
  return key;
}

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
    employmentStartDate: serializeEmploymentStartDate(row.employmentStartDate),
    scheduledEmploymentStartDate: serializeEmploymentStartDate(row.scheduledEmploymentStartDate),
    interviewNoShowFromStageId: row.interviewNoShowFromStageId || null,
    notes: row.notes,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    closureOutcome: row.closureOutcome || null,
    closureReason: row.closureReason || null,
    closureNote: row.closureNote || null,
    blocksReapplication: row.blocksReapplication !== false,
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
  employmentStartDate = undefined,
  db = null,
}) {
  const run = async (tx) => {
    // Orden: candado → tenant/vacante → bloqueo reaplicación → desarchivo → create.
    // Un rollback restaura archivedAt porque el desarchivo vive en la misma TX.
    await lockRecruitmentCandidateForProcessChange(tx, candidateId);
    await assertRecruitmentVacancyInOrg(vacancyId, organizationId, tx);
    const candidate = await assertRecruitmentCandidateInOrg(candidateId, organizationId, tx);

    const blocking = await tx.recruitmentApplication.findFirst({
      where: { candidateId, vacancyId, blocksReapplication: true },
      include: { stage: { select: { key: true } } },
    });
    if (blocking) {
      const err = new Error('CONFLICT');
      err.code = 'CONFLICT';
      err.message = reapplicationConflictMessage(
        blocking.stage?.key ?? null,
        blocking.closureOutcome ?? null,
      );
      throw err;
    }

    if (candidate.archivedAt) {
      await tx.recruitmentCandidate.update({
        where: { id: candidateId },
        data: { archivedAt: null, autoArchiveEligibleAt: null },
      });
    } else {
      await clearCandidateAutoArchive(tx, candidateId);
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
        blocksReapplication: true,
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
      const toKey = targetStage?.key ?? null;
      if (toKey === 'EMPLOYMENT_EXIT') {
        const { EMPLOYMENT_EXIT_GENERIC_MOVE_MESSAGE } = await import(
          './recruitmentApplicationEmploymentExit.service.js'
        );
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        err.message = EMPLOYMENT_EXIT_GENERIC_MOVE_MESSAGE;
        throw err;
      }
      let resolvedEmploymentStart = null;
      if (toKey === HIRED_STAGE_KEY) {
        resolvedEmploymentStart = await assertEmploymentStartDateForOrg(
          organizationId,
          employmentStartDate,
        );
        await assertRecruitmentHireCapacity(tx, organizationId, vacancyId);
      }
      const closurePatch = closurePatchForStageMove({
        stageChanged: true,
        fromStageKey: newStage.key,
        fromOutcome: null,
        toStageKey: toKey,
        now: new Date(),
      });
      const moveData = {
        stageId: targetStageId,
        position,
        hiredStageEnteredAt: nextHiredStageEnteredAt({
          fromKey: newStage.key,
          toKey,
          previousEnteredAt: null,
          now: new Date(),
        }),
        blocksReapplication: expectedBlocksReapplication(toKey, closurePatch.closureOutcome ?? null),
        ...closurePatch,
      };
      if (resolvedEmploymentStart) {
        moveData.employmentStartDate = employmentStartDateToPrisma(resolvedEmploymentStart);
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
    await syncCandidateAutoArchive(tx, {
      organizationId,
      candidateId,
      now: new Date(),
    });
    await syncVacancyActiveQueueEmptiedAt(organizationId, vacancyId, tx);
    return serializeApplication(current);
  };
  let serialized;
  try {
    serialized = db ? await run(db) : await prisma.$transaction(run);
  } catch (err) {
    if (isBlocksReapplicationUniqueViolation(err)) {
      const blocking = await prisma.recruitmentApplication.findFirst({
        where: { candidateId, vacancyId, blocksReapplication: true },
        include: { stage: { select: { key: true } } },
      });
      const error = new Error('CONFLICT');
      error.code = 'CONFLICT';
      error.message = reapplicationConflictMessage(
        blocking?.stage?.key ?? null,
        blocking?.closureOutcome ?? null,
      );
      throw error;
    }
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
  // Una tarjeta operativa por candidato: abierto actual, si no el intento más reciente.
  return selectOperationalApplicationsForVacancyKanban(rows.map(serializeApplication));
}

export async function updateRecruitmentApplication({
  organizationId,
  applicationId,
  stageId,
  position,
  notes,
  interviewScheduledAt,
  interviewTimeSpecified,
  employmentStartDate,
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

  const stageChanged = stageId != null && stageId !== existing.stageId;
  let previewToKey = existing.stage?.key ?? null;
  if (stageChanged) {
    const nextPreview = await prisma.recruitmentStage.findFirst({
      where: { id: stageId, organizationId },
      select: { key: true },
    });
    previewToKey = nextPreview?.key ?? null;
  }
  const { EMPLOYMENT_EXIT_STAGE_KEY } = await import('./recruitmentStage.service.js');
  const {
    EMPLOYMENT_EXIT_GENERIC_MOVE_MESSAGE,
  } = await import('./recruitmentApplicationEmploymentExit.service.js');
  if (stageChanged && previewToKey === EMPLOYMENT_EXIT_STAGE_KEY) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = EMPLOYMENT_EXIT_GENERIC_MOVE_MESSAGE;
    throw err;
  }
  const hireDateStages = new Set([HIRED_STAGE_KEY, EMPLOYMENT_EXIT_STAGE_KEY]);
  const movingToHired = stageChanged && previewToKey === HIRED_STAGE_KEY;
  const editingHireDateOnly =
    !stageChanged &&
    employmentStartDate !== undefined &&
    hireDateStages.has(existing.stage?.key);
  let resolvedEmploymentStart = null;
  if (movingToHired || editingHireDateOnly) {
    // Validación temprana de formato/hoy; bajo el candado de la TX se relee contra la baja.
    resolvedEmploymentStart = await assertEmploymentStartDateForOrg(
      organizationId,
      employmentStartDate,
    );
  } else if (employmentStartDate !== undefined && !movingToHired) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La fecha de ingreso solo aplica a postulaciones contratadas.';
    throw err;
  }

  let serialized;
  try {
    serialized = await prisma.$transaction(async (tx) => {
    const leavingApproved =
      stageChanged && existing.stage?.key === 'APPROVED';
    let fromStageKey = existing.stage?.key ?? null;
    let fromClosureOutcome = existing.closureOutcome;
    let fromStageId = existing.stageId;
    let fromHiredStageEnteredAt = existing.hiredStageEnteredAt ?? null;
    let candidateArchivedAt = existing.candidate?.archivedAt ?? null;

    if (editingHireDateOnly || leavingApproved || movingToHired) {
      const {
        lockRecruitmentApplicationRow,
        assertEmploymentStartCompatibleWithExit,
      } = await import('./recruitmentApplicationEmploymentExit.service.js');
      await lockRecruitmentApplicationRow(tx, organizationId, applicationId);
      if (movingToHired) await lockRecruitmentCandidateForProcessChange(tx, existing.candidateId);
      if (leavingApproved || movingToHired) {
        // Releer etapa y cierre bajo el candado antes de mover o confirmar.
        const locked = await tx.recruitmentApplication.findFirst({
          where: { id: applicationId, organizationId },
          include: {
            stage: { select: { key: true } },
            candidate: { select: { archivedAt: true } },
          },
        });
        if (!locked) {
          const err = new Error('NOT_FOUND');
          err.code = 'NOT_FOUND';
          err.message = 'Postulación no encontrada.';
          throw err;
        }
        if (locked.stageId !== existing.stageId) {
          const err = new Error('CONFLICT');
          err.code = 'CONFLICT';
          err.message = 'La etapa cambió en otra operación. Actualiza el tablero.';
          throw err;
        }
        fromStageKey = locked.stage?.key ?? null;
        fromClosureOutcome = locked.closureOutcome;
        fromStageId = locked.stageId;
        fromHiredStageEnteredAt = locked.hiredStageEnteredAt ?? null;
        candidateArchivedAt = locked.candidate?.archivedAt ?? null;
        assertRecruitmentProcessStageChangeAllowed({
          stageKey: fromStageKey,
          closureOutcome: fromClosureOutcome,
          stageChanged,
        });
      }
      if (editingHireDateOnly) {
        const locked = await tx.recruitmentApplication.findFirst({
          where: { id: applicationId, organizationId },
          include: {
            stage: { select: { key: true } },
            employmentExit: { select: { exitDate: true } },
          },
        });
        if (!locked || !hireDateStages.has(locked.stage?.key)) {
          const err = new Error('VALIDATION_ERROR');
          err.code = 'VALIDATION_ERROR';
          err.message = 'La fecha de ingreso solo aplica a postulaciones contratadas.';
          throw err;
        }
        resolvedEmploymentStart = await assertEmploymentStartDateForOrg(
          organizationId,
          employmentStartDate,
        );
        assertEmploymentStartCompatibleWithExit(
          resolvedEmploymentStart,
          serializeEmploymentStartDate(locked.employmentExit?.exitDate),
        );
      }
    }

    const data = {};
    if (notes !== undefined) data.notes = notes?.trim() || null;
    if (position != null) data.position = position;

    let toStageKey = fromStageKey;
    if (stageChanged && candidateArchivedAt) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Este candidato está archivado. Reactívalo para iniciar un nuevo proceso.';
      throw err;
    }
    if (!leavingApproved && !movingToHired) {
      assertRecruitmentProcessStageChangeAllowed({
        stageKey: fromStageKey,
        closureOutcome: fromClosureOutcome,
        stageChanged,
      });
    }
    if (stageChanged) {
      await assertStageEnabledForVacancy(organizationId, existing.vacancyId, stageId, tx);
      const nextStage = await tx.recruitmentStage.findFirst({
        where: { id: stageId, organizationId },
        select: { key: true },
      });
      toStageKey = nextStage?.key ?? null;
      if (toStageKey === HIRED_STAGE_KEY) {
        await assertRecruitmentHireCapacity(tx, organizationId, existing.vacancyId);
      }
      data.stageId = stageId;
      data.hiredStageEnteredAt = nextHiredStageEnteredAt({
        fromKey: fromStageKey,
        toKey: toStageKey,
        previousEnteredAt: fromHiredStageEnteredAt,
        now: new Date(),
      });
      if (position == null) {
        data.position = await nextPositionInStage(existing.vacancyId, stageId, tx);
      }
      // Sale de cartera de inasistencia: limpia origen; mover no crea cita.
      if (fromStageKey === 'INTERVIEW_NO_SHOW' && toStageKey !== 'INTERVIEW_NO_SHOW') {
        data.interviewNoShowFromStageId = null;
        data.interviewNoShowEventId = null;
      }
      // Sale de Aprobado: quita programación (mismo candado que el recordatorio).
      if (fromStageKey === 'APPROVED' && toStageKey !== 'APPROVED') {
        data.scheduledEmploymentStartDate = null;
        const { invalidateScheduledHireNotificationsForApplication } = await import(
          './orgNotification.service.js'
        );
        await invalidateScheduledHireNotificationsForApplication(tx, organizationId, applicationId);
      }
    }
    if (resolvedEmploymentStart) {
      // Solo escribe employmentStartDate; no toca hiredStageEnteredAt en edición de fecha.
      data.employmentStartDate = employmentStartDateToPrisma(resolvedEmploymentStart);
    }

    Object.assign(
      data,
      closurePatchForStageMove({
        stageChanged,
        fromStageKey,
        fromOutcome: fromClosureOutcome,
        toStageKey,
        now: new Date(),
      }),
    );

    const where = stageChanged
      ? { id: applicationId, organizationId, stageId: fromStageId }
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

    if (stageChanged && written.count === 1) {
      await syncVacancyActiveQueueEmptiedAt(organizationId, existing.vacancyId, tx);
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

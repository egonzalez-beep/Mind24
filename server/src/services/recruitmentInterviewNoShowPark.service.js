import { prisma } from '../db/client.js';
import { getStageByKeyForOrg, INTERVIEW_NO_SHOW_STAGE_KEY } from './recruitmentStage.service.js';
import {
  classifyRecruitmentApplication,
  expectedBlocksReapplication,
} from './recruitmentProcessClosure.service.js';
import {
  parseInterviewScheduleFields,
  stageKeyAllowsInterviewSchedule,
} from './recruitmentInterviewSchedule.service.js';
import { resolveOrganizationIanaTimezone } from './organizationTimezone.service.js';
import { cancelOpenStageNovedadWaits } from './workforceRecruitmentNovedad.service.js';

const POSITION_GAP = 1000;

async function nextPositionInStage(vacancyId, stageId, tx) {
  const agg = await tx.recruitmentApplication.aggregate({
    where: { vacancyId, stageId },
    _max: { position: true },
  });
  return (agg._max.position ?? 0) + POSITION_GAP;
}

async function ensureVacancyParkStageEnabled(tx, organizationId, vacancyId, parkStageId) {
  const existing = await tx.recruitmentVacancyStage.findFirst({
    where: { organizationId, vacancyId, stageId: parkStageId },
  });
  if (existing) {
    if (existing.isEnabled === false) {
      await tx.recruitmentVacancyStage.update({
        where: { id: existing.id },
        data: { isEnabled: true },
      });
    }
    return;
  }
  // Antes de la primera etapa terminal habilitada (regla: terminales al final).
  const enabled = await tx.recruitmentVacancyStage.findMany({
    where: { vacancyId, isEnabled: true },
    include: { stage: { select: { isTerminal: true } } },
    orderBy: { position: 'asc' },
  });
  const firstTerminalPos = enabled.find((row) => row.stage?.isTerminal)?.position;
  const lastActivePos = enabled
    .filter((row) => !row.stage?.isTerminal)
    .reduce((max, row) => Math.max(max, row.position), 0);
  let position = lastActivePos + Math.floor(POSITION_GAP / 2);
  if (firstTerminalPos != null && position >= firstTerminalPos) {
    position = firstTerminalPos - 1;
  }
  if (position < 1) position = POSITION_GAP;
  await tx.recruitmentVacancyStage.create({
    data: {
      organizationId,
      vacancyId,
      stageId: parkStageId,
      position,
      isEnabled: true,
    },
  });
}

async function recordParkStageEvent(tx, {
  organizationId,
  applicationId,
  fromStageId,
  toStageId,
  changedByUserId,
}) {
  // Sin aviso de etapa: el aviso INTERVIEW_NO_SHOW (o el movimiento admin) cubre al colaborador.
  if (fromStageId && toStageId && fromStageId !== toStageId) {
    await cancelOpenStageNovedadWaits(tx, applicationId);
  }
  return tx.recruitmentApplicationStageEvent.create({
    data: {
      organizationId,
      applicationId,
      fromStageId: fromStageId ?? null,
      toStageId,
      changedByUserId: changedByUserId ?? null,
      novedadEligibleAt: null,
      novedadNotifiedAt: null,
    },
  });
}

/**
 * Tras confirmar NO_SHOW: mueve la misma postulación a INTERVIEW_NO_SHOW si sigue
 * en la etapa de la cita y no hay otra SCHEDULED. Guarda interviewNoShowEventId
 * (id canónico de la cita) en la misma TX. Resultado tardío / otra cita → no mueve.
 */
export async function parkApplicationAfterInterviewNoShow(tx, {
  organizationId,
  applicationId,
  interviewStageId,
  interviewEventId = null,
  changedByUserId = null,
}) {
  const eventId = interviewEventId != null ? String(interviewEventId).trim() : '';
  if (!organizationId || !applicationId || !interviewStageId || !eventId) {
    return { parked: false, reason: 'missing_args' };
  }

  const app = await tx.recruitmentApplication.findFirst({
    where: { id: applicationId, organizationId },
    include: { stage: { select: { id: true, key: true } } },
  });
  if (!app) return { parked: false, reason: 'not_found' };

  const kind = classifyRecruitmentApplication(app.stage?.key, app.closureOutcome);
  if (kind !== 'active') return { parked: false, reason: 'closed' };
  if (app.stage?.key === INTERVIEW_NO_SHOW_STAGE_KEY) {
    return { parked: false, reason: 'already_parked' };
  }
  if (app.stageId !== interviewStageId) {
    return { parked: false, reason: 'stage_changed' };
  }

  const otherScheduled = await tx.recruitmentApplicationInterviewEvent.findFirst({
    where: { organizationId, applicationId, eventType: 'SCHEDULED' },
    select: { id: true },
  });
  if (otherScheduled) return { parked: false, reason: 'other_scheduled' };

  const parkStage = await getStageByKeyForOrg(organizationId, INTERVIEW_NO_SHOW_STAGE_KEY, tx);
  await ensureVacancyParkStageEnabled(tx, organizationId, app.vacancyId, parkStage.id);

  const position = await nextPositionInStage(app.vacancyId, parkStage.id, tx);
  await tx.recruitmentApplication.update({
    where: { id: applicationId },
    data: {
      stageId: parkStage.id,
      position,
      interviewNoShowFromStageId: interviewStageId,
      interviewNoShowEventId: eventId,
      blocksReapplication: expectedBlocksReapplication(INTERVIEW_NO_SHOW_STAGE_KEY, app.closureOutcome),
    },
  });
  await recordParkStageEvent(tx, {
    organizationId,
    applicationId,
    fromStageId: app.stageId,
    toStageId: parkStage.id,
    changedByUserId,
  });
  return {
    parked: true,
    parkStageId: parkStage.id,
    fromStageId: interviewStageId,
    interviewEventId: eventId,
  };
}

function validationError(message) {
  const err = new Error('VALIDATION_ERROR');
  err.code = 'VALIDATION_ERROR';
  err.message = message;
  return err;
}

function conflictError(message) {
  const err = new Error('CONFLICT');
  err.code = 'CONFLICT';
  err.message = message;
  return err;
}

function forbiddenError(message) {
  const err = new Error('FORBIDDEN');
  err.code = 'FORBIDDEN';
  err.message = message;
  return err;
}

function notFoundError(message) {
  const err = new Error('NOT_FOUND');
  err.code = 'NOT_FOUND';
  err.message = message;
  return err;
}

/**
 * Colaborador: nueva cita + retorno a etapa de origen en la misma TX.
 * sourceInterviewEventId debe coincidir con application.interviewNoShowEventId
 * (escrito al aparcar). Fallo → rollback completo: sin mover ni crear cita.
 */
export async function rescheduleAfterInterviewNoShowForWorkforce({
  organizationId,
  workforceEmployeeId,
  applicationId,
  interviewDate,
  interviewTime,
  sourceInterviewEventId = null,
  db = prisma,
}) {
  if (!organizationId || !workforceEmployeeId || !applicationId) {
    throw validationError('Solicitud incompleta.');
  }
  const sourceEventId = sourceInterviewEventId != null ? String(sourceInterviewEventId).trim() : '';
  if (!sourceEventId) {
    throw validationError('Este aviso ya no está vigente para agendar.');
  }

  return db.$transaction(async (tx) => {
    // Serializa doble clic / solicitudes concurrentes sobre la misma postulación.
    await tx.$executeRaw`
      SELECT id FROM "RecruitmentApplication"
      WHERE id = ${applicationId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;

    const app = await tx.recruitmentApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: {
        stage: { select: { id: true, key: true } },
        candidate: {
          select: {
            id: true,
            fullName: true,
            registeredByWorkforceEmployeeId: true,
            archivedAt: true,
            organizationId: true,
          },
        },
        vacancy: { select: { id: true, title: true, organizationId: true } },
        interviewNoShowFromStage: { select: { id: true, key: true, name: true, isActive: true } },
      },
    });
    if (!app || app.candidate?.organizationId !== organizationId) {
      throw notFoundError('Postulación no encontrada.');
    }
    if (app.candidate.registeredByWorkforceEmployeeId !== workforceEmployeeId) {
      throw forbiddenError('No puedes agendar esta entrevista.');
    }
    if (app.candidate.archivedAt) {
      throw validationError('Este candidato está archivado. Un administrador debe reactivarlo.');
    }
    const kind = classifyRecruitmentApplication(app.stage?.key, app.closureOutcome);
    if (kind !== 'active' || app.stage?.key !== INTERVIEW_NO_SHOW_STAGE_KEY) {
      throw conflictError(
        'Esta postulación ya no está en cartera de inasistencia. Actualiza e inténtalo de nuevo.',
      );
    }

    if (!app.interviewNoShowEventId || app.interviewNoShowEventId !== sourceEventId) {
      throw conflictError(
        'Este aviso no corresponde a la inasistencia que dejó la postulación en cartera.',
      );
    }

    const returnStage =
      app.interviewNoShowFromStage ||
      (app.interviewNoShowFromStageId
        ? await tx.recruitmentStage.findFirst({
            where: { id: app.interviewNoShowFromStageId, organizationId, isActive: true },
            select: { id: true, key: true, name: true, isActive: true },
          })
        : null);
    if (!app.interviewNoShowFromStageId || !returnStage || returnStage.isActive === false) {
      throw validationError(
        'No se pudo recuperar la etapa de entrevista de origen. Un administrador debe mover la tarjeta.',
      );
    }
    if (!stageKeyAllowsInterviewSchedule(returnStage.key)) {
      throw validationError(
        'La etapa de origen ya no admite entrevistas. Un administrador debe mover la tarjeta.',
      );
    }

    const vs = await tx.recruitmentVacancyStage.findFirst({
      where: {
        organizationId,
        vacancyId: app.vacancyId,
        stageId: returnStage.id,
        isEnabled: true,
      },
      select: { id: true },
    });
    if (!vs) {
      throw validationError(
        'La etapa de origen no está habilitada en esta vacante. Un administrador debe corregirlo.',
      );
    }

    const existingScheduled = await tx.recruitmentApplicationInterviewEvent.findFirst({
      where: { organizationId, applicationId, eventType: 'SCHEDULED' },
      select: { id: true },
    });
    if (existingScheduled) {
      throw conflictError('Ya hay una entrevista programada para esta postulación.');
    }

    const timeZone = await resolveOrganizationIanaTimezone(organizationId);
    const parsed = parseInterviewScheduleFields({ interviewDate, interviewTime }, timeZone);
    if (!parsed?.scheduledAt) {
      throw validationError('Indica la fecha de la nueva entrevista.');
    }

    const orgAdmin = await tx.user.findFirst({
      where: { organizationId, role: 'empresa_admin' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!orgAdmin) {
      throw validationError('No hay un administrador para registrar la cita.');
    }

    const parkStageId = app.stageId;
    const position = await nextPositionInStage(app.vacancyId, returnStage.id, tx);
    const moved = await tx.recruitmentApplication.updateMany({
      where: {
        id: applicationId,
        organizationId,
        stageId: parkStageId,
      },
      data: {
        stageId: returnStage.id,
        position,
        interviewNoShowFromStageId: null,
        interviewNoShowEventId: null,
        interviewScheduledAt: parsed.scheduledAt,
        interviewTimeSpecified: parsed.timeSpecified !== false,
        blocksReapplication: expectedBlocksReapplication(returnStage.key, app.closureOutcome),
      },
    });
    if (moved.count !== 1) {
      throw conflictError(
        'Esta postulación ya no está en cartera de inasistencia. Actualiza e inténtalo de nuevo.',
      );
    }
    await recordParkStageEvent(tx, {
      organizationId,
      applicationId,
      fromStageId: parkStageId,
      toStageId: returnStage.id,
      changedByUserId: orgAdmin.id,
    });

    const event = await tx.recruitmentApplicationInterviewEvent.create({
      data: {
        organizationId,
        applicationId,
        stageId: returnStage.id,
        eventType: 'SCHEDULED',
        scheduledAt: parsed.scheduledAt,
        scheduledTimeSpecified: parsed.timeSpecified !== false,
        label: null,
        comment: null,
        createdByUserId: orgAdmin.id,
      },
      include: {
        stage: { select: { id: true, key: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    const updated = await tx.recruitmentApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: {
        stage: true,
        candidate: { select: { id: true, fullName: true } },
        vacancy: { select: { id: true, title: true } },
      },
    });

    return {
      application: updated,
      interview: {
        id: event.id,
        applicationId: event.applicationId,
        eventType: event.eventType,
        scheduledAt: event.scheduledAt.toISOString(),
        scheduledTimeSpecified: event.scheduledTimeSpecified !== false,
        stageId: event.stageId,
        stageKey: event.stage?.key ?? null,
        stageName: event.stage?.name ?? null,
      },
      returnStage: { id: returnStage.id, key: returnStage.key, name: returnStage.name },
    };
  });
}

export { INTERVIEW_NO_SHOW_STAGE_KEY };

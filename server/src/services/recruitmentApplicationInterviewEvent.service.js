import { prisma } from '../db/client.js';
import {
  parseInterviewScheduleFields,
  stageKeyAllowsInterviewSchedule,
} from './recruitmentInterviewSchedule.service.js';
import { resolveOrganizationIanaTimezone } from './organizationTimezone.service.js';

export const RECRUITMENT_APPLICATION_INTERVIEW_EVENT_TYPES = new Set([
  'ATTENDED',
  'NO_SHOW',
  'RESCHEDULED',
]);

export const INTERVIEW_EVENT_STALE_MESSAGE =
  'La entrevista cambió mientras realizabas esta acción. Actualiza e inténtalo nuevamente.';

export function interviewScheduleSlotsEqual(aAt, aTimeSpecified, bAt, bTimeSpecified) {
  if (!aAt || !bAt) return false;
  const aSpec = aTimeSpecified !== false;
  const bSpec = bTimeSpecified !== false;
  return aAt.getTime() === bAt.getTime() && aSpec === bSpec;
}

export function serializeRecruitmentApplicationInterviewEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    applicationId: row.applicationId,
    eventType: row.eventType,
    scheduledAt: row.scheduledAt.toISOString(),
    scheduledTimeSpecified: row.scheduledTimeSpecified !== false,
    rescheduledToAt: row.rescheduledToAt ? row.rescheduledToAt.toISOString() : null,
    rescheduledToTimeSpecified:
      row.rescheduledToTimeSpecified != null ? row.rescheduledToTimeSpecified !== false : null,
    stageId: row.stageId,
    stageName: row.stage?.name ?? null,
    stageKey: row.stage?.key ?? null,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdBy?.fullName ?? null,
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

const applicationInclude = {
  vacancy: { select: { id: true, title: true, clientName: true, status: true } },
  stage: { select: { id: true, key: true, name: true } },
};

const eventInclude = {
  stage: { select: { id: true, key: true, name: true } },
  createdBy: { select: { fullName: true } },
};

async function conditionalUpdateInterviewSnapshot(tx, {
  organizationId,
  applicationId,
  expectedScheduledAt,
  expectedTimeSpecified,
  expectedStageId,
  data,
}) {
  const result = await tx.recruitmentApplication.updateMany({
    where: {
      id: applicationId,
      organizationId,
      stageId: expectedStageId,
      interviewScheduledAt: expectedScheduledAt,
      interviewTimeSpecified: expectedTimeSpecified,
    },
    data,
  });
  if (result.count !== 1) {
    throw conflictError(INTERVIEW_EVENT_STALE_MESSAGE);
  }
}

function serializeApplicationPatch(row) {
  return {
    id: row.id,
    interviewScheduledAt: row.interviewScheduledAt
      ? row.interviewScheduledAt.toISOString()
      : null,
    interviewTimeSpecified: row.interviewTimeSpecified !== false,
    stageId: row.stageId,
    stage: row.stage,
  };
}

/**
 * Registra resultado de entrevista (transaccional). Update condicional → evento.
 */
export async function recordRecruitmentApplicationInterviewEvent({
  organizationId,
  applicationId,
  eventType,
  createdByUserId,
  interviewDate,
  interviewTime,
}) {
  const type = String(eventType || '').trim();
  if (!RECRUITMENT_APPLICATION_INTERVIEW_EVENT_TYPES.has(type)) {
    throw validationError('Tipo de evento de entrevista no válido.');
  }

  return prisma.$transaction(async (tx) => {
    const app = await tx.recruitmentApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: { stage: { select: { id: true, key: true, name: true } } },
    });
    if (!app) {
      const err = new Error('NOT_FOUND');
      err.code = 'NOT_FOUND';
      err.message = 'Postulación no encontrada.';
      throw err;
    }
    if (!stageKeyAllowsInterviewSchedule(app.stage?.key)) {
      throw validationError('La acción solo aplica en etapas de entrevista.');
    }
    if (!app.interviewScheduledAt) {
      throw conflictError('No hay entrevista programada para registrar un resultado.');
    }

    const expectedScheduledAt = app.interviewScheduledAt;
    const expectedTimeSpecified = app.interviewTimeSpecified !== false;
    const expectedStageId = app.stageId;
    const scheduledAt = expectedScheduledAt;
    const scheduledTimeSpecified = expectedTimeSpecified;
    const stageId = expectedStageId;

    if (type === 'ATTENDED' || type === 'NO_SHOW') {
      await conditionalUpdateInterviewSnapshot(tx, {
        organizationId,
        applicationId,
        expectedScheduledAt,
        expectedTimeSpecified,
        expectedStageId,
        data: {
          interviewScheduledAt: null,
          interviewTimeSpecified: true,
        },
      });
      const event = await tx.recruitmentApplicationInterviewEvent.create({
        data: {
          organizationId,
          applicationId,
          stageId,
          eventType: type,
          scheduledAt,
          scheduledTimeSpecified,
          createdByUserId,
        },
        include: eventInclude,
      });
      const updated = await tx.recruitmentApplication.findFirst({
        where: { id: applicationId, organizationId },
        include: applicationInclude,
      });
      return {
        event: serializeRecruitmentApplicationInterviewEvent(event),
        application: serializeApplicationPatch(updated),
      };
    }

    const dateTrim = interviewDate != null ? String(interviewDate).trim() : '';
    if (!dateTrim) {
      throw validationError('Indica la nueva fecha de entrevista.');
    }
    const timeZone = await resolveOrganizationIanaTimezone(organizationId);
    const parsed = parseInterviewScheduleFields(
      { interviewDate: interviewDate, interviewTime: interviewTime },
      timeZone,
    );
    if (!parsed?.scheduledAt) {
      throw validationError('Indica la nueva fecha de entrevista.');
    }
    if (
      interviewScheduleSlotsEqual(
        scheduledAt,
        scheduledTimeSpecified,
        parsed.scheduledAt,
        parsed.timeSpecified,
      )
    ) {
      throw validationError('La nueva fecha de entrevista debe ser diferente a la actual.');
    }

    await conditionalUpdateInterviewSnapshot(tx, {
      organizationId,
      applicationId,
      expectedScheduledAt,
      expectedTimeSpecified,
      expectedStageId,
      data: {
        interviewScheduledAt: parsed.scheduledAt,
        interviewTimeSpecified: parsed.timeSpecified,
      },
    });
    const event = await tx.recruitmentApplicationInterviewEvent.create({
      data: {
        organizationId,
        applicationId,
        stageId,
        eventType: 'RESCHEDULED',
        scheduledAt,
        scheduledTimeSpecified,
        rescheduledToAt: parsed.scheduledAt,
        rescheduledToTimeSpecified: parsed.timeSpecified,
        createdByUserId,
      },
      include: eventInclude,
    });
    const updated = await tx.recruitmentApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: applicationInclude,
    });
    return {
      event: serializeRecruitmentApplicationInterviewEvent(event),
      application: serializeApplicationPatch(updated),
    };
  });
}

export async function listInterviewEventsForApplications(organizationId, applicationIds) {
  if (!applicationIds.length) return new Map();
  const rows = await prisma.recruitmentApplicationInterviewEvent.findMany({
    where: { organizationId, applicationId: { in: applicationIds } },
    orderBy: [{ createdAt: 'desc' }],
    include: {
      stage: { select: { id: true, key: true, name: true } },
      createdBy: { select: { fullName: true } },
    },
  });
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.applicationId)) map.set(row.applicationId, []);
    map.get(row.applicationId).push(serializeRecruitmentApplicationInterviewEvent(row));
  }
  return map;
}

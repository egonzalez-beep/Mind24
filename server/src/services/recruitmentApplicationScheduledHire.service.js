import { prisma } from '../db/client.js';
import {
  employmentStartDateToPrisma,
  parseEmploymentStartDateInput,
  serializeEmploymentStartDate,
} from './recruitmentApplication.service.js';
import { APPROVED_STAGE_KEY } from './recruitmentStage.service.js';
import {
  MIND24_DEFAULT_IANA_TIMEZONE,
  resolveOrganizationIanaTimezone,
} from './organizationTimezone.service.js';
import { localDateKey } from './remoteWorkSessionHistory.service.js';
import {
  invalidateScheduledHireNotificationsForApplication,
  scheduledHireReminderDedupeKey,
} from './orgNotification.service.js';
import { isRecruitmentApplicationOpen } from './recruitmentProcessClosure.service.js';
import { lockRecruitmentApplicationRow } from './recruitmentApplicationEmploymentExit.service.js';

export const SCHEDULED_HIRE_NOT_APPROVED_MESSAGE =
  'Solo se puede programar el ingreso en la etapa Aprobado.';
export const SCHEDULED_HIRE_NOT_OPEN_MESSAGE =
  'Solo se puede programar el ingreso en una postulación abierta en Aprobado.';
export const SCHEDULED_HIRE_PAST_MESSAGE =
  'La fecha programada de ingreso no puede ser anterior a hoy.';
export const SCHEDULED_HIRE_INVALID_MESSAGE =
  'Indica una fecha programada de ingreso válida.';

/** Vigente para programar o recordar: abierta + etapa Aprobado. */
export function isOpenApprovedForScheduledHire(stageKey, closureOutcome) {
  return (
    stageKey === APPROVED_STAGE_KEY
    && isRecruitmentApplicationOpen(stageKey, closureOutcome)
  );
}

export function serializeScheduledEmploymentStartDate(value) {
  return serializeEmploymentStartDate(value);
}

export function assertScheduledHireDateNotPast(rawDate, todayYmd) {
  const key = parseEmploymentStartDateInput(rawDate);
  if (!key) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = SCHEDULED_HIRE_INVALID_MESSAGE;
    throw err;
  }
  if (todayYmd && key < todayYmd) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = SCHEDULED_HIRE_PAST_MESSAGE;
    throw err;
  }
  return key;
}

export async function assertScheduledHireDateForOrg(organizationId, rawDate, now = new Date()) {
  const timeZone = await resolveOrganizationIanaTimezone(organizationId);
  const today = localDateKey(now, timeZone || MIND24_DEFAULT_IANA_TIMEZONE);
  return assertScheduledHireDateNotPast(rawDate, today);
}

/**
 * Invalida avisos y limpia la fecha. El caller debe poseer ya el candado de la postulación
 * (o pasar lock: true para adquirirlo aquí antes de validar/tocar avisos).
 */
export async function clearScheduledHireOnApplication(
  tx,
  { organizationId, applicationId, lock = false },
) {
  if (lock) {
    await lockRecruitmentApplicationRow(tx, organizationId, applicationId);
  }
  await invalidateScheduledHireNotificationsForApplication(tx, organizationId, applicationId);
  await tx.recruitmentApplication.update({
    where: { id: applicationId },
    data: { scheduledEmploymentStartDate: null },
  });
}

/**
 * Limpia programación si la postulación deja de estar en Aprobado.
 * Requiere candado previo de la postulación en la misma transacción.
 */
export async function clearScheduledHireIfLeavingApproved(tx, {
  organizationId,
  applicationId,
  fromKey,
  toKey,
}) {
  if (fromKey !== APPROVED_STAGE_KEY) return;
  if (toKey === APPROVED_STAGE_KEY) return;
  await invalidateScheduledHireNotificationsForApplication(tx, organizationId, applicationId);
  await tx.recruitmentApplication.update({
    where: { id: applicationId },
    data: { scheduledEmploymentStartDate: null },
  });
}

/**
 * Guarda o cambia la fecha programada de ingreso (solo Aprobado).
 * Invalida avisos de la programación anterior.
 */
export async function setRecruitmentApplicationScheduledHire({
  organizationId,
  applicationId,
  scheduledEmploymentStartDate,
  now = new Date(),
}) {
  const dateKey = await assertScheduledHireDateForOrg(
    organizationId,
    scheduledEmploymentStartDate,
    now,
  );

  const result = await prisma.$transaction(async (tx) => {
    await lockRecruitmentApplicationRow(tx, organizationId, applicationId);
    const app = await tx.recruitmentApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: {
        stage: { select: { id: true, key: true, name: true } },
        candidate: { select: { id: true, fullName: true } },
        vacancy: { select: { id: true, title: true } },
      },
    });
    if (!app) {
      const err = new Error('NOT_FOUND');
      err.code = 'NOT_FOUND';
      err.message = 'Postulación no encontrada.';
      throw err;
    }
    if (!isOpenApprovedForScheduledHire(app.stage?.key, app.closureOutcome)) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message =
        app.stage?.key === APPROVED_STAGE_KEY
          ? SCHEDULED_HIRE_NOT_OPEN_MESSAGE
          : SCHEDULED_HIRE_NOT_APPROVED_MESSAGE;
      throw err;
    }

    const prevKey = serializeEmploymentStartDate(app.scheduledEmploymentStartDate);
    if (prevKey && prevKey !== dateKey) {
      await invalidateScheduledHireNotificationsForApplication(tx, organizationId, applicationId);
    } else if (prevKey === dateKey) {
      // Misma fecha: no toca avisos; igual reescribe el campo.
    } else {
      await invalidateScheduledHireNotificationsForApplication(tx, organizationId, applicationId);
    }

    const updated = await tx.recruitmentApplication.update({
      where: { id: applicationId },
      data: { scheduledEmploymentStartDate: employmentStartDateToPrisma(dateKey) },
      include: {
        stage: { select: { id: true, key: true, name: true } },
        candidate: { select: { id: true, fullName: true } },
        vacancy: { select: { id: true, title: true } },
      },
    });
    return updated;
  });

  return {
    applicationId,
    scheduledEmploymentStartDate: dateKey,
    application: {
      id: result.id,
      candidateId: result.candidateId,
      vacancyId: result.vacancyId,
      stageId: result.stageId,
      stage: result.stage
        ? { id: result.stage.id, key: result.stage.key, name: result.stage.name }
        : null,
      scheduledEmploymentStartDate: dateKey,
      candidate: result.candidate || null,
      vacancy: result.vacancy || null,
    },
  };
}

/**
 * Quita la programación de ingreso. Conserva la etapa Aprobado.
 */
export async function clearRecruitmentApplicationScheduledHire({
  organizationId,
  applicationId,
}) {
  const result = await prisma.$transaction(async (tx) => {
    await lockRecruitmentApplicationRow(tx, organizationId, applicationId);
    const app = await tx.recruitmentApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: {
        stage: { select: { id: true, key: true, name: true } },
        candidate: { select: { id: true, fullName: true } },
        vacancy: { select: { id: true, title: true } },
      },
    });
    if (!app) {
      const err = new Error('NOT_FOUND');
      err.code = 'NOT_FOUND';
      err.message = 'Postulación no encontrada.';
      throw err;
    }
    if (!isOpenApprovedForScheduledHire(app.stage?.key, app.closureOutcome)) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message =
        app.stage?.key === APPROVED_STAGE_KEY
          ? SCHEDULED_HIRE_NOT_OPEN_MESSAGE
          : SCHEDULED_HIRE_NOT_APPROVED_MESSAGE;
      throw err;
    }
    await invalidateScheduledHireNotificationsForApplication(tx, organizationId, applicationId);
    const updated = await tx.recruitmentApplication.update({
      where: { id: applicationId },
      data: { scheduledEmploymentStartDate: null },
      include: {
        stage: { select: { id: true, key: true, name: true } },
        candidate: { select: { id: true, fullName: true } },
        vacancy: { select: { id: true, title: true } },
      },
    });
    return updated;
  });

  return {
    applicationId,
    scheduledEmploymentStartDate: null,
    application: {
      id: result.id,
      candidateId: result.candidateId,
      vacancyId: result.vacancyId,
      stageId: result.stageId,
      stage: result.stage
        ? { id: result.stage.id, key: result.stage.key, name: result.stage.name }
        : null,
      scheduledEmploymentStartDate: null,
      candidate: result.candidate || null,
      vacancy: result.vacancy || null,
    },
  };
}

export { scheduledHireReminderDedupeKey };

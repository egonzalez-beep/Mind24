import { prisma } from '../db/client.js';
import {
  employmentStartDateToPrisma,
  parseEmploymentStartDateInput,
  serializeEmploymentStartDate,
} from './recruitmentApplication.service.js';
import { HIRED_STAGE_KEY, nextHiredStageEnteredAt } from './recruitmentCoverage.service.js';
import { EMPLOYMENT_EXIT_STAGE_KEY } from './recruitmentStage.service.js';
import { resolveOrganizationIanaTimezone } from './organizationTimezone.service.js';
import { localDateKey } from './remoteWorkSessionHistory.service.js';
import {
  cancelOpenStageNovedadWaits,
  emitWorkforceRecruitmentNovedadForEmploymentExit,
} from './workforceRecruitmentNovedad.service.js';
import { expectedBlocksReapplication } from './recruitmentProcessClosure.service.js';
import { assertStageEnabledForVacancy } from './recruitmentVacancyStage.service.js';

export const EMPLOYMENT_EXIT_REASON_MAX = 160;
export const EMPLOYMENT_EXIT_MISSING_START_MESSAGE =
  'Registra primero la fecha real de ingreso con el lápiz.';
export const EMPLOYMENT_EXIT_ALREADY_MESSAGE =
  'Esta contratación ya tiene una baja registrada.';
export const EMPLOYMENT_EXIT_NOT_HIRED_MESSAGE =
  'Solo se puede registrar baja en una contratación.';
export const EMPLOYMENT_EXIT_BEFORE_START_MESSAGE =
  'La fecha de baja no puede ser anterior al ingreso.';
export const EMPLOYMENT_EXIT_AFTER_TODAY_MESSAGE =
  'La fecha de baja no puede ser posterior a hoy.';
export const EMPLOYMENT_START_AFTER_EXIT_MESSAGE =
  'La fecha de ingreso no puede ser posterior a la fecha de baja.';
export const EMPLOYMENT_EXIT_GENERIC_MOVE_MESSAGE =
  'Para pasar a Baja usa Registrar baja.';

const POSITION_GAP = 1000;

/**
 * Candado de fila por postulación (SELECT … FOR UPDATE).
 * Lo comparten baja/ingreso, programación de Aprobado, emisión del recordatorio
 * y salir de Aprobado (incluido Declinó). Adquirir antes de validar y de tocar avisos.
 */
export async function lockRecruitmentApplicationRow(
  tx,
  organizationId,
  applicationId,
) {
  if (!applicationId || !organizationId || typeof tx?.$executeRaw !== 'function') return null;
  return tx.$executeRaw`
    SELECT id FROM "RecruitmentApplication"
    WHERE id = ${applicationId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `;
}

/** Alias estable para baja e edición de fecha de ingreso. */
export async function lockRecruitmentApplicationForEmploymentDates(
  tx,
  organizationId,
  applicationId,
) {
  return lockRecruitmentApplicationRow(tx, organizationId, applicationId);
}

function normalizeExitReason(raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  if (s.length > EMPLOYMENT_EXIT_REASON_MAX) return null;
  return s;
}

export function serializeEmploymentExit(row) {
  if (!row) return null;
  return {
    id: row.id,
    exitDate: serializeEmploymentStartDate(row.exitDate),
    reason: row.reason || '',
    underWarranty: row.underWarranty === true,
    registeredByUserId: row.registeredByUserId || null,
    registeredAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}

export async function assertEmploymentExitDateForOrg({
  organizationId,
  exitDateRaw,
  employmentStartDateKey,
  now = new Date(),
}) {
  const exitKey = parseEmploymentStartDateInput(exitDateRaw);
  if (!exitKey) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Indica una fecha de baja válida (AAAA-MM-DD).';
    throw err;
  }
  const startKey = parseEmploymentStartDateInput(employmentStartDateKey);
  if (!startKey) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = EMPLOYMENT_EXIT_MISSING_START_MESSAGE;
    throw err;
  }
  if (exitKey < startKey) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = EMPLOYMENT_EXIT_BEFORE_START_MESSAGE;
    throw err;
  }
  const timeZone = await resolveOrganizationIanaTimezone(organizationId);
  const today = localDateKey(now, timeZone);
  if (exitKey > today) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = EMPLOYMENT_EXIT_AFTER_TODAY_MESSAGE;
    throw err;
  }
  return exitKey;
}

/**
 * Al editar ingreso con baja ya registrada: el ingreso debe ser ≤ fecha de baja.
 */
export function assertEmploymentStartCompatibleWithExit(startKey, exitKey) {
  if (!startKey || !exitKey) return;
  if (startKey > exitKey) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = EMPLOYMENT_START_AFTER_EXIT_MESSAGE;
    throw err;
  }
}

function isApplicationUniqueConflict(err) {
  if (err?.code !== 'P2002') return false;
  const target = err.meta?.target;
  const parts = Array.isArray(target) ? target : target != null ? [target] : [];
  return parts.some((t) => String(t).includes('applicationId'));
}

async function nextPositionInExitStage(tx, vacancyId, stageId) {
  const agg = await tx.recruitmentApplication.aggregate({
    where: { vacancyId, stageId },
    _max: { position: true },
  });
  return (agg._max.position ?? 0) + POSITION_GAP;
}

/**
 * Registra la baja 1:1, mueve a etapa Baja, registra transición y emite aviso deduplicado.
 * Única entrada permitida a EMPLOYMENT_EXIT. Conserva employmentStartDate.
 */
export async function registerRecruitmentApplicationEmploymentExit({
  organizationId,
  applicationId,
  exitDate,
  reason,
  underWarranty,
  registeredByUserId,
  now = new Date(),
}) {
  if (underWarranty !== true && underWarranty !== false) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Indica si aplica garantía: Sí o No.';
    throw err;
  }
  const normalizedReason = normalizeExitReason(reason);
  if (!normalizedReason) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = `Escribe un motivo de baja breve (máx. ${EMPLOYMENT_EXIT_REASON_MAX} caracteres).`;
    throw err;
  }
  if (!registeredByUserId) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Falta el administrador que registra la baja.';
    throw err;
  }

  let created;
  let startKey;
  let application = null;
  let vacancyId = null;
  let candidateName = null;
  let vacancyTitle = null;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockRecruitmentApplicationForEmploymentDates(tx, organizationId, applicationId);

      const app = await tx.recruitmentApplication.findFirst({
        where: { id: applicationId, organizationId },
        include: {
          stage: { select: { id: true, key: true, name: true } },
          employmentExit: true,
          vacancy: { select: { id: true, title: true } },
          candidate: { select: { id: true, fullName: true } },
        },
      });
      if (!app) {
        const err = new Error('NOT_FOUND');
        err.code = 'NOT_FOUND';
        err.message = 'Postulación no encontrada.';
        throw err;
      }
      if (app.stage?.key !== HIRED_STAGE_KEY) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        err.message = EMPLOYMENT_EXIT_NOT_HIRED_MESSAGE;
        throw err;
      }
      if (app.employmentExit) {
        const err = new Error('CONFLICT');
        err.code = 'CONFLICT';
        err.message = EMPLOYMENT_EXIT_ALREADY_MESSAGE;
        throw err;
      }

      startKey = serializeEmploymentStartDate(app.employmentStartDate);
      if (!startKey) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        err.message = EMPLOYMENT_EXIT_MISSING_START_MESSAGE;
        throw err;
      }

      const exitKey = await assertEmploymentExitDateForOrg({
        organizationId,
        exitDateRaw: exitDate,
        employmentStartDateKey: startKey,
        now,
      });

      const exitStage = await tx.recruitmentStage.findFirst({
        where: { organizationId, key: EMPLOYMENT_EXIT_STAGE_KEY, isActive: true },
        select: { id: true, key: true, name: true },
      });
      if (!exitStage) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        err.message = 'La etapa Baja no está configurada en la organización.';
        throw err;
      }
      await assertStageEnabledForVacancy(organizationId, app.vacancyId, exitStage.id, tx);

      const row = await tx.recruitmentApplicationEmploymentExit.create({
        data: {
          organizationId,
          applicationId: app.id,
          exitDate: employmentStartDateToPrisma(exitKey),
          reason: normalizedReason,
          underWarranty,
          registeredByUserId,
          createdAt: now,
        },
      });

      const position = await nextPositionInExitStage(tx, app.vacancyId, exitStage.id);
      await cancelOpenStageNovedadWaits(tx, app.id);
      await tx.recruitmentApplication.update({
        where: { id: app.id },
        data: {
          stageId: exitStage.id,
          position,
          hiredStageEnteredAt: nextHiredStageEnteredAt({
            fromKey: HIRED_STAGE_KEY,
            toKey: EMPLOYMENT_EXIT_STAGE_KEY,
            previousEnteredAt: app.hiredStageEnteredAt,
            now,
          }),
          blocksReapplication: expectedBlocksReapplication(EMPLOYMENT_EXIT_STAGE_KEY, null),
        },
      });
      await tx.recruitmentApplicationStageEvent.create({
        data: {
          organizationId,
          applicationId: app.id,
          fromStageId: app.stageId,
          toStageId: exitStage.id,
          changedByUserId: registeredByUserId,
          novedadEligibleAt: null,
          createdAt: now,
        },
      });

      await emitWorkforceRecruitmentNovedadForEmploymentExit(tx, {
        organizationId,
        applicationId: app.id,
        exitDateKey: exitKey,
        underWarranty,
      });

      const updated = await tx.recruitmentApplication.findFirst({
        where: { id: app.id, organizationId },
        include: {
          stage: { select: { id: true, key: true, name: true } },
          employmentExit: true,
          candidate: true,
        },
      });

      return {
        exit: row,
        application: updated,
        vacancyId: app.vacancyId,
        candidateName: app.candidate?.fullName || null,
        vacancyTitle: app.vacancy?.title || null,
      };
    });
    created = result.exit;
    application = result.application;
    vacancyId = result.vacancyId;
    candidateName = result.candidateName;
    vacancyTitle = result.vacancyTitle;
  } catch (e) {
    if (isApplicationUniqueConflict(e)) {
      const err = new Error('CONFLICT');
      err.code = 'CONFLICT';
      err.message = EMPLOYMENT_EXIT_ALREADY_MESSAGE;
      throw err;
    }
    throw e;
  }

  if (vacancyId) {
    try {
      const { reconcileVacancyCoverage } = await import('./recruitmentCoverage.service.js');
      await reconcileVacancyCoverage(organizationId, vacancyId, now);
    } catch (_e) {
      /* cobertura: no aborta la baja ya persistida */
    }
  }

  return {
    applicationId,
    employmentStartDate: startKey,
    employmentExit: serializeEmploymentExit(created),
    application: application
      ? {
          id: application.id,
          candidateId: application.candidateId,
          vacancyId: application.vacancyId,
          stageId: application.stageId,
          stage: application.stage
            ? {
                id: application.stage.id,
                key: application.stage.key,
                name: application.stage.name,
              }
            : null,
          employmentStartDate: startKey,
          employmentExit: serializeEmploymentExit(application.employmentExit || created),
          hiredStageEnteredAt: application.hiredStageEnteredAt
            ? application.hiredStageEnteredAt.toISOString()
            : null,
          blocksReapplication: application.blocksReapplication !== false,
        }
      : null,
    candidateName,
    vacancyTitle,
  };
}

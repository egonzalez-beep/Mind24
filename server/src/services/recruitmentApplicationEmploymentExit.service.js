import { prisma } from '../db/client.js';
import {
  employmentStartDateToPrisma,
  parseEmploymentStartDateInput,
  serializeEmploymentStartDate,
} from './recruitmentApplication.service.js';
import { HIRED_STAGE_KEY } from './recruitmentCoverage.service.js';
import { resolveOrganizationIanaTimezone } from './organizationTimezone.service.js';
import { localDateKey } from './remoteWorkSessionHistory.service.js';
import { emitWorkforceRecruitmentNovedadForEmploymentExit } from './workforceRecruitmentNovedad.service.js';

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

/**
 * Candado compartido por postulación para baja e ingreso.
 * Serializa ambas escrituras: releer y validar fechas después de adquirirlo.
 */
export async function lockRecruitmentApplicationForEmploymentDates(
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

/**
 * Registra la baja 1:1 de una contratación HIRED.
 * Conserva HIRED y employmentStartDate. Emite una novedad deduplicada (opcional si no hay destinatario).
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
  let candidateName = null;
  let vacancyTitle = null;
  try {
    created = await prisma.$transaction(async (tx) => {
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

      candidateName = app.candidate?.fullName || null;
      vacancyTitle = app.vacancy?.title || null;

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
      await emitWorkforceRecruitmentNovedadForEmploymentExit(tx, {
        organizationId,
        applicationId: app.id,
        exitDateKey: exitKey,
        underWarranty,
      });
      return row;
    });
  } catch (e) {
    if (isApplicationUniqueConflict(e)) {
      const err = new Error('CONFLICT');
      err.code = 'CONFLICT';
      err.message = EMPLOYMENT_EXIT_ALREADY_MESSAGE;
      throw err;
    }
    throw e;
  }

  return {
    applicationId,
    employmentStartDate: startKey,
    employmentExit: serializeEmploymentExit(created),
    candidateName,
    vacancyTitle,
  };
}

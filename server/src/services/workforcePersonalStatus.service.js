import { z } from 'zod';
import { prisma } from '../db/client.js';
import { assertWorkforceEmployeeInOrg } from './workforceEmployee.service.js';

export const PERSONAL_STATUS_MAX_CHARS = 80;

export const personalStatusBodySchema = z.object({ message: z.string() }).strict();

/**
 * Un mensaje vacío después de normalizar equivale a quitar el estado.
 * No se recorta en silencio: más de 80 caracteres Unicode es validación.
 */
export function normalizePersonalStatusMessage(value) {
  if (typeof value !== 'string') {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'El mensaje de estado no es válido.';
    throw err;
  }
  const compact = value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (Array.from(compact).length > PERSONAL_STATUS_MAX_CHARS) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'El mensaje de estado admite como máximo 80 caracteres.';
    throw err;
  }
  return compact;
}

export function publicPersonalStatusDto(emp) {
  return {
    personalStatusMessage: emp?.personalStatusMessage ?? null,
    personalStatusUpdatedAt: emp?.personalStatusUpdatedAt
      ? new Date(emp.personalStatusUpdatedAt).toISOString()
      : null,
  };
}

async function writePersonalStatus(employeeId, organizationId, message) {
  await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const cleared = !message;
  await prisma.workforceEmployee.updateMany({
    where: { id: employeeId, organizationId },
    data: {
      personalStatusMessage: cleared ? null : message,
      personalStatusUpdatedAt: cleared ? null : new Date(),
    },
  });
  return prisma.workforceEmployee.findFirst({
    where: { id: employeeId, organizationId },
  });
}

export async function saveWorkforcePersonalStatus({ employeeId, organizationId, message }) {
  const normalized = normalizePersonalStatusMessage(message);
  return writePersonalStatus(employeeId, organizationId, normalized);
}

export async function clearWorkforcePersonalStatus({ employeeId, organizationId }) {
  return writePersonalStatus(employeeId, organizationId, '');
}

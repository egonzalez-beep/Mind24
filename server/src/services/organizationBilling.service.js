/**
 * Cobro B2B por token: 1 crédito de organización al cerrar una batería completa.
 */

import { prisma } from '../db/client.js';

export async function assertOrganizationHasAssignmentCredits(tx, organizationId) {
  const org = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, credits: true, blocked: true },
  });
  if (!org || org.blocked) {
    const err = new Error('ORG_BLOCKED');
    err.code = 'ORG_BLOCKED';
    throw err;
  }
  if (org.credits < 1) {
    const err = new Error('Créditos insuficientes para asignar nuevas evaluaciones.');
    err.code = 'NO_CREDITS';
    throw err;
  }
  return org;
}

/**
 * Paso 1 (dentro de la tx principal): marca la asignación como completada y reserva el crédito
 * de forma atómica usando el candado `creditDeducted`.
 *
 * @returns {{ allDone: boolean, claimed: boolean }} — `claimed: true` si hay que descontar crédito.
 */
export async function applyAssignmentCompletionUpdate(
  tx,
  {
    assignmentId,
    organizationId,
    nextCompleted,
    allDone,
  },
) {
  console.log('[BILLING] applyAssignmentCompletionUpdate →', {
    assignmentId,
    organizationId,
    allDone,
    nextCompleted,
    totalCompleted: nextCompleted.length,
  });

  if (!allDone) {
    await tx.assignment.update({
      where: { id: assignmentId },
      data: {
        completedModules: nextCompleted,
        status: 'in_progress',
      },
    });
    console.log('[BILLING] allDone=false — asignación marcada in_progress, sin cobro.');
    return { allDone: false, claimed: false };
  }

  // Claim atómico: solo el primer hilo que llegue aquí con creditDeducted=false gana el descuento.
  const claimed = await tx.assignment.updateMany({
    where: {
      id: assignmentId,
      creditDeducted: false,
    },
    data: {
      completedModules: nextCompleted,
      status: 'completed',
      creditDeducted: true,
    },
  });

  console.log('[BILLING] Credit claim updateMany result:', claimed, '(claimed.count>0 → cobrar)');

  if (claimed.count === 0) {
    // Ya fue cobrado en un intento anterior (idempotencia).
    // Aún actualizamos completedModules para no perder el progreso si el status ya era completed.
    await tx.assignment.update({
      where: { id: assignmentId },
      data: { completedModules: nextCompleted, status: 'completed' },
    });
    console.log('[BILLING] Claim ya tomado (creditDeducted ya era true). Sin cobro adicional.');
    return { allDone: true, claimed: false };
  }

  console.log('[BILLING] Claim exitoso — se descargará 1 crédito de org', organizationId, 'post-tx.');
  return { allDone: true, claimed: true };
}

/**
 * Paso 2 (FUERA de la tx principal): descuenta 1 crédito de la organización.
 * Se llama sólo cuando `applyAssignmentCompletionUpdate` devuelve `claimed: true`.
 *
 * Usar `prisma` (cliente raíz), no `tx`, para que no revierta el intento completado.
 */
export async function chargeOrganizationCreditPostTx(organizationId) {
  console.log('[BILLING] chargeOrganizationCreditPostTx → org', organizationId);

  if (!organizationId) {
    console.warn('[BILLING] organizationId es null/undefined — sin cobro.');
    return { charged: false, reason: 'NO_ORG_ID' };
  }

  const result = await prisma.organization.updateMany({
    where: { id: organizationId, credits: { gte: 1 } },
    data: { credits: { decrement: 1 } },
  });

  if (result.count === 0) {
    console.warn('[BILLING] org', organizationId, 'ya tenía 0 créditos al momento del cobro — inconsistencia de saldo.');
    return { charged: false, reason: 'CREDITS_ALREADY_ZERO' };
  }

  console.log('[BILLING] ✅ Crédito descontado exitosamente de org', organizationId);
  return { charged: true };
}

/**
 * @deprecated Sustituida por applyAssignmentCompletionUpdate + chargeOrganizationCreditPostTx.
 */
export async function chargeOrganizationOnBatteryCompleted(tx, organizationId) {
  const result = await tx.organization.updateMany({
    where: { id: organizationId, credits: { gte: 1 } },
    data: { credits: { decrement: 1 } },
  });

  if (result.count === 0) {
    const err = new Error(
      'Créditos insuficientes para registrar el cierre de la batería de evaluación.',
    );
    err.code = 'NO_CREDITS';
    throw err;
  }

  return { charged: true };
}

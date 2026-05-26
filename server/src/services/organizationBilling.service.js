/**
 * Cobro B2B por token: 1 crédito de organización al cerrar una batería completa.
 */

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
 * Descuenta 1 crédito cuando la asignación pasa a `completed` por primera vez.
 * Idempotente si la asignación ya estaba en `completed`.
 */
export async function chargeOrganizationOnBatteryCompleted(
  tx,
  organizationId,
  previousAssignmentStatus,
) {
  if (previousAssignmentStatus === 'completed') {
    return { charged: false };
  }

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

/**
 * Actualiza progreso de módulos y cobra al completar la batería en la misma transacción.
 */
export async function applyAssignmentCompletionUpdate(
  tx,
  {
    assignmentId,
    organizationId,
    previousStatus,
    nextCompleted,
    allDone,
  },
) {
  await tx.assignment.update({
    where: { id: assignmentId },
    data: {
      completedModules: nextCompleted,
      status: allDone ? 'completed' : 'in_progress',
    },
  });

  if (allDone) {
    await chargeOrganizationOnBatteryCompleted(tx, organizationId, previousStatus);
  }
}

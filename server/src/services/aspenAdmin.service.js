import { prisma } from '../db/client.js';
import { hashPassword } from './auth.service.js';
import { generateRandomPassword } from './superadmin.service.js';

const DEFAULT_PIONEER = 'admin@demo.mind24.com';

function pioneerEmailNormalized() {
  return (process.env.ASPEN_PIONEER_ADMIN_EMAIL || DEFAULT_PIONEER).trim().toLowerCase();
}

/** Correo pionero que puede crear otros admins Aspen (configurable con ASPEN_PIONEER_ADMIN_EMAIL). */
export const PIONEER_ASPEN_ADMIN_EMAIL = DEFAULT_PIONEER;

export function isPioneerAspenAdminEmail(email) {
  return Boolean(email && String(email).trim().toLowerCase() === pioneerEmailNormalized());
}

export async function listAspenAdminsInOrganization(organizationId) {
  return prisma.user.findMany({
    where: { organizationId, role: 'empresa_admin' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      email: true,
      fullName: true,
      adminCredits: true,
      createdAt: true,
    },
  });
}

/**
 * Crea otro empresa_admin en la misma org con contraseña aleatoria y saldo adminCredits inicial.
 */
export async function provisionAspenAdminPeer({
  pioneerUserId,
  email,
  fullName,
  credits,
}) {
  const pioneer = await prisma.user.findUnique({ where: { id: pioneerUserId } });
  if (!pioneer || pioneer.role !== 'empresa_admin' || !pioneer.organizationId) {
    const err = new Error('No autorizado.');
    err.code = 'FORBIDDEN';
    throw err;
  }
  if (!isPioneerAspenAdminEmail(pioneer.email)) {
    const err = new Error('Solo la cuenta pionera puede crear administradores.');
    err.code = 'FORBIDDEN';
    throw err;
  }
  const n = Number(credits);
  if (Number.isNaN(n) || n < 1 || n > 1_000_000) {
    const err = new Error('Los créditos deben ser un entero entre 1 y 1 000 000.');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const em = email.trim().toLowerCase();
  if (em === pioneerEmailNormalized()) {
    const err = new Error('No puedes duplicar la cuenta pionera.');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const exists = await prisma.user.findUnique({ where: { email: em } });
  if (exists) {
    const err = new Error('El correo ya está registrado.');
    err.code = 'EMAIL_IN_USE';
    throw err;
  }
  const plainPassword = generateRandomPassword(14);
  const passwordHash = await hashPassword(plainPassword);
  const fn = String(fullName).trim();
  const user = await prisma.user.create({
    data: {
      email: em,
      passwordHash,
      fullName: fn,
      role: 'empresa_admin',
      organizationId: pioneer.organizationId,
      adminCredits: n,
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      adminCredits: true,
      createdAt: true,
    },
  });
  return { user, generatedPassword: plainPassword };
}

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../db/client.js';
import { env } from '../config/env.js';
import { hashPassword } from './auth.service.js';
import { updateOrganization } from './organization.service.js';

export async function verifySuperAdminCredentials(email, password) {
  const em = email.trim().toLowerCase();
  if (em !== env.SUPERADMIN_EMAIL) return false;
  return bcrypt.compare(password, env.SUPERADMIN_PASSWORD_BCRYPT);
}

export function generateRandomPassword(len = 16) {
  return crypto.randomBytes(Math.ceil(len * 0.75)).toString('base64url').slice(0, len);
}

export async function createCompanyWithAdmin({
  orgName,
  slug,
  adminEmail,
  adminFullName,
  initialCredits = 0,
}) {
  const em = adminEmail.trim().toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email: em } });
  if (exists) {
    const err = new Error('El correo del administrador ya está registrado.');
    err.code = 'EMAIL_IN_USE';
    throw err;
  }
  const plainPassword = generateRandomPassword(14);
  const passwordHash = await hashPassword(plainPassword);

  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: orgName.trim(),
        slug: slug?.trim() || null,
        credits: Math.max(0, initialCredits),
        blocked: false,
        empresaPortalEnabled: true,
      },
    });
    const admin = await tx.user.create({
      data: {
        email: em,
        passwordHash,
        fullName: adminFullName.trim(),
        role: 'empresa_admin',
        organizationId: org.id,
      },
    });
    return { organization: org, admin, plainPassword };
  });
}

export async function deleteOrganizationById(id) {
  await prisma.organization.delete({
    where: { id },
  });
}

export async function listAllSubmittedEvaluations({ take = 300 } = {}) {
  return prisma.assessmentAttempt.findMany({
    where: { status: 'submitted' },
    orderBy: { submittedAt: 'desc' },
    take,
    include: {
      assignment: {
        include: {
          assessmentDefinition: { select: { id: true, name: true, key: true } },
          candidate: {
            include: {
              user: { select: { email: true, fullName: true } },
              organization: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
}

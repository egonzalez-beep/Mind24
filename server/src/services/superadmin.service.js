import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { hashPassword } from './auth.service.js';

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

/**
 * Crea empresa_admin o candidato (con perfil) en una organización.
 * `creditsGrantToOrg` opcional: suma 10–1000 créditos (tokens) a la empresa.
 */
export async function createUserInOrganizationForMaster({
  organizationId,
  email,
  fullName,
  password,
  role,
  creditsGrantToOrg,
}) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) {
    const err = new Error('Organización no encontrada.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const em = email.trim().toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email: em } });
  if (exists) {
    const err = new Error('El correo ya está registrado.');
    err.code = 'EMAIL_IN_USE';
    throw err;
  }
  if (role !== 'empresa_admin' && role !== 'candidato') {
    const err = new Error('Rol inválido.');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  let plainReveal = null;
  const useProvided = typeof password === 'string' && password.length >= 8;
  if (!useProvided) {
    plainReveal = generateRandomPassword(14);
  }
  const passwordHash = await hashPassword(useProvided ? password : plainReveal);

  return prisma.$transaction(async (tx) => {
    if (creditsGrantToOrg != null) {
      const n = Number(creditsGrantToOrg);
      if (Number.isNaN(n) || n < 10 || n > 1000) {
        const err = new Error('Los tokens para la empresa deben estar entre 10 y 1000.');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
      await tx.organization.update({
        where: { id: organizationId },
        data: { credits: { increment: n } },
      });
    }

    const user = await tx.user.create({
      data: {
        email: em,
        passwordHash,
        fullName: fullName.trim(),
        role,
        organizationId,
      },
    });

    let candidate = null;
    if (role === 'candidato') {
      candidate = await tx.candidate.create({
        data: { organizationId, userId: user.id },
      });
    }

    const out = {
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
      candidateId: candidate?.id ?? null,
      organizationId,
    };
    if (plainReveal) out.generatedPassword = plainReveal;
    return out;
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

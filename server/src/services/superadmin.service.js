import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { hashPassword } from './auth.service.js';

export function generateRandomPassword(len = 16) {
  return crypto.randomBytes(Math.ceil(len * 0.75)).toString('base64url').slice(0, len);
}

/**
 * Alta rápida: nueva organización + admin empresa. Tokens 1–1000 → créditos iniciales de la org.
 * Contraseña aleatoria; nota opcional solo visible para master_admin.
 */
export async function createEmpresaAdminQuick({ email, fullName, tokens, adminNote }) {
  const n = Number(tokens);
  if (Number.isNaN(n) || n < 1 || n > 1000) {
    const err = new Error('Los tokens deben estar entre 1 y 1000.');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const em = email.trim().toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email: em } });
  if (exists) {
    const err = new Error('El correo del administrador ya está registrado.');
    err.code = 'EMAIL_IN_USE';
    throw err;
  }
  const rawName =
    fullName && String(fullName).trim().length >= 2
      ? String(fullName).trim()
      : em.split('@')[0].replace(/[._-]+/g, ' ').trim() || 'Administrador';
  const plainPassword = generateRandomPassword(14);
  const passwordHash = await hashPassword(plainPassword);
  const slugBase = em
    .split('@')[0]
    .replace(/[^a-z0-9]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 24) || 'org';
  const slug = `${slugBase}-${crypto.randomBytes(4).toString('hex')}`;
  const note = adminNote && String(adminNote).trim() ? String(adminNote).trim() : null;

  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: `Empresa — ${rawName}`,
        slug,
        credits: n,
        blocked: false,
        empresaPortalEnabled: true,
      },
    });
    const admin = await tx.user.create({
      data: {
        email: em,
        passwordHash,
        fullName: rawName,
        role: 'empresa_admin',
        organizationId: org.id,
        adminNote: note,
      },
    });
    return {
      organization: { id: org.id, name: org.name, slug: org.slug, credits: org.credits },
      admin: { id: admin.id, email: admin.email, fullName: admin.fullName, role: admin.role },
      generatedPassword: plainPassword,
      tokensAssigned: n,
    };
  });
}

export async function listEmpresaAdminsForMaster() {
  return prisma.user.findMany({
    where: { role: 'empresa_admin' },
    orderBy: { createdAt: 'desc' },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          credits: true,
          blocked: true,
          empresaPortalEnabled: true,
        },
      },
    },
  });
}

/** Todos los usuarios registrados (visión master): empresa, rol, candidato, notas. */
export async function listAllRegistrationsForMaster({ take = 3000 } = {}) {
  return prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          credits: true,
          blocked: true,
          empresaPortalEnabled: true,
        },
      },
      candidateProfile: {
        select: { id: true, createdAt: true },
      },
    },
  });
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

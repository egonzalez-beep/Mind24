import { prisma } from '../db/client.js';
import { hashPassword } from './auth.service.js';

export async function assertEmpresaAdmin(userId) {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || u.role !== 'empresa_admin') {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    throw err;
  }
  return u;
}

/**
 * Find-or-create candidato por correo en la organización.
 * Si el correo ya existe: reutiliza el registro maestro sin sobreescribir CURP, nombre ni contraseña.
 * La nueva evaluación se crea vinculando una asignación aparte (POST /api/org/assignments).
 */
export async function createCandidateForOrg({
  organizationId,
  email,
  fullName,
  password,
  createdByUserId: _createdByUserId,
  curp,
}) {
  const em = email.trim().toLowerCase();
  const curpNorm =
    curp != null && String(curp).trim() !== '' ? String(curp).trim().toUpperCase() : null;

  const existing = await prisma.user.findUnique({
    where: { email: em },
    include: { candidateProfile: true },
  });

  if (existing) {
    if (existing.role !== 'candidato') {
      const err = new Error('EMAIL_IN_USE');
      err.code = 'EMAIL_IN_USE';
      err.message = 'El correo ya está registrado con otro rol en la plataforma.';
      throw err;
    }
    if (existing.organizationId !== organizationId) {
      const err = new Error('EMAIL_IN_USE');
      err.code = 'EMAIL_IN_USE';
      err.message = 'El correo pertenece a otra organización.';
      throw err;
    }

    return prisma.$transaction(async (tx) => {
      let candidate = existing.candidateProfile;
      if (!candidate) {
        candidate = await tx.candidate.create({
          data: {
            organizationId,
            userId: existing.id,
            curp: curpNorm,
          },
        });
      }

      return { user: existing, candidate, reused: true };
    });
  }

  const passwordHash = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: em,
        passwordHash,
        fullName: fullName.trim(),
        role: 'candidato',
        organizationId,
      },
    });
    const candidate = await tx.candidate.create({
      data: {
        organizationId,
        userId: user.id,
        curp: curpNorm,
      },
    });
    return { user, candidate, reused: false };
  });
}

export async function listCandidates(organizationId) {
  return prisma.candidate.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, email: true, fullName: true, createdAt: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

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

export async function createCandidateForOrg({ organizationId, email, fullName, password, createdByUserId, curp }) {
  const em = email.trim().toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email: em } });
  if (exists) {
    const err = new Error('EMAIL_IN_USE');
    err.code = 'EMAIL_IN_USE';
    throw err;
  }
  const passwordHash = await hashPassword(password);
  const curpNorm = curp != null && String(curp).trim() !== '' ? String(curp).trim().toUpperCase() : null;
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
    return { user, candidate };
  });
}

export async function listCandidates(organizationId) {
  return prisma.candidate.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, email: true, fullName: true, createdAt: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

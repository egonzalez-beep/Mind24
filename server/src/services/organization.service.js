import { prisma } from '../db/client.js';

export async function listOrganizations() {
  return prisma.organization.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { users: true, candidates: true } } },
  });
}

export async function createOrganization({ name, slug, credits = 0, empresaPortalEnabled = false }) {
  return prisma.organization.create({
    data: {
      name: name.trim(),
      slug: slug?.trim() || null,
      credits,
      empresaPortalEnabled,
    },
  });
}

export async function updateOrganization(id, { blocked, creditsDelta, name }) {
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id } });
    if (!org) {
      const err = new Error('NOT_FOUND');
      err.code = 'NOT_FOUND';
      throw err;
    }
    const data = {};
    const where = { id };
    if (typeof blocked === 'boolean') data.blocked = blocked;
    if (name !== undefined) data.name = name.trim();
    if (typeof creditsDelta === 'number' && creditsDelta !== 0) {
      data.credits = { increment: creditsDelta };
      if (creditsDelta < 0) where.credits = { gte: -creditsDelta };
    }
    if (Object.keys(data).length === 0) return org;
    const written = await tx.organization.updateMany({ where, data });
    if (written.count !== 1) {
      const code = where.credits ? 'INSUFFICIENT_CREDITS' : 'NOT_FOUND';
      const err = new Error(code);
      err.code = code;
      throw err;
    }
    return tx.organization.findUnique({ where: { id } });
  });
}

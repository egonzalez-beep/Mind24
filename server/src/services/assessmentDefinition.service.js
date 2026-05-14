import { prisma } from '../db/client.js';

export async function listDefinitionsForOrg(organizationId) {
  return prisma.assessmentDefinition.findMany({
    where: {
      isActive: true,
      OR: [{ organizationId: null }, { organizationId }],
    },
    orderBy: [{ key: 'asc' }, { version: 'desc' }],
  });
}

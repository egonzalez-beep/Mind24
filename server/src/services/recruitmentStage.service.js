import { prisma } from '../db/client.js';

export const RECRUITMENT_DEFAULT_STAGES = [
  { key: 'NEW', name: 'Nuevo', position: 1000, isTerminal: false },
  { key: 'CONTACT', name: 'Contactación', position: 2000, isTerminal: false },
  { key: 'INITIAL_INTERVIEW', name: 'Entrevista inicial', position: 3000, isTerminal: false },
  { key: 'CLIENT_INTERVIEW', name: 'Entrevista cliente / supervisor', position: 4000, isTerminal: false },
  { key: 'EVALUATIONS', name: 'Evaluaciones', position: 5000, isTerminal: false },
  { key: 'PSYCHOMETRICS', name: 'Psicometría', position: 6000, isTerminal: false },
  { key: 'FINALIST', name: 'Finalista', position: 7000, isTerminal: false },
  { key: 'HIRED', name: 'Contratado', position: 8000, isTerminal: true },
  { key: 'REJECTED', name: 'Descartado', position: 9000, isTerminal: true },
];

export const RECRUITMENT_VACANCY_STATUSES = ['ACTIVE', 'PAUSED', 'COVERED', 'CLOSED'];

export function serializeRecruitmentStage(stage) {
  return {
    id: stage.id,
    key: stage.key,
    name: stage.name,
    position: stage.position,
    isTerminal: stage.isTerminal,
    isActive: stage.isActive,
  };
}

export async function ensureOrganizationRecruitmentStages(organizationId, tx = prisma) {
  await tx.recruitmentStage.createMany({
    data: RECRUITMENT_DEFAULT_STAGES.map((s) => ({
      organizationId,
      key: s.key,
      name: s.name,
      position: s.position,
      isTerminal: s.isTerminal,
      isActive: true,
    })),
    skipDuplicates: true,
  });
}

export async function getStageByKeyForOrg(organizationId, key, tx = prisma) {
  await ensureOrganizationRecruitmentStages(organizationId, tx);
  const stage = await tx.recruitmentStage.findFirst({
    where: { organizationId, key, isActive: true },
  });
  if (!stage) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Etapa de reclutamiento no encontrada.';
    throw err;
  }
  return stage;
}

export async function assertRecruitmentStageInOrg(stageId, organizationId, tx = prisma) {
  const stage = await tx.recruitmentStage.findFirst({
    where: { id: stageId, organizationId, isActive: true },
  });
  if (!stage) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Etapa no encontrada.';
    throw err;
  }
  return stage;
}

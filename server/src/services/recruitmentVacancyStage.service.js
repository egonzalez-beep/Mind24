import { prisma } from '../db/client.js';
import {
  ensureOrganizationRecruitmentStages,
  serializeRecruitmentStage,
} from './recruitmentStage.service.js';

async function assertVacancyInOrg(vacancyId, organizationId, tx = prisma) {
  const row = await tx.recruitmentVacancy.findFirst({
    where: { id: vacancyId, organizationId },
  });
  if (!row) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Vacante no encontrada.';
    throw err;
  }
  return row;
}

export const VACANCY_STAGE_POSITION_GAP = 1000;
export const REQUIRED_VACANCY_STAGE_KEYS = ['NEW', 'HIRED', 'REJECTED'];

export function serializeRecruitmentVacancyStage(row) {
  return {
    id: row.id,
    vacancyId: row.vacancyId,
    stageId: row.stageId,
    position: row.position,
    isEnabled: row.isEnabled,
    stage: row.stage ? serializeRecruitmentStage(row.stage) : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Crea filas VacancyStage para todas las etapas activas del catálogo org (orden catalog.position).
 * Idempotente vía skipDuplicates en unique (vacancyId, stageId).
 */
export async function seedVacancyStagesFromOrganizationCatalog(organizationId, vacancyId, tx = prisma) {
  await ensureOrganizationRecruitmentStages(organizationId, tx);
  const orgStages = await tx.recruitmentStage.findMany({
    where: { organizationId, isActive: true },
    orderBy: { position: 'asc' },
  });
  if (!orgStages.length) return;
  await tx.recruitmentVacancyStage.createMany({
    data: orgStages.map((s, i) => ({
      organizationId,
      vacancyId,
      stageId: s.id,
      position: (i + 1) * VACANCY_STAGE_POSITION_GAP,
      isEnabled: true,
    })),
    skipDuplicates: true,
  });
}

/** Si la vacante no tiene configuración, inicializa desde catálogo activo. Idempotente. */
export async function ensureVacancyRecruitmentStages(organizationId, vacancyId, tx = prisma) {
  await assertVacancyInOrg(vacancyId, organizationId, tx);
  const count = await tx.recruitmentVacancyStage.count({
    where: { organizationId, vacancyId },
  });
  if (count > 0) return;
  await seedVacancyStagesFromOrganizationCatalog(organizationId, vacancyId, tx);
}

export async function listActiveOrganizationRecruitmentStages(organizationId) {
  await ensureOrganizationRecruitmentStages(organizationId);
  const rows = await prisma.recruitmentStage.findMany({
    where: { organizationId, isActive: true },
    orderBy: { position: 'asc' },
  });
  return rows.map(serializeRecruitmentStage);
}

export async function getVacancyStageConfiguration(organizationId, vacancyId) {
  await ensureVacancyRecruitmentStages(organizationId, vacancyId);
  const [vacancyStages, catalog] = await Promise.all([
    prisma.recruitmentVacancyStage.findMany({
      where: { organizationId, vacancyId },
      include: { stage: true },
      orderBy: { position: 'asc' },
    }),
    listActiveOrganizationRecruitmentStages(organizationId),
  ]);
  return {
    vacancyStages: vacancyStages.map(serializeRecruitmentVacancyStage),
    catalog,
  };
}

function assertRequiredStageKeysPresent(stageIdsOrdered, stageById) {
  for (const key of REQUIRED_VACANCY_STAGE_KEYS) {
    const found = stageIdsOrdered.some((id) => stageById.get(id)?.key === key);
    if (!found) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = `La configuración debe incluir la etapa obligatoria ${key}.`;
      throw err;
    }
  }
}

function assertNewStageIsFirst(stageIdsOrdered, stageById) {
  const first = stageById.get(stageIdsOrdered[0]);
  if (first?.key !== 'NEW') {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La etapa Nuevo debe ser la primera etapa del proceso.';
    throw err;
  }
}

/** Tras la primera etapa terminal no puede haber etapas no terminales (usa isTerminal). */
function assertTerminalStagesAtEnd(stageIdsOrdered, stageById) {
  let seenTerminal = false;
  for (const id of stageIdsOrdered) {
    const stage = stageById.get(id);
    if (!stage) continue;
    if (stage.isTerminal) {
      seenTerminal = true;
    } else if (seenTerminal) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message =
        'Las etapas terminales deben ir al final del proceso, después de todas las etapas activas.';
      throw err;
    }
  }
}

export async function updateVacancyStageConfiguration(organizationId, vacancyId, stageIdsOrdered) {
  await assertVacancyInOrg(vacancyId, organizationId);
  if (!Array.isArray(stageIdsOrdered) || stageIdsOrdered.length < 1) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Indica al menos una etapa.';
    throw err;
  }
  const unique = new Set(stageIdsOrdered);
  if (unique.size !== stageIdsOrdered.length) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'No repitas etapas en la configuración.';
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    await ensureVacancyRecruitmentStages(organizationId, vacancyId, tx);
    await ensureOrganizationRecruitmentStages(organizationId, tx);

    const orgStages = await tx.recruitmentStage.findMany({
      where: { organizationId, isActive: true },
    });
    const stageById = new Map(orgStages.map((s) => [s.id, s]));
    for (const id of stageIdsOrdered) {
      if (!stageById.has(id)) {
        const err = new Error('NOT_FOUND');
        err.code = 'NOT_FOUND';
        err.message = 'Etapa no encontrada en la organización.';
        throw err;
      }
    }
    assertRequiredStageKeysPresent(stageIdsOrdered, stageById);
    assertNewStageIsFirst(stageIdsOrdered, stageById);
    assertTerminalStagesAtEnd(stageIdsOrdered, stageById);

    const enabledSet = new Set(stageIdsOrdered);
    for (const orgStage of orgStages) {
      if (enabledSet.has(orgStage.id)) continue;
      const appCount = await tx.recruitmentApplication.count({
        where: { organizationId, vacancyId, stageId: orgStage.id },
      });
      if (appCount > 0) {
        const err = new Error('VALIDATION_ERROR');
        err.code = 'VALIDATION_ERROR';
        err.message =
          'No puedes quitar esta etapa mientras tenga candidatos asignados. Mueve primero los candidatos a otra etapa.';
        throw err;
      }
    }

    const positionByStageId = new Map(
      stageIdsOrdered.map((id, i) => [id, (i + 1) * VACANCY_STAGE_POSITION_GAP]),
    );

    for (const orgStage of orgStages) {
      const isEnabled = enabledSet.has(orgStage.id);
      const position = isEnabled
        ? positionByStageId.get(orgStage.id)
        : orgStage.position;
      await tx.recruitmentVacancyStage.upsert({
        where: { vacancyId_stageId: { vacancyId, stageId: orgStage.id } },
        create: {
          organizationId,
          vacancyId,
          stageId: orgStage.id,
          position,
          isEnabled,
        },
        update: {
          position,
          isEnabled,
        },
      });
    }

    const rows = await tx.recruitmentVacancyStage.findMany({
      where: { organizationId, vacancyId },
      include: { stage: true },
      orderBy: { position: 'asc' },
    });
    return rows.map(serializeRecruitmentVacancyStage);
  });
}

export async function assertStageEnabledForVacancy(organizationId, vacancyId, stageId, tx = prisma) {
  await ensureVacancyRecruitmentStages(organizationId, vacancyId, tx);
  const row = await tx.recruitmentVacancyStage.findFirst({
    where: { organizationId, vacancyId, stageId, isEnabled: true },
    include: { stage: true },
  });
  if (!row) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Esta etapa no está habilitada para la vacante.';
    throw err;
  }
  return row;
}

export async function assertNewStageEnabledForVacancy(organizationId, vacancyId, tx = prisma) {
  await ensureOrganizationRecruitmentStages(organizationId, tx);
  const newStage = await tx.recruitmentStage.findFirst({
    where: { organizationId, key: 'NEW', isActive: true },
  });
  if (!newStage) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Etapa NEW no encontrada.';
    throw err;
  }
  await assertStageEnabledForVacancy(organizationId, vacancyId, newStage.id, tx);
  return newStage;
}


/** Etapas habilitadas para funnel / distribución ejecutiva. */
export async function listEnabledVacancyStagesForDistribution(organizationId, vacancyId, tx = prisma) {
  await ensureVacancyRecruitmentStages(organizationId, vacancyId, tx);
  return tx.recruitmentVacancyStage.findMany({
    where: { organizationId, vacancyId, isEnabled: true },
    orderBy: { position: 'asc' },
    include: { stage: { select: { id: true, key: true, name: true } } },
  });
}

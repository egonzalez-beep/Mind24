import { prisma } from '../db/client.js';
import {
  ensureOrganizationRecruitmentStages,
  normalizeRecruitmentStageName,
  RECRUITMENT_RESERVED_STAGE_KEYS,
  serializeRecruitmentStage,
} from './recruitmentStage.service.js';

/**
 * Orden del recorrido principal al inicializar el pipeline de una vacante nueva.
 * Referencias (si está activa en el catálogo) se inserta después de Psicometría.
 * INTERVIEW_NO_SHOW queda como cartera antes de Finalista → Aprobado → Contratado.
 * Salidas al final: Baja → (Declinó virtual en UI) → Descartado.
 */
export const DEFAULT_VACANCY_SEED_MAIN_KEYS = [
  'NEW',
  'CONTACT',
  'INITIAL_INTERVIEW',
  'CLIENT_INTERVIEW',
  'EVALUATIONS',
  'PSYCHOMETRICS',
  'FINALIST',
  'APPROVED',
  'HIRED',
];

export const DEFAULT_VACANCY_SEED_EXIT_KEYS = ['EMPLOYMENT_EXIT', 'REJECTED'];

export function isReferencesCatalogStage(stage) {
  if (!stage) return false;
  const key = String(stage.key || '')
    .trim()
    .toUpperCase();
  if (key === 'REFERENCES' || key === 'REFERENCIAS') return true;
  const name = normalizeRecruitmentStageName(stage.name).toLowerCase();
  return name === 'referencias' || name === 'references';
}

function compareStagesDeterministic(a, b) {
  const posA = Number(a.position) || 0;
  const posB = Number(b.position) || 0;
  if (posA !== posB) return posA - posB;
  const nameA = normalizeRecruitmentStageName(a.name).toLowerCase();
  const nameB = normalizeRecruitmentStageName(b.name).toLowerCase();
  if (nameA !== nameB) return nameA < nameB ? -1 : 1;
  const idA = String(a.id || '');
  const idB = String(b.id || '');
  if (idA === idB) return 0;
  return idA < idB ? -1 : 1;
}

/**
 * Ordena etapas activas del catálogo para el seed inicial de una vacante.
 * No muta el catálogo org ni vacantes ya configuradas.
 */
export function orderActiveStagesForNewVacancySeed(orgStages) {
  const stages = Array.isArray(orgStages) ? orgStages.filter(Boolean) : [];
  if (!stages.length) return [];

  const byKey = new Map();
  for (const s of stages) {
    if (s.key && !byKey.has(s.key)) byKey.set(s.key, s);
  }

  const used = new Set();
  const ordered = [];

  function take(stage) {
    if (!stage || used.has(stage.id)) return;
    used.add(stage.id);
    ordered.push(stage);
  }

  function takeKey(key) {
    take(byKey.get(key));
  }

  // Tramo principal hasta Psicometría.
  for (const key of DEFAULT_VACANCY_SEED_MAIN_KEYS) {
    if (key === 'FINALIST') break;
    takeKey(key);
  }

  // Referencias/References: la primera (orden determinista) tras Psicometría;
  // el resto queda en el bloque de personalizadas activas.
  const referencesCandidates = stages
    .filter((s) => isReferencesCatalogStage(s) && !used.has(s.id))
    .sort(compareStagesDeterministic);
  if (referencesCandidates.length) take(referencesCandidates[0]);

  // Personalizadas (y coincidencias extra de Referencias): orden determinista aunque coincidan posiciones.
  const customs = stages
    .filter((s) => {
      if (used.has(s.id)) return false;
      const key = String(s.key || '');
      if (RECRUITMENT_RESERVED_STAGE_KEYS.has(key)) return false;
      if (s.isTerminal) return false;
      return true;
    })
    .sort(compareStagesDeterministic);
  for (const s of customs) take(s);

  // Cartera No asistió: fuera del tramo Finalista → Aprobado → Contratado.
  takeKey('INTERVIEW_NO_SHOW');

  // Finalista → Aprobado → Contratado (contiguo).
  takeKey('FINALIST');
  takeKey('APPROVED');
  takeKey('HIRED');

  // Salidas visibles: Baja → Descartado (Declinó es columna virtual ante Descartado).
  for (const key of DEFAULT_VACANCY_SEED_EXIT_KEYS) takeKey(key);

  // Cualquier etapa activa restante (p. ej. terminal custom): al final, determinista.
  const leftovers = stages.filter((s) => !used.has(s.id)).sort(compareStagesDeterministic);
  for (const s of leftovers) take(s);

  return ordered;
}

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
export const REQUIRED_VACANCY_STAGE_KEYS = [
  'NEW',
  'HIRED',
  'REJECTED',
  'INTERVIEW_NO_SHOW',
  'APPROVED',
  'EMPLOYMENT_EXIT',
];

/**
 * Posición al insertar APPROVED en una vacante existente (migración / backfill).
 * Con Finalista habilitada: entre Finalista y la primera terminal (p. ej. Contratado),
 * después del último eslabón ya presente en ese tramo (no reordena el resto).
 * Sin Finalista: antes de la primera etapa terminal.
 */
export function resolveApprovedVacancyStageInsertPosition({
  finalistEnabledPosition = null,
  firstTerminalPosition = null,
  maxPositionBeforeFirstTerminal = null,
} = {}) {
  const term = Number.isFinite(firstTerminalPosition) ? Number(firstTerminalPosition) : null;
  const maxBefore =
    maxPositionBeforeFirstTerminal != null && Number.isFinite(maxPositionBeforeFirstTerminal)
      ? Number(maxPositionBeforeFirstTerminal)
      : null;

  if (finalistEnabledPosition != null && Number.isFinite(finalistEnabledPosition)) {
    const fin = Number(finalistEnabledPosition);
    const high = term != null && term > fin ? term : fin + 600;
    const low =
      maxBefore != null && maxBefore >= fin && maxBefore < high ? maxBefore : fin;
    const gap = high - low;
    return low + Math.max(1, Math.floor(gap / 2));
  }

  if (term != null) {
    const low = maxBefore != null && maxBefore < term ? maxBefore : term - 600;
    const gap = term - low;
    return low + Math.max(1, Math.floor(gap / 2));
  }

  return 7600;
}

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
 * Crea filas VacancyStage para todas las etapas activas del catálogo org.
 * Aplica el orden inicial de vacante nueva (no el position crudo del catálogo).
 * Idempotente vía skipDuplicates en unique (vacancyId, stageId).
 * Vacantes ya configuradas no pasan por aquí (ensure solo si count === 0).
 */
export async function seedVacancyStagesFromOrganizationCatalog(organizationId, vacancyId, tx = prisma) {
  await ensureOrganizationRecruitmentStages(organizationId, tx);
  const orgStages = await tx.recruitmentStage.findMany({
    where: { organizationId, isActive: true },
    orderBy: [{ position: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  });
  if (!orgStages.length) return;
  const ordered = orderActiveStagesForNewVacancySeed(orgStages);
  await tx.recruitmentVacancyStage.createMany({
    data: ordered.map((s, i) => ({
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

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

export const RECRUITMENT_RESERVED_STAGE_KEYS = new Set(
  RECRUITMENT_DEFAULT_STAGES.map((s) => s.key),
);

const STAGE_KEY_MAX_LEN = 56;
const STAGE_CATALOG_POSITION_GAP = 1000;

export function normalizeRecruitmentStageName(name) {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function slugifyRecruitmentStageKeyFromName(name) {
  const trimmed = normalizeRecruitmentStageName(name);
  let slug = trimmed
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) slug = 'CUSTOM_STAGE';
  if (slug.length > STAGE_KEY_MAX_LEN) slug = slug.slice(0, STAGE_KEY_MAX_LEN).replace(/_+$/, '');
  return slug;
}

export async function generateUniqueRecruitmentStageKey(organizationId, baseKey, tx = prisma) {
  if (RECRUITMENT_RESERVED_STAGE_KEYS.has(baseKey)) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Nombre de etapa no válido.';
    throw err;
  }
  let candidate = baseKey;
  let suffix = 2;
  while (true) {
    const existing = await tx.recruitmentStage.findFirst({
      where: { organizationId, key: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    const tail = `_${suffix}`;
    const maxBase = STAGE_KEY_MAX_LEN - tail.length;
    candidate = `${baseKey.slice(0, maxBase)}${tail}`;
    suffix += 1;
  }
}

export async function createOrganizationRecruitmentStage(organizationId, rawName) {
  const name = normalizeRecruitmentStageName(rawName);
  if (name.length < 2) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Indica un nombre de etapa válido.';
    throw err;
  }
  if (name.length > 120) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'El nombre es demasiado largo.';
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    await ensureOrganizationRecruitmentStages(organizationId, tx);

    const dup = await tx.recruitmentStage.findFirst({
      where: {
        organizationId,
        isActive: true,
        name: { equals: name, mode: 'insensitive' },
      },
    });
    if (dup) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Ya existe una etapa con ese nombre en la organización.';
      throw err;
    }

    const baseKey = slugifyRecruitmentStageKeyFromName(name);
    const key = await generateUniqueRecruitmentStageKey(organizationId, baseKey, tx);

    const [nonTerminalMax, terminalMin] = await Promise.all([
      tx.recruitmentStage.aggregate({
        where: { organizationId, isActive: true, isTerminal: false },
        _max: { position: true },
      }),
      tx.recruitmentStage.aggregate({
        where: { organizationId, isActive: true, isTerminal: true },
        _min: { position: true },
      }),
    ]);

    let position = (nonTerminalMax._max.position ?? 0) + STAGE_CATALOG_POSITION_GAP;
    const minTerminal = terminalMin._min.position;
    if (minTerminal != null && position >= minTerminal) {
      position = minTerminal - Math.floor(STAGE_CATALOG_POSITION_GAP / 2);
    }
    if (position < 1) position = STAGE_CATALOG_POSITION_GAP;

    const created = await tx.recruitmentStage.create({
      data: {
        organizationId,
        key,
        name,
        position,
        isTerminal: false,
        isActive: true,
      },
    });
    return serializeRecruitmentStage(created);
  });
}

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

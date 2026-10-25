import { prisma } from '../db/client.js';
import { assertRecruitmentCandidateInOrg } from './recruitmentCandidate.service.js';

export const RECRUITMENT_CANDIDATE_TAG_COLOR_KEYS = [
  'violet',
  'green',
  'amber',
  'coral',
  'blue',
  'slate',
];

const DEFAULT_TAGS = [
  { name: 'Sin respuesta', colorKey: 'slate' },
  { name: 'Cambio de número', colorKey: 'blue' },
  { name: 'Recontactar', colorKey: 'violet' },
  { name: 'Declinó proceso', colorKey: 'slate' },
  { name: 'En espera', colorKey: 'violet' },
  { name: 'Disponible después', colorKey: 'amber' },
  { name: 'Sueldo alto', colorKey: 'amber' },
  { name: 'Solo remoto', colorKey: 'amber' },
  { name: 'Falta documentación', colorKey: 'amber' },
  { name: 'Buen perfil', colorKey: 'green' },
  { name: 'No apto', colorKey: 'coral' },
  { name: 'Mala actitud', colorKey: 'coral' },
  { name: 'No pasó médico', colorKey: 'coral' },
  { name: 'Referencias negativas', colorKey: 'coral' },
  { name: 'Antecedentes', colorKey: 'coral' },
];

function assertValidColorKey(colorKey) {
  if (!RECRUITMENT_CANDIDATE_TAG_COLOR_KEYS.includes(colorKey)) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Color de etiqueta inválido.';
    throw err;
  }
}

function serializeTag(row) {
  return {
    id: row.id,
    name: row.name,
    colorKey: row.colorKey,
    isActive: row.isActive,
  };
}

function serializeAssignment(row) {
  return {
    id: row.id,
    tagId: row.tagId,
    candidateId: row.candidateId,
    name: row.tag.name,
    colorKey: row.tag.colorKey,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function ensureDefaultRecruitmentCandidateTags(organizationId) {
  const existing = await prisma.recruitmentCandidateTag.count({ where: { organizationId } });
  if (existing > 0) return;
  await prisma.recruitmentCandidateTag.createMany({
    data: DEFAULT_TAGS.map((t) => ({
      organizationId,
      name: t.name,
      colorKey: t.colorKey,
      isActive: true,
    })),
    skipDuplicates: true,
  });
}

export async function listRecruitmentCandidateTags(organizationId, { activeOnly = true } = {}) {
  await ensureDefaultRecruitmentCandidateTags(organizationId);
  const rows = await prisma.recruitmentCandidateTag.findMany({
    where: {
      organizationId,
      ...(activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ name: 'asc' }],
  });
  return rows.map(serializeTag);
}

export async function listRecruitmentCandidateTagAssignments(organizationId, candidateId) {
  await assertRecruitmentCandidateInOrg(candidateId, organizationId);
  const rows = await prisma.recruitmentCandidateTagAssignment.findMany({
    where: { organizationId, candidateId },
    include: { tag: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(serializeAssignment);
}

export async function assignRecruitmentCandidateTag(
  organizationId,
  candidateId,
  tagId,
  createdByUserId,
) {
  await assertRecruitmentCandidateInOrg(candidateId, organizationId);
  const tag = await prisma.recruitmentCandidateTag.findFirst({
    where: { id: tagId, organizationId, isActive: true },
  });
  if (!tag) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Etiqueta no encontrada.';
    throw err;
  }
  const existing = await prisma.recruitmentCandidateTagAssignment.findUnique({
    where: { candidateId_tagId: { candidateId, tagId } },
    include: { tag: true },
  });
  if (existing) return serializeAssignment(existing);
  const row = await prisma.recruitmentCandidateTagAssignment.create({
    data: {
      organizationId,
      candidateId,
      tagId,
      createdByUserId,
    },
    include: { tag: true },
  });
  return serializeAssignment(row);
}

export async function removeRecruitmentCandidateTagAssignment(organizationId, candidateId, tagId) {
  await assertRecruitmentCandidateInOrg(candidateId, organizationId);
  const existing = await prisma.recruitmentCandidateTagAssignment.findFirst({
    where: { organizationId, candidateId, tagId },
  });
  if (!existing) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Etiqueta no asignada.';
    throw err;
  }
  await prisma.recruitmentCandidateTagAssignment.delete({ where: { id: existing.id } });
  return { ok: true };
}

/** Preview tags for list rows: up to `limit` tags + extraCount */
export async function buildTagPreviewsByCandidateId(organizationId, candidateIds, limit = 2) {
  const map = new Map(candidateIds.map((id) => [id, { tags: [], extraCount: 0 }]));
  if (!candidateIds.length) return map;
  const rows = await prisma.recruitmentCandidateTagAssignment.findMany({
    where: { organizationId, candidateId: { in: candidateIds } },
    include: { tag: { select: { id: true, name: true, colorKey: true, isActive: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const bucket = new Map();
  for (const row of rows) {
    if (!row.tag?.isActive) continue;
    const list = bucket.get(row.candidateId) || [];
    list.push({
      id: row.tag.id,
      name: row.tag.name,
      colorKey: row.tag.colorKey,
    });
    bucket.set(row.candidateId, list);
  }
  for (const id of candidateIds) {
    const all = bucket.get(id) || [];
    map.set(id, {
      tags: all.slice(0, limit),
      extraCount: Math.max(0, all.length - limit),
    });
  }
  return map;
}

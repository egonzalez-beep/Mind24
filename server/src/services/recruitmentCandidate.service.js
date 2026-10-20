import { prisma } from '../db/client.js';

function trimOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export function serializeRecruitmentCandidate(row) {
  return {
    id: row.id,
    fullName: row.fullName,
    profile: row.profile,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    city: row.city,
    state: row.state,
    source: row.source,
    notes: row.notes,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function assertRecruitmentCandidateInOrg(candidateId, organizationId) {
  const row = await prisma.recruitmentCandidate.findFirst({
    where: { id: candidateId, organizationId },
  });
  if (!row) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Candidato de reclutamiento no encontrado.';
    throw err;
  }
  return row;
}

export async function createRecruitmentCandidate(organizationId, payload) {
  const row = await prisma.recruitmentCandidate.create({
    data: {
      organizationId,
      fullName: payload.fullName.trim(),
      profile: payload.profile.trim(),
      phone: payload.phone.trim(),
      whatsapp: trimOrNull(payload.whatsapp),
      email: trimOrNull(payload.email)?.toLowerCase() ?? null,
      city: trimOrNull(payload.city),
      state: trimOrNull(payload.state),
      source: trimOrNull(payload.source),
      notes: trimOrNull(payload.notes),
    },
  });
  return serializeRecruitmentCandidate(row);
}

export async function listRecruitmentCandidates(organizationId, { includeArchived = false } = {}) {
  const where = { organizationId };
  if (!includeArchived) where.archivedAt = null;
  const rows = await prisma.recruitmentCandidate.findMany({
    where,
    orderBy: [{ fullName: 'asc' }, { createdAt: 'desc' }],
  });
  return rows.map(serializeRecruitmentCandidate);
}

export async function getRecruitmentCandidate(organizationId, candidateId) {
  const row = await assertRecruitmentCandidateInOrg(candidateId, organizationId);
  return serializeRecruitmentCandidate(row);
}

export async function updateRecruitmentCandidate(organizationId, candidateId, patch) {
  await assertRecruitmentCandidateInOrg(candidateId, organizationId);
  const data = {};
  if (patch.fullName != null) data.fullName = patch.fullName.trim();
  if (patch.profile != null) data.profile = patch.profile.trim();
  if (patch.phone != null) data.phone = patch.phone.trim();
  if (patch.whatsapp !== undefined) data.whatsapp = trimOrNull(patch.whatsapp);
  if (patch.email !== undefined) {
    data.email = trimOrNull(patch.email)?.toLowerCase() ?? null;
  }
  if (patch.city !== undefined) data.city = trimOrNull(patch.city);
  if (patch.state !== undefined) data.state = trimOrNull(patch.state);
  if (patch.source !== undefined) data.source = trimOrNull(patch.source);
  if (patch.notes !== undefined) data.notes = trimOrNull(patch.notes);
  if (patch.archived === true) data.archivedAt = new Date();
  if (patch.archived === false) data.archivedAt = null;

  const row = await prisma.recruitmentCandidate.update({
    where: { id: candidateId },
    data,
  });
  return serializeRecruitmentCandidate(row);
}

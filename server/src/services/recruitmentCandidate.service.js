import { prisma } from '../db/client.js';
import {
  normalizeRecruitmentCandidateFullName,
  prepareRecruitmentCandidateWritePayload,
  resolveRecruitmentCandidatePhoneFields,
  resolveRecruitmentCandidateProfileFields,
  resolveRecruitmentCandidateProfileSecondary,
  resolveRecruitmentCandidateSourceFields,
} from './recruitmentCandidateCatalog.service.js';

export { normalizeRecruitmentCandidateFullName } from './recruitmentCandidateCatalog.service.js';

function serializeResumeMetadata(row) {
  if (!row) return null;
  return {
    id: row.id,
    candidateId: row.candidateId,
    originalFileName: row.originalFileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const RECRUITMENT_CANDIDATE_LIST_DEFAULT_LIMIT = 25;
export const RECRUITMENT_CANDIDATE_LIST_MAX_LIMIT = 50;

function trimOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export function normalizeRecruitmentCandidateEmail(email) {
  const v = trimOrNull(email);
  return v ? v.toLowerCase() : null;
}

/** Solo dígitos para heurísticas de duplicado (no unique duro). */
export function normalizeRecruitmentCandidatePhoneDigits(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

export function emptyRecruitmentCandidateApplicationSummary() {
  return { total: 0, active: 0, hired: 0, rejected: 0 };
}

export function serializeRecruitmentCandidate(row, extras = {}) {
  return {
    id: row.id,
    fullName: row.fullName,
    profile: row.profile,
    profileOther: row.profileOther,
    profileSecondary: row.profileSecondary,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    city: row.city,
    state: row.state,
    source: row.source,
    sourceOther: row.sourceOther,
    notes: row.notes,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(extras.applicationSummary != null ? { applicationSummary: extras.applicationSummary } : {}),
    ...(extras.primaryActiveProcess !== undefined
      ? { primaryActiveProcess: extras.primaryActiveProcess }
      : {}),
    ...(extras.tags != null ? { tags: extras.tags } : {}),
    ...(extras.tagExtraCount != null ? { tagExtraCount: extras.tagExtraCount } : {}),
    ...(extras.assignedTags != null ? { assignedTags: extras.assignedTags } : {}),
  };
}

function serializeCandidateApplicationProcess(row) {
  return {
    applicationId: row.id,
    appliedAt: row.appliedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    notes: row.notes,
    vacancy: {
      id: row.vacancy.id,
      title: row.vacancy.title,
      clientName: row.vacancy.clientName,
      status: row.vacancy.status,
    },
    stage: {
      id: row.stage.id,
      key: row.stage.key,
      name: row.stage.name,
    },
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

export async function buildApplicationSummariesByCandidateId(organizationId, candidateIds) {
  const map = new Map(candidateIds.map((id) => [id, emptyRecruitmentCandidateApplicationSummary()]));
  if (!candidateIds.length) return map;

  const rows = await prisma.recruitmentApplication.findMany({
    where: { organizationId, candidateId: { in: candidateIds } },
    select: { candidateId: true, stage: { select: { key: true } } },
  });

  for (const row of rows) {
    const summary = map.get(row.candidateId) ?? emptyRecruitmentCandidateApplicationSummary();
    summary.total += 1;
    const key = row.stage?.key;
    if (key === 'HIRED') summary.hired += 1;
    else if (key === 'REJECTED') summary.rejected += 1;
    else summary.active += 1;
    map.set(row.candidateId, summary);
  }
  return map;
}

/** Proceso activo principal por candidato (etapa + vacante) para listado cartera. */
export async function buildPrimaryActivePreviewByCandidateId(
  organizationId,
  candidateIds,
  preferredVacancyId = null,
) {
  const map = new Map(candidateIds.map((id) => [id, null]));
  if (!candidateIds.length) return map;

  const rows = await prisma.recruitmentApplication.findMany({
    where: {
      organizationId,
      candidateId: { in: candidateIds },
      stage: { key: { notIn: ['HIRED', 'REJECTED'] } },
    },
    include: {
      vacancy: { select: { id: true, title: true } },
      stage: { select: { id: true, key: true, name: true } },
    },
    orderBy: [{ updatedAt: 'desc' }, { appliedAt: 'desc' }],
  });

  const byCandidate = new Map();
  for (const row of rows) {
    if (!byCandidate.has(row.candidateId)) byCandidate.set(row.candidateId, []);
    byCandidate.get(row.candidateId).push(row);
  }

  for (const [candidateId, apps] of byCandidate) {
    let pick = apps[0];
    if (preferredVacancyId) {
      const ctx = apps.find((a) => a.vacancy?.id === preferredVacancyId);
      if (ctx) pick = ctx;
    }
    map.set(candidateId, {
      stageName: pick.stage?.name || pick.stage?.key || 'Etapa',
      stageKey: pick.stage?.key || null,
      vacancyTitle: pick.vacancy?.title || '—',
      vacancyId: pick.vacancy?.id || null,
    });
  }
  return map;
}

/**
 * Candidatos potencialmente duplicados (email exacto o teléfono normalizado).
 * No bloquea creación; pensado para UI 1D.2.
 */
export async function findPotentialDuplicateRecruitmentCandidates(
  organizationId,
  { email, phone },
  { excludeCandidateId } = {},
) {
  const or = [];
  const normEmail = normalizeRecruitmentCandidateEmail(email);
  if (normEmail) {
    or.push({ email: { equals: normEmail, mode: 'insensitive' } });
  }
  const digits = normalizeRecruitmentCandidatePhoneDigits(phone);
  if (digits) {
    or.push({ phone: { contains: digits.slice(-10) } });
    or.push({ whatsapp: { contains: digits.slice(-10) } });
  }
  if (!or.length) return [];

  const rows = await prisma.recruitmentCandidate.findMany({
    where: {
      organizationId,
      ...(excludeCandidateId ? { id: { not: excludeCandidateId } } : {}),
      OR: or,
    },
    take: 10,
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map((r) => serializeRecruitmentCandidate(r));
}

function encodeListCursor(createdAt, id) {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeListCursor(cursor) {
  try {
    const raw = Buffer.from(String(cursor), 'base64url').toString('utf8');
    const sep = raw.lastIndexOf('|');
    if (sep <= 0) return null;
    const createdAt = new Date(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function buildCandidateListWhere(organizationId, options) {
  const {
    includeArchived = false,
    archivedOnly = false,
    q,
    profile,
    source,
    tagId,
    cursor,
  } = options;

  const and = [{ organizationId }];
  if (archivedOnly === true) {
    and.push({ archivedAt: { not: null } });
  } else if (!includeArchived) {
    and.push({ archivedAt: null });
  }

  const qTrim = trimOrNull(q);
  if (qTrim) {
    and.push({
      OR: [
        { fullName: { contains: qTrim, mode: 'insensitive' } },
        { profile: { contains: qTrim, mode: 'insensitive' } },
        { phone: { contains: qTrim, mode: 'insensitive' } },
        { whatsapp: { contains: qTrim, mode: 'insensitive' } },
        { email: { contains: qTrim, mode: 'insensitive' } },
        { city: { contains: qTrim, mode: 'insensitive' } },
        { state: { contains: qTrim, mode: 'insensitive' } },
      ],
    });
  }

  const profileTrim = trimOrNull(profile);
  if (profileTrim) {
    and.push({ profile: { equals: profileTrim, mode: 'insensitive' } });
  }

  const sourceTrim = trimOrNull(source);
  if (sourceTrim) {
    and.push({ source: { equals: sourceTrim, mode: 'insensitive' } });
  }

  const tagTrim = trimOrNull(tagId);
  if (tagTrim) {
    and.push({
      tagAssignments: {
        some: { organizationId, tagId: tagTrim },
      },
    });
  }

  const decoded = cursor ? decodeListCursor(cursor) : null;
  if (cursor && !decoded) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Cursor de paginación inválido.';
    throw err;
  }
  if (decoded) {
    and.push({
      OR: [
        { createdAt: { lt: decoded.createdAt } },
        { createdAt: decoded.createdAt, id: { lt: decoded.id } },
      ],
    });
  }

  return { AND: and };
}

export async function listRecruitmentCandidates(organizationId, options = {}) {
  const includeArchived = options.includeArchived === true;
  const archivedOnly = options.archivedOnly === true;
  let limit = Number(options.limit);
  if (!Number.isFinite(limit) || limit < 1) limit = RECRUITMENT_CANDIDATE_LIST_DEFAULT_LIMIT;
  limit = Math.min(RECRUITMENT_CANDIDATE_LIST_MAX_LIMIT, Math.floor(limit));

  const where = buildCandidateListWhere(organizationId, {
    ...options,
    includeArchived,
    archivedOnly,
  });

  const rows = await prisma.recruitmentCandidate.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  let nextCursor = null;
  let page = rows;
  if (rows.length > limit) {
    const last = rows[limit - 1];
    nextCursor = encodeListCursor(last.createdAt, last.id);
    page = rows.slice(0, limit);
  }

  const pageIds = page.map((r) => r.id);
  const summaryMap = await buildApplicationSummariesByCandidateId(organizationId, pageIds);
  const previewMap = await buildPrimaryActivePreviewByCandidateId(
    organizationId,
    pageIds,
    options.contextVacancyId || null,
  );
  const { buildTagPreviewsByCandidateId } = await import('./recruitmentCandidateTag.service.js');
  const tagPreviewMap = await buildTagPreviewsByCandidateId(organizationId, pageIds, 2);

  return {
    candidates: page.map((r) => {
      const tp = tagPreviewMap.get(r.id) || { tags: [], extraCount: 0 };
      return serializeRecruitmentCandidate(r, {
        applicationSummary: summaryMap.get(r.id),
        primaryActiveProcess: previewMap.get(r.id) || null,
        tags: tp.tags,
        tagExtraCount: tp.extraCount,
      });
    }),
    nextCursor,
  };
}

export async function createRecruitmentCandidate(organizationId, payload) {
  const prepared = prepareRecruitmentCandidateWritePayload(payload, { partial: false });
  const row = await prisma.recruitmentCandidate.create({
    data: {
      organizationId,
      fullName: prepared.fullName,
      profile: prepared.profile,
      profileOther: trimOrNull(prepared.profileOther),
      profileSecondary: trimOrNull(prepared.profileSecondary),
      phone: prepared.phone,
      whatsapp: prepared.whatsapp,
      email: normalizeRecruitmentCandidateEmail(prepared.email),
      city: trimOrNull(prepared.city),
      state: trimOrNull(prepared.state),
      source: trimOrNull(prepared.source),
      sourceOther: trimOrNull(prepared.sourceOther),
    },
  });
  return serializeRecruitmentCandidate(row, {
    applicationSummary: emptyRecruitmentCandidateApplicationSummary(),
  });
}

export async function getRecruitmentCandidate(organizationId, candidateId) {
  await assertRecruitmentCandidateInOrg(candidateId, organizationId);

  const [candidateRow, applications, resumeRow] = await Promise.all([
    prisma.recruitmentCandidate.findFirst({
      where: { id: candidateId, organizationId },
    }),
    prisma.recruitmentApplication.findMany({
      where: { organizationId, candidateId },
      include: {
        vacancy: { select: { id: true, title: true, clientName: true, status: true } },
        stage: { select: { id: true, key: true, name: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { appliedAt: 'desc' }],
    }),
    prisma.recruitmentCandidateResume.findFirst({
      where: { organizationId, candidateId },
    }),
  ]);

  const summaryMap = await buildApplicationSummariesByCandidateId(organizationId, [candidateId]);
  const { listRecruitmentCandidateTagAssignments } = await import(
    './recruitmentCandidateTag.service.js'
  );
  const assignedTags = await listRecruitmentCandidateTagAssignments(organizationId, candidateId);

  return {
    ...serializeRecruitmentCandidate(candidateRow, {
      applicationSummary: summaryMap.get(candidateId),
      assignedTags,
    }),
    resume: serializeResumeMetadata(resumeRow),
    applications: applications.map(serializeCandidateApplicationProcess),
  };
}

export async function updateRecruitmentCandidate(organizationId, candidateId, patch) {
  const existing = await assertRecruitmentCandidateInOrg(candidateId, organizationId);
  const data = {};
  if (patch.fullName != null) {
    data.fullName = normalizeRecruitmentCandidateFullName(patch.fullName);
  }
  if (patch.profile != null) {
    const pf = resolveRecruitmentCandidateProfileFields(patch.profile, patch.profileOther);
    data.profile = pf.profile;
    data.profileOther = pf.profileOther;
  }
  if (patch.profileSecondary !== undefined) {
    data.profileSecondary = resolveRecruitmentCandidateProfileSecondary(
      patch.profileSecondary,
      patch.profileSecondaryOther,
    );
  }
  const phones = resolveRecruitmentCandidatePhoneFields({
    whatsapp:
      patch.whatsapp !== undefined
        ? patch.whatsapp
        : existing.whatsapp || existing.phone,
    phone:
      patch.phone !== undefined
        ? patch.phone
        : existing.whatsapp && existing.phone !== existing.whatsapp
          ? existing.phone
          : null,
  });
  data.whatsapp = phones.whatsapp;
  data.phone = phones.phone;
  if (patch.email !== undefined) {
    data.email = normalizeRecruitmentCandidateEmail(patch.email);
  }
  if (patch.city !== undefined) data.city = trimOrNull(patch.city);
  if (patch.state !== undefined) data.state = trimOrNull(patch.state);
  if (patch.source !== undefined) {
    const sf = resolveRecruitmentCandidateSourceFields(patch.source, patch.sourceOther);
    data.source = sf.source;
    data.sourceOther = sf.sourceOther;
  }
  if (patch.archived === true) data.archivedAt = new Date();
  if (patch.archived === false) data.archivedAt = null;

  const row = await prisma.recruitmentCandidate.update({
    where: { id: candidateId },
    data,
  });
  const summaryMap = await buildApplicationSummariesByCandidateId(organizationId, [candidateId]);
  return serializeRecruitmentCandidate(row, { applicationSummary: summaryMap.get(candidateId) });
}

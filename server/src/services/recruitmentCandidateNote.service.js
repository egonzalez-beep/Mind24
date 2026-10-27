import { prisma } from '../db/client.js';
import { assertRecruitmentCandidateInOrg } from './recruitmentCandidate.service.js';

export const RECRUITMENT_CANDIDATE_NOTE_MAX_LENGTH = 20_000;

const noteAuthorInclude = {
  author: { select: { id: true, fullName: true } },
  authorWorkforceEmployee: { select: { id: true, fullName: true } },
};

function trimBody(body) {
  return String(body ?? '').trim();
}

/** Prioridad: User → WorkforceEmployee → legacy → sin nombre (UI muestra —). */
export function resolveRecruitmentCandidateNoteAuthorName(row) {
  const userName = row.author?.fullName?.trim();
  if (userName) return userName;
  const workforceName = row.authorWorkforceEmployee?.fullName?.trim();
  if (workforceName) return workforceName;
  if (row.legacyImport) return 'Observación migrada';
  return null;
}

function serializeNote(row) {
  const authorName = resolveRecruitmentCandidateNoteAuthorName(row);
  return {
    id: row.id,
    candidateId: row.candidateId,
    body: row.body,
    legacyImport: row.legacyImport,
    authorUserId: row.authorUserId,
    authorWorkforceEmployeeId: row.authorWorkforceEmployeeId ?? null,
    authorName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

async function resolveWorkforceAuthorId(organizationId, authorWorkforceEmployeeId) {
  if (!authorWorkforceEmployeeId) return null;
  const emp = await prisma.workforceEmployee.findFirst({
    where: { id: authorWorkforceEmployeeId, organizationId },
    select: { id: true },
  });
  if (!emp) {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    err.message = 'Colaborador no válido para esta organización.';
    throw err;
  }
  return emp.id;
}

export async function ensureLegacyCandidateNoteImported(organizationId, candidateId) {
  const cand = await prisma.recruitmentCandidate.findFirst({
    where: { id: candidateId, organizationId },
    select: { id: true, notes: true, updatedAt: true, createdAt: true },
  });
  if (!cand) return;
  const legacy = trimBody(cand.notes);
  if (!legacy) return;
  const existing = await prisma.recruitmentCandidateNote.findFirst({
    where: { organizationId, candidateId, legacyImport: true, deletedAt: null },
    select: { id: true },
  });
  if (existing) return;
  await prisma.recruitmentCandidateNote.create({
    data: {
      organizationId,
      candidateId,
      authorUserId: null,
      authorWorkforceEmployeeId: null,
      body: legacy,
      legacyImport: true,
      createdAt: cand.updatedAt || cand.createdAt,
    },
  });
}

export async function listRecruitmentCandidateNotes(organizationId, candidateId) {
  await assertRecruitmentCandidateInOrg(candidateId, organizationId);
  await ensureLegacyCandidateNoteImported(organizationId, candidateId);
  const rows = await prisma.recruitmentCandidateNote.findMany({
    where: { organizationId, candidateId, deletedAt: null },
    include: noteAuthorInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map(serializeNote);
}

export async function createRecruitmentCandidateNote(
  organizationId,
  candidateId,
  authorUserId,
  body,
  { authorWorkforceEmployeeId = null } = {},
) {
  await assertRecruitmentCandidateInOrg(candidateId, organizationId);
  const text = trimBody(body);
  if (!text) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La observación no puede estar vacía.';
    throw err;
  }
  if (text.length > RECRUITMENT_CANDIDATE_NOTE_MAX_LENGTH) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La observación es demasiado larga.';
    throw err;
  }

  let workforceAuthorId = null;
  let userAuthorId = authorUserId ?? null;
  if (authorWorkforceEmployeeId) {
    workforceAuthorId = await resolveWorkforceAuthorId(organizationId, authorWorkforceEmployeeId);
    userAuthorId = null;
  }

  const row = await prisma.recruitmentCandidateNote.create({
    data: {
      organizationId,
      candidateId,
      authorUserId: userAuthorId,
      authorWorkforceEmployeeId: workforceAuthorId,
      body: text,
      legacyImport: false,
    },
    include: noteAuthorInclude,
  });
  return serializeNote(row);
}

export async function updateRecruitmentCandidateNote(
  organizationId,
  candidateId,
  noteId,
  body,
) {
  await assertRecruitmentCandidateInOrg(candidateId, organizationId);
  const text = trimBody(body);
  if (!text) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La observación no puede estar vacía.';
    throw err;
  }
  if (text.length > RECRUITMENT_CANDIDATE_NOTE_MAX_LENGTH) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La observación es demasiado larga.';
    throw err;
  }
  const existing = await prisma.recruitmentCandidateNote.findFirst({
    where: { id: noteId, organizationId, candidateId, deletedAt: null },
  });
  if (!existing) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Observación no encontrada.';
    throw err;
  }
  const row = await prisma.recruitmentCandidateNote.update({
    where: { id: noteId },
    data: { body: text, editedAt: new Date() },
    include: noteAuthorInclude,
  });
  return serializeNote(row);
}

export async function softDeleteRecruitmentCandidateNote(organizationId, candidateId, noteId) {
  await assertRecruitmentCandidateInOrg(candidateId, organizationId);
  const existing = await prisma.recruitmentCandidateNote.findFirst({
    where: { id: noteId, organizationId, candidateId, deletedAt: null },
  });
  if (!existing) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Observación no encontrada.';
    throw err;
  }
  await prisma.recruitmentCandidateNote.update({
    where: { id: noteId },
    data: { deletedAt: new Date() },
  });
  return { ok: true };
}

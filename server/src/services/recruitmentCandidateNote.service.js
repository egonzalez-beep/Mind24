import { prisma } from '../db/client.js';
import { assertRecruitmentCandidateInOrg } from './recruitmentCandidate.service.js';

export const RECRUITMENT_CANDIDATE_NOTE_MAX_LENGTH = 20_000;

function trimBody(body) {
  return String(body ?? '').trim();
}

function serializeNote(row) {
  const author = row.author;
  let authorLabel = author?.fullName || null;
  if (!authorLabel && row.legacyImport) authorLabel = 'Observación migrada';
  if (!authorLabel && !row.authorUserId) authorLabel = 'Sistema';
  return {
    id: row.id,
    candidateId: row.candidateId,
    body: row.body,
    legacyImport: row.legacyImport,
    authorUserId: row.authorUserId,
    authorName: authorLabel,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
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
    include: { author: { select: { id: true, fullName: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map(serializeNote);
}

export async function createRecruitmentCandidateNote(organizationId, candidateId, authorUserId, body) {
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
  const row = await prisma.recruitmentCandidateNote.create({
    data: {
      organizationId,
      candidateId,
      authorUserId,
      body: text,
      legacyImport: false,
    },
    include: { author: { select: { id: true, fullName: true } } },
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
    include: { author: { select: { id: true, fullName: true } } },
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

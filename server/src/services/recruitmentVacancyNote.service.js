import { prisma } from '../db/client.js';
import { assertRecruitmentVacancyInOrg } from './recruitmentVacancy.service.js';

export const RECRUITMENT_VACANCY_NOTE_MAX_LENGTH = 20_000;

function trimBody(body) {
  return String(body ?? '').trim();
}

function serializeNote(row) {
  const author = row.author;
  let authorLabel = author?.fullName || null;
  if (!authorLabel && row.legacyImport) authorLabel = 'Nota migrada';
  if (!authorLabel && !row.authorUserId) authorLabel = 'Sistema';
  return {
    id: row.id,
    vacancyId: row.vacancyId,
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

export async function ensureLegacyVacancyNoteImported(organizationId, vacancyId) {
  const vac = await prisma.recruitmentVacancy.findFirst({
    where: { id: vacancyId, organizationId },
    select: { id: true, notes: true, updatedAt: true, createdAt: true },
  });
  if (!vac) return;
  const legacy = trimBody(vac.notes);
  if (!legacy) return;
  const existing = await prisma.recruitmentVacancyNote.findFirst({
    where: { organizationId, vacancyId, legacyImport: true, deletedAt: null },
    select: { id: true },
  });
  if (existing) return;
  await prisma.recruitmentVacancyNote.create({
    data: {
      organizationId,
      vacancyId,
      authorUserId: null,
      body: legacy,
      legacyImport: true,
      createdAt: vac.updatedAt || vac.createdAt,
    },
  });
}

export async function listRecruitmentVacancyNotes(organizationId, vacancyId) {
  await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  await ensureLegacyVacancyNoteImported(organizationId, vacancyId);
  const rows = await prisma.recruitmentVacancyNote.findMany({
    where: { organizationId, vacancyId, deletedAt: null },
    include: { author: { select: { id: true, fullName: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map(serializeNote);
}

export async function createRecruitmentVacancyNote(organizationId, vacancyId, authorUserId, body) {
  await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  const text = trimBody(body);
  if (!text) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La nota no puede estar vacía.';
    throw err;
  }
  if (text.length > RECRUITMENT_VACANCY_NOTE_MAX_LENGTH) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La nota es demasiado larga.';
    throw err;
  }
  const row = await prisma.recruitmentVacancyNote.create({
    data: {
      organizationId,
      vacancyId,
      authorUserId,
      body: text,
      legacyImport: false,
    },
    include: { author: { select: { id: true, fullName: true } } },
  });
  return serializeNote(row);
}

export async function updateRecruitmentVacancyNote(organizationId, vacancyId, noteId, body) {
  await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  const text = trimBody(body);
  if (!text) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La nota no puede estar vacía.';
    throw err;
  }
  if (text.length > RECRUITMENT_VACANCY_NOTE_MAX_LENGTH) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La nota es demasiado larga.';
    throw err;
  }
  const existing = await prisma.recruitmentVacancyNote.findFirst({
    where: { id: noteId, organizationId, vacancyId, deletedAt: null },
  });
  if (!existing) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Nota no encontrada.';
    throw err;
  }
  const row = await prisma.recruitmentVacancyNote.update({
    where: { id: noteId },
    data: { body: text, editedAt: new Date() },
    include: { author: { select: { id: true, fullName: true } } },
  });
  return serializeNote(row);
}

export async function softDeleteRecruitmentVacancyNote(organizationId, vacancyId, noteId) {
  await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  const existing = await prisma.recruitmentVacancyNote.findFirst({
    where: { id: noteId, organizationId, vacancyId, deletedAt: null },
  });
  if (!existing) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Nota no encontrada.';
    throw err;
  }
  await prisma.recruitmentVacancyNote.update({
    where: { id: noteId },
    data: { deletedAt: new Date() },
  });
  return { ok: true };
}

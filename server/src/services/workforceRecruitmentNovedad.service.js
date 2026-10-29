import { prisma } from '../db/client.js';

const DEFAULT_LIST_LIMIT = 30;
const MAX_LIST_LIMIT = 30;

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

function isOrganizationDedupeKeyConflict(err) {
  if (err?.code !== 'P2002') return false;
  const target = err.meta?.target;
  const parts = Array.isArray(target) ? target : target != null ? [target] : [];
  return parts.some((t) => String(t).includes('dedupeKey'));
}

function buildListCursorWhere(organizationId, recipientWorkforceEmployeeId, cursor) {
  const base = { organizationId, recipientWorkforceEmployeeId };
  if (cursor == null || String(cursor).trim() === '') return base;
  const decoded = decodeListCursor(cursor);
  if (!decoded) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Cursor inválido.';
    throw err;
  }
  return {
    AND: [
      base,
      {
        OR: [
          { createdAt: { lt: decoded.createdAt } },
          { createdAt: decoded.createdAt, id: { lt: decoded.id } },
        ],
      },
    ],
  };
}

function classifyEventType(toStageKey) {
  const key = String(toStageKey || '').toUpperCase();
  if (key === 'HIRED') return 'HIRED';
  if (key === 'REJECTED') return 'REJECTED';
  return 'STAGE_CHANGED';
}

function buildNovedadMessage(eventType, { candidateName, stageName, vacancyTitle }) {
  const name = String(candidateName || 'Candidato').trim() || 'Candidato';
  const stage = String(stageName || 'etapa').trim() || 'etapa';
  const vacancy = String(vacancyTitle || 'vacante').trim() || 'vacante';
  if (eventType === 'HIRED') return `¡${name} fue contratado para ${vacancy}!`;
  if (eventType === 'REJECTED') return `${name} fue rechazado del proceso ${vacancy}.`;
  return `${name} fue movido a ${stage} en ${vacancy}.`;
}

function serializeNovedad(row) {
  return {
    id: row.id,
    eventType: row.eventType,
    message: row.message,
    candidateId: row.candidateId,
    applicationId: row.applicationId,
    vacancyId: row.vacancyId,
    fromStageId: row.fromStageId,
    toStageId: row.toStageId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    read: row.readAt != null,
  };
}

/**
 * Emite novedad para el colaborador que registró al candidato, en la misma transacción del stage event.
 */
export async function emitWorkforceRecruitmentNovedadForStageEvent(
  tx,
  { stageEvent, applicationId, organizationId },
) {
  if (!stageEvent?.id || !applicationId || !organizationId) return null;

  const fromStageId = stageEvent.fromStageId ?? null;
  const toStageId = stageEvent.toStageId;
  const changedByUserId = stageEvent.changedByUserId ?? null;

  if (!fromStageId || !toStageId || fromStageId === toStageId) return null;
  if (!changedByUserId) return null;

  const app = await tx.recruitmentApplication.findFirst({
    where: { id: applicationId, organizationId },
    select: {
      id: true,
      organizationId: true,
      candidateId: true,
      vacancyId: true,
      candidate: {
        select: {
          id: true,
          organizationId: true,
          fullName: true,
          registeredByWorkforceEmployeeId: true,
        },
      },
      vacancy: { select: { id: true, organizationId: true, title: true } },
    },
  });
  if (!app?.candidate?.registeredByWorkforceEmployeeId) return null;

  const recipientId = app.candidate.registeredByWorkforceEmployeeId;
  if (
    app.organizationId !== organizationId ||
    app.candidate.organizationId !== organizationId ||
    app.vacancy.organizationId !== organizationId
  ) {
    return null;
  }

  const recipient = await tx.workforceEmployee.findFirst({
    where: { id: recipientId, organizationId },
    select: { id: true },
  });
  if (!recipient) return null;

  const toStage = await tx.recruitmentStage.findFirst({
    where: { id: toStageId, organizationId },
    select: { id: true, key: true, name: true },
  });
  if (!toStage) return null;

  const fromStage = await tx.recruitmentStage.findFirst({
    where: { id: fromStageId, organizationId },
    select: { id: true, key: true, name: true },
  });

  const eventType = classifyEventType(toStage.key);
  const message = buildNovedadMessage(eventType, {
    candidateName: app.candidate.fullName,
    stageName: toStage.name,
    vacancyTitle: app.vacancy.title,
  });

  const metadata = {
    stageEventId: stageEvent.id,
    candidateName: app.candidate.fullName,
    vacancyTitle: app.vacancy.title,
    toStageKey: toStage.key,
    toStageName: toStage.name,
    fromStageKey: fromStage?.key ?? null,
    fromStageName: fromStage?.name ?? null,
  };

  const dedupeKey = stageEvent.id;

  try {
    return await tx.workforceRecruitmentNovedad.create({
      data: {
        organizationId,
        recipientWorkforceEmployeeId: recipientId,
        candidateId: app.candidateId,
        applicationId: app.id,
        vacancyId: app.vacancyId,
        eventType,
        fromStageId,
        toStageId,
        message,
        metadata,
        dedupeKey,
      },
    });
  } catch (e) {
    if (isOrganizationDedupeKeyConflict(e)) return null;
    throw e;
  }
}

export async function listWorkforceRecruitmentNovedades({
  organizationId,
  recipientWorkforceEmployeeId,
  limit = DEFAULT_LIST_LIMIT,
  cursor,
}) {
  const take = Math.min(Math.max(Number(limit) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const where = buildListCursorWhere(organizationId, recipientWorkforceEmployeeId, cursor);
  const rows = await prisma.workforceRecruitmentNovedad.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const novedades = page.map(serializeNovedad);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeListCursor(last.createdAt, last.id) : null;
  return { novedades, nextCursor, hasMore };
}

export async function countUnreadWorkforceRecruitmentNovedades(
  organizationId,
  recipientWorkforceEmployeeId,
) {
  return prisma.workforceRecruitmentNovedad.count({
    where: {
      organizationId,
      recipientWorkforceEmployeeId,
      readAt: null,
    },
  });
}

export async function markWorkforceRecruitmentNovedadRead(
  organizationId,
  recipientWorkforceEmployeeId,
  novedadId,
) {
  const row = await prisma.workforceRecruitmentNovedad.findFirst({
    where: {
      id: novedadId,
      organizationId,
      recipientWorkforceEmployeeId,
    },
    select: { id: true, readAt: true },
  });
  if (!row) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Novedad no encontrada.';
    throw err;
  }
  if (row.readAt) return { ok: true };
  const now = new Date();
  await prisma.workforceRecruitmentNovedad.updateMany({
    where: {
      id: row.id,
      organizationId,
      recipientWorkforceEmployeeId,
      readAt: null,
    },
    data: { readAt: now },
  });
  return { ok: true, readAt: now.toISOString() };
}

export async function markAllWorkforceRecruitmentNovedadesRead(
  organizationId,
  recipientWorkforceEmployeeId,
) {
  const now = new Date();
  const result = await prisma.workforceRecruitmentNovedad.updateMany({
    where: {
      organizationId,
      recipientWorkforceEmployeeId,
      readAt: null,
    },
    data: { readAt: now },
  });
  return { ok: true, marked: result.count };
}

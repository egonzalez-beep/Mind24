import { prisma } from '../db/client.js';

const DEFAULT_LIST_LIMIT = 30;
const MAX_LIST_LIMIT = 30;

const SOURCE_RECRUITMENT = 'recruitment';
const SOURCE_WORKPLACE = 'workplace';

/** recruitment shown before workplace when createdAt ties */
const SOURCE_RANK = { [SOURCE_RECRUITMENT]: 0, [SOURCE_WORKPLACE]: 1 };

function encodeListCursor(createdAt, source, id) {
  return Buffer.from(`${createdAt.toISOString()}|${source}|${id}`, 'utf8').toString('base64url');
}

function decodeListCursor(cursor) {
  try {
    const raw = Buffer.from(String(cursor), 'base64url').toString('utf8');
    const parts = raw.split('|');
    if (parts.length < 3) return null;
    const id = parts.pop();
    const source = parts.pop();
    const createdAt = new Date(parts.join('|'));
    if (Number.isNaN(createdAt.getTime()) || !id || !source) return null;
    if (source !== SOURCE_RECRUITMENT && source !== SOURCE_WORKPLACE) return null;
    return { createdAt, source, id };
  } catch {
    return null;
  }
}

export function compareCollaboratorFeedItems(a, b) {
  const ta = a.createdAt.getTime();
  const tb = b.createdAt.getTime();
  if (ta !== tb) return tb - ta;
  const ra = SOURCE_RANK[a.source] ?? 9;
  const rb = SOURCE_RANK[b.source] ?? 9;
  if (ra !== rb) return ra - rb;
  return String(b.rawId).localeCompare(String(a.rawId));
}

function compareFeedItems(a, b) {
  return compareCollaboratorFeedItems(a, b);
}

/** Fusiona filas crudas en ítems ordenados (tests deterministas sin DB). */
export function mergeCollaboratorFeedRows(recRows, wpRows) {
  return [
    ...recRows.map((r) => ({
      ...serializeRecruitmentRow(r),
      createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
    })),
    ...wpRows.map((r) => ({
      ...serializeWorkplaceRow(r),
      createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
    })),
  ].sort(compareFeedItems);
}

export function paginateCollaboratorFeedMerged(merged, take) {
  const hasMore = merged.length > take;
  const page = merged.slice(0, take);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeListCursor(last.createdAt, last.source, last.rawId) : null;
  return { page, hasMore, nextCursor };
}

export { encodeListCursor, decodeListCursor, SOURCE_RECRUITMENT, SOURCE_WORKPLACE };

/** Ítems estrictamente anteriores al cursor en el orden del feed (página siguiente). */
export function recruitmentRowEligibleAfterCursor(row, cursor) {
  if (!cursor) return true;
  const t = row.createdAt.getTime();
  const tc = cursor.createdAt.getTime();
  if (t < tc) return true;
  if (t > tc) return false;
  if (cursor.source === SOURCE_WORKPLACE) return true;
  return String(row.id) < String(cursor.id);
}

export function workplaceRowEligibleAfterCursor(row, cursor) {
  if (!cursor) return true;
  const t = row.createdAt.getTime();
  const tc = cursor.createdAt.getTime();
  if (t < tc) return true;
  if (t > tc) return false;
  if (cursor.source === SOURCE_RECRUITMENT) return true;
  return String(row.id) < String(cursor.id);
}

function buildRecruitmentWhereAfterCursor(base, cursor) {
  if (!cursor) return base;
  return {
    AND: [
      base,
      {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          cursor.source === SOURCE_WORKPLACE
            ? { createdAt: cursor.createdAt }
            : { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      },
    ],
  };
}

function buildWorkplaceWhereAfterCursor(base, cursor) {
  if (!cursor) return base;
  return {
    AND: [
      base,
      {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          cursor.source === SOURCE_RECRUITMENT
            ? { createdAt: cursor.createdAt }
            : { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      },
    ],
  };
}

function serializeRecruitmentRow(row) {
  return {
    id: `${SOURCE_RECRUITMENT}:${row.id}`,
    source: SOURCE_RECRUITMENT,
    rawId: row.id,
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

function serializeWorkplaceRow(row) {
  return {
    id: `${SOURCE_WORKPLACE}:${row.id}`,
    source: SOURCE_WORKPLACE,
    rawId: row.id,
    eventType: row.eventType,
    message: row.message,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    read: row.readAt != null,
  };
}

export async function listCollaboratorNovedadesFeed({
  organizationId,
  recipientWorkforceEmployeeId,
  limit = DEFAULT_LIST_LIMIT,
  cursor,
}) {
  const take = Math.min(Math.max(Number(limit) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  let decodedCursor = null;
  if (cursor != null && String(cursor).trim() !== '') {
    decodedCursor = decodeListCursor(cursor);
    if (!decodedCursor) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Cursor inválido.';
      throw err;
    }
  }

  const baseRec = { organizationId, recipientWorkforceEmployeeId };
  const baseWp = { organizationId, recipientWorkforceEmployeeId };
  // Prefijo global de tamaño take+1: a lo sumo take+1 ítems por fuente en ese prefijo
  // (contando), así que basta take+1 de cada lista ordenada por fuente.
  const fetchTake = take + 1;

  const [recRows, wpRows] = await Promise.all([
    prisma.workforceRecruitmentNovedad.findMany({
      where: buildRecruitmentWhereAfterCursor(baseRec, decodedCursor),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: fetchTake,
    }),
    prisma.workforceWorkplaceInbox.findMany({
      where: buildWorkplaceWhereAfterCursor(baseWp, decodedCursor),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: fetchTake,
    }),
  ]);

  const merged = mergeCollaboratorFeedRows(recRows, wpRows);

  const { page, hasMore, nextCursor } = paginateCollaboratorFeedMerged(merged, take);
  const novedades = page.map(({ createdAt, rawId, ...rest }) => rest);

  return { novedades, nextCursor, hasMore };
}

export async function countUnreadCollaboratorNovedades(organizationId, recipientWorkforceEmployeeId) {
  const [recruitment, workplace] = await Promise.all([
    prisma.workforceRecruitmentNovedad.count({
      where: { organizationId, recipientWorkforceEmployeeId, readAt: null },
    }),
    prisma.workforceWorkplaceInbox.count({
      where: { organizationId, recipientWorkforceEmployeeId, readAt: null },
    }),
  ]);
  return recruitment + workplace;
}

export async function markAllCollaboratorNovedadesRead(organizationId, recipientWorkforceEmployeeId) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const [rec, wp] = await Promise.all([
      tx.workforceRecruitmentNovedad.updateMany({
        where: { organizationId, recipientWorkforceEmployeeId, readAt: null },
        data: { readAt: now },
      }),
      tx.workforceWorkplaceInbox.updateMany({
        where: { organizationId, recipientWorkforceEmployeeId, readAt: null },
        data: { readAt: now },
      }),
    ]);
    return { ok: true, marked: rec.count + wp.count };
  });
}

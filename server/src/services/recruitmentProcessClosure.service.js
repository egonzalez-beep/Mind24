import { prisma } from '../db/client.js';
import {
  cancelOpenStageNovedadWaits,
  emitWorkforceRecruitmentNovedadForDecline,
} from './workforceRecruitmentNovedad.service.js';

export const AUTO_ARCHIVE_DELAY_MS = 24 * 60 * 60 * 1000;
export const AUTO_ARCHIVE_SWEEP_MS = 5 * 60 * 1000;
export const CLOSURE_NOTE_MAX = 240;

export const DECLINE_REASON_KEYS = [
  'ACCEPTED_OTHER_OFFER',
  'PAY_OR_CONDITIONS',
  'LOCATION_OR_TRANSPORT',
  'SCHEDULE',
  'PERSONAL',
  'NO_LONGER_INTERESTED',
  'NO_RESPONSE',
  'OTHER',
];

const TERMINAL_STAGE_KEYS = ['HIRED', 'REJECTED'];

export const CLOSED_PROCESS_STAGE_MESSAGE =
  'Este proceso ya está cerrado. Inicia un nuevo proceso para continuar con el candidato.';

export const HIRED_STAGE_MOVE_MESSAGE =
  'Este candidato ya está contratado. Liberar la contratación es una operación aparte.';

function businessError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Lectura canónica. No escribe en la base.
 * HIRED sin resultado sigue siendo contratación histórica.
 * REJECTED sin resultado sigue siendo rechazo histórico.
 * DECLINED es declinación aunque la etapa visible no sea terminal.
 */
export function classifyRecruitmentApplication(stageKey, closureOutcome) {
  if (closureOutcome === 'DECLINED') return 'declined';
  if (closureOutcome === 'REJECTED' || stageKey === 'REJECTED') return 'rejected';
  if (stageKey === 'HIRED') return 'hired';
  return 'active';
}

export function isRecruitmentApplicationOpen(stageKey, closureOutcome) {
  return classifyRecruitmentApplication(stageKey, closureOutcome) === 'active';
}

export function isRecruitmentApplicationVisibleInKanban(stageKey, closureOutcome) {
  return classifyRecruitmentApplication(stageKey, closureOutcome) !== 'declined';
}

export const recruitmentApplicationIsOpen = isRecruitmentApplicationOpen;

export function recruitmentProcessClosureIsImmutable(stageKey, closureOutcome) {
  const kind = classifyRecruitmentApplication(stageKey, closureOutcome);
  return kind === 'rejected' || kind === 'declined';
}

export function openApplicationWhere() {
  return {
    closureOutcome: null,
    stage: { key: { notIn: TERMINAL_STAGE_KEYS } },
  };
}

/** El tablero excluye solo la declinación. Descartado y Contratado siguen visibles. */
export function kanbanVisibleApplicationWhere() {
  return {
    OR: [
      { closureOutcome: null },
      { closureOutcome: { not: 'DECLINED' } },
    ],
  };
}

/**
 * El primer paso a la clave REJECTED guarda el cierre.
 * Repetir la etapa no reescribe nada. Un cierre ya existente no se limpia.
 */
export function closurePatchForStageMove({
  stageChanged,
  fromStageKey = null,
  fromOutcome = null,
  toStageKey,
  now = new Date(),
}) {
  if (!stageChanged) return {};
  if (recruitmentProcessClosureIsImmutable(fromStageKey, fromOutcome)) return {};
  if (toStageKey === 'REJECTED') {
    return {
      closureOutcome: 'REJECTED',
      closedAt: now,
      closureReason: null,
      closureNote: null,
    };
  }
  return {};
}

export function assertRecruitmentProcessStageChangeAllowed({ stageKey, closureOutcome, stageChanged }) {
  if (!stageChanged) return;
  const kind = classifyRecruitmentApplication(stageKey, closureOutcome);
  if (kind === 'hired') throw businessError('CONFLICT', HIRED_STAGE_MOVE_MESSAGE);
  if (kind === 'rejected' || kind === 'declined') {
    throw businessError('CONFLICT', CLOSED_PROCESS_STAGE_MESSAGE);
  }
}

/**
 * Bloquea la fila del candidato hasta el fin de la transacción.
 * El archivado automático y el alta de postulación usan este mismo candado,
 * así una instancia no archiva mientras otra inserta.
 * En un cliente sin $queryRaw el candado no existe: la base de producción sí lo tiene.
 */
export async function lockRecruitmentCandidateForProcessChange(tx, candidateId) {
  if (!candidateId || typeof tx?.$queryRaw !== 'function') return null;
  return tx.$queryRaw`
    SELECT "id" FROM "RecruitmentCandidate"
    WHERE "id" = ${candidateId}
    FOR UPDATE
  `;
}

function normalizeDeclineReason(reason, note) {
  const key = String(reason || '').trim();
  if (!DECLINE_REASON_KEYS.includes(key)) {
    throw businessError('VALIDATION_ERROR', 'Selecciona un motivo de declinación.');
  }
  let closureNote = null;
  if (key === 'OTHER' && note != null && String(note).trim()) {
    closureNote = String(note).trim().slice(0, CLOSURE_NOTE_MAX);
  }
  return { closureReason: key, closureNote };
}

/**
 * Programa o cancela el archivado automático.
 * Una contratación vigente (etapa HIRED) o cualquier proceso abierto lo cancela.
 * El reloj de 24 h de cobertura no se reutiliza: este vencimiento es independiente.
 */
export async function clearCandidateAutoArchive(tx, candidateId) {
  if (!candidateId) return;
  await tx.recruitmentCandidate.update({
    where: { id: candidateId },
    data: { autoArchiveEligibleAt: null },
  });
}

export async function syncCandidateAutoArchive(tx, { organizationId, candidateId, now = new Date() }) {
  if (!organizationId || !candidateId) return null;
  const candidate = await tx.recruitmentCandidate.findFirst({
    where: { id: candidateId, organizationId },
    select: { id: true, archivedAt: true },
  });
  if (!candidate || candidate.archivedAt) return null;
  const apps = await tx.recruitmentApplication.findMany({
    where: { organizationId, candidateId },
    select: { closureOutcome: true, stage: { select: { key: true } } },
  });
  const staysActive = apps.some(
    (app) => app.stage?.key === 'HIRED' || recruitmentApplicationIsOpen(app.stage?.key, app.closureOutcome),
  );
  const autoArchiveEligibleAt = staysActive ? null : new Date(now.getTime() + AUTO_ARCHIVE_DELAY_MS);
  await tx.recruitmentCandidate.update({
    where: { id: candidateId },
    data: { autoArchiveEligibleAt },
  });
  return autoArchiveEligibleAt;
}

export async function assertCandidateCanBeArchived(tx, { organizationId, candidateId }) {
  const openCount = await tx.recruitmentApplication.count({
    where: { organizationId, candidateId, ...openApplicationWhere() },
  });
  if (openCount > 0) {
    throw businessError(
      'VALIDATION_ERROR',
      'Antes de archivarlo debes cerrar sus procesos activos.',
    );
  }
  return openCount;
}

/**
 * Declinación. La etapa no cambia: el cierre vive en la postulación.
 * Si la novedad falla por algo distinto al dedupe, la transacción revierte
 * el cierre. Un reintento puede cerrar de nuevo. P2002 no revierte: el aviso
 * ya existe y el cierre debe quedar.
 * Una repetición o una carrera no escribe un segundo cierre ni una segunda novedad.
 */
export async function declineRecruitmentApplication({
  organizationId,
  applicationId,
  reason,
  note,
  now = new Date(),
  db = prisma,
}) {
  const { closureReason, closureNote } = normalizeDeclineReason(reason, note);
  return db.$transaction(async (tx) => {
    const app = await tx.recruitmentApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: {
        stage: { select: { id: true, key: true, name: true } },
        candidate: { select: { id: true, archivedAt: true } },
      },
    });
    if (!app) {
      throw businessError('NOT_FOUND', 'Postulación no encontrada.');
    }
    if (app.closureOutcome === 'DECLINED') {
      return { application: app, alreadyClosed: true };
    }
    if (!recruitmentApplicationIsOpen(app.stage?.key, app.closureOutcome)) {
      throw businessError('CONFLICT', CLOSED_PROCESS_STAGE_MESSAGE);
    }
    const won = await tx.recruitmentApplication.updateMany({
      where: {
        id: applicationId,
        organizationId,
        closureOutcome: null,
        stageId: app.stageId,
      },
      data: {
        closureOutcome: 'DECLINED',
        closureReason,
        closureNote,
        closedAt: now,
      },
    });
    if (won.count !== 1) {
      const fresh = await tx.recruitmentApplication.findFirst({
        where: { id: applicationId, organizationId },
        include: { stage: { select: { key: true } } },
      });
      if (fresh?.closureOutcome === 'DECLINED') {
        return { application: fresh, alreadyClosed: true };
      }
      if (fresh && recruitmentApplicationIsOpen(fresh.stage?.key, fresh.closureOutcome)) {
        throw businessError('CONFLICT', 'La etapa cambió en otra operación. Actualiza el expediente.');
      }
      throw businessError('CONFLICT', 'El proceso ya no está activo.');
    }
    await cancelOpenStageNovedadWaits(tx, applicationId);
    await emitWorkforceRecruitmentNovedadForDecline(tx, { organizationId, applicationId });
    await syncCandidateAutoArchive(tx, { organizationId, candidateId: app.candidateId, now });
    const closed = await tx.recruitmentApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: { candidate: true, stage: true, vacancy: { select: { id: true, title: true } } },
    });
    return { application: closed, alreadyClosed: false };
  });
}

async function candidateStillEligibleToArchive(tx, row, now) {
  if (!row?.autoArchiveEligibleAt || new Date(row.autoArchiveEligibleAt).getTime() > now.getTime()) {
    return false;
  }
  const fresh = await tx.recruitmentCandidate.findFirst({
    where: { id: row.id, organizationId: row.organizationId },
    select: { archivedAt: true, autoArchiveEligibleAt: true },
  });
  if (!fresh || fresh.archivedAt) return false;
  if (!fresh.autoArchiveEligibleAt || new Date(fresh.autoArchiveEligibleAt).getTime() > now.getTime()) {
    return false;
  }
  const apps = await tx.recruitmentApplication.findMany({
    where: { organizationId: row.organizationId, candidateId: row.id },
    select: { closureOutcome: true, stage: { select: { key: true } } },
  });
  const blocked = apps.some(
    (app) => app.stage?.key === 'HIRED' || recruitmentApplicationIsOpen(app.stage?.key, app.closureOutcome),
  );
  return !blocked;
}

/**
 * Archiva solo candidatos cuyo vencimiento ya pasó y que siguen sin proceso
 * abierto ni contratación vigente. La actualización es condicional al mismo
 * autoArchiveEligibleAt leído, así dos instancias no archivan dos veces.
 * No crea novedad.
 */
export async function deliverDueCandidateAutoArchives({ now = new Date(), db = prisma, limit = 50 } = {}) {
  const due = await db.recruitmentCandidate.findMany({
    where: {
      archivedAt: null,
      autoArchiveEligibleAt: { lte: now },
    },
    select: { id: true, organizationId: true, autoArchiveEligibleAt: true },
    take: limit,
    orderBy: [{ autoArchiveEligibleAt: 'asc' }, { id: 'asc' }],
  });
  let archived = 0;
  for (const row of due) {
    try {
      const did = await db.$transaction(async (tx) => {
        await lockRecruitmentCandidateForProcessChange(tx, row.id);
        const ok = await candidateStillEligibleToArchive(tx, row, now);
        if (!ok) {
          await tx.recruitmentCandidate.updateMany({
            where: {
              id: row.id,
              organizationId: row.organizationId,
              archivedAt: null,
              autoArchiveEligibleAt: row.autoArchiveEligibleAt,
            },
            data: { autoArchiveEligibleAt: null },
          });
          return false;
        }
        const won = await tx.recruitmentCandidate.updateMany({
          where: {
            id: row.id,
            organizationId: row.organizationId,
            archivedAt: null,
            autoArchiveEligibleAt: row.autoArchiveEligibleAt,
          },
          data: { archivedAt: now, autoArchiveEligibleAt: null },
        });
        return won.count === 1;
      });
      if (did) archived += 1;
    } catch (err) {
      console.error('[candidate-auto-archive]', err?.message || err);
    }
  }
  return { scanned: due.length, archived };
}

let autoArchiveTimer = null;
let autoArchiveRunning = false;

export function runCandidateAutoArchiveSweepTick(task = () => deliverDueCandidateAutoArchives()) {
  if (autoArchiveRunning) return Promise.resolve({ skipped: true });
  autoArchiveRunning = true;
  return Promise.resolve()
    .then(() => task())
    .catch((err) => {
      console.error('[candidate-auto-archive]', err?.message || err);
      return { failed: true };
    })
    .finally(() => {
      autoArchiveRunning = false;
    });
}

export function startCandidateAutoArchiveSweep() {
  if (autoArchiveTimer) return;
  const tick = () => {
    runCandidateAutoArchiveSweepTick().catch(() => {});
  };
  tick();
  autoArchiveTimer = setInterval(tick, AUTO_ARCHIVE_SWEEP_MS);
  if (typeof autoArchiveTimer.unref === 'function') autoArchiveTimer.unref();
}

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

const TERMINAL_STAGE_KEYS = ['HIRED', 'EMPLOYMENT_EXIT', 'REJECTED'];

export const CLOSED_PROCESS_STAGE_MESSAGE =
  'Este proceso ya está cerrado. Inicia un nuevo proceso para continuar con el candidato.';

export const HIRED_STAGE_MOVE_MESSAGE =
  'Este candidato ya está contratado. Liberar la contratación es una operación aparte.';

export const EMPLOYMENT_EXIT_STAGE_MOVE_MESSAGE =
  'Esta contratación ya tiene baja registrada. El movimiento debe hacerse con Registrar baja.';

/** Índice único parcial: como máximo una postulación que bloquea reaplicación por par candidato–vacante. */
export const BLOCKS_REAPPLICATION_UNIQUE_INDEX =
  'RecruitmentApplication_candidate_vacancy_blocks_reapplication_key';

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
  if (stageKey === 'EMPLOYMENT_EXIT') return 'exited';
  if (stageKey === 'HIRED') return 'hired';
  return 'active';
}

/**
 * Valor esperado de blocksReapplication. No redefine “proceso abierto”:
 * HIRED y Baja bloquean reaplicación aunque no estén abiertos y nunca deben ser false.
 */
export function expectedBlocksReapplication(stageKey, closureOutcome) {
  if (stageKey === 'HIRED' || stageKey === 'EMPLOYMENT_EXIT') return true;
  const kind = classifyRecruitmentApplication(stageKey, closureOutcome);
  if (kind === 'declined' || kind === 'rejected') return false;
  return true;
}

/**
 * Prisma suele poner en meta.target el nombre del índice parcial o los campos
 * (candidateId, vacancyId). Solo ese unique existe sobre ese par tras la migración;
 * otros P2002 (p. ej. organizationId+dedupeKey) no deben mapearse a este 409.
 */
export function isBlocksReapplicationUniqueViolation(err) {
  if (!err || err.code !== 'P2002') return false;
  const target = err.meta?.target;
  const parts = Array.isArray(target)
    ? target.map((t) => String(t))
    : target != null
      ? [String(target)]
      : [];
  if (!parts.length) return false;
  if (parts.some((p) => p === BLOCKS_REAPPLICATION_UNIQUE_INDEX || p.includes('blocks_reapplication'))) {
    return true;
  }
  const joined = parts.join(',');
  if (joined.includes('organizationId') || joined.includes('dedupeKey') || joined.includes('email')) {
    return false;
  }
  return parts.includes('candidateId') && parts.includes('vacancyId');
}

function terminalEventInstant(value) {
  if (!value) return null;
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isFinite(instant.getTime()) ? instant : null;
}

/**
 * Fecha de lectura del resultado Contratado o Rechazado.
 * closedAt gana. Si no existe, el último ingreso al estado terminal que el
 * historial no abandona después. Una contratación sin eventos usa la entrada
 * registrada en hiredStageEnteredAt. No consulta updatedAt, appliedAt ni el archivo.
 */
export function recruitmentTerminalOutcomeAt(row) {
  const stageKey = row?.stageKey ?? row?.stage?.key ?? null;
  const closureOutcome = row?.closureOutcome ?? null;
  const kind = classifyRecruitmentApplication(stageKey, closureOutcome);
  if (kind !== 'hired' && kind !== 'rejected' && kind !== 'exited') return null;

  const closedAt = terminalEventInstant(row?.closedAt);
  if (closedAt) return closedAt;

  if (kind === 'exited') {
    const exitAt = terminalEventInstant(row?.employmentExit?.createdAt || row?.employmentExit?.registeredAt);
    if (exitAt) return exitAt;
  }

  const target = kind === 'hired' ? 'HIRED' : kind === 'exited' ? 'EMPLOYMENT_EXIT' : 'REJECTED';
  const events = (Array.isArray(row?.stageEvents) ? row.stageEvents : [])
    .map((event, index) => ({
      at: terminalEventInstant(event?.createdAt),
      toKey: String(event?.toStageKey || event?.toStage?.key || ''),
      order: event?.id != null ? String(event.id) : String(index),
    }))
    .filter((event) => event.at)
    .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));

  let definitive = null;
  for (const event of events) {
    if (event.toKey === target) definitive = event.at;
    else definitive = null;
  }
  if (definitive) return definitive;

  if (kind === 'hired' && stageKey === 'HIRED') {
    const entered = terminalEventInstant(row?.hiredStageEnteredAt);
    if (!entered) return null;
    const leftAfterwards = events.some((event) => event.at.getTime() > entered.getTime() && event.toKey !== 'HIRED');
    return leftAfterwards ? null : entered;
  }
  return null;
}

export function isRecruitmentApplicationOpen(stageKey, closureOutcome) {
  return classifyRecruitmentApplication(stageKey, closureOutcome) === 'active';
}

/**
 * Cola operativa de la vacante (inProcess / En proceso).
 * INTERVIEW_NO_SHOW sigue abierta y visible en su columna de cartera, pero no cuenta
 * como trabajo activo del funnel. No redefine classify ni métricas históricas.
 */
export function isRecruitmentApplicationInActiveVacancyQueue(stageKey, closureOutcome) {
  if (!isRecruitmentApplicationOpen(stageKey, closureOutcome)) return false;
  return String(stageKey || '').trim() !== 'INTERVIEW_NO_SHOW';
}

export function isRecruitmentApplicationVisibleInKanban(stageKey, closureOutcome) {
  const kind = classifyRecruitmentApplication(stageKey, closureOutcome);
  return (
    kind === 'active'
    || kind === 'hired'
    || kind === 'exited'
    || kind === 'rejected'
    || kind === 'declined'
  );
}

export const recruitmentApplicationIsOpen = isRecruitmentApplicationOpen;

export function recruitmentProcessClosureIsImmutable(stageKey, closureOutcome) {
  const kind = classifyRecruitmentApplication(stageKey, closureOutcome);
  return kind === 'rejected' || kind === 'declined' || kind === 'exited';
}

export function openApplicationWhere() {
  return {
    closureOutcome: null,
    stage: { key: { notIn: TERMINAL_STAGE_KEYS } },
  };
}

/** El tablero recibe todos los procesos. La columna se decide al pintar. */
export function kanbanVisibleApplicationWhere() {
  return {};
}

/**
 * Antigüedad del intento operativo.
 * Autoridad: createdAt (nacimiento de la fila RecruitmentApplication).
 * Fallback: appliedAt solo si createdAt falta (fixtures o payloads incompletos).
 * Nunca updatedAt, closedAt ni fechas terminales.
 */
export function recruitmentApplicationRecencyMs(app) {
  if (!app) return 0;
  const hasCreated = app.createdAt != null && app.createdAt !== '';
  const raw = hasCreated ? app.createdAt : (app.appliedAt ?? null);
  if (!raw) return 0;
  const ms = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Más reciente primero; empate por id descendente (estable y determinista). */
export function compareRecruitmentApplicationsNewestFirst(a, b) {
  const d = recruitmentApplicationRecencyMs(b) - recruitmentApplicationRecencyMs(a);
  if (d !== 0) return d;
  const idA = String(a?.id ?? '');
  const idB = String(b?.id ?? '');
  if (idA === idB) return 0;
  return idA < idB ? 1 : -1;
}

/**
 * Proceso visible del par candidato–vacante (regla canónica):
 * 1) aplicación abierta actual (si hay varias, la más reciente);
 * 2) si no hay abierta, el intento más reciente;
 * 3) desempate: createdAt (fallback appliedAt) y luego id.
 *
 * Autoridad del Kanban operativo: selectOperationalApplicationsForVacancyKanban
 * (listRecruitmentApplicationsForVacancy). El frontend solo puede espejar esta regla.
 */
export function pickOperationalApplicationForCandidateVacancy(appsForSamePair) {
  const rows = (Array.isArray(appsForSamePair) ? appsForSamePair : []).filter(Boolean);
  if (!rows.length) return null;
  const open = rows.filter((app) => {
    const stageKey = app?.stage?.key ?? app?.stageKey ?? null;
    return isRecruitmentApplicationOpen(stageKey, app?.closureOutcome ?? null);
  });
  const pool = open.length ? open : rows;
  return [...pool].sort(compareRecruitmentApplicationsNewestFirst)[0] ?? null;
}

/**
 * Autoridad del tablero: una tarjeta operativa por candidateId en la vacante.
 * Agrupa solo por IDs canónicos; no fusiona personas distintas.
 */
export function selectOperationalApplicationsForVacancyKanban(applications) {
  const rows = Array.isArray(applications) ? applications : [];
  if (rows.length <= 1) return rows;
  const byCandidate = new Map();
  for (const app of rows) {
    const cid = String(app?.candidateId ?? app?.candidate?.id ?? '');
    if (!cid) continue;
    if (!byCandidate.has(cid)) byCandidate.set(cid, []);
    byCandidate.get(cid).push(app);
  }
  const chosenIds = new Set();
  for (const group of byCandidate.values()) {
    const pick = pickOperationalApplicationForCandidateVacancy(group);
    if (pick?.id != null) chosenIds.add(String(pick.id));
  }
  return rows.filter((app) => chosenIds.has(String(app?.id)));
}

/** Mensajes 409 de reaplicación (activo vs contratado). */
export function reapplicationConflictMessage(stageKey, closureOutcome) {
  if (classifyRecruitmentApplication(stageKey, closureOutcome) === 'hired') {
    return 'El candidato ya fue contratado en esta vacante.';
  }
  return 'El candidato ya tiene un proceso activo en esta vacante.';
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
      blocksReapplication: false,
    };
  }
  return {
    blocksReapplication: expectedBlocksReapplication(toStageKey, null),
  };
}

export function assertRecruitmentProcessStageChangeAllowed({ stageKey, closureOutcome, stageChanged }) {
  if (!stageChanged) return;
  const kind = classifyRecruitmentApplication(stageKey, closureOutcome);
  if (kind === 'hired') throw businessError('CONFLICT', HIRED_STAGE_MOVE_MESSAGE);
  if (kind === 'exited') throw businessError('CONFLICT', CLOSED_PROCESS_STAGE_MESSAGE);
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
  const key = reason == null ? '' : String(reason).trim();
  if (!key) return { closureReason: null, closureNote: null };
  if (!DECLINE_REASON_KEYS.includes(key)) {
    throw businessError('VALIDATION_ERROR', 'Selecciona un motivo de declinación.');
  }
  if (key === 'OTHER') {
    const text = note == null ? '' : String(note).trim();
    if (!text) throw businessError('VALIDATION_ERROR', 'Escribe el detalle del motivo.');
    return { closureReason: 'OTHER', closureNote: text.slice(0, CLOSURE_NOTE_MAX) };
  }
  return { closureReason: key, closureNote: null };
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
  createdByUserId = null,
  db = prisma,
}) {
  const { closureReason, closureNote } = normalizeDeclineReason(reason, note);
  return db.$transaction(async (tx) => {
    const { lockRecruitmentApplicationRow } = await import(
      './recruitmentApplicationEmploymentExit.service.js'
    );
    await lockRecruitmentApplicationRow(tx, organizationId, applicationId);

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
      const { clearScheduledHireOnApplication } = await import(
        './recruitmentApplicationScheduledHire.service.js'
      );
      await clearScheduledHireOnApplication(tx, { organizationId, applicationId });
      const cleaned = await tx.recruitmentApplication.findFirst({
        where: { id: applicationId, organizationId },
        include: { stage: { select: { id: true, key: true, name: true } }, candidate: { select: { id: true, archivedAt: true } } },
      });
      return { application: cleaned || app, alreadyClosed: true };
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
        blocksReapplication: false,
        scheduledEmploymentStartDate: null,
      },
    });
    if (won.count !== 1) {
      const fresh = await tx.recruitmentApplication.findFirst({
        where: { id: applicationId, organizationId },
        include: { stage: { select: { key: true } } },
      });
      if (fresh?.closureOutcome === 'DECLINED') {
        const { clearScheduledHireOnApplication } = await import(
          './recruitmentApplicationScheduledHire.service.js'
        );
        await clearScheduledHireOnApplication(tx, { organizationId, applicationId });
        return { application: fresh, alreadyClosed: true };
      }
      if (fresh && recruitmentApplicationIsOpen(fresh.stage?.key, fresh.closureOutcome)) {
        throw businessError('CONFLICT', 'La etapa cambió en otra operación. Actualiza el expediente.');
      }
      throw businessError('CONFLICT', 'El proceso ya no está activo.');
    }
    {
      const { invalidateScheduledHireNotificationsForApplication } = await import(
        './orgNotification.service.js'
      );
      await invalidateScheduledHireNotificationsForApplication(tx, organizationId, applicationId);
    }
    await cancelOpenStageNovedadWaits(tx, applicationId);
    await emitWorkforceRecruitmentNovedadForDecline(tx, { organizationId, applicationId });
    await syncCandidateAutoArchive(tx, { organizationId, candidateId: app.candidateId, now });
    const { cancelScheduledInterviewsForClosedApplication } = await import(
      './recruitmentApplicationInterviewEvent.service.js'
    );
    await cancelScheduledInterviewsForClosedApplication(tx, {
      organizationId,
      applicationId,
      createdByUserId,
      legacyScheduledAt: app.interviewScheduledAt,
      legacyTimeSpecified: app.interviewTimeSpecified,
      stageId: app.stageId,
    });
    const closed = await tx.recruitmentApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: { candidate: true, stage: true, vacancy: { select: { id: true, title: true } } },
    });
    {
      const { syncVacancyActiveQueueEmptiedAt } = await import('./recruitmentVacancy.service.js');
      await syncVacancyActiveQueueEmptiedAt(organizationId, app.vacancyId, tx, now);
    }
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

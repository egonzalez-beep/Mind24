import { prisma } from '../db/client.js';
import {
  parseInterviewScheduleFields,
  stageKeyAllowsInterviewSchedule,
} from './recruitmentInterviewSchedule.service.js';
import { resolveOrganizationIanaTimezone } from './organizationTimezone.service.js';
import {
  CLOSED_PROCESS_STAGE_MESSAGE,
  classifyRecruitmentApplication,
} from './recruitmentProcessClosure.service.js';

export const RECRUITMENT_APPLICATION_INTERVIEW_EVENT_TYPES = new Set([
  'ATTENDED',
  'NO_SHOW',
  'RESCHEDULED',
]);

export const INTERVIEW_EVENT_STALE_MESSAGE =
  'La entrevista cambió mientras realizabas esta acción. Actualiza e inténtalo nuevamente.';

export function interviewScheduleSlotsEqual(aAt, aTimeSpecified, bAt, bTimeSpecified) {
  if (!aAt || !bAt) return false;
  const aSpec = aTimeSpecified !== false;
  const bSpec = bTimeSpecified !== false;
  return aAt.getTime() === bAt.getTime() && aSpec === bSpec;
}

export function serializeRecruitmentApplicationInterviewEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    applicationId: row.applicationId,
    eventType: row.eventType,
    scheduledAt: row.scheduledAt.toISOString(),
    scheduledTimeSpecified: row.scheduledTimeSpecified !== false,
    rescheduledToAt: row.rescheduledToAt ? row.rescheduledToAt.toISOString() : null,
    rescheduledToTimeSpecified:
      row.rescheduledToTimeSpecified != null ? row.rescheduledToTimeSpecified !== false : null,
    stageId: row.stageId,
    stageName: row.stage?.name ?? null,
    stageKey: row.stage?.key ?? null,
    label: row.label || null,
    comment: row.comment || null,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdBy?.fullName ?? null,
  };
}

export const INTERVIEW_COMMENT_MAX = 500;
export const INTERVIEW_LABEL_MAX = 80;
export const INTERVIEW_CLOSED_SYSTEM_COMMENT = 'Proceso cerrado';
export const INTERVIEW_CLOSED_UNRESOLVED_COMMENT = 'Proceso cerrado sin resultado registrado';
export const INTERVIEW_CLEARED_SYSTEM_COMMENT = 'Cita cancelada';
export const INTERVIEW_SLOT_TAKEN_MESSAGE = 'Ya existe una entrevista programada en ese horario para este proceso.';
export const INTERVIEW_SCHEDULED_SLOT_INDEX = 'RecruitmentApplicationInterviewEvent_one_scheduled_slot';

export function interviewStatusLabel(eventType) {
  if (eventType === 'SCHEDULED') return 'Programada';
  if (eventType === 'ATTENDED') return 'Realizada';
  if (eventType === 'RESCHEDULED') return 'Reprogramada';
  if (eventType === 'CANCELLED') return 'Cancelada';
  if (eventType === 'NO_SHOW') return 'No asistió';
  return '';
}

export function normalizeInterviewText(value, max, label) {
  if (value == null) return null;
  const text = String(value).replace(/\u0000/g, '').trim();
  if (!text) return null;
  if (text.length > max) {
    throw validationError(`${label} admite hasta ${max} caracteres.`);
  }
  return text;
}

export function normalizeInterviewComment(value) {
  return normalizeInterviewText(value, INTERVIEW_COMMENT_MAX, 'El comentario');
}

export function normalizeInterviewLabel(value) {
  return normalizeInterviewText(value, INTERVIEW_LABEL_MAX, 'El nombre de la entrevista');
}

/**
 * Lista que ve el expediente. Una cita antigua que solo vive en
 * interviewScheduledAt aparece como la primera Programada, sin backfill.
 */
export function buildApplicationInterviewRows(application, events) {
  const rows = (events || []).map((event) => ({ ...event }));
  const snapshot = application?.interviewScheduledAt
    ? new Date(application.interviewScheduledAt)
    : null;
  if (snapshot && !Number.isNaN(snapshot.getTime())) {
    const matched = rows.some((event) => {
      if (event.eventType !== 'SCHEDULED' || !event.scheduledAt) return false;
      return interviewScheduleSlotsEqual(
        new Date(event.scheduledAt),
        event.scheduledTimeSpecified !== false,
        snapshot,
        application.interviewTimeSpecified !== false,
      );
    });
    if (!matched) {
      rows.push({
        id: null,
        legacy: true,
        applicationId: application.id,
        eventType: 'SCHEDULED',
        scheduledAt: snapshot.toISOString(),
        scheduledTimeSpecified: application.interviewTimeSpecified !== false,
        rescheduledToAt: null,
        rescheduledToTimeSpecified: null,
        stageId: application.stageId || application.stage?.id || null,
        stageName: application.stage?.name || null,
        stageKey: application.stage?.key || null,
        label: null,
        comment: null,
        createdAt: snapshot.toISOString(),
        createdByName: null,
      });
    }
  }
  return rows;
}

/**
 * Próxima cita de la tarjeta: la SCHEDULED futura más cercana.
 * Una SCHEDULED cuya hora ya pasó sigue pendiente, pero no ocupa el apuntador.
 */
export function selectNextInterviewPointer(rows, now = new Date()) {
  const nowMs = now.getTime();
  const future = (rows || [])
    .filter((row) => row?.eventType === 'SCHEDULED' && row.scheduledAt)
    .filter((row) => new Date(row.scheduledAt).getTime() >= nowMs)
    .sort((a, b) => {
      const delta = new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
      if (delta !== 0) return delta;
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    });
  return future[0] || null;
}

/**
 * N es el número de citas, no de movimientos.
 * Reprogramada es el antecedente de la misma cadena y no suma.
 * rescheduledToAt enlaza ese antecedente con el horario nuevo.
 */
export function countVisibleInterviews(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((row) => row?.eventType !== 'RESCHEDULED').length;
}

export function orderInterviewsForDisplay(rows, now = new Date()) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const nowMs = now.getTime();
  const scheduled = list.filter((row) => row.eventType === 'SCHEDULED');
  const upcoming = scheduled
    .filter((row) => new Date(row.scheduledAt).getTime() >= nowMs)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const overdue = scheduled
    .filter((row) => new Date(row.scheduledAt).getTime() < nowMs)
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
  const past = list
    .filter((row) => row.eventType !== 'SCHEDULED')
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
  return {
    upcoming,
    overdue,
    past,
    total: countVisibleInterviews(list),
    next: upcoming[0] || null,
    now: now.toISOString(),
  };
}

export function isScheduledInterviewSlotConflict(err) {
  if (err?.code !== 'P2002') return false;
  const target = err.meta?.target;
  const text = Array.isArray(target) ? target.join(' ') : String(target ?? '');
  return text.includes(INTERVIEW_SCHEDULED_SLOT_INDEX);
}

function validationError(message) {
  const err = new Error('VALIDATION_ERROR');
  err.code = 'VALIDATION_ERROR';
  err.message = message;
  return err;
}

function conflictError(message) {
  const err = new Error('CONFLICT');
  err.code = 'CONFLICT';
  err.message = message;
  return err;
}

/**
 * Un P2002 del índice parcial no significa que la reprogramación haya
 * terminado. Se reintenta una vez: solo es idempotente si la fila origen
 * ya quedó RESCHEDULED hacia ese instante. El segundo conflicto de horario
 * se entrega como el 409 de cita ocupada.
 */
async function runInterviewWrite(run) {
  try {
    return await run();
  } catch (err) {
    if (!isScheduledInterviewSlotConflict(err)) throw err;
    try {
      return await run();
    } catch (retryErr) {
      if (retryErr?.code === 'CONFLICT') throw retryErr;
      if (isScheduledInterviewSlotConflict(retryErr)) throw conflictError(INTERVIEW_SLOT_TAKEN_MESSAGE);
      throw retryErr;
    }
  }
}

const applicationInclude = {
  vacancy: { select: { id: true, title: true, clientName: true, status: true } },
  stage: { select: { id: true, key: true, name: true } },
};

const eventInclude = {
  stage: { select: { id: true, key: true, name: true } },
  createdBy: { select: { fullName: true } },
};

/**
 * Candado optimista del endpoint anterior. Cambia el predicado para que
 * la solicitud perdedora no cree otro resultado. En la misma transacción,
 * recalculateInterviewScheduledAt vuelve a dejar el apuntador canónico.
 */
async function conditionalUpdateInterviewSnapshot(tx, {
  organizationId,
  applicationId,
  expectedScheduledAt,
  expectedTimeSpecified,
  expectedStageId,
  data,
}) {
  const result = await tx.recruitmentApplication.updateMany({
    where: {
      id: applicationId,
      organizationId,
      stageId: expectedStageId,
      interviewScheduledAt: expectedScheduledAt,
      interviewTimeSpecified: expectedTimeSpecified,
    },
    data,
  });
  if (result.count !== 1) {
    throw conflictError(INTERVIEW_EVENT_STALE_MESSAGE);
  }
}

function serializeApplicationPatch(row) {
  return {
    id: row.id,
    interviewScheduledAt: row.interviewScheduledAt
      ? row.interviewScheduledAt.toISOString()
      : null,
    interviewTimeSpecified: row.interviewTimeSpecified !== false,
    stageId: row.stageId,
    stage: row.stage,
  };
}

/**
 * Registra resultado de entrevista (transaccional). Update condicional → evento.
 */
export async function recordRecruitmentApplicationInterviewEvent({
  organizationId,
  applicationId,
  eventType,
  createdByUserId,
  interviewDate,
  interviewTime,
}) {
  const type = String(eventType || '').trim();
  if (!RECRUITMENT_APPLICATION_INTERVIEW_EVENT_TYPES.has(type)) {
    throw validationError('Tipo de evento de entrevista no válido.');
  }

  return runInterviewWrite(() => prisma.$transaction(async (tx) => {
    const app = await tx.recruitmentApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: { stage: { select: { id: true, key: true, name: true } } },
    });
    if (!app) {
      const err = new Error('NOT_FOUND');
      err.code = 'NOT_FOUND';
      err.message = 'Postulación no encontrada.';
      throw err;
    }
    if (!stageKeyAllowsInterviewSchedule(app.stage?.key)) {
      throw validationError('La acción solo aplica en etapas de entrevista.');
    }
    if (!app.interviewScheduledAt) {
      throw conflictError('No hay entrevista programada para registrar un resultado.');
    }

    const expectedScheduledAt = app.interviewScheduledAt;
    const expectedTimeSpecified = app.interviewTimeSpecified !== false;
    const expectedStageId = app.stageId;
    const scheduledAt = expectedScheduledAt;
    const scheduledTimeSpecified = expectedTimeSpecified;
    const stageId = expectedStageId;

    if (type === 'ATTENDED' || type === 'NO_SHOW') {
      await conditionalUpdateInterviewSnapshot(tx, {
        organizationId,
        applicationId,
        expectedScheduledAt,
        expectedTimeSpecified,
        expectedStageId,
        data: {
          interviewScheduledAt: null,
          interviewTimeSpecified: true,
        },
      });
      const event = await tx.recruitmentApplicationInterviewEvent.create({
        data: {
          organizationId,
          applicationId,
          stageId,
          eventType: type,
          scheduledAt,
          scheduledTimeSpecified,
          createdByUserId,
        },
        include: eventInclude,
      });
      await recalculateInterviewScheduledAt(tx, { ...app, interviewScheduledAt: null }, new Date(), createdByUserId);
      const updated = await tx.recruitmentApplication.findFirst({
        where: { id: applicationId, organizationId },
        include: applicationInclude,
      });
      return {
        event: serializeRecruitmentApplicationInterviewEvent(event),
        application: serializeApplicationPatch(updated),
      };
    }

    const dateTrim = interviewDate != null ? String(interviewDate).trim() : '';
    if (!dateTrim) {
      throw validationError('Indica la nueva fecha de entrevista.');
    }
    const timeZone = await resolveOrganizationIanaTimezone(organizationId);
    const parsed = parseInterviewScheduleFields(
      { interviewDate: interviewDate, interviewTime: interviewTime },
      timeZone,
    );
    if (!parsed?.scheduledAt) {
      throw validationError('Indica la nueva fecha de entrevista.');
    }
    if (
      interviewScheduleSlotsEqual(
        scheduledAt,
        scheduledTimeSpecified,
        parsed.scheduledAt,
        parsed.timeSpecified,
      )
    ) {
      const current = await findScheduledSlot(tx, organizationId, applicationId, scheduledAt, scheduledTimeSpecified);
      const updated = await tx.recruitmentApplication.findFirst({
        where: { id: applicationId, organizationId },
        include: applicationInclude,
      });
      return {
        event: current
          ? serializeRecruitmentApplicationInterviewEvent(current)
          : syntheticScheduledInterview(app, scheduledAt, scheduledTimeSpecified),
        application: serializeApplicationPatch(updated),
        unchanged: true,
      };
    }
    const occupant = await findScheduledSlot(
      tx, organizationId, applicationId, parsed.scheduledAt, parsed.timeSpecified,
    );
    if (occupant) throw conflictError(INTERVIEW_SLOT_TAKEN_MESSAGE);

    await conditionalUpdateInterviewSnapshot(tx, {
      organizationId,
      applicationId,
      expectedScheduledAt,
      expectedTimeSpecified,
      expectedStageId,
      data: {
        interviewScheduledAt: parsed.scheduledAt,
        interviewTimeSpecified: parsed.timeSpecified,
      },
    });
    let source = await findScheduledSlot(tx, organizationId, applicationId, scheduledAt, scheduledTimeSpecified);
    if (!source) source = await materializeLegacySnapshot(tx, app, createdByUserId);
    if (!source?.id) throw conflictError('No hay entrevista programada para reprogramar.');
    const moved = await rescheduleInterviewRow(
      tx, app, source, parsed.scheduledAt, parsed.timeSpecified, createdByUserId, new Date(),
    );
    const updated = await tx.recruitmentApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: applicationInclude,
    });
    return {
      event: moved.interview,
      application: serializeApplicationPatch(updated),
      unchanged: moved.alreadyApplied,
    };
  }));
}

export async function listInterviewEventsForApplications(organizationId, applicationIds) {
  if (!applicationIds.length) return new Map();
  const rows = await prisma.recruitmentApplicationInterviewEvent.findMany({
    where: { organizationId, applicationId: { in: applicationIds } },
    orderBy: [{ createdAt: 'desc' }],
    include: {
      stage: { select: { id: true, key: true, name: true } },
      createdBy: { select: { fullName: true } },
    },
  });
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.applicationId)) map.set(row.applicationId, []);
    map.get(row.applicationId).push(serializeRecruitmentApplicationInterviewEvent(row));
  }
  return map;
}

function notFound(message) {
  const err = new Error('NOT_FOUND');
  err.code = 'NOT_FOUND';
  err.message = message;
  return err;
}

function assertInterviewProcessWritable(app) {
  if (!app) throw notFound('Postulación no encontrada.');
  if (app.candidate?.archivedAt) {
    throw conflictError('Este candidato está archivado. Reactívalo para continuar.');
  }
  const kind = classifyRecruitmentApplication(app.stage?.key, app.closureOutcome);
  if (kind !== 'active') throw conflictError(CLOSED_PROCESS_STAGE_MESSAGE);
}

async function loadWritableApplication(tx, organizationId, applicationId) {
  const app = await tx.recruitmentApplication.findFirst({
    where: { id: applicationId, organizationId },
    include: {
      stage: { select: { id: true, key: true, name: true } },
      candidate: { select: { id: true, archivedAt: true } },
      vacancy: { select: { id: true } },
    },
  });
  assertInterviewProcessWritable(app);
  return app;
}

async function pointSnapshotAt(tx, { organizationId, applicationId, scheduledAt, timeSpecified }) {
  await tx.recruitmentApplication.updateMany({
    where: { id: applicationId, organizationId },
    data: {
      interviewScheduledAt: scheduledAt,
      interviewTimeSpecified: timeSpecified !== false,
    },
  });
}

async function findSlotRows(tx, app, scheduledAt, scheduledTimeSpecified) {
  const rows = await tx.recruitmentApplicationInterviewEvent.findMany({
    where: {
      organizationId: app.organizationId,
      applicationId: app.id,
      scheduledAt,
      scheduledTimeSpecified,
    },
  });
  return rows;
}

/**
 * Convierte la cita que solo vive en la columna en una fila SCHEDULED.
 * Si otra solicitud ya la creó, el índice parcial deja una sola fila.
 * No recrea una cita que ya tiene resultado.
 */
async function materializeLegacySnapshot(tx, app, createdByUserId) {
  if (!createdByUserId || !app?.interviewScheduledAt) return null;
  const scheduledAt = new Date(app.interviewScheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) return null;
  const scheduledTimeSpecified = app.interviewTimeSpecified !== false;
  const rows = await findSlotRows(tx, app, scheduledAt, scheduledTimeSpecified);
  const scheduled = rows.find((row) => row.eventType === 'SCHEDULED');
  if (scheduled) return scheduled;
  if (rows.length) return null;
  return tx.recruitmentApplicationInterviewEvent.create({
    data: {
      organizationId: app.organizationId,
      applicationId: app.id,
      stageId: app.stageId,
      eventType: 'SCHEDULED',
      scheduledAt,
      scheduledTimeSpecified,
      createdByUserId,
    },
    include: eventInclude,
  });
}

/**
 * interviewScheduledAt queda como la próxima SCHEDULED futura.
 * Sin futuras, el apuntador queda null aunque haya una cita atrasada.
 */
async function recalculateInterviewScheduledAt(tx, app, now = new Date(), createdByUserId = null) {
  if (createdByUserId) await materializeLegacySnapshot(tx, app, createdByUserId);
  const rows = await tx.recruitmentApplicationInterviewEvent.findMany({
    where: { organizationId: app.organizationId, applicationId: app.id, eventType: 'SCHEDULED' },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
  });
  const next = selectNextInterviewPointer(rows, now);
  await pointSnapshotAt(tx, {
    organizationId: app.organizationId,
    applicationId: app.id,
    scheduledAt: next ? next.scheduledAt : null,
    timeSpecified: next ? next.scheduledTimeSpecified !== false : true,
  });
  return next;
}

/**
 * Alta del portal de colaboradores. No hay usuario de la organización para
 * firmar una fila, así que la primera cita queda solo en el apuntador y se
 * materializa cuando un administrador programa o resuelve.
 */
export async function recordUnattributedInterviewSnapshot(tx, {
  organizationId,
  applicationId,
  scheduledAt,
  timeSpecified = true,
}) {
  await pointSnapshotAt(tx, {
    organizationId,
    applicationId,
    scheduledAt,
    timeSpecified,
  });
}

function clearedComment(row) {
  return row?.comment && String(row.comment).trim()
    ? row.comment
    : INTERVIEW_CLEARED_SYSTEM_COMMENT;
}

function syntheticScheduledInterview(app, scheduledAt, timeSpecified) {
  return serializeRecruitmentApplicationInterviewEvent({
    id: null,
    applicationId: app.id,
    eventType: 'SCHEDULED',
    scheduledAt: new Date(scheduledAt),
    scheduledTimeSpecified: timeSpecified !== false,
    rescheduledToAt: null,
    rescheduledToTimeSpecified: null,
    stageId: app.stageId,
    stage: app.stage,
    label: null,
    comment: null,
    createdAt: new Date(scheduledAt),
    createdBy: null,
  });
}

async function findScheduledSlot(tx, organizationId, applicationId, scheduledAt, timeSpecified) {
  return tx.recruitmentApplicationInterviewEvent.findFirst({
    where: {
      organizationId,
      applicationId,
      eventType: 'SCHEDULED',
      scheduledAt: new Date(scheduledAt),
      scheduledTimeSpecified: timeSpecified !== false,
    },
    include: eventInclude,
  });
}

function reschedulePointsAt(event, scheduledAt, timeSpecified) {
  return event?.eventType === 'RESCHEDULED'
    && event.rescheduledToAt
    && interviewScheduleSlotsEqual(
      new Date(event.rescheduledToAt),
      event.rescheduledToTimeSpecified !== false,
      new Date(scheduledAt),
      timeSpecified,
    );
}

/**
 * Reprograma una fila dentro de la transacción del llamador.
 * Otra SCHEDULED en el destino rechaza sin escribir.
 * Un reintento cuyo origen ya apunta a ese instante devuelve la cita creada.
 */
async function rescheduleInterviewRow(tx, app, source, scheduledAt, timeSpecified, createdByUserId, now) {
  const nextAt = new Date(scheduledAt);
  const nextTime = timeSpecified !== false;
  if (source.eventType === 'RESCHEDULED') {
    if (!reschedulePointsAt(source, nextAt, nextTime)) {
      throw conflictError('Esta entrevista ya tiene un resultado.');
    }
    const successor = await findScheduledSlot(tx, app.organizationId, app.id, nextAt, nextTime);
    if (!successor) throw conflictError('Esta entrevista ya tiene un resultado.');
    return {
      interview: serializeRecruitmentApplicationInterviewEvent(successor),
      alreadyApplied: true,
    };
  }
  if (source.eventType !== 'SCHEDULED') {
    throw conflictError('Esta entrevista ya tiene un resultado.');
  }
  if (interviewScheduleSlotsEqual(
    new Date(source.scheduledAt),
    source.scheduledTimeSpecified !== false,
    nextAt,
    nextTime,
  )) {
    return {
      interview: serializeRecruitmentApplicationInterviewEvent(source),
      alreadyApplied: true,
    };
  }
  const occupant = await findScheduledSlot(tx, app.organizationId, app.id, nextAt, nextTime);
  if (occupant && occupant.id !== source.id) throw conflictError(INTERVIEW_SLOT_TAKEN_MESSAGE);
  await tx.recruitmentApplicationInterviewEvent.update({
    where: { id: source.id },
    data: {
      eventType: 'RESCHEDULED',
      rescheduledToAt: nextAt,
      rescheduledToTimeSpecified: nextTime,
    },
  });
  const created = await tx.recruitmentApplicationInterviewEvent.create({
    data: {
      organizationId: app.organizationId,
      applicationId: app.id,
      stageId: app.stageId,
      eventType: 'SCHEDULED',
      scheduledAt: nextAt,
      scheduledTimeSpecified: nextTime,
      label: source.label || null,
      createdByUserId,
    },
    include: eventInclude,
  });
  await recalculateInterviewScheduledAt(tx, { ...app, interviewScheduledAt: null }, now, null);
  return {
    interview: serializeRecruitmentApplicationInterviewEvent(created),
    alreadyApplied: false,
  };
}

async function editScheduledInterview(tx, app, source, {
  label,
  comment,
  scheduledAt = null,
  timeSpecified = true,
  createdByUserId,
  now,
}) {
  if (!source || source.eventType !== 'SCHEDULED') {
    throw conflictError('Esta entrevista ya tiene un resultado.');
  }
  const nextLabel = label !== undefined ? normalizeInterviewLabel(label) : (source.label || null);
  const nextComment = comment !== undefined ? normalizeInterviewComment(comment) : (source.comment || null);
  const slotChanges = scheduledAt && !interviewScheduleSlotsEqual(
    new Date(source.scheduledAt),
    source.scheduledTimeSpecified !== false,
    new Date(scheduledAt),
    timeSpecified !== false,
  );
  if (!slotChanges) {
    const sameLabel = (nextLabel || null) === (source.label || null);
    const sameComment = (nextComment || null) === (source.comment || null);
    if (sameLabel && sameComment) {
      return { interview: serializeRecruitmentApplicationInterviewEvent(source), alreadyApplied: true };
    }
    const updated = await tx.recruitmentApplicationInterviewEvent.update({
      where: { id: source.id },
      data: { label: nextLabel, comment: nextComment },
      include: eventInclude,
    });
    return { interview: serializeRecruitmentApplicationInterviewEvent(updated), alreadyApplied: false };
  }
  const moved = await rescheduleInterviewRow(
    tx, app, source, scheduledAt, timeSpecified !== false, createdByUserId, now,
  );
  if (moved.alreadyApplied || !moved.interview?.id) return moved;
  const patched = await tx.recruitmentApplicationInterviewEvent.update({
    where: { id: moved.interview.id },
    data: { label: nextLabel, comment: nextComment },
    include: eventInclude,
  });
  return { interview: serializeRecruitmentApplicationInterviewEvent(patched), alreadyApplied: false };
}

/**
 * El formulario anterior edita la próxima cita y deja las filas sincronizadas.
 * clearInterview cancela solo esa cita. Una fecha distinta la reprograma.
 */
export async function applyRecruitmentInterviewFormChange(tx, {
  organizationId,
  applicationId,
  createdByUserId,
  scheduledAt,
  timeSpecified = true,
  now = new Date(),
}) {
  if (!createdByUserId) throw validationError('No se pudo identificar quién actualiza la entrevista.');
  const app = await loadWritableApplication(tx, organizationId, applicationId);
  if (scheduledAt == null) {
    if (!app.interviewScheduledAt) return { action: 'noop' };
    const slotAt = new Date(app.interviewScheduledAt);
    const slotTime = app.interviewTimeSpecified !== false;
    let row = await tx.recruitmentApplicationInterviewEvent.findFirst({
      where: {
        organizationId,
        applicationId,
        eventType: 'SCHEDULED',
        scheduledAt: slotAt,
        scheduledTimeSpecified: slotTime,
      },
      include: eventInclude,
    });
    if (!row) row = await materializeLegacySnapshot(tx, app, createdByUserId);
    if (row?.id && row.eventType === 'SCHEDULED') {
      await tx.recruitmentApplicationInterviewEvent.update({
        where: { id: row.id },
        data: { eventType: 'CANCELLED', comment: clearedComment(row) },
      });
    }
    await recalculateInterviewScheduledAt(tx, { ...app, interviewScheduledAt: null }, now, null);
    return { action: 'cleared' };
  }
  const nextAt = new Date(scheduledAt);
  if (Number.isNaN(nextAt.getTime())) throw validationError('Indica la fecha de entrevista.');
  if (interviewScheduleSlotsEqual(
    app.interviewScheduledAt ? new Date(app.interviewScheduledAt) : null,
    app.interviewTimeSpecified !== false,
    nextAt,
    timeSpecified,
  )) {
    return { action: 'unchanged' };
  }
  const occupant = await findScheduledSlot(tx, organizationId, applicationId, nextAt, timeSpecified);
  if (occupant) throw conflictError(INTERVIEW_SLOT_TAKEN_MESSAGE);
  if (!app.interviewScheduledAt) {
    await tx.recruitmentApplicationInterviewEvent.create({
      data: {
        organizationId,
        applicationId,
        stageId: app.stageId,
        eventType: 'SCHEDULED',
        scheduledAt: nextAt,
        scheduledTimeSpecified: timeSpecified !== false,
        createdByUserId,
      },
    });
    await recalculateInterviewScheduledAt(tx, app, now, null);
    return { action: 'scheduled' };
  }
  const currentSlot = new Date(app.interviewScheduledAt);
  const currentTime = app.interviewTimeSpecified !== false;
  let current = await findScheduledSlot(tx, organizationId, applicationId, currentSlot, currentTime);
  if (!current) current = await materializeLegacySnapshot(tx, app, createdByUserId);
  if (!current?.id || current.eventType !== 'SCHEDULED') {
    throw conflictError('No hay entrevista programada para reprogramar.');
  }
  const moved = await rescheduleInterviewRow(
    tx, app, current, nextAt, timeSpecified, createdByUserId, now,
  );
  return { action: moved.alreadyApplied ? 'unchanged' : 'rescheduled' };
}

export async function scheduleRecruitmentApplicationInterview({
  organizationId,
  applicationId,
  createdByUserId,
  interviewDate,
  interviewTime,
  label,
  comment,
  timeZone: explicitTimeZone = null,
  now = new Date(),
  db = prisma,
}) {
  const timeZone = explicitTimeZone || (await resolveOrganizationIanaTimezone(organizationId));
  const parsed = parseInterviewScheduleFields({ interviewDate, interviewTime }, timeZone);
  if (!parsed?.scheduledAt) throw validationError('Indica la fecha de entrevista.');
  const cleanLabel = normalizeInterviewLabel(label);
  const cleanComment = normalizeInterviewComment(comment);

  const run = () => db.$transaction(async (tx) => {
    const app = await loadWritableApplication(tx, organizationId, applicationId);
    const sameAsLegacy = interviewScheduleSlotsEqual(
      app.interviewScheduledAt ? new Date(app.interviewScheduledAt) : null,
      app.interviewTimeSpecified !== false,
      parsed.scheduledAt,
      parsed.timeSpecified,
    );
    if (!sameAsLegacy) await materializeLegacySnapshot(tx, app, createdByUserId);
    const existing = await tx.recruitmentApplicationInterviewEvent.findFirst({
      where: {
        organizationId,
        applicationId,
        eventType: 'SCHEDULED',
        scheduledAt: parsed.scheduledAt,
        scheduledTimeSpecified: parsed.timeSpecified,
      },
      include: eventInclude,
    });
    if (existing) throw conflictError(INTERVIEW_SLOT_TAKEN_MESSAGE);
    const event = await tx.recruitmentApplicationInterviewEvent.create({
      data: {
        organizationId,
        applicationId,
        stageId: app.stageId,
        eventType: 'SCHEDULED',
        scheduledAt: parsed.scheduledAt,
        scheduledTimeSpecified: parsed.timeSpecified,
        label: cleanLabel,
        comment: cleanComment,
        createdByUserId,
      },
      include: eventInclude,
    });
    await recalculateInterviewScheduledAt(tx, app, now);
    return {
      interview: serializeRecruitmentApplicationInterviewEvent(event),
      alreadyScheduled: false,
    };
  });

  return runInterviewWrite(run);
}

async function applyLegacyInterviewAction(tx, app, {
  type,
  createdByUserId,
  interviewDate,
  interviewTime,
  label,
  comment,
  timeZone,
  now,
}) {
  if (!app.interviewScheduledAt) {
    throw conflictError('No hay entrevista programada para registrar un resultado.');
  }
  const scheduledAt = app.interviewScheduledAt;
  const scheduledTimeSpecified = app.interviewTimeSpecified !== false;
  const matched = await tx.recruitmentApplicationInterviewEvent.findFirst({
    where: {
      organizationId: app.organizationId,
      applicationId: app.id,
      eventType: 'SCHEDULED',
      scheduledAt,
      scheduledTimeSpecified,
    },
    include: eventInclude,
  });
  if (matched) {
    return updateMatchedInterview(tx, app, matched, {
      type,
      createdByUserId,
      interviewDate,
      interviewTime,
      label,
      comment,
      timeZone,
      now,
    });
  }
  if (type === 'COMMENT') {
    const created = await tx.recruitmentApplicationInterviewEvent.create({
      data: {
        organizationId: app.organizationId,
        applicationId: app.id,
        stageId: app.stageId,
        eventType: 'SCHEDULED',
        scheduledAt,
        scheduledTimeSpecified,
        label: label !== undefined ? normalizeInterviewLabel(label) : null,
        comment: comment !== undefined ? normalizeInterviewComment(comment) : null,
        createdByUserId,
      },
      include: eventInclude,
    });
    return { interview: serializeRecruitmentApplicationInterviewEvent(created), alreadyApplied: false };
  }
  if (type === 'EDIT') {
    const parsed = interviewDate != null && String(interviewDate).trim()
      ? parseInterviewScheduleFields({ interviewDate, interviewTime }, timeZone)
      : null;
    if (interviewDate != null && String(interviewDate).trim() && !parsed?.scheduledAt) {
      throw validationError('Indica la fecha de entrevista.');
    }
    const source = await materializeLegacySnapshot(tx, app, createdByUserId);
    if (!source?.id) throw conflictError('No hay entrevista programada para reprogramar.');
    return editScheduledInterview(tx, app, source, {
      label,
      comment,
      scheduledAt: parsed?.scheduledAt || null,
      timeSpecified: parsed ? parsed.timeSpecified : true,
      createdByUserId,
      now,
    });
  }
  if (type === 'RESCHEDULED') {
    const parsed = parseInterviewScheduleFields({ interviewDate, interviewTime }, timeZone);
    if (!parsed?.scheduledAt) throw validationError('Indica la nueva fecha de entrevista.');
    if (interviewScheduleSlotsEqual(scheduledAt, scheduledTimeSpecified, parsed.scheduledAt, parsed.timeSpecified)) {
      return {
        interview: syntheticScheduledInterview(app, scheduledAt, scheduledTimeSpecified),
        alreadyApplied: true,
      };
    }
    const occupant = await findScheduledSlot(
      tx, app.organizationId, app.id, parsed.scheduledAt, parsed.timeSpecified,
    );
    if (occupant) throw conflictError(INTERVIEW_SLOT_TAKEN_MESSAGE);
    const source = await materializeLegacySnapshot(tx, app, createdByUserId);
    if (!source?.id) throw conflictError('No hay entrevista programada para reprogramar.');
    return rescheduleInterviewRow(
      tx, app, source, parsed.scheduledAt, parsed.timeSpecified, createdByUserId, now,
    );
  }
  const created = await tx.recruitmentApplicationInterviewEvent.create({
    data: {
      organizationId: app.organizationId,
      applicationId: app.id,
      stageId: app.stageId,
      eventType: type,
      scheduledAt,
      scheduledTimeSpecified,
      comment: comment !== undefined ? normalizeInterviewComment(comment) : null,
      createdByUserId,
    },
    include: eventInclude,
  });
  await recalculateInterviewScheduledAt(tx, app, now, createdByUserId);
  return { interview: serializeRecruitmentApplicationInterviewEvent(created), alreadyApplied: false };
}

async function updateMatchedInterview(tx, app, event, {
  type,
  createdByUserId,
  interviewDate,
  interviewTime,
  label,
  comment,
  timeZone,
  now,
}) {
  if (type === 'COMMENT') {
    if (event.eventType !== 'SCHEDULED' && label !== undefined) {
      throw conflictError('Esta entrevista ya tiene un resultado.');
    }
    const data = {};
    if (comment !== undefined) data.comment = normalizeInterviewComment(comment);
    if (label !== undefined) data.label = normalizeInterviewLabel(label);
    if (!Object.keys(data).length) {
      return { interview: serializeRecruitmentApplicationInterviewEvent(event), alreadyApplied: true };
    }
    const updated = await tx.recruitmentApplicationInterviewEvent.update({
      where: { id: event.id },
      data,
      include: eventInclude,
    });
    return { interview: serializeRecruitmentApplicationInterviewEvent(updated), alreadyApplied: false };
  }
  if (type === 'EDIT') {
    if (event.eventType !== 'SCHEDULED') throw conflictError('Esta entrevista ya tiene un resultado.');
    const parsed = interviewDate != null && String(interviewDate).trim()
      ? parseInterviewScheduleFields({ interviewDate, interviewTime }, timeZone)
      : null;
    if (interviewDate != null && String(interviewDate).trim() && !parsed?.scheduledAt) {
      throw validationError('Indica la fecha de entrevista.');
    }
    return editScheduledInterview(tx, app, event, {
      label,
      comment,
      scheduledAt: parsed?.scheduledAt || null,
      timeSpecified: parsed ? parsed.timeSpecified : event.scheduledTimeSpecified !== false,
      createdByUserId,
      now,
    });
  }
  if (type === 'RESCHEDULED') {
    const parsed = parseInterviewScheduleFields({ interviewDate, interviewTime }, timeZone);
    if (!parsed?.scheduledAt) throw validationError('Indica la nueva fecha de entrevista.');
    return rescheduleInterviewRow(
      tx, app, event, parsed.scheduledAt, parsed.timeSpecified, createdByUserId, now,
    );
  }
  if (event.eventType === type) {
    return { interview: serializeRecruitmentApplicationInterviewEvent(event), alreadyApplied: true };
  }
  if (event.eventType !== 'SCHEDULED') {
    throw conflictError('Esta entrevista ya tiene un resultado.');
  }
  const updated = await tx.recruitmentApplicationInterviewEvent.update({
    where: { id: event.id },
    data: {
      eventType: type,
      ...(comment !== undefined ? { comment: normalizeInterviewComment(comment) } : {}),
    },
    include: eventInclude,
  });
  await recalculateInterviewScheduledAt(tx, app, now, createdByUserId);
  return { interview: serializeRecruitmentApplicationInterviewEvent(updated), alreadyApplied: false };
}

export async function updateRecruitmentApplicationInterview({
  organizationId,
  applicationId,
  eventId,
  action,
  createdByUserId,
  interviewDate,
  interviewTime,
  label,
  comment,
  timeZone: explicitTimeZone = null,
  now = new Date(),
  db = prisma,
}) {
  const type = String(action || '').trim();
  if (!['ATTENDED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED', 'COMMENT', 'EDIT'].includes(type)) {
    throw validationError('Acción de entrevista no válida.');
  }
  const timeZone = explicitTimeZone || (await resolveOrganizationIanaTimezone(organizationId));
  const run = () => db.$transaction(async (tx) => {
    const app = await loadWritableApplication(tx, organizationId, applicationId);
    if (eventId === 'legacy') {
      return applyLegacyInterviewAction(tx, app, {
        type,
        createdByUserId,
        interviewDate,
        interviewTime,
        label,
        comment,
        timeZone,
        now,
      });
    }
    const event = await tx.recruitmentApplicationInterviewEvent.findFirst({
      where: { id: eventId, applicationId, organizationId },
      include: eventInclude,
    });
    if (!event) throw notFound('Entrevista no encontrada.');
    if (type === 'COMMENT') {
      if (event.eventType !== 'SCHEDULED' && label !== undefined) {
        throw conflictError('Esta entrevista ya tiene un resultado.');
      }
      const data = {};
      if (comment !== undefined) data.comment = normalizeInterviewComment(comment);
      if (label !== undefined) data.label = normalizeInterviewLabel(label);
      if (!Object.keys(data).length) {
        return { interview: serializeRecruitmentApplicationInterviewEvent(event), alreadyApplied: true };
      }
      const updated = await tx.recruitmentApplicationInterviewEvent.update({
        where: { id: event.id },
        data,
        include: eventInclude,
      });
      return { interview: serializeRecruitmentApplicationInterviewEvent(updated), alreadyApplied: false };
    }
    if (type === 'EDIT' || type === 'RESCHEDULED') {
      if (type === 'EDIT' && event.eventType !== 'SCHEDULED') {
        throw conflictError('Esta entrevista ya tiene un resultado.');
      }
      const dated = type === 'RESCHEDULED' || (interviewDate != null && String(interviewDate).trim());
      const parsed = dated
        ? parseInterviewScheduleFields({ interviewDate, interviewTime }, timeZone)
        : null;
      if (type === 'RESCHEDULED' && !parsed?.scheduledAt) throw validationError('Indica la nueva fecha de entrevista.');
      if (type === 'EDIT') {
        if (dated && !parsed?.scheduledAt) throw validationError('Indica la fecha de entrevista.');
        return editScheduledInterview(tx, app, event, {
          label,
          comment,
          scheduledAt: dated ? parsed.scheduledAt : null,
          timeSpecified: dated ? parsed.timeSpecified : event.scheduledTimeSpecified !== false,
          createdByUserId,
          now,
        });
      }
      return rescheduleInterviewRow(
        tx, app, event, parsed.scheduledAt, parsed.timeSpecified, createdByUserId, now,
      );
    }
    if (event.eventType === type) {
      return { interview: serializeRecruitmentApplicationInterviewEvent(event), alreadyApplied: true };
    }
    if (event.eventType !== 'SCHEDULED' && type !== 'COMMENT') {
      throw conflictError('Esta entrevista ya tiene un resultado.');
    }
    const cleanComment = comment !== undefined ? normalizeInterviewComment(comment) : event.comment;
    const updated = await tx.recruitmentApplicationInterviewEvent.update({
      where: { id: event.id },
      data: {
        eventType: type,
        ...(comment !== undefined ? { comment: cleanComment } : {}),
      },
      include: eventInclude,
    });
    await recalculateInterviewScheduledAt(tx, app, now, createdByUserId);
    return { interview: serializeRecruitmentApplicationInterviewEvent(updated), alreadyApplied: false };
  });
  return runInterviewWrite(run);
}

export async function cancelScheduledInterviewsForClosedApplication(tx, {
  organizationId,
  applicationId,
  createdByUserId = null,
  legacyScheduledAt = null,
  legacyTimeSpecified = true,
  stageId = null,
  now = new Date(),
}) {
  const table = tx?.recruitmentApplicationInterviewEvent;
  if (!table?.findMany || !table?.update) return { cancelled: 0 };
  const app = await tx.recruitmentApplication.findFirst({
    where: { id: applicationId, organizationId },
    select: { interviewScheduledAt: true, interviewTimeSpecified: true, stageId: true },
  });
  if (!app) return { cancelled: 0 };
  const rows = await table.findMany({
    where: { organizationId, applicationId, eventType: 'SCHEDULED' },
  });
  let cancelled = 0;
  const nowMs = now.getTime();
  for (const row of rows) {
    const past = new Date(row.scheduledAt).getTime() < nowMs;
    const comment = row.comment && String(row.comment).trim()
      ? row.comment
      : (past ? INTERVIEW_CLOSED_UNRESOLVED_COMMENT : INTERVIEW_CLOSED_SYSTEM_COMMENT);
    await table.update({
      where: { id: row.id },
      data: { eventType: 'CANCELLED', comment },
    });
    cancelled += 1;
  }
  const snapshot = app.interviewScheduledAt
    ? new Date(app.interviewScheduledAt)
    : (legacyScheduledAt ? new Date(legacyScheduledAt) : null);
  const timeSpecified = app.interviewScheduledAt
    ? app.interviewTimeSpecified !== false
    : legacyTimeSpecified !== false;
  const snapshotMatched = snapshot && rows.some((row) => interviewScheduleSlotsEqual(
    new Date(row.scheduledAt),
    row.scheduledTimeSpecified !== false,
    snapshot,
    timeSpecified,
  ));
  if (snapshot && !Number.isNaN(snapshot.getTime()) && !snapshotMatched && createdByUserId && table.create) {
    await table.create({
      data: {
        organizationId,
        applicationId,
        stageId: stageId || app.stageId,
        eventType: 'CANCELLED',
        scheduledAt: snapshot,
        scheduledTimeSpecified: timeSpecified,
        comment: snapshot.getTime() < now.getTime()
          ? INTERVIEW_CLOSED_UNRESOLVED_COMMENT
          : INTERVIEW_CLOSED_SYSTEM_COMMENT,
        createdByUserId,
      },
    });
    cancelled += 1;
  }
  if (tx.recruitmentApplication?.updateMany) {
    await pointSnapshotAt(tx, {
      organizationId,
      applicationId,
      scheduledAt: null,
      timeSpecified: true,
    });
  }
  return { cancelled };
}

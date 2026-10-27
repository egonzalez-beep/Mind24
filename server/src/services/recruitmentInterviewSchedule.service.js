import { localDateKey, localMidnightUtc } from './remoteWorkSessionHistory.service.js';
import { resolveOrganizationIanaTimezone } from './organizationTimezone.service.js';

export const RECRUITMENT_INTERVIEW_SCHEDULE_STAGE_KEYS = new Set([
  'INITIAL_INTERVIEW',
  'CLIENT_INTERVIEW',
]);

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function stageKeyAllowsInterviewSchedule(stageKey) {
  return RECRUITMENT_INTERVIEW_SCHEDULE_STAGE_KEYS.has(String(stageKey || '').trim());
}

/**
 * Próxima entrevista programada (no histórico) al actualizar una postulación.
 * Centraliza la regla cuando cambia la etapa.
 */
export function resolveInterviewScheduledAtForApplicationUpdate({
  stageChanged,
  fromStageKey,
  toStageKey,
  existingInterviewScheduledAt,
  explicitInterviewScheduledAt,
}) {
  if (!stageChanged) {
    if (explicitInterviewScheduledAt !== undefined) {
      return explicitInterviewScheduledAt;
    }
    return existingInterviewScheduledAt ?? null;
  }

  if (!stageKeyAllowsInterviewSchedule(toStageKey)) {
    return null;
  }

  if (explicitInterviewScheduledAt !== undefined) {
    return explicitInterviewScheduledAt;
  }
  return null;
}

/** UTC instant for local date + time (24h) in IANA timezone. */
export function utcInstantFromLocalParts(dateKey, hour, minute, timeZone) {
  if (!DATE_KEY_RE.test(dateKey)) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Fecha de entrevista no válida.';
    throw err;
  }
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Hora de entrevista no válida.';
    throw err;
  }
  const targetMinutes = hour * 60 + minute;
  let lo = localMidnightUtc(dateKey, timeZone).getTime();
  let hi = lo + 26 * 60 * 60 * 1000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const dt = new Date(mid);
    const key = localDateKey(dt, timeZone);
    if (key !== dateKey) {
      if (key < dateKey) lo = mid + 60_000;
      else hi = mid;
      continue;
    }
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(dt);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    const mins = h * 60 + m;
    if (mins < targetMinutes) lo = mid + 60_000;
    else hi = mid;
  }
  return new Date(lo);
}

export function parseInterviewScheduleFields({ interviewDate, interviewTime }, timeZone) {
  const dateTrim = interviewDate != null ? String(interviewDate).trim() : '';
  const timeTrim = interviewTime != null ? String(interviewTime).trim() : '';
  if (!dateTrim && !timeTrim) return null;
  if (!dateTrim || !timeTrim) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Indica fecha y hora de entrevista, o deja ambos vacíos.';
    throw err;
  }
  const tm = TIME_RE.exec(timeTrim);
  if (!tm) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Hora de entrevista no válida.';
    throw err;
  }
  return utcInstantFromLocalParts(dateTrim, Number(tm[1]), Number(tm[2]), timeZone);
}

export async function resolveInterviewScheduledAtForOrg(organizationId, fields, { stageKey } = {}) {
  const instant = parseInterviewScheduleFields(fields, await resolveOrganizationIanaTimezone(organizationId));
  if (!instant) return null;
  if (stageKey != null && !stageKeyAllowsInterviewSchedule(stageKey)) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La fecha de entrevista solo aplica en etapas de entrevista.';
    throw err;
  }
  return instant;
}

export function serializeInterviewScheduledAt(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function formatInterviewScheduledAtLabel(isoUtc, timeZone) {
  if (!isoUtc) return null;
  const dt = new Date(isoUtc);
  if (Number.isNaN(dt.getTime())) return null;
  const tz = timeZone || 'America/Mexico_City';
  const dateStr = new Intl.DateTimeFormat('es-MX', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(dt);
  const timeStr = new Intl.DateTimeFormat('es-MX', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dt);
  return `${dateStr} · ${timeStr}`;
}

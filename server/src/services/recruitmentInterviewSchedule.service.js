import { localMidnightUtc } from './remoteWorkSessionHistory.service.js';
import { resolveOrganizationIanaTimezone } from './organizationTimezone.service.js';
import { utcInstantFromLocalParts } from '../utils/timezoneLocalInstant.util.js';

export { utcInstantFromLocalParts };

export const RECRUITMENT_INTERVIEW_SCHEDULE_STAGE_KEYS = new Set([
  'INITIAL_INTERVIEW',
  'CLIENT_INTERVIEW',
]);

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

/** @returns {{ scheduledAt: Date, timeSpecified: boolean } | null} */
export function parseInterviewScheduleFields({ interviewDate, interviewTime }, timeZone) {
  const dateTrim = interviewDate != null ? String(interviewDate).trim() : '';
  const timeTrim = interviewTime != null ? String(interviewTime).trim() : '';
  if (!dateTrim && !timeTrim) return null;
  if (!dateTrim && timeTrim) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Indica la fecha de entrevista.';
    throw err;
  }
  if (dateTrim && !timeTrim) {
    return { scheduledAt: localMidnightUtc(dateTrim, timeZone), timeSpecified: false };
  }
  const tm = TIME_RE.exec(timeTrim);
  if (!tm) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Hora de entrevista no válida.';
    throw err;
  }
  return {
    scheduledAt: utcInstantFromLocalParts(dateTrim, Number(tm[1]), Number(tm[2]), timeZone),
    timeSpecified: true,
  };
}

export async function resolveInterviewScheduledAtForOrg(organizationId, fields, { stageKey } = {}) {
  const parsed = parseInterviewScheduleFields(
    fields,
    await resolveOrganizationIanaTimezone(organizationId),
  );
  if (!parsed) return null;
  if (stageKey != null && !stageKeyAllowsInterviewSchedule(stageKey)) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La fecha de entrevista solo aplica en etapas de entrevista.';
    throw err;
  }
  return parsed;
}

export function serializeInterviewScheduledAt(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function formatInterviewScheduledAtLabel(isoUtc, timeZone, { timeSpecified = true } = {}) {
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
  if (timeSpecified === false) return dateStr;
  const timeStr = new Intl.DateTimeFormat('es-MX', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dt);
  return `${dateStr} · ${timeStr}`;
}

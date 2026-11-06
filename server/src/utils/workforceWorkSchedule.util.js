/**
 * Horario fijo en minutos civiles de WorkforceEmployee.timezone.
 * 8:00 a. m. = 480, 3:00 p. m. = 900. No es un DateTime ni una fecha ficticia.
 * Los días se eligen: lunes = 1 … domingo = 7. Los no elegidos son descanso.
 * Una sola entrada, salida y tolerancia para todos los días laborales.
 *
 * Esta versión no conserva historial: asignar, cambiar o quitar reemplaza la
 * configuración vigente y no recalcula jornadas pasadas. No hay tabla versionada.
 *
 * El horario está configurado solo cuando días, inicio, fin y tolerancia son válidos.
 * Fase 2 puede derivar entrada, fin de tolerancia, salida, minutos del día,
 * fecha evaluable (assignedAt), los días guardados y la zona del colaborador.
 */

export const WORK_SCHEDULE_DAY_MIN = 1;
export const WORK_SCHEDULE_DAY_MAX = 7;
export const WORK_SCHEDULE_MAX_DURATION_MINUTES = 16 * 60;
export const WORK_SCHEDULE_ORDER_MESSAGE =
  'Verifica que la hora de salida sea posterior a la entrada.';
export const WORK_SCHEDULE_TOLERANCE_MESSAGE =
  'La tolerancia debe estar entre 0 y 120 minutos.';
export const WORK_SCHEDULE_DAYS_MESSAGE = 'Selecciona al menos un día laboral.';

const WEEKDAY_LABELS = [null, 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const SCHEDULE_COLUMNS = [
  'workScheduleStartMinute',
  'workScheduleEndMinute',
  'workScheduleToleranceMinutes',
  'workScheduleWeekdayMask',
  'workScheduleAssignedAt',
];

function workScheduleError(message) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  return err;
}

export function parseHmToMinute(value) {
  if (typeof value !== 'string' || value !== value.trim() || !HHMM.test(value)) return null;
  const [hours, minutes] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

export function formatMinuteToHm(minute) {
  if (!Number.isInteger(minute) || minute < 0 || minute > 1439) return null;
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatMinuteEsMx(minute) {
  if (!Number.isInteger(minute) || minute < 0 || minute > 1439) return null;
  const hours24 = Math.floor(minute / 60);
  const minutes = minute % 60;
  const suffix = hours24 < 12 ? 'a. m.' : 'p. m.';
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export function encodeWeekdayMask(weekdays) {
  return weekdays.reduce((mask, day) => mask | (1 << (day - 1)), 0);
}

export function decodeWeekdayMask(mask) {
  if (!Number.isInteger(mask) || mask < 1 || mask > 127) return null;
  const days = [];
  for (let day = WORK_SCHEDULE_DAY_MIN; day <= WORK_SCHEDULE_DAY_MAX; day += 1) {
    if ((mask & (1 << (day - 1))) !== 0) days.push(day);
  }
  return days.length ? days : null;
}

export function restDaysFor(weekdays) {
  const selected = new Set(weekdays);
  const rest = [];
  for (let day = WORK_SCHEDULE_DAY_MIN; day <= WORK_SCHEDULE_DAY_MAX; day += 1) {
    if (!selected.has(day)) rest.push(day);
  }
  return rest;
}

export function formatWeekdaySelection(weekdays) {
  if (!Array.isArray(weekdays) || weekdays.length < 1) return null;
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) return null;
  const groups = [];
  let start = days[0];
  let prev = days[0];
  for (let i = 1; i <= days.length; i += 1) {
    const day = days[i];
    if (day === prev + 1) {
      prev = day;
      continue;
    }
    groups.push(start === prev ? WEEKDAY_LABELS[start] : `${WEEKDAY_LABELS[start]}–${WEEKDAY_LABELS[prev]}`);
    start = day;
    prev = day;
  }
  return groups.join(', ');
}

export function formatWorkScheduleSummary(schedule) {
  if (!schedule) return null;
  const days = formatWeekdaySelection(schedule.weekdays);
  const start = formatMinuteEsMx(schedule.startMinute);
  const end = formatMinuteEsMx(schedule.endMinute);
  const tolerance = schedule.toleranceMinutes;
  if (!days || !start || !end || !Number.isInteger(tolerance)) return null;
  return `${days} · ${start}–${end} · Tolerancia ${tolerance} min`;
}

function isValidStoredRange(startMinute, endMinute, toleranceMinutes) {
  return (
    Number.isInteger(startMinute) &&
    Number.isInteger(endMinute) &&
    Number.isInteger(toleranceMinutes) &&
    startMinute >= 0 &&
    startMinute <= 1439 &&
    endMinute >= 1 &&
    endMinute <= 1439 &&
    endMinute > startMinute &&
    endMinute - startMinute <= WORK_SCHEDULE_MAX_DURATION_MINUTES &&
    toleranceMinutes >= 0 &&
    toleranceMinutes <= 120
  );
}

export function parseWorkScheduleInput(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw workScheduleError(WORK_SCHEDULE_ORDER_MESSAGE);
  }
  const startMinute = parseHmToMinute(value.start);
  const endMinute = parseHmToMinute(value.end);
  if (
    startMinute == null ||
    endMinute == null ||
    endMinute < 1 ||
    endMinute <= startMinute ||
    endMinute - startMinute > WORK_SCHEDULE_MAX_DURATION_MINUTES
  ) {
    throw workScheduleError(WORK_SCHEDULE_ORDER_MESSAGE);
  }
  const tolerance = value.toleranceMinutes;
  if (typeof tolerance !== 'number' || !Number.isInteger(tolerance) || tolerance < 0 || tolerance > 120) {
    throw workScheduleError(WORK_SCHEDULE_TOLERANCE_MESSAGE);
  }
  const weekdays = parseWeekdays(value.weekdays);
  return { startMinute, endMinute, toleranceMinutes: tolerance, weekdays, weekdayMask: encodeWeekdayMask(weekdays) };
}

function parseWeekdays(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 7) {
    throw workScheduleError(WORK_SCHEDULE_DAYS_MESSAGE);
  }
  const seen = new Set();
  for (const day of value) {
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 7 || seen.has(day)) {
      throw workScheduleError(WORK_SCHEDULE_DAYS_MESSAGE);
    }
    seen.add(day);
  }
  return [...seen].sort((a, b) => a - b);
}

export function workScheduleConfigEqual(left, right) {
  if (!left || !right) return false;
  return (
    left.startMinute === right.startMinute &&
    left.endMinute === right.endMinute &&
    left.toleranceMinutes === right.toleranceMinutes &&
    encodeWeekdayMask(left.weekdays || []) === encodeWeekdayMask(right.weekdays || [])
  );
}

export function buildWorkScheduleDto(row) {
  if (!row) return null;
  const startMinute = row.workScheduleStartMinute;
  const endMinute = row.workScheduleEndMinute;
  const toleranceMinutes = row.workScheduleToleranceMinutes;
  const weekdays = decodeWeekdayMask(row.workScheduleWeekdayMask);
  if (!weekdays || !isValidStoredRange(startMinute, endMinute, toleranceMinutes)) return null;
  const assigned = row.workScheduleAssignedAt ? new Date(row.workScheduleAssignedAt) : null;
  return {
    weekdays,
    restDays: restDaysFor(weekdays),
    startMinute,
    endMinute,
    toleranceMinutes,
    assignedAt: assigned && !Number.isNaN(assigned.getTime()) ? assigned.toISOString() : null,
  };
}

/**
 * Contrato de lectura para la Fase 2. No persiste métricas ni estados.
 * Las fechas locales evaluables son las iguales o posteriores a assignedAt.
 */
export function describeWorkScheduleForEvaluation(row) {
  const schedule = buildWorkScheduleDto(row);
  if (!schedule || !schedule.assignedAt) return null;
  return {
    scheduledStartMinute: schedule.startMinute,
    toleranceEndMinute: schedule.startMinute + schedule.toleranceMinutes,
    scheduledEndMinute: schedule.endMinute,
    expectedMinutesPerDay: schedule.endMinute - schedule.startMinute,
    evaluableFrom: schedule.assignedAt,
    weekdays: schedule.weekdays,
    timezone: row.timezone || null,
  };
}

export function resolveWorkSchedulePersistence(existingRow, input, now) {
  if (input === undefined) return {};
  if (input === null) {
    return {
      workScheduleStartMinute: null,
      workScheduleEndMinute: null,
      workScheduleToleranceMinutes: null,
      workScheduleWeekdayMask: null,
      workScheduleAssignedAt: null,
    };
  }
  const parsed = parseWorkScheduleInput(input);
  const unchanged =
    existingRow &&
    existingRow.workScheduleStartMinute === parsed.startMinute &&
    existingRow.workScheduleEndMinute === parsed.endMinute &&
    existingRow.workScheduleToleranceMinutes === parsed.toleranceMinutes &&
    existingRow.workScheduleWeekdayMask === parsed.weekdayMask &&
    existingRow.workScheduleAssignedAt != null;
  if (unchanged) return {};
  return {
    workScheduleStartMinute: parsed.startMinute,
    workScheduleEndMinute: parsed.endMinute,
    workScheduleToleranceMinutes: parsed.toleranceMinutes,
    workScheduleWeekdayMask: parsed.weekdayMask,
    workScheduleAssignedAt: now,
  };
}

export function workScheduleColumnNames() {
  return [...SCHEDULE_COLUMNS];
}

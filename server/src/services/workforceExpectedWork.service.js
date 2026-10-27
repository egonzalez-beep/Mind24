/** Jornada esperada (asistencia) — distinto de meta de conexión futura. */

export const DEFAULT_EXPECTED_WORK_MINUTES = 480;
export const MAX_EXPECTED_WORK_MINUTES = 16 * 60;

export function employeeAttendanceEnabled(emp) {
  const n = emp?.expectedWorkMinutes;
  return typeof n === 'number' && n > 0;
}

export function normalizeExpectedWorkMinutesInput(value) {
  if (value === null || value === undefined) return null;
  if (value === 0 || value === '0') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const rounded = Math.round(n);
  if (rounded > MAX_EXPECTED_WORK_MINUTES) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La jornada esperada no puede superar 16 horas.';
    throw err;
  }
  return rounded;
}

export function assertEmployeeAttendanceEligible(emp) {
  if (!employeeAttendanceEnabled(emp)) {
    const err = new Error('ATTENDANCE_NOT_CONFIGURED');
    err.code = 'ATTENDANCE_NOT_CONFIGURED';
    err.message = 'Este colaborador no tiene jornada de asistencia asignada.';
    throw err;
  }
}

export function formatExpectedWorkLabel(minutes) {
  if (minutes == null || minutes <= 0) return 'Sin jornada esperada';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

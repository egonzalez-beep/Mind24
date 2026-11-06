/**
 * Primer milisegundo UTC en que el reloj civil de `timeZone` muestra
 * esa fecha y ese minuto. No suma 24 horas ni un offset fijo.
 * Los mensajes se conservan porque el alta de entrevistas los muestra tal cual.
 */
import { localDateKey, localMidnightUtc } from '../services/remoteWorkSessionHistory.service.js';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

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
      if (key < dateKey) lo = mid + 1;
      else hi = mid;
      continue;
    }
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(dt);
    let h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    if (h === 24) h = 0;
    const mins = h * 60 + m;
    if (mins < targetMinutes) lo = mid + 1;
    else hi = mid;
  }
  return new Date(lo);
}

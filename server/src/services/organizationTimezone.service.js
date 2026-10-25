import { prisma } from '../db/client.js';
import { isValidIanaTimezone } from '../utils/ianaTimezone.js';
import { localDateKey } from './remoteWorkSessionHistory.service.js';

/** Mismo default que Gestión de equipo / checador en la UI. */
export const MIND24_DEFAULT_IANA_TIMEZONE = 'America/Mexico_City';

/**
 * Zona horaria de referencia para reportes a nivel organización:
 * la IANA más frecuente entre colaboradores activos de workforce.
 */
export async function resolveOrganizationIanaTimezone(organizationId) {
  const rows = await prisma.workforceEmployee.findMany({
    where: { organizationId, isActive: true },
    select: { timezone: true },
  });
  if (!rows.length) return MIND24_DEFAULT_IANA_TIMEZONE;
  const counts = new Map();
  for (const row of rows) {
    const tz =
      row.timezone && isValidIanaTimezone(row.timezone)
        ? row.timezone.trim()
        : MIND24_DEFAULT_IANA_TIMEZONE;
    counts.set(tz, (counts.get(tz) || 0) + 1);
  }
  let best = MIND24_DEFAULT_IANA_TIMEZONE;
  let bestCount = -1;
  for (const [tz, n] of counts.entries()) {
    if (n > bestCount) {
      bestCount = n;
      best = tz;
    }
  }
  return best;
}

export function localYearMonth(instant, timeZone) {
  const key = localDateKey(instant, timeZone);
  const [y, m] = key.split('-').map(Number);
  return { year: y, month: m };
}

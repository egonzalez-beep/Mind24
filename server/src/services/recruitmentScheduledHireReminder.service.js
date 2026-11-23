import { prisma } from '../db/client.js';
import { APPROVED_STAGE_KEY } from './recruitmentStage.service.js';
import {
  MIND24_DEFAULT_IANA_TIMEZONE,
  resolveOrganizationIanaTimezone,
} from './organizationTimezone.service.js';
import { localDateKey } from './remoteWorkSessionHistory.service.js';
import { serializeEmploymentStartDate } from './recruitmentApplication.service.js';
import { notifyRecruitmentScheduledHire } from './orgNotification.service.js';
import { isOpenApprovedForScheduledHire } from './recruitmentApplicationScheduledHire.service.js';
import { lockRecruitmentApplicationRow } from './recruitmentApplicationEmploymentExit.service.js';

export const SCHEDULED_HIRE_REMINDER_SWEEP_MS = 5 * 60 * 1000;

let reminderSweepTimer = null;
let reminderSweepRunning = false;

/**
 * Relee la postulación en la misma transacción justo antes de publicar.
 * Si ya no está abierta en Aprobado, cambió la fecha o aún no vence, no emite.
 */
export async function emitScheduledHireReminderIfEligible(
  tx,
  {
    organizationId,
    applicationId,
    todayYmd,
    expectedScheduledYmd = null,
  },
) {
  if (!organizationId || !applicationId || !todayYmd) return null;
  // Mismo candado que programar/quitar/Declinó: serializa lectura → publicación.
  await lockRecruitmentApplicationRow(tx, organizationId, applicationId);
  const app = await tx.recruitmentApplication.findFirst({
    where: { id: applicationId, organizationId },
    select: {
      id: true,
      candidateId: true,
      vacancyId: true,
      stageId: true,
      closureOutcome: true,
      scheduledEmploymentStartDate: true,
      stage: { select: { key: true } },
      candidate: { select: { fullName: true } },
      vacancy: { select: { title: true } },
    },
  });
  if (!app) return null;
  if (!isOpenApprovedForScheduledHire(app.stage?.key, app.closureOutcome)) return null;
  const scheduledYmd = serializeEmploymentStartDate(app.scheduledEmploymentStartDate);
  if (!scheduledYmd) return null;
  if (expectedScheduledYmd && scheduledYmd !== expectedScheduledYmd) return null;
  if (scheduledYmd > todayYmd) return null;
  return notifyRecruitmentScheduledHire(tx, {
    organizationId,
    applicationId: app.id,
    candidateId: app.candidateId,
    vacancyId: app.vacancyId,
    stageId: app.stageId,
    candidateName: app.candidate?.fullName || null,
    vacancyTitle: app.vacancy?.title || null,
    scheduledYmd,
    todayYmd,
  });
}

/**
 * Postulaciones abiertas en Aprobado con fecha programada <= hoy (TZ org).
 * Un solo aviso por programación vigente; se revalida al publicar.
 */
export async function sweepScheduledHireReminders(now = new Date()) {
  const rows = await prisma.recruitmentApplication.findMany({
    where: {
      scheduledEmploymentStartDate: { not: null },
      closureOutcome: null,
      stage: { key: APPROVED_STAGE_KEY, isActive: true },
    },
    select: {
      id: true,
      organizationId: true,
      scheduledEmploymentStartDate: true,
      organization: { select: { blocked: true, empresaPortalEnabled: true } },
    },
  });
  if (!rows.length) return { scanned: 0, emitted: 0 };

  const tzByOrg = new Map();
  let emitted = 0;
  for (const row of rows) {
    const org = row.organization;
    if (org && (org.blocked === true || org.empresaPortalEnabled === false)) continue;
    const scheduledYmd = serializeEmploymentStartDate(row.scheduledEmploymentStartDate);
    if (!scheduledYmd) continue;

    let timeZone = tzByOrg.get(row.organizationId);
    if (!timeZone) {
      timeZone = await resolveOrganizationIanaTimezone(row.organizationId);
      tzByOrg.set(row.organizationId, timeZone || MIND24_DEFAULT_IANA_TIMEZONE);
    }
    const todayYmd = localDateKey(now, timeZone || MIND24_DEFAULT_IANA_TIMEZONE);
    if (scheduledYmd > todayYmd) continue;

    try {
      const created = await prisma.$transaction(async (tx) =>
        emitScheduledHireReminderIfEligible(tx, {
          organizationId: row.organizationId,
          applicationId: row.id,
          todayYmd,
          expectedScheduledYmd: scheduledYmd,
        }),
      );
      if (created) emitted += 1;
    } catch (err) {
      console.error('[scheduled-hire-reminder] emit', err?.code || err?.message || 'error');
    }
  }
  return { scanned: rows.length, emitted };
}

export async function syncScheduledHireRemindersForOrg(organizationId, now = new Date()) {
  if (!organizationId) return 0;
  const timeZone = await resolveOrganizationIanaTimezone(organizationId);
  const todayYmd = localDateKey(now, timeZone || MIND24_DEFAULT_IANA_TIMEZONE);
  const rows = await prisma.recruitmentApplication.findMany({
    where: {
      organizationId,
      scheduledEmploymentStartDate: { not: null },
      closureOutcome: null,
      stage: { key: APPROVED_STAGE_KEY, isActive: true },
    },
    select: {
      id: true,
      scheduledEmploymentStartDate: true,
    },
  });
  let emitted = 0;
  for (const row of rows) {
    const scheduledYmd = serializeEmploymentStartDate(row.scheduledEmploymentStartDate);
    if (!scheduledYmd || scheduledYmd > todayYmd) continue;
    try {
      const created = await prisma.$transaction(async (tx) =>
        emitScheduledHireReminderIfEligible(tx, {
          organizationId,
          applicationId: row.id,
          todayYmd,
          expectedScheduledYmd: scheduledYmd,
        }),
      );
      if (created) emitted += 1;
    } catch (_e) {
      /* listado: no bloquea la campana */
    }
  }
  return emitted;
}

export function runScheduledHireReminderSweepTick(task = sweepScheduledHireReminders) {
  if (reminderSweepRunning) return;
  reminderSweepRunning = true;
  Promise.resolve()
    .then(() => task())
    .catch((err) => {
      console.error('[scheduled-hire-reminder]', err?.code || err?.message || 'error');
    })
    .finally(() => {
      reminderSweepRunning = false;
    });
}

export function startScheduledHireReminderSweep() {
  if (reminderSweepTimer) return;
  const tick = () => runScheduledHireReminderSweepTick();
  tick();
  reminderSweepTimer = setInterval(tick, SCHEDULED_HIRE_REMINDER_SWEEP_MS);
  if (typeof reminderSweepTimer.unref === 'function') reminderSweepTimer.unref();
}

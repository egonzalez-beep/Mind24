import { prisma } from '../db/client.js';
import { RECRUITMENT_VACANCY_STATUSES } from './recruitmentStage.service.js';
import {
  listEnabledVacancyStagesForDistribution,
  seedVacancyStagesFromOrganizationCatalog,
} from './recruitmentVacancyStage.service.js';
import {
  classifyRecruitmentApplication,
  isRecruitmentApplicationInActiveVacancyQueue,
} from './recruitmentProcessClosure.service.js';
import {
  countDistinctHiredCandidates,
  planVacancyCoverageUpdate,
  isHireConfirmedAt,
  listCurrentHiresForVacancy,
  lockRecruitmentVacancyForCoverage,
  officialCoveragePercent,
  pendingPositions,
  reconcileVacancyCoverage,
} from './recruitmentCoverage.service.js';
import {
  MIND24_DEFAULT_IANA_TIMEZONE,
  resolveOrganizationIanaTimezone,
} from './organizationTimezone.service.js';
import { localDateKey } from './remoteWorkSessionHistory.service.js';

/** 0–4 habitual (sin tinte); 5–9 naranja; desde 10 rojo. */
export const VACANCY_AGING_HABITUAL_MAX_DAYS = 4;
export const VACANCY_AGING_ORANGE_MAX_DAYS = 9;

export function vacancyAgingLevelFromDays(days) {
  if (!Number.isFinite(days) || days < 0) return null;
  if (days <= VACANCY_AGING_HABITUAL_MAX_DAYS) return null;
  if (days <= VACANCY_AGING_ORANGE_MAX_DAYS) return 'orange';
  return 'red';
}

export function vacancyDateKeyInTimeZone(instant, timeZone = MIND24_DEFAULT_IANA_TIMEZONE) {
  if (!instant) return localDateKey(new Date(), timeZone);
  return localDateKey(instant instanceof Date ? instant : new Date(instant), timeZone);
}

/**
 * Semáforo de tarjeta: solo ACTIVE con plazas pendientes y sin candidatos en proceso.
 * Sin postulaciones → ancla createdAt. Con postulaciones y cola vacía → activeQueueEmptiedAt.
 * Con alguien en proceso → null (color habitual). Días en TZ de la organización.
 */
export function resolveVacancyAgingTrafficLight({
  status,
  positionsTotal,
  hiredConfirmed = 0,
  applicationTotal = 0,
  inProcess = 0,
  createdAt = null,
  activeQueueEmptiedAt = null,
  timeZone = MIND24_DEFAULT_IANA_TIMEZONE,
  todayKey = null,
  now = new Date(),
} = {}) {
  if (status !== 'ACTIVE') return null;
  if (pendingPositions(positionsTotal, hiredConfirmed) <= 0) return null;
  if (Number(inProcess) > 0) return null;

  let anchor = null;
  if (Number(applicationTotal) <= 0) {
    anchor = createdAt;
  } else {
    anchor = activeQueueEmptiedAt;
  }
  if (!anchor) return null;
  const fromKey = vacancyDateKeyInTimeZone(anchor, timeZone);
  const toKey = todayKey || vacancyDateKeyInTimeZone(now, timeZone);
  const days = Math.max(0, calendarDayDiff(fromKey, toKey));
  return vacancyAgingLevelFromDays(days);
}

/**
 * Infiera cuándo la cola operativa quedó vacía a partir del historial de etapas/cierres.
 * Devuelve el último instante en que inProcess pasó a 0, o null si no se puede determinar.
 */
export function inferActiveQueueEmptiedAtFromHistory(appsWithHistory) {
  const apps = Array.isArray(appsWithHistory) ? appsWithHistory : [];
  if (!apps.length) return null;

  const timeline = [];
  for (const app of apps) {
    const appId = app.id;
    if (!appId) continue;
    const events = Array.isArray(app.events)
      ? app.events
          .map((ev) => ({
            at: ev.createdAt instanceof Date ? ev.createdAt : new Date(ev.createdAt),
            fromKey: ev.fromStageKey || ev.fromStage?.key || null,
            toKey: ev.toStageKey || ev.toStage?.key || null,
          }))
          .filter((ev) => ev.at && !Number.isNaN(ev.at.getTime()))
          .sort((a, b) => a.at.getTime() - b.at.getTime())
      : [];

    if (!events.length) {
      const applied = app.appliedAt ? new Date(app.appliedAt) : null;
      if (applied && !Number.isNaN(applied.getTime())) {
        timeline.push({
          at: applied,
          appId,
          inQueue: isRecruitmentApplicationInActiveVacancyQueue('NEW', null),
        });
      }
      const currentlyIn = isRecruitmentApplicationInActiveVacancyQueue(
        app.stageKey || app.stage?.key,
        app.closureOutcome,
      );
      if (!currentlyIn) {
        const leftRaw = app.closedAt || app.updatedAt;
        const leftAt = leftRaw ? new Date(leftRaw) : null;
        if (leftAt && !Number.isNaN(leftAt.getTime())) {
          timeline.push({ at: leftAt, appId, inQueue: false });
        }
      }
      continue;
    }

    let currentKey = null;
    for (const ev of events) {
      currentKey = ev.toKey || currentKey;
      timeline.push({
        at: ev.at,
        appId,
        inQueue: isRecruitmentApplicationInActiveVacancyQueue(currentKey, null),
      });
    }
    if (app.closureOutcome === 'DECLINED' && app.closedAt) {
      const closedAt = new Date(app.closedAt);
      if (!Number.isNaN(closedAt.getTime())) {
        timeline.push({ at: closedAt, appId, inQueue: false });
      }
    }
  }

  timeline.sort((a, b) => a.at.getTime() - b.at.getTime());
  const inSet = new Set();
  let lastEmptied = null;
  for (const item of timeline) {
    if (item.inQueue) {
      inSet.add(item.appId);
      continue;
    }
    // Solo ancla cuando alguien que sí estaba en cola sale y deja la cola en 0.
    // Ej.: No asistió el 10 (vacía) y declina el 20 → sigue contando desde el 10.
    if (!inSet.has(item.appId)) continue;
    inSet.delete(item.appId);
    if (inSet.size === 0) lastEmptied = item.at;
  }
  return lastEmptied;
}

async function loadVacancyAppsForAgingHistory(organizationId, vacancyId, tx = prisma) {
  const apps = await tx.recruitmentApplication.findMany({
    where: { organizationId, vacancyId },
    select: {
      id: true,
      closureOutcome: true,
      appliedAt: true,
      closedAt: true,
      updatedAt: true,
      stage: { select: { key: true } },
      stageEvents: {
        select: {
          createdAt: true,
          fromStage: { select: { key: true } },
          toStage: { select: { key: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  return apps.map((app) => ({
    id: app.id,
    stageKey: app.stage?.key,
    closureOutcome: app.closureOutcome,
    appliedAt: app.appliedAt,
    closedAt: app.closedAt,
    updatedAt: app.updatedAt,
    events: (app.stageEvents || []).map((ev) => ({
      createdAt: ev.createdAt,
      fromStageKey: ev.fromStage?.key || null,
      toStageKey: ev.toStage?.key || null,
    })),
  }));
}

/**
 * Actualiza activeQueueEmptiedAt según la cola operativa actual de la vacante.
 * Limpia el ancla al reingresar alguien a proceso; al quedar vacía recupera historial si falta.
 */
export async function syncVacancyActiveQueueEmptiedAt(
  organizationId,
  vacancyId,
  tx = prisma,
  now = new Date(),
) {
  if (!organizationId || !vacancyId) return null;
  const apps = await tx.recruitmentApplication.findMany({
    where: { organizationId, vacancyId },
    select: {
      closureOutcome: true,
      stage: { select: { key: true } },
    },
  });
  let inProcess = 0;
  for (const app of apps) {
    if (isRecruitmentApplicationInActiveVacancyQueue(app.stage?.key, app.closureOutcome)) {
      inProcess += 1;
    }
  }
  const vacancy = await tx.recruitmentVacancy.findFirst({
    where: { id: vacancyId, organizationId },
    select: { id: true, activeQueueEmptiedAt: true },
  });
  if (!vacancy) return null;

  if (inProcess > 0) {
    if (vacancy.activeQueueEmptiedAt != null) {
      await tx.recruitmentVacancy.update({
        where: { id: vacancyId },
        data: { activeQueueEmptiedAt: null },
      });
    }
    return { inProcess, activeQueueEmptiedAt: null };
  }

  if (apps.length === 0) {
    if (vacancy.activeQueueEmptiedAt != null) {
      await tx.recruitmentVacancy.update({
        where: { id: vacancyId },
        data: { activeQueueEmptiedAt: null },
      });
    }
    return { inProcess: 0, activeQueueEmptiedAt: null };
  }

  if (vacancy.activeQueueEmptiedAt == null) {
    let emptiedAt = now;
    try {
      const history = await loadVacancyAppsForAgingHistory(organizationId, vacancyId, tx);
      const inferred = inferActiveQueueEmptiedAtFromHistory(history);
      if (inferred) emptiedAt = inferred;
    } catch (_e) {
      /* si el historial no está disponible, ancla en ahora */
    }
    await tx.recruitmentVacancy.update({
      where: { id: vacancyId },
      data: { activeQueueEmptiedAt: emptiedAt },
    });
    return { inProcess: 0, activeQueueEmptiedAt: emptiedAt };
  }
  return { inProcess: 0, activeQueueEmptiedAt: vacancy.activeQueueEmptiedAt };
}

/** Calcula agingTrafficLight actual (y backfill de emptiedAt legacy si hace falta). */
export async function computeVacancyAgingTrafficLight(organizationId, vacancyId, tx = prisma) {
  const vacancy = await tx.recruitmentVacancy.findFirst({
    where: { id: vacancyId, organizationId },
  });
  if (!vacancy) return null;
  const apps = await tx.recruitmentApplication.findMany({
    where: { organizationId, vacancyId },
    select: {
      candidateId: true,
      hiredStageEnteredAt: true,
      closureOutcome: true,
      stage: { select: { key: true } },
    },
  });
  const summary = summarizeApplications(apps);
  let emptiedAt = vacancy.activeQueueEmptiedAt ?? null;
  if (
    vacancy.status === 'ACTIVE'
    && pendingPositions(vacancy.positionsTotal, summary.hiredConfirmed) > 0
    && summary.inProcess === 0
    && summary.total > 0
    && emptiedAt == null
  ) {
    const sync = await syncVacancyActiveQueueEmptiedAt(organizationId, vacancyId, tx);
    emptiedAt = sync?.activeQueueEmptiedAt ?? null;
  }
  const timeZone = await resolveOrganizationIanaTimezone(organizationId);
  return resolveVacancyAgingTrafficLight({
    status: vacancy.status,
    positionsTotal: vacancy.positionsTotal,
    hiredConfirmed: summary.hiredConfirmed,
    applicationTotal: summary.total,
    inProcess: summary.inProcess,
    createdAt: vacancy.createdAt,
    activeQueueEmptiedAt: emptiedAt,
    timeZone,
  });
}

export function emptyApplicationSummary() {
  return { total: 0, inProcess: 0, finalists: 0, hired: 0, hiredConfirmed: 0, rejected: 0 };
}

function summarizeApplications(applications, now = new Date()) {
  const summary = emptyApplicationSummary();
  const hiredSeen = new Set();
  for (const app of applications) {
    summary.total += 1;
    const key = app.stage?.key;
    const kind = classifyRecruitmentApplication(key, app.closureOutcome);
    if (kind === 'declined') continue;
    if (kind === 'hired' && app.candidateId && !hiredSeen.has(app.candidateId)) {
      hiredSeen.add(app.candidateId);
      summary.hired += 1;
      if (isHireConfirmedAt(app.hiredStageEnteredAt, now)) summary.hiredConfirmed += 1;
    }
    if (kind === 'active' && key === 'FINALIST') summary.finalists += 1;
    if (kind === 'rejected') summary.rejected += 1;
    if (isRecruitmentApplicationInActiveVacancyQueue(key, app.closureOutcome)) {
      summary.inProcess += 1;
    }
  }
  return summary;
}

export function localTodayDateKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function localDateKeyFromIso(iso) {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return localTodayDateKey();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Diferencia en días calendario (toKey − fromKey). */
export function calendarDayDiff(fromKey, toKey) {
  const parse = (key) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key).trim());
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  const a = parse(fromKey);
  const b = parse(toKey);
  if (a == null || b == null) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function computeCoveragePercent(hired, positionsTotal) {
  const positions = Math.max(1, Number(positionsTotal) || 1);
  const h = Math.max(0, Number(hired) || 0);
  return Math.min(100, Math.round((h / positions) * 100));
}

export function computeRejectionRatePercent(rejected, total) {
  const t = Number(total) || 0;
  if (t === 0) return null;
  return Math.round((Math.max(0, Number(rejected) || 0) / t) * 100);
}

export function formatTargetObjectiveLabel(targetCoverageDateYmd, todayKey = localTodayDateKey()) {
  if (!targetCoverageDateYmd) return 'Sin fecha objetivo';
  const diff = calendarDayDiff(todayKey, targetCoverageDateYmd);
  if (diff > 0) return `${diff} día${diff === 1 ? '' : 's'} restantes`;
  if (diff === 0) return 'Vence hoy';
  const past = -diff;
  return `Vencida hace ${past} día${past === 1 ? '' : 's'}`;
}

export function buildExecutiveSnapshot(vacancyRow, applicationSummary, todayKey = localTodayDateKey()) {
  const summary = applicationSummary ?? emptyApplicationSummary();
  const positionsTotal = vacancyRow.positionsTotal;
  const confirmed = summary.hiredConfirmed ?? 0;
  const rejectionRatePercent = computeRejectionRatePercent(summary.rejected, summary.total);
  const openedKey = localDateKeyFromIso(vacancyRow.openedAt.toISOString());
  const daysOpen = Math.max(0, calendarDayDiff(openedKey, todayKey));
  const targetYmd = formatTargetCoverageDate(vacancyRow);

  return {
    coveragePercent: officialCoveragePercent(positionsTotal, confirmed),
    coveragePositionsText: `${confirmed} / ${positionsTotal}`,
    inProcess: summary.inProcess ?? 0,
    rejectionRatePercent,
    rejectionDisplay: rejectionRatePercent == null ? 'Sin datos' : `${rejectionRatePercent}%`,
    targetDisplay: formatTargetObjectiveLabel(targetYmd, todayKey),
    daysOpen,
  };
}

async function buildStageDistributionForVacancy(organizationId, vacancyId) {
  const [enabledRows, grouped] = await Promise.all([
    listEnabledVacancyStagesForDistribution(organizationId, vacancyId),
    prisma.recruitmentApplication.groupBy({
      by: ['stageId'],
      where: {
        organizationId,
        vacancyId,
        NOT: { closureOutcome: 'DECLINED' },
      },
      _count: { _all: true },
    }),
  ]);
  const countByStageId = new Map(grouped.map((g) => [g.stageId, g._count._all]));
  return enabledRows.map((row) => ({
    stageId: row.stageId,
    key: row.stage.key,
    name: row.stage.name,
    position: row.position,
    count: countByStageId.get(row.stageId) ?? 0,
  }));
}

async function buildApplicationSummariesByVacancyId(organizationId, vacancyIds) {
  const map = new Map(vacancyIds.map((id) => [id, emptyApplicationSummary()]));
  if (!vacancyIds.length) return map;

  const applications = await prisma.recruitmentApplication.findMany({
    where: { organizationId, vacancyId: { in: vacancyIds } },
    select: {
      vacancyId: true,
      candidateId: true,
      hiredStageEnteredAt: true,
      closureOutcome: true,
      stage: { select: { key: true } },
    },
  });

  const byVacancy = new Map();
  for (const id of vacancyIds) byVacancy.set(id, []);
  for (const app of applications) {
    const bucket = byVacancy.get(app.vacancyId);
    if (bucket) bucket.push(app);
  }
  for (const [id, apps] of byVacancy) {
    map.set(id, summarizeApplications(apps));
  }
  return map;
}

async function buildPrimaryAssigneesByVacancyId(organizationId, vacancyIds) {
  const map = new Map();
  if (!vacancyIds.length) return map;

  const rows = await prisma.recruitmentVacancyAssignee.findMany({
    where: { organizationId, vacancyId: { in: vacancyIds }, role: 'PRIMARY' },
    include: {
      employee: { select: { id: true, fullName: true, position: true, department: true } },
    },
  });
  for (const row of rows) {
    map.set(row.vacancyId, {
      assigneeId: row.id,
      employeeId: row.employeeId,
      role: row.role,
      employee: row.employee,
    });
  }
  return map;
}

function formatTargetCoverageDate(row) {
  if (!row.targetCoverageDate) return null;
  const d = row.targetCoverageDate;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseTargetCoverageDate(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!m) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'targetCoverageDate inválido; use YYYY-MM-DD.';
    throw err;
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function serializeRecruitmentVacancy(row, extras = {}) {
  const applicationSummary = extras.applicationSummary ?? emptyApplicationSummary();
  const agingTrafficLight =
    extras.agingTrafficLight !== undefined
      ? extras.agingTrafficLight
      : resolveVacancyAgingTrafficLight({
          status: row.status,
          positionsTotal: row.positionsTotal,
          hiredConfirmed: applicationSummary.hiredConfirmed,
          applicationTotal: applicationSummary.total,
          inProcess: applicationSummary.inProcess,
          createdAt: row.createdAt,
          activeQueueEmptiedAt: row.activeQueueEmptiedAt ?? null,
          timeZone: extras.timeZone || MIND24_DEFAULT_IANA_TIMEZONE,
        });
  return {
    id: row.id,
    title: row.title,
    clientName: row.clientName,
    location: row.location,
    positionsTotal: row.positionsTotal,
    openedAt: row.openedAt.toISOString(),
    targetCoverageDate: formatTargetCoverageDate(row),
    status: row.status,
    jobDescription: row.jobDescription,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    applicationSummary,
    primaryAssignee: extras.primaryAssignee ?? null,
    executiveSnapshot: extras.executiveSnapshot ?? null,
    stageDistribution: extras.stageDistribution ?? null,
    hiredCandidates: extras.hiredCandidates ?? undefined,
    coveredAt: row.coveredAt ? row.coveredAt.toISOString() : null,
    coverageSource: row.coverageSource ?? null,
    agingTrafficLight: agingTrafficLight ?? null,
  };
}

async function enrichVacancies(organizationId, rows) {
  const ids = rows.map((r) => r.id);
  const [summaryMap, assigneeMap, timeZone] = await Promise.all([
    buildApplicationSummariesByVacancyId(organizationId, ids),
    buildPrimaryAssigneesByVacancyId(organizationId, ids),
    resolveOrganizationIanaTimezone(organizationId),
  ]);

  // Legacy: cola vacía sin ancla → recuperar desde historial y persistir.
  const needBackfill = rows.filter((row) => {
    const summary = summaryMap.get(row.id) ?? emptyApplicationSummary();
    return (
      row.status === 'ACTIVE'
      && pendingPositions(row.positionsTotal, summary.hiredConfirmed) > 0
      && summary.inProcess === 0
      && summary.total > 0
      && row.activeQueueEmptiedAt == null
    );
  });
  const emptiedById = new Map(rows.map((r) => [r.id, r.activeQueueEmptiedAt ?? null]));
  if (needBackfill.length) {
    await Promise.all(
      needBackfill.map(async (row) => {
        const sync = await syncVacancyActiveQueueEmptiedAt(organizationId, row.id);
        emptiedById.set(row.id, sync?.activeQueueEmptiedAt ?? null);
      }),
    );
  }

  return rows.map((row) => {
    const applicationSummary = summaryMap.get(row.id) ?? emptyApplicationSummary();
    return serializeRecruitmentVacancy(row, {
      applicationSummary,
      primaryAssignee: assigneeMap.get(row.id) ?? null,
      timeZone,
      agingTrafficLight: resolveVacancyAgingTrafficLight({
        status: row.status,
        positionsTotal: row.positionsTotal,
        hiredConfirmed: applicationSummary.hiredConfirmed,
        applicationTotal: applicationSummary.total,
        inProcess: applicationSummary.inProcess,
        createdAt: row.createdAt,
        activeQueueEmptiedAt: emptiedById.get(row.id) ?? null,
        timeZone,
      }),
    });
  });
}

export async function assertRecruitmentVacancyInOrg(vacancyId, organizationId, db = prisma) {
  const row = await db.recruitmentVacancy.findFirst({
    where: { id: vacancyId, organizationId },
  });
  if (!row) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Vacante no encontrada.';
    throw err;
  }
  return row;
}

function parseOpenedAt(value) {
  if (value == null) return new Date();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'openedAt inválido.';
    throw err;
  }
  return d;
}

export async function createRecruitmentVacancy(organizationId, payload) {
  const positionsTotal = Number(payload.positionsTotal);
  if (!Number.isInteger(positionsTotal) || positionsTotal < 1) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'positionsTotal debe ser al menos 1.';
    throw err;
  }
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.recruitmentVacancy.create({
      data: {
        organizationId,
        title: payload.title.trim(),
        clientName: payload.clientName.trim(),
        location: payload.location?.trim() || null,
        positionsTotal,
        openedAt: parseOpenedAt(payload.openedAt),
        status:
          payload.status && RECRUITMENT_VACANCY_STATUSES.includes(payload.status)
            ? payload.status
            : 'ACTIVE',
        jobDescription: payload.jobDescription?.trim() || null,
        notes: payload.notes?.trim() || null,
        ...(payload.status === 'COVERED'
          ? { coveredAt: new Date(), coverageSource: 'MANUAL' }
          : {}),
        ...(payload.targetCoverageDate !== undefined
          ? { targetCoverageDate: parseTargetCoverageDate(payload.targetCoverageDate) }
          : {}),
      },
    });
    await seedVacancyStagesFromOrganizationCatalog(organizationId, created.id, tx);
    return created;
  });
  if (row.status === 'ACTIVE') {
    await reconcileVacancyCoverage(organizationId, row.id);
  }
  const fresh = await prisma.recruitmentVacancy.findFirst({
    where: { id: row.id, organizationId },
  });
  const [vacancy] = await enrichVacancies(organizationId, [fresh || row]);
  return vacancy;
}

export async function listRecruitmentVacancies(organizationId, { status } = {}) {
  const where = { organizationId };
  if (status && RECRUITMENT_VACANCY_STATUSES.includes(status)) {
    where.status = status;
  }
  const rows = await prisma.recruitmentVacancy.findMany({
    where,
    orderBy: [{ openedAt: 'desc' }, { createdAt: 'desc' }],
  });
  return enrichVacancies(organizationId, rows);
}

export async function getRecruitmentVacancy(organizationId, vacancyId) {
  const row = await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  // Misma ruta de aging/TZ que el listado (enrichVacancies), más extras de detalle.
  const [enriched, stageDistribution, hiredCandidates] = await Promise.all([
    enrichVacancies(organizationId, [row]),
    buildStageDistributionForVacancy(organizationId, vacancyId),
    listCurrentHiresForVacancy(organizationId, vacancyId),
  ]);
  const vacancy = enriched[0];
  return {
    ...vacancy,
    executiveSnapshot: buildExecutiveSnapshot(row, vacancy.applicationSummary),
    stageDistribution,
    hiredCandidates,
  };
}

export async function updateRecruitmentVacancy(organizationId, vacancyId, patch) {
  const data = {};
  if (patch.title != null) data.title = patch.title.trim();
  if (patch.clientName != null) data.clientName = patch.clientName.trim();
  if (patch.location !== undefined) data.location = patch.location?.trim() || null;
  if (patch.positionsTotal != null) {
    const n = Number(patch.positionsTotal);
    if (!Number.isInteger(n) || n < 1) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'positionsTotal debe ser al menos 1.';
      throw err;
    }
    data.positionsTotal = n;
  }
  if (patch.openedAt != null) data.openedAt = parseOpenedAt(patch.openedAt);
  if (patch.status != null) {
    if (!RECRUITMENT_VACANCY_STATUSES.includes(patch.status)) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'status de vacante inválido.';
      throw err;
    }
    data.status = patch.status;
  }
  if (patch.jobDescription !== undefined) data.jobDescription = patch.jobDescription?.trim() || null;
  if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;
  if (patch.targetCoverageDate !== undefined) {
    data.targetCoverageDate = parseTargetCoverageDate(patch.targetCoverageDate);
  }

  const nextStatus = await prisma.$transaction(async (tx) => {
    const current = await lockRecruitmentVacancyForCoverage(tx, organizationId, vacancyId);
    const status = data.status ?? current.status;
    const currentHired = await countDistinctHiredCandidates(organizationId, vacancyId, tx);
    const coverageMeta = planVacancyCoverageUpdate({
      currentStatus: current.status,
      nextStatus: status,
      positionsTotal: data.positionsTotal ?? current.positionsTotal,
      currentHired,
      now: new Date(),
    });
    await tx.recruitmentVacancy.update({
      where: { id: vacancyId },
      data: { ...data, ...coverageMeta },
    });
    return status;
  });
  if (nextStatus === 'ACTIVE') {
    await reconcileVacancyCoverage(organizationId, vacancyId);
  }
  const row = await prisma.recruitmentVacancy.findFirst({
    where: { id: vacancyId, organizationId },
  });
  const [vacancy] = await enrichVacancies(organizationId, [row]);
  return vacancy;
}

export async function getActiveVacancyHeadcount(organizationId) {
  const agg = await prisma.recruitmentVacancy.aggregate({
    where: { organizationId, status: 'ACTIVE' },
    _count: { _all: true },
    _sum: { positionsTotal: true },
  });
  return {
    activeVacancies: agg._count._all,
    headcount: agg._sum.positionsTotal ?? 0,
  };
}

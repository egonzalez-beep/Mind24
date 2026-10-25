import { prisma } from '../db/client.js';
import { endOfCalendarDayInTimeZone } from '../utils/workforceDueDate.js';
import {
  localYearMonth,
  resolveOrganizationIanaTimezone,
} from './organizationTimezone.service.js';
import { calendarDayDiff } from './recruitmentVacancy.service.js';
import {
  localDateKey,
  utcRangeForLocalDateInclusive,
} from './remoteWorkSessionHistory.service.js';

const MONTH_NAMES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const MONTH_NAMES_ES_TITLE = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

export function parseMetricsMonthInput(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Año inválido.';
    throw err;
  }
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Mes inválido.';
    throw err;
  }
  return { year: y, month: m };
}

function daysInCalendarMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Rango [start, end) en instantes UTC para el mes calendario en la IANA dada. */
export function getLocalMonthRange(year, month, timeZone) {
  const mm = String(month).padStart(2, '0');
  const fromKey = `${year}-${mm}-01`;
  const daysInMonth = daysInCalendarMonth(year, month);
  const toKey = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`;
  const { start, end } = utcRangeForLocalDateInclusive(fromKey, toKey, timeZone);
  return { start, end, daysInMonth, fromKey, toKey };
}

/** @deprecated Usar getLocalMonthRange con IANA; conservado para tests legacy. */
export function getUtcMonthRange(year, month) {
  return getLocalMonthRange(year, month, 'UTC');
}

export function shiftMonth(year, month, delta) {
  let y = year;
  let m = month + delta;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return { year: y, month: m };
}

function formatMonthLabel(year, month) {
  return `${MONTH_NAMES_ES_TITLE[month - 1]} ${year}`;
}

function formatMonthShort(month) {
  return MONTH_NAMES_ES[month - 1];
}

function formatPeriodFooter(fromKey, toKey, year, month) {
  const d1 = Number(fromKey.slice(8, 10));
  const d2 = Number(toKey.slice(8, 10));
  const mon = MONTH_NAMES_ES[month - 1];
  return `Periodo: ${d1}—${d2} ${mon} ${year}`;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function intensityLevel(count, max) {
  if (!count || max <= 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.2) return 1;
  if (ratio <= 0.4) return 2;
  if (ratio <= 0.6) return 3;
  if (ratio <= 0.8) return 4;
  return 5;
}

async function countCandidatesCreated(organizationId, start, end) {
  return prisma.recruitmentCandidate.count({
    where: {
      organizationId,
      createdAt: { gte: start, lt: end },
    },
  });
}

async function countDistinctCandidatesEnteredProcess(organizationId, start, end) {
  const rows = await prisma.recruitmentApplication.findMany({
    where: {
      organizationId,
      createdAt: { gte: start, lt: end },
    },
    select: { candidateId: true },
    distinct: ['candidateId'],
  });
  return rows.length;
}

async function countStageMovesToKey(organizationId, stageKey, start, end) {
  return prisma.recruitmentApplicationStageEvent.count({
    where: {
      organizationId,
      createdAt: { gte: start, lt: end },
      toStage: { key: stageKey },
    },
  });
}

async function rejectedByClient(organizationId, start, end) {
  const events = await prisma.recruitmentApplicationStageEvent.findMany({
    where: {
      organizationId,
      createdAt: { gte: start, lt: end },
      toStage: { key: 'REJECTED' },
    },
    select: {
      application: {
        select: {
          vacancy: { select: { clientName: true } },
        },
      },
    },
  });
  const byClient = new Map();
  for (const ev of events) {
    const name = (ev.application?.vacancy?.clientName || 'Sin cliente').trim() || 'Sin cliente';
    byClient.set(name, (byClient.get(name) || 0) + 1);
  }
  let top = null;
  for (const [name, count] of byClient.entries()) {
    if (!top || count > top.count) top = { name, count };
  }
  const total = events.length;
  if (!top || total === 0) return { total: 0, topClient: null };
  return {
    total,
    topClient: {
      name: top.name,
      count: top.count,
      percent: Math.round((top.count / total) * 100),
    },
  };
}

/**
 * V1: fecha de cobertura ≈ vacancy.updatedAt al quedar COVERED (sin audit log de status).
 * Solo vacantes COVERED con esa fecha dentro del mes; targetCoverageDate no filtra inclusión.
 */
async function avgCoverageDaysForMonth(organizationId, start, end, timeZone) {
  const vacs = await prisma.recruitmentVacancy.findMany({
    where: {
      organizationId,
      status: 'COVERED',
      updatedAt: { gte: start, lt: end },
    },
    select: {
      openedAt: true,
      updatedAt: true,
    },
  });
  const durations = [];
  for (const v of vacs) {
    const openedKey = localDateKey(v.openedAt, timeZone);
    const coveredKey = localDateKey(v.updatedAt, timeZone);
    const days = calendarDayDiff(openedKey, coveredKey);
    if (days < 0) continue;
    durations.push(days);
  }
  if (!durations.length) return null;
  const sum = durations.reduce((a, b) => a + b, 0);
  return round1(sum / durations.length);
}

async function activeVacanciesAtMonthEnd(organizationId, endOfMonth, timeZone) {
  const rows = await prisma.recruitmentVacancy.findMany({
    where: {
      organizationId,
      openedAt: { lte: endOfMonth },
      OR: [
        { status: { in: ['ACTIVE', 'PAUSED'] } },
        { status: { in: ['COVERED', 'CLOSED'] }, updatedAt: { gt: endOfMonth } },
      ],
    },
    select: {
      id: true,
      status: true,
      targetCoverageDate: true,
      updatedAt: true,
    },
  });
  const active = rows.filter(
    (v) =>
      v.status === 'ACTIVE' ||
      v.status === 'PAUSED' ||
      ((v.status === 'COVERED' || v.status === 'CLOSED') && v.updatedAt > endOfMonth),
  );
  const nearTargetWindowEnd = new Date(endOfMonth.getTime() + 14 * 86400000);
  let nearTarget = 0;
  for (const v of active) {
    if (!v.targetCoverageDate) continue;
    const t = new Date(`${v.targetCoverageDate}T12:00:00.000Z`);
    if (t >= endOfMonth && t <= nearTargetWindowEnd) nearTarget += 1;
  }
  return { total: active.length, nearTargetCount: nearTarget };
}

async function dailyActivity(organizationId, year, month, start, end, timeZone) {
  const candidates = await prisma.recruitmentCandidate.findMany({
    where: { organizationId, createdAt: { gte: start, lt: end } },
    select: { createdAt: true },
  });
  const hires = await prisma.recruitmentApplicationStageEvent.findMany({
    where: {
      organizationId,
      createdAt: { gte: start, lt: end },
      toStage: { key: 'HIRED' },
    },
    select: { createdAt: true },
  });
  const regByDay = new Map();
  for (const c of candidates) {
    const d = localDateKey(c.createdAt, timeZone);
    regByDay.set(d, (regByDay.get(d) || 0) + 1);
  }
  const hireByDay = new Map();
  for (const h of hires) {
    const d = localDateKey(h.createdAt, timeZone);
    hireByDay.set(d, (hireByDay.get(d) || 0) + 1);
  }
  const daysInMonth = getLocalMonthRange(year, month, timeZone).daysInMonth;
  const days = [];
  let peak = { date: null, registrations: 0 };
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const registrations = regByDay.get(iso) || 0;
    const hireCount = hireByDay.get(iso) || 0;
    if (registrations > peak.registrations) peak = { date: iso, registrations };
    days.push({ date: iso, registrations, hires: hireCount });
  }
  const maxReg = Math.max(0, ...days.map((d) => d.registrations));
  for (const d of days) {
    d.intensity = intensityLevel(d.registrations, maxReg);
  }
  return { days, peak };
}

function buildInsights({
  currRegistered,
  prevRegistered,
  prevMonthLabel,
  rejectedTop,
  rejectedTotal,
  currCoverage,
  prevCoverage,
}) {
  const insights = [];
  if (currRegistered > prevRegistered) {
    insights.push({
      kind: 'registrations_up',
      title: 'Más registros que el mes pasado',
      body: `${currRegistered} registros · ${currRegistered - prevRegistered} más que ${prevMonthLabel}.`,
      tone: 'purple',
    });
  } else if (currRegistered < prevRegistered && prevRegistered > 0) {
    insights.push({
      kind: 'registrations_down',
      title: 'Menos registros que el mes pasado',
      body: `${currRegistered} registros · ${prevRegistered - currRegistered} menos que ${prevMonthLabel}.`,
      tone: 'purple',
    });
  }
  if (rejectedTop && rejectedTotal > 0 && rejectedTop.percent >= 50) {
    insights.push({
      kind: 'rejections_client',
      title: `${rejectedTop.name} concentra los rechazos`,
      body: `${rejectedTop.count} de ${rejectedTotal} candidatos rechazados.`,
      tone: 'coral',
    });
  }
  if (currCoverage != null && prevCoverage != null) {
    const delta = round1(currCoverage - prevCoverage);
    if (delta < 0) {
      insights.push({
        kind: 'coverage_faster',
        title: 'Cobertura más ágil',
        body: `El promedio bajó ${Math.abs(delta)} días frente a ${prevMonthLabel}.`,
        tone: 'green',
      });
    } else if (delta > 0) {
      insights.push({
        kind: 'coverage_slower',
        title: 'Cobertura más lenta',
        body: `El promedio subió ${delta} días frente a ${prevMonthLabel}.`,
        tone: 'amber',
      });
    }
  }
  return insights;
}

export async function getRecruitmentMetrics(organizationId, year, month) {
  const timeZone = await resolveOrganizationIanaTimezone(organizationId);
  const { start, end, daysInMonth, fromKey, toKey } = getLocalMonthRange(year, month, timeZone);
  const prev = shiftMonth(year, month, -1);
  const prevRange = getLocalMonthRange(prev.year, prev.month, timeZone);
  const endOfMonth = endOfCalendarDayInTimeZone(toKey, timeZone);
  const prevMonthLabel = formatMonthShort(prev.month);

  const [
    currRegistered,
    prevRegistered,
    enteredProcess,
    hired,
    prevHired,
    rejectedDetail,
    prevRejectedTotal,
    currCoverage,
    prevCoverage,
    activeSnapshot,
    activity,
  ] = await Promise.all([
    countCandidatesCreated(organizationId, start, end),
    countCandidatesCreated(organizationId, prevRange.start, prevRange.end),
    countDistinctCandidatesEnteredProcess(organizationId, start, end),
    countStageMovesToKey(organizationId, 'HIRED', start, end),
    countStageMovesToKey(organizationId, 'HIRED', prevRange.start, prevRange.end),
    rejectedByClient(organizationId, start, end),
    countStageMovesToKey(organizationId, 'REJECTED', prevRange.start, prevRange.end),
    avgCoverageDaysForMonth(organizationId, start, end, timeZone),
    avgCoverageDaysForMonth(organizationId, prevRange.start, prevRange.end, timeZone),
    activeVacanciesAtMonthEnd(organizationId, endOfMonth, timeZone),
    dailyActivity(organizationId, year, month, start, end, timeZone),
  ]);

  const currDailyAvg = round1(currRegistered / daysInMonth);
  const prevDailyAvg = round1(prevRegistered / prevRange.daysInMonth);
  const deltaDailyAvg = round1(currDailyAvg - prevDailyAvg);

  const insights = buildInsights({
    currRegistered,
    prevRegistered,
    prevMonthLabel,
    rejectedTop: rejectedDetail.topClient,
    rejectedTotal: rejectedDetail.total,
    currCoverage,
    prevCoverage,
  });

  return {
    period: {
      year,
      month,
      label: formatMonthLabel(year, month),
      previousMonthLabel: prevMonthLabel,
      footerLabel: formatPeriodFooter(fromKey, toKey, year, month),
      daysInMonth,
      timeZone,
    },
    kpis: {
      candidatesRegistered: {
        total: currRegistered,
        dailyAverage: currDailyAvg,
        deltaDailyAverage: deltaDailyAvg,
        compareLabel: prevMonthLabel,
      },
      enteredProcess: { total: enteredProcess },
      hired: {
        total: hired,
        deltaVsPrevious: hired - prevHired,
        compareLabel: prevMonthLabel,
      },
      rejected: {
        total: rejectedDetail.total,
        topClient: rejectedDetail.topClient,
        previousTotal: prevRejectedTotal,
      },
      avgCoverageDays: {
        value: currCoverage,
        deltaVsPrevious:
          currCoverage != null && prevCoverage != null ? round1(currCoverage - prevCoverage) : null,
        compareLabel: prevMonthLabel,
        /** V1: cobertura inferida por updatedAt al pasar a COVERED. */
        coverageDateSource: 'vacancy.updatedAt',
      },
      activeVacancies: {
        total: activeSnapshot.total,
        nearTargetCount: activeSnapshot.nearTargetCount,
      },
    },
    dailyActivity: activity,
    insights,
    generatedAt: new Date().toISOString(),
  };
}

export async function getRecruitmentMetricsForRequest(organizationId, year, month) {
  const timeZone = await resolveOrganizationIanaTimezone(organizationId);
  let y = year;
  let m = month;
  if (y == null || m == null) {
    const now = localYearMonth(new Date(), timeZone);
    y = now.year;
    m = now.month;
  }
  const parsed = parseMetricsMonthInput(y, m);
  const metrics = await getRecruitmentMetrics(organizationId, parsed.year, parsed.month);
  return metrics;
}

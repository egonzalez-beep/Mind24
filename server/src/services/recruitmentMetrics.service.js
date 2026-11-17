import { prisma } from '../db/client.js';
import { endOfCalendarDayInTimeZone } from '../utils/workforceDueDate.js';
import {
  localYearMonth,
  resolveOrganizationIanaTimezone,
} from './organizationTimezone.service.js';
import { calendarDayDiff } from './recruitmentVacancy.service.js';
import {
  consolidateTerminalApplications,
  isSelectedMonthCurrent,
  rejectedTopClientFromConsolidated,
} from './recruitmentMetricsTerminal.service.js';
import {
  localDateKey,
  utcRangeForLocalDateInclusive,
} from './remoteWorkSessionHistory.service.js';
import {
  buildMonthlyTrend,
  filterDuplicateInsights,
  resolveTrendComparisonWindows,
} from './recruitmentMetricsTrend.service.js';

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

async function loadApplicationsForTerminalMetrics(organizationId, rangeStart, rangeEnd) {
  const touched = await prisma.recruitmentApplicationStageEvent.findMany({
    where: {
      organizationId,
      createdAt: { gte: rangeStart, lt: rangeEnd },
      toStage: { key: { in: ['HIRED', 'REJECTED'] } },
    },
    select: { applicationId: true },
    distinct: ['applicationId'],
  });
  const appIds = touched.map((r) => r.applicationId);
  if (!appIds.length) return { applications: [], byId: new Map() };

  const rows = await prisma.recruitmentApplication.findMany({
    where: { organizationId, id: { in: appIds } },
    include: {
      stage: { select: { key: true } },
      vacancy: { select: { clientName: true } },
      stageEvents: {
        include: { toStage: { select: { key: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });

  const applications = rows.map((row) => ({
    applicationId: row.id,
    currentStageKey: row.stage?.key || null,
    clientName: row.vacancy?.clientName || null,
    timeline: row.stageEvents.map((ev) => ({
      id: ev.id,
      createdAt: ev.createdAt,
      toStageKey: ev.toStage?.key || '',
    })),
  }));
  const byId = new Map(applications.map((a) => [a.applicationId, a]));
  return { applications, byId };
}

function consolidatedTerminalForPeriod(
  applications,
  stageKey,
  { year, month, monthStart, monthEnd, endOfMonthInstant, timeZone, now },
) {
  const isCurrentMonth = isSelectedMonthCurrent(year, month, timeZone, now);
  return consolidateTerminalApplications(applications, stageKey, {
    monthStart,
    monthEnd,
    endOfMonthInstant,
    now,
    isCurrentMonth,
  });
}

/**
 * Promedio a partir de filas ya filtradas (status COVERED + coveredAt en mes).
 * openedAt posterior a coveredAt → inválido, nunca duración negativa.
 * KPI = vacantes que **permanecen** COVERED con coveredAt en el mes (no historial de reaperturas).
 */
export function computeCoverageAverageFromVacancies(vacs, timeZone) {
  const durations = [];
  let invalidChronology = 0;
  for (const v of vacs || []) {
    if (!v?.coveredAt || !v?.openedAt) continue;
    const openedKey = localDateKey(v.openedAt, timeZone);
    const coveredKey = localDateKey(v.coveredAt, timeZone);
    const days = calendarDayDiff(openedKey, coveredKey);
    if (days < 0) {
      invalidChronology += 1;
      continue;
    }
    durations.push(days);
  }
  if (!durations.length) {
    return { value: null, sampleSize: 0, invalidChronology };
  }
  const sum = durations.reduce((a, b) => a + b, 0);
  return {
    value: round1(sum / durations.length),
    sampleSize: durations.length,
    invalidChronology,
  };
}

/**
 * Cobertura canónica del mes: openedAt → coveredAt.
 * Solo vacantes actualmente COVERED cuyo coveredAt cae en el mes.
 * Sin fallback a updatedAt. Reabrir limpia coveredAt y deja de contar.
 */
export async function avgCoverageDaysForMonth(organizationId, start, end, timeZone) {
  const inMonth = await prisma.recruitmentVacancy.findMany({
    where: {
      organizationId,
      status: 'COVERED',
      coveredAt: { gte: start, lt: end },
    },
    select: {
      openedAt: true,
      coveredAt: true,
    },
  });
  return computeCoverageAverageFromVacancies(inMonth, timeZone);
}

/**
 * Declinados del mes: apps con closureOutcome DECLINED y closedAt en rango.
 * Sin consolidación 24h. Sin fallback a updatedAt/createdAt/archivo.
 */
export async function countDeclinedApplicationsForMonth(organizationId, start, end) {
  const total = await prisma.recruitmentApplication.count({
    where: {
      organizationId,
      closureOutcome: 'DECLINED',
      closedAt: { gte: start, lt: end },
    },
  });
  return { total };
}

/**
 * Calidad de datos global (estado actual de la org), no atribuible a un mes.
 * Filas sin fecha terminal no pueden asignarse de forma confiable a un periodo.
 */
export async function loadRecruitmentMetricsDataQuality(organizationId) {
  const [coveredVacanciesMissingCoveredAt, declinedApplicationsMissingClosedAt] = await Promise.all([
    prisma.recruitmentVacancy.count({
      where: {
        organizationId,
        status: 'COVERED',
        coveredAt: null,
      },
    }),
    prisma.recruitmentApplication.count({
      where: {
        organizationId,
        closureOutcome: 'DECLINED',
        closedAt: null,
      },
    }),
  ]);
  return {
    coveredVacanciesMissingCoveredAt,
    declinedApplicationsMissingClosedAt,
  };
}

/**
 * Participación entre cierres terminales del mes (0–1).
 * No es tasa de contratación ni de rechazo sobre el funnel.
 * null cuando no hay decisiones terminales.
 */
export function buildTerminalClosureShares({ hired, rejected, declined }) {
  const h = Math.max(0, Number(hired) || 0);
  const r = Math.max(0, Number(rejected) || 0);
  const d = Math.max(0, Number(declined) || 0);
  const terminalDecisions = h + r + d;
  if (terminalDecisions <= 0) {
    return {
      hired: h,
      rejected: r,
      declined: d,
      terminalDecisions: 0,
      hireShare: null,
      rejectionShare: null,
      declineShare: null,
    };
  }
  return {
    hired: h,
    rejected: r,
    declined: d,
    terminalDecisions,
    hireShare: h / terminalDecisions,
    rejectionShare: r / terminalDecisions,
    declineShare: d / terminalDecisions,
  };
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

function buildDailyActivityFromMaps(
  year,
  month,
  timeZone,
  regByDay,
  consolidatedHired,
) {
  const hireByDay = new Map();
  for (const h of consolidatedHired) {
    const d = localDateKey(h.entryAt, timeZone);
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

async function dailyActivity(
  organizationId,
  year,
  month,
  start,
  end,
  timeZone,
  consolidatedHired,
) {
  const candidates = await prisma.recruitmentCandidate.findMany({
    where: { organizationId, createdAt: { gte: start, lt: end } },
    select: { createdAt: true },
  });
  const regByDay = new Map();
  for (const c of candidates) {
    const d = localDateKey(c.createdAt, timeZone);
    regByDay.set(d, (regByDay.get(d) || 0) + 1);
  }
  return buildDailyActivityFromMaps(year, month, timeZone, regByDay, consolidatedHired);
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

export async function getRecruitmentMetrics(organizationId, year, month, now = new Date()) {
  const timeZone = await resolveOrganizationIanaTimezone(organizationId);
  const fullRange = getLocalMonthRange(year, month, timeZone);
  const { daysInMonth, fromKey, toKey } = fullRange;
  const prevMeta = shiftMonth(year, month, -1);
  const prevFull = getLocalMonthRange(prevMeta.year, prevMeta.month, timeZone);
  const endOfMonth = endOfCalendarDayInTimeZone(toKey, timeZone);

  const windows = resolveTrendComparisonWindows({
    year,
    month,
    timeZone,
    now,
    getLocalMonthRange,
  });
  const { comparisonMode, curr, prev, labels, isCurrentMonth } = windows;
  const compareLabel = labels.compareLabelShort || formatMonthShort(prev.month);
  const prevMonthLabel = labels.previousMonthLabel || formatMonthShort(prev.month);

  // KPIs MoM y tendencia usan la misma ventana (FULL_MONTH o MONTH_TO_DATE).
  const kpiStart = curr.start;
  const kpiEnd = curr.end;
  const prevStart = prev.start;
  const prevEnd = prev.end;

  const { applications } = await loadApplicationsForTerminalMetrics(
    organizationId,
    prevFull.start < prevStart ? prevFull.start : prevStart,
    fullRange.end > kpiEnd ? fullRange.end : kpiEnd,
  );

  const currCloseInstant = isCurrentMonth
    ? now
    : new Date(Math.max(kpiStart.getTime(), kpiEnd.getTime() - 1));
  const prevCloseInstant = new Date(Math.max(prevStart.getTime(), prevEnd.getTime() - 1));

  const consolidatedHiredCurr = consolidateTerminalApplications(applications, 'HIRED', {
    monthStart: kpiStart,
    monthEnd: kpiEnd,
    endOfMonthInstant: currCloseInstant,
    now,
    isCurrentMonth,
  });
  const consolidatedHiredPrev = consolidateTerminalApplications(applications, 'HIRED', {
    monthStart: prevStart,
    monthEnd: prevEnd,
    endOfMonthInstant: prevCloseInstant,
    now,
    isCurrentMonth: false,
  });
  const consolidatedRejectedCurr = consolidateTerminalApplications(applications, 'REJECTED', {
    monthStart: kpiStart,
    monthEnd: kpiEnd,
    endOfMonthInstant: currCloseInstant,
    now,
    isCurrentMonth,
  });
  const consolidatedRejectedPrev = consolidateTerminalApplications(applications, 'REJECTED', {
    monthStart: prevStart,
    monthEnd: prevEnd,
    endOfMonthInstant: prevCloseInstant,
    now,
    isCurrentMonth: false,
  });

  const hired = consolidatedHiredCurr.length;
  const prevHired = consolidatedHiredPrev.length;
  const appsById = new Map(applications.map((a) => [a.applicationId, a]));
  const rejectedDetail = rejectedTopClientFromConsolidated(appsById, consolidatedRejectedCurr);
  const prevRejectedTotal = consolidatedRejectedPrev.length;

  const [
    currRegistered,
    prevRegistered,
    enteredProcess,
    currCoverage,
    prevCoverage,
    declinedCurr,
    declinedPrev,
    dataQuality,
    activeSnapshot,
    activity,
  ] = await Promise.all([
    countCandidatesCreated(organizationId, kpiStart, kpiEnd),
    countCandidatesCreated(organizationId, prevStart, prevEnd),
    countDistinctCandidatesEnteredProcess(organizationId, kpiStart, kpiEnd),
    avgCoverageDaysForMonth(organizationId, kpiStart, kpiEnd, timeZone),
    avgCoverageDaysForMonth(organizationId, prevStart, prevEnd, timeZone),
    countDeclinedApplicationsForMonth(organizationId, kpiStart, kpiEnd),
    countDeclinedApplicationsForMonth(organizationId, prevStart, prevEnd),
    loadRecruitmentMetricsDataQuality(organizationId),
    activeVacanciesAtMonthEnd(organizationId, endOfMonth, timeZone),
    // Calendario: mes civil completo seleccionado (no MTD).
    dailyActivity(
      organizationId,
      year,
      month,
      fullRange.start,
      fullRange.end,
      timeZone,
      consolidatedTerminalForPeriod(applications, 'HIRED', {
        year,
        month,
        monthStart: fullRange.start,
        monthEnd: fullRange.end,
        endOfMonthInstant: endOfMonth,
        timeZone,
        now,
      }),
    ),
  ]);

  // Promedio diario: misma base de días en MTD; días del mes en FULL_MONTH.
  let daysForAvgCurr = daysInMonth;
  let daysForAvgPrev = prevFull.daysInMonth;
  if (comparisonMode === 'MONTH_TO_DATE') {
    const dayNum = Number(localDateKey(now, timeZone).slice(8, 10)) || 1;
    daysForAvgCurr = Math.max(1, dayNum);
    daysForAvgPrev = daysForAvgCurr;
  }
  const currDailyAvg = round1(currRegistered / daysForAvgCurr);
  const prevDailyAvg = round1(prevRegistered / daysForAvgPrev);
  const deltaDailyAvg = round1(currDailyAvg - prevDailyAvg);
  const currCoverageValue = currCoverage.value;
  const prevCoverageValue = prevCoverage.value;

  const rawInsights = buildInsights({
    currRegistered,
    prevRegistered,
    prevMonthLabel: compareLabel,
    rejectedTop: rejectedDetail.topClient,
    rejectedTotal: rejectedDetail.total,
    currCoverage: currCoverageValue,
    prevCoverage: prevCoverageValue,
  });

  /** Participación entre cierres del periodo comparable. No es tasa de funnel. */
  const terminalClosures = buildTerminalClosureShares({
    hired,
    rejected: rejectedDetail.total,
    declined: declinedCurr.total,
  });
  const terminalClosuresPrev = buildTerminalClosureShares({
    hired: prevHired,
    rejected: prevRejectedTotal,
    declined: declinedPrev.total,
  });

  const trend = buildMonthlyTrend({
    comparisonMode,
    comparisonLabel: labels.comparisonLabel,
    compareLabelShort: compareLabel,
    registrations: { current: currRegistered, previous: prevRegistered },
    hired: { current: hired, previous: prevHired },
    rejectionShare: {
      current: terminalClosures.rejectionShare,
      previous: terminalClosuresPrev.rejectionShare,
      currentDecisions: terminalClosures.terminalDecisions,
      previousDecisions: terminalClosuresPrev.terminalDecisions,
    },
    coverage: {
      current: currCoverageValue,
      previous: prevCoverageValue,
      currentSampleSize: currCoverage.sampleSize,
      previousSampleSize: prevCoverage.sampleSize,
    },
  });

  const insights = filterDuplicateInsights(rawInsights, trend);

  return {
    period: {
      year,
      month,
      label: formatMonthLabel(year, month),
      previousMonthLabel: prevMonthLabel,
      footerLabel: formatPeriodFooter(fromKey, toKey, year, month),
      daysInMonth,
      timeZone,
      /** FULL_MONTH | MONTH_TO_DATE | INSUFFICIENT — misma ventana para KPIs MoM y tendencia. */
      comparisonMode,
      comparisonLabel: labels.comparisonLabel,
    },
    kpis: {
      candidatesRegistered: {
        total: currRegistered,
        dailyAverage: currDailyAvg,
        deltaDailyAverage: deltaDailyAvg,
        compareLabel,
      },
      enteredProcess: { total: enteredProcess },
      hired: {
        total: hired,
        deltaVsPrevious: hired - prevHired,
        compareLabel,
      },
      rejected: {
        total: rejectedDetail.total,
        topClient: rejectedDetail.topClient,
        /** Total del periodo comparable (no necesariamente el mes civil completo). */
        previousTotal: prevRejectedTotal,
        compareLabel,
      },
      declined: {
        total: declinedCurr.total,
        deltaVsPrevious: declinedCurr.total - declinedPrev.total,
        compareLabel,
        previousTotal: declinedPrev.total,
      },
      avgCoverageDays: {
        value: currCoverageValue,
        deltaVsPrevious:
          currCoverageValue != null && prevCoverageValue != null
            ? round1(currCoverageValue - prevCoverageValue)
            : null,
        compareLabel,
        /** Vacantes actualmente COVERED con coveredAt en el periodo comparable. */
        coverageDateSource: 'vacancy.coveredAt',
        sampleSize: currCoverage.sampleSize,
      },
      activeVacancies: {
        total: activeSnapshot.total,
        nearTargetCount: activeSnapshot.nearTargetCount,
      },
    },
    /**
     * Estado actual de la org (no atribuible al mes).
     * coveredVacanciesMissingCoveredAt: COVERED sin coveredAt (legado sin backfill).
     * declinedApplicationsMissingClosedAt: DECLINED sin closedAt.
     */
    dataQuality,
    /**
     * Participación entre cierres del periodo comparable (hired+rejected+declined).
     * Shares 0–1; null si terminalDecisions === 0.
     */
    terminalClosures,
    /** Insight principal de tendencia (servidor; la UI no recalcula). */
    trend,
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

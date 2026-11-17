/**
 * Tendencia mensual (Fase 2): señales auditable, pesos iguales, sin backfill.
 * comparisonMode: FULL_MONTH | MONTH_TO_DATE | INSUFFICIENT
 */
import { utcInstantFromLocalParts } from '../utils/timezoneLocalInstant.util.js';
import { localDateKey } from './remoteWorkSessionHistory.service.js';
import { localYearMonth } from './organizationTimezone.service.js';
import { isSelectedMonthCurrent } from './recruitmentMetricsTerminal.service.js';

function shiftMonth(year, month, delta) {
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

function daysInCalendarMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampDay(year, month, day) {
  return Math.min(day, daysInCalendarMonth(year, month));
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function round4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

/** Partes civiles locales (reloj de la organización). */
export function localDateTimeParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  let hour = Number(get('hour') ?? 0);
  if (hour === 24) hour = 0;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute') ?? 0),
    second: Number(get('second') ?? 0),
  };
}

/**
 * Instant UTC con la misma hora civil en (year, month), ajustando el día si no existe
 * (p. ej. 31 → último día válido del mes).
 */
export function sameLocalClockInMonth(parts, year, month, timeZone) {
  const day = clampDay(year, month, parts.day);
  const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const base = utcInstantFromLocalParts(dateKey, parts.hour, parts.minute, timeZone);
  // Aproxima segundos sin cambiar el minuto civil.
  return new Date(base.getTime() + Math.min(59, Math.max(0, parts.second)) * 1000);
}

export function formatTrendComparisonLabel(mode, prevYear, prevMonth) {
  const name = MONTH_NAMES_ES[prevMonth - 1];
  if (mode === 'MONTH_TO_DATE') {
    return {
      comparisonLabel: `vs. el mismo periodo de ${name}`,
      compareLabelShort: `mismo periodo de ${name}`,
      previousMonthLabel: name,
    };
  }
  if (mode === 'FULL_MONTH') {
    return {
      comparisonLabel: `vs. ${name} de ${prevYear}`,
      compareLabelShort: name,
      previousMonthLabel: name,
    };
  }
  return {
    comparisonLabel: null,
    compareLabelShort: name,
    previousMonthLabel: name,
  };
}

/**
 * Resuelve ventanas [start, end) para el mes seleccionado y el comparable.
 * @returns {{
 *   comparisonMode: 'FULL_MONTH'|'MONTH_TO_DATE'|'INSUFFICIENT',
 *   curr: { start: Date, end: Date },
 *   prev: { start: Date, end: Date, year: number, month: number },
 *   labels: object,
 * }}
 */
export function resolveTrendComparisonWindows({
  year,
  month,
  timeZone,
  now = new Date(),
  getLocalMonthRange,
}) {
  const prev = shiftMonth(year, month, -1);
  const labelsBase = formatTrendComparisonLabel('FULL_MONTH', prev.year, prev.month);
  const currYm = localYearMonth(now, timeZone);
  const selectedKey = year * 12 + month;
  const nowKey = currYm.year * 12 + currYm.month;

  if (selectedKey > nowKey) {
    const full = getLocalMonthRange(year, month, timeZone);
    const prevFull = getLocalMonthRange(prev.year, prev.month, timeZone);
    return {
      comparisonMode: 'INSUFFICIENT',
      curr: { start: full.start, end: full.end },
      prev: { start: prevFull.start, end: prevFull.end, year: prev.year, month: prev.month },
      labels: formatTrendComparisonLabel('INSUFFICIENT', prev.year, prev.month),
      isCurrentMonth: false,
      isFutureMonth: true,
    };
  }

  const full = getLocalMonthRange(year, month, timeZone);
  const prevFull = getLocalMonthRange(prev.year, prev.month, timeZone);

  if (isSelectedMonthCurrent(year, month, timeZone, now)) {
    const parts = localDateTimeParts(now, timeZone);
    const prevEnd = sameLocalClockInMonth(parts, prev.year, prev.month, timeZone);
    return {
      comparisonMode: 'MONTH_TO_DATE',
      curr: { start: full.start, end: new Date(now) },
      prev: { start: prevFull.start, end: prevEnd, year: prev.year, month: prev.month },
      labels: formatTrendComparisonLabel('MONTH_TO_DATE', prev.year, prev.month),
      isCurrentMonth: true,
      isFutureMonth: false,
    };
  }

  return {
    comparisonMode: 'FULL_MONTH',
    curr: { start: full.start, end: full.end },
    prev: { start: prevFull.start, end: prevFull.end, year: prev.year, month: prev.month },
    labels: labelsBase,
    isCurrentMonth: false,
    isFutureMonth: false,
  };
}

/**
 * Variación relativa para bases no negativas (registros, contrataciones, días de cobertura).
 * relativeDelta = (current - previous) / Math.max(previous, 1)
 * Evita división entre cero, Infinity y NaN; no usa el valor actual como denominador.
 */
export function relativeDelta(current, previous) {
  const c = Number(current);
  const p = Number(previous);
  const curr = Number.isFinite(c) ? c : 0;
  const prev = Number.isFinite(p) ? p : 0;
  return (curr - prev) / Math.max(prev, 1);
}

/** Cambio significativo solo si se cumplen umbral absoluto y relativo a la vez. */
export function isSignificantChange(current, previous, minAbs, minRel = 0.1) {
  const c = Number(current);
  const p = Number(previous);
  const curr = Number.isFinite(c) ? c : 0;
  const prev = Number.isFinite(p) ? p : 0;
  const delta = curr - prev;
  if (!Number.isFinite(delta)) return false;
  return Math.abs(delta) >= minAbs && Math.abs(relativeDelta(curr, prev)) >= minRel;
}

/**
 * @returns {{ score: 1|0|-1|null, direction: 'up'|'down'|'stable'|'none', eligible: boolean, ineligibleReason: string|null }}
 */
export function evaluateCountSignal({
  key,
  label,
  current,
  previous,
  minAbs,
  minCombinedForEligibility = null,
  requireEitherSide = false,
  positiveWhenHigher = true,
}) {
  const curr = Number(current) || 0;
  const prev = Number(previous) || 0;
  const delta = curr - prev;
  const rel = relativeDelta(curr, prev);

  let eligible = true;
  let ineligibleReason = null;
  if (minCombinedForEligibility != null && curr + prev < minCombinedForEligibility) {
    eligible = false;
    ineligibleReason = `Se requieren al menos ${minCombinedForEligibility} observaciones combinadas.`;
  } else if (requireEitherSide && curr === 0 && prev === 0) {
    eligible = false;
    ineligibleReason = 'Sin actividad en ambos periodos.';
  }

  if (!eligible) {
    return {
      key,
      label,
      current: curr,
      previous: prev,
      delta,
      relativeDelta: rel,
      direction: 'none',
      score: null,
      eligible: false,
      ineligibleReason,
      significant: false,
    };
  }

  const significant = isSignificantChange(curr, prev, minAbs, 0.1);
  if (!significant) {
    return {
      key,
      label,
      current: curr,
      previous: prev,
      delta,
      relativeDelta: rel,
      direction: 'stable',
      score: 0,
      eligible: true,
      ineligibleReason: null,
      significant: false,
    };
  }

  const higherIsPositive = positiveWhenHigher;
  const improved = higherIsPositive ? delta > 0 : delta < 0;
  return {
    key,
    label,
    current: curr,
    previous: prev,
    delta,
    relativeDelta: rel,
    direction: improved ? 'up' : 'down',
    score: improved ? 1 : -1,
    eligible: true,
    ineligibleReason: null,
    significant: true,
  };
}

export function evaluateRejectionShareSignal(currShare, prevShare, currDecisions, prevDecisions) {
  const key = 'rejectionShare';
  const label = 'Participación de rechazos';
  const eligible = currDecisions >= 5 && prevDecisions >= 5;
  if (!eligible) {
    return {
      key,
      label,
      current: currShare,
      previous: prevShare,
      delta: currShare != null && prevShare != null ? round4(currShare - prevShare) : null,
      direction: 'none',
      score: null,
      eligible: false,
      ineligibleReason: 'Se requieren al menos 5 decisiones terminales en cada periodo.',
      significant: false,
      currentDecisions: currDecisions,
      previousDecisions: prevDecisions,
    };
  }
  const delta = round4((Number(currShare) || 0) - (Number(prevShare) || 0));
  const points = Math.abs(delta) * 100;
  if (points < 8) {
    return {
      key,
      label,
      current: currShare,
      previous: prevShare,
      delta,
      direction: 'stable',
      score: 0,
      eligible: true,
      ineligibleReason: null,
      significant: false,
      currentDecisions: currDecisions,
      previousDecisions: prevDecisions,
    };
  }
  // Menor participación de rechazos → positivo
  const improved = delta < 0;
  return {
    key,
    label,
    current: currShare,
    previous: prevShare,
    delta,
    direction: improved ? 'up' : 'down',
    score: improved ? 1 : -1,
    eligible: true,
    ineligibleReason: null,
    significant: true,
    currentDecisions: currDecisions,
    previousDecisions: prevDecisions,
  };
}

export function evaluateCoverageSignal(currValue, prevValue, currSample, prevSample) {
  const key = 'coverageDays';
  const label = 'Tiempo promedio de cobertura';
  const cSample = Number(currSample) || 0;
  const pSample = Number(prevSample) || 0;
  if (cSample < 2 || pSample < 2) {
    return {
      key,
      label,
      current: currValue,
      previous: prevValue,
      delta: null,
      direction: 'none',
      score: null,
      eligible: false,
      ineligibleReason: 'No hubo suficientes vacantes cubiertas para comparar tiempos.',
      significant: false,
      currentSampleSize: cSample,
      previousSampleSize: pSample,
    };
  }
  if (currValue == null || prevValue == null || currValue < 0 || prevValue < 0) {
    return {
      key,
      label,
      current: currValue,
      previous: prevValue,
      delta: null,
      direction: 'none',
      score: null,
      eligible: false,
      ineligibleReason: 'Valores de cobertura no válidos.',
      significant: false,
      currentSampleSize: cSample,
      previousSampleSize: pSample,
    };
  }
  // Delta matemático real (actual − anterior); la dirección invierte el juicio (menos días = mejora).
  const delta = round1(currValue - prevValue);
  const rel = relativeDelta(currValue, prevValue);
  const significant = isSignificantChange(currValue, prevValue, 1, 0.1);
  if (!significant) {
    return {
      key,
      label,
      current: currValue,
      previous: prevValue,
      delta,
      relativeDelta: rel,
      direction: 'stable',
      score: 0,
      eligible: true,
      ineligibleReason: null,
      significant: false,
      currentSampleSize: cSample,
      previousSampleSize: pSample,
    };
  }
  // Menos días → positivo (solo invierte el score; delta permanece curr − prev).
  const improved = delta < 0;
  return {
    key,
    label,
    current: currValue,
    previous: prevValue,
    delta,
    relativeDelta: rel,
    direction: improved ? 'up' : 'down',
    score: improved ? 1 : -1,
    eligible: true,
    ineligibleReason: null,
    significant: true,
    currentSampleSize: cSample,
    previousSampleSize: pSample,
  };
}

const REASON_PRIORITY = ['hired', 'rejectionShare', 'coverageDays', 'registrations'];

export function reasonForSignal(signal) {
  if (!signal) return null;
  if (!signal.eligible) {
    if (signal.key === 'coverageDays') {
      return {
        key: signal.key,
        text: 'No hubo suficientes vacantes cubiertas para comparar tiempos.',
        polarity: 'neutral',
      };
    }
    if (signal.key === 'rejectionShare') {
      return {
        key: signal.key,
        text: 'No hubo suficientes decisiones terminales para comparar rechazos.',
        polarity: 'neutral',
      };
    }
    if (signal.key === 'registrations') {
      return {
        key: signal.key,
        text: 'No hubo suficientes registros para comparar volúmenes.',
        polarity: 'neutral',
      };
    }
    if (signal.key === 'hired') {
      return {
        key: signal.key,
        text: 'No hubo contrataciones comparables en ambos periodos.',
        polarity: 'neutral',
      };
    }
    return {
      key: signal.key,
      text: signal.ineligibleReason || 'Señal no elegible.',
      polarity: 'neutral',
    };
  }
  if (signal.score === 0) {
    const stable = {
      registrations: 'El volumen de registros se mantuvo estable.',
      hired: 'Las contrataciones se mantuvieron estables.',
      rejectionShare: 'La participación de rechazos se mantuvo estable.',
      coverageDays: 'El tiempo de cobertura se mantuvo estable.',
    };
    return { key: signal.key, text: stable[signal.key] || 'La señal se mantuvo estable.', polarity: 'neutral' };
  }
  if (signal.key === 'registrations') {
    return {
      key: signal.key,
      text: signal.score > 0 ? 'Aumentaron los registros.' : 'Disminuyeron los registros.',
      polarity: signal.score > 0 ? 'positive' : 'negative',
    };
  }
  if (signal.key === 'hired') {
    return {
      key: signal.key,
      text: signal.score > 0 ? 'Aumentaron las contrataciones.' : 'Disminuyeron las contrataciones.',
      polarity: signal.score > 0 ? 'positive' : 'negative',
    };
  }
  if (signal.key === 'rejectionShare') {
    return {
      key: signal.key,
      text:
        signal.score > 0
          ? 'Disminuyó la participación de rechazos.'
          : 'Aumentó la participación de rechazos.',
      polarity: signal.score > 0 ? 'positive' : 'negative',
    };
  }
  if (signal.key === 'coverageDays') {
    return {
      key: signal.key,
      text: signal.score > 0 ? 'El tiempo de cobertura disminuyó.' : 'El tiempo de cobertura aumentó.',
      polarity: signal.score > 0 ? 'positive' : 'negative',
    };
  }
  return null;
}

/**
 * eligibleSignals cuenta únicamente scores no nulos (1|0|-1).
 * null = no elegible y no entra al cómputo.
 */
export function classifyTrendScore(scores) {
  const eligibleScores = (scores || []).filter((s) => s != null);
  const eligibleSignals = eligibleScores.length;
  const score = eligibleScores.reduce((a, b) => a + b, 0);
  if (eligibleSignals < 2) {
    return { status: 'INSUFFICIENT', score, eligibleSignals };
  }
  if (score >= 2) return { status: 'UP', score, eligibleSignals };
  if (score <= -2) return { status: 'DOWN', score, eligibleSignals };
  return { status: 'STABLE', score, eligibleSignals };
}

/**
 * primaryReasons honestas: no contradicen status.
 * Prioridad de señales: Contrataciones → Rechazos → Cobertura → Registros.
 */
export function selectPrimaryReasons(status, signals, reasons) {
  const byPriority = (list) =>
    [...list].sort(
      (a, b) => REASON_PRIORITY.indexOf(a.key) - REASON_PRIORITY.indexOf(b.key),
    );

  const reasonOf = (key) => reasons.find((r) => r.key === key);
  const signalOf = (key) => signals.find((s) => s.key === key);

  const positives = byPriority(
    reasons.filter((r) => {
      const s = signalOf(r.key);
      return s?.eligible && s.score === 1;
    }),
  );
  const negatives = byPriority(
    reasons.filter((r) => {
      const s = signalOf(r.key);
      return s?.eligible && s.score === -1;
    }),
  );
  const stables = byPriority(
    reasons.filter((r) => {
      const s = signalOf(r.key);
      return s?.eligible && s.score === 0;
    }),
  );
  const ineligibles = byPriority(
    reasons.filter((r) => {
      const s = signalOf(r.key);
      return s && !s.eligible;
    }),
  );

  if (status === 'INSUFFICIENT') {
    const out = ineligibles.slice(0, 2);
    if (!out.length) {
      out.push({
        key: 'insufficient',
        text: 'No hay al menos dos señales comparables para este mes.',
        polarity: 'neutral',
      });
    } else if (out.length === 1 && ineligibles.length === 1) {
      out.push({
        key: 'insufficient',
        text: 'No hay al menos dos señales comparables para este mes.',
        polarity: 'neutral',
      });
    }
    return out.slice(0, 2);
  }

  if (status === 'UP') {
    const out = [];
    if (positives[0]) out.push(positives[0]);
    const second = positives[1] || negatives[0] || stables[0];
    if (second) out.push(second);
    return out.slice(0, 2);
  }

  if (status === 'DOWN') {
    const out = [];
    if (negatives[0]) out.push(negatives[0]);
    const second = negatives[1] || stables[0];
    if (second) out.push(second);
    return out.slice(0, 2);
  }

  // STABLE
  if (positives.length && negatives.length) {
    return [positives[0], negatives[0]].filter(Boolean);
  }
  if (!positives.length && !negatives.length) {
    return [
      {
        key: 'stable_all',
        text: 'Los principales indicadores se mantuvieron dentro del rango esperado.',
        polarity: 'neutral',
      },
    ];
  }
  return [...positives, ...negatives, ...stables].slice(0, 2);
}

export function statusPresentation(status) {
  if (status === 'UP') {
    return { title: 'Tendencia al alza', tone: 'green', icon: 'trendUp' };
  }
  if (status === 'DOWN') {
    return { title: 'Tendencia a la baja', tone: 'coral', icon: 'trendDown' };
  }
  if (status === 'STABLE') {
    return { title: 'Tendencia estable', tone: 'blue', icon: 'trendFlat' };
  }
  return { title: 'Datos insuficientes', tone: 'slate', icon: 'trendInfo' };
}

/**
 * Construye el contrato de tendencia a partir de agregados ya calculados.
 */
export function buildMonthlyTrend({
  comparisonMode,
  comparisonLabel,
  compareLabelShort,
  registrations,
  hired,
  rejectionShare,
  coverage,
}) {
  if (comparisonMode === 'INSUFFICIENT') {
    const presentation = statusPresentation('INSUFFICIENT');
    return {
      status: 'INSUFFICIENT',
      score: 0,
      eligibleSignals: 0,
      comparisonMode,
      comparisonLabel,
      compareLabelShort,
      title: presentation.title,
      tone: presentation.tone,
      icon: presentation.icon,
      signals: [],
      reasons: [
        {
          key: 'future',
          text: 'El mes seleccionado aún no tiene un periodo comparable.',
          polarity: 'neutral',
        },
      ],
      primaryReasons: [
        {
          key: 'future',
          text: 'El mes seleccionado aún no tiene un periodo comparable.',
          polarity: 'neutral',
        },
      ],
    };
  }

  const signals = [
    evaluateCountSignal({
      key: 'registrations',
      label: 'Registros',
      current: registrations.current,
      previous: registrations.previous,
      minAbs: 2,
      minCombinedForEligibility: 5,
      positiveWhenHigher: true,
    }),
    evaluateCountSignal({
      key: 'hired',
      label: 'Contrataciones',
      current: hired.current,
      previous: hired.previous,
      minAbs: 1,
      requireEitherSide: true,
      positiveWhenHigher: true,
    }),
    evaluateRejectionShareSignal(
      rejectionShare.current,
      rejectionShare.previous,
      rejectionShare.currentDecisions,
      rejectionShare.previousDecisions,
    ),
    evaluateCoverageSignal(
      coverage.current,
      coverage.previous,
      coverage.currentSampleSize,
      coverage.previousSampleSize,
    ),
  ];

  const eligibleScores = signals.map((s) => (s.eligible ? s.score : null));
  const classified = classifyTrendScore(eligibleScores);
  const presentation = statusPresentation(classified.status);

  const reasons = [];
  for (const key of REASON_PRIORITY) {
    const signal = signals.find((s) => s.key === key);
    const reason = reasonForSignal(signal);
    if (reason) reasons.push(reason);
  }

  const primaryReasons = selectPrimaryReasons(classified.status, signals, reasons);

  return {
    status: classified.status,
    score: classified.score,
    eligibleSignals: classified.eligibleSignals,
    comparisonMode,
    comparisonLabel,
    compareLabelShort,
    title: presentation.title,
    tone: presentation.tone,
    icon: presentation.icon,
    signals,
    reasons,
    primaryReasons,
  };
}

const COMPLEMENTARY_INSIGHT_PRIORITY = [
  'rejections_client',
  'coverage_faster',
  'coverage_slower',
  'registrations_up',
  'registrations_down',
];

/**
 * Insights complementarios: oculta solo los que repiten una razón ya cubierta por la tendencia.
 * Máximo 2; no inventa insights. Prioriza cliente de rechazos y cobertura sobre registros.
 */
export function filterDuplicateInsights(insights, trend) {
  if (!Array.isArray(insights) || !insights.length) return [];
  if (!trend) return insights.slice(0, 2);

  // Mes futuro / sin periodo comparable: conservar insights operativos (máx. 2).
  if (trend.status === 'INSUFFICIENT' && trend.eligibleSignals === 0 && trend.comparisonMode === 'INSUFFICIENT') {
    return prioritizeComplementaryInsights(insights).slice(0, 2);
  }

  const skip = new Set();
  const reg = trend.signals?.find((s) => s.key === 'registrations');
  const cov = trend.signals?.find((s) => s.key === 'coverageDays');
  const primaryKeys = new Set((trend.primaryReasons || []).map((r) => r.key).filter(Boolean));

  if ((reg?.eligible && reg.score !== 0) || primaryKeys.has('registrations')) {
    skip.add('registrations_up');
    skip.add('registrations_down');
  }
  if ((cov?.eligible && cov.score !== 0) || primaryKeys.has('coverageDays')) {
    skip.add('coverage_faster');
    skip.add('coverage_slower');
  }

  const kept = insights.filter((ins) => !skip.has(ins.kind));
  return prioritizeComplementaryInsights(kept).slice(0, 2);
}

function prioritizeComplementaryInsights(insights) {
  return [...insights].sort((a, b) => {
    const ia = COMPLEMENTARY_INSIGHT_PRIORITY.indexOf(a.kind);
    const ib = COMPLEMENTARY_INSIGHT_PRIORITY.indexOf(b.kind);
    const ra = ia === -1 ? 99 : ia;
    const rb = ib === -1 ? 99 : ib;
    return ra - rb;
  });
}

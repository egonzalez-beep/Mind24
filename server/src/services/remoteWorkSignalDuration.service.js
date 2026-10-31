import { WEB_SIGNAL_NO_SIGNAL_THRESHOLD_MS, resolveCurrentWebSignal } from './timeclockWebSignal.service.js';

export function workedDurationSec(session, now = new Date()) {
  if (!session?.checkInAt) return null;
  const start = new Date(session.checkInAt).getTime();
  const end = session.checkOutAt ? new Date(session.checkOutAt).getTime() : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / 1000));
}

/** Máximo acreditable entre muestras (alineado a umbral «señal reciente»). */
export const SIGNAL_MAX_CREDIT_SEC = Math.floor(WEB_SIGNAL_NO_SIGNAL_THRESHOLD_MS / 1000);

/** Tolerancia: tracking iniciado en check-in vs tarde. */
export const SIGNAL_TRACKING_START_TOLERANCE_MS = 2000;

export const SIGNAL_TELEMETRY = {
  NO_DATA: 'no_data',
  PARTIAL: 'partial',
  FULL: 'full',
};

export const CONNECTION_VISUAL = {
  NONE: null,
  GREEN: 'green',
  AMBER: 'amber',
  CORAL: 'coral',
};

/**
 * @param {Date|string|number} from
 * @param {Date|string|number} to
 * @returns {number}
 */
export function creditSecondsBetween(from, to) {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const deltaSec = Math.floor((b - a) / 1000);
  if (deltaSec <= 0) return 0;
  return Math.min(deltaSec, SIGNAL_MAX_CREDIT_SEC);
}

/**
 * @param {import('@prisma/client').RemoteWorkSession} session
 */
export function isTrackingFromCheckIn(session) {
  if (!session?.checkInAt || !session.signalTrackingStartedAt) return false;
  const checkIn = new Date(session.checkInAt).getTime();
  const started = new Date(session.signalTrackingStartedAt).getTime();
  return Math.abs(started - checkIn) <= SIGNAL_TRACKING_START_TOLERANCE_MS;
}

/**
 * @param {import('@prisma/client').RemoteWorkSession} session
 * @returns {'no_data'|'partial'|'full'}
 */
export function resolveSignalTelemetryStatus(session) {
  const status = session?.signalTelemetryStatus;
  const samples = session?.signalSampleCount ?? 0;
  if (status === SIGNAL_TELEMETRY.NO_DATA || status == null) {
    return samples > 0 ? SIGNAL_TELEMETRY.PARTIAL : SIGNAL_TELEMETRY.NO_DATA;
  }
  if (status === SIGNAL_TELEMETRY.PARTIAL) return SIGNAL_TELEMETRY.PARTIAL;
  if (samples === 0 && status === SIGNAL_TELEMETRY.FULL && !session.signalTrackingStartedAt) {
    return SIGNAL_TELEMETRY.NO_DATA;
  }
  if (status === SIGNAL_TELEMETRY.FULL && !isTrackingFromCheckIn(session)) {
    return SIGNAL_TELEMETRY.PARTIAL;
  }
  return status === SIGNAL_TELEMETRY.FULL ? SIGNAL_TELEMETRY.FULL : SIGNAL_TELEMETRY.PARTIAL;
}

/**
 * @param {import('@prisma/client').RemoteWorkSession} session
 * @param {Date} now
 * @returns {boolean}
 */
/** Métricas oficiales de conexión: solo telemetría full con muestras y duración positiva. */
export function isOfficialFullSignalSession(session, now = new Date()) {
  if (resolveSignalTelemetryStatus(session) !== SIGNAL_TELEMETRY.FULL) return false;
  if ((session.signalSampleCount ?? 0) <= 0) return false;
  return (workedDurationSec(session, now) ?? 0) > 0;
}

export function sessionHasReliableSignalTelemetry(session, now = new Date()) {
  return isOfficialFullSignalSession(session, now);
}

/**
 * @param {import('@prisma/client').RemoteWorkSession} session
 * @param {Date} [now]
 * @returns {Date|null}
 */
export function signalCreditAnchor(session, now = new Date()) {
  if (session.signalLastCreditedAt) return new Date(session.signalLastCreditedAt);
  if (session.signalTrackingStartedAt) return new Date(session.signalTrackingStartedAt);
  if (session.checkInAt) return new Date(session.checkInAt);
  return null;
}

/**
 * @param {import('@prisma/client').RemoteWorkSession} session
 * @param {Date} at
 * @returns {number}
 */
export function computeCreditAt(session, at) {
  const anchor = signalCreditAnchor(session, at);
  if (!anchor) return 0;
  return creditSecondsBetween(anchor, at);
}

/**
 * @param {number} storedSec
 * @param {number} creditSec
 * @param {number} durationSec
 * @returns {number}
 */
export function capSignalDuration(storedSec, creditSec, durationSec) {
  const total = Math.max(0, (storedSec ?? 0) + Math.max(0, creditSec));
  if (durationSec == null || durationSec <= 0) return total;
  return Math.min(total, durationSec);
}

/** Tope de acumulación: jornada completa o ventana observada (partial). */
export function signalCapDurationSec(session, now = new Date()) {
  const telemetry = resolveSignalTelemetryStatus(session);
  if (telemetry === SIGNAL_TELEMETRY.PARTIAL && session.signalTrackingStartedAt) {
    return workedDurationSec(
      {
        ...session,
        checkInAt: session.signalTrackingStartedAt,
      },
      now,
    );
  }
  return workedDurationSec(session, now);
}

/**
 * Datos iniciales al check-in (telemetría completa desde entrada).
 * @param {Date} checkInAt
 */
export function signalTrackingFieldsAtCheckIn(checkInAt) {
  return {
    signalDurationSeconds: 0,
    signalSampleCount: 0,
    signalTrackingStartedAt: checkInAt,
    signalLastCreditedAt: null,
    signalTelemetryStatus: SIGNAL_TELEMETRY.FULL,
  };
}

/**
 * Activa telemetría parcial en sesión legacy abierta (sin acreditar desde check-in).
 * @param {Date} now
 */
export function signalTrackingFieldsLegacyPartialStart(now) {
  return {
    signalTelemetryStatus: SIGNAL_TELEMETRY.PARTIAL,
    signalTrackingStartedAt: now,
    signalLastCreditedAt: null,
  };
}

/**
 * @param {import('@prisma/client').RemoteWorkSession} session
 * @param {Date} now
 * @param {{ creditSec: number, newLastCreditedAt: Date|null, sampleIncrement: number }} credit
 */
export function buildSignalAccumulationUpdate(session, now, credit) {
  const durationSec = signalCapDurationSec(session, now);
  const nextDuration = capSignalDuration(
    session.signalDurationSeconds ?? 0,
    credit.creditSec,
    durationSec,
  );
  const nextSample = (session.signalSampleCount ?? 0) + (credit.sampleIncrement ?? 0);
  return {
    signalDurationSeconds: nextDuration,
    signalSampleCount: nextSample,
    signalLastCreditedAt: credit.newLastCreditedAt,
  };
}

/**
 * Acumula crédito en memoria (después de FOR UPDATE).
 * Ancla post-heartbeat: siempre serverNow (no ancla + crédito).
 * @returns {{ creditSec: number, patch: object, activationPatch: object|null }}
 */
export function planHeartbeatSignalCredit(session, now) {
  const durationSec = workedDurationSec(session, now);
  if (durationSec <= 0) {
    return { creditSec: 0, patch: {}, activationPatch: null };
  }

  let activationPatch = null;
  let working = session;

  if (
    (session.signalTelemetryStatus === SIGNAL_TELEMETRY.NO_DATA || session.signalTelemetryStatus == null) &&
    (session.signalSampleCount ?? 0) === 0 &&
    !session.signalTrackingStartedAt
  ) {
    activationPatch = signalTrackingFieldsLegacyPartialStart(now);
    working = { ...session, ...activationPatch };
  }

  const creditSec = computeCreditAt(working, now);
  const accumulation = buildSignalAccumulationUpdate(working, now, {
    creditSec,
    newLastCreditedAt: now,
    sampleIncrement: 1,
  });

  return {
    creditSec,
    patch: accumulation,
    activationPatch,
  };
}

/**
 * @param {import('@prisma/client').RemoteWorkSession} session
 * @param {Date} closeAt
 */
export function planCloseSignalCredit(session, closeAt) {
  if (session.checkOutAt) return { creditSec: 0, patch: {} };
  const durationSec = workedDurationSec({ ...session, checkOutAt: null }, closeAt);
  if (durationSec <= 0) return { creditSec: 0, patch: {} };

  if (
    resolveSignalTelemetryStatus(session) === SIGNAL_TELEMETRY.NO_DATA &&
    (session.signalSampleCount ?? 0) === 0
  ) {
    return { creditSec: 0, patch: {} };
  }

  const creditSec = computeCreditAt(session, closeAt);
  const accumulation = buildSignalAccumulationUpdate(session, closeAt, {
    creditSec,
    newLastCreditedAt: closeAt,
    sampleIncrement: 0,
  });
  return { creditSec, patch: accumulation };
}

/**
 * Segundos con señal para vista (incluye tramo pendiente en jornada abierta).
 * @param {import('@prisma/client').RemoteWorkSession} session
 * @param {Date} [now]
 * @returns {number|null}
 */
export function projectedSignalDurationSec(session, now = new Date()) {
  const telemetry = resolveSignalTelemetryStatus(session);
  if (telemetry === SIGNAL_TELEMETRY.NO_DATA && (session.signalSampleCount ?? 0) === 0) {
    return null;
  }
  if ((session.signalSampleCount ?? 0) === 0) {
    return null;
  }

  const stored = session.signalDurationSeconds ?? 0;
  const durationSec = workedDurationSec(session, now);
  if (session.checkOutAt) {
    return stored;
  }

  let pending = 0;
  const webSignal = resolveCurrentWebSignal(session, now);
  if (webSignal !== 'no_signal') {
    pending = computeCreditAt(session, now);
  }
  const capDuration = signalCapDurationSec(session, now);
  return capSignalDuration(stored, pending, capDuration ?? durationSec);
}

/**
 * @param {number|null} signalSec
 * @param {number|null} durationSec
 * @returns {number|null}
 */
export function connectionEffectivePercent(signalSec, durationSec) {
  if (signalSec == null || durationSec == null || durationSec <= 0) return null;
  const pct = (signalSec / durationSec) * 100;
  return Math.min(100, Math.max(0, Math.round(pct * 10) / 10));
}

/**
 * @param {number|null} effectivePct
 * @param {number|null} durationSec
 * @param {number|null} signalSec
 * @param {'no_data'|'partial'|'full'} telemetry
 * @returns {'green'|'amber'|'coral'|null}
 */
export function resolveConnectionVisualLevel(effectivePct, durationSec, signalSec, telemetry) {
  if (telemetry !== SIGNAL_TELEMETRY.FULL) return CONNECTION_VISUAL.NONE;
  if (effectivePct == null || durationSec == null || signalSec == null) return CONNECTION_VISUAL.NONE;

  const gapSec = Math.max(0, durationSec - signalSec);
  const gapHours = gapSec / 3600;

  let severity = 0;
  if (effectivePct < 60 || gapHours > 3) severity = Math.max(severity, 3);
  if ((effectivePct >= 60 && effectivePct < 80) || (gapHours > 2 && gapHours <= 3)) severity = Math.max(severity, 2);
  if (effectivePct >= 80 && gapHours <= 2) severity = Math.max(severity, 1);

  if (severity >= 3) return CONNECTION_VISUAL.CORAL;
  if (severity >= 2) return CONNECTION_VISUAL.AMBER;
  if (severity >= 1) return CONNECTION_VISUAL.GREEN;
  return CONNECTION_VISUAL.NONE;
}

/**
 * @param {import('@prisma/client').RemoteWorkSession} session
 * @param {Date} [now]
 * @param {{ expectedWorkMinutes?: number|null }} [opts]
 */
export function enrichSessionSignalMetrics(session, now = new Date(), opts = {}) {
  const durationSec = workedDurationSec(session, now);
  const telemetry = resolveSignalTelemetryStatus(session);
  const officialFull = isOfficialFullSignalSession(session, now);
  const hasAnySamples = (session.signalSampleCount ?? 0) > 0;
  const signalSec =
    telemetry === SIGNAL_TELEMETRY.NO_DATA && !hasAnySamples
      ? null
      : hasAnySamples
        ? projectedSignalDurationSec(session, now)
        : null;

  let effectivePct = null;
  let visualLevel = CONNECTION_VISUAL.NONE;
  let expectedCoveragePercent = null;

  if (officialFull) {
    effectivePct = connectionEffectivePercent(signalSec, durationSec);
    visualLevel = resolveConnectionVisualLevel(
      effectivePct,
      durationSec,
      signalSec,
      telemetry,
    );
    const expectedMin = opts.expectedWorkMinutes;
    if (expectedMin != null && expectedMin > 0 && signalSec != null) {
      const expectedSec = expectedMin * 60;
      expectedCoveragePercent = Math.min(100, Math.round((signalSec / expectedSec) * 1000) / 10);
    }
  }

  return {
    durationSec,
    signalDurationSeconds: signalSec,
    connectionEffectivePercent: effectivePct,
    lastSignalAt: session.lastHeartbeatAt ?? null,
    signalTelemetryStatus: telemetry,
    connectionVisualLevel: visualLevel,
    signalTrackingStartedAt: session.signalTrackingStartedAt ?? null,
    expectedCoveragePercent,
  };
}

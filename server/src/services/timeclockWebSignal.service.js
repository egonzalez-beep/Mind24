/** Señal web efectiva; NO_SIGNAL no cierra jornada ni implica inactividad laboral. */
export const WEB_SIGNAL_NO_SIGNAL_THRESHOLD_MS = 3 * 60 * 1000;

/**
 * @param {{ lastHeartbeatAt?: Date|null, lastWebSignal?: string, lastVisibilityState?: string|null, checkOutAt?: Date|null }|null} session
 * @param {Date} [now]
 * @returns {'connected'|'background'|'no_signal'}
 */
export function resolveCurrentWebSignal(session, now = new Date()) {
  if (!session || session.checkOutAt) {
    return 'no_signal';
  }
  const lastHb = session.lastHeartbeatAt ? new Date(session.lastHeartbeatAt) : null;
  if (!lastHb || now.getTime() - lastHb.getTime() >= WEB_SIGNAL_NO_SIGNAL_THRESHOLD_MS) {
    return 'no_signal';
  }
  const vis = session.lastVisibilityState;
  if (vis === 'hidden') {
    return 'background';
  }
  return 'connected';
}

/**
 * Señal inmediata tras heartbeat (sin aplicar umbral de NO_SIGNAL).
 * @param {'visible'|'hidden'|string} visibilityState
 */
export function webSignalFromVisibility(visibilityState) {
  return visibilityState === 'hidden' ? 'background' : 'connected';
}

export function webSignalLabel(signal) {
  switch (signal) {
    case 'connected':
      return 'CONNECTED';
    case 'background':
      return 'BACKGROUND';
    default:
      return 'NO_SIGNAL';
  }
}

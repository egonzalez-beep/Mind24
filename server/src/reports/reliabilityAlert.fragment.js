import { esc } from './reportUtils.js';
import { resolveModuleKey } from '../utils/moduleCatalog.js';
import {
  HONESTIDAD_SPEED_REVIEW_MESSAGE,
  UNRELIABLE_SPEED_FLAG_TEXT,
} from '../services/attemptReliability.service.js';

export function extractReliabilityFromAttempt(attempt) {
  const scores = attempt?.scores;
  const inner = scores?.scores && typeof scores.scores === 'object' ? scores.scores : scores;
  const meta = inner?.meta && typeof inner.meta === 'object' ? inner.meta : null;
  if (meta?.reliability && typeof meta.reliability === 'object') {
    return meta.reliability;
  }
  const flags = Array.isArray(attempt?.flags) ? attempt.flags : [];
  const hit = flags.some((f) => String(f).includes('ALERTA DE CONFIABILIDAD'));
  if (hit) return { isUnreliableSpeed: true };
  return { isUnreliableSpeed: false };
}

export function buildSpeedReliabilityAlertHtml(attempt) {
  const moduleKey = resolveModuleKey(attempt?.moduleKey);
  const rel = extractReliabilityFromAttempt(attempt);

  if (moduleKey === 'honestidad') {
    const level = rel?.speedReliability;
    if (level === 'review') {
      return `<div class="reliability-alert">${esc(HONESTIDAD_SPEED_REVIEW_MESSAGE)}</div>`;
    }
    return '';
  }

  if (!rel?.isUnreliableSpeed) return '';
  return `<div class="reliability-alert">${esc(UNRELIABLE_SPEED_FLAG_TEXT)}</div>`;
}

import { esc } from './reportUtils.js';
import { resolveModuleKey } from '../utils/moduleCatalog.js';
import {
  HONESTIDAD_CALIBRATION_LOW_RELIABILITY_TEMPLATE,
  HONESTIDAD_SPEED_REVIEW_MESSAGE,
  honestidadCalibrationReviewMessage,
  UNRELIABLE_SPEED_FLAG_TEXT,
} from '../services/attemptReliability.service.js';

function applyReliabilityTemplate(tpl, vars) {
  if (!tpl) return '';
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
}

export function extractReliabilityFromAttempt(attempt) {
  const scores = attempt?.scores;
  const inner = scores?.scores && typeof scores.scores === 'object' ? scores.scores : scores;
  const meta = inner?.meta && typeof inner.meta === 'object' ? inner.meta : null;
  if (meta) {
    return {
      ...(meta.reliability && typeof meta.reliability === 'object' ? meta.reliability : {}),
      calibrationReliability: meta.calibrationReliability ?? meta.reliability?.calibrationReliability,
      speedReliability: meta.speedReliability ?? meta.reliability?.speedReliability,
      errCal: meta.errCal ?? meta.reliability?.errCal,
    };
  }
  const flags = Array.isArray(attempt?.flags) ? attempt.flags : [];
  const hit = flags.some((f) => String(f).includes('ALERTA DE CONFIABILIDAD'));
  if (hit) return { isUnreliableSpeed: true };
  return { isUnreliableSpeed: false };
}

export function buildHonestidadReliabilityAlertsHtml(attempt) {
  const rel = extractReliabilityFromAttempt(attempt);
  let html = '';
  if (rel?.calibrationReliability === 'review') {
    const errCal = Number(rel.errCal) || 2;
    html += `<div class="reliability-alert">${esc(honestidadCalibrationReviewMessage(errCal))}</div>`;
  } else if (rel?.calibrationReliability === 'low_reliability') {
    const errCal = Number(rel.errCal) || 3;
    const msg = applyReliabilityTemplate(HONESTIDAD_CALIBRATION_LOW_RELIABILITY_TEMPLATE, { errCal });
    html += `<div class="reliability-alert">${esc(msg)}</div>`;
  }
  html += buildSpeedReliabilityAlertHtml(attempt);
  return html;
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

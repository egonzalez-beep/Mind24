/**
 * Registro de constructores de fragmentos HTML por módulo.
 * Para agregar un módulo: exportar builder y registrarlo en MODULE_FRAGMENT_REGISTRY.
 */
import { resolveModuleKey, moduleMetaForKey } from '../utils/moduleCatalog.js';
import { fmtDateMx } from './reportUtils.js';
import {
  buildCleaverModuleFragment,
  extractCleaverScores,
} from './cleaverReport.fragment.js';
import {
  buildHonestidadModuleFragment,
  extractHonestidadPayload,
} from './honestidadReport.fragment.js';
import { buildGenericModuleFragment } from './genericModule.fragment.js';
import {
  buildSjtSalesModuleFragment,
  extractSjtSalesScores,
} from './fragments/sjtSalesReport.fragment.js';
import {
  buildTermanModuleFragment,
  extractTermanScores,
} from './fragments/termanReport.fragment.js';
import { buildSpeedReliabilityAlertHtml } from './reliabilityAlert.fragment.js';

const CLEAVER_KEYS = new Set(['cleaver', 'disc']);

/**
 * @param {import('@prisma/client').AssessmentAttempt} attempt
 * @returns {string|null}
 */
export function buildModuleFragment(attempt) {
  const moduleKey = resolveModuleKey(attempt.moduleKey);
  const submittedAt = fmtDateMx(attempt.submittedAt);
  const reliabilityHtml = buildSpeedReliabilityAlertHtml(attempt);

  if (CLEAVER_KEYS.has(moduleKey)) {
    const scores = extractCleaverScores(attempt);
    if (!scores) return null;
    return reliabilityHtml + buildCleaverModuleFragment({ scores, submittedAt });
  }

  if (moduleKey === 'honestidad') {
    const payload = extractHonestidadPayload(attempt);
    if (!payload) return null;
    return reliabilityHtml + buildHonestidadModuleFragment({ payload, submittedAt });
  }

  if (moduleKey === 'terman') {
    const scores = extractTermanScores(attempt);
    if (!scores) return null;
    return reliabilityHtml + buildTermanModuleFragment({ scores, submittedAt });
  }

  if (moduleKey === 'sales_sjt') {
    const scores = extractSjtSalesScores(attempt);
    if (!scores) return null;
    return reliabilityHtml + buildSjtSalesModuleFragment({ scores, submittedAt });
  }

  if (attempt.status !== 'submitted') return null;
  const meta = moduleMetaForKey(moduleKey);
  return buildGenericModuleFragment({
    moduleLabel: meta.label,
    moduleIcon: meta.icon,
    attempt,
  });
}

/** Orden estable de módulos según selectedModules de la asignación. */
export function orderAttemptsBySelection(attempts, selectedModuleKeys) {
  const byKey = new Map();
  for (const att of attempts) {
    const rk = resolveModuleKey(att.moduleKey);
    if (att.status !== 'submitted') continue;
    if (!byKey.has(rk)) byKey.set(rk, att);
  }

  const ordered = [];
  const seen = new Set();
  for (const key of selectedModuleKeys) {
    const rk = resolveModuleKey(key);
    if (seen.has(rk)) continue;
    seen.add(rk);
    const att = byKey.get(rk);
    if (att) ordered.push(att);
  }
  for (const [rk, att] of byKey) {
    if (!seen.has(rk)) ordered.push(att);
  }
  return ordered;
}

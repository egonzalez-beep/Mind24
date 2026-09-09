import { TERMAN_MAX_RAW_SCORE } from '../data/termanData.js';
import { SJT_SALES_MAX_POINTS } from '../data/sjtSalesData.js';
import { moduleReportLabel, resolveModuleKey } from '../utils/moduleCatalog.js';
import { resolveSjtSalesProfile } from '../services/sjtSalesScoring.service.js';
import {
  cleaverProfileSynthesis,
  extractCleaverScores,
} from './cleaverReport.fragment.js';
import { extractHonestidadPayload } from './honestidadReport.fragment.js';
import { extractSjtSalesScores } from './fragments/sjtSalesReport.fragment.js';
import { extractTermanScores } from './fragments/termanReport.fragment.js';
import { formatTermanCompletenessText } from '../services/termanScoring.service.js';

const CLEAVER_KEYS = new Set(['cleaver', 'disc']);

/**
 * @typedef {{ label: string, value: string }} CoverKpiLine
 * @typedef {{ moduleKey: string, title: string, lines: CoverKpiLine[] }} ModuleCoverSummary
 */

function line(label, value) {
  return { label, value: String(value ?? '—') };
}

function summaryHonestidad(attempt) {
  const payload = extractHonestidadPayload(attempt);
  if (!payload) return null;
  const verdict = attempt?.interpretation?.verdict || payload.interpretation?.verdict || '—';
  return {
    moduleKey: 'honestidad',
    title: moduleReportLabel('honestidad'),
    lines: [
      line('Índice global', `${Number(payload.global).toFixed(1)}%`),
      line('Veredicto', verdict),
    ],
  };
}

function summaryCleaver(attempt) {
  const scores = extractCleaverScores(attempt);
  if (!scores) return null;
  const synth = cleaverProfileSynthesis(scores.total);
  return {
    moduleKey: 'cleaver',
    title: moduleReportLabel('cleaver'),
    lines: [
      line('Perfil predominante', synth.key),
      line('Dimensión DISC', synth.label),
    ],
  };
}

function summaryTerman(attempt) {
  const scores = extractTermanScores(attempt);
  if (!scores) return null;
  const total = Number(scores.totalQuestions) || TERMAN_MAX_RAW_SCORE;
  const raw = Number(scores.rawScore) || 0;
  const pct = Number(scores.percentCorrect) || 0;
  const lines = [
    line('Puntaje bruto', `${raw} / ${total}`),
    line('% aciertos', `${pct.toFixed(1)}%`),
  ];
  const completionRate = Number(scores.completionRate);
  if (
    Number.isFinite(completionRate) &&
    completionRate < 100 &&
    scores.answeredCount != null
  ) {
    lines.push(line('Completitud', formatTermanCompletenessText(scores)));
  }
  return {
    moduleKey: 'terman',
    title: moduleReportLabel('terman'),
    lines,
  };
}

function summarySjt(attempt) {
  const scores = extractSjtSalesScores(attempt);
  if (!scores) return null;
  const raw = Number(scores.rawScore) || 0;
  const max = Number(scores.maxPossible) || SJT_SALES_MAX_POINTS;
  let profileLabel = scores.profileLabel;
  if (!profileLabel && scores.rawScore != null) {
    profileLabel = resolveSjtSalesProfile(scores.rawScore).label;
  }
  return {
    moduleKey: 'sales_sjt',
    title: moduleReportLabel('sales_sjt'),
    lines: [
      line('Puntaje', `${raw} / ${max}`),
      line('Perfil comercial', profileLabel || '—'),
    ],
  };
}

function summaryGeneric(attempt, moduleKey) {
  const raw = attempt?.scores;
  const global =
    raw && typeof raw === 'object' && raw.global != null
      ? `${Number(raw.global).toFixed(1)}%`
      : null;
  return {
    moduleKey,
    title: moduleReportLabel(moduleKey),
    lines: global ? [line('Resultado global', global)] : [line('Estado', 'Completado')],
  };
}

/**
 * Resúmenes factuales por módulo para la portada (sin interpretación transversal).
 * @param {import('@prisma/client').AssessmentAttempt[]} orderedAttempts
 * @returns {ModuleCoverSummary[]}
 */
export function buildModuleCoverSummaries(orderedAttempts) {
  const out = [];
  for (const attempt of orderedAttempts || []) {
    const moduleKey = resolveModuleKey(attempt.moduleKey);
    let summary = null;
    if (moduleKey === 'honestidad') summary = summaryHonestidad(attempt);
    else if (CLEAVER_KEYS.has(moduleKey)) summary = summaryCleaver(attempt);
    else if (moduleKey === 'terman') summary = summaryTerman(attempt);
    else if (moduleKey === 'sales_sjt') summary = summarySjt(attempt);
    else if (attempt.status === 'submitted') summary = summaryGeneric(attempt, moduleKey);
    if (summary) out.push(summary);
  }
  return out;
}

/** Clase CSS del grid según cantidad de tarjetas. */
export function coverSummaryGridClass(count) {
  if (count <= 1) return 'summary-grid summary-grid--1';
  if (count === 2) return 'summary-grid summary-grid--2';
  return 'summary-grid summary-grid--multi';
}

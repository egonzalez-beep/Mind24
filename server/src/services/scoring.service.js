import { z } from 'zod';

/** Respuestas enviadas al cerrar intento: questionId -> índice de opción */
export const submitAnswersSchema = z.record(z.string(), z.number().int().min(0));

function* iterateQuestions(config) {
  for (const sec of config.sections || []) {
    for (const q of sec.questions || []) {
      yield { section: sec, question: q };
    }
  }
}

export function collectQuestionMeta(config) {
  const list = [];
  for (const { question: q } of iterateQuestions(config)) {
    list.push({
      id: q.id,
      kind: q.kind,
      optionCount: Array.isArray(q.options) ? q.options.length : 0,
    });
  }
  return list;
}

export function assertCompleteAnswers(config, answers) {
  const meta = collectQuestionMeta(config);
  const missing = [];
  for (const m of meta) {
    if (answers[m.id] === undefined || answers[m.id] === null) missing.push(m.id);
  }
  if (missing.length) {
    const err = new Error('INCOMPLETE_ANSWERS');
    err.code = 'INCOMPLETE_ANSWERS';
    err.details = { missing };
    throw err;
  }
  for (const m of meta) {
    const idx = answers[m.id];
    if (!Number.isInteger(idx) || idx < 0 || idx >= m.optionCount) {
      const err = new Error('INVALID_OPTION_INDEX');
      err.code = 'INVALID_OPTION_INDEX';
      err.details = { questionId: m.id, idx };
      throw err;
    }
  }
}

export function sanitizeConfigForClient(config) {
  const clone = structuredClone(config);
  for (const sec of clone.sections || []) {
    for (const q of sec.questions || []) {
      if (q.kind === 'calibration') delete q.correctIndex;
      delete q.scoreByIndex;
      delete q.denialOptionIndex;
    }
  }
  delete clone.scoring;
  return clone;
}

function dimensionAverages(config, answers) {
  const dims = config.dimensions || [];
  const out = {};
  for (const d of dims) {
    let sum = 0;
    let cnt = 0;
    for (const qid of d.questionIds || []) {
      const q = findQuestion(config, qid);
      if (!q || q.kind !== 'likert') continue;
      const idx = answers[qid];
      const row = Array.isArray(q.scoreByIndex) ? q.scoreByIndex : [];
      if (idx === undefined || row[idx] === undefined) continue;
      sum += row[idx];
      cnt++;
    }
    out[d.id] = { label: d.label, avg: cnt > 0 ? Math.round(sum / cnt) : 0, count: cnt };
  }
  return out;
}

function findQuestion(config, id) {
  for (const { question: q } of iterateQuestions(config)) {
    if (q.id === id) return q;
  }
  return null;
}

function globalAverage(dimAvgs) {
  const vals = Object.values(dimAvgs).map((d) => d.avg);
  if (!vals.length) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function calibrationErrors(config, answers) {
  let err = 0;
  for (const { question: q } of iterateQuestions(config)) {
    if (q.kind !== 'calibration') continue;
    const idx = answers[q.id];
    const ok = idx === q.correctIndex;
    if (!ok) err++;
  }
  return err;
}

function directDenials(config, answers) {
  let n = 0;
  for (const { question: q } of iterateQuestions(config)) {
    if (q.kind !== 'direct') continue;
    const denialIx = q.denialOptionIndex ?? 1;
    if (answers[q.id] === denialIx) n++;
  }
  return n;
}

function evalMetric(node, ctx) {
  if (!node || typeof node !== 'object') return null;
  if (node.kind === 'dimensionAvg') return ctx.dimAvgs[node.id]?.avg ?? 0;
  if (node.kind === 'globalAvg') return ctx.global;
  return null;
}

function evalMatch(match, ctx) {
  if (!match) return false;
  if (match.op === 'true') return true;
  if (match.op === 'lt') {
    const l = evalMetric(match.left, ctx);
    const r = match.right;
    return l !== null && l < r;
  }
  if (match.op === 'or') {
    return (match.items || []).some((m) => evalMatch(m, ctx));
  }
  return false;
}

function applyTemplate(tpl, vars) {
  if (!tpl) return '';
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
}

export function scoreAssessment(config, answers) {
  assertCompleteAnswers(config, answers);

  const dimAvgs = dimensionAverages(config, answers);
  const global = globalAverage(dimAvgs);
  const errCal = calibrationErrors(config, answers);
  const negDir = directDenials(config, answers);

  const ctx = { dimAvgs, global, errCal, negDir };

  const flags = [];
  for (const f of config.scoring?.flags || []) {
    const w = f.when;
    if (!w) continue;
    if (w.kind === 'calibration_errors_gt' && errCal > w.value) {
      flags.push(applyTemplate(f.messageTemplate, { errCal }));
    }
    if (w.kind === 'direct_denials_gte' && negDir >= w.value) {
      flags.push(applyTemplate(f.messageTemplate, { negDir }));
    }
  }

  const rules = [...(config.scoring?.verdictRules || [])].sort((a, b) => (a.priority || 0) - (b.priority || 0));

  const vctx = {
    dimAvgs,
    global,
    honPct: dimAvgs.honestidad?.avg ?? 0,
    etPct: dimAvgs.etica?.avg ?? 0,
  };

  let verdict = 'Sin clasificar';
  let badge = '—';
  let description = '';

  for (const rule of rules) {
    if (evalMatch(rule.match, { dimAvgs, global })) {
      verdict = rule.verdict;
      badge = rule.badge;
      description = applyTemplate(rule.descriptionTemplate, {
        global: vctx.global,
        honPct: vctx.honPct,
        etPct: vctx.etPct,
      });
      break;
    }
  }

  const dimensionsOut = Object.fromEntries(
    Object.entries(dimAvgs).map(([id, v]) => [id, { label: v.label, avg: v.avg }]),
  );

  return {
    global,
    verdict,
    badge,
    description,
    dimensions: dimensionsOut,
    flags,
    meta: { errCal, negDir },
  };
}

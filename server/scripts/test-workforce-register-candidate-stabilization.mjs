/**
 * Estabilización alta candidato Workforce — Smart CV, confirmación, entrevista sin hora, resume.
 * node server/scripts/test-workforce-register-candidate-stabilization.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const resumeSvc = fs.readFileSync(
  path.join(root, 'server/src/services/recruitmentCandidateResume.service.js'),
  'utf8',
);
const publicRoutes = fs.readFileSync(
  path.join(root, 'server/src/routes/timeclock.public.routes.js'),
  'utf8',
);

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

/** Espejo de recCandFormApplyParsedFields (reglas de provenance). */
function applyCvFields(fields, state) {
  const touched = state.touched || {};
  const cvFilled = state.cvFilled || {};
  function tryFill(fieldId, val) {
    if (val == null || val === '') return;
    if (touched[fieldId]) return;
    const cur = String(state.values[fieldId] || '').trim();
    const fromCv = cvFilled[fieldId];
    if (cur && fromCv == null) return;
    if (cur && fromCv != null && cur !== fromCv) return;
    state.values[fieldId] = String(val);
    cvFilled[fieldId] = String(val);
  }
  tryFill('name', fields.fullName);
  tryFill('whatsapp', fields.whatsapp);
  return state;
}

console.log('\n=== Smart CV provenance ===\n');
{
  const st = { values: {}, touched: {}, cvFilled: {} };
  applyCvFields({ fullName: 'Juan' }, st);
  applyCvFields({ fullName: 'Diana' }, st);
  check(st.values.name === 'Diana', 'CV A → CV B reemplaza nombre del parser');
}
{
  const st = { values: {}, touched: {}, cvFilled: {} };
  applyCvFields({ whatsapp: '111' }, st);
  st.touched.whatsapp = true;
  st.values.whatsapp = '222';
  delete st.cvFilled.whatsapp;
  applyCvFields({ whatsapp: '333' }, st);
  check(st.values.whatsapp === '222', 'edición manual sobrevive a CV B');
}

console.log('\n=== UI / workforce ===\n');
check(/candFormCvFilledFields/.test(indexHtml), 'estado cvFilled en formulario');
check(!/recCandFormClearPrefillMarks\(\)/.test(
  indexHtml.match(/function recCandFormClearCv[\s\S]*?recCandRenderFormCvPanel/)?.[0] || '',
), 'Quitar archivo no borra prefill marks arbitrariamente');
check(/recCandFormResetModalScroll/.test(indexHtml), 'reset scroll modal');
check(/tc-emp-recruitment-toast/.test(indexHtml), 'toast compacto reclutamiento');
check(/tc-emp-recruitment-cv-partial/.test(indexHtml), 'alerta partial CV persistente');
check(!/tc-emp-cand-success/.test(indexHtml), 'sin card success al final del workspace');

console.log('\n=== CV upload workforce ===\n');
check(/uploadedByWorkforceEmployeeId:\s*employeeId/.test(publicRoutes), 'route pasa workforce employee');
check(/uploadedByWorkforceEmployeeId/.test(resumeSvc), 'resume service workforce uploader');

console.log('\n=== Entrevista sin hora ===\n');
const {
  parseInterviewScheduleFields,
  formatInterviewScheduledAtLabel,
} = await import('../src/services/recruitmentInterviewSchedule.service.js');
const dateOnly = parseInterviewScheduleFields(
  { interviewDate: '2026-10-29', interviewTime: '' },
  'America/Mexico_City',
);
check(dateOnly && dateOnly.timeSpecified === false, 'fecha sin hora → timeSpecified false');
const withTime = parseInterviewScheduleFields(
  { interviewDate: '2026-10-29', interviewTime: '10:30' },
  'America/Mexico_City',
);
check(withTime && withTime.timeSpecified === true, 'fecha con hora');
const labelDate = formatInterviewScheduledAtLabel(
  dateOnly.scheduledAt.toISOString(),
  'America/Mexico_City',
  { timeSpecified: false },
);
check(labelDate && !/·/.test(labelDate) && /29/.test(labelDate), 'label sin hora inventada');
const labelTime = formatInterviewScheduledAtLabel(
  withTime.scheduledAt.toISOString(),
  'America/Mexico_City',
  { timeSpecified: true },
);
check(labelTime && /10:30/.test(labelTime), 'label con hora');

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Workforce register candidate stabilization tests OK.\n');

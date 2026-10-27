/**
 * Recruitment — CV inteligente V1 (parse precarga formulario)
 * node server/scripts/test-recruitment-cv-parse.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-cv-parse-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');
const routes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const parseSvcPath = path.join(rootDir, 'src/services/recruitmentCandidateResumeParse.service.js');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

const {
  parseRecruitmentResumeText,
  serializeParsedRecruitmentResumeForClient,
  classifyRecruitmentResumeFile,
  analyzeRecruitmentResumeUpload,
  suggestRecruitmentProfileFromText,
} = await import('../src/services/recruitmentCandidateResumeParse.service.js');

console.log('\n=== CV parse — estático / rutas ===\n');

check(/\/candidates\/resume\/parse/.test(routes), 'POST /candidates/resume/parse');
check(/analyzeRecruitmentResumeUpload/.test(routes), 'ruta usa servicio parse');
const parseRouteBlock =
  routes.match(/router\.post\(\s*\n\s*'\/candidates\/resume\/parse'[\s\S]*?\n\);/)?.[0] || '';
check(parseRouteBlock.length > 0 && !/createRecruitmentCandidate/.test(parseRouteBlock), 'parse no crea candidato');
check(/recCandFormAnalyzeCv/.test(indexHtml), 'UI extraer datos (parser)');
check(/Extraer datos/.test(indexHtml), 'CTA Extraer datos');
check(/recCandFormExtractSparkleSvg/.test(indexHtml), 'SVG sparkle en CTA');
check(/recCandFormApplyParsedFields/.test(indexHtml), 'UI precarga campos');
check(/Extrayendo datos del CV/.test(indexHtml), 'estado extrayendo');
check(/Datos encontrados en el CV/.test(indexHtml), 'confirmación discreta');
check(/REC_CAND_FORM_CV_MSG_NOT_PARSEABLE/.test(indexHtml), 'mensaje NOT_PARSEABLE');
check(/REC_CAND_FORM_CV_MSG_EXTRACT_FAIL/.test(indexHtml), 'mensaje EXTRACTION_FAILED/NO_DATA');
check(/recCandFormParseFallbackMsg/.test(indexHtml), 'fallback por code');
const formBody =
  indexHtml.match(/id="modal-rec-candidate-form"[\s\S]*?class="rec-cand-form-footer"/)?.[0] || '';
const sectionOrder = [
  'rec-cand-form-cv-section',
  'rec-cand-form-data-icon',
  'rec-cand-form-profile-icon',
  'rec-cand-form-process-block',
  'rec-cand-form-loc-icon',
  'rec-cand-form-notes-section',
];
let lastIdx = -1;
for (const token of sectionOrder) {
  const idx = formBody.indexOf(token);
  check(idx > lastIdx, `orden formulario: ${token}`);
  lastIdx = idx;
}
check(/rec-cand-form-cv-section--lead/.test(indexHtml), 'CV como bloque destacado');
check(/Arrastra aquí el CV para completar los datos automáticamente/.test(indexHtml), 'copy dropzone CV');
const analyzeFnBlock =
  indexHtml.match(/async function recCandFormAnalyzeCv[\s\S]*?^function recCandFormCvValidate/m)?.[0] || '';
check(analyzeFnBlock.length > 0 && !/recCandCreateAndOpen/.test(analyzeFnBlock), 'analizar no autosave');
check(/\/candidates\/resume\/parse/.test(analyzeFnBlock), 'analizar usa endpoint parse');
check(/recCandFormParseFallbackMsg\(data\.code\)/.test(analyzeFnBlock), 'fallback usa data.code');
check(/candFormFieldsTouched/.test(indexHtml), 'tracking campos manuales');

console.log('\n=== CV parse — extracción estructurada ===\n');

const sampleCv = `
María López Hernández
Ventas y atención comercial
WhatsApp: +52 55 1234 5678
Tel: 55 8765 4321
Email: maria.lopez@example.com
Ciudad: Guadalajara, Jalisco
`;

const parsed = parseRecruitmentResumeText(sampleCv);
check(parsed.fullName === 'María López Hernández', 'nombre completo');
check(parsed.email === 'maria.lopez@example.com', 'email');
check(parsed.whatsapp != null, 'whatsapp');
check(parsed.phone != null, 'teléfono secundario');
check(parsed.city != null, 'ciudad');
check(suggestRecruitmentProfileFromText(sampleCv) === 'Ventas', 'perfil sugerido Ventas');

const clientFields = serializeParsedRecruitmentResumeForClient(parsed);
check(clientFields.fullName && clientFields.email, 'payload cliente sin campos vacíos extra');

const partial = parseRecruitmentResumeText('Documento sin contacto claro.');
check(!partial.email && !partial.fullName, 'documento sin datos reconocibles');

console.log('\n=== CV parse — formatos ===\n');

check(classifyRecruitmentResumeFile('.pdf') === 'parseable', 'PDF parseable');
check(classifyRecruitmentResumeFile('.docx') === 'parseable', 'DOCX parseable');
check(classifyRecruitmentResumeFile('.jpg') === 'image', 'JPG sin parsing');

const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const imageResult = await analyzeRecruitmentResumeUpload({
  buffer: pngBuf,
  mimetype: 'image/png',
  originalName: 'scan.png',
});
check(imageResult.ok === false && imageResult.code === 'NOT_PARSEABLE', 'imagen → NOT_PARSEABLE');

console.log('\n=== CV parse — privacidad en servicio ===\n');

const svcSrc = fs.readFileSync(parseSvcPath, 'utf8');
check(!/console\.log\(/.test(svcSrc), 'sin console.log en parse service');
check(/extraction_failed/.test(svcSrc), 'log de fallo sin PII');

console.log('\n=== Regresiones ===\n');

function runRegression(script) {
  const r = spawnSync(process.execPath, [path.join('scripts', script)], {
    cwd: rootDir,
    encoding: 'utf8',
    env: process.env,
  });
  if (r.status !== 0) {
    console.error((r.stdout || '') + (r.stderr || ''));
    check(false, script);
  } else {
    check(true, script);
  }
}

runRegression('test-recruitment-candidate-resume.mjs');

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment CV parse V1 tests OK.\n');

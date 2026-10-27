/**
 * Mi espacio de trabajo — registro de candidatos desde portal Workforce.
 * node server/scripts/test-workforce-recruitment-portal.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'server/prisma/schema.prisma'), 'utf8');
const publicRoutes = fs.readFileSync(
  path.join(root, 'server/src/routes/timeclock.public.routes.js'),
  'utf8',
);
const portalSvc = fs.readFileSync(
  path.join(root, 'server/src/services/workforceRecruitmentPortal.service.js'),
  'utf8',
);
const candSvc = fs.readFileSync(
  path.join(root, 'server/src/services/recruitmentCandidate.service.js'),
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

console.log('\n=== Mi espacio / registro candidatos — estático ===\n');

check(/Mi espacio de trabajo/.test(indexHtml), 'título Mi espacio de trabajo');
check(!/class="tc-emp-title">Mi jornada</.test(indexHtml), 'sin título Mi jornada en portal');
check(/tcEmpOpenRegisterCandidate/.test(indexHtml), 'CTA registrar candidato');
check(/recCandFormApiMode/.test(indexHtml) && /context:'workforce'/.test(indexHtml), 'formulario reutilizado modo workforce');
check(/tcEmpShowCandidateRegisteredSuccess/.test(indexHtml), 'confirmación post-alta');
check(/Sin jornada asignada/.test(indexHtml), 'status admin sin jornada');
check(/tc-dir-jornada--none/.test(indexHtml), 'estilo neutro sin jornada');
check(/attendanceEnabled===false/.test(indexHtml), 'regla attendanceEnabled en directorio');

check(/registeredByWorkforceEmployeeId/.test(schema), 'schema registeredByWorkforceEmployeeId');
check(/RecruitmentCandidateRegisteredBy/.test(schema), 'relación WorkforceEmployee');

check(/\/recruitment\/vacancies/.test(publicRoutes), 'GET vacantes portal');
check(/\/recruitment\/candidates\/resume\/parse/.test(publicRoutes), 'parse CV portal');
check(/\/recruitment\/candidates'/.test(publicRoutes), 'POST candidato portal');
check(/workforceCandidateCreateSchema\.parse/.test(publicRoutes), 'validación sin spoof creador');
check(!/registeredByWorkforceEmployeeId.*req\.body/.test(publicRoutes), 'no lee creador del body');

check(/listActiveVacanciesForWorkforcePortal/.test(portalSvc), 'solo vacantes ACTIVE portal');
check(/status !== 'ACTIVE'/.test(portalSvc), 'rechaza vacante no activa');
check(/registeredByWorkforceEmployeeId: workforceEmployeeId/.test(portalSvc), 'creador desde employee sesión');

check(/serializeRegisteredByWorkforceEmployee/.test(candSvc), 'serializa registrado por');
check(/registeredByInclude/.test(candSvc), 'include en list/detail');

check(/vacancies\?status=ACTIVE/.test(indexHtml), 'admin picker solo ACTIVE');
check(!/clientName\?' · '\+v\.clientName/.test(indexHtml.match(/recCandEnsureVacancyPickerOptions[\s\S]{0,900}/)?.[0] || ''), 'opción vacante solo título');

check(/Registrado por/.test(indexHtml), 'copy registrado por en expediente');
check(/recCandRegisteredByMetaHtml/.test(indexHtml), 'metadata registrado por en cartera');

check(/\/api\/timeclock\/public\/recruitment\/candidates\/resume\/parse/.test(indexHtml), 'CV parse URL portal');

console.log('\n=== Schema portal — unit ===\n');

const { workforceCandidateCreateSchema } = await import(
  '../src/services/workforceRecruitmentPortal.service.js'
);
let spoofRejected = false;
try {
  workforceCandidateCreateSchema.parse({
    fullName: 'Juan Pérez',
    profile: 'Ventas',
    whatsapp: '5512345678',
    registeredByWorkforceEmployeeId: 'emp-spoof',
  });
} catch {
  spoofRejected = true;
}
check(spoofRejected, 'schema strict rechaza registeredBy en body');

console.log('\n=== Notas Workforce — unit ===\n');

const { resolveRecruitmentCandidateNoteAuthorName } = await import(
  '../src/services/recruitmentCandidateNote.service.js'
);
check(
  resolveRecruitmentCandidateNoteAuthorName({
    author: { fullName: 'Admin Uno' },
    legacyImport: false,
  }) === 'Admin Uno',
  'autor admin User',
);
check(
  resolveRecruitmentCandidateNoteAuthorName({
    authorWorkforceEmployee: { fullName: 'Jonathan Pérez' },
    legacyImport: false,
  }) === 'Jonathan Pérez',
  'autor WorkforceEmployee',
);
check(
  resolveRecruitmentCandidateNoteAuthorName({
    author: { fullName: 'Admin' },
    authorWorkforceEmployee: { fullName: 'Colaborador' },
    legacyImport: false,
  }) === 'Admin',
  'prioridad User sobre Workforce',
);
check(
  resolveRecruitmentCandidateNoteAuthorName({ legacyImport: true }) === 'Observación migrada',
  'legacy Observación migrada',
);
check(
  resolveRecruitmentCandidateNoteAuthorName({
    authorWorkforceEmployee: { fullName: 'Jonathan Pérez' },
    legacyImport: false,
  }) === 'Jonathan Pérez',
  'workforce no se muestra como migrada',
);
check(
  resolveRecruitmentCandidateNoteAuthorName({ legacyImport: false }) === null,
  'sin autor → null (UI —)',
);

const portalNoteBlock = fs.readFileSync(
  path.join(root, 'server/src/services/workforceRecruitmentPortal.service.js'),
  'utf8',
);
check(/authorWorkforceEmployeeId:\s*workforceEmployeeId/.test(portalNoteBlock), 'nota inicial atribuye workforce');
check(!/authorWorkforceEmployeeId.*req\.body/.test(publicRoutes), 'portal no lee autor nota del body');

console.log(failed === 0 ? '\n✓ Workforce recruitment portal tests OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

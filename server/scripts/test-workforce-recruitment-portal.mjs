/**
 * Mi espacio de trabajo — registro de candidatos desde portal Workforce.
 * node server/scripts/test-workforce-recruitment-portal.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(serverDir, '.env') });
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'wf-rec-portal-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

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
const resumeSvc = fs.readFileSync(
  path.join(root, 'server/src/services/recruitmentCandidateResume.service.js'),
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
check(/apiContext:'workforce'/.test(indexHtml), 'upload CV fuerza contexto workforce');
check(/\/api\/timeclock\/public\/recruitment\/candidates\/.*\/resume/.test(indexHtml), 'upload CV URL portal');
check(/Mis candidatos/.test(indexHtml) && /tcEmpLoadMyCandidates/.test(indexHtml), 'sección Mis candidatos');
check(/previewFilter/.test(indexHtml.match(/function tcEmpLoadMyCandidates[\s\S]*?^function /m)?.[0] || ''), 'filtros Mis candidatos en query');
check(/\/recruitment\/my-candidates/.test(publicRoutes), 'GET my-candidates portal');
check(/listMyCandidatesForWorkforcePortal/.test(portalSvc), 'servicio Mis candidatos');
check(/listCandidatesRegisteredByWorkforceEmployee/.test(candSvc), 'listado por registeredByWorkforceEmployeeId');
check(/assertRecruitmentCandidateRegisteredByWorkforceEmployee/.test(candSvc), 'resume upload solo propio candidato');
check(/uploadedByWorkforceEmployeeId/.test(resumeSvc), 'CV workforce persiste uploader empleado');
check(/filterCandidateIdsByListPreviewKind/.test(candSvc), 'filtros preview reutilizados');

const wfCreateFn = indexHtml.match(/async function recCandWorkforceCreateAndConfirm[\s\S]*?^async function /m)?.[0] || '';
check(/candFormWorkforceCreatedCandidateId/.test(indexHtml), 'estado partial success candidateId');
check(/recCandWorkforceUploadPendingCvOnly/.test(indexHtml), 'retry solo resume');
check(/tcEmpRetryPendingCvUpload/.test(indexHtml), 'acción Reintentar CV');
check(/tcEmpShowCandidateRegisteredCvPartial/.test(indexHtml), 'UI partial success');
check(/No se pudo guardar el CV/.test(indexHtml), 'mensaje partial success exacto');
check(/CV guardado/.test(indexHtml), 'confirmación CV tras retry');
check(!/catch\(_e\)\{[\s\S]*?candFormPendingCvFile=null/.test(wfCreateFn), 'upload fallido no limpia File');
check(/if\(existingId\)/.test(wfCreateFn), 'segundo submit no vuelve a crear');
const clearCvFn = indexHtml.match(/function recCandFormClearCv[\s\S]*?^function /m)?.[0] || '';
check(!/candFormWorkforceCreatedCandidateId=null/.test(clearCvFn), 'quitar CV no borra candidateId creado');
check(
  /recCandWorkforceClearPartialCvState/.test(
    indexHtml.match(/function tcEmpOpenRegisterCandidate[\s\S]*?^async function /m)?.[0] || '',
  ),
  'Registrar candidato resetea flujo completo',
);

console.log('\n=== Workspace UX V2 — estático ===\n');
check(/max-width:1140px/.test(indexHtml), 'workspace ancho desktop');
check(/tc-ws-hero/.test(indexHtml) && /tc-ws-jornada-mini/.test(indexHtml), 'header hero unificado + jornada');
check(/tc-ws-quick-indicators/.test(indexHtml), 'quick indicators preparados');
const wsAppChunk=indexHtml.match(/id="tc-emp-app"[\s\S]*?id="tc-ws-panel-candidates"/)?.[0] || '';
check(!/>\s*Metas\s*</.test(wsAppChunk) && !/>\s*Novedades\s*</.test(wsAppChunk), 'sin tab Metas/Novedades visibles');
check(/tcEmpWorkspaceSetTab/.test(indexHtml) && /role="tablist"/.test(indexHtml), 'tabs workspace');
check(/tc-ws-jornada-info-tip/.test(indexHtml) && /no monitorea otras aplicaciones/.test(indexHtml), 'privacidad jornada en tooltip');
check(/height:152px/.test(indexHtml.match(/\.tc-ws-jornada-mini[\s\S]*?\.tc-ws-jornada-mini-top/)?.[0] || ''), 'tarjeta jornada altura fija desktop');
check(/tc-ws-jornada-foot/.test(indexHtml) && /tcEmpJornadaSignalHtml/.test(indexHtml), 'pie jornada estable señal');
check(/tcEmpSyncJornadaInfoTip/.test(indexHtml) && /tc-ws-jornada-cta--in/.test(indexHtml), 'leyendas en tooltip y CTA entrada blanco');
check(!/tc-ws-jornada-hint/.test(indexHtml.match(/id="tc-emp-jornada-mini"[\s\S]*?<\/article>/)?.[0] || ''), 'sin hint fuera de la caja');
check(!/tc-ws-jornada-details/.test(indexHtml.match(/id="tc-emp-jornada-mini"[\s\S]*?<\/article>/)?.[0] || ''), 'sin panel expandible jornada');
check(!/class="tc-ws-attendance-band"/.test(indexHtml), 'sin banda asistencia horizontal grande');
check(/tcEmpMyCandFetchSeq/.test(indexHtml) && /AbortController/.test(indexHtml.match(/function tcEmpLoadMyCandidates[\s\S]*?^function /m)?.[0] || ''), 'stale requests candidatos');
check(/tc-emp-my-cand-list--loading/.test(indexHtml), 'loading listado sin vaciar DOM');
check(!/Cargando…/.test(indexHtml.match(/function tcEmpLoadMyCandidates[\s\S]*?^function /m)?.[0] || ''), 'filtros no reemplazan listado con Cargando');
const wsTabFn = indexHtml.match(/function tcEmpWorkspaceSetTab[\s\S]*?^function /m)?.[0] || '';
check(!/location\.hash/.test(wsTabFn), 'tabs no usan location.hash');
check(/tcEmpMyCandBuildCardHtml/.test(indexHtml) && /tc-emp-my-cand-card-inner/.test(indexHtml), 'cards candidato responsive');
check(/recCandFormatInterviewScheduledAt/.test(indexHtml.match(/function tcEmpMyCandInterviewHtml[\s\S]*?^function /m)?.[0] || ''), 'entrevista en card reutiliza helper TZ');

console.log('\n=== Workspace UX V2.1 — polish ===\n');
check(/let tcEmpMyCandFilter='in_process'/.test(indexHtml), 'filtro inicial in_process');
check(/tcEmpMyCandFilterUserPicked/.test(indexHtml), 'flag selección manual de filtro');
const setFilterFn = indexHtml.match(/function tcEmpMyCandSetFilter[\s\S]*?^function /m)?.[0] || '';
check(/tcEmpMyCandFilterUserPicked=true/.test(setFilterFn), 'click filtro marca selección manual');
const tabFn = indexHtml.match(/function tcEmpWorkspaceSetTab[\s\S]*?^function /m)?.[0] || '';
check(!/tcEmpMyCandFilter/.test(tabFn), 'cambio tab no resetea filtro');
check(/tc-ws-attendance-dot--live/.test(indexHtml), 'indicador jornada activa verde');
check(!/Cargando…/.test(indexHtml.match(/function tcEmpLoadMyCandidates[\s\S]*?^function /m)?.[0] || ''), 'filtros sin vaciar listado');
check(/tcEmployeeBoot[\s\S]*?tcEmpMyCandFilter='in_process'/.test(indexHtml), 'reload checador vuelve a in_process');

console.log('\n=== Workspace UX V2.2 — jornada compacta ===\n');
check(/function tcShiftDurationSeconds/.test(indexHtml), 'helper duración jornada');
check(/Math\.floor\(Number\(sec\)/.test(indexHtml.match(/function tcFmtDuration[\s\S]*?^function /m)?.[0] || ''), 'tcFmtDuration sin decimales');
check(/tcFmtDurationHuman\(sec\)/.test(indexHtml.match(/function tcEmpRender[\s\S]*?^function /m)?.[0] || ''), 'jornada finalizada human readable');
check(/tc-ws-jornada-view-live/.test(indexHtml) && /tc-ws-jornada-view-done/.test(indexHtml), 'vistas jornada live/done');
check(/tcEmpWorkspaceUpdateTabBadges/.test(indexHtml), 'contador actividades solo en tab');
check(!/tc-ws-hoy-label/.test(indexHtml), 'sin bloque Hoy en header');
check(/tc-emp-attendance-idle/.test(indexHtml) && /Sin jornada asignada/.test(indexHtml), 'sin jornada asignada compacto');
check(/onclick="tcEmpPrimaryAction\(\)"/.test(indexHtml), 'CTA entrada/salida intacto');

console.log('\n=== Workspace UX V2.3 — shell estable + duración ===\n');
check(/#tc-emp-app\{width:100%;min-width:0/.test(indexHtml), 'shell workspace ancho estable');
check(/\.tc-ws-panel-scroll/.test(indexHtml) && /tc-ws-panel-activities-scroll/.test(indexHtml) && /tc-ws-cand-list-scroll/.test(indexHtml), 'paneles operativos con scroll');
check(/tc-ws-stage/.test(indexHtml) && /height:clamp\(400px,52vh,580px\)/.test(indexHtml), 'stage tabs altura fija desktop');
check(/tc-ws-stage \.tc-ws-panel:not\(\[hidden\]\)\{position:absolute/.test(indexHtml), 'paneles mismo viewport al cambiar tab');
check(/tc-emp-shell--portal/.test(indexHtml) && /max-height:100vh/.test(indexHtml.match(/\.tc-emp-shell--portal[\s\S]*?\}/)?.[0] || ''), 'sin scroll exterior laptop');
check(/@media\(max-width:899px\)[\s\S]*?\.tc-ws-panel-scroll\{[^}]*overflow:visible/.test(indexHtml), 'mobile sin scroll interno');
check(/function tcEmpWorkspaceResetPanelScroll/.test(indexHtml), 'reset scroll panel');
const resetScrollFn = indexHtml.match(/function tcEmpWorkspaceResetPanelScroll[\s\S]*?^function /m)?.[0] || '';
check(/scrollTop\s*=\s*0/.test(resetScrollFn), 'reset scrollTop panel');
check(/tcEmpWorkspaceResetPanelScroll\(next\)/.test(indexHtml.match(/function tcEmpWorkspaceSetTab[\s\S]*?^function /m)?.[0] || ''), 'cambio tab resetea scroll panel');
check(/tcEmpWorkspaceResetPanelScroll\('candidates'\)/.test(indexHtml.match(/function tcEmpMyCandSetFilter[\s\S]*?^function /m)?.[0] || ''), 'cambio filtro resetea scroll candidatos');
check(/\.tc-emp-my-cand-empty\{[^}]*min-height:120px/.test(indexHtml), 'empty state conserva altura');
const humanFnBlock = indexHtml.match(/function tcFmtDurationHuman[\s\S]*?^function /m)?.[0] || '';
check(/Math\.floor\(n\/60\)/.test(humanFnBlock), 'duración humana por minutos completos');
check(/return tcFmtDurationHuman\(sec\)/.test(indexHtml.match(/function tcEmpElapsed[\s\S]*?^function /m)?.[0] || ''), 'jornada en curso sin segundos HH:MM:SS');
const runHuman = new Function(
  humanFnBlock.replace(/\nfunction $/, '') + '\nreturn tcFmtDurationHuman;',
)();
check(runHuman(1768) === '29 min', '29m28s → 29 min');
check(runHuman(3599) === '59 min', '59m59s → 59 min');
check(runHuman(3600) === '1 h 00 min', '1h00m → 1 h 00 min');
check(runHuman(3849) === '1 h 04 min', '1h04m09s → 1 h 04 min');
check(!/\d\.\d/.test(runHuman(1768.581)), 'duración sin decimales');
check(!/:\d{2}:\d{2}/.test(indexHtml.match(/function tcEmpRender[\s\S]*?^function /m)?.[0] || ''), 'render jornada no usa HH:MM:SS en mini card');

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

console.log('\n=== Integración (DB) ===\n');

function cookieHeaderFromResponse(res, name) {
  const raw = res.headers.getSetCookie?.() || [];
  const list = raw.length ? raw : res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [];
  for (const c of list) {
    const m = c.match(new RegExp(`${name}=([^;]+)`));
    if (m) return `${name}=${m[1]}`;
  }
  return '';
}

async function jsonFetch(base, urlPath, { method = 'GET', body, cookie, headers = {} } = {}) {
  const hdr = { ...headers };
  if (cookie) hdr.Cookie = cookie;
  if (body != null && !(body instanceof FormData)) {
    hdr['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(base + urlPath, { method, headers: hdr, body });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { res, data, text };
}

let dbOk = false;
try {
  const { prisma } = await import('../src/db/client.js');
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP integration:', e.message?.split('\n')[0] || e);
}

if (dbOk) {
  const { prisma } = await import('../src/db/client.js');
  const { createApp } = await import('../src/app.js');
  const { hashPassword } = await import('../src/services/auth.service.js');
  const { generateTimeclockAccessToken } = await import('../src/services/timeclockToken.service.js');
  const { ensureOrganizationRecruitmentStages } = await import('../src/services/recruitmentStage.service.js');
  const { getRecruitmentCandidate } = await import('../src/services/recruitmentCandidate.service.js');

  const suffix = crypto.randomBytes(4).toString('hex');
  const org = await prisma.organization.create({
    data: { name: `WF Rec ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  await ensureOrganizationRecruitmentStages(org.id);
  const pass = 'TestAdmin1!';
  const admin = await prisma.user.create({
    data: {
      email: `wf-rec-admin-${suffix}@example.com`,
      passwordHash: await hashPassword(pass),
      fullName: 'Admin',
      role: 'empresa_admin',
      organizationId: org.id,
    },
  });
  const { token: tokA, hash: hashA } = generateTimeclockAccessToken();
  const empA = await prisma.workforceEmployee.create({
    data: {
      organizationId: org.id,
      fullName: 'Reclutador A',
      timezone: 'America/Mexico_City',
      accessTokenHash: hashA,
      tokenVersion: 1,
      isActive: true,
    },
  });
  const { token: tokB, hash: hashB } = generateTimeclockAccessToken();
  const empB = await prisma.workforceEmployee.create({
    data: {
      organizationId: org.id,
      fullName: 'Reclutador B',
      timezone: 'America/Mexico_City',
      accessTokenHash: hashB,
      tokenVersion: 1,
      isActive: true,
    },
  });

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const exA = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: tokA },
    });
    const tcA = cookieHeaderFromResponse(exA.res, 'mind24.tc.sid');
    check(exA.res.status === 200 && tcA, 'sesión colaborador A');

    const create = await jsonFetch(base, '/api/timeclock/public/recruitment/candidates', {
      method: 'POST',
      cookie: tcA,
      body: {
        fullName: `CV Persist ${suffix}`,
        profile: 'Ventas',
        whatsapp: '5512345678',
      },
    });
    check(create.res.status === 201 && create.data.candidate?.id, 'POST candidato workforce');
    const candId = create.data.candidate.id;

    const pdfBody = Buffer.from('%PDF-1.4 wf rec test');
    const fd = new FormData();
    fd.append('file', new Blob([pdfBody], { type: 'application/pdf' }), 'cv-test.pdf');
    const up = await jsonFetch(
      base,
      `/api/timeclock/public/recruitment/candidates/${candId}/resume`,
      { method: 'POST', cookie: tcA, body: fd },
    );
    check(up.res.status === 201 && up.data.resume?.candidateId === candId, 'POST resume mismo candidato');

    const create2 = await jsonFetch(base, '/api/timeclock/public/recruitment/candidates', {
      method: 'POST',
      cookie: tcA,
      body: {
        fullName: `CV Retry ${suffix}`,
        profile: 'Ventas',
        whatsapp: '5512345699',
      },
    });
    const candId2 = create2.data.candidate?.id;
    check(create2.res.status === 201 && candId2, 'POST candidato para retry CV');
    const beforeResume = await getRecruitmentCandidate(org.id, candId2);
    check(!beforeResume.resume, 'sin CV tras create sin upload');

    const bigBody = Buffer.alloc(11 * 1024 * 1024, 1);
    const fdBad = new FormData();
    fdBad.append('file', new Blob([bigBody], { type: 'application/pdf' }), 'too-big.pdf');
    const upFail = await jsonFetch(
      base,
      `/api/timeclock/public/recruitment/candidates/${candId2}/resume`,
      { method: 'POST', cookie: tcA, body: fdBad },
    );
    check(upFail.res.status >= 400, 'upload CV falla (tamaño)');
    const afterFail = await getRecruitmentCandidate(org.id, candId2);
    check(!afterFail.resume && afterFail.id === candId2, 'candidato persiste tras fallo CV');

    const fdOk = new FormData();
    fdOk.append('file', new Blob([pdfBody], { type: 'application/pdf' }), 'cv-retry.pdf');
    const upRetry = await jsonFetch(
      base,
      `/api/timeclock/public/recruitment/candidates/${candId2}/resume`,
      { method: 'POST', cookie: tcA, body: fdOk },
    );
    check(upRetry.res.status === 201, 'segundo upload solo resume OK');
    const afterRetry = await getRecruitmentCandidate(org.id, candId2);
    check(afterRetry.resume?.originalFileName === 'cv-retry.pdf', 'CV asociado al mismo candidateId');

    const login = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { email: admin.email, password: pass },
    });
    const adminCookie = cookieHeaderFromResponse(login.res, 'mind24.sid');
    const detail = await getRecruitmentCandidate(org.id, candId);
    check(detail.resume?.originalFileName === 'cv-test.pdf', 'admin detail incluye CV subido');

    const crossUp = await jsonFetch(
      base,
      `/api/timeclock/public/recruitment/candidates/${candId}/resume`,
      {
        method: 'POST',
        cookie: cookieHeaderFromResponse(
          (
            await jsonFetch(base, '/api/timeclock/public/exchange', {
              method: 'POST',
              body: { token: tokB },
            })
          ).res,
          'mind24.tc.sid',
        ),
        body: fd,
      },
    );
    check(crossUp.res.status === 403 || crossUp.res.status === 404, 'otro employee no sube CV ajeno');

    const listA = await jsonFetch(
      base,
      '/api/timeclock/public/recruitment/my-candidates?previewFilter=all',
      { cookie: tcA },
    );
    check(
      listA.res.status === 200 && listA.data.candidates?.some((c) => c.id === candId),
      'Mis candidatos incluye propio',
    );

    const listB = await jsonFetch(
      base,
      '/api/timeclock/public/recruitment/my-candidates?previewFilter=all',
      {
        cookie: cookieHeaderFromResponse(
          (
            await jsonFetch(base, '/api/timeclock/public/exchange', {
              method: 'POST',
              body: { token: tokB },
            })
          ).res,
          'mind24.tc.sid',
        ),
      },
    );
    check(
      !listB.data.candidates?.some((c) => c.id === candId),
      'employee B no ve candidato de A',
    );

    const vac = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie: adminCookie,
      body: { title: 'Vac WF', clientName: 'C', positionsTotal: 1 },
    });
    const vacId = vac.data.vacancy?.id;
    await jsonFetch(base, `/api/org/recruitment/vacancies/${vacId}/applications`, {
      method: 'POST',
      cookie: adminCookie,
      body: { candidateId: candId },
    });
    const inProc = await jsonFetch(
      base,
      '/api/timeclock/public/recruitment/my-candidates?previewFilter=in_process',
      { cookie: tcA },
    );
    check(
      inProc.data.candidates?.some((c) => c.id === candId),
      'filtro En proceso',
    );
  } finally {
    server.close();
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

console.log('\n=== Regresiones ===\n');
for (const script of [
  'test-timeclock-frontend-mvp.mjs',
  'test-recruitment-candidates.mjs',
  'test-recruitment-candidate-collaboration.mjs',
]) {
  const r = spawnSync(process.execPath, [path.join(serverDir, 'scripts', script)], {
    cwd: serverDir,
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

console.log(failed === 0 ? '\n✓ Workforce recruitment portal tests OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

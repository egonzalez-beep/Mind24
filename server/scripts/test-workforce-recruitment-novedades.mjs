/**
 * Novedades de reclutamiento — portal checador (fase 1).
 * node server/scripts/test-workforce-recruitment-novedades.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(serverDir, '..');
dotenv.config({ path: path.join(serverDir, '.env') });
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'wf-novedades-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(serverDir, 'prisma/schema.prisma'), 'utf8');
const appSvc = fs.readFileSync(path.join(serverDir, 'src/services/recruitmentApplication.service.js'), 'utf8');
const novedadSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/workforceRecruitmentNovedad.service.js'),
  'utf8',
);
const publicRoutes = fs.readFileSync(path.join(serverDir, 'src/routes/timeclock.public.routes.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

console.log('\n=== Novedades reclutamiento — estático ===\n');

check(/model WorkforceRecruitmentNovedad/.test(schema), 'modelo Prisma');
check(/WorkforceRecruitmentNovedadEventType/.test(schema), 'enum eventType');
check(/@@unique\(\[organizationId, dedupeKey\]\)/.test(schema), 'unique dedupe org');
check(/WrNovedad_org_recipient_created/.test(schema), 'índice listado');
check(/WrNovedad_org_recipient_readAt/.test(schema), 'índice no leídas');
check(/emitWorkforceRecruitmentNovedadForStageEvent/.test(appSvc), 'hook en recordStageEvent');
check(/fromStageId \|\| !toStageId/.test(novedadSvc) || /!fromStageId/.test(novedadSvc), 'excluye fromStage null');
check(/!changedByUserId/.test(novedadSvc), 'excluye changedByUserId null');
check(/registeredByWorkforceEmployeeId/.test(novedadSvc), 'destinatario registeredBy');
check(/dedupeKey = stageEvent\.id/.test(novedadSvc) || /dedupeKey = stageEvent.id/.test(novedadSvc), 'dedupeKey stage event id');
check(/P2002/.test(novedadSvc), 'idempotente unique violation');
check(/router\.get\('\/novedades'/.test(publicRoutes), 'GET listado');
check(/\/novedades\/unread-count/.test(publicRoutes), 'GET unread-count');
check(!/\/novedades\/:id\/read/.test(publicRoutes), 'sin POST read individual');
check(/\/novedades\/read-all/.test(publicRoutes), 'POST read-all');
check(/listCollaboratorNovedadesFeed/.test(publicRoutes), 'feed combinado en rutas');
check(!/tcEmpNovedadesMarkRead/.test(indexHtml), 'sin lectura individual en UI');
check(/tcEmpNovedadesParseCompositeId/.test(indexHtml) && /source==='workplace'/.test(indexHtml), 'navegación workplace');
check(!/req\.query\.organizationId/.test(publicRoutes.match(/router\.get\('\/novedades'[\s\S]*?}\);/)?.[0] || ''), 'no orgId en query');
check(/TC_EMP_NOVEDADES_POLL_MS=20000/.test(indexHtml), 'polling 20s');
check(/tcEmpNovedadesStopPolling[\s\S]*clearInterval/.test(indexHtml), 'un solo intervalo');
check(/if\(tcEmpNovedadesPollInFlight\) return/.test(indexHtml), 'guard inFlight polling');
check(!/tcEmpNovedadesBuildFeed/.test(indexHtml), 'sin feed inferido');

function cookieHeaderFromResponse(res, name) {
  const raw = res.headers.getSetCookie?.() || [];
  const list = raw.length ? raw : res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [];
  for (const c of list) {
    const m = c.match(new RegExp(`${name}=([^;]+)`));
    if (m) return `${name}=${m[1]}`;
  }
  return '';
}

async function jsonFetch(base, urlPath, { method = 'GET', body, cookie } = {}) {
  const hdr = {};
  if (cookie) hdr.Cookie = cookie;
  if (body != null) {
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

console.log('\n=== Novedades reclutamiento — integración ===\n');

let dbOk = false;
try {
  const { prisma } = await import('../src/db/client.js');
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP integration:', e.message?.split('\n')[0] || e);
}

async function cleanupOrg(orgId) {
  const { prisma } = await import('../src/db/client.js');
  await prisma.workforceRecruitmentNovedad.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentApplicationStageEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentApplication.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentVacancyStage.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentVacancy.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentCandidate.deleteMany({ where: { organizationId: orgId } });
  await prisma.workforceEmployee.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

if (dbOk) {
  const { prisma } = await import('../src/db/client.js');
  const { createApp } = await import('../src/app.js');
  const { hashPassword } = await import('../src/services/auth.service.js');
  const { generateTimeclockAccessToken } = await import('../src/services/timeclockToken.service.js');
  const { ensureOrganizationRecruitmentStages } = await import('../src/services/recruitmentStage.service.js');
  const { emitWorkforceRecruitmentNovedadForStageEvent } = await import(
    '../src/services/workforceRecruitmentNovedad.service.js',
  );

  const suffix = crypto.randomBytes(4).toString('hex');
  const org = await prisma.organization.create({
    data: { name: `Nov Rec ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const orgB = await prisma.organization.create({
    data: { name: `Nov Rec B ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  await ensureOrganizationRecruitmentStages(org.id);
  await ensureOrganizationRecruitmentStages(orgB.id);

  const pass = 'TestAdmin1!';
  const admin = await prisma.user.create({
    data: {
      email: `nov-admin-${suffix}@example.com`,
      passwordHash: await hashPassword(pass),
      fullName: 'Admin',
      role: 'empresa_admin',
      organizationId: org.id,
    },
  });

  const { token: tokReg, hash: hashReg } = generateTimeclockAccessToken();
  const empReg = await prisma.workforceEmployee.create({
    data: {
      organizationId: org.id,
      fullName: 'Registrador',
      timezone: 'America/Mexico_City',
      accessTokenHash: hashReg,
      tokenVersion: 1,
      isActive: true,
    },
  });

  const { token: tokOther, hash: hashOther } = generateTimeclockAccessToken();
  const empOther = await prisma.workforceEmployee.create({
    data: {
      organizationId: org.id,
      fullName: 'Otro',
      timezone: 'America/Mexico_City',
      accessTokenHash: hashOther,
      tokenVersion: 1,
      isActive: true,
    },
  });

  const { token: tokB, hash: hashB } = generateTimeclockAccessToken();
  await prisma.workforceEmployee.create({
    data: {
      organizationId: orgB.id,
      fullName: 'Org B',
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
    const exReg = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: tokReg },
    });
    const tcReg = cookieHeaderFromResponse(exReg.res, 'mind24.tc.sid');
    const exOther = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: tokOther },
    });
    const tcOther = cookieHeaderFromResponse(exOther.res, 'mind24.tc.sid');

    const login = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { email: admin.email, password: pass },
    });
    const adminCookie = cookieHeaderFromResponse(login.res, 'mind24.sid');

    const createCand = await jsonFetch(base, '/api/timeclock/public/recruitment/candidates', {
      method: 'POST',
      cookie: tcReg,
      body: {
        fullName: `Candidato ${suffix}`,
        profile: 'Ventas',
        whatsapp: '5512345678',
      },
    });
    const candidateId = createCand.data.candidate?.id;
    check(createCand.res.status === 201 && candidateId, 'candidato con registeredBy');

    const createVac = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie: adminCookie,
      body: { title: 'Vacante Nov', clientName: 'Cliente', positionsTotal: 1 },
    });
    const vacancyId = createVac.data.vacancy?.id;
    check(createVac.res.status === 201 && vacancyId, 'vacante');

    const assign = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/applications`, {
      method: 'POST',
      cookie: adminCookie,
      body: { candidateId },
    });
    const appId = assign.data.application?.id;
    check(assign.res.status === 201 && appId, 'postulación creada');

    let novCount = await prisma.workforceRecruitmentNovedad.count({
      where: { organizationId: org.id, recipientWorkforceEmployeeId: empReg.id },
    });
    check(novCount === 0, '6 null→NEW no crea novedad');

    const stages = await prisma.recruitmentStage.findMany({
      where: { organizationId: org.id },
    });
    const contact = stages.find((s) => s.key === 'CONTACT');
    const hired = stages.find((s) => s.key === 'HIRED');
    const rejected = stages.find((s) => s.key === 'REJECTED');

    const move1 = await jsonFetch(base, `/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { stageId: contact.id },
    });
    check(move1.res.status === 200, '1 move A→B');
    novCount = await prisma.workforceRecruitmentNovedad.count({
      where: { organizationId: org.id, recipientWorkforceEmployeeId: empReg.id },
    });
    check(novCount === 1, '1 exactamente una novedad STAGE_CHANGED');

    const sameStage = await jsonFetch(base, `/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { stageId: contact.id },
    });
    check(sameStage.res.status === 200, '4 PATCH mismo stageId');
    novCount = await prisma.workforceRecruitmentNovedad.count({
      where: { organizationId: org.id, recipientWorkforceEmployeeId: empReg.id },
    });
    check(novCount === 1, '4 no duplica');

    const reorder = await jsonFetch(base, `/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { position: 5000 },
    });
    check(reorder.res.status === 200, '5 reorder kanban');
    novCount = await prisma.workforceRecruitmentNovedad.count({
      where: { organizationId: org.id, recipientWorkforceEmployeeId: empReg.id },
    });
    check(novCount === 1, '5 reorder no crea');

    const moveHired = await jsonFetch(base, `/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { stageId: hired.id },
    });
    check(moveHired.res.status === 200, '2 move HIRED');
    const hiredNov = await prisma.workforceRecruitmentNovedad.findFirst({
      where: {
        organizationId: org.id,
        recipientWorkforceEmployeeId: empReg.id,
        eventType: 'HIRED',
      },
    });
    check(!!hiredNov, '2 tipo HIRED');

    const createCand2 = await jsonFetch(base, '/api/timeclock/public/recruitment/candidates', {
      method: 'POST',
      cookie: tcReg,
      body: { fullName: `Rech ${suffix}`, profile: 'Ventas', whatsapp: '5512345680' },
    });
    const cand2 = createCand2.data.candidate?.id;
    const assign2 = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/applications`, {
      method: 'POST',
      cookie: adminCookie,
      body: { candidateId: cand2 },
    });
    const app2 = assign2.data.application?.id;
    await jsonFetch(base, `/api/org/recruitment/applications/${app2}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { stageId: rejected.id },
    });
    const rejNov = await prisma.workforceRecruitmentNovedad.findFirst({
      where: {
        organizationId: org.id,
        recipientWorkforceEmployeeId: empReg.id,
        eventType: 'REJECTED',
        candidateId: cand2,
      },
    });
    check(!!rejNov, '3 tipo REJECTED');

    const adminCand = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        fullName: 'Sin registrador',
        profile: 'Ventas',
        phone: '5512345681',
      },
    });
    const candNoReg = adminCand.data.candidate?.id;
    const assign3 = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/applications`, {
      method: 'POST',
      cookie: adminCookie,
      body: { candidateId: candNoReg },
    });
    const app3 = assign3.data.application?.id;
    const stNew = stages.find((s) => s.key === 'NEW');
    await jsonFetch(base, `/api/org/recruitment/applications/${app3}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { stageId: contact.id },
    });
    const novNoReg = await prisma.workforceRecruitmentNovedad.count({
      where: { candidateId: candNoReg },
    });
    check(novNoReg === 0, '9 sin registeredBy no novedad');

    await jsonFetch(base, `/api/org/recruitment/candidates/${candidateId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { phone: '5599999999', city: 'CDMX', notes: 'nota' },
    });
    novCount = await prisma.workforceRecruitmentNovedad.count({
      where: { organizationId: org.id, recipientWorkforceEmployeeId: empReg.id },
    });
    check(novCount === 3, '8 editar candidato no crea novedades');

    const stageEvent = await prisma.recruitmentApplicationStageEvent.findFirst({
      where: { applicationId: appId, toStageId: contact.id },
    });
    await prisma.$transaction(async (tx) => {
      await emitWorkforceRecruitmentNovedadForStageEvent(tx, {
        stageEvent,
        applicationId: appId,
        organizationId: org.id,
      });
    });
    novCount = await prisma.workforceRecruitmentNovedad.count({
      where: { organizationId: org.id, dedupeKey: stageEvent.id },
    });
    check(novCount === 1, '10 reintento idempotente');

    const listReg = await jsonFetch(base, '/api/timeclock/public/novedades?limit=30', { cookie: tcReg });
    check(listReg.res.status === 200 && listReg.data.novedades?.length >= 3, 'listado destinatario');
    const firstId = listReg.data.novedades[0]?.id;

    const crossList = await jsonFetch(base, '/api/timeclock/public/novedades?limit=30', {
      cookie: tcOther,
    });
    check(
      !crossList.data.novedades?.some((n) => n.id === firstId),
      '11 otro empleado no ve novedad ajena',
    );

    const unreadBefore = await jsonFetch(base, '/api/timeclock/public/novedades/unread-count', {
      cookie: tcReg,
    });
    const u0 = unreadBefore.data.unreadCount;
    check(u0 > 0, 'unread inicial > 0');

    check(firstId && String(firstId).includes(':'), '12 id compuesto en feed');

    await jsonFetch(base, '/api/timeclock/public/novedades/read-all', {
      method: 'POST',
      cookie: tcReg,
      body: {},
    });
    const unreadAll = await jsonFetch(base, '/api/timeclock/public/novedades/unread-count', {
      cookie: tcReg,
    });
    check(unreadAll.data.unreadCount === 0, '13 read-all autenticado');

    const unreadOther = await jsonFetch(base, '/api/timeclock/public/novedades/unread-count', {
      cookie: tcOther,
    });
    check(unreadOther.data.unreadCount === 0, '13 read-all no afecta otro sin novedades');

    const unreadNoTasks = await jsonFetch(base, '/api/timeclock/public/novedades/unread-count', {
      cookie: tcReg,
    });
    check(unreadNoTasks.res.status === 200, '15 funciona sin actividades');

    check(stNew && contact && hired && rejected, 'stages seed OK');
  } finally {
    server.close();
    await cleanupOrg(org.id);
    await cleanupOrg(orgB.id);
  }
}

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Workforce recruitment novedades tests OK.\n');

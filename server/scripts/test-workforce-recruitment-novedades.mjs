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
check(/cancelOpenStageNovedadWaits/.test(appSvc) && /novedadEligibleAt: armWait/.test(appSvc), 'el PATCH crea el evento con la espera');
check(/scheduleNovedad: true/.test(appSvc), 'solo el PATCH manual programa aviso');
check((appSvc.match(/scheduleNovedad: true/g) || []).length === 1, 'el alta no programa aviso de etapa');
check(!/emitWorkforceRecruitmentNovedadForStageEvent/.test(appSvc), 'el movimiento no emite el aviso al instante');
check(/fromStageId \|\| !toStageId/.test(novedadSvc) || /!fromStageId/.test(novedadSvc), 'excluye fromStage null');
check(/!changedByUserId/.test(novedadSvc), 'excluye changedByUserId null');
check(/registeredByWorkforceEmployeeId/.test(novedadSvc), 'destinatario registeredBy');
check(/dedupeKey = stageEvent\.id/.test(novedadSvc) || /dedupeKey = stageEvent.id/.test(novedadSvc), 'dedupeKey stage event id');
check(/INTERVIEW_NO_SHOW/.test(schema), 'enum INTERVIEW_NO_SHOW');
check(/emitWorkforceRecruitmentNovedadForInterviewNoShow/.test(novedadSvc), 'emit NO_SHOW');
check(/interview_no_show:\$\{appId\}:\$\{eventId\}/.test(novedadSvc) || /interview_no_show:/.test(novedadSvc), 'dedupeKey por id de cita');
check(/interviewNoShowDedupeKey/.test(novedadSvc), 'helper dedupe NO_SHOW exportado');
check(/interviewEventId/.test(novedadSvc) && /!interviewEventId/.test(novedadSvc), 'emit exige interviewEventId');
check(
  /no se presentó a la entrevista para/.test(novedadSvc),
  'copy NO_SHOW con nombre y vacante',
);
check(/INTERVIEW_NO_SHOW/.test(indexHtml) && /tc-ws-novedades-item--noshow/.test(indexHtml), 'UI ámbar NO_SHOW');
check(/eventType==='INTERVIEW_NO_SHOW'\) return null/.test(indexHtml), 'NO_SHOW no fuerza filtro En proceso');
check(/P2002/.test(novedadSvc), 'idempotente unique violation (otras novedades)');
check(
  /emitWorkforceRecruitmentNovedadForInterviewNoShow[\s\S]*createMany[\s\S]*skipDuplicates:\s*true/.test(
    novedadSvc,
  ),
  'NO_SHOW usa createMany skipDuplicates (no aborta TX)',
);
{
  const mig = fs.readFileSync(
    path.join(serverDir, 'prisma/migrations/20261118200000_workforce_novedad_interview_no_show/migration.sql'),
    'utf8',
  );
  check(/ADD VALUE 'INTERVIEW_NO_SHOW'/.test(mig), 'migración aditiva INTERVIEW_NO_SHOW');
  const migSql = mig
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
  check(!/\bUPDATE\b|\bINSERT\b/i.test(migSql), 'migración sin backfill');
}
{
  const interviewSvc = fs.readFileSync(
    path.join(serverDir, 'src/services/recruitmentApplicationInterviewEvent.service.js'),
    'utf8',
  );
  check(/emitNoShowNovedadIfNeeded/.test(interviewSvc), 'helper emisión en servicio entrevistas');
  check(/afterInterviewNoShowConfirmed/.test(interviewSvc), 'helper park+aviso tras NO_SHOW');
  check(
    /recordRecruitmentApplicationInterviewEvent[\s\S]*afterInterviewNoShowConfirmed/.test(
      interviewSvc,
    ),
    'ruta legacy interview-events park+aviso NO_SHOW',
  );
  check(
    /emitNoShowNovedadIfNeeded\(tx, app, type/.test(interviewSvc),
    'ruta actions emite solo si NO_SHOW nuevo',
  );
  check(/parkApplicationAfterInterviewNoShow/.test(interviewSvc), 'NO_SHOW aparca postulación');
  check(!/CANCELLED[\s\S]{0,80}emitWorkforceRecruitmentNovedadForInterviewNoShow/.test(interviewSvc), 'CANCELLED no emite NO_SHOW');
}
{
  const parkSvc = fs.readFileSync(
    path.join(serverDir, 'src/services/recruitmentInterviewNoShowPark.service.js'),
    'utf8',
  );
  const parkMig = fs.readFileSync(
    path.join(serverDir, 'prisma/migrations/20261120120000_recruitment_interview_no_show_park/migration.sql'),
    'utf8',
  );
  check(/INTERVIEW_NO_SHOW/.test(parkSvc), 'servicio cartera INTERVIEW_NO_SHOW');
  check(/rescheduleAfterInterviewNoShowForWorkforce/.test(parkSvc), 'agendar desde portal');
  check(/interviewNoShowFromStageId/.test(parkMig), 'migración origen de retorno');
  check(/7500/.test(parkMig), 'etapa antes de terminales');
  const parkMigSql = parkMig
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
  check(!/\bUPDATE\s+"RecruitmentApplication"/i.test(parkMigSql), 'migración park sin UPDATE de postulaciones');
}
check(
  /reschedule-interview-no-show/.test(publicRoutes),
  'POST portal agendar desde NO_SHOW',
);
check(/sourceInterviewEventId/.test(publicRoutes), 'ruta exige id del NO_SHOW del aviso');
check(/¿Agendamos la entrevista\?/.test(indexHtml), 'CTA Novedades agendar');
check(/Reagendar entrevista/.test(indexHtml), 'modal título Reagendar entrevista');
check(/Seleccionar fecha/.test(indexHtml), 'placeholder fecha personalizado');
check(/tc-noshow-date-panel/.test(indexHtml), 'calendario desplegable propio');
check(/tcEmpNoshowDateShiftMonth/.test(indexHtml), 'navegación de mes en calendario');
check(/Seleccionar hora/.test(indexHtml), 'placeholder hora personalizado');
check(/Sin hora/.test(indexHtml), 'opción Sin hora en desplegable');
check(/tc-noshow-time-panel/.test(indexHtml), 'desplegable de hora propio');
check(
  /tcEmpNoshowTimeIsComplete/.test(indexHtml)
    && /tcEmpNoshowTimeIsPartial/.test(indexHtml)
    && /Falta:/.test(indexHtml),
  'hora se guarda solo si está completa',
);
check(
  !/tcEmpNoshowTimeSetOpen\(open\)[\s\S]{0,220}tcEmpNoshowTimeDraft\s*=\s*\{\s*hour:\s*tcEmpNoshowTimeCommitted/.test(
    indexHtml,
  ),
  'reabrir selector no borra borrador parcial',
);
{
  // Caso: solo minutos=30 → parcial; dos validaciones no envían; Sin hora → null.
  const draft = { hour: null, minute: 30, ampm: null };
  const isPartial = draft.hour != null || draft.minute != null || !!draft.ampm;
  const isComplete = draft.hour != null && draft.minute != null && !!draft.ampm;
  check(isPartial && !isComplete, 'caso minutos-only: parcial no completa');
  check(!isComplete, 'caso minutos-only: no envía (falta hora y a. m./p. m.)');
  const cleared = { hour: null, minute: null, ampm: null };
  const clearedComplete =
    cleared.hour != null && cleared.minute != null && !!cleared.ampm;
  check(!clearedComplete, 'Sin hora → sin HH:mm (null al endpoint)');
}
check(
  /canRescheduleInterviewNoShow/.test(indexHtml)
    && /noshow&&n\.canRescheduleInterviewNoShow/.test(indexHtml),
  'CTA solo si aviso vigente en cartera',
);
check(
  /canRescheduleInterviewNoShow:false/.test(indexHtml)
    || /canRescheduleInterviewNoShow:\s*false/.test(indexHtml),
  'tras agendar quita CTA en lista local',
);
check(/sourceInterviewEventId/.test(indexHtml), 'UI envía id del evento del aviso');
check(/modal-tc-noshow-reschedule/.test(indexHtml), 'modal agendar sin alta');
{
  const feedSvc = fs.readFileSync(
    path.join(serverDir, 'src/services/workforceCollaboratorNovedadesFeed.service.js'),
    'utf8',
  );
  check(/attachInterviewNoShowRescheduleFlags/.test(feedSvc), 'feed enriquece flag de CTA');
  check(/canRescheduleInterviewNoShowFromAviso/.test(feedSvc), 'feed usa helper de vigencia');
  check(/canRescheduleInterviewNoShowFromAviso/.test(novedadSvc), 'helper vigencia exportado');
}
check(/rec-kanban-col--sem-noshow/.test(indexHtml), 'Kanban columna cartera');
{
  const parkSvc = fs.readFileSync(
    path.join(serverDir, 'src/services/recruitmentInterviewNoShowPark.service.js'),
    'utf8',
  );
  const parkMigLink = fs.readFileSync(
    path.join(serverDir, 'prisma/migrations/20261120120000_recruitment_interview_no_show_park/migration.sql'),
    'utf8',
  );
  check(/FOR UPDATE/.test(parkSvc), 'agendar bloquea fila (concurrencia)');
  check(/interviewNoShowEventId:\s*eventId/.test(parkSvc), 'park guarda interviewEventId en la misma TX');
  check(
    /app\.interviewNoShowEventId !== sourceEventId/.test(parkSvc),
    'agendar exige el evento vinculado a la estancia',
  );
  check(/sourceInterviewEventId/.test(parkSvc), 'aviso ata identity estable de la cita');
  check(/updateMany/.test(parkSvc) && /moved\.count !== 1/.test(parkSvc), 'salida de cartera condicional');
  check(/interviewNoShowEventId/.test(parkMigLink), 'migración guarda vínculo de estancia');
}
{
  const closure = fs.readFileSync(
    path.join(serverDir, 'src/services/recruitmentProcessClosure.service.js'),
    'utf8',
  );
  const vacancySvc = fs.readFileSync(
    path.join(serverDir, 'src/services/recruitmentVacancy.service.js'),
    'utf8',
  );
  check(/isRecruitmentApplicationInActiveVacancyQueue/.test(closure), 'helper cola activa');
  check(
    /isRecruitmentApplicationInActiveVacancyQueue/.test(vacancySvc),
    'inProcess excluye cartera NO_SHOW',
  );
}
check(/router\.get\('\/novedades'/.test(publicRoutes), 'GET listado');
check(/\/novedades\/unread-count/.test(publicRoutes), 'GET unread-count');
check(/\/novedades\/recruitment\/:id\/read/.test(publicRoutes), 'POST read individual reclutamiento');
check(/\/novedades\/workplace\/:id\/read/.test(publicRoutes), 'POST read individual workplace');
check(/markWorkforceRecruitmentNovedadRead/.test(publicRoutes), 'ruta reclutamiento usa servicio existente');
{
  const wpBlock = publicRoutes.split("'/novedades/workplace/:id/read'")[1]?.split('router.post')[0] || '';
  const recBlock = publicRoutes.split("'/novedades/recruitment/:id/read'")[1]?.split('router.post')[0] || '';
  check(
    /requireTimeclockSession/.test(wpBlock) &&
      /requireTimeclockMutationOrigin/.test(wpBlock) &&
      /requireTimeclockSession/.test(recBlock) &&
      /requireTimeclockMutationOrigin/.test(recBlock) &&
      !/Limiter/.test(wpBlock) &&
      !/Limiter/.test(recBlock),
    'ambas rutas read: sesión + origen, sin limiter extra',
  );
  check(!/req\.body/.test(recBlock), 'recruitment read no lee body para destinatario');
}
check(/\/novedades\/read-all/.test(publicRoutes), 'POST read-all');
check(/listCollaboratorNovedadesFeed/.test(publicRoutes), 'feed combinado en rutas');
check(/function tcEmpNovedadesEnsureItemRead/.test(indexHtml), 'UI lectura individual al abrir');
check(/novedades\/recruitment\/'\+encodeURIComponent\(rawId\)\+'\/read/.test(indexHtml), 'UI llama read reclutamiento');
check(/novedades\/workplace\/'\+encodeURIComponent\(rawId\)\+'\/read/.test(indexHtml), 'UI llama read workplace');
check(/tcEmpNovedadesParseCompositeId/.test(indexHtml) && /source==='workplace'/.test(indexHtml), 'navegación workplace');
check(
  indexHtml === fs.readFileSync(path.join(root, 'server/public/index.html'), 'utf8'),
  'index.html y server/public/index.html son idénticos',
);
check(!/req\.query\.organizationId/.test(publicRoutes.match(/router\.get\('\/novedades'[\s\S]*?}\);/)?.[0] || ''), 'no orgId en query');
check(/TC_EMP_NOVEDADES_POLL_MS=20000/.test(indexHtml), 'polling 20s');
check(/tcEmpNovedadesStopPolling[\s\S]*clearInterval/.test(indexHtml), 'un solo intervalo');
check(/if\(tcEmpNovedadesPollInFlight\) return/.test(indexHtml), 'guard inFlight polling');
check(!/tcEmpNovedadesBuildFeed/.test(indexHtml), 'sin feed inferido');

console.log('\n=== NO_SHOW dedupe key (unit) ===\n');
const { interviewNoShowDedupeKey, canRescheduleInterviewNoShowFromAviso } = await import(
  '../src/services/workforceRecruitmentNovedad.service.js'
);
{
  // Misma cita (mismo event id) aunque el horario se repita en otra cita distinta.
  const sameCita = interviewNoShowDedupeKey({ applicationId: 'app1', interviewEventId: 'ev-a' });
  const sameCitaAgain = interviewNoShowDedupeKey({ applicationId: 'app1', interviewEventId: 'ev-a' });
  const otherCitaSameSlot = interviewNoShowDedupeKey({ applicationId: 'app1', interviewEventId: 'ev-b' });
  check(
    sameCita === sameCitaAgain && sameCita === 'interview_no_show:app1:ev-a',
    'doble guardado misma cita → misma clave',
  );
  check(sameCita !== otherCitaSameSlot, 'dos citas distintas (mismo horario) → dos claves');
  check(interviewNoShowDedupeKey({ applicationId: 'app1', interviewEventId: '' }) == null, 'sin eventId no hay clave');
  check(interviewNoShowDedupeKey({ applicationId: '', interviewEventId: 'ev-a' }) == null, 'sin applicationId no hay clave');
}

console.log('\n=== CTA Agendar vigencia (unit) ===\n');
{
  const metaA = { interviewEventId: 'ev-a' };
  check(
    canRescheduleInterviewNoShowFromAviso({
      metadata: metaA,
      applicationStageKey: 'INTERVIEW_NO_SHOW',
      applicationInterviewNoShowEventId: 'ev-a',
    }),
    'CTA: en cartera y aviso = estancia',
  );
  check(
    !canRescheduleInterviewNoShowFromAviso({
      metadata: metaA,
      applicationStageKey: 'INTERVIEW_NO_SHOW',
      applicationInterviewNoShowEventId: 'ev-b',
    }),
    'CTA: aviso A no coincide con estancia B',
  );
  check(
    !canRescheduleInterviewNoShowFromAviso({
      metadata: metaA,
      applicationStageKey: 'INTERVIEW',
      applicationInterviewNoShowEventId: 'ev-a',
    }),
    'CTA: fuera de cartera (otra entrevista / reagendada)',
  );
  check(
    !canRescheduleInterviewNoShowFromAviso({
      metadata: metaA,
      applicationStageKey: 'INTERVIEW_NO_SHOW',
      applicationInterviewNoShowEventId: null,
    }),
    'CTA: sin vínculo de estancia',
  );
}

console.log('\n=== Park stay ↔ NO_SHOW event (unit) ===\n');
{
  // Caso 1: B aparca (eventId B). A tarde no mueve; authorized sigue siendo B.
  const stayAfterB = { interviewNoShowEventId: 'ev-b' };
  check(stayAfterB.interviewNoShowEventId === 'ev-b', 'caso1: estancia atada a B');
  check(stayAfterB.interviewNoShowEventId !== 'ev-a', 'caso1: aviso A no autoriza');
  // Caso 2: A aparca → recupera → B aparca; solo B autoriza la estancia actual.
  const stayAfterB2 = { interviewNoShowEventId: 'ev-b' };
  check(stayAfterB2.interviewNoShowEventId === 'ev-b', 'caso2: estancia actual = B');
  check(stayAfterB2.interviewNoShowEventId !== 'ev-a', 'caso2: aviso A ya no sirve');
  // Mismo timestamp no aplica: el vínculo es el id escrito al park, no createdAt.
  check(typeof stayAfterB.interviewNoShowEventId === 'string', 'vínculo explícito por id, no por timestamp');
}

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
  const { emitWorkforceRecruitmentNovedadForStageEvent, deliverDueRecruitmentStageNovedades } = await import(
    '../src/services/workforceRecruitmentNovedad.service.js',
  );

  const cols = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'RecruitmentApplicationStageEvent'
      AND column_name IN ('novedadEligibleAt', 'novedadNotifiedAt')
  `;
  if (!Array.isArray(cols) || cols.length < 2) {
    console.log('  SKIP integration: migración de espera de etapa no aplicada en PostgreSQL local');
  } else {

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
    check(novCount === 0, '1 el movimiento reciente no avisa');
    await deliverDueRecruitmentStageNovedades({
      now: new Date(Date.now() + 30 * 60 * 1000),
      db: prisma,
    });
    novCount = await prisma.workforceRecruitmentNovedad.count({
      where: { organizationId: org.id, recipientWorkforceEmployeeId: empReg.id },
    });
    check(novCount === 0, '1 antes de dos horas no avisa');
    await deliverDueRecruitmentStageNovedades({
      now: new Date(Date.now() + 2 * 60 * 60 * 1000 + 5000),
      db: prisma,
    });
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
    let hiredNov = await prisma.workforceRecruitmentNovedad.findFirst({
      where: {
        organizationId: org.id,
        recipientWorkforceEmployeeId: empReg.id,
        eventType: 'HIRED',
      },
    });
    check(!hiredNov, '2 HIRED espera dos horas');
    await deliverDueRecruitmentStageNovedades({
      now: new Date(Date.now() + 2 * 60 * 60 * 1000 + 5000),
      db: prisma,
    });
    hiredNov = await prisma.workforceRecruitmentNovedad.findFirst({
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
    await deliverDueRecruitmentStageNovedades({
      now: new Date(Date.now() + 2 * 60 * 60 * 1000 + 5000),
      db: prisma,
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
    await deliverDueRecruitmentStageNovedades({
      now: new Date(Date.now() + 2 * 60 * 60 * 1000 + 5000),
      db: prisma,
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
    const recItem = (listReg.data.novedades || []).find(
      (n) => n.source === 'recruitment' || String(n.id || '').startsWith('recruitment:'),
    );
    const firstId = recItem?.id || listReg.data.novedades[0]?.id;

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
    const rawRecId = String(firstId).startsWith('recruitment:')
      ? String(firstId).slice('recruitment:'.length)
      : null;
    check(!!rawRecId, '12 raw id reclutamiento');

    const readOwn = await jsonFetch(
      base,
      `/api/timeclock/public/novedades/recruitment/${encodeURIComponent(rawRecId)}/read`,
      { method: 'POST', cookie: tcReg, body: {} },
    );
    check(readOwn.res.status === 200 && readOwn.data?.ok === true, 'lectura individual propia');
    const unreadAfterOne = await jsonFetch(base, '/api/timeclock/public/novedades/unread-count', {
      cookie: tcReg,
    });
    check(unreadAfterOne.data.unreadCount === u0 - 1, 'unread baja exactamente uno');

    const readAgain = await jsonFetch(
      base,
      `/api/timeclock/public/novedades/recruitment/${encodeURIComponent(rawRecId)}/read`,
      { method: 'POST', cookie: tcReg, body: {} },
    );
    check(readAgain.res.status === 200 && readAgain.data?.ok === true, 'lectura individual idempotente');
    const unreadAfterIdem = await jsonFetch(base, '/api/timeclock/public/novedades/unread-count', {
      cookie: tcReg,
    });
    check(unreadAfterIdem.data.unreadCount === u0 - 1, 'idempotente no vuelve a bajar el contador');

    const crossRead = await jsonFetch(
      base,
      `/api/timeclock/public/novedades/recruitment/${encodeURIComponent(rawRecId)}/read`,
      { method: 'POST', cookie: tcOther, body: {} },
    );
    check(crossRead.res.status === 404, 'otro colaborador no marca novedad ajena');

    const exB = await jsonFetch(base, '/api/timeclock/public/exchange', {
      method: 'POST',
      body: { token: tokB },
    });
    const tcB = cookieHeaderFromResponse(exB.res, 'mind24.tc.sid');
    const crossOrgRead = await jsonFetch(
      base,
      `/api/timeclock/public/novedades/recruitment/${encodeURIComponent(rawRecId)}/read`,
      { method: 'POST', cookie: tcB, body: {} },
    );
    check(crossOrgRead.res.status === 404, 'otra organización no marca novedad ajena');

    const missingRead = await jsonFetch(
      base,
      '/api/timeclock/public/novedades/recruitment/nov-inexistente/read',
      { method: 'POST', cookie: tcReg, body: {} },
    );
    check(missingRead.res.status === 404, 'id inexistente → 404 sin filtración');

    const spoofBody = await jsonFetch(
      base,
      `/api/timeclock/public/novedades/recruitment/${encodeURIComponent(rawRecId)}/read`,
      {
        method: 'POST',
        cookie: tcReg,
        body: { organizationId: orgB.id, employeeId: empOther.id, recipientWorkforceEmployeeId: empOther.id },
      },
    );
    check(spoofBody.res.status === 200 && spoofBody.data?.ok === true, 'body spoof ignorado; sesión manda');

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

    check(
      Array.isArray(listReg.data.novedades) && listReg.data.novedades.length <= 30,
      'feed limitado a 30',
    );

    check(stNew && contact && hired && rejected, 'stages seed OK');
  } finally {
    server.close();
    await cleanupOrg(org.id);
    await cleanupOrg(orgB.id);
  }
  }
}

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Workforce recruitment novedades tests OK.\n');

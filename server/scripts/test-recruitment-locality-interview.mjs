/**
 * Recruitment V1.2 — localidad/colonia + entrevista programada.
 * node server/scripts/test-recruitment-locality-interview.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const serverDir = path.join(root, 'server');
dotenv.config({ path: path.join(serverDir, '.env') });
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-loc-int-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(serverDir, 'prisma/schema.prisma'), 'utf8');
const migration = fs.readFileSync(
  path.join(serverDir, 'prisma/migrations/20261027160000_recruitment_locality_interview/migration.sql'),
  'utf8',
);
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const routes = fs.readFileSync(path.join(serverDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const publicRoutes = fs.readFileSync(path.join(serverDir, 'src/routes/timeclock.public.routes.js'), 'utf8');
const candSvc = fs.readFileSync(path.join(serverDir, 'src/services/recruitmentCandidate.service.js'), 'utf8');
const appSvc = fs.readFileSync(path.join(serverDir, 'src/services/recruitmentApplication.service.js'), 'utf8');
const interviewSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/recruitmentInterviewSchedule.service.js'),
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

console.log('\n=== V1.2 — schema y migración ===\n');
check(/locality\s+String\?/.test(schema) && /neighborhood\s+String\?/.test(schema), 'Candidate locality/neighborhood');
check(/interviewScheduledAt/.test(schema), 'Application interviewScheduledAt');
check(/locality/.test(migration) && /interviewScheduledAt/.test(migration), 'SQL migración');

console.log('\n=== V1.2 — servicios ===\n');
check(/RECRUITMENT_INTERVIEW_SCHEDULE_STAGE_KEYS/.test(interviewSvc), 'stage keys entrevista');
check(/utcInstantFromLocalParts/.test(interviewSvc), 'parse local → UTC');
check(/locality/.test(candSvc) && /neighborhood/.test(candSvc), 'serialización candidate');
check(/interviewScheduledAt/.test(appSvc), 'application interviewScheduledAt');
check(
  /buildPrimaryActivePreviewByCandidateId[\s\S]*interviewScheduledAt/.test(candSvc),
  'preview incluye entrevista',
);

console.log('\n=== V1.2 — rutas ===\n');
check(/locality/.test(routes) && /interviewDate/.test(routes), 'admin candidate/application');
check(/\/meta/.test(routes) && /\/recruitment\/meta/.test(publicRoutes), 'meta timezone org');

console.log('\n=== V1.2 — UI ===\n');
check(/rec-cand-form-locality/.test(indexHtml) && /rec-cand-form-neighborhood/.test(indexHtml), 'formulario ubicación');
check(/rec-cand-form-interview-wrap/.test(indexHtml), 'campo entrevista formulario');
check(/REC_CAND_INTERVIEW_STAGE_KEYS/.test(indexHtml), 'regla stages entrevista UI');
check(/recCandLocationDetailHtml/.test(indexHtml), 'expediente ubicación');
check(/recCandSaveHeroInterview/.test(indexHtml), 'editar entrevista detail');
check(/tcEmpMyCandInterviewHtml/.test(indexHtml), 'Mis candidatos entrevista');

console.log('\n=== V1.2 — transición etapa / entrevista ===\n');
const {
  utcInstantFromLocalParts,
  stageKeyAllowsInterviewSchedule,
  formatInterviewScheduledAtLabel,
  parseInterviewScheduleFields,
  resolveInterviewScheduledAtForApplicationUpdate,
} = await import('../src/services/recruitmentInterviewSchedule.service.js');
check(
  /resolveInterviewScheduledAtForApplicationUpdate/.test(appSvc),
  'application service usa regla centralizada',
);

const sampleIv = new Date('2026-10-29T16:30:00.000Z');
const sampleIvNew = new Date('2026-11-02T17:00:00.000Z');
function ivSame(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.getTime() === b.getTime();
}

check(
  ivSame(
    resolveInterviewScheduledAtForApplicationUpdate({
      stageChanged: true,
      fromStageKey: 'INITIAL_INTERVIEW',
      toStageKey: 'FINALIST',
      existingInterviewScheduledAt: sampleIv,
      explicitInterviewScheduledAt: undefined,
    }),
    null,
  ),
  'INITIAL_INTERVIEW + fecha → FINALIST → null',
);
check(
  ivSame(
    resolveInterviewScheduledAtForApplicationUpdate({
      stageChanged: true,
      fromStageKey: 'CLIENT_INTERVIEW',
      toStageKey: 'HIRED',
      existingInterviewScheduledAt: sampleIv,
      explicitInterviewScheduledAt: undefined,
    }),
    null,
  ),
  'CLIENT_INTERVIEW + fecha → HIRED → null',
);
check(
  ivSame(
    resolveInterviewScheduledAtForApplicationUpdate({
      stageChanged: true,
      fromStageKey: 'INITIAL_INTERVIEW',
      toStageKey: 'CLIENT_INTERVIEW',
      existingInterviewScheduledAt: sampleIv,
      explicitInterviewScheduledAt: undefined,
    }),
    null,
  ),
  'INITIAL → CLIENT sin nueva fecha → null',
);
check(
  ivSame(
    resolveInterviewScheduledAtForApplicationUpdate({
      stageChanged: true,
      fromStageKey: 'INITIAL_INTERVIEW',
      toStageKey: 'CLIENT_INTERVIEW',
      existingInterviewScheduledAt: sampleIv,
      explicitInterviewScheduledAt: sampleIvNew,
    }),
    sampleIvNew,
  ),
  'INITIAL → CLIENT con nueva fecha → nueva fecha',
);
check(
  ivSame(
    resolveInterviewScheduledAtForApplicationUpdate({
      stageChanged: false,
      fromStageKey: 'INITIAL_INTERVIEW',
      toStageKey: 'INITIAL_INTERVIEW',
      existingInterviewScheduledAt: sampleIv,
      explicitInterviewScheduledAt: undefined,
    }),
    sampleIv,
  ),
  'mismo stage sin cambios → conserva fecha',
);
check(
  ivSame(
    resolveInterviewScheduledAtForApplicationUpdate({
      stageChanged: false,
      fromStageKey: 'INITIAL_INTERVIEW',
      toStageKey: 'INITIAL_INTERVIEW',
      existingInterviewScheduledAt: sampleIv,
      explicitInterviewScheduledAt: null,
    }),
    null,
  ),
  'clearInterview → null',
);

console.log('\n=== V1.2 — unit timezone ===\n');
check(stageKeyAllowsInterviewSchedule('INITIAL_INTERVIEW'), 'INITIAL_INTERVIEW');
check(stageKeyAllowsInterviewSchedule('CLIENT_INTERVIEW'), 'CLIENT_INTERVIEW');
check(!stageKeyAllowsInterviewSchedule('NEW'), 'NEW no entrevista');
const instant = utcInstantFromLocalParts('2026-10-29', 10, 30, 'America/Mexico_City');
check(instant instanceof Date && !Number.isNaN(instant.getTime()), 'instant válido');
const label = formatInterviewScheduledAtLabel(instant.toISOString(), 'America/Mexico_City');
check(label && /29/.test(label) && /10:30/.test(label), 'label org timezone');
const dateOnlyParsed = parseInterviewScheduleFields(
  { interviewDate: '2026-10-29', interviewTime: '' },
  'America/Mexico_City',
);
check(dateOnlyParsed?.timeSpecified === false, 'entrevista solo fecha');
const dateOnlyLabel = formatInterviewScheduledAtLabel(
  dateOnlyParsed.scheduledAt.toISOString(),
  'America/Mexico_City',
  { timeSpecified: false },
);
check(dateOnlyLabel && !/·/.test(dateOnlyLabel), 'label sin hora inventada');

console.log('\n=== Integración (DB) ===\n');
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
  const { ensureOrganizationRecruitmentStages } = await import('../src/services/recruitmentStage.service.js');
  const { getRecruitmentCandidate } = await import('../src/services/recruitmentCandidate.service.js');
  const { generateTimeclockAccessToken } = await import('../src/services/timeclockToken.service.js');

  const suffix = crypto.randomBytes(4).toString('hex');
  const org = await prisma.organization.create({
    data: { name: `LocInt ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  await ensureOrganizationRecruitmentStages(org.id);
  const stages = await prisma.recruitmentStage.findMany({ where: { organizationId: org.id } });
  const initialInterview = stages.find((s) => s.key === 'INITIAL_INTERVIEW');

  const pass = 'TestAdmin1!';
  const admin = await prisma.user.create({
    data: {
      email: `loc-int-${suffix}@example.com`,
      passwordHash: await hashPassword(pass),
      fullName: 'Admin',
      role: 'empresa_admin',
      organizationId: org.id,
    },
  });
  const { token, hash } = generateTimeclockAccessToken();
  const emp = await prisma.workforceEmployee.create({
    data: {
      organizationId: org.id,
      fullName: 'Recruiter',
      timezone: 'America/Mexico_City',
      accessTokenHash: hash,
      tokenVersion: 1,
      isActive: true,
    },
  });

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  function cookieFrom(res, name) {
    const raw = res.headers.getSetCookie?.() || [];
    const list = raw.length ? raw : res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [];
    for (const c of list) {
      const m = c.match(new RegExp(`${name}=([^;]+)`));
      if (m) return `${name}=${m[1]}`;
    }
    return '';
  }

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: admin.email, password: pass }),
    });
    const adminCookie = cookieFrom(login, 'mind24.sid');

    const createCand = await fetch(`${base}/api/org/recruitment/candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        fullName: 'Ubicación Test',
        profile: 'Ventas',
        whatsapp: '5511112233',
        city: 'Querétaro',
        state: 'Querétaro',
        locality: 'Centro Sur',
        neighborhood: 'Centro Sur',
      }),
    });
    const createJson = await createCand.json();
    check(createCand.status === 201, 'create candidate con locality');
    const candId = createJson.candidate?.id;

    const detail = await getRecruitmentCandidate(org.id, candId);
    check(detail.locality === 'Centro Sur' && detail.neighborhood === 'Centro Sur', 'detail locality');

    const vac = await fetch(`${base}/api/org/recruitment/vacancies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ title: 'Vac', clientName: 'C', positionsTotal: 1 }),
    });
    const vacId = (await vac.json()).vacancy?.id;

    const appRes = await fetch(`${base}/api/org/recruitment/vacancies/${vacId}/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        candidateId: candId,
        stageId: initialInterview.id,
        interviewDate: '2026-10-29',
        interviewTime: '10:30',
      }),
    });
    const appJson = await appRes.json();
    check(appRes.status === 201 && appJson.application?.interviewScheduledAt, 'application con entrevista');

    const patch = await fetch(`${base}/api/org/recruitment/applications/${appJson.application.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ interviewDate: '2026-11-01', interviewTime: '09:00' }),
    });
    const patchJson = await patch.json();
    check(patch.status === 200 && patchJson.application?.interviewScheduledAt, 'PATCH entrevista admin');

    const ex = await fetch(`${base}/api/timeclock/public/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const tcCookie = cookieFrom(ex, 'mind24.tc.sid');

    const wfCreate = await fetch(`${base}/api/timeclock/public/recruitment/candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tcCookie },
      body: JSON.stringify({
        fullName: 'Workforce Int',
        profile: 'Ventas',
        whatsapp: '5511112244',
        vacancyId: vacId,
        stageId: initialInterview.id,
        interviewDate: '2026-10-30',
        interviewTime: '11:00',
      }),
    });
    check(wfCreate.status === 201, 'workforce create con entrevista');

    const listMine = await fetch(
      `${base}/api/timeclock/public/recruitment/my-candidates?previewFilter=all`,
      { headers: { Cookie: tcCookie } },
    );
    const listJson = await listMine.json();
    const row = listJson.candidates?.find((c) => c.fullName === 'Workforce Int');
    check(row?.primaryActiveProcess?.interviewScheduledAt, 'Mis candidatos entrevista en preview');

    const patchBlock = await fetch(
      `${base}/api/timeclock/public/recruitment/applications/${appJson.application.id}`,
      { method: 'PATCH', headers: { Cookie: tcCookie } },
    );
    check(patchBlock.status === 404 || patchBlock.status === 403 || patchBlock.status === 405, 'workforce no PATCH application');

    const stagesByKey = Object.fromEntries(stages.map((s) => [s.key, s]));
    const appId = appJson.application.id;

    const toFinalist = await fetch(`${base}/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ stageId: stagesByKey.FINALIST?.id || stagesByKey.NEW?.id }),
    });
    const toFinalistJson = await toFinalist.json();
    check(
      toFinalist.status === 200 && toFinalistJson.application?.interviewScheduledAt == null,
      'integración: entrevista → FINALIST limpia fecha',
    );

    await fetch(`${base}/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        stageId: initialInterview.id,
        interviewDate: '2026-10-29',
        interviewTime: '10:30',
      }),
    });

    const toClientNoDate = await fetch(`${base}/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ stageId: stagesByKey.CLIENT_INTERVIEW.id }),
    });
    const toClientNoDateJson = await toClientNoDate.json();
    check(
      toClientNoDate.status === 200 && toClientNoDateJson.application?.interviewScheduledAt == null,
      'integración: INITIAL → CLIENT sin fecha → null',
    );

    const toClientWithDate = await fetch(`${base}/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        stageId: initialInterview.id,
        interviewDate: '2026-10-29',
        interviewTime: '10:30',
      }),
    });
    await toClientWithDate.json();

    const toClientNew = await fetch(`${base}/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        stageId: stagesByKey.CLIENT_INTERVIEW.id,
        interviewDate: '2026-11-05',
        interviewTime: '14:00',
      }),
    });
    const toClientNewJson = await toClientNew.json();
    check(
      toClientNew.status === 200 && toClientNewJson.application?.interviewScheduledAt,
      'integración: INITIAL → CLIENT con nueva fecha',
    );

    const notesOnly = await fetch(`${base}/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ notes: 'sin mover etapa' }),
    });
    const notesOnlyJson = await notesOnly.json();
    check(
      notesOnly.status === 200 &&
        notesOnlyJson.application?.interviewScheduledAt === toClientNewJson.application?.interviewScheduledAt,
      'integración: mismo stage conserva fecha',
    );

    const hiredStage = stagesByKey.HIRED;
    if (hiredStage) {
      const toHired = await fetch(`${base}/api/org/recruitment/applications/${appId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ stageId: hiredStage.id }),
      });
      const toHiredJson = await toHired.json();
      check(toHired.status === 200 && toHiredJson.application?.interviewScheduledAt == null, 'integración: → HIRED null');
    }
  } finally {
    server.close();
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

console.log('\n=== Regresiones ===\n');
for (const script of [
  'test-recruitment-candidates.mjs',
  'test-workforce-recruitment-portal.mjs',
  'test-recruitment-candidate-application-flow.mjs',
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

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment locality + interview V1.2 tests OK.\n');

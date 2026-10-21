/**
 * Recruitment CRM 1A — arquitectura + API base.
 * node server/scripts/test-recruitment-backend.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'recruitment-test-secret';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
const migrationSql = fs.readFileSync(
  path.join(rootDir, 'prisma/migrations/20261019210000_recruitment_crm_1a/migration.sql'),
  'utf8',
);
const recruitmentRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const orgRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/org.routes.js'), 'utf8');

const {
  RECRUITMENT_DEFAULT_STAGES,
  RECRUITMENT_VACANCY_STATUSES,
  ensureOrganizationRecruitmentStages,
} = await import('../src/services/recruitmentStage.service.js');
const recruitmentStageServiceSrc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentStage.service.js'),
  'utf8',
);
const recruitmentApplicationServiceSrc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentApplication.service.js'),
  'utf8',
);
const { prisma } = await import('../src/db/client.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/services/auth.service.js');
const { hashTimeclockToken, generateTimeclockAccessToken } = await import(
  '../src/services/timeclockToken.service.js'
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

function parseSetCookie(res) {
  const raw = res.headers.getSetCookie?.() || [];
  if (raw.length) return raw;
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

function cookieHeaderFromResponse(res, name) {
  for (const line of parseSetCookie(res)) {
    const part = line.split(';')[0];
    if (part.startsWith(`${name}=`)) return part;
  }
  return '';
}

async function jsonFetch(base, urlPath, { method = 'GET', body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { res, data };
}

console.log('\n=== Recruitment 1A — estático ===\n');

check(/model RecruitmentCandidate/.test(schema), 'modelo RecruitmentCandidate');
check(/model RecruitmentVacancy/.test(schema), 'modelo RecruitmentVacancy');
check(/model RecruitmentApplication/.test(schema), 'modelo RecruitmentApplication');
check(/model RecruitmentStage/.test(schema), 'modelo RecruitmentStage');
check(/model RecruitmentVacancyAssignee/.test(schema), 'modelo RecruitmentVacancyAssignee');
check(/model RecruitmentVacancyDocument/.test(schema), 'modelo RecruitmentVacancyDocument');
check(/targetCoverageDate/.test(schema), 'targetCoverageDate en schema');
check(/model RecruitmentApplicationStageEvent/.test(schema), 'modelo StageEvent');
const recruitmentCandidateBlock = schema.match(/model RecruitmentCandidate \{[\s\S]*?\n\}/)?.[0] || '';
check(!/\bstatus\b/.test(recruitmentCandidateBlock), 'sin status en Candidate');
check(/enum RecruitmentVacancyStatus/.test(schema), 'enum vacancy status');
check(/@@unique\(\[candidateId, vacancyId\]\)/.test(schema), 'unique application');
check(/CREATE TABLE "RecruitmentCandidate"/.test(migrationSql), 'migración candidatos');
check(/CREATE TABLE "RecruitmentApplicationStageEvent"/.test(migrationSql), 'migración stage events');
check(/router\.use\('\/recruitment'/.test(orgRoutes), 'mount /recruitment');
check(/\/vacancies/.test(recruitmentRoutes), 'rutas vacantes');
check(/\/candidates/.test(recruitmentRoutes), 'rutas candidatos');
check(/\/applications/.test(recruitmentRoutes), 'rutas applications');
check(RECRUITMENT_DEFAULT_STAGES.length === 9, '9 etapas default');
check(RECRUITMENT_DEFAULT_STAGES[0].key === 'NEW', 'etapa NEW');
check(RECRUITMENT_VACANCY_STATUSES.join(',') === 'ACTIVE,PAUSED,COVERED,CLOSED', 'status vacante');
const vacancySvc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentVacancy.service.js'), 'utf8');
check(/applicationSummary/.test(vacancySvc) && /buildApplicationSummariesByVacancyId/.test(vacancySvc), 'resumen vacantes agregado');
check(/@@unique\(\[organizationId, key\]\)/.test(schema), 'unique organizationId+key en Stage');
check(/skipDuplicates:\s*true/.test(recruitmentStageServiceSrc), 'seed stages skipDuplicates');
check(
  /candidato archivado/.test(recruitmentApplicationServiceSrc) &&
    /VALIDATION_ERROR/.test(recruitmentApplicationServiceSrc),
  'bloqueo candidato archivado en servicio',
);

console.log('\n=== Recruitment 1A — integración (DB) ===\n');

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP integration:', e.message);
}

async function cleanupRecruitmentOrg(orgIds) {
  await prisma.recruitmentVacancyDocument.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.recruitmentApplicationStageEvent.deleteMany({
    where: { organizationId: { in: orgIds } },
  });
  await prisma.recruitmentApplication.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.recruitmentVacancyStage.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.recruitmentVacancyAssignee.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.recruitmentVacancy.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.recruitmentCandidate.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.recruitmentStage.deleteMany({ where: { organizationId: { in: orgIds } } });
}

if (dbOk) {
  try {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE "RecruitmentVacancyStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COVERED', 'CLOSED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
  } catch {
    /* ya migrado */
  }

  const suffix = crypto.randomBytes(4).toString('hex');
  const orgA = await prisma.organization.create({
    data: { name: `Rec A ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const orgB = await prisma.organization.create({
    data: { name: `Rec B ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const adminPass = 'TestAdmin1!';
  const adminA = await prisma.user.create({
    data: {
      email: `rec-admin-a-${suffix}@example.com`,
      passwordHash: await hashPassword(adminPass),
      fullName: 'Admin Rec A',
      role: 'empresa_admin',
      organizationId: orgA.id,
    },
  });

  const { hash: hashA } = generateTimeclockAccessToken();
  const empA = await prisma.workforceEmployee.create({
    data: {
      organizationId: orgA.id,
      fullName: 'Reclutador A',
      timezone: 'America/Mexico_City',
      accessTokenHash: hashA,
      tokenVersion: 1,
      isActive: true,
    },
  });
  const { hash: hashB } = generateTimeclockAccessToken();
  const empB = await prisma.workforceEmployee.create({
    data: {
      organizationId: orgB.id,
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
    const loginA = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { email: adminA.email, password: adminPass },
    });
    const adminCookie = cookieHeaderFromResponse(loginA.res, 'mind24.sid');
    check(loginA.res.status === 200 && adminCookie, 'login empresa_admin');

    await Promise.all([
      ensureOrganizationRecruitmentStages(orgB.id),
      ensureOrganizationRecruitmentStages(orgB.id),
      ensureOrganizationRecruitmentStages(orgB.id),
    ]);
    const concurrentStageCount = await prisma.recruitmentStage.count({
      where: { organizationId: orgB.id },
    });
    check(concurrentStageCount === 9, 'seed etapas idempotente bajo concurrencia');

    const createVac = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        title: 'Supervisor de Obra',
        clientName: 'Cliente Demo',
        positionsTotal: 2,
        jobDescription: 'Descripción larga\ncon saltos',
      },
    });
    check(createVac.res.status === 201, 'crear vacante');
    const vacancyId = createVac.data.vacancy?.id;
    check(createVac.data.vacancy?.status === 'ACTIVE', 'vacante ACTIVE');

    const pauseVac = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { status: 'PAUSED' },
    });
    check(pauseVac.data.vacancy?.status === 'PAUSED', 'status PAUSED');

    const createCand = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        fullName: 'Juan Pérez',
        profile: 'Supervisor de Producción',
        phone: '5512345678',
        email: `juan-${suffix}@example.com`,
      },
    });
    check(createCand.res.status === 201, 'candidato sin vacante');
    const candidateId = createCand.data.candidate?.id;

    const assignApp = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/applications`, {
      method: 'POST',
      cookie: adminCookie,
      body: { candidateId },
    });
    check(assignApp.res.status === 201, 'asignar candidato a vacante');
    const appId = assignApp.data.application?.id;
    check(assignApp.data.application?.stage?.key === 'NEW', 'application en Nuevo');
    check(typeof assignApp.data.application?.position === 'number', 'position numérica');

    const dup = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/applications`, {
      method: 'POST',
      cookie: adminCookie,
      body: { candidateId },
    });
    check(dup.res.status === 409, 'bloqueo duplicado candidate+vacancy');

    const events1 = await prisma.recruitmentApplicationStageEvent.findMany({
      where: { applicationId: appId },
    });
    check(events1.length === 1 && events1[0].fromStageId == null, 'StageEvent inicial');

    const stages = await prisma.recruitmentStage.findMany({
      where: { organizationId: orgA.id },
      orderBy: { position: 'asc' },
    });
    check(stages.length === 9, 'etapas default en org');
    const contactStage = stages.find((s) => s.key === 'CONTACT');

    const moveStage = await jsonFetch(base, `/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { stageId: contactStage.id },
    });
    check(moveStage.res.status === 200 && moveStage.data.application?.stage?.key === 'CONTACT', 'cambio etapa');
    const events2 = await prisma.recruitmentApplicationStageEvent.findMany({
      where: { applicationId: appId },
      orderBy: { createdAt: 'asc' },
    });
    check(events2.length === 2, 'StageEvent al mover');

    const setPos = await jsonFetch(base, `/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { position: 2500 },
    });
    check(setPos.data.application?.position === 2500, 'PATCH position');

    const listApps = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/applications`, {
      cookie: adminCookie,
    });
    check(listApps.data.applications?.length === 1 && listApps.data.applications[0].candidate, 'list kanban-ready');

    const setPrimary = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/assignees`, {
      method: 'POST',
      cookie: adminCookie,
      body: { employeeId: empA.id, role: 'PRIMARY' },
    });
    check(setPrimary.res.status === 201 && setPrimary.data.assignee?.role === 'PRIMARY', 'assignee PRIMARY');

    const { hash: hashC } = generateTimeclockAccessToken();
    const empC = await prisma.workforceEmployee.create({
      data: {
        organizationId: orgA.id,
        fullName: 'Reclutador C',
        timezone: 'America/Mexico_City',
        accessTokenHash: hashC,
        tokenVersion: 1,
        isActive: true,
      },
    });
    const setPrimary2 = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/assignees`, {
      method: 'POST',
      cookie: adminCookie,
      body: { employeeId: empC.id, role: 'PRIMARY' },
    });
    check(setPrimary2.res.status === 201, 'cambiar PRIMARY');
    const primaries = await prisma.recruitmentVacancyAssignee.count({
      where: { vacancyId, role: 'PRIMARY' },
    });
    check(primaries === 1, 'solo un PRIMARY por vacante');

    const crossAssignee = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/assignees`, {
      method: 'POST',
      cookie: adminCookie,
      body: { employeeId: empB.id, role: 'PRIMARY' },
    });
    check(crossAssignee.res.status === 404, 'employee org B no en vacante org A');

    const candB = await prisma.recruitmentCandidate.create({
      data: {
        organizationId: orgB.id,
        fullName: 'Externo B',
        profile: 'Almacenista',
        phone: '5599999999',
      },
    });
    const crossApp = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/applications`, {
      method: 'POST',
      cookie: adminCookie,
      body: { candidateId: candB.id },
    });
    check(crossApp.res.status === 404, 'candidato org B no en vacante org A');

    const archive = await jsonFetch(base, `/api/org/recruitment/candidates/${candidateId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { archived: true },
    });
    check(archive.data.candidate?.archivedAt, 'archivar candidato');

    const vac2 = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        title: 'Coordinador de Mantenimiento',
        clientName: 'Cliente Demo',
        positionsTotal: 1,
      },
    });
    const vacancyId2 = vac2.data.vacancy?.id;
    const blockedArchived = await jsonFetch(
      base,
      `/api/org/recruitment/vacancies/${vacancyId2}/applications`,
      {
        method: 'POST',
        cookie: adminCookie,
        body: { candidateId },
      },
    );
    check(
      blockedArchived.res.status === 400 && blockedArchived.data?.error === 'VALIDATION_ERROR',
      'archivado no recibe nueva application',
    );

    const listAfterArchive = await jsonFetch(
      base,
      `/api/org/recruitment/vacancies/${vacancyId}/applications`,
      { cookie: adminCookie },
    );
    check(listAfterArchive.data.applications?.length === 1, 'applications previas consultables');

    const rowBefore = await prisma.recruitmentCandidate.count({ where: { id: candidateId } });
    check(rowBefore === 1, 'archivado no hard-delete');

    const otherVac = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}`, {
      cookie: adminCookie,
    });
    check(otherVac.res.status === 200, 'GET vacante by id');
    check(otherVac.data.vacancy?.applicationSummary != null, 'GET vacante incluye applicationSummary');

    const listVac = await jsonFetch(base, '/api/org/recruitment/vacancies', { cookie: adminCookie });
    check(
      listVac.data.vacancies?.[0]?.applicationSummary &&
        typeof listVac.data.vacancies[0].applicationSummary.total === 'number',
      'list vacancies con summary',
    );
  } finally {
    server.close();
    await cleanupRecruitmentOrg([orgA.id, orgB.id]);
    await prisma.workforceEmployee.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  }
}

console.log('\n=== Recruitment 1A — regresiones ===\n');

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

runRegression('test-candidate-api-confidentiality.mjs');
runRegression('test-personality-mind24-catalog.mjs');
runRegression('test-timeclock-schema-and-backend.mjs');
runRegression('test-workforce-tasks-backend.mjs');

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment backend 1A tests OK.\n');

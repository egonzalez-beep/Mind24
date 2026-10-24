/**
 * Recruitment 1D.2.1 — Candidate → Vacancy → Application → Stage
 * node server/scripts/test-recruitment-candidate-application-flow.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-cand-app-flow-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const routes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const appSvc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentApplication.service.js'), 'utf8');
const catalogSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentCandidateCatalog.service.js'),
  'utf8',
);
const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');

const { prisma } = await import('../src/db/client.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/services/auth.service.js');
const { normalizeRecruitmentCandidateFullName } = await import(
  '../src/services/recruitmentCandidateCatalog.service.js'
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

console.log('\n=== Recruitment 1D.2.1 — estático ===\n');

check(/initialStageId/.test(appSvc), 'create application acepta initialStageId');
check(/stageId: z\.string/.test(routes) && /initialStageId: body\.stageId/.test(routes), 'POST applications stageId opcional');
check(/RECRUITMENT_CANDIDATE_SOURCE_OPTIONS/.test(catalogSvc), 'catálogo source');
check(/RECRUITMENT_CANDIDATE_PROFILE_OPTIONS/.test(catalogSvc), 'catálogo profile');
check(/normalizeRecruitmentCandidateFullName/.test(catalogSvc), 'normalización fullName');
check(/@@unique\(\[candidateId, vacancyId\]\)/.test(schema), 'unique candidate+vacancy en schema');
check(/profileSecondary/.test(schema), 'schema profileSecondary');
check(/profileOther/.test(schema) && /sourceOther/.test(schema), 'schema profileOther y sourceOther');
check(
  fs.existsSync(
    path.join(rootDir, 'prisma/migrations/20261023120000_recruitment_candidate_profile_fields/migration.sql'),
  ),
  'migración profile fields',
);
check(/resolveRecruitmentCandidateSourceFields/.test(catalogSvc), 'source canónico + sourceOther');
check(/profile: 'Otro'/.test(catalogSvc), 'profile Otro canónico');

check(
  normalizeRecruitmentCandidateFullName('  JULIO   cesar  juarez ') === 'Julio Cesar Juarez',
  'fullName title case',
);

console.log('\n=== Recruitment 1D.2.1 — integración (DB) ===\n');

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP integration:', e.message);
}

async function cleanupOrg(orgId) {
  await prisma.recruitmentApplicationStageEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentApplication.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentVacancyStage.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentVacancy.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentCandidate.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentStage.deleteMany({ where: { organizationId: orgId } });
}

if (dbOk) {
  for (const mig of [
    '20261020180000_recruitment_vacancy_stages',
    '20261023120000_recruitment_candidate_profile_fields',
  ]) {
    try {
      await prisma.$executeRawUnsafe(
        fs.readFileSync(path.join(rootDir, 'prisma/migrations', mig, 'migration.sql'), 'utf8'),
      );
    } catch {
      /* ya aplicada */
    }
  }

  const suffix = crypto.randomBytes(4).toString('hex');
  const orgA = await prisma.organization.create({
    data: { name: `CandFlow A ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const orgB = await prisma.organization.create({
    data: { name: `CandFlow B ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const pass = 'TestAdmin1!';
  const adminA = await prisma.user.create({
    data: {
      email: `cflow-a-${suffix}@example.com`,
      passwordHash: await hashPassword(pass),
      fullName: 'Admin',
      role: 'empresa_admin',
      organizationId: orgA.id,
    },
  });

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { email: adminA.email, password: pass },
    });
    const cookie = cookieHeaderFromResponse(login.res, 'mind24.sid');

    const solo = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie,
      body: {
        fullName: 'ana test',
        profile: 'Ventas',
        whatsapp: '5511111111',
        source: 'Indeed',
      },
    });
    check(solo.res.status === 201, 'crear candidato sin vacante');
    check(solo.data.candidate?.fullName === 'Ana Test', 'fullName normalizado en alta');
    check(solo.data.candidate?.phone === '5511111111', 'phone técnico = whatsapp');
    check(solo.data.candidate?.source === 'Indeed', 'source canónico');
    const soloId = solo.data.candidate?.id;

    const legacyPhone = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie,
      body: {
        fullName: 'Legacy Phone',
        profile: 'Administrativo',
        phone: '5588888888',
      },
    });
    check(legacyPhone.res.status === 201, 'API legacy solo phone');
    check(
      legacyPhone.data.candidate?.whatsapp === '5588888888' &&
        legacyPhone.data.candidate?.phone === '5588888888',
      'legacy phone replica whatsapp',
    );

    const withSecondary = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie,
      body: {
        fullName: 'Sec Test',
        profile: 'Ventas',
        profileSecondary: 'Atención a clientes',
        whatsapp: '5577777777',
      },
    });
    check(withSecondary.res.status === 201, 'profileSecondary válido');
    check(
      withSecondary.data.candidate?.profileSecondary === 'Atención a clientes',
      'profileSecondary persistido',
    );

    const otroSource = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie,
      body: {
        fullName: 'Otro Src',
        profile: 'Tecnología',
        whatsapp: '5566666666',
        source: 'Otro',
        sourceOther: 'Facebook Ads',
      },
    });
    check(otroSource.data.candidate?.source === 'Otro', 'source Otro canónico');
    check(otroSource.data.candidate?.sourceOther === 'Facebook Ads', 'sourceOther detalle');
    const byOtroSource = await jsonFetch(
      base,
      '/api/org/recruitment/candidates?source=' + encodeURIComponent('Otro'),
      { cookie },
    );
    check(
      byOtroSource.data.candidates.some((c) => c.id === otroSource.data.candidate?.id),
      'filtro source=Otro',
    );

    const vac = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie,
      body: { title: 'Operador', clientName: 'Cliente X', positionsTotal: 2 },
    });
    const vacancyId = vac.data.vacancy?.id;

    const withVac = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie,
      body: {
        fullName: 'Pedro Lopez',
        profile: 'Otro',
        profileOther: 'Chofer ejecutivo',
        whatsapp: '5522222222',
        phone: '5533333333',
        source: 'Referido',
      },
    });
    const pedroId = withVac.data.candidate?.id;
    check(withVac.data.candidate?.profile === 'Otro', 'profile Otro canónico');
    check(withVac.data.candidate?.profileOther === 'Chofer ejecutivo', 'profileOther detalle');
    const byOtroProfile = await jsonFetch(
      base,
      '/api/org/recruitment/candidates?profile=' + encodeURIComponent('Otro'),
      { cookie },
    );
    check(
      byOtroProfile.data.candidates.some((c) => c.id === pedroId),
      'filtro profile=Otro',
    );
    const stagesCfg = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/stages`, {
      cookie,
    });
    const enabled = (stagesCfg.data.vacancyStages || []).filter((vs) => vs.isEnabled);
    const newStage = enabled.find((vs) => vs.stage?.key === 'NEW');
    const contactStage = enabled.find((vs) => vs.stage?.name && vs.stage.key !== 'NEW');

    const appNew = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/applications`, {
      method: 'POST',
      cookie,
      body: { candidateId: pedroId },
    });
    check(appNew.res.status === 201, 'application default NEW');
    check(appNew.data.application?.stageId === newStage?.stageId, 'stage inicial NEW');

    const dup = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/applications`, {
      method: 'POST',
      cookie,
      body: { candidateId: pedroId },
    });
    check(dup.res.status === 409 || dup.data?.error === 'CONFLICT', 'bloqueo application duplicada');
    const candCountAfterDup = await prisma.recruitmentCandidate.count({
      where: { organizationId: orgA.id, id: pedroId },
    });
    check(candCountAfterDup === 1, 'fallo application no duplica candidate');

    if (contactStage?.stage?.id) {
      const solo2 = await jsonFetch(base, '/api/org/recruitment/candidates', {
        method: 'POST',
        cookie,
        body: {
          fullName: 'Laura M',
          profile: 'Administrativo',
          whatsapp: '5544444444',
        },
      });
      const lauraId = solo2.data.candidate?.id;
      const appCustom = await jsonFetch(
        base,
        `/api/org/recruitment/vacancies/${vacancyId}/applications`,
        {
          method: 'POST',
          cookie,
          body: { candidateId: lauraId, stageId: contactStage.stage.id },
        },
      );
      check(appCustom.res.status === 201, 'application con etapa enabled distinta');
      check(
        appCustom.data.application?.stageId === contactStage.stage.id,
        'stage asignada tras evento NEW',
      );
      const events = await prisma.recruitmentApplicationStageEvent.findMany({
        where: { applicationId: appCustom.data.application?.id },
        orderBy: { createdAt: 'asc' },
      });
      check(events.length >= 2, 'historial stage events (NEW + movimiento)');
    }

    const detail = await jsonFetch(base, `/api/org/recruitment/candidates/${soloId}`, { cookie });
    check(detail.data.candidate?.applicationSummary?.total === 0, 'sin vacante summary 0');

    const pedroDetail = await jsonFetch(base, `/api/org/recruitment/candidates/${pedroId}`, {
      cookie,
    });
    check(pedroDetail.data.candidate?.applications?.length === 1, 'detalle refresca applications');

    const listApps = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/applications`, {
      cookie,
    });
    check(
      (listApps.data.applications || []).some((a) => a.candidateId === pedroId),
      'candidato visible en pipeline vacante',
    );

    const adminB = await prisma.user.create({
      data: {
        email: `cflow-b-${suffix}@example.com`,
        passwordHash: await hashPassword(pass),
        fullName: 'B',
        role: 'empresa_admin',
        organizationId: orgB.id,
      },
    });
    const loginB = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { email: adminB.email, password: pass },
    });
    const cookieB = cookieHeaderFromResponse(loginB.res, 'mind24.sid');
    const cross = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/applications`, {
      method: 'POST',
      cookie: cookieB,
      body: { candidateId: soloId },
    });
    check(cross.res.status === 404 || cross.res.status === 403, 'multi-org vacante protegida');
  } finally {
    server.close();
    await cleanupOrg(orgA.id);
    await cleanupOrg(orgB.id);
    await prisma.user.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  }
}

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

runRegression('test-recruitment-backend.mjs');
runRegression('test-recruitment-vacancy-stages.mjs');
runRegression('test-recruitment-candidates.mjs');

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment candidate application flow 1D.2.1 tests OK.\n');

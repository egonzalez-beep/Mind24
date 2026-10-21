/**
 * Recruitment 1C.2 — POST custom stages + integración con funnel.
 * node server/scripts/test-recruitment-custom-stages.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-custom-stages-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const recruitmentRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const stageSvcSrc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentStage.service.js'), 'utf8');

const {
  slugifyRecruitmentStageKeyFromName,
  createOrganizationRecruitmentStage,
  normalizeRecruitmentStageName,
} = await import('../src/services/recruitmentStage.service.js');
const { prisma } = await import('../src/db/client.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/services/auth.service.js');

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

console.log('\n=== Recruitment 1C.2 — estático ===\n');

check(/router\.post\('\/stages'/.test(recruitmentRoutes), 'POST /stages');
check(/createOrganizationRecruitmentStage/.test(stageSvcSrc), 'servicio crear stage');
check(/slugifyRecruitmentStageKeyFromName/.test(stageSvcSrc), 'generación de key');

console.log('\n=== Recruitment 1C.2 — key slug ===\n');

check(slugifyRecruitmentStageKeyFromName('Referencias laborales') === 'REFERENCIAS_LABORALES', 'slug nombre');
check(
  slugifyRecruitmentStageKeyFromName('Estudio socioeconómico') === 'ESTUDIO_SOCIOECONOMICO',
  'slug sin acentos',
);

console.log('\n=== Recruitment 1C.2 — integración (DB) ===\n');

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
  try {
    await prisma.$executeRawUnsafe(
      fs.readFileSync(
        path.join(rootDir, 'prisma/migrations/20261020180000_recruitment_vacancy_stages/migration.sql'),
        'utf8',
      ),
    );
  } catch {
    /* ya aplicada */
  }

  const suffix = crypto.randomBytes(4).toString('hex');
  const orgA = await prisma.organization.create({
    data: { name: `Custom A ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const orgB = await prisma.organization.create({
    data: { name: `Custom B ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const pass = 'TestAdmin1!';
  const adminA = await prisma.user.create({
    data: {
      email: `cust-a-${suffix}@example.com`,
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

    const created = await jsonFetch(base, '/api/org/recruitment/stages', {
      method: 'POST',
      cookie,
      body: { name: 'Referencias laborales' },
    });
    check(created.res.status === 201, 'POST custom stage 201');
    check(created.data.stage?.isTerminal === false, 'custom isTerminal=false');
    check(created.data.stage?.isActive === true, 'custom isActive=true');
    check(created.data.stage?.key === 'REFERENCIAS_LABORALES', 'key única esperada');

    const dupName = await jsonFetch(base, '/api/org/recruitment/stages', {
      method: 'POST',
      cookie,
      body: { name: '  referencias   laborales  ' },
    });
    check(dupName.res.status === 400, 'duplicado nombre org');

    const s2 = await createOrganizationRecruitmentStage(orgA.id, 'Referencias laborales extra');
    check(s2.key !== created.data.stage.key && s2.key.includes('REFERENCIAS'), 'key única por stage');

    const vac = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie,
      body: { title: 'Vac', clientName: 'C', positionsTotal: 1 },
    });
    const vacancyId = vac.data.vacancy?.id;

    const stages = await prisma.recruitmentStage.findMany({ where: { organizationId: orgA.id } });
    const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));
    const custom = stages.find((s) => s.key.startsWith('REFERENCIAS_LABORALES'));

    const put = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/stages`, {
      method: 'PUT',
      cookie,
      body: {
        stageIds: [
          byKey.NEW.id,
          byKey.CONTACT.id,
          custom.id,
          byKey.HIRED.id,
          byKey.REJECTED.id,
        ],
      },
    });
    check(put.res.status === 200, 'PUT vacante con custom stage');

    const otherOrgStage = await createOrganizationRecruitmentStage(orgB.id, 'Solo org B');
    const crossPut = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/stages`, {
      method: 'PUT',
      cookie,
      body: {
        stageIds: [byKey.NEW.id, otherOrgStage.id, byKey.HIRED.id, byKey.REJECTED.id],
      },
    });
    check(crossPut.res.status === 404, 'multi-org PUT stage ajena');

    check(normalizeRecruitmentStageName('  a  ') === 'a', 'normalize trim');
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

runRegression('test-recruitment-vacancy-stages.mjs');

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment custom stages 1C.2 tests OK.\n');

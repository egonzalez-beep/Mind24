/**
 * Recruitment 1D.1 — expediente candidato (listado, detalle, procesos).
 * node server/scripts/test-recruitment-candidates.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-candidates-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
const migrationSql = fs.readFileSync(
  path.join(rootDir, 'prisma/migrations/20261020200000_recruitment_candidate_resume/migration.sql'),
  'utf8',
);
const routes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const candidateSvc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentCandidate.service.js'), 'utf8');

const { prisma } = await import('../src/db/client.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/services/auth.service.js');
const { ensureOrganizationRecruitmentStages } = await import('../src/services/recruitmentStage.service.js');
const { findPotentialDuplicateRecruitmentCandidates } = await import(
  '../src/services/recruitmentCandidate.service.js'
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

const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');

console.log('\n=== Recruitment 1D.1 — estático candidatos ===\n');

check(/model RecruitmentCandidateResume/.test(schema), 'modelo Resume');
check(/@@unique\(\[candidateId\]\)|candidateId\s+String\s+@unique/.test(schema), 'unique CV por candidato');
check(/CREATE TABLE "RecruitmentCandidateResume"/.test(migrationSql), 'migración resume');
check(/buildApplicationSummariesByCandidateId/.test(candidateSvc), 'applicationSummary batch');
check(/nextCursor/.test(candidateSvc), 'paginación cursor');
check(/findPotentialDuplicateRecruitmentCandidates/.test(candidateSvc), 'helper duplicados');
check(/router\.get\('\/candidates'/.test(routes) && /req\.query\.q/.test(routes), 'GET list q');
check(/router\.post\('\/candidates\/check-duplicates'/.test(routes), 'POST check-duplicates');
check(/findPotentialDuplicateRecruitmentCandidates/.test(routes), 'check-duplicates usa helper');
check(!/status/.test(schema.match(/model RecruitmentCandidate \{[\s\S]*?\n\}/)?.[0] || ''), 'sin status en Candidate');
check(/recruitmentCandidateCatalog\.service/.test(candidateSvc), 'catálogo en candidate service');
check(/initialStageId/.test(fs.readFileSync(path.join(rootDir, 'src/services/recruitmentApplication.service.js'), 'utf8')), 'initialStageId application');
check(/profileSecondary/.test(schema), 'profileSecondary en schema');
check(/superRefine\(candidateContactRefine\)/.test(routes), 'contacto whatsapp o phone en POST');
const patchSchemaBlock = routes.split('const candidatePatchSchema')[1]?.split('router.get')[0] || '';
check(
  !patchSchemaBlock.includes('candidateContactRefine(data'),
  'PATCH no exige contacto en payload',
);

console.log('\n=== Recruitment 1F.1 — ficha premium candidato (estático) ===\n');

check(/rec-cand-detail-modal rec-detail-modal/.test(indexHtml), 'toolbar paridad rec-detail-modal');
check(/rec-cand-detail-arch-badge/.test(indexHtml), 'badge archivado en header');
check(/rec-cand-pipeline-hero/.test(indexHtml), 'hero proceso actual');
check(/recCandPickPrimaryApplication/.test(indexHtml), 'regla proceso principal');
check(/recCandBuildStageRailHtml/.test(indexHtml), 'stage rail');
check(/vacancyStagesCache/.test(indexHtml), 'cache stages por vacante');
check(/rec-cand-pipeline-empty/.test(indexHtml), 'sin proceso activo');
check(/rec-cand-expediente/.test(indexHtml) && !/id="rec-cand-info-grid"/.test(indexHtml), 'expediente agrupado sin info-grid');
check(/recCandProfileSecondaryLabel/.test(indexHtml), 'helper perfil secundario');
check(/recCandGoToPipeline/.test(indexHtml), 'Ver en pipeline');
check(/recCandRenderAside/.test(indexHtml), 'render lateral otros procesos');
check(/Historial/.test(indexHtml), 'histórico procesos');
check(/recCandSummaryMetaLine/.test(indexHtml), 'applicationSummary compacto');
check(!/rec-cand-mini-kpis/.test(indexHtml), 'sin KPI cards protagonistas');
check(/rec-vac-detail-btn.*recCandOpenCv|recCandOpenCv\(\).*rec-vac-detail-btn/s.test(indexHtml.replace(/\s+/g,' ')), 'CV acciones icono');
check(/id="rec-cand-toolbar-add-vac"/.test(indexHtml), '+ Añadir a vacante icono toolbar');
check(/rec-cand-toolbar-menu/.test(indexHtml) && /id="rec-cand-archive-btn"/.test(indexHtml), 'archivar en menú toolbar');
check(!/rec-cand-detail-footer/.test(indexHtml), 'sin footer archivar');
const railFn = indexHtml.match(/function recCandBuildLabeledStageRailHtml[\s\S]*?function recCandFillHeroStageSelect/)?.[0] || '';
check(/ariaState=/.test(railFn) && /tcEsc\(ariaLabel\)/.test(railFn), 'rail aria-label por etapa');
check(/rec-cand-rail-label" title=/.test(railFn), 'rail label title tooltip');

console.log('\n=== Recruitment 1F.2 — cierre visual ficha (estático) ===\n');

check(/max-width:min\(1180px/.test(indexHtml), 'modal ancho desktop');
check(/rec-cand-detail-kicker/.test(indexHtml), 'header kicker ficha');
check(/rec-cand-detail-active-badge/.test(indexHtml), 'badge activo');
check(/recCandBuildLabeledStageRailHtml/.test(indexHtml), 'stage rail etiquetado');
check(/rec-cand-labeled-rail--dense/.test(indexHtml), 'rail denso muchas etapas');
check(/recCandChangePrimaryStage/.test(indexHtml), 'cambiar etapa desde ficha');
check(/rec-cand-body-grid/.test(indexHtml), 'layout dos columnas');
check(/Expediente ejecutivo/.test(indexHtml), 'expediente ejecutivo card');
check(/rec-cand-exp-icon/.test(indexHtml), 'iconos expediente');
check(/CV y documentos/.test(indexHtml), 'CV y documentos card');
check(/Observaciones clave/.test(indexHtml), 'observaciones clave');
check(/rec-cand-body-aside/.test(indexHtml), 'columna lateral');
check(/Otros procesos/.test(indexHtml), 'otros procesos lateral');
check(!/Actividad reciente/.test(indexHtml), 'sin activity feed');
check(!/rec-cand-module-tab|Experiencia.*Formación.*Historial/.test(indexHtml.replace(/\s+/g,' ')), 'sin tabs falsas');
check(/detailPrimaryApplication/.test(indexHtml), 'estado proceso principal');

console.log('\n=== Recruitment 1D.1 — integración (DB) ===\n');

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP integration:', e.message);
}

async function cleanupOrg(orgId) {
  await prisma.recruitmentCandidateResume.deleteMany({ where: { organizationId: orgId } });
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
    '20261020200000_recruitment_candidate_resume',
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
    data: { name: `Cand A ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const orgB = await prisma.organization.create({
    data: { name: `Cand B ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const pass = 'TestAdmin1!';
  const adminA = await prisma.user.create({
    data: {
      email: `cand-a-${suffix}@example.com`,
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

    const c1 = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie,
      body: {
        fullName: 'Juan Pérez',
        profile: 'Transporte',
        whatsapp: '5512345678',
        email: `juan-${suffix}@example.com`,
        source: 'Referido',
      },
    });
    check(c1.res.status === 201, 'crear candidato');
    const candidateId = c1.data.candidate?.id;

    const patch = await jsonFetch(base, `/api/org/recruitment/candidates/${candidateId}`, {
      method: 'PATCH',
      cookie,
      body: { city: 'CDMX', notes: '  nota  ' },
    });
    check(patch.res.status === 200 && patch.data.candidate?.city === 'CDMX', 'editar candidato');

    const patchCityOnly = await jsonFetch(base, `/api/org/recruitment/candidates/${candidateId}`, {
      method: 'PATCH',
      cookie,
      body: { city: 'Querétaro' },
    });
    check(
      patchCityOnly.res.status === 200 && patchCityOnly.data.candidate?.city === 'Querétaro',
      'PATCH parcial solo city sin contacto en body',
    );
    check(patchCityOnly.data.candidate?.whatsapp === '5512345678', 'PATCH parcial conserva whatsapp');

    const otroCreate = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie,
      body: {
        fullName: 'Otro Clean',
        profile: 'Otro',
        profileOther: 'Texto legacy perfil',
        whatsapp: '5511223344',
        source: 'Otro',
        sourceOther: 'FB Ads',
      },
    });
    const otroId = otroCreate.data.candidate?.id;
    check(otroCreate.data.candidate?.profileOther === 'Texto legacy perfil', 'Otro con profileOther');

    const canonPatch = await jsonFetch(base, `/api/org/recruitment/candidates/${otroId}`, {
      method: 'PATCH',
      cookie,
      body: { profile: 'Ventas', source: 'Indeed' },
    });
    check(canonPatch.res.status === 200, 'Otro a canónico PATCH');
    check(canonPatch.data.candidate?.profile === 'Ventas', 'profile canónico');
    check(canonPatch.data.candidate?.profileOther == null, 'profileOther limpiado');
    check(canonPatch.data.candidate?.source === 'Indeed', 'source canónico');
    check(canonPatch.data.candidate?.sourceOther == null, 'sourceOther limpiado');

    await ensureOrganizationRecruitmentStages(orgA.id);
    const vac1 = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie,
      body: { title: 'Vac 1', clientName: 'C', positionsTotal: 1 },
    });
    const vac2 = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie,
      body: { title: 'Vac 2', clientName: 'C', positionsTotal: 1 },
    });
    const vacId1 = vac1.data.vacancy?.id;
    const vacId2 = vac2.data.vacancy?.id;

    await jsonFetch(base, `/api/org/recruitment/vacancies/${vacId1}/applications`, {
      method: 'POST',
      cookie,
      body: { candidateId },
    });
    const stages = await prisma.recruitmentStage.findMany({ where: { organizationId: orgA.id } });
    const hired = stages.find((s) => s.key === 'HIRED');
    const rejected = stages.find((s) => s.key === 'REJECTED');

    await jsonFetch(base, `/api/org/recruitment/vacancies/${vacId2}/applications`, {
      method: 'POST',
      cookie,
      body: { candidateId },
    });
    const apps = await prisma.recruitmentApplication.findMany({
      where: { candidateId },
      orderBy: { createdAt: 'asc' },
    });
    if (apps[1]) {
      await jsonFetch(base, `/api/org/recruitment/applications/${apps[1].id}`, {
        method: 'PATCH',
        cookie,
        body: { stageId: hired.id },
      });
    }

    const list = await jsonFetch(base, '/api/org/recruitment/candidates?limit=10', { cookie });
    check(list.res.status === 200 && list.data.candidates?.length >= 1, 'list paginado');
    const row = list.data.candidates.find((c) => c.id === candidateId);
    check(row?.applicationSummary?.total === 2, 'applicationSummary total');
    check(row?.applicationSummary?.hired === 1, 'applicationSummary hired');
    check(row?.applicationSummary?.active === 1, 'applicationSummary active');

    const search = await jsonFetch(
      base,
      '/api/org/recruitment/candidates?q=' + encodeURIComponent('juan'),
      { cookie },
    );
    check(search.data.candidates.some((c) => c.id === candidateId), 'búsqueda q');

    const byProfile = await jsonFetch(
      base,
      '/api/org/recruitment/candidates?profile=Transporte',
      { cookie },
    );
    check(byProfile.data.candidates.some((c) => c.id === candidateId), 'filtro profile');

    const bySource = await jsonFetch(
      base,
      '/api/org/recruitment/candidates?source=Referido',
      { cookie },
    );
    check(bySource.data.candidates.some((c) => c.id === candidateId), 'filtro source');

    const detail = await jsonFetch(base, `/api/org/recruitment/candidates/${candidateId}`, {
      cookie,
    });
    check(detail.data.candidate?.applications?.length === 2, 'detalle múltiples applications');
    check(detail.data.candidate?.applications[0]?.vacancy?.title, 'detalle vacancy embed');
    check(detail.data.candidate?.applications[0]?.stage?.key, 'detalle stage embed');

    await jsonFetch(base, `/api/org/recruitment/candidates/${candidateId}`, {
      method: 'PATCH',
      cookie,
      body: { archived: true },
    });
    const archivedHidden = await jsonFetch(base, '/api/org/recruitment/candidates', { cookie });
    check(!archivedHidden.data.candidates.some((c) => c.id === candidateId), 'archivado oculto en list');

    const archivedDetail = await jsonFetch(
      base,
      `/api/org/recruitment/candidates/${candidateId}`,
      { cookie },
    );
    check(
      archivedDetail.data.candidate?.applications?.length === 2,
      'archivado conserva historial',
    );

    const dups = await findPotentialDuplicateRecruitmentCandidates(orgA.id, {
      email: `juan-${suffix}@example.com`,
      phone: '5512345678',
    });
    check(dups.some((d) => d.id === candidateId), 'helper duplicados detecta email');

    const adminB = await prisma.user.create({
      data: {
        email: `cand-b-${suffix}@example.com`,
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
    const cross = await jsonFetch(base, `/api/org/recruitment/candidates/${candidateId}`, {
      cookie: cookieB,
    });
    check(cross.res.status === 404, 'multi-org detalle candidato');
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

runRegression('test-recruitment-candidate-resume.mjs');
runRegression('test-recruitment-vacancy-stages.mjs');

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment candidates 1D.1 tests OK.\n');

/**
 * Recruitment 1C.1 — funnel configurable por vacante (backend).
 * node server/scripts/test-recruitment-vacancy-stages.mjs
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
  process.env.SESSION_SECRET = 'recruitment-vacancy-stages-test';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
const migrationSql = fs.readFileSync(
  path.join(rootDir, 'prisma/migrations/20261020180000_recruitment_vacancy_stages/migration.sql'),
  'utf8',
);
const recruitmentRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const vacancyStageSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentVacancyStage.service.js'),
  'utf8',
);
const vacancySvc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentVacancy.service.js'), 'utf8');
const appSvc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentApplication.service.js'), 'utf8');

const {
  ensureVacancyRecruitmentStages,
  seedVacancyStagesFromOrganizationCatalog,
  orderActiveStagesForNewVacancySeed,
  isReferencesCatalogStage,
  REQUIRED_VACANCY_STAGE_KEYS,
  VACANCY_STAGE_POSITION_GAP,
} = await import('../src/services/recruitmentVacancyStage.service.js');
const {
  ensureOrganizationRecruitmentStages,
  createOrganizationRecruitmentStage,
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

console.log('\n=== Recruitment 1C.1 — estático ===\n');

check(/model RecruitmentVacancyStage/.test(schema), 'modelo RecruitmentVacancyStage');
check(/@@unique\(\[vacancyId, stageId\]\)/.test(schema), 'unique vacancyId+stageId');
check(/CREATE TABLE "RecruitmentVacancyStage"/.test(migrationSql), 'migración VacancyStage');
check(/router\.get\('\/stages'/.test(recruitmentRoutes), 'GET /stages');
check(/router\.get\('\/vacancies\/:vacancyId\/stages'/.test(recruitmentRoutes), 'GET vacancy stages');
check(/router\.put\('\/vacancies\/:vacancyId\/stages'/.test(recruitmentRoutes), 'PUT vacancy stages');
check(
  /listActiveOrganizationRecruitmentStages/.test(recruitmentRoutes) &&
    /recruitmentVacancyStage\.service/.test(recruitmentRoutes),
  'import list stages desde vacancyStage service',
);
check(/REQUIRED_VACANCY_STAGE_KEYS/.test(vacancyStageSvc), 'etapas obligatorias');
check(
  REQUIRED_VACANCY_STAGE_KEYS.join(',') === 'NEW,HIRED,REJECTED,INTERVIEW_NO_SHOW,APPROVED,EMPLOYMENT_EXIT',
  'NEW HIRED REJECTED INTERVIEW_NO_SHOW APPROVED EMPLOYMENT_EXIT obligatorios',
);
check(/VACANCY_STAGE_POSITION_GAP\s*=\s*1000/.test(vacancyStageSvc), 'gap position 1000');
check(/skipDuplicates:\s*true/.test(vacancyStageSvc), 'seed vacancy stages skipDuplicates');
check(/orderActiveStagesForNewVacancySeed/.test(vacancyStageSvc), 'orden inicial de vacante nueva');
check(/isReferencesCatalogStage/.test(vacancyStageSvc), 'detecta Referencias del catálogo');
check(
  /const ordered = orderActiveStagesForNewVacancySeed\(orgStages\)/.test(vacancyStageSvc.replace(/\s+/g, ' '))
    || /orderActiveStagesForNewVacancySeed\(orgStages\)/.test(vacancyStageSvc),
  'seedVacancyStages usa el orden inicial (no solo catalog.position)',
);
check(
  /if \(count > 0\) return;[\s\S]{0,80}seedVacancyStagesFromOrganizationCatalog/.test(vacancyStageSvc),
  'ensure no reescribe vacantes que ya tienen configuración',
);
check(/listEnabledVacancyStagesForDistribution/.test(vacancySvc), 'stageDistribution por vacante');
check(/assertStageEnabledForVacancy/.test(appSvc), 'move application valida funnel');
check(/ensureVacancyRecruitmentStages/.test(appSvc), 'create application ensure config');
check(/assertNewStageIsFirst/.test(vacancyStageSvc), 'guardrail NEW primero');
check(/assertTerminalStagesAtEnd/.test(vacancyStageSvc), 'guardrail terminales al final');
check(/stage\.isTerminal/.test(vacancyStageSvc), 'validación terminales vía isTerminal');

console.log('\n=== Orden seed vacante nueva (puro) ===\n');

{
  const base = [
    { id: 'n', key: 'NEW', name: 'Nuevo', position: 1000, isTerminal: false },
    { id: 'c', key: 'CONTACT', name: 'Contactación', position: 2000, isTerminal: false },
    { id: 'ii', key: 'INITIAL_INTERVIEW', name: 'Entrevista inicial', position: 3000, isTerminal: false },
    { id: 'ci', key: 'CLIENT_INTERVIEW', name: 'Entrevista cliente / supervisor', position: 4000, isTerminal: false },
    { id: 'ev', key: 'EVALUATIONS', name: 'Evaluaciones', position: 5000, isTerminal: false },
    { id: 'ps', key: 'PSYCHOMETRICS', name: 'Psicometría', position: 6000, isTerminal: false },
    { id: 'fi', key: 'FINALIST', name: 'Finalista', position: 7000, isTerminal: false },
    { id: 'ns', key: 'INTERVIEW_NO_SHOW', name: 'No asistió a entrevista', position: 7500, isTerminal: false },
    { id: 'ap', key: 'APPROVED', name: 'Aprobado', position: 7600, isTerminal: false },
    { id: 'hi', key: 'HIRED', name: 'Contratado', position: 8000, isTerminal: true },
    { id: 'ex', key: 'EMPLOYMENT_EXIT', name: 'Baja', position: 8500, isTerminal: true },
    { id: 'rj', key: 'REJECTED', name: 'Descartado', position: 9000, isTerminal: true },
  ];
  const withoutRef = orderActiveStagesForNewVacancySeed(base).map((s) => s.key);
  check(
    withoutRef.join(',') ===
      'NEW,CONTACT,INITIAL_INTERVIEW,CLIENT_INTERVIEW,EVALUATIONS,PSYCHOMETRICS,INTERVIEW_NO_SHOW,FINALIST,APPROVED,HIRED,EMPLOYMENT_EXIT,REJECTED',
    'sin Referencias: No asistió antes de Finalista→Aprobado→Contratado; Baja antes de Descartado',
  );

  const withRef = orderActiveStagesForNewVacancySeed([
    ...base,
    { id: 'ref', key: 'CUSTOM_REF', name: 'Referencias', position: 9999, isTerminal: false },
    { id: 'x2', key: 'ZETA', name: 'Zeta custom', position: 6500, isTerminal: false },
    { id: 'x1', key: 'ALPHA', name: 'Alpha custom', position: 6500, isTerminal: false },
  ]).map((s) => s.key);
  check(
    withRef.join(',') ===
      'NEW,CONTACT,INITIAL_INTERVIEW,CLIENT_INTERVIEW,EVALUATIONS,PSYCHOMETRICS,CUSTOM_REF,ALPHA,ZETA,INTERVIEW_NO_SHOW,FINALIST,APPROVED,HIRED,EMPLOYMENT_EXIT,REJECTED',
    'con Referencias + customs: Referencias tras Psicometría; customs deterministas; cartera fuera del tramo',
  );

  const dualRef = orderActiveStagesForNewVacancySeed([
    ...base,
    { id: 'ref-es', key: 'REF_ES', name: 'Referencias', position: 6100, isTerminal: false },
    { id: 'ref-en', key: 'REFERENCES', name: 'References', position: 6200, isTerminal: false },
    { id: 'x1', key: 'ALPHA', name: 'Alpha custom', position: 6500, isTerminal: false },
  ]).map((s) => s.key);
  check(
    dualRef.join(',') ===
      'NEW,CONTACT,INITIAL_INTERVIEW,CLIENT_INTERVIEW,EVALUATIONS,PSYCHOMETRICS,REF_ES,REFERENCES,ALPHA,INTERVIEW_NO_SHOW,FINALIST,APPROVED,HIRED,EMPLOYMENT_EXIT,REJECTED',
    'Referencias + References: primera tras Psicometría; la otra en personalizadas',
  );

  check(isReferencesCatalogStage({ key: 'REFERENCES', name: 'X' }), 'key REFERENCES cuenta como Referencias');
  check(isReferencesCatalogStage({ key: 'FOO', name: '  Referencias ' }), 'nombre Referencias cuenta');
  check(isReferencesCatalogStage({ key: 'FOO', name: 'References' }), 'nombre References cuenta');
  check(!isReferencesCatalogStage({ key: 'REFERENCIAS_LABORALES', name: 'Referencias laborales' }), 'Referencias laborales es custom, no el slot');
}

console.log('\n=== Recruitment 1C.1 — integración (DB) ===\n');

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
    await prisma.$executeRawUnsafe(fs.readFileSync(
      path.join(rootDir, 'prisma/migrations/20261020180000_recruitment_vacancy_stages/migration.sql'),
      'utf8',
    ));
  } catch {
    /* ya aplicada */
  }

  const suffix = crypto.randomBytes(4).toString('hex');
  const orgA = await prisma.organization.create({
    data: { name: `VS A ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const orgB = await prisma.organization.create({
    data: { name: `VS B ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const adminPass = 'TestAdmin1!';
  const adminA = await prisma.user.create({
    data: {
      email: `vs-admin-a-${suffix}@example.com`,
      passwordHash: await hashPassword(adminPass),
      fullName: 'Admin VS A',
      role: 'empresa_admin',
      organizationId: orgA.id,
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
    check(loginA.res.status === 200 && adminCookie, 'login admin');

    const catalogRes = await jsonFetch(base, '/api/org/recruitment/stages', { cookie: adminCookie });
    check(catalogRes.res.status === 200 && catalogRes.data.stages?.length === 12, 'GET catálogo 12 etapas');
    check(
      catalogRes.data.stages[0].key === 'NEW' &&
        catalogRes.data.stages.every((s) => s.isActive === true),
      'catálogo ordenado y activo',
    );

    const createVac = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        title: 'Vacante funnel A',
        clientName: 'Cliente',
        positionsTotal: 1,
      },
    });
    const vacancyId = createVac.data.vacancy?.id;
    check(createVac.res.status === 201 && vacancyId, 'crear vacante');

    const vsCount = await prisma.recruitmentVacancyStage.count({
      where: { organizationId: orgA.id, vacancyId },
    });
    check(vsCount === 12, 'vacante nueva recibe 12 VacancyStage');

    const seededOrder = await prisma.recruitmentVacancyStage.findMany({
      where: { vacancyId },
      include: { stage: true },
      orderBy: { position: 'asc' },
    });
    check(
      seededOrder.map((r) => r.stage.key).join(',') ===
        'NEW,CONTACT,INITIAL_INTERVIEW,CLIENT_INTERVIEW,EVALUATIONS,PSYCHOMETRICS,INTERVIEW_NO_SHOW,FINALIST,APPROVED,HIRED,EMPLOYMENT_EXIT,REJECTED',
      'vacante nueva sin Referencias: orden inicial esperado',
    );

    await seedVacancyStagesFromOrganizationCatalog(orgA.id, vacancyId);
    const vsCount2 = await prisma.recruitmentVacancyStage.count({
      where: { organizationId: orgA.id, vacancyId },
    });
    check(vsCount2 === 12, 'seed idempotente (sin duplicados)');

    await Promise.all([
      ensureVacancyRecruitmentStages(orgA.id, vacancyId),
      ensureVacancyRecruitmentStages(orgA.id, vacancyId),
    ]);
    check(
      (await prisma.recruitmentVacancyStage.count({ where: { vacancyId } })) === 12,
      'ensure idempotente',
    );

    const createVacB = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie: adminCookie,
      body: { title: 'Vacante funnel B', clientName: 'Cliente', positionsTotal: 1 },
    });
    const vacancyIdB = createVacB.data.vacancy?.id;

    await prisma.recruitmentVacancyStage.deleteMany({ where: { vacancyId: vacancyIdB } });
    check(
      (await prisma.recruitmentVacancyStage.count({ where: { vacancyId: vacancyIdB } })) === 0,
      'simular vacante legacy sin config',
    );

    const lazyCfg = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyIdB}/stages`, {
      cookie: adminCookie,
    });
    check(lazyCfg.res.status === 200 && lazyCfg.data.vacancyStages?.length === 12, 'lazy init en GET stages');
    check(lazyCfg.data.catalog?.length === 12, 'GET stages incluye catalog');

    const stages = await prisma.recruitmentStage.findMany({
      where: { organizationId: orgA.id },
      orderBy: { position: 'asc' },
    });
    const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));

    const requiredBaseline = (omitKey) =>
      ['NEW', 'INTERVIEW_NO_SHOW', 'APPROVED', 'HIRED', 'EMPLOYMENT_EXIT', 'REJECTED']
        .filter((k) => k !== omitKey)
        .map((k) => byKey[k].id);

    const minimalFunnel = [
      byKey.NEW.id,
      byKey.CONTACT.id,
      byKey.INTERVIEW_NO_SHOW.id,
      byKey.APPROVED.id,
      byKey.HIRED.id,
      byKey.EMPLOYMENT_EXIT.id,
      byKey.REJECTED.id,
    ];
    const putA = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/stages`, {
      method: 'PUT',
      cookie: adminCookie,
      body: { stageIds: minimalFunnel },
    });
    check(putA.res.status === 200, 'PUT funnel minimal');
    const enabledA = putA.data.vacancyStages.filter((r) => r.isEnabled);
    check(enabledA.length === 7, '7 etapas habilitadas vacante A');
    check(
      enabledA.map((r) => r.stage.key).join(',') ===
        'NEW,CONTACT,INTERVIEW_NO_SHOW,APPROVED,HIRED,EMPLOYMENT_EXIT,REJECTED',
      'orden funnel vacante A',
    );
    check(
      enabledA.every((r, i) => r.position === (i + 1) * VACANCY_STAGE_POSITION_GAP),
      'positions 1000.. en funnel A',
    );

    const customB = [
      byKey.NEW.id,
      byKey.PSYCHOMETRICS.id,
      byKey.CONTACT.id,
      byKey.INITIAL_INTERVIEW.id,
      byKey.FINALIST.id,
      byKey.INTERVIEW_NO_SHOW.id,
      byKey.APPROVED.id,
      byKey.HIRED.id,
      byKey.EMPLOYMENT_EXIT.id,
      byKey.REJECTED.id,
    ];
    const putB = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyIdB}/stages`, {
      method: 'PUT',
      cookie: adminCookie,
      body: { stageIds: customB },
    });
    check(putB.res.status === 200, 'PUT funnel custom vacante B');
    const enabledBKeys = putB.data.vacancyStages
      .filter((r) => r.isEnabled)
      .sort((a, b) => a.position - b.position)
      .map((r) => r.stage.key)
      .join(',');
    check(
      enabledBKeys ===
        'NEW,PSYCHOMETRICS,CONTACT,INITIAL_INTERVIEW,FINALIST,INTERVIEW_NO_SHOW,APPROVED,HIRED,EMPLOYMENT_EXIT,REJECTED',
      'funnels distintos entre vacantes',
    );

    // En errores de requerido: omitir solo la etapa bajo prueba.
    const missingHired = [byKey.CONTACT.id, ...requiredBaseline('HIRED')];
    const badRequired = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/stages`, {
      method: 'PUT',
      cookie: adminCookie,
      body: { stageIds: missingHired },
    });
    check(
      badRequired.res.status === 400 && /HIRED/.test(badRequired.data?.message || ''),
      'exige HIRED',
    );

    const newNotFirst = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/stages`, {
      method: 'PUT',
      cookie: adminCookie,
      body: {
        stageIds: [byKey.CONTACT.id, ...requiredBaseline()],
      },
    });
    check(
      newNotFirst.res.status === 400 &&
        /primera etapa del proceso/.test(newNotFirst.data?.message || ''),
      'NEW no primero → error',
    );

    const terminalBeforeActive = await jsonFetch(
      base,
      `/api/org/recruitment/vacancies/${vacancyId}/stages`,
      {
        method: 'PUT',
        cookie: adminCookie,
        body: {
          stageIds: [
            byKey.NEW.id,
            byKey.INTERVIEW_NO_SHOW.id,
            byKey.APPROVED.id,
            byKey.HIRED.id,
            byKey.INITIAL_INTERVIEW.id,
            byKey.EMPLOYMENT_EXIT.id,
            byKey.REJECTED.id,
          ],
        },
      },
    );
    check(
      terminalBeforeActive.res.status === 400 &&
        /terminales deben ir al final/.test(terminalBeforeActive.data?.message || ''),
      'etapa no terminal después de terminal → error',
    );

    const validRejectedBeforeHired = await jsonFetch(
      base,
      `/api/org/recruitment/vacancies/${vacancyId}/stages`,
      {
        method: 'PUT',
        cookie: adminCookie,
        body: {
          stageIds: [
            byKey.NEW.id,
            byKey.CONTACT.id,
            byKey.INITIAL_INTERVIEW.id,
            byKey.INTERVIEW_NO_SHOW.id,
            byKey.APPROVED.id,
            byKey.REJECTED.id,
            byKey.HIRED.id,
            byKey.EMPLOYMENT_EXIT.id,
          ],
        },
      },
    );
    check(validRejectedBeforeHired.res.status === 200, 'funnel válido REJECTED antes de HIRED → OK');

    const dupIds = [...minimalFunnel, minimalFunnel[0]];
    const badDup = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/stages`, {
      method: 'PUT',
      cookie: adminCookie,
      body: { stageIds: dupIds },
    });
    check(badDup.res.status === 400, 'rechaza stageIds duplicados');

    await ensureOrganizationRecruitmentStages(orgB.id);
    const stagesB = await prisma.recruitmentStage.findMany({ where: { organizationId: orgB.id } });
    const crossPut = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/stages`, {
      method: 'PUT',
      cookie: adminCookie,
      body: {
        stageIds: [
          byKey.NEW.id,
          byKey.CONTACT.id,
          stagesB[0].id,
          byKey.INTERVIEW_NO_SHOW.id,
          byKey.APPROVED.id,
          byKey.HIRED.id,
          byKey.EMPLOYMENT_EXIT.id,
          byKey.REJECTED.id,
        ],
      },
    });
    check(crossPut.res.status === 404, 'stage org B no en vacante org A');

    const cand = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        fullName: 'Candidato VS',
        profile: 'Operador',
        phone: '5511111111',
        email: `vs-cand-${suffix}@example.com`,
      },
    });
    const candidateId = cand.data.candidate?.id;

    await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/stages`, {
      method: 'PUT',
      cookie: adminCookie,
      body: {
        stageIds: [
          byKey.NEW.id,
          byKey.CONTACT.id,
          byKey.PSYCHOMETRICS.id,
          byKey.INTERVIEW_NO_SHOW.id,
          byKey.APPROVED.id,
          byKey.HIRED.id,
          byKey.EMPLOYMENT_EXIT.id,
          byKey.REJECTED.id,
        ],
      },
    });

    const appCreate = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/applications`, {
      method: 'POST',
      cookie: adminCookie,
      body: { candidateId },
    });
    const appId = appCreate.data.application?.id;
    check(appCreate.data.application?.stage?.key === 'NEW', 'application en NEW');

    const movePsych = await jsonFetch(base, `/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { stageId: byKey.PSYCHOMETRICS.id },
    });
    check(movePsych.res.status === 200, 'mover a PSYCHOMETRICS');

    const events = await prisma.recruitmentApplicationStageEvent.count({ where: { applicationId: appId } });
    check(events >= 2, 'StageEvent al mover');

    // Omite solo PSYCHOMETRICS (tiene candidatos); el resto de obligatorias sí van.
    const blockDisable = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/stages`, {
      method: 'PUT',
      cookie: adminCookie,
      body: {
        stageIds: [
          byKey.NEW.id,
          byKey.CONTACT.id,
          byKey.INTERVIEW_NO_SHOW.id,
          byKey.APPROVED.id,
          byKey.HIRED.id,
          byKey.EMPLOYMENT_EXIT.id,
          byKey.REJECTED.id,
        ],
      },
    });
    check(
      blockDisable.res.status === 400 &&
        /candidatos asignados/.test(blockDisable.data?.message || ''),
      'no deshabilitar etapa con applications',
    );

    await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/stages`, {
      method: 'PUT',
      cookie: adminCookie,
      body: {
        stageIds: [
          byKey.NEW.id,
          byKey.PSYCHOMETRICS.id,
          byKey.INTERVIEW_NO_SHOW.id,
          byKey.APPROVED.id,
          byKey.HIRED.id,
          byKey.EMPLOYMENT_EXIT.id,
          byKey.REJECTED.id,
        ],
      },
    });

    const moveDisabled = await jsonFetch(base, `/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { stageId: byKey.CONTACT.id },
    });
    check(
      moveDisabled.res.status === 400 &&
        /no está habilitada/.test(moveDisabled.data?.message || ''),
      'no mover a etapa deshabilitada para vacante',
    );

    const detail = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}`, {
      cookie: adminCookie,
    });
    const dist = detail.data.vacancy?.stageDistribution || [];
    check(
      dist.length === 7 &&
        dist.map((d) => d.key).join(',') ===
          'NEW,PSYCHOMETRICS,INTERVIEW_NO_SHOW,APPROVED,HIRED,EMPLOYMENT_EXIT,REJECTED',
      'stageDistribution solo enabled y orden vacancy',
    );
    check(
      dist.find((d) => d.key === 'PSYCHOMETRICS')?.count === 1,
      'counts en stageDistribution',
    );

    // Vacante existente conserva su orden editable (no se reescribe con el seed nuevo).
    const existingCustomOrder = [
      byKey.NEW.id,
      byKey.PSYCHOMETRICS.id,
      byKey.CONTACT.id,
      byKey.INTERVIEW_NO_SHOW.id,
      byKey.FINALIST.id,
      byKey.APPROVED.id,
      byKey.HIRED.id,
      byKey.EMPLOYMENT_EXIT.id,
      byKey.REJECTED.id,
    ];
    const putExisting = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/stages`, {
      method: 'PUT',
      cookie: adminCookie,
      body: { stageIds: existingCustomOrder },
    });
    check(putExisting.res.status === 200, 'vacante existente: guardar orden propio');
    const existingKeysBefore = putExisting.data.vacancyStages
      .filter((r) => r.isEnabled)
      .map((r) => r.stage.key)
      .join(',');
    await ensureVacancyRecruitmentStages(orgA.id, vacancyId);
    await seedVacancyStagesFromOrganizationCatalog(orgA.id, vacancyId);
    const existingAfter = await prisma.recruitmentVacancyStage.findMany({
      where: { vacancyId, isEnabled: true },
      include: { stage: true },
      orderBy: { position: 'asc' },
    });
    check(
      existingAfter.map((r) => r.stage.key).join(',') === existingKeysBefore
        && existingKeysBefore ===
          'NEW,PSYCHOMETRICS,CONTACT,INTERVIEW_NO_SHOW,FINALIST,APPROVED,HIRED,EMPLOYMENT_EXIT,REJECTED',
      'vacante existente conserva orden propio tras ensure/seed',
    );

    // Vacante nueva con Referencias + personalizadas (posiciones empatadas).
    const refStage = await createOrganizationRecruitmentStage(orgA.id, 'Referencias');
    const customAlpha = await createOrganizationRecruitmentStage(orgA.id, 'Alpha custom');
    const customZeta = await createOrganizationRecruitmentStage(orgA.id, 'Zeta custom');
    await prisma.recruitmentStage.updateMany({
      where: { id: { in: [customAlpha.id, customZeta.id] } },
      data: { position: 6500 },
    });
    const createVacRef = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie: adminCookie,
      body: { title: 'Vacante con Referencias', clientName: 'Cliente', positionsTotal: 1 },
    });
    const vacancyRefId = createVacRef.data.vacancy?.id;
    check(createVacRef.res.status === 201 && vacancyRefId, 'crear vacante con Referencias en catálogo');
    const refSeeded = await prisma.recruitmentVacancyStage.findMany({
      where: { vacancyId: vacancyRefId, isEnabled: true },
      include: { stage: true },
      orderBy: { position: 'asc' },
    });
    const refKeys = refSeeded.map((r) => r.stage.key);
    const psychIdx = refKeys.indexOf('PSYCHOMETRICS');
    const refIdx = refKeys.indexOf(refStage.key);
    const alphaIdx = refKeys.indexOf(customAlpha.key);
    const zetaIdx = refKeys.indexOf(customZeta.key);
    const noShowIdx = refKeys.indexOf('INTERVIEW_NO_SHOW');
    const finalistIdx = refKeys.indexOf('FINALIST');
    const approvedIdx = refKeys.indexOf('APPROVED');
    const hiredIdx = refKeys.indexOf('HIRED');
    const exitIdx = refKeys.indexOf('EMPLOYMENT_EXIT');
    const rejectedIdx = refKeys.indexOf('REJECTED');
    check(
      psychIdx >= 0
        && refIdx === psychIdx + 1
        && alphaIdx === refIdx + 1
        && zetaIdx === alphaIdx + 1
        && noShowIdx === zetaIdx + 1
        && finalistIdx === noShowIdx + 1
        && approvedIdx === finalistIdx + 1
        && hiredIdx === approvedIdx + 1
        && exitIdx === hiredIdx + 1
        && rejectedIdx === exitIdx + 1,
      'vacante nueva con Referencias+customs: orden Psicometría→Referencias→customs→No asistió→Finalista→Aprobado→Contratado→Baja→Descartado',
    );

    try {
      await prisma.recruitmentVacancyStage.create({
        data: {
          organizationId: orgA.id,
          vacancyId,
          stageId: byKey.CONTACT.id,
          position: 99999,
          isEnabled: false,
        },
      });
      check(false, 'unique vacancyId+stageId en DB');
    } catch {
      check(true, 'unique vacancyId+stageId en DB');
    }
  } finally {
    server.close();
    await cleanupRecruitmentOrg([orgA.id, orgB.id]);
    await prisma.user.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  }
}

console.log('\n=== Regresiones Recruitment ===\n');

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

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment vacancy stages 1C.1 tests OK.\n');

/**
 * Fecha de ingreso / confirmación de contratación — unitario sin PG obligatorio.
 * node server/scripts/test-recruitment-hire-start-date.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(serverDir, '..');
dotenv.config({ path: path.join(serverDir, '.env') });
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'hire-start-date-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const {
  parseEmploymentStartDateInput,
  employmentStartDateToPrisma,
  serializeEmploymentStartDate,
  assertEmploymentStartDateForOrg,
} = await import('../src/services/recruitmentApplication.service.js');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

console.log('\n=== Fecha de ingreso — parse / serialize ===\n');

check(parseEmploymentStartDateInput('2024-03-15') === '2024-03-15', 'parse válido');
check(parseEmploymentStartDateInput(' 2024-03-15 ') === '2024-03-15', 'parse con espacios');
check(parseEmploymentStartDateInput('2024-02-30') == null, 'día inexistente');
check(parseEmploymentStartDateInput('24-03-15') == null, 'formato corto');
check(parseEmploymentStartDateInput('') == null, 'vacío');
check(parseEmploymentStartDateInput(null) == null, 'null');

const prismaDate = employmentStartDateToPrisma('2024-03-15');
check(prismaDate instanceof Date && serializeEmploymentStartDate(prismaDate) === '2024-03-15', 'round-trip sin corrimiento');
check(serializeEmploymentStartDate(new Date('2024-03-15T00:00:00.000Z')) === '2024-03-15', 'serialize UTC midnight');
check(serializeEmploymentStartDate(null) == null, 'serialize null');

{
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  check(parseEmploymentStartDateInput(today) === today, 'hoy parsea');
}

console.log('\n=== Schema / migración / API ===\n');

const schema = fs.readFileSync(path.join(serverDir, 'prisma/schema.prisma'), 'utf8');
const migPath = path.join(
  serverDir,
  'prisma/migrations/20261118140000_recruitment_employment_start_date/migration.sql',
);
check(fs.existsSync(migPath), 'migración aditiva existe');
const mig = fs.readFileSync(migPath, 'utf8');
check(/ADD COLUMN "employmentStartDate" DATE/.test(mig), 'columna DATE');
const migSql = mig
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');
check(!/NOT NULL|DEFAULT|UPDATE|BACKFILL/i.test(migSql), 'sin default, null forzado ni backfill');
check(/employmentStartDate\s+DateTime\?\s+@db\.Date/.test(schema), 'schema employmentStartDate');
check(/hiredStageEnteredAt DateTime\?/.test(schema), 'hiredStageEnteredAt intacto');

const appSvc = fs.readFileSync(path.join(serverDir, 'src/services/recruitmentApplication.service.js'), 'utf8');
check(/assertEmploymentStartDateForOrg/.test(appSvc), 'validación en servicio');
check(/movingToHired|editingHireDateOnly/.test(appSvc), 'contratar vs editar fecha');
check(
  /employmentStartDate/.test(appSvc) &&
    !/hiredStageEnteredAt\s*=\s*employmentStartDate/.test(appSvc),
  'no mezcla fechas',
);

const routes = fs.readFileSync(path.join(serverDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
check(/employmentStartDate: z\.string\(\)\.max\(10\)/.test(routes), 'PATCH/create aceptan employmentStartDate');
check(/assertEmpresaAdmin/.test(routes.slice(routes.indexOf("router.patch('/applications/:id'"))), 'PATCH admin');

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(serverDir, 'public/index.html'));
check(Buffer.from(indexHtml).equals(publicHtml) || indexHtml === publicHtml.toString('utf8'), 'HTML espejo');

console.log('\n=== UI confirmación y edición ===\n');

check(/id="modal-rec-hire-confirm"/.test(indexHtml), 'modal confirmar contratación');
check(/Confirmar contratación/.test(indexHtml), 'título/CTA');
check(/¿Confirmas que/.test(indexHtml) || /Confirmas que/.test(indexHtml), 'copy confirmación');
check(/Fecha de ingreso/.test(indexHtml), 'campo fecha de ingreso');
check(/recHireConfirmCancel/.test(indexHtml) && /recHireConfirmSubmit/.test(indexHtml), 'cancelar/confirmar');
check(!/window\.confirm\([^\)]*contrat/i.test(indexHtml), 'sin window.confirm para contratar');
check(/targetStageKey==='HIRED'/.test(indexHtml), 'Kanban intercepta HIRED');
check(/recKanbanCommitStageMove/.test(indexHtml), 'mueve tarjeta solo tras commit');
check(/newKey==='HIRED'/.test(indexHtml), 'ficha intercepta HIRED');
check(/dataset\.recBusy/.test(indexHtml.slice(indexHtml.indexOf('async function recHireConfirmSubmit'), indexHtml.indexOf('function recCandCloseDecline'))), 'doble clic bloqueado');
check(/aria-label="Editar fecha de ingreso"/.test(indexHtml) && /title="Editar fecha de ingreso"/.test(indexHtml), 'edición en historial (lápiz accesible)');
check(/rec-hire-start-edit[\s\S]*?recCandObsIconEdit\(\)/.test(indexHtml), 'botón lápiz junto a la fecha');
check(/Sin registrar/.test(indexHtml), 'sin fecha muestra Sin registrar');
check(/rec-hire-start-value--set/.test(indexHtml) && /rec-hire-start-value--empty/.test(indexHtml), 'verde discreto vs tono neutro');
check(/m\[3\]\+'\/'\+m\[2\]\+'\/'\+m\[1\]/.test(indexHtml), 'formato DD/MM/AAAA solo desde employmentStartDate');
check(/isHired\?''/.test(indexHtml) || /resultBlock=isHired\?''/.test(indexHtml), 'historial contratado sin bloque CONTRATADO');
check(/!isHired&&stageName/.test(indexHtml), 'sin Última etapa: Contratado en historial hired');
check(/recCandSaveEmploymentStart/.test(indexHtml), 'guardar fecha sin mover etapa');
check(/employmentStartDate:date/.test(indexHtml), 'PATCH solo employmentStartDate en edición');

const portalSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/workforceRecruitmentPortal.service.js'),
  'utf8',
);
check(
  !/Editar fecha de ingreso/.test(
    indexHtml.match(/tcEmp|workforce|Mi espacio[\s\S]{0,200}/)?.[0] || '',
  ) || /recCandEmploymentStartHtml/.test(indexHtml),
  'edición en expediente admin (historial compartido)',
);

console.log('\n=== Integración opcional (PG) ===\n');

let dbOk = false;
try {
  const { prisma } = await import('../src/db/client.js');
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;

  const { createApp } = await import('../src/app.js');
  const { hashPassword } = await import('../src/services/auth.service.js');
  const { ensureOrganizationRecruitmentStages } = await import(
    '../src/services/recruitmentStage.service.js'
  );
  const suffix = Date.now().toString(36);
  const org = await prisma.organization.create({
    data: { name: `HireStart ${suffix}`, slug: `hire-${suffix}`, credits: 10 },
  });
  const pass = 'Test1234!';
  const admin = await prisma.user.create({
    data: {
      email: `hire-${suffix}@example.com`,
      passwordHash: await hashPassword(pass),
      fullName: 'Admin Hire',
      role: 'empresa_admin',
      organizationId: org.id,
    },
  });
  await ensureOrganizationRecruitmentStages(org.id);
  const stages = await prisma.recruitmentStage.findMany({ where: { organizationId: org.id } });
  const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));
  const vac = await prisma.recruitmentVacancy.create({
    data: {
      organizationId: org.id,
      title: `Vac hire ${suffix}`,
      status: 'ACTIVE',
      positionsTotal: 1,
      clientName: 'C',
    },
  });
  const cand = await prisma.recruitmentCandidate.create({
    data: {
      organizationId: org.id,
      fullName: 'Contratado Test',
      profile: 'Ventas',
      phone: '4421002003',
      whatsapp: '4421002003',
    },
  });

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  async function jsonFetch(urlPath, { method = 'GET', body, cookie } = {}) {
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
  function cookieFrom(res) {
    const raw = res.headers.getSetCookie?.() || [];
    for (const line of raw) {
      const part = line.split(';')[0];
      if (part.startsWith('mind24.sid=')) return part;
    }
    const single = res.headers.get('set-cookie');
    return single ? single.split(';')[0] : '';
  }

  try {
    const login = await jsonFetch('/api/auth/login', {
      method: 'POST',
      body: { email: admin.email, password: pass },
    });
    const cookie = cookieFrom(login.res);
    const created = await jsonFetch(`/api/org/recruitment/vacancies/${vac.id}/applications`, {
      method: 'POST',
      cookie,
      body: { candidateId: cand.id },
    });
    check(created.res.status === 201, 'app creada en NEW');
    const appId = created.data.application?.id;

    const noDate = await jsonFetch(`/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      cookie,
      body: { stageId: byKey.HIRED.id },
    });
    check(noDate.res.status === 400, 'HIRED sin fecha rechaza');

    const future = await jsonFetch(`/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      cookie,
      body: { stageId: byKey.HIRED.id, employmentStartDate: '2099-01-01' },
    });
    check(future.res.status === 400, 'fecha futura rechaza');

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const ok = await jsonFetch(`/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      cookie,
      body: { stageId: byKey.HIRED.id, employmentStartDate: today },
    });
    check(
      ok.res.status === 200 &&
        ok.data.application?.stage?.key === 'HIRED' &&
        ok.data.application?.employmentStartDate === today,
      'confirma contratación con hoy',
    );
    check(ok.data.application?.hiredStageEnteredAt, 'conserva hiredStageEnteredAt');

    const edit = await jsonFetch(`/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      cookie,
      body: { employmentStartDate: '2020-06-01' },
    });
    check(
      edit.res.status === 200 &&
        edit.data.application?.employmentStartDate === '2020-06-01' &&
        edit.data.application?.stage?.key === 'HIRED',
      'edita fecha sin cambiar etapa',
    );
    const hiredAt = ok.data.application.hiredStageEnteredAt;
    check(edit.data.application?.hiredStageEnteredAt === hiredAt, 'no altera hiredStageEnteredAt');

    const runners = await Promise.all([1, 2, 3].map((number) => prisma.recruitmentCandidate.create({
      data: { organizationId: org.id, fullName: `Cupo ${number}`, phone: `442199200${number}`, profile: 'Ventas' },
    })));
    const vacancyUrl = `/api/org/recruitment/vacancies/${vac.id}`;
    const applicationUrl = `${vacancyUrl}/applications`;
    const hireBody = { stageId: byKey.HIRED.id, employmentStartDate: today };
    const apply = (candidateId, body = {}) => jsonFetch(applicationUrl, {
      method: 'POST', cookie, body: { candidateId, ...body },
    });
    const moveToHired = (id) => jsonFetch(`/api/org/recruitment/applications/${id}`, {
      method: 'PATCH', cookie, body: hireBody,
    });
    const isCapacityConflict = ({ res, data }) => res.status === 409 && data?.error === 'VACANCY_HIRE_CAPACITY';
    const [firstApplicant, secondApplicant] = await Promise.all(runners.slice(0, 2).map((candidate) => apply(candidate.id)));
    const firstId = firstApplicant.data.application?.id;
    const secondId = secondApplicant.data.application?.id;
    const blocked = await moveToHired(firstId);
    check(isCapacityConflict(blocked), 'el contratado reciente ya ocupa el último lugar');
    const direct = await apply(runners[2].id, hireBody);
    check(isCapacityConflict(direct), 'alta directa a Contratado también bloqueada');
    const directRows = await prisma.recruitmentApplication.count({ where: { candidateId: runners[2].id } });
    check(directRows === 0, 'el alta rechazada revierte la postulación inicial');
    const blockedRow = await prisma.recruitmentApplication.findUnique({ where: { id: firstId } });
    check(blockedRow?.stageId === byKey.NEW.id && !blockedRow.hiredStageEnteredAt, 'el movimiento bloqueado conserva etapa y fecha');

    const covered = await jsonFetch(vacancyUrl, { method: 'PATCH', cookie, body: { status: 'COVERED' } });
    check(covered.res.status === 200 && isCapacityConflict(await moveToHired(firstId)), 'Cubierta y sin posiciones impide contratar');
    const expanded = await jsonFetch(vacancyUrl, {
      method: 'PATCH', cookie, body: { positionsTotal: 2, status: 'ACTIVE' },
    });
    check(expanded.res.status === 200, 'ampliar posiciones permite reabrir');
    const outcomes = await Promise.all([moveToHired(firstId), moveToHired(secondId)]);
    check(outcomes.filter(({ res }) => res.status === 200).length === 1 && outcomes.filter(isCapacityConflict).length === 1,
      'dos contrataciones simultáneas por una posición producen un éxito y un bloqueo');

    const otherOrg = await prisma.organization.create({
      data: { name: `Other ${suffix}`, slug: `o-${suffix}`, credits: 1 },
    });
    const otherAdmin = await prisma.user.create({
      data: {
        email: `other-hire-${suffix}@example.com`,
        passwordHash: await hashPassword(pass),
        fullName: 'Other',
        role: 'empresa_admin',
        organizationId: otherOrg.id,
      },
    });
    const loginB = await jsonFetch('/api/auth/login', {
      method: 'POST',
      body: { email: otherAdmin.email, password: pass },
    });
    const cookieB = cookieFrom(loginB.res);
    const cross = await jsonFetch(`/api/org/recruitment/applications/${appId}`, {
      method: 'PATCH',
      cookie: cookieB,
      body: { employmentStartDate: '2020-01-01' },
    });
    check(cross.res.status === 404, 'otra organización sin escritura');

    await prisma.user.deleteMany({ where: { organizationId: otherOrg.id } });
    await prisma.organization.delete({ where: { id: otherOrg.id } });
  } finally {
    server.close();
    await prisma.recruitmentApplication.deleteMany({ where: { organizationId: org.id } });
    await prisma.recruitmentCandidate.deleteMany({ where: { organizationId: org.id } });
    await prisma.recruitmentVacancy.deleteMany({ where: { organizationId: org.id } });
    await prisma.recruitmentStage.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
} catch (e) {
  if (dbOk) check(false, `integración: ${e.message || e}`);
  else console.log('  SKIP integration:', e.message || e);
}

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Hire start date tests OK.\n');

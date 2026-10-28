/**
 * Recruitment — resultado de entrevista V1 (ATTENDED / NO_SHOW / RESCHEDULED).
 * node server/scripts/test-recruitment-interview-events.mjs
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
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-int-ev-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(serverDir, 'prisma/schema.prisma'), 'utf8');
const migration = fs.readFileSync(
  path.join(serverDir, 'prisma/migrations/20261027190000_recruitment_application_interview_event/migration.sql'),
  'utf8',
);
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const routes = fs.readFileSync(path.join(serverDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const publicRoutes = fs.readFileSync(path.join(serverDir, 'src/routes/timeclock.public.routes.js'), 'utf8');
const eventSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/recruitmentApplicationInterviewEvent.service.js'),
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

console.log('\n=== Schema / migración ===\n');
check(/RecruitmentApplicationInterviewEvent/.test(schema), 'modelo InterviewEvent');
check(/ATTENDED/.test(schema) && /NO_SHOW/.test(schema) && /RESCHEDULED/.test(schema), 'enum eventType');
check(/RecruitmentApplicationInterviewEvent/.test(migration), 'SQL migración');
check(!/DROP TABLE "RecruitmentApplication"/.test(migration), 'sin borrar applications');

console.log('\n=== Servicio / API ===\n');
check(/\$transaction/.test(eventSvc), 'transacción Prisma');
check(/updateMany/.test(eventSvc), 'update condicional atómico');
check(/INTERVIEW_EVENT_STALE_MESSAGE/.test(eventSvc), 'mensaje stale 409');
check(/debe ser diferente a la actual/.test(eventSvc), 'RESCHEDULE no-op');
check(/interviewScheduledAt: null/.test(eventSvc), 'ATTENDED/NO_SHOW limpian cita');
check(/eventType: 'RESCHEDULED'/.test(eventSvc), 'RESCHEDULED actualiza cita');
check(/createdByUserId/.test(eventSvc) && !/req\.body\.createdByUserId/.test(routes), 'autor desde sesión');
check(/\/applications\/:applicationId\/interview-events/.test(routes), 'POST interview-events admin');
check(!/\/interview-events/.test(publicRoutes), 'Workforce sin write interview-events');

console.log('\n=== UI Candidate Detail ===\n');
check(/recCandSubmitInterviewEvent/.test(indexHtml), 'acciones entrevista');
check(/recCandHeroInterviewOutcomeActionsHtml/.test(indexHtml), 'Asistió / No show / Reagendar');
check(/recCandHeroInterviewHistoryHtml/.test(indexHtml), 'historial entrevistas');
check(/recCandInterviewCheckSvg/.test(indexHtml), 'SVG outline acciones');
check(/httpStatus===409/.test(indexHtml), 'UI refresca en 409');

console.log('\n=== Unit slots / stale ===\n');
const {
  interviewScheduleSlotsEqual,
  INTERVIEW_EVENT_STALE_MESSAGE,
  recordRecruitmentApplicationInterviewEvent,
} = await import('../src/services/recruitmentApplicationInterviewEvent.service.js');
const d1 = new Date('2026-10-29T16:30:00.000Z');
const d2 = new Date('2026-10-29T16:30:00.000Z');
check(interviewScheduleSlotsEqual(d1, true, d2, true), 'misma fecha+hora');
check(!interviewScheduleSlotsEqual(d1, true, d2, false), 'misma fecha distinto timeSpecified');
check(
  INTERVIEW_EVENT_STALE_MESSAGE.includes('Actualiza'),
  'texto stale para administrador',
);

console.log('\n=== Unit timezone (reagendar) ===\n');
const { parseInterviewScheduleFields } = await import(
  '../src/services/recruitmentInterviewSchedule.service.js'
);
const dateOnly = parseInterviewScheduleFields(
  { interviewDate: '2026-10-31', interviewTime: '' },
  'America/Mexico_City',
);
check(dateOnly?.timeSpecified === false, 'reagendar fecha sin hora');
const withTime = parseInterviewScheduleFields(
  { interviewDate: '2026-10-31', interviewTime: '15:30' },
  'America/Mexico_City',
);
check(withTime?.timeSpecified === true && /15/.test(String(withTime.scheduledAt)), 'reagendar con hora');

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

  const suffix = crypto.randomBytes(4).toString('hex');
  const org = await prisma.organization.create({
    data: { name: `IntEv ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  await ensureOrganizationRecruitmentStages(org.id);
  const stages = await prisma.recruitmentStage.findMany({ where: { organizationId: org.id } });
  const initial = stages.find((s) => s.key === 'INITIAL_INTERVIEW');
  const pass = 'TestAdmin1!';
  const admin = await prisma.user.create({
    data: {
      email: `int-ev-${suffix}@example.com`,
      passwordHash: await hashPassword(pass),
      fullName: 'Admin',
      role: 'empresa_admin',
      organizationId: org.id,
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
    const cookie = cookieFrom(login, 'mind24.sid');

    const cand = await fetch(`${base}/api/org/recruitment/candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ fullName: 'Int Ev', profile: 'Ventas', whatsapp: '5511113300' }),
    });
    const candId = (await cand.json()).candidate?.id;

    const vac = await fetch(`${base}/api/org/recruitment/vacancies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'V', clientName: 'C', positionsTotal: 1 }),
    });
    const vacId = (await vac.json()).vacancy?.id;

    const appRes = await fetch(`${base}/api/org/recruitment/vacancies/${vacId}/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        candidateId: candId,
        stageId: initial.id,
        interviewDate: '2026-10-29',
        interviewTime: '10:30',
      }),
    });
    const applicationId = (await appRes.json()).application?.id;

    async function postInterviewEvent(body) {
      return fetch(
        `${base}/api/org/recruitment/applications/${applicationId}/interview-events`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify(body),
        },
      );
    }

    const evCount = async () =>
      prisma.recruitmentApplicationInterviewEvent.count({ where: { applicationId } });

    const noopRes = await postInterviewEvent({
      eventType: 'RESCHEDULED',
      interviewDate: '2026-10-29',
      interviewTime: '10:30',
    });
    check(noopRes.status === 400, 'RESCHEDULE misma fecha/hora → 400');
    const noopBody = await noopRes.json();
    check(
      String(noopBody.message || '').includes('diferente'),
      'mensaje no-op reschedule',
    );
    check((await evCount()) === 0, 'no-op sin evento');

    const [att1, att2] = await Promise.all([
      postInterviewEvent({ eventType: 'ATTENDED' }),
      postInterviewEvent({ eventType: 'ATTENDED' }),
    ]);
    const attStatuses = [att1.status, att2.status].sort((a, b) => a - b);
    check(attStatuses[0] === 201 && attStatuses[1] === 409, 'ATTENDED concurrente: 201 + 409');
    check((await evCount()) === 1, 'ATTENDED concurrente: un solo evento');

    let appRow = await prisma.recruitmentApplication.findUnique({ where: { id: applicationId } });
    check(!appRow.interviewScheduledAt && appRow.stageId === initial.id, 'ATTENDED limpia cita, stage igual');

    await prisma.recruitmentApplication.update({
      where: { id: applicationId },
      data: {
        interviewScheduledAt: new Date('2026-10-30T16:30:00.000Z'),
        interviewTimeSpecified: true,
      },
    });

    const [rs1, rs2] = await Promise.all([
      postInterviewEvent({
        eventType: 'RESCHEDULED',
        interviewDate: '2026-11-01',
        interviewTime: '',
      }),
      postInterviewEvent({
        eventType: 'RESCHEDULED',
        interviewDate: '2026-11-02',
        interviewTime: '',
      }),
    ]);
    const rsStatuses = [rs1.status, rs2.status].sort((a, b) => a - b);
    check(rsStatuses[0] === 201 && rsStatuses[1] === 409, 'RESCHEDULE concurrente: 201 + 409');
    const afterParallel = await prisma.recruitmentApplication.findUnique({ where: { id: applicationId } });
    check(afterParallel.interviewTimeSpecified === false, 'RESCHEDULE ganador deja fecha sin hora');
    check((await evCount()) === 2, 'RESCHEDULE concurrente: +1 evento (total 2)');

    const orgTz = await (
      await import('../src/services/organizationTimezone.service.js')
    ).resolveOrganizationIanaTimezone(org.id);
    const dateOnlySlot = parseInterviewScheduleFields(
      { interviewDate: '2026-11-15', interviewTime: '' },
      orgTz,
    );
    await prisma.recruitmentApplication.update({
      where: { id: applicationId },
      data: {
        interviewScheduledAt: dateOnlySlot.scheduledAt,
        interviewTimeSpecified: false,
      },
    });
    const noopDateOnly = await postInterviewEvent({
      eventType: 'RESCHEDULED',
      interviewDate: '2026-11-15',
      interviewTime: '',
    });
    check(noopDateOnly.status === 400, 'RESCHEDULE misma fecha sin hora → 400');
    check((await evCount()) === 2, 'no-op fecha sin hora sin evento extra');

    await prisma.recruitmentApplication.update({
      where: { id: applicationId },
      data: {
        interviewScheduledAt: new Date('2026-10-30T16:30:00.000Z'),
        interviewTimeSpecified: true,
      },
    });
    const beforeRollback = await evCount();

    let rollbackThrew = false;
    try {
      await recordRecruitmentApplicationInterviewEvent({
        organizationId: org.id,
        applicationId,
        eventType: 'ATTENDED',
        createdByUserId: '00000000-0000-0000-0000-000000000099',
      });
    } catch (e) {
      rollbackThrew = true;
    }
    check(rollbackThrew, 'evento con autor inválido falla');
    appRow = await prisma.recruitmentApplication.findUnique({ where: { id: applicationId } });
    check(!!appRow.interviewScheduledAt, 'rollback: cita intacta tras fallo evento');
    check((await evCount()) === beforeRollback, 'rollback: sin evento extra');

    await prisma.recruitmentApplication.update({
      where: { id: applicationId },
      data: {
        interviewScheduledAt: new Date('2026-10-30T16:30:00.000Z'),
        interviewTimeSpecified: true,
      },
    });

    const [ns1, ns2] = await Promise.all([
      postInterviewEvent({ eventType: 'NO_SHOW' }),
      postInterviewEvent({ eventType: 'NO_SHOW' }),
    ]);
    const nsStatuses = [ns1.status, ns2.status].sort((a, b) => a - b);
    check(nsStatuses[0] === 201 && nsStatuses[1] === 409, 'NO_SHOW concurrente: 201 + 409');
    check((await evCount()) === beforeRollback + 1, 'NO_SHOW concurrente: un solo evento nuevo');

    await prisma.recruitmentApplication.update({
      where: { id: applicationId },
      data: {
        interviewScheduledAt: new Date('2026-10-30T16:30:00.000Z'),
        interviewTimeSpecified: true,
      },
    });

    const reschedule = await fetch(
      `${base}/api/org/recruitment/applications/${applicationId}/interview-events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          eventType: 'RESCHEDULED',
          interviewDate: '2026-11-01',
          interviewTime: '',
        }),
      },
    );
    check(reschedule.status === 201, 'RESCHEDULED 201');
    const afterRes = await prisma.recruitmentApplication.findUnique({ where: { id: applicationId } });
    check(!!afterRes.interviewScheduledAt && afterRes.interviewTimeSpecified === false, 'RESCHEDULED fecha sin hora');

    const detail = await getRecruitmentCandidate(org.id, candId);
    const proc = detail.applications.find((a) => a.applicationId === applicationId);
    check((proc.interviewEvents || []).length >= 2, 'detail incluye interviewEvents');

    const dup = await fetch(
      `${base}/api/org/recruitment/applications/${applicationId}/interview-events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ eventType: 'NO_SHOW' }),
      },
    );
    check(dup.status >= 400, 'NO_SHOW sin cita → error');
  } finally {
    server.close();
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

console.log('\n=== Regresiones ===\n');
for (const script of [
  'test-recruitment-locality-interview.mjs',
  'test-recruitment-candidate-collaboration.mjs',
  'test-recruitment-candidates.mjs',
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
console.log('\n✓ Recruitment interview events V1 tests OK.\n');

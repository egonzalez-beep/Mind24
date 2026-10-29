/**
 * Recurrencia de metas — fechas inyectables (DAILY / WEEKLY / MONTHLY).
 * node server/scripts/test-workforce-goals-recurrence.mjs
 */
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'goals-recurrence-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const { prisma } = await import('../src/db/client.js');
const {
  createWorkforceGoalForEmployee,
  ensureWorkforceGoalPeriodsUpToDate,
  reportWorkforceGoalPeriod,
  derivePeriodDisplayStatus,
} = await import('../src/services/workforceGoal.service.js');
const {
  periodBoundsFromAnchor,
  periodAnchorYmd,
  weekStartYmd,
  monthStartYmd,
  countPeriodAnchorsInclusive,
} = await import('../src/utils/workforceGoalPeriod.util.js');
const { hashPassword } = await import('../src/services/auth.service.js');
const { archiveWorkforceGoal } = await import('../src/services/workforceGoal.service.js');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else console.log(`  OK  ${msg}`);
}

console.log('\n=== Metas — recurrencia (unit, sin DB) ===\n');

check(periodAnchorYmd('DAILY', '2026-10-29') === '2026-10-29', 'ancla diaria 29 oct');
check(weekStartYmd('2026-10-28') === '2026-10-26', 'ancla semanal lunes anterior');
check(monthStartYmd('2026-10-15') === '2026-10-01', 'ancla mensual octubre');
check(countPeriodAnchorsInclusive('2026-10-29', '2026-10-30', 'DAILY') === 2, '29→30 dos periodos diarios');

async function runScenario({ label, periodicity, startYmd, reportYmd, nextYmd, tz }) {
  const suffix = crypto.randomBytes(3).toString('hex');
  const org = await prisma.organization.create({
    data: { name: `Rec ${label} ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const admin = await prisma.user.create({
    data: {
      email: `rec-${label}-${suffix}@example.com`,
      passwordHash: await hashPassword('TestAdmin1!'),
      fullName: 'Admin',
      role: 'empresa_admin',
      organizationId: org.id,
    },
  });
  const emp = await prisma.workforceEmployee.create({
    data: {
      organizationId: org.id,
      fullName: 'Colab',
      timezone: tz,
      accessTokenHash: crypto.randomBytes(16).toString('hex'),
      tokenVersion: 1,
      isActive: true,
    },
  });

  try {
    const goalRow = await createWorkforceGoalForEmployee({
      organizationId: org.id,
      employeeId: emp.id,
      createdByUserId: admin.id,
      title: `Meta ${label}`,
      goalType: 'COMPLIANCE',
      periodicity,
      startDate: startYmd,
      endDate: null,
    });

    const goal = await prisma.workforceGoal.findUnique({ where: { id: goalRow.id } });
    const reportAnchor = periodAnchorYmd(periodicity, reportYmd);
    const { periodStart: reportStart } = periodBoundsFromAnchor(reportAnchor, periodicity, tz);
    await ensureWorkforceGoalPeriodsUpToDate(goal, emp, new Date(`${reportYmd}T15:00:00.000Z`));

    const reportPeriod = await prisma.workforceGoalPeriod.findFirst({
      where: { goalId: goal.id, periodStart: reportStart },
    });
    check(!!reportPeriod, `${label}: existe periodo a reportar`);

    await reportWorkforceGoalPeriod({
      employee: emp,
      periodId: reportPeriod.id,
      binaryResult: 'MET',
    });
    const goalAfterReport = await prisma.workforceGoal.findUnique({ where: { id: goal.id } });
    check(!goalAfterReport?.archivedAt, `${label}: reportar no archiva meta`);

    const nextNow = new Date(`${nextYmd}T10:00:00.000Z`);
    await ensureWorkforceGoalPeriodsUpToDate(goal, emp, nextNow);

    const nextAnchor = periodAnchorYmd(periodicity, nextYmd);
    const { periodStart: nextStart } = periodBoundsFromAnchor(nextAnchor, periodicity, tz);
    const prev = await prisma.workforceGoalPeriod.findFirst({
      where: { goalId: goal.id, periodStart: reportStart },
    });
    const next = await prisma.workforceGoalPeriod.findFirst({
      where: { goalId: goal.id, periodStart: nextStart },
    });

    check(prev?.binaryResult === 'MET', `${label}: periodo anterior cumplido en historial`);
    check(next && next.binaryResult == null, `${label}: nuevo periodo pendiente`);
    check(
      derivePeriodDisplayStatus(goal, next, nextNow) === 'PENDING',
      `${label}: nuevo periodo estado PENDING`,
    );
  } finally {
    await prisma.workforceGoalPeriod.deleteMany({ where: { organizationId: org.id } });
    await prisma.workforceGoal.deleteMany({ where: { organizationId: org.id } });
    await prisma.workforceEmployee.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

async function runEndDateBlocksRenewal({ tz }) {
  const suffix = crypto.randomBytes(3).toString('hex');
  const org = await prisma.organization.create({
    data: { name: `Rec end ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const admin = await prisma.user.create({
    data: {
      email: `rec-end-${suffix}@example.com`,
      passwordHash: await hashPassword('TestAdmin1!'),
      fullName: 'Admin',
      role: 'empresa_admin',
      organizationId: org.id,
    },
  });
  const emp = await prisma.workforceEmployee.create({
    data: {
      organizationId: org.id,
      fullName: 'Colab',
      timezone: tz,
      accessTokenHash: crypto.randomBytes(16).toString('hex'),
      tokenVersion: 1,
      isActive: true,
    },
  });
  try {
    const goalRow = await createWorkforceGoalForEmployee({
      organizationId: org.id,
      employeeId: emp.id,
      createdByUserId: admin.id,
      title: 'Meta fin',
      goalType: 'COMPLIANCE',
      periodicity: 'DAILY',
      startDate: '2026-10-29',
      endDate: '2026-10-29',
    });
    const goal = await prisma.workforceGoal.findUnique({ where: { id: goalRow.id } });
    const before = await prisma.workforceGoalPeriod.count({ where: { goalId: goal.id } });
    await ensureWorkforceGoalPeriodsUpToDate(goal, emp, new Date('2026-10-31T12:00:00.000Z'));
    const after = await prisma.workforceGoalPeriod.count({ where: { goalId: goal.id } });
    check(before === after && before === 1, 'endDate impide periodo posterior');
  } finally {
    await prisma.workforceGoalPeriod.deleteMany({ where: { organizationId: org.id } });
    await prisma.workforceGoal.deleteMany({ where: { organizationId: org.id } });
    await prisma.workforceEmployee.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

async function runArchivedBlocksRenewal({ tz }) {
  const suffix = crypto.randomBytes(3).toString('hex');
  const org = await prisma.organization.create({
    data: { name: `Rec arch ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const admin = await prisma.user.create({
    data: {
      email: `rec-arch-${suffix}@example.com`,
      passwordHash: await hashPassword('TestAdmin1!'),
      fullName: 'Admin',
      role: 'empresa_admin',
      organizationId: org.id,
    },
  });
  const emp = await prisma.workforceEmployee.create({
    data: {
      organizationId: org.id,
      fullName: 'Colab',
      timezone: tz,
      accessTokenHash: crypto.randomBytes(16).toString('hex'),
      tokenVersion: 1,
      isActive: true,
    },
  });
  try {
    const goalRow = await createWorkforceGoalForEmployee({
      organizationId: org.id,
      employeeId: emp.id,
      createdByUserId: admin.id,
      title: 'Meta arch',
      goalType: 'COMPLIANCE',
      periodicity: 'DAILY',
      startDate: '2026-10-29',
      endDate: null,
    });
    await archiveWorkforceGoal({ organizationId: org.id, goalId: goalRow.id });
    const goal = await prisma.workforceGoal.findUnique({ where: { id: goalRow.id } });
    const before = await prisma.workforceGoalPeriod.count({ where: { goalId: goal.id } });
    await ensureWorkforceGoalPeriodsUpToDate(goal, emp, new Date('2026-11-05T12:00:00.000Z'));
    const after = await prisma.workforceGoalPeriod.count({ where: { goalId: goal.id } });
    check(before === after, 'archivedAt impide periodo posterior');
  } finally {
    await prisma.workforceGoalPeriod.deleteMany({ where: { organizationId: org.id } });
    await prisma.workforceGoal.deleteMany({ where: { organizationId: org.id } });
    await prisma.workforceEmployee.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

console.log('\n=== Metas — recurrencia (integración DB, opcional) ===\n');

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP:', e.message);
}

if (dbOk) {
  const tz = 'America/Mexico_City';
  await runScenario({
    label: 'daily',
    periodicity: 'DAILY',
    startYmd: '2026-10-29',
    reportYmd: '2026-10-29',
    nextYmd: '2026-10-30',
    tz,
  });
  await runScenario({
    label: 'weekly',
    periodicity: 'WEEKLY',
    startYmd: '2026-10-26',
    reportYmd: '2026-10-28',
    nextYmd: '2026-11-02',
    tz,
  });
  await runScenario({
    label: 'monthly',
    periodicity: 'MONTHLY',
    startYmd: '2026-10-01',
    reportYmd: '2026-10-15',
    nextYmd: '2026-11-01',
    tz,
  });
  await runEndDateBlocksRenewal({ tz });
  await runArchivedBlocksRenewal({ tz });
} else {
  console.log('  Integración DB omitida: lógica de anclas validada arriba; escenarios DAILY/WEEKLY/MONTHLY pendientes de Postgres.');
}

console.log(failed === 0 ? '\n✓ Recurrence tests OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);

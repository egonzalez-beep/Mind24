/**
 * Recordatorio diario de metas del colaborador.
 * node server/scripts/test-workforce-daily-goals-reminder.mjs
 *
 * La integración contra Postgres se marca SKIP si no hay base o si la migración
 * nueva no está aplicada. SKIP no certifica dedupe, transacción ni aislamiento.
 */
import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'workforce-daily-goals-reminder-test-secret';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
const migration = fs.readFileSync(
  path.join(rootDir, 'prisma/migrations/20261105153000_workforce_daily_goals_reminder/migration.sql'),
  'utf8',
);
const reminderSrc = fs.readFileSync(
  path.join(rootDir, 'src/services/workforceDailyGoalsReminder.service.js'),
  'utf8',
);
const inboxSrc = fs.readFileSync(path.join(rootDir, 'src/services/workforceWorkplaceInbox.service.js'), 'utf8');
const orgNotifSrc = fs.readFileSync(path.join(rootDir, 'src/services/orgNotification.service.js'), 'utf8');
const publicRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.public.routes.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(rootDir, 'src/server.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');

const {
  buildDailyGoalsReminderCopy,
  buildDailyGoalsReminderMessage,
  compactGoalTitle,
  dailyGoalsReminderDedupeKey,
  emitDailyGoalsReminder,
  goalAppliesOnLocalDate,
  localClock,
  dailyGoalNeedsReminder,
  DAILY_GOALS_REMINDER_SWEEP_MS,
  resolveReminderTimeZone,
  runDailyGoalsReminderSweepTick,
  selectDailyReminderPlans,
  sweepDailyGoalReminders,
  GOAL_TITLE_MAX,
} = await import('../src/services/workforceDailyGoalsReminder.service.js');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

const AT_10_MX = new Date('2026-11-05T16:00:00.000Z');
const BEFORE_10_MX = new Date('2026-11-05T15:59:00.000Z');
const INSIDE_MX = new Date('2026-11-05T20:00:00.000Z');
const AT_18_MX = new Date('2026-11-06T00:00:00.000Z');
const AFTER_18_MX = new Date('2026-11-06T00:01:00.000Z');
const NEXT_DAY_MX = new Date('2026-11-06T16:00:00.000Z');

function employee(overrides = {}) {
  return {
    id: 'emp1',
    isActive: true,
    timezone: 'America/Mexico_City',
    organizationId: 'org1',
    organization: { blocked: false, empresaPortalEnabled: true },
    ...overrides,
  };
}

function goal(overrides = {}) {
  const emp = overrides.employee || employee();
  return {
    id: 'g1',
    title: 'Llamadas',
    periodicity: 'DAILY',
    goalType: 'COMPLIANCE',
    archivedAt: null,
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: null,
    organizationId: emp.organizationId || 'org1',
    employeeId: emp.id,
    employee: emp,
    ...overrides,
  };
}

function period(now, overrides = {}) {
  return {
    periodStart: new Date(now.getTime() - 60 * 1000),
    periodEnd: new Date(now.getTime() + 60 * 60 * 1000),
    binaryResult: null,
    achievedValue: null,
    targetSnapshot: 10,
    ...overrides,
  };
}

function plansFor(now, goals, periods) {
  const periodsByGoalId = new Map();
  goals.forEach((item, index) => {
    const row = Array.isArray(periods) ? periods[index] : periods;
    if (row) periodsByGoalId.set(item.id, row);
  });
  return selectDailyReminderPlans({ now, goals, periodsByGoalId });
}

console.log('\n=== Elegibilidad y copy ===\n');

check(plansFor(AT_10_MX, [], []).length === 0, 'sin metas no hay aviso');
check(
  plansFor(AT_10_MX, [goal({ id: 'w', periodicity: 'WEEKLY' }), goal({ id: 'm', periodicity: 'MONTHLY' })], period(AT_10_MX)).length === 0,
  'solo semanales o mensuales no hay aviso',
);

const one = plansFor(AT_10_MX, [goal()], period(AT_10_MX));
check(one.length === 1, 'una meta diaria pendiente genera un plan');
const oneCopy = buildDailyGoalsReminderCopy(one[0].goals);
check(oneCopy.title === 'Meta pendiente para hoy', 'título singular');
check(oneCopy.body === 'No olvides registrar tu avance en «Llamadas».', 'mensaje singular');

const manyGoals = [goal({ id: 'a', title: 'Llamadas' }), goal({ id: 'b', title: 'Visitas' }), goal({ id: 'c', title: 'Cierres' })];
const many = plansFor(AT_10_MX, manyGoals, period(AT_10_MX));
check(many.length === 1 && many[0].goals.length === 3, 'varias metas diarias quedan en un solo plan');
const manyCopy = buildDailyGoalsReminderCopy(many[0].goals);
check(manyCopy.title === 'Tienes 3 metas para hoy', 'título plural con el número');
check(manyCopy.body === 'No olvides registrar tus avances.', 'mensaje plural');

const reported = goal();
check(
  plansFor(AT_10_MX, [reported], period(AT_10_MX, { binaryResult: 'MET' })).length === 0,
  'cumplida no entra',
);
check(
  plansFor(AT_10_MX, [reported], period(AT_10_MX, { binaryResult: 'NOT_MET' })).length === 0,
  'reportada como no cumplida no entra',
);
const partialGoal = goal({ id: 'p', goalType: 'QUANTITATIVE', title: 'Llamadas' });
const partial = plansFor(
  AT_10_MX,
  [partialGoal],
  period(AT_10_MX, { achievedValue: 4, targetSnapshot: 10 }),
);
check(partial.length === 0, 'DAILY PARTIAL no genera aviso');
check(one.length === 1 && one[0].goals.length === 1, 'una DAILY PENDING genera aviso singular');
const mixed = plansFor(
  AT_10_MX,
  [goal({ id: 'pend', title: 'Llamadas' }), partialGoal],
  [period(AT_10_MX), period(AT_10_MX, { achievedValue: 4, targetSnapshot: 10 })],
);
check(mixed.length === 1 && mixed[0].goals.length === 1, 'la mezcla cuenta únicamente PENDING');
check(buildDailyGoalsReminderCopy(mixed[0].goals).title === 'Meta pendiente para hoy', 'el número no incluye la parcial');
check(
  plansFor(AT_10_MX, [
    goal({ id: 'met' }),
    partialGoal,
    goal({ id: 'zero', goalType: 'QUANTITATIVE' }),
  ], [
    period(AT_10_MX, { binaryResult: 'MET' }),
    period(AT_10_MX, { achievedValue: 4, targetSnapshot: 10 }),
    period(AT_10_MX, { achievedValue: 0, targetSnapshot: 10 }),
  ]).length === 0,
  'si todas tienen algún resultado no hay aviso',
);
const overduePeriod = period(AT_10_MX, { periodEnd: new Date(AT_10_MX.getTime() - 1000) });
check(plansFor(AT_10_MX, [goal()], overduePeriod).length === 0, 'OVERDUE no genera aviso');
check(!dailyGoalNeedsReminder(goal(), overduePeriod, AT_10_MX), 'un periodo vencido sin resultado no se recuerda');
check(
  plansFor(AT_10_MX, [partialGoal], period(AT_10_MX, { achievedValue: 10, targetSnapshot: 10 })).length === 0,
  'cuantitativa cumplida no entra',
);
check(
  plansFor(AT_10_MX, [partialGoal], period(AT_10_MX, { achievedValue: 0, targetSnapshot: 10 })).length === 0,
  'cuantitativa en cero ya reportada no entra',
);
check(
  plansFor(AT_10_MX, [goal({ archivedAt: new Date('2026-11-01T00:00:00.000Z') })], period(AT_10_MX)).length === 0,
  'meta archivada no entra',
);
check(
  plansFor(AT_10_MX, [goal({ endDate: new Date('2026-11-04T00:00:00.000Z') })], period(AT_10_MX)).length === 0,
  'meta fuera de vigencia no entra',
);
check(
  plansFor(AT_10_MX, [goal({ startDate: new Date('2026-11-06T00:00:00.000Z') })], period(AT_10_MX)).length === 0,
  'periodo de vigencia futuro no entra',
);
check(
  plansFor(AT_10_MX, [goal({ employee: employee({ isActive: false }) })], period(AT_10_MX)).length === 0,
  'colaborador inactivo no recibe aviso',
);
check(
  plansFor(AT_10_MX, [goal({ employee: employee({ organization: { blocked: true, empresaPortalEnabled: true } }) })], period(AT_10_MX)).length === 0,
  'organización bloqueada no recibe aviso',
);
check(
  plansFor(AT_10_MX, [goal({ employee: employee({ organization: { blocked: false, empresaPortalEnabled: false } }) })], period(AT_10_MX)).length === 0,
  'organización sin portal no recibe aviso',
);
check(
  plansFor(AT_10_MX, [goal()], period(AT_10_MX, { periodStart: new Date(AT_10_MX.getTime() + 60 * 1000) })).length === 0,
  'periodo que todavía no inicia no entra',
);
check(
  plansFor(AT_10_MX, [goal()], period(AT_10_MX, { periodEnd: new Date(AT_10_MX.getTime() - 1000) })).length === 0,
  'periodo ya cerrado no entra',
);

console.log('\n=== Horario y zona ===\n');

check(plansFor(BEFORE_10_MX, [goal()], period(BEFORE_10_MX)).length === 0, 'antes de las 10:00 no hay aviso');
check(plansFor(AT_10_MX, [goal()], period(AT_10_MX)).length === 1, 'exactamente a las 10:00 hay aviso');
check(plansFor(INSIDE_MX, [goal()], period(INSIDE_MX)).length === 1, 'dentro de la ventana hay aviso recuperable');
check(plansFor(AT_18_MX, [goal()], period(AT_18_MX)).length === 0, 'a las 18:00 no hay aviso');
check(plansFor(AFTER_18_MX, [goal()], period(AFTER_18_MX)).length === 0, 'después de las 18:00 no hay aviso');

const utcSplit = localClock(AT_18_MX, 'America/Mexico_City');
check(utcSplit.ymd === '2026-11-05', 'el día local no sigue el día UTC');
check(utcSplit.minutes === 18 * 60, '18:00 local se calcula en la zona, no con sumas de 24 h');
check(localClock(new Date('2026-03-01T16:00:00.000Z'), 'America/Mexico_City').ymd === '2026-03-01', 'cambio de mes');
check(localClock(new Date('2026-01-01T16:00:00.000Z'), 'America/Mexico_City').ymd === '2026-01-01', 'cambio de año');
check(
  plansFor(new Date('2026-03-01T16:00:00.000Z'), [goal({ endDate: new Date('2026-02-28T00:00:00.000Z') })], period(new Date('2026-03-01T16:00:00.000Z'))).length === 0,
  'el día local siguiente al fin de mes no reutiliza la vigencia anterior',
);

const nyAt10 = new Date('2026-11-05T15:00:00.000Z');
const nyBefore = new Date('2026-11-05T14:59:00.000Z');
check(localClock(nyAt10, 'America/New_York').ymd === '2026-11-05', 'segunda zona válida conserva su fecha local');
check(
  plansFor(nyAt10, [goal({ employee: employee({ timezone: 'America/New_York' }) })], period(nyAt10)).length === 1,
  'America/New_York a las 10:00 recibe aviso',
);
check(
  plansFor(nyBefore, [goal({ employee: employee({ timezone: 'America/New_York' }) })], period(nyBefore)).length === 0,
  'America/New_York antes de las 10:00 no recibe aviso',
);
check(resolveReminderTimeZone('No/EsUnaZona') === 'America/Mexico_City', 'zona inválida cae en America/Mexico_City');
check(
  plansFor(AT_10_MX, [goal({ employee: employee({ timezone: 'No/EsUnaZona' }) })], period(AT_10_MX)).length === 1,
  'zona inválida no tumba el cálculo y usa el horario de respaldo',
);
check(
  plansFor(BEFORE_10_MX, [goal({ employee: employee({ timezone: 'No/EsUnaZona' }) })], period(BEFORE_10_MX)).length === 0,
  'el respaldo no adelanta el aviso a la hora de otra zona',
);
check(!reminderSrc.includes('organization.timezone'), 'no se inventa una zona de organización');

const next = plansFor(NEXT_DAY_MX, [goal()], period(NEXT_DAY_MX));
check(next.length === 1 && next[0].localDateKey === '2026-11-06', 'el día siguiente usa otra fecha local');
check(
  dailyGoalsReminderDedupeKey('emp1', '2026-11-05') !== dailyGoalsReminderDedupeKey('emp1', '2026-11-06'),
  'la clave del día siguiente es distinta',
);

const isolated = plansFor(AT_10_MX, [
  goal({ id: 'g-a', employee: employee({ id: 'emp-a', organizationId: 'org-a' }) }),
  goal({ id: 'g-b', employee: employee({ id: 'emp-b', organizationId: 'org-a' }) }),
  goal({ id: 'g-c', employee: employee({ id: 'emp-c', organizationId: 'org-b' }) }),
], period(AT_10_MX));
check(isolated.length === 3, 'dos colaboradores y dos organizaciones quedan aislados');
check(new Set(isolated.map((plan) => plan.organizationId)).size === 2, 'las organizaciones no comparten el plan');
check(new Set(isolated.map((plan) => plan.employeeId)).size === 3, 'cada colaborador tiene su plan');

console.log('\n=== Copy seguro y dedupe en memoria ===\n');

const hostile = buildDailyGoalsReminderCopy([goal({ title: '<img src=x onerror="alert(1)">' })]);
check(hostile.body.includes('«<img src=x onerror="alert(1)">»'), 'el nombre hostil queda como texto');
check(!hostile.body.includes('<script'), 'el aviso no construye HTML');
const longTitle = 'Á'.repeat(120);
const longCopy = buildDailyGoalsReminderCopy([goal({ title: longTitle })]);
const quoted = longCopy.body.match(/«(.+)»/);
check(quoted && [...quoted[1]].length === GOAL_TITLE_MAX, 'el nombre largo se recorta al límite');
check(compactGoalTitle('   ') === '', 'el nombre vacío se descarta');
const generic = buildDailyGoalsReminderCopy([goal({ title: '   ' })]);
check(generic.title === 'Tienes metas para hoy' && generic.body === 'No olvides registrar tus avances.', 'nombre inválido usa el texto genérico');
for (const word of ['Vencida', 'Incumplimiento', 'Atrasada', 'Última oportunidad', 'Debes completar']) {
  check(!buildDailyGoalsReminderMessage(oneCopy).includes(word), `el copy no dice ${word}`);
}

function memoryInbox() {
  const rows = new Map();
  return {
    rows,
    workforceWorkplaceInbox: {
      async upsert({ where, create }) {
        const key = `${where.organizationId_dedupeKey.organizationId}|${where.organizationId_dedupeKey.dedupeKey}`;
        await new Promise((resolve) => setTimeout(resolve, 15));
        if (rows.has(key)) {
          const err = new Error('unique');
          err.code = 'P2002';
          err.meta = { target: ['organizationId', 'dedupeKey'] };
          throw err;
        }
        const row = { id: `row-${rows.size + 1}`, ...create };
        rows.set(key, row);
        return row;
      },
      async findUnique({ where }) {
        const key = `${where.organizationId_dedupeKey.organizationId}|${where.organizationId_dedupeKey.dedupeKey}`;
        return rows.get(key) || null;
      },
      async findMany() {
        return [...rows.values()].map((row) => ({
          organizationId: row.organizationId,
          dedupeKey: row.dedupeKey,
        }));
      },
    },
  };
}

const inbox = memoryInbox();
const plan = {
  organizationId: 'org1',
  employeeId: 'emp1',
  localDateKey: '2026-11-05',
  goals: [goal({ title: 'Llamadas' })],
};
const first = await emitDailyGoalsReminder(inbox, plan);
const second = await emitDailyGoalsReminder(inbox, {
  ...plan,
  goals: [goal({ id: 'g2', title: 'Otra meta' }), goal({ id: 'g3', title: 'Tercera' })],
});
check(inbox.rows.size === 1, 'una segunda ejecución no duplica');
check(second.id === first.id && second.message === first.message, 'el primer aviso permanece estable');
check(first.message === 'Meta pendiente para hoy No olvides registrar tu avance en «Llamadas».', 'el mensaje guardado une título y cuerpo');
check(first.metadata.goalId === 'g1' && first.metadata.pendingCount === 1 && !('goalsView' in first.metadata), 'una sola meta guarda referencia opcional y no pide Completadas');

const concurrent = memoryInbox();
const pair = await Promise.all([
  emitDailyGoalsReminder(concurrent, plan),
  emitDailyGoalsReminder(concurrent, plan),
]);
check(concurrent.rows.size === 1 && pair[0].id === pair[1].id, 'dos ejecuciones concurrentes dejan un aviso');

const instances = memoryInbox();
const raced = await Promise.all([
  emitDailyGoalsReminder(instances, plan),
  emitDailyGoalsReminder(instances, { ...plan, goals: [goal({ title: '<b>otra</b>' })] }),
]);
check(instances.rows.size === 1 && raced[0].message === raced[1].message, 'dos instancias simuladas dejan el primer aviso');

const otherEmployee = await emitDailyGoalsReminder(inbox, { ...plan, employeeId: 'emp2' });
const otherOrg = await emitDailyGoalsReminder(inbox, { ...plan, organizationId: 'org2' });
const nextDay = await emitDailyGoalsReminder(inbox, { ...plan, localDateKey: '2026-11-06' });
check(otherEmployee.id !== first.id && otherOrg.id !== first.id && nextDay.id !== first.id, 'otro colaborador, otra organización y el día siguiente son avisos distintos');

let foreignUnique = false;
try {
  await emitDailyGoalsReminder({
    workforceWorkplaceInbox: {
      async upsert() {
        const err = new Error('unique email');
        err.code = 'P2002';
        err.meta = { target: ['email'] };
        throw err;
      },
      async findUnique() {
        return null;
      },
    },
  }, plan);
} catch (err) {
  foreignUnique = err?.code === 'P2002';
}
check(foreignUnique, 'un conflicto único distinto del dedupe se propaga');

console.log('\n=== Barrido ===\n');

let sweepCalls = 0;
const overlapping = runDailyGoalsReminderSweepTick(
  () =>
    new Promise((resolve) => {
      sweepCalls += 1;
      setTimeout(resolve, 30);
    }),
);
const skipped = await runDailyGoalsReminderSweepTick(() => {
  sweepCalls += 1;
  return { planned: 1 };
});
await overlapping;
check(skipped.skipped === true && sweepCalls === 1, 'dos ticks del mismo proceso no se solapan');

let recovered = 0;
await runDailyGoalsReminderSweepTick(() => {
  throw new Error('boom');
});
await runDailyGoalsReminderSweepTick(() => {
  recovered += 1;
  return { planned: 0 };
});
check(recovered === 1, 'un error libera la bandera y el siguiente tick corre');

const fakeNow = AT_10_MX;
const openGoal = goal();
const activeEmployee = employee();
function sweepFixture({ goals = [openGoal], periods = [], inboxRows = [], employees = [activeEmployee], onGoal, onPeriod } = {}) {
  return {
    workforceEmployee: { async findMany() { return employees; } },
    workforceWorkplaceInbox: { async findMany() { return inboxRows; } },
    workforceGoal: {
      async findMany() {
        if (onGoal) onGoal();
        return goals;
      },
    },
    workforceGoalPeriod: {
      async findMany() {
        if (onPeriod) onPeriod();
        return periods;
      },
    },
  };
}
const emitted = [];
const missing = await sweepDailyGoalReminders(fakeNow, {
  db: sweepFixture(),
  ensurePeriods: async () => {},
  emit: async (_db, item) => emitted.push(item),
});
check(missing.ensured === 1 && missing.planned === 0 && emitted.length === 0, 'sin periodo reportable no se emite el aviso');

const withPeriod = await sweepDailyGoalReminders(fakeNow, {
  db: sweepFixture({ periods: [{ ...period(fakeNow), goalId: openGoal.id }] }),
  ensurePeriods: async () => {
    throw new Error('no debía materializar');
  },
  emit: async (_db, item) => emitted.push(item),
});
check(withPeriod.planned === 1 && withPeriod.ensured === 0 && emitted.length === 1, 'tick dentro de la ventana crea el aviso sin materializar si el periodo ya existe');
const again = memoryInbox();
again.workforceEmployee = { findMany: async () => [activeEmployee] };
again.workforceGoal = { findMany: async () => [openGoal] };
again.workforceGoalPeriod = { findMany: async () => [{ ...period(fakeNow), goalId: openGoal.id }] };
let ensuredAfterNotice = 0;
await sweepDailyGoalReminders(fakeNow, { db: again, ensurePeriods: async () => {} });
await sweepDailyGoalReminders(fakeNow, {
  db: again,
  ensurePeriods: async () => {
    ensuredAfterNotice += 1;
  },
});
check(again.rows.size === 1 && ensuredAfterNotice === 0, 'el aviso existente no se duplica ni vuelve a materializar periodos');
let lateGoals = 0;
const late = await sweepDailyGoalReminders(AT_18_MX, {
  db: sweepFixture({
    onGoal() {
      lateGoals += 1;
    },
  }),
  ensurePeriods: async () => {
    throw new Error('no debía materializar de noche');
  },
  emit: async () => {
    throw new Error('no debía emitir de noche');
  },
});
check(late.planned === 0 && lateGoals === 0, 'tick inicial fuera de la ventana no crea aviso ni consulta metas');
let goalReads = 0;
const already = await sweepDailyGoalReminders(fakeNow, {
  db: sweepFixture({
    inboxRows: [{ organizationId: 'org1', dedupeKey: dailyGoalsReminderDedupeKey('emp1', '2026-11-05') }],
    onGoal() {
      goalReads += 1;
    },
  }),
  ensurePeriods: async () => {
    throw new Error('no debía materializar con dedupe');
  },
  emit: async () => {
    throw new Error('no debía emitir otro aviso');
  },
});
check(already.skippedByDedupe === 1 && already.ensured === 0 && goalReads === 0, 'el dedupe del día se consulta antes que las metas y la materialización');
let isolatedEnsures = 0;
const isolatedSweep = await sweepDailyGoalReminders(fakeNow, {
  db: sweepFixture({
    goals: [goal({ id: 'bad' }), goal({ id: 'good' })],
    periods: [{ ...period(fakeNow), goalId: 'good' }],
  }),
  ensurePeriods: async (row) => {
    isolatedEnsures += 1;
    if (row.id === 'bad') throw new Error('meta aislada');
  },
  emit: async (_db, item) => emitted.push(item),
});
check(isolatedSweep.planned === 1 && isolatedEnsures === 1, 'un error al materializar una meta no cancela el resto del barrido');

console.log('\n=== Contratos de arquitectura ===\n');

check(/WORKFORCE_DAILY_GOALS_REMINDER/.test(schema), 'el enum del inbox tiene el tipo nuevo');
check(!/WORKFORCE_DAILY_GOALS_REMINDER/.test(orgNotifSrc), 'la campana administrativa no conoce este tipo');
check(!/OrgNotification/.test(reminderSrc), 'el recordatorio no escribe en la campana administrativa');
check(migration.includes("ADD VALUE 'WORKFORCE_DAILY_GOALS_REMINDER'"), 'la migración agrega el tipo del recordatorio');
check((migration.match(/ALTER TYPE/g) || []).length === 1, 'la migración no altera otros tipos');
check(!/INSERT|UPDATE|DEFAULT|NOT NULL|DELETE/i.test(migration), 'la migración no rellena ni impone default');
check(!/P2002/.test(inboxSrc), 'el inbox existente no captura conflictos únicos');
check(/update:\s*\{\s*\}/.test(reminderSrc), 'el primer mensaje no se reescribe');
check(!/setTimeout/.test(reminderSrc), 'no hay un temporizador por colaborador');
check(DAILY_GOALS_REMINDER_SWEEP_MS === 5 * 60 * 1000, 'el intervalo de este scheduler es de cinco minutos');
check(/setInterval\(tick, DAILY_GOALS_REMINDER_SWEEP_MS\)/.test(reminderSrc), 'el barrido usa ese intervalo');
check(/tick\(\);\s*reminderSweepTimer = setInterval/.test(reminderSrc), 'hay tick inicial al arrancar');
const coverageSrc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentCoverage.service.js'), 'utf8');
check(/COVERAGE_SWEEP_INTERVAL_MS = 60_000/.test(coverageSrc), 'el barrido de cobertura sigue en 60 segundos');
check(/\.finally\(\(\) => \{\s*reminderSweepRunning = false;/.test(reminderSrc), 'la bandera se libera en finally');
check(serverSrc.indexOf('startDailyGoalsReminderSweep()') > serverSrc.indexOf('app.listen'), 'el barrido arranca al escuchar, sin bloquear la creación de la app');
check(/TC_EMP_NOVEDADES_POLL_MS=20000/.test(indexHtml), 'el polling de novedades sigue en 20 s');
check((indexHtml.match(/TC_EMP_NOVEDADES_POLL_MS=20000/g) || []).length === 1, 'no se agregó otro polling de novedades');
check((indexHtml.match(/MIND24_NOTIF_POLL_MS=60000/g) || []).length === 1, 'el polling administrativo sigue en 60 s');

const openItem = indexHtml.match(/function tcEmpNovedadesOpenItem\([\s\S]*?\n\}/)?.[0] || '';
const reminderFn = indexHtml.match(/async function tcEmpOpenDailyGoalsReminder\([\s\S]*?\n\}/)?.[0] || '';
const loadFn = indexHtml.match(/async function tcEmpLoadGoals\([\s\S]*?\n\}/)?.[0] || '';
const adminOpen = indexHtml.match(/function mind24NotifOpenItem\([\s\S]*?\n\}/)?.[0] || '';
check(/GOAL_ASSIGNED[\s\S]*tcEmpQuickGoGoals/.test(openItem), 'asignar meta sigue abriendo Metas');
check(/WORKFORCE_DAILY_GOALS_REMINDER[\s\S]*tcEmpOpenDailyGoalsReminder/.test(openItem), 'el recordatorio abre su deep-link');
check(!/tcEmpNovedadesMarkRead|novedades.*\/read/i.test(openItem), 'el clic genérico de novedades no marca leída');
check(/tcEmpGoalsSetView\('todo'\)/.test(reminderFn), 'el deep-link abre Por cumplir');
check(!/goalsView|Completadas|'done'/.test(reminderFn), 'el deep-link no abre Completadas');
check(!/tcEmpGoalsSetView\(/.test(loadFn), 'si la meta ya no está en Por cumplir no cambia de subvista');
check(/tcEmpWorkspaceSetTab\('goals'\)/.test(reminderFn), 'el deep-link selecciona la pestaña Metas');
check(/novedades\/workplace\//.test(reminderFn), 'el deep-link marca leída la fila del colaborador');
check(!/location\.reload|window\.reload/.test(reminderFn), 'el deep-link no recarga la página');
check(/seq!==tcEmpGoalsLoadSeq/.test(loadFn), 'una respuesta vieja no pinta la vista nueva');
check(/tcEmpFocusGoalCard/.test(loadFn), 'una sola meta puede enfocarse después de cargar');
check(/data-goal-id/.test(indexHtml), 'la tarjeta de meta se puede localizar');
check(/tc-ws-novedades-item--goal-reminder/.test(indexHtml), 'el aviso tiene estilo propio');
check(/tcWsSvgTarget\(\)/.test(indexHtml.match(/function tcEmpNovedadesRenderList\([\s\S]*?\n\}/)?.[0] || ''), 'el icono reutiliza la diana de Metas');
check(!/WORKFORCE_DAILY_GOALS_REMINDER/.test(adminOpen), 'la campana administrativa no abre este aviso');
const readRoute = publicRoutes.split("'/novedades/workplace/:id/read'")[1]?.split('router.post')[0] || '';
check(readRoute.includes('emp.organizationId') && readRoute.includes('emp.id'), 'marcar leída usa la sesión');
check(!/req\.body/.test(readRoute), 'el cliente no elige colaborador ni organización');
check(publicHtml === indexHtml, 'index.html idéntico a server/public/index.html');

console.log('\n=== Integración Postgres ===\n');

let integration = 'SKIP';
let integrationStarted = false;
const orgIds = [];
try {
  const { prisma } = await import('../src/db/client.js');
  await prisma.$queryRaw`SELECT 1`;
  const enums = await prisma.$queryRaw`
    SELECT e.enumlabel AS label
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'WorkforceWorkplaceInboxEventType'
      AND e.enumlabel = 'WORKFORCE_DAILY_GOALS_REMINDER'
  `;
  if (!enums.length) {
    integration = 'SKIP';
    console.log('  SKIP integration: Postgres responde, pero la migración del recordatorio no está aplicada. No se ejecutó migrate.');
  } else {
    const { createApp } = await import('../src/app.js');
    const { hashPassword } = await import('../src/services/auth.service.js');
    const { generateTimeclockAccessToken } = await import('../src/services/timeclockToken.service.js');
    const { createWorkforceGoalForEmployee, ensureWorkforceGoalPeriodsUpToDate, reportWorkforceGoalPeriod } = await import('../src/services/workforceGoal.service.js');
    integrationStarted = true;
    const suffix = crypto.randomBytes(4).toString('hex');
    const now = new Date('2026-11-05T16:00:00.000Z');

    async function makeOrg(name, tz) {
      const org = await prisma.organization.create({
        data: { name, empresaPortalEnabled: true, credits: 0 },
      });
      orgIds.push(org.id);
      const user = await prisma.user.create({
        data: {
          email: `${name}-${suffix}@example.com`,
          passwordHash: await hashPassword('TestAdmin1!'),
          role: 'empresa_admin',
          organizationId: org.id,
          fullName: 'Admin',
        },
      });
      const token = generateTimeclockAccessToken();
      const emp = await prisma.workforceEmployee.create({
        data: {
          organizationId: org.id,
          fullName: `Colaborador ${name}`,
          timezone: tz,
          accessTokenHash: token.hash,
          tokenVersion: 1,
          isActive: true,
          expectedWorkMinutes: 480,
        },
      });
      return { org, user, emp, token: token.token };
    }

    const a = await makeOrg(`reminder-a-${suffix}`, 'America/Mexico_City');
    const tokenB = generateTimeclockAccessToken();
    const empB = await prisma.workforceEmployee.create({
      data: {
        organizationId: a.org.id,
        fullName: 'Colaborador B',
        timezone: 'America/Mexico_City',
        accessTokenHash: tokenB.hash,
        tokenVersion: 1,
        isActive: true,
        expectedWorkMinutes: 480,
      },
    });
    const b = await makeOrg(`reminder-b-${suffix}`, 'America/New_York');
    const inactive = await prisma.workforceEmployee.create({
      data: {
        organizationId: a.org.id,
        fullName: 'Inactivo',
        timezone: 'America/Mexico_City',
        accessTokenHash: generateTimeclockAccessToken().hash,
        tokenVersion: 1,
        isActive: false,
        expectedWorkMinutes: 480,
      },
    });

    async function makeDaily(orgRow, empRow, userId, title) {
      const created = await createWorkforceGoalForEmployee({
        organizationId: orgRow.id,
        employeeId: empRow.id,
        createdByUserId: userId,
        title,
        description: null,
        goalType: 'COMPLIANCE',
        periodicity: 'DAILY',
        startDate: '2026-11-01',
        endDate: null,
      });
      const row = await prisma.workforceGoal.findFirst({ where: { id: created.id } });
      await ensureWorkforceGoalPeriodsUpToDate(row, empRow, now);
      return row;
    }

    await makeDaily(a.org, a.emp, a.user.id, 'Llamadas');
    await makeDaily(a.org, empB, a.user.id, 'Visitas');
    await makeDaily(b.org, b.emp, b.user.id, 'Cierres');
    await createWorkforceGoalForEmployee({
      organizationId: a.org.id,
      employeeId: a.emp.id,
      createdByUserId: a.user.id,
      title: 'Semanal',
      description: null,
      goalType: 'COMPLIANCE',
      periodicity: 'WEEKLY',
      startDate: '2026-11-01',
      endDate: null,
    });
    await makeDaily(a.org, inactive, a.user.id, 'No debe salir');

    await sweepDailyGoalReminders(now);
    await sweepDailyGoalReminders(now);
    const keyA = dailyGoalsReminderDedupeKey(a.emp.id, '2026-11-05');
    const rowsA = await prisma.workforceWorkplaceInbox.findMany({
      where: { organizationId: a.org.id, dedupeKey: keyA },
    });
    check(rowsA.length === 1, 'Postgres deja un solo aviso por colaborador y fecha');
    check(rowsA[0].recipientWorkforceEmployeeId === a.emp.id, 'el aviso pertenece a ese colaborador');
    check(!rowsA[0].message.includes('@'), 'el mensaje no incluye correo');
    const rowsB = await prisma.workforceWorkplaceInbox.count({
      where: { organizationId: a.org.id, recipientWorkforceEmployeeId: empB.id, eventType: 'WORKFORCE_DAILY_GOALS_REMINDER' },
    });
    const rowsOrgB = await prisma.workforceWorkplaceInbox.count({
      where: { organizationId: b.org.id, eventType: 'WORKFORCE_DAILY_GOALS_REMINDER' },
    });
    const rowsInactive = await prisma.workforceWorkplaceInbox.count({
      where: { recipientWorkforceEmployeeId: inactive.id, eventType: 'WORKFORCE_DAILY_GOALS_REMINDER' },
    });
    check(rowsB === 1 && rowsOrgB === 1 && rowsInactive === 0, 'Postgres aísla colaboradores, organizaciones e inactivos');
    const adminRows = await prisma.orgNotification.count({
      where: { organizationId: { in: orgIds }, dedupeKey: { contains: 'workforce_daily_goals_reminder:' } },
    });
    check(adminRows === 0, 'el aviso no aparece en la campana administrativa');

    const racedDb = await Promise.all([
      emitDailyGoalsReminder(prisma, {
        organizationId: a.org.id,
        employeeId: a.emp.id,
        localDateKey: '2026-11-05',
        goals: [goal({ id: 'ignored', title: 'No reescribir' })],
      }),
      emitDailyGoalsReminder(prisma, {
        organizationId: a.org.id,
        employeeId: a.emp.id,
        localDateKey: '2026-11-05',
        goals: [goal({ id: 'ignored-2', title: 'Tampoco' })],
      }),
    ]);
    check(racedDb[0].id === racedDb[1].id && racedDb[0].message === rowsA[0].message, 'dos escrituras concurrentes conservan el primer aviso');

    const periodRow = await prisma.workforceGoalPeriod.findFirst({
      where: { goalId: (await prisma.workforceGoal.findFirst({ where: { employeeId: empB.id, periodicity: 'DAILY' } })).id },
      orderBy: { periodStart: 'desc' },
    });
    await reportWorkforceGoalPeriod({
      employeeId: empB.id,
      periodId: periodRow.id,
      binaryResult: 'MET',
      achievedValue: null,
      employeeComment: null,
    });
    await prisma.workforceWorkplaceInbox.deleteMany({
      where: { recipientWorkforceEmployeeId: empB.id, eventType: 'WORKFORCE_DAILY_GOALS_REMINDER' },
    });
    await sweepDailyGoalReminders(now);
    const afterReport = await prisma.workforceWorkplaceInbox.count({
      where: { recipientWorkforceEmployeeId: empB.id, eventType: 'WORKFORCE_DAILY_GOALS_REMINDER' },
    });
    check(afterReport === 0, 'una meta ya reportada no genera aviso');

    const app = createApp();
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const exchange = await fetch(`${base}/api/timeclock/public/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: a.token }),
      });
      const cookie = (exchange.headers.getSetCookie?.() || []).map((item) => item.split(';')[0]).find((item) => item.startsWith('mind24.tc.sid=')) || '';
      const readRes = await fetch(`${base}/api/timeclock/public/novedades/workplace/${rowsA[0].id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ employeeId: empB.id, organizationId: b.org.id }),
      });
      check(readRes.status === 200, 'el dueño marca su aviso como leído');
      const exchangeB = await fetch(`${base}/api/timeclock/public/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenB.token }),
      });
      const cookieB = (exchangeB.headers.getSetCookie?.() || []).map((item) => item.split(';')[0]).find((item) => item.startsWith('mind24.tc.sid=')) || '';
      const foreign = await fetch(`${base}/api/timeclock/public/novedades/workplace/${rowsA[0].id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieB },
        body: '{}',
      });
      check(foreign.status === 404, 'otro colaborador no puede marcar el aviso');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    integration = 'PASS';
  }
} catch (err) {
  if (integrationStarted) {
    check(false, err?.message || String(err));
    integration = 'FAIL';
  } else {
    integration = 'SKIP';
    console.log(`  SKIP integration: ${err?.message || err}`);
  }
} finally {
  if (orgIds.length) {
    try {
      const { prisma } = await import('../src/db/client.js');
      for (const orgId of orgIds) {
        await prisma.orgNotification.deleteMany({ where: { organizationId: orgId } });
        await prisma.workforceWorkplaceInbox.deleteMany({ where: { organizationId: orgId } });
        await prisma.workforceGoalPeriod.deleteMany({ where: { organizationId: orgId } });
        await prisma.workforceGoal.deleteMany({ where: { organizationId: orgId } });
        await prisma.workforceEmployee.deleteMany({ where: { organizationId: orgId } });
        await prisma.user.deleteMany({ where: { organizationId: orgId } });
        await prisma.organization.deleteMany({ where: { id: orgId } });
      }
      await prisma.$disconnect();
    } catch {
      /* la base ya no estaba disponible */
    }
  }
}

if (integration === 'SKIP') {
  console.log('  SKIP no certifica persistencia, dedupe en base, transacción ni aislamiento entre organizaciones.');
} else {
  console.log('  OK  integración Postgres');
}

if (failed) {
  console.error(`\n${failed} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log('\nRecordatorio diario: comprobaciones estáticas y de regla en verde.');

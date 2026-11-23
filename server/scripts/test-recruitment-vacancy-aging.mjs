/**
 * Semáforo de vacantes activas con plazas pendientes.
 * node server/scripts/test-recruitment-vacancy-aging.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(serverDir, '..');
dotenv.config({ path: path.join(serverDir, '.env') });

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

const {
  vacancyAgingLevelFromDays,
  resolveVacancyAgingTrafficLight,
  inferActiveQueueEmptiedAtFromHistory,
  vacancyDateKeyInTimeZone,
  VACANCY_AGING_HABITUAL_MAX_DAYS,
  VACANCY_AGING_ORANGE_MAX_DAYS,
  calendarDayDiff,
} = await import('../src/services/recruitmentVacancy.service.js');

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(serverDir, 'public/index.html'));
const vacancySvc = fs.readFileSync(path.join(serverDir, 'src/services/recruitmentVacancy.service.js'), 'utf8');
const schema = fs.readFileSync(path.join(serverDir, 'prisma/schema.prisma'), 'utf8');
const parkSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/recruitmentInterviewNoShowPark.service.js'),
  'utf8',
);
const routes = fs.readFileSync(path.join(serverDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const migPath = path.join(
  serverDir,
  'prisma/migrations/20261123220000_recruitment_vacancy_active_queue_emptied_at/migration.sql',
);
const appSvc = fs.readFileSync(path.join(serverDir, 'src/services/recruitmentApplication.service.js'), 'utf8');
const closureMock = fs.readFileSync(
  path.join(serverDir, 'scripts/test-recruitment-process-closure.mjs'),
  'utf8',
);

console.log('\n=== Semáforo vacantes — estático ===\n');

check(fs.existsSync(migPath), 'migración activeQueueEmptiedAt existe');
check(/activeQueueEmptiedAt DateTime\?/.test(schema), 'campo en schema');
check(/resolveVacancyAgingTrafficLight/.test(vacancySvc), 'resolver semáforo');
check(/inferActiveQueueEmptiedAtFromHistory/.test(vacancySvc), 'infiere ancla desde historial');
check(/vacancyDateKeyInTimeZone/.test(vacancySvc), 'días en TZ de la organización');
check(/syncVacancyActiveQueueEmptiedAt/.test(vacancySvc), 'sync ancla cola vacía');
check(/syncVacancyActiveQueueEmptiedAt/.test(appSvc), 'create/move sincronizan ancla');
check(
  /Reingreso a proceso \(reagenda\): limpia ancla/.test(parkSvc)
    || /syncVacancyActiveQueueEmptiedAt\(organizationId, app\.vacancyId, tx\)/.test(parkSvc),
  'reagenda por inasistencia limpia activeQueueEmptiedAt',
);
check(/computeVacancyAgingTrafficLight/.test(routes), 'PATCH/decline exponen agingTrafficLight');
check(/recVacApplyAgingTint/.test(indexHtml), 'tablero actualiza tinte sin reload');
check(/recruitmentVacancy:\s*'vacancies'/.test(closureMock), 'cliente simulado de cierre incluye vacantes');
check(Buffer.from(indexHtml).equals(publicHtml), 'HTML espejo index ↔ public');
check(/rec-vac-card--aging-orange/.test(indexHtml), 'CSS naranja');
check(/rec-vac-card--aging-red/.test(indexHtml), 'CSS rojo');
check(!/\.rec-vac-card--aging-green\{/.test(indexHtml), 'sin CSS verde de semáforo');
check(!/\.rec-vac-card--aging-yellow\{/.test(indexHtml), 'sin CSS amarillo de semáforo');
check(/recVacCardAgingClass/.test(indexHtml) && /agingTrafficLight/.test(indexHtml), 'tarjeta aplica clase por agingTrafficLight');

console.log('\n=== Límites de días 4 / 5 / 9 / 10 ===\n');

check(VACANCY_AGING_HABITUAL_MAX_DAYS === 4, 'habitual hasta día 4');
check(VACANCY_AGING_ORANGE_MAX_DAYS === 9, 'naranja hasta día 9');
check(vacancyAgingLevelFromDays(0) === null, 'día 0 → habitual');
check(vacancyAgingLevelFromDays(4) === null, 'día 4 → habitual');
check(vacancyAgingLevelFromDays(5) === 'orange', 'día 5 → naranja');
check(vacancyAgingLevelFromDays(9) === 'orange', 'día 9 → naranja');
check(vacancyAgingLevelFromDays(10) === 'red', 'día 10 → rojo');
check(vacancyAgingLevelFromDays(30) === 'red', 'día 30 → rojo');

const today = '2026-11-23';
const tz = 'America/Mexico_City';
function ymdNoonIso(ymd) {
  return `${ymd}T18:00:00.000Z`; // mediodía MX aprox.
}

check(
  resolveVacancyAgingTrafficLight({
    status: 'ACTIVE',
    positionsTotal: 2,
    hiredConfirmed: 0,
    applicationTotal: 0,
    inProcess: 0,
    createdAt: ymdNoonIso('2026-11-19'),
    timeZone: tz,
    todayKey: today,
  }) === null,
  'sin postulaciones: 4 días → habitual',
);
check(
  resolveVacancyAgingTrafficLight({
    status: 'ACTIVE',
    positionsTotal: 2,
    hiredConfirmed: 0,
    applicationTotal: 0,
    inProcess: 0,
    createdAt: ymdNoonIso('2026-11-18'),
    timeZone: tz,
    todayKey: today,
  }) === 'orange',
  'sin postulaciones: 5 días → naranja',
);
check(
  resolveVacancyAgingTrafficLight({
    status: 'ACTIVE',
    positionsTotal: 1,
    hiredConfirmed: 0,
    applicationTotal: 3,
    inProcess: 0,
    createdAt: ymdNoonIso('2026-10-01'),
    activeQueueEmptiedAt: ymdNoonIso('2026-11-14'),
    timeZone: tz,
    todayKey: today,
  }) === 'orange',
  'cola vacía: 9 días desde emptiedAt → naranja',
);
check(
  resolveVacancyAgingTrafficLight({
    status: 'ACTIVE',
    positionsTotal: 1,
    hiredConfirmed: 0,
    applicationTotal: 3,
    inProcess: 0,
    createdAt: ymdNoonIso('2026-10-01'),
    activeQueueEmptiedAt: ymdNoonIso('2026-11-13'),
    timeZone: tz,
    todayKey: today,
  }) === 'red',
  'cola vacía: 10 días desde emptiedAt → rojo',
);
check(
  vacancyDateKeyInTimeZone('2026-11-23T06:00:00.000Z', 'America/Mexico_City') === '2026-11-23',
  'TZ org: instante UTC tempra al día local',
);
check(
  vacancyDateKeyInTimeZone('2026-11-23T05:00:00.000Z', 'America/Mexico_City') === '2026-11-22',
  'TZ org: antes de medianoche local cae en el día previo',
);

console.log('\n=== Historial / reingreso a proceso ===\n');

const emptiedFromHistory = inferActiveQueueEmptiedAtFromHistory([
  {
    id: 'app-a',
    stageKey: 'REJECTED',
    closureOutcome: 'REJECTED',
    appliedAt: '2026-11-01T12:00:00.000Z',
    closedAt: null,
    events: [
      { createdAt: '2026-11-01T12:00:00.000Z', toStageKey: 'NEW' },
      { createdAt: '2026-11-10T15:00:00.000Z', fromStageKey: 'NEW', toStageKey: 'REJECTED' },
    ],
  },
]);
check(
  emptiedFromHistory && emptiedFromHistory.toISOString() === '2026-11-10T15:00:00.000Z',
  'historial: ancla = instante en que salió el último de la cola',
);

const emptiedAfterNoShowThenDecline = inferActiveQueueEmptiedAtFromHistory([
  {
    id: 'app-ns',
    stageKey: 'CONTACT',
    closureOutcome: 'DECLINED',
    appliedAt: '2026-11-01T12:00:00.000Z',
    closedAt: '2026-11-20T12:00:00.000Z',
    events: [
      { createdAt: '2026-11-01T12:00:00.000Z', toStageKey: 'NEW' },
      { createdAt: '2026-11-05T12:00:00.000Z', fromStageKey: 'NEW', toStageKey: 'INITIAL_INTERVIEW' },
      {
        createdAt: '2026-11-10T15:00:00.000Z',
        fromStageKey: 'INITIAL_INTERVIEW',
        toStageKey: 'INTERVIEW_NO_SHOW',
      },
    ],
  },
]);
check(
  emptiedAfterNoShowThenDecline
    && emptiedAfterNoShowThenDecline.toISOString() === '2026-11-10T15:00:00.000Z',
  'No asistió el 10 y declina el 20: ancla sigue siendo el 10',
);

check(
  /enrichVacancies\(organizationId, \[row\]\)/.test(vacancySvc)
    || /getRecruitmentVacancy[\s\S]{0,600}enrichVacancies/.test(vacancySvc),
  'detalle reutiliza enrichVacancies (misma TZ que el listado)',
);

check(
  resolveVacancyAgingTrafficLight({
    status: 'ACTIVE',
    positionsTotal: 1,
    hiredConfirmed: 0,
    applicationTotal: 2,
    inProcess: 1,
    createdAt: ymdNoonIso('2026-10-01'),
    activeQueueEmptiedAt: ymdNoonIso('2026-10-01'),
    timeZone: tz,
    todayKey: today,
  }) === null,
  'con candidato en proceso → color habitual (null)',
);
check(
  resolveVacancyAgingTrafficLight({
    status: 'ACTIVE',
    positionsTotal: 1,
    hiredConfirmed: 0,
    applicationTotal: 1,
    inProcess: 0,
    createdAt: ymdNoonIso('2026-10-01'),
    activeQueueEmptiedAt: null,
    timeZone: tz,
    todayKey: today,
  }) === null,
  'cola vacía sin ancla (legacy sin historial aún) → sin color hasta backfill',
);

check(calendarDayDiff('2026-11-19', today) === 4, 'calendarDayDiff ancla 4 días');
check(calendarDayDiff('2026-11-14', today) === 9, 'calendarDayDiff ancla 9 días');
check(calendarDayDiff('2026-11-13', today) === 10, 'calendarDayDiff ancla 10 días');

if (failed) {
  console.error(`\n${failed} comprobaciones de semáforo vacantes fallaron\n`);
  process.exit(1);
}
console.log('\nSemáforo de vacantes en orden\n');

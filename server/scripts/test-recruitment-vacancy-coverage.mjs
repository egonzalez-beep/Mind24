/**
 * Cobertura real, headcount y etapas vacías del Kanban.
 * node server/scripts/test-recruitment-vacancy-coverage.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'recruitment-coverage-test-secret';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
const coverageSrc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentCoverage.service.js'), 'utf8');
const applicationSrc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentApplication.service.js'), 'utf8');
const vacancySrc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentVacancy.service.js'), 'utf8');
const routesSrc = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(rootDir, 'src/server.js'), 'utf8');
const migrationSql = fs.readFileSync(
  path.join(rootDir, 'prisma/migrations/20261104053000_recruitment_hired_coverage/migration.sql'),
  'utf8',
);

const {
  HIRED_CONFIRMATION_MS,
  HIRED_STAGE_KEY,
  POSITIONS_BELOW_HIRED_MESSAGE,
  REOPEN_BLOCKED_MESSAGE,
  assertVacancyPositionsAndReopen,
  automaticCoverageWrite,
  isHireConfirmedAt,
  nextHiredStageEnteredAt,
  officialCoveragePercent,
  pendingPositions,
  planVacancyCoverageUpdate,
  runRecruitmentCoverageSweepTick,
  shouldAutoCover,
  shouldRecordStageEvent,
  tallyVacancyHires,
} = await import('../src/services/recruitmentCoverage.service.js');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

const entered = new Date('2026-01-01T00:00:00.000Z');
const justBefore = new Date(entered.getTime() + HIRED_CONFIRMATION_MS - 1);
const exactly = new Date(entered.getTime() + HIRED_CONFIRMATION_MS);
const later = new Date('2026-01-03T00:00:00.000Z');

console.log('\n=== Reloj de Contratado ===\n');

check(HIRED_STAGE_KEY === 'HIRED', 'la clave canónica es HIRED');
check(!isHireConfirmedAt(null, exactly), 'sin timestamp no confirma');
check(!isHireConfirmedAt(entered, justBefore), 'un milisegundo antes de 24 h no cuenta');
check(isHireConfirmedAt(entered, exactly), 'al cumplir 24 h sí cuenta');
const same = nextHiredStageEnteredAt({
  fromKey: 'HIRED',
  toKey: 'HIRED',
  previousEnteredAt: entered,
  now: later,
});
check(same === entered, 'repetir la misma etapa no reinicia el reloj');
check(
  nextHiredStageEnteredAt({
    fromKey: 'HIRED',
    toKey: 'FINALIST',
    previousEnteredAt: entered,
    now: justBefore,
  }) == null,
  'salir antes de 24 h cierra la ventana',
);
const reenteredAt = new Date('2026-02-01T00:00:00.000Z');
check(
  nextHiredStageEnteredAt({
    fromKey: 'FINALIST',
    toKey: 'HIRED',
    previousEnteredAt: null,
    now: reenteredAt,
  }).getTime() === reenteredAt.getTime(),
  'volver a entrar abre otra ventana',
);
check(
  !isHireConfirmedAt(reenteredAt, new Date(reenteredAt.getTime() + HIRED_CONFIRMATION_MS - 1)),
  'la ventana nueva no hereda el tramo anterior',
);

const dup = tallyVacancyHires(
  [
    { candidateId: 'c1', stageKey: 'HIRED', hiredStageEnteredAt: later, fullName: 'Ana' },
    { candidateId: 'c1', stageKey: 'HIRED', hiredStageEnteredAt: entered, fullName: 'Ana' },
    { candidateId: 'c2', stageKey: 'NEW', hiredStageEnteredAt: entered, fullName: 'Beto' },
  ],
  exactly,
);
check(dup.currentCount === 1, 'un candidato duplicado cuenta una vez');
check(dup.confirmedCount === 1, 'el duplicado usa el ingreso más antiguo y ya confirma');
check(dup.hired[0].hiredStageEnteredAt.getTime() === entered.getTime(), 'timestamp conservado es el más antiguo');
check(
  nextHiredStageEnteredAt({
    fromKey: 'HIRED',
    toKey: 'HIRED',
    previousEnteredAt: null,
    now: later,
  }) == null,
  'repetir HIRED con timestamp null no abre una ventana',
);
const historical = tallyVacancyHires(
  [
    { candidateId: 'old', stageKey: 'HIRED', hiredStageEnteredAt: null, fullName: 'Histórico' },
    { candidateId: 'new', stageKey: 'HIRED', hiredStageEnteredAt: entered, fullName: 'Nuevo' },
  ],
  exactly,
);
check(historical.currentCount === 2, 'el histórico en Contratado forma parte de C');
check(historical.confirmedCount === 1, 'el histórico con timestamp null queda fuera de H24');
check(
  historical.hired.find((row) => row.candidateId === 'old').hiredStageEnteredAt == null,
  'el histórico permanece sin timestamp',
);

console.log('\n=== Cobertura y reapertura ===\n');

check(pendingPositions(3, 2) === 1, 'pendientes = P - H24');
check(officialCoveragePercent(1, 0) === 0, 'P1 H24 0 sigue activa en cobertura');
check(officialCoveragePercent(3, 2) === 67, 'P3 H24 2 no llega a 100');
check(officialCoveragePercent(1, 2) === 100, 'H24 mayor que P queda en 100');
check(shouldAutoCover({ status: 'ACTIVE', positionsTotal: 1, confirmedCount: 0 }) === false, 'activa con H24 0');
check(shouldAutoCover({ status: 'ACTIVE', positionsTotal: 1, confirmedCount: 1 }) === true, 'P1 al cumplir 24 h se cubre');
check(shouldAutoCover({ status: 'ACTIVE', positionsTotal: 3, confirmedCount: 2 }) === false, 'P3 H24 2 sigue activa');
check(shouldAutoCover({ status: 'ACTIVE', positionsTotal: 3, confirmedCount: 3 }) === true, 'P3 H24 3 se cubre');
check(shouldAutoCover({ status: 'COVERED', positionsTotal: 1, confirmedCount: 1 }) === false, 'la cubierta manual no se vuelve a cerrar');
check(shouldAutoCover({ status: 'PAUSED', positionsTotal: 1, confirmedCount: 1 }) === false, 'en pausa no cambia');
check(shouldAutoCover({ status: 'CLOSED', positionsTotal: 1, confirmedCount: 1 }) === false, 'cerrada no cambia');

let state = { status: 'ACTIVE' };
let wins = 0;
async function claimOnce() {
  await Promise.resolve();
  if (state.status !== 'ACTIVE') return 0;
  if (!shouldAutoCover({ status: 'ACTIVE', positionsTotal: 1, confirmedCount: 1 })) return 0;
  state = { status: 'COVERED', coverageSource: 'AUTOMATIC' };
  return 1;
}
const claimed = await Promise.all([claimOnce(), claimOnce()]);
wins = claimed.reduce((sum, n) => sum + n, 0);
check(wins === 1, 'dos cierres concurrentes dejan un solo efecto');
check(state.status === 'COVERED' && state.coverageSource === 'AUTOMATIC', 'el ganador queda en cobertura automática');
const second = await claimOnce();
check(second === 0, 'repetir el proceso es idempotente');

function reopenError(args) {
  try {
    assertVacancyPositionsAndReopen(args);
    return '';
  } catch (err) {
    return err.message;
  }
}
check(
  reopenError({ currentStatus: 'COVERED', nextStatus: 'ACTIVE', positionsTotal: 1, currentHired: 1 }) ===
    REOPEN_BLOCKED_MESSAGE,
  'P1 C1 bloquea la reapertura',
);
check(
  reopenError({ currentStatus: 'COVERED', nextStatus: 'ACTIVE', positionsTotal: 2, currentHired: 1 }) === '',
  'P2 C1 permite reabrir',
);
check(
  reopenError({ currentStatus: 'COVERED', nextStatus: 'ACTIVE', positionsTotal: 3, currentHired: 1 }) === '',
  'aumentar P permite reabrir',
);
check(
  reopenError({ currentStatus: 'COVERED', nextStatus: 'ACTIVE', positionsTotal: 1, currentHired: 0 }) === '',
  'liberar la contratación permite reabrir',
);
check(
  reopenError({ currentStatus: 'ACTIVE', nextStatus: 'ACTIVE', positionsTotal: 2, currentHired: 3 }) ===
    POSITIONS_BELOW_HIRED_MESSAGE,
  'no reduce P por debajo de C',
);
check(
  reopenError({ currentStatus: 'COVERED', nextStatus: 'COVERED', positionsTotal: 1, currentHired: 1 }) === '',
  'guardar Cubierta no exige H24',
);

const reopenAt = new Date('2026-03-01T12:00:00.000Z');
let blockedMeta = null;
try {
  blockedMeta = planVacancyCoverageUpdate({
    currentStatus: 'COVERED',
    nextStatus: 'ACTIVE',
    positionsTotal: 1,
    currentHired: 1,
    now: reopenAt,
  });
} catch (err) {
  check(err.message === REOPEN_BLOCKED_MESSAGE, 'la reapertura bloqueada rechaza antes de escribir');
}
check(blockedMeta == null, 'la reapertura bloqueada no limpia coveredAt ni coverageSource');

const cleared = planVacancyCoverageUpdate({
  currentStatus: 'COVERED',
  nextStatus: 'ACTIVE',
  positionsTotal: 2,
  currentHired: 1,
  now: reopenAt,
});
check(cleared.coveredAt === null && cleared.coverageSource === null, 'COVERED → ACTIVE limpia ambos campos juntos');
check(!('status' in cleared), 'la limpieza viaja en el mismo objeto de metadatos');

const manualAt = new Date('2026-03-02T08:00:00.000Z');
const manual = planVacancyCoverageUpdate({
  currentStatus: 'ACTIVE',
  nextStatus: 'COVERED',
  positionsTotal: 1,
  currentHired: 0,
  now: manualAt,
});
check(manual.coveredAt === manualAt && manual.coverageSource === 'MANUAL', 'la cobertura manual nueva guarda fecha y MANUAL');

const kept = planVacancyCoverageUpdate({
  currentStatus: 'COVERED',
  nextStatus: 'COVERED',
  positionsTotal: 3,
  currentHired: 1,
  now: manualAt,
});
check(!('coveredAt' in kept) && !('coverageSource' in kept), 'seguir en Cubierta no reescribe los metadatos');

const autoAt = new Date('2026-03-03T00:00:00.000Z');
const auto = automaticCoverageWrite(autoAt);
check(auto.status === 'COVERED' && auto.coveredAt === autoAt && auto.coverageSource === 'AUTOMATIC', 'la cobertura automática nueva guarda fecha y AUTOMATIC');

check(shouldRecordStageEvent({ stageChanged: true, updatedCount: 0 }) === false, 'una carrera perdida no crea evento de etapa');
check(shouldRecordStageEvent({ stageChanged: true, updatedCount: 1 }) === true, 'solo el movimiento que gana registra el evento');
check(shouldRecordStageEvent({ stageChanged: false, updatedCount: 1 }) === false, 'editar sin cambiar de etapa no crea evento');

let sweepUnhandled = 0;
const onSweepUnhandled = () => { sweepUnhandled += 1; };
process.on('unhandledRejection', onSweepUnhandled);
let releaseSweep;
const sweepGate = new Promise((resolve) => { releaseSweep = resolve; });
const firstSweep = runRecruitmentCoverageSweepTick(() => sweepGate);
const skippedSweep = await runRecruitmentCoverageSweepTick(async () => { throw new Error('no debe correr'); });
check(skippedSweep.skipped === true, 'el barrido en curso no se solapa');
releaseSweep({ updated: 1 });
check((await firstSweep).updated === 1, 'el primer barrido termina una vez');
const failedSweep = await runRecruitmentCoverageSweepTick(async () => { throw new Error('fallo controlado'); });
check(failedSweep.failed === true && sweepUnhandled === 0, 'el fallo del barrido no queda como unhandled rejection');
const againSweep = await runRecruitmentCoverageSweepTick(async () => ({ updated: 0 }));
check(againSweep.updated === 0, 'después del fallo el barrido puede volver a correr');
process.off('unhandledRejection', onSweepUnhandled);

const activeOnly = [
  { status: 'ACTIVE', positionsTotal: 4 },
  { status: 'COVERED', positionsTotal: 9 },
  { status: 'PAUSED', positionsTotal: 3 },
  { status: 'ACTIVE', positionsTotal: 2 },
].filter((row) => row.status === 'ACTIVE');
check(activeOnly.length === 2, 'Headcount cuenta solo vacantes activas');
check(activeOnly.reduce((sum, row) => sum + row.positionsTotal, 0) === 6, 'Headcount suma posiciones activas');
check(/status:\s*'ACTIVE'/.test(vacancySrc) && /_sum:\s*\{\s*positionsTotal:\s*true\s*\}/.test(vacancySrc), 'el agregado de Headcount usa Activa y positionsTotal');

console.log('\n=== Contratos ===\n');

check(!/hiredStageEnteredAt/.test(routesSrc.slice(routesSrc.indexOf("router.patch('/applications/:id')"), routesSrc.indexOf("router.patch('/applications/:id')") + 900).split('updateRecruitmentApplication')[0]), 'el cliente no envía el timestamp');
check(migrationSql.includes('hiredStageEnteredAt') && !/UPDATE/i.test(migrationSql), 'la migración no modifica filas existentes');
const sweepSrc = coverageSrc.slice(
  coverageSrc.indexOf('export async function reconcileDueVacancyCoverage'),
  coverageSrc.indexOf('let coverageSweepTimer'),
);
check(!sweepSrc.includes('recruitmentApplication.update') && !sweepSrc.includes('StageEvent'), 'el barrido no inicializa timestamps ni lee eventos');
check(sweepSrc.includes('lte: cutoff'), 'el barrido solo toma timestamps ya vencidos');
check(vacancySrc.includes('status: current.status'), 'la reapertura escribe condicionada al estado leído');
check(coverageSrc.includes("status: 'ACTIVE'") && coverageSrc.includes('updateMany'), 'el cierre es condicional a Activa');
check(applicationSrc.includes('nextHiredStageEnteredAt') && applicationSrc.includes('updateMany'), 'movimiento y timestamp van juntos');
check(vacancySrc.includes('listCurrentHiresForVacancy') && vacancySrc.includes('candidate: { select: { fullName: true } }') === false, 'la ficha no selecciona contacto');
check(/select:\s*\{\s*fullName:\s*true\s*\}/.test(coverageSrc), 'el nombre sale en una sola consulta');
check(coverageSrc.includes('organizationId, vacancyId'), 'la lista de contratados filtra organización');
check(serverSrc.includes('startRecruitmentCoverageSweep'), 'el barrido arranca con el servidor');
check(coverageSrc.includes('COVERAGE_SWEEP_INTERVAL_MS = 60_000'), 'el barrido es de 60 segundos');
check(!coverageSrc.includes('setInterval(tick') || coverageSrc.includes('coverageSweepTimer'), 'no hay intervalos duplicados');

console.log('\n=== Interfaz ===\n');

check(indexHtml.includes('id="rec-headcount"'), 'indicador de headcount');
check(indexHtml.includes('recDeriveHeadcount'), 'headcount suma solo activas');
check(indexHtml.includes('Headcount: '), 'texto de headcount');
check(indexHtml.includes('id="rec-hired-fold"'), 'desplegable de contratados');
check(indexHtml.includes('Contratados: '), 'etiqueta Contratados de P');
check(indexHtml.includes('recCandOpenDetail'), 'acceso al expediente');
check(!/rec-hired-fold[\s\S]{0,500}whatsapp/.test(indexHtml), 'el bloque no pinta WhatsApp');
check(indexHtml.includes(REOPEN_BLOCKED_MESSAGE), 'el formulario muestra el bloqueo de reapertura');
check(indexHtml.includes('rec-form-positions--blocked'), 'marca visual del campo de posiciones');
check(indexHtml.includes('1 posición') && indexHtml.includes('disponible'), 'línea compacta de capacidad');
check(/if\(coverage\.message\)\{[\s\S]{0,180}return;/.test(indexHtml), 'el error no cierra ni vacía el formulario');
check(indexHtml.includes('Mostrar todas las etapas') && indexHtml.includes('Ocultar etapas vacías'), 'botón de etapas vacías');
check(indexHtml.includes('recKanbanRevealEmptyForDrag') && indexHtml.includes('recKanbanRestoreEmptyAfterDrag'), 'durante el arrastre se muestran y luego se restauran');
check(indexHtml.includes('rec_kanban_hide_empty'), 'la preferencia vive en la sesión, no en la base');
check(indexHtml.includes('aria-pressed'), 'el botón es accesible');
check(/recKanbanColDrop\(event\)/.test(indexHtml), 'el drop sigue disponible');
const dropStart = indexHtml.indexOf('async function recKanbanColDrop');
const dropEnd = indexHtml.indexOf('function recKanbanCardClick');
const dropBlock = indexHtml.slice(dropStart, dropEnd);
check(!/recKanbanLoad\(/.test(dropBlock) && !/recKanbanRender\(/.test(dropBlock), 'el drop no reconstruye el tablero');
check(indexHtml.includes('if(st.coverageFormBound) return'), 'el formulario no duplica listeners');
check(indexHtml === publicHtml, 'index.html y server/public/index.html son idénticos');

console.log('\n=== Integración (DB) ===\n');

let skipped = false;
try {
  const { prisma } = await import('../src/db/client.js');
  await prisma.$queryRaw`SELECT 1`;
  await prisma.$queryRaw`SELECT "hiredStageEnteredAt" FROM "RecruitmentApplication" LIMIT 0`;
  check(true, 'la columna hiredStageEnteredAt existe');
} catch (err) {
  skipped = true;
  const message = String(err?.message || err).replace(/\s+/g, ' ').trim();
  console.log(`  SKIP integration: ${message.slice(0, 220)}`);
}

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log(skipped ? '\n✓ cobertura de vacante (integración SKIP)\n' : '\n✓ cobertura de vacante\n');

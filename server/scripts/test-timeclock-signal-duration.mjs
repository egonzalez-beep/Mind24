/**
 * Telemetría tiempo con señal — unit (+ integración DB si hay Postgres).
 * node server/scripts/test-timeclock-signal-duration.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const {
  SIGNAL_MAX_CREDIT_SEC,
  creditSecondsBetween,
  planHeartbeatSignalCredit,
  planCloseSignalCredit,
  projectedSignalDurationSec,
  connectionEffectivePercent,
  resolveConnectionVisualLevel,
  resolveSignalTelemetryStatus,
  signalTrackingFieldsAtCheckIn,
  enrichSessionSignalMetrics,
  SIGNAL_TELEMETRY,
} = await import('../src/services/remoteWorkSignalDuration.service.js');

const { buildConnectionSummaryForSessions, sanitizeSessionRow } = await import(
  '../src/services/remoteWorkSessionHistory.service.js'
);

const indexHtml = fs.readFileSync(path.join(root, '..', 'index.html'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
const sessionSvc = fs.readFileSync(
  path.join(root, 'src/services/remoteWorkSession.service.js'),
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

console.log('\n=== Signal duration — unit ===\n');

check(SIGNAL_MAX_CREDIT_SEC === 180, 'max credit 180s');
check(creditSecondsBetween('2026-01-01T10:00:00Z', '2026-01-01T10:00:45Z') === 45, '45s credit');
check(
  creditSecondsBetween('2026-01-01T10:00:00Z', '2026-01-01T10:10:00Z') === 180,
  '10min gap capped 180',
);

const checkIn = new Date('2026-01-01T09:00:00Z');
const newSession = {
  id: 's1',
  checkInAt: checkIn,
  checkOutAt: null,
  signalTelemetryStatus: 'full',
  signalTrackingStartedAt: checkIn,
  signalDurationSeconds: 0,
  signalSampleCount: 0,
  signalLastCreditedAt: null,
  lastHeartbeatAt: null,
  lastVisibilityState: 'visible',
};

const t902 = new Date('2026-01-01T09:02:00Z');
const hb1 = planHeartbeatSignalCredit(newSession, t902);
check(hb1.creditSec === 120, 'first HB credits from check-in capped 180 (2 min)');
check(hb1.patch.signalSampleCount === 1, 'first HB increments sample');
check(hb1.patch.signalLastCreditedAt?.getTime() === t902.getTime(), 'ancla HB = serverNow (9:02)');

const after1 = { ...newSession, ...hb1.patch, ...hb1.activationPatch };
const t90245 = new Date('2026-01-01T09:02:45Z');
const hb2 = planHeartbeatSignalCredit(after1, t90245);
check(hb2.creditSec === 45, 'second HB ~45s');
check(hb2.patch.signalLastCreditedAt?.getTime() === t90245.getTime(), 'ancla avanza a serverNow');

const t9 = new Date('2026-01-01T09:00:00Z');
const t10 = new Date('2026-01-01T10:00:00Z');
const t10001 = new Date('2026-01-01T10:00:01Z');
const gapBase = {
  ...newSession,
  signalLastCreditedAt: t9,
  signalDurationSeconds: 0,
  signalSampleCount: 1,
};
const gapHb1 = planHeartbeatSignalCredit(gapBase, t10);
check(gapHb1.creditSec === 180, '1h gap → credit 180 not 3600');
check(gapHb1.patch.signalLastCreditedAt?.getTime() === t10.getTime(), 'ancla 10:00 tras hueco');
let gapState = { ...gapBase, ...gapHb1.patch, signalDurationSeconds: 180 };
const gapHb2 = planHeartbeatSignalCredit(gapState, t10001);
check(gapHb2.creditSec === 1, 'immediate HB after gap credits ≤1s not another 180');
gapState = { ...gapState, ...gapHb2.patch };
const gapHb3 = planHeartbeatSignalCredit(gapState, t10001);
check(gapHb3.creditSec === 0, 'duplicate immediate HB does not rebuild gap');

const legacyOpen = {
  ...newSession,
  signalTelemetryStatus: 'no_data',
  signalTrackingStartedAt: null,
};
const t14 = new Date('2026-01-01T14:00:00Z');
const legacyHb = planHeartbeatSignalCredit(legacyOpen, t14);
check(legacyHb.activationPatch?.signalTelemetryStatus === 'partial', 'legacy open → partial tracking');
check(legacyHb.creditSec === 0, 'legacy first HB no retroactive check-in credit');
check(legacyHb.patch.signalLastCreditedAt?.getTime() === t14.getTime(), 'legacy ancla = serverNow');

const closed = {
  ...after1,
  checkOutAt: new Date('2026-01-01T17:00:00Z'),
  signalLastCreditedAt: new Date('2026-01-01T16:58:00Z'),
  signalDurationSeconds: 1000,
  signalSampleCount: 5,
};
const closePlan = planCloseSignalCredit(
  { ...closed, checkOutAt: null },
  new Date('2026-01-01T17:00:00Z'),
);
check(closePlan.creditSec === 120, 'checkout final tramo up to 180');
check(
  closePlan.patch.signalLastCreditedAt?.getTime() === new Date('2026-01-01T17:00:00Z').getTime(),
  'checkout ancla = checkOutAt',
);

const legacyClosed = {
  checkInAt: checkIn,
  checkOutAt: new Date('2026-01-01T17:00:00Z'),
  signalTelemetryStatus: 'no_data',
  signalSampleCount: 0,
  signalDurationSeconds: 0,
};
check(
  sanitizeSessionRow(legacyClosed).signalDurationSeconds == null,
  'historic session → null signal (Sin datos)',
);

const openLive = {
  ...after1,
  lastHeartbeatAt: new Date(Date.now() - 30_000),
  lastVisibilityState: 'visible',
  signalDurationSeconds: 200,
  signalSampleCount: 3,
  signalLastCreditedAt: new Date(Date.now() - 30_000),
};
const projected = projectedSignalDurationSec(openLive, new Date());
check(projected != null && projected >= 200, 'open session projected includes pending');

check(connectionEffectivePercent(400, 500) === 80, 'effective 80%');
check(
  resolveConnectionVisualLevel(80, 3600 * 8, 3600 * 6, SIGNAL_TELEMETRY.FULL) === 'green',
  'semaforo green 80% gap 2h',
);
check(
  resolveConnectionVisualLevel(70, 3600 * 8, 3600 * 6, SIGNAL_TELEMETRY.FULL) === 'amber',
  'semaforo amber 70%',
);
check(
  resolveConnectionVisualLevel(50, 3600 * 8, 3600 * 2, SIGNAL_TELEMETRY.FULL) === 'coral',
  'semaforo coral 50%',
);
check(
  resolveConnectionVisualLevel(90, 3600 * 8, 3600 * 4, SIGNAL_TELEMETRY.FULL) === 'coral',
  'semaforo coral gap >3h',
);
check(
  resolveConnectionVisualLevel(70, 1000, 500, SIGNAL_TELEMETRY.PARTIAL) == null,
  'partial → no semaforo',
);

const partialSession = {
  checkInAt: checkIn,
  checkOutAt: new Date('2026-01-01T17:00:00Z'),
  signalTelemetryStatus: 'partial',
  signalTrackingStartedAt: new Date('2026-01-01T14:00:00Z'),
  signalDurationSeconds: 600,
  signalSampleCount: 4,
  lastHeartbeatAt: new Date('2026-01-01T16:00:00Z'),
  lastVisibilityState: 'visible',
};
const partialMetrics = enrichSessionSignalMetrics(partialSession);
check(partialMetrics.connectionEffectivePercent == null, 'partial → null connectionEffectivePercent');
check(partialMetrics.connectionVisualLevel == null, 'partial → no semaforo in contract');
check(partialMetrics.expectedCoveragePercent == null, 'partial → no expected coverage');

const tz = 'America/Mexico_City';
const sessions = [
  {
    checkInAt: new Date('2026-10-01T15:00:00Z'),
    checkOutAt: new Date('2026-10-01T23:00:00Z'),
    signalTelemetryStatus: 'full',
    signalTrackingStartedAt: new Date('2026-10-01T15:00:00Z'),
    signalDurationSeconds: 7200,
    signalSampleCount: 10,
    lastHeartbeatAt: new Date('2026-10-01T23:00:00Z'),
    lastVisibilityState: 'visible',
  },
  {
    checkInAt: new Date('2026-10-02T15:00:00Z'),
    checkOutAt: new Date('2026-10-02T23:00:00Z'),
    signalTelemetryStatus: 'no_data',
    signalSampleCount: 0,
    signalDurationSeconds: 0,
  },
  {
    checkInAt: new Date('2026-10-03T15:00:00Z'),
    checkOutAt: new Date('2026-10-03T23:00:00Z'),
    signalTelemetryStatus: 'partial',
    signalTrackingStartedAt: new Date('2026-10-03T20:00:00Z'),
    signalDurationSeconds: 1800,
    signalSampleCount: 3,
    lastHeartbeatAt: new Date('2026-10-03T22:00:00Z'),
    lastVisibilityState: 'visible',
  },
];
const summary = buildConnectionSummaryForSessions(
  sessions,
  tz,
  '2026-10-01',
  '2026-10-31',
  new Date('2026-10-15T12:00:00Z'),
);
check(summary.sessionCountWithFullTelemetry === 1, 'summary only full official sessions');
check(summary.overallConnectionEffectivePercent === 25, 'weighted overall 7200/28800=25%');
check(
  summary.totalSignalDurationSec === 7200,
  'partial/no_data excluded from total signal',
);

console.log('\n=== Signal duration — static ===\n');

check(/signalDurationSeconds/.test(schema), 'schema signalDurationSeconds');
check(/signalTelemetryStatus/.test(schema), 'schema telemetry enum');
check(/lockOpenSessionRow/.test(sessionSvc), 'FOR UPDATE lock on heartbeat');
check(/planHeartbeatSignalCredit/.test(sessionSvc), 'heartbeat accumulation wired');
check(/planCloseSignalCredit/.test(sessionSvc), 'checkout accumulation wired');
check(/Resumen de conexión/.test(indexHtml), 'UI connection summary');
check(/TC_JORNADA_LIVE_POLL_MS=60000/.test(indexHtml), 'admin live poll 60s');
check(/tcJornadaStopLivePoll/.test(indexHtml), 'poll cleanup');
check(
  fs.existsSync(
    path.join(root, 'prisma/migrations/20261031150000_remote_work_signal_duration/migration.sql'),
  ),
  'migration timestamp 20261031150000',
);
check(
  !fs.existsSync(
    path.join(root, 'prisma/migrations/20261030120000_remote_work_signal_duration/migration.sql'),
  ),
  'old migration prefix removed',
);

console.log('\n=== Signal duration — integration (DB) ===\n');

let dbOk = false;
let prisma;
try {
  ({ prisma } = await import('../src/db/client.js'));
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP integration:', e.message);
}

if (dbOk) {
  console.log('  SKIP concurrent heartbeat (2 tabs) — not automated');
  console.log('  SKIP checkout vs heartbeat race — not automated');
  console.log('  SKIP multi-tenant isolation — use test-timeclock-schema-and-backend');
  await prisma.$disconnect();
} else {
  console.log('  SKIP all Postgres concurrency / FOR UPDATE certification');
}

console.log(failed ? `\n${failed} failed\n` : '\nAll checks passed.\n');
process.exit(failed ? 1 : 0);

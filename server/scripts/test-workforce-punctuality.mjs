/**
 * Puntualidad semanal. node server/scripts/test-workforce-punctuality.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(rootDir, '..');
dotenv.config({ path: path.join(rootDir, '.env') });
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'workforce-punctuality-test-secret';
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';

const {
  assertPunctualityWeekKey,
  buildWeekPunctuality,
  formatPunctualityWeekLabel,
  resolvePunctualityWeek,
} = await import('../src/utils/workforcePunctuality.util.js');
const { utcInstantFromLocalParts } = await import('../src/utils/timezoneLocalInstant.util.js');
const { weekRangeMonday } = await import('../src/services/remoteWorkSessionHistory.service.js');
const { workedDurationSec } = await import('../src/services/remoteWorkSession.service.js');

const indexHtml = fs.readFileSync(path.join(repoDir, 'index.html'), 'utf8');
const routesJs = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.org.routes.js'), 'utf8');
const serviceJs = fs.readFileSync(path.join(rootDir, 'src/services/workforcePunctuality.service.js'), 'utf8');
const punctualityUtilJs = fs.readFileSync(path.join(rootDir, 'src/utils/workforcePunctuality.util.js'), 'utf8');
const interviewJs = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentInterviewSchedule.service.js'), 'utf8');
const historyJs = fs.readFileSync(path.join(rootDir, 'src/services/remoteWorkSessionHistory.service.js'), 'utf8');
const errorJs = fs.readFileSync(path.join(rootDir, 'src/middleware/error.middleware.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(rootDir, 'src/services/candidate.service.js'), 'utf8');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

const TZ = 'America/Mexico_City';
const ASSIGNED = '2026-11-01T00:00:00.000Z';
function sched(weekdays, assignedAt = ASSIGNED, startMinute = 480, endMinute = 900, toleranceMinutes = 10) {
  return { weekdays, restDays: [], startMinute, endMinute, toleranceMinutes, assignedAt };
}
function sess(start, end) {
  return { id: start, checkInAt: new Date(start), checkOutAt: end ? new Date(end) : null };
}
function week(days, schedule, now, sessions, weekStart = '2026-11-02') {
  return buildWeekPunctuality({ schedule, timeZone: TZ, weekStart, now: new Date(now), sessions });
}
function day(result, key) {
  return result.days.find((item) => item.dateKey === key);
}

const monFri = sched([1, 2, 3, 4, 5]);
const nowAfter = '2026-11-08T18:00:00.000Z';
const onTime = sess('2026-11-02T14:00:00.000Z', '2026-11-02T21:00:00.000Z');
const complete = week(null, monFri, nowAfter, [onTime]);
const monday = day(complete, '2026-11-02');
check(complete.days.length === 5, 'lunes a viernes muestra cinco tarjetas');
check(monday.status === 'COMPLETE' && monday.onTime !== true && monday.flags.includes('COMPLETE'), 'entrada exacta y salida exacta es completa');
check(monday.lateSec === 0 && monday.extraSec === 0 && monday.isEvaluable && monday.coveragePct === 100, 'completa sin retardo ni tiempo adicional');
check(monday.expectedStartAt === '2026-11-02T14:00:00.000Z' && monday.toleranceEndAt === '2026-11-02T14:10:00.000Z' && monday.expectedEndAt === '2026-11-02T21:00:00.000Z', 'la entrada, la tolerancia y la salida caen en el minuto civil exacto');
check(monday.workedSec === workedDurationSec(onTime, new Date(nowAfter)), 'una sesión usa la duración canónica');

const inside = week(null, monFri, nowAfter, [sess('2026-11-03T14:05:00.000Z', '2026-11-03T21:05:00.000Z')]);
check(day(inside, '2026-11-03').status === 'COMPLETE' && day(inside, '2026-11-03').lateSec === 0, 'dentro de tolerancia no es retardo');
const edge = week(null, monFri, nowAfter, [sess('2026-11-04T14:10:00.000Z', '2026-11-04T21:10:00.000Z')]);
check(day(edge, '2026-11-04').status === 'COMPLETE' && day(edge, '2026-11-04').lateSec === 0, 'entrar al final de tolerancia es puntual');
const late = week(null, monFri, nowAfter, [sess('2026-11-03T14:17:00.000Z', '2026-11-03T21:17:00.000Z')]);
check(day(late, '2026-11-03').status === 'LATE' && day(late, '2026-11-03').lateSec === 7 * 60, 'el retardo se cuenta desde el fin de tolerancia');
const earlyOut = week(null, monFri, nowAfter, [sess('2026-11-04T14:00:00.000Z', '2026-11-04T20:00:00.000Z')]);
check(day(earlyOut, '2026-11-04').status === 'INCOMPLETE', 'salida anticipada es jornada incompleta');
const plus29 = week(null, monFri, nowAfter, [sess('2026-11-05T14:00:00.000Z', '2026-11-05T21:29:00.000Z')]);
check(day(plus29, '2026-11-05').status === 'COMPLETE' && day(plus29, '2026-11-05').extraSec === 0, '29 minutos después no es tiempo adicional');
const plus30 = week(null, monFri, nowAfter, [sess('2026-11-06T14:00:00.000Z', '2026-11-06T21:30:00.000Z')]);
check(day(plus30, '2026-11-06').status === 'EXTRA' && day(plus30, '2026-11-06').extraSec === 30 * 60, '30 minutos después es tiempo adicional');
const plusMore = week(null, monFri, nowAfter, [sess('2026-11-06T14:00:00.000Z', '2026-11-06T21:42:00.000Z')]);
check(day(plusMore, '2026-11-06').flags.includes('EXTRA') && day(plusMore, '2026-11-06').coveragePct === 100, 'el tiempo adicional no supera 100% de cobertura');

const both = week(null, monFri, nowAfter, [sess('2026-11-03T14:17:00.000Z', '2026-11-03T20:00:00.000Z')]);
check(day(both, '2026-11-03').status === 'LATE' && day(both, '2026-11-03').flags.includes('INCOMPLETE'), 'retardo e incompleta priorizan el retardo');
const lateExtra = week(null, monFri, nowAfter, [sess('2026-11-03T14:17:00.000Z', '2026-11-03T21:50:00.000Z')]);
check(day(lateExtra, '2026-11-03').status === 'LATE' && day(lateExtra, '2026-11-03').flags.includes('EXTRA'), 'retardo y tiempo adicional priorizan el retardo');

const openNow = '2026-11-02T18:00:00.000Z';
const open = week(null, monFri, openNow, [sess('2026-11-02T14:06:00.000Z', null)]);
check(day(open, '2026-11-02').status === 'IN_PROGRESS' && day(open, '2026-11-02').isEvaluable === false, 'jornada abierta antes de la salida no se cierra');
const pending = week(null, monFri, '2026-11-02T13:30:00.000Z', []);
check(day(pending, '2026-11-02').status === 'PENDING' && pending.summary.punctualityPct == null, 'antes de la entrada el día está pendiente y no hay porcentaje');
const absent = week(null, monFri, nowAfter, []);
check(day(absent, '2026-11-02').status === 'NO_SHIFT' && absent.summary.punctualityPct === 0, 'sin jornada entra como no puntual');

const mixed = week(null, monFri, nowAfter, [
  sess('2026-11-02T14:04:00.000Z', '2026-11-02T21:03:00.000Z'),
  sess('2026-11-03T14:17:00.000Z', '2026-11-03T20:59:00.000Z'),
  sess('2026-11-04T14:00:00.000Z', '2026-11-04T21:08:00.000Z'),
]);
check(mixed.summary.punctualityPct === 40 && mixed.summary.lateDays === 1 && mixed.summary.evaluableDays === 5, 'puntualidad con ausencia y retardo');
check(mixed.summary.expectedCoveragePct < 100, 'la jornada incompleta baja el promedio');

const sat = week(null, sched([1, 2, 3, 4, 5, 6]), nowAfter, []);
check(sat.days.length === 6 && sat.days.every((item) => item.weekday !== 7), 'lunes a sábado no trata el domingo como ausencia');
const all = week(null, sched([1, 2, 3, 4, 5, 6, 7]), nowAfter, []);
check(all.days.length === 7, 'siete días laborables muestran siete tarjetas');
const gap = week(null, sched([1, 2, 4, 5]), nowAfter, [sess('2026-11-04T14:00:00.000Z', '2026-11-04T21:00:00.000Z')]);
check(gap.days.map((item) => item.weekday).join() === '1,2,4,5' && !day(gap, '2026-11-04'), 'un descanso entre semana no genera tarjeta ni usa su sesión');
const twoGaps = week(null, sched([1, 3, 5]), nowAfter, []);
check(twoGaps.days.map((item) => item.weekday).join() === '1,3,5', 'dos descansos entre semana conservan el orden');

const none = buildWeekPunctuality({ schedule: null, timeZone: TZ, weekStart: '2026-11-02', now: new Date(nowAfter), sessions: [onTime] });
check(none.emptyReason === 'NO_SCHEDULE' && none.days.length === 0 && none.summary == null, 'sin horario no hay tarjetas ni ceros');

const previous = week(null, sched([1, 2, 3, 4, 5], '2026-11-02T14:00:00.000Z'), nowAfter, [onTime], '2026-10-26');
check(previous.emptyReason === 'NOT_IN_FORCE' && previous.days.length === 0, 'una semana anterior no se recalcula con el horario nuevo');
const mid = week(null, sched([1, 2, 3, 4, 5], '2026-11-04T14:30:00.000Z'), nowAfter, [
  sess('2026-11-02T14:00:00.000Z', '2026-11-02T21:00:00.000Z'),
  sess('2026-11-04T14:00:00.000Z', '2026-11-04T21:00:00.000Z'),
]);
check(!day(mid, '2026-11-02') && !day(mid, '2026-11-04') && day(mid, '2026-11-05'), 'si el horario llega después de la entrada, ese día no se evalúa');
const exact = week(null, sched([1, 2, 3, 4, 5], '2026-11-04T14:00:00.000Z'), nowAfter, [sess('2026-11-04T14:00:00.000Z', '2026-11-04T21:00:00.000Z')]);
check(day(exact, '2026-11-04').status === 'COMPLETE', 'si el horario llega antes o justo a la entrada, el día sí se evalúa');

const overlap = week(null, monFri, nowAfter, [
  sess('2026-11-02T14:00:00.000Z', '2026-11-02T18:00:00.000Z'),
  sess('2026-11-02T16:00:00.000Z', '2026-11-02T19:00:00.000Z'),
]);
check(day(overlap, '2026-11-02').workedSec === 5 * 3600, 'los intervalos superpuestos no se suman dos veces');

const tijuana = buildWeekPunctuality({
  schedule: sched([1, 2, 3, 4, 5, 6, 7]),
  timeZone: 'America/Tijuana',
  weekStart: '2026-11-02',
  now: new Date(nowAfter),
  sessions: [sess('2026-11-03T07:30:00.000Z', '2026-11-03T16:00:00.000Z')],
});
check(day(tijuana, '2026-11-02')?.firstCheckInAt && !day(tijuana, '2026-11-03')?.firstCheckInAt, 'la fecha local no se calcula sumando 24 horas en UTC');

const dst = buildWeekPunctuality({
  schedule: sched([7], '2026-03-01T00:00:00.000Z'),
  timeZone: 'America/New_York',
  weekStart: weekRangeMonday('2026-03-08', 'America/New_York').weekStart,
  now: new Date('2026-03-10T18:00:00.000Z'),
  sessions: [],
});
const dstDay = dst.days.find((item) => item.dateKey === '2026-03-08');
const dstHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(dstDay.expectedStartAt));
check(dstHour === '08', 'un cambio de horario conserva las 8:00 locales');

check(formatPunctualityWeekLabel('2026-11-02', TZ) === '2–8 nov 2026', 'semana del mismo mes');
const cross = weekRangeMonday('2026-12-01', TZ);
check(formatPunctualityWeekLabel(cross.weekStart, TZ).includes('nov') && formatPunctualityWeekLabel(cross.weekStart, TZ).includes('dic'), 'semana que cruza de mes');
const year = weekRangeMonday('2026-01-01', TZ);
const yearLabel = formatPunctualityWeekLabel(year.weekStart, TZ);
check(/2025/.test(yearLabel) && /2026/.test(yearLabel), 'semana que cruza de año');
let invalidWeek = '';
try { assertPunctualityWeekKey('manana'); } catch (err) { invalidWeek = err.message; }
check(invalidWeek === 'La semana debe indicarse como YYYY-MM-DD.', 'una semana inválida se rechaza');
check(resolvePunctualityWeek('2026-11-20', TZ, new Date('2026-11-05T18:00:00.000Z')).future === true, 'no se navega a una semana futura');
check(resolvePunctualityWeek('2026-11-02', TZ, new Date('2026-11-05T18:00:00.000Z')).future === false, 'la semana actual sigue disponible');

const capped = week(null, monFri, nowAfter, [
  sess('2026-11-02T14:00:00.000Z', '2026-11-02T23:00:00.000Z'),
  sess('2026-11-03T14:00:00.000Z', '2026-11-03T18:00:00.000Z'),
]);
check(day(capped, '2026-11-02').coveragePct === 100 && capped.summary.expectedCoveragePct < 100, 'un día largo no compensa a otro');

function localHms(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const pick = (type) => parts.find((part) => part.type === type).value;
  return `${pick('hour')}:${pick('minute')}:${pick('second')}`;
}
check(monday.toleranceEndAt === '2026-11-02T14:10:00.000Z', '08:10:00.000 es el fin de tolerancia');
check(day(late, '2026-11-03').lateSec === 420, '08:17:00.000 produce un retardo de 420 segundos');
check(new Date(monday.expectedEndAt).getTime() + 30 * 60 * 1000 === Date.parse('2026-11-02T21:30:00.000Z'), 'la salida 15:00 más 30 min cae en 15:30:00.000');
const almostExtra = week(null, monFri, nowAfter, [sess('2026-11-06T14:00:00.000Z', '2026-11-06T21:29:59.999Z')]);
check(day(almostExtra, '2026-11-06').extraSec === 0 && !day(almostExtra, '2026-11-06').flags.includes('EXTRA'), '15:29:59.999 no activa tiempo adicional');
const exactExtra = week(null, monFri, nowAfter, [sess('2026-11-06T14:00:00.000Z', '2026-11-06T21:30:00.000Z')]);
check(day(exactExtra, '2026-11-06').status === 'EXTRA' && day(exactExtra, '2026-11-06').extraSec === 1800, '15:30:00.000 sí activa tiempo adicional');
check(localHms(dstDay.expectedStartAt, 'America/New_York') === '08:00:00', 'el cambio de horario no corre el minuto de las 8:00');
check(localHms(utcInstantFromLocalParts('2026-03-08', 8, 10, 'America/New_York').toISOString(), 'America/New_York') === '08:10:00', 'las 8:10 se mantienen en la semana con DST');
check(localHms(utcInstantFromLocalParts('2026-11-01', 1, 30, 'America/New_York').toISOString(), 'America/New_York') === '01:30:00', 'la hora repetida de otoño no se desplaza');
check(utcInstantFromLocalParts('2026-10-29', 10, 30, TZ).toISOString() === '2026-10-29T16:30:00.000Z', 'una entrevista a las 10:30 conserva el instante');

const awaiting = week(null, monFri, '2026-11-02T16:00:00.000Z', []);
check(day(awaiting, '2026-11-02').status === 'AWAITING' && day(awaiting, '2026-11-02').headline === 'Sin entrada' && day(awaiting, '2026-11-02').isEvaluable === false && awaiting.summary.punctualityPct == null, 'sin checada antes de la salida no es ausencia ni porcentaje');
check(day(pending, '2026-11-06').status === 'NOT_EVALUABLE', 'un día futuro no se muestra como sin jornada');
const openAfter = week(null, monFri, '2026-11-02T22:00:00.000Z', [sess('2026-11-02T14:17:00.000Z', null)]);
check(day(openAfter, '2026-11-02').status === 'IN_PROGRESS' && day(openAfter, '2026-11-02').isEvaluable && day(openAfter, '2026-11-02').flags.includes('LATE') && !day(openAfter, '2026-11-02').flags.includes('COMPLETE') && day(openAfter, '2026-11-02').coveragePct === 100 && openAfter.summary.punctualityPct === 0, 'la jornada abierta después de la salida sigue en curso y sí entra en métricas');
const closedEarly = week(null, monFri, '2026-11-02T19:00:00.000Z', [sess('2026-11-02T14:00:00.000Z', '2026-11-02T18:00:00.000Z')]);
check(day(closedEarly, '2026-11-02').status === 'INCOMPLETE' && day(closedEarly, '2026-11-02').isEvaluable && closedEarly.summary.punctualityPct === 100 && day(closedEarly, '2026-11-02').coveragePct < 100, 'una jornada cerrada antes de la salida ya se evalúa');
check(day(pending, '2026-11-02').status === 'PENDING' && day(pending, '2026-11-02').isEvaluable === false, 'antes de la entrada el día queda pendiente');
check(monday.flags.join() === 'COMPLETE', 'completa solo cuando no hay una alerta de mayor prioridad');
const incompleteExtra = week(null, monFri, nowAfter, [
  sess('2026-11-03T14:00:00.000Z', '2026-11-03T15:00:00.000Z'),
  sess('2026-11-03T21:40:00.000Z', '2026-11-03T21:50:00.000Z'),
]);
check(day(incompleteExtra, '2026-11-03').status === 'INCOMPLETE' && day(incompleteExtra, '2026-11-03').flags.includes('EXTRA'), 'la jornada incompleta tiene prioridad sobre el tiempo adicional');

const beforeEntry = week(null, sched([1], '2026-11-02T13:59:59.999Z'), nowAfter, [onTime]);
check(day(beforeEntry, '2026-11-02').isEvaluable && day(beforeEntry, '2026-11-02').status === 'COMPLETE', 'assignedAt antes de la entrada deja el día evaluable');
const atEntry = week(null, sched([1], '2026-11-02T14:00:00.000Z'), nowAfter, [onTime]);
check(day(atEntry, '2026-11-02').isEvaluable, 'assignedAt en el milisegundo de la entrada deja el día evaluable');
const afterEntry = week(null, sched([1], '2026-11-02T14:00:00.001Z'), nowAfter, [onTime]);
check(afterEntry.emptyReason === 'NOT_IN_FORCE' && afterEntry.days.length === 0, 'un milisegundo después de la entrada el día no se penaliza');
const restBase = week(null, sched([1, 2, 4, 5]), nowAfter, []);
const restHit = week(null, sched([1, 2, 4, 5]), nowAfter, [sess('2026-11-04T14:00:00.000Z', '2026-11-04T21:00:00.000Z')]);
check(JSON.stringify(restBase.summary) === JSON.stringify(restHit.summary) && restBase.days.length === restHit.days.length, 'una sesión en día de descanso no cambia los porcentajes');

const touching = week(null, monFri, nowAfter, [
  sess('2026-11-02T14:00:00.000Z', '2026-11-02T16:00:00.000Z'),
  sess('2026-11-02T16:00:00.000Z', '2026-11-02T18:00:00.000Z'),
]);
check(day(touching, '2026-11-02').workedSec === 4 * 3600, 'los intervalos contiguos no se duplican');
const firstLast = week(null, monFri, nowAfter, [
  sess('2026-11-03T14:17:00.000Z', '2026-11-03T16:00:00.000Z'),
  sess('2026-11-03T18:00:00.000Z', '2026-11-03T21:00:00.000Z'),
]);
check(day(firstLast, '2026-11-03').firstCheckInAt === '2026-11-03T14:17:00.000Z' && day(firstLast, '2026-11-03').lastCheckOutAt === '2026-11-03T21:00:00.000Z' && day(firstLast, '2026-11-03').status === 'LATE', 'la puntualidad usa la primera entrada y el tiempo adicional la última salida');
const openOnly = week(null, monFri, '2026-11-02T18:00:00.000Z', [sess('2026-11-02T14:00:00.000Z', null)]);
check(day(openOnly, '2026-11-02').lastCheckOutAt == null, 'una jornada abierta no inventa salida');
const openMixed = week(null, monFri, '2026-11-02T18:00:00.000Z', [
  sess('2026-11-02T14:00:00.000Z', '2026-11-02T15:00:00.000Z'),
  sess('2026-11-02T16:00:00.000Z', null),
]);
check(day(openMixed, '2026-11-02').status === 'IN_PROGRESS' && day(openMixed, '2026-11-02').lastCheckOutAt == null && day(openMixed, '2026-11-02').firstCheckInAt === '2026-11-02T14:00:00.000Z', 'con una sesión abierta la salida informativa queda vacía');
const overnight = buildWeekPunctuality({
  schedule: sched([1, 2, 3, 4, 5, 6, 7]),
  timeZone: TZ,
  weekStart: '2026-11-02',
  now: new Date(nowAfter),
  sessions: [sess('2026-11-03T05:30:00.000Z', '2026-11-03T07:00:00.000Z')],
});
check(day(overnight, '2026-11-02')?.firstCheckInAt && !day(overnight, '2026-11-03')?.firstCheckInAt && day(overnight, '2026-11-02').workedSec === 90 * 60 && day(overnight, '2026-11-03').status === 'NO_SHIFT', 'una sesión que cruza medianoche pertenece solo al día de la entrada');
const signaled = sess('2026-11-02T14:00:00.000Z', '2026-11-02T21:00:00.000Z');
signaled.signalDurationSeconds = 1;
check(day(week(null, monFri, nowAfter, [signaled]), '2026-11-02').workedSec === 7 * 3600, 'el tiempo con señal no sustituye la duración trabajada');

check(!('summary' in complete.schedule), 'el horario no trae un segundo summary');
check(Object.keys(complete.schedule).sort().join(',') === 'assignedAt,endMinute,restDays,startMinute,toleranceMinutes,weekdays', 'contrato del horario');
check(Object.keys(complete.summary).sort().join(',') === 'evaluableDays,expectedCoveragePct,extraTimeDays,lateDays,punctualityPct', 'contrato del resumen');
check(none.schedule == null && none.summary == null, 'sin horario el schedule y el summary quedan nulos');

check(routesJs.includes("'/employees/:id/punctuality'") && routesJs.includes('assertEmpresaAdmin') && routesJs.includes('getEmployeeWeekPunctuality'), 'endpoint administrativo de puntualidad');
check(!/punctuality[\s\S]{0,500}timezone:/.test(routesJs), 'la zona no se acepta en la consulta');
check(serviceJs.includes('checkInAt: { gte: range.start, lt: range.end }') && serviceJs.includes('select: { id: true, checkInAt: true, checkOutAt: true }'), 'una sola consulta de la semana, sin señal ni bitácora');
check((serviceJs.match(/findMany/g) || []).length === 1 && /if \(schedule\) \{[\s\S]*findMany/.test(serviceJs), 'sin horario no hay consulta y no existe una consulta por día');
check(!/getEmployeeWeekPunctuality\(\{[^}]*timeZone/.test(serviceJs) && !/req\.query\.(timezone|summary|punctualityPct)/.test(routesJs), 'el servicio no acepta zona ni métricas del cliente');
check(routesJs.includes('assertEmpresaAdmin(req.session.userId)') && /FORBIDDEN:\s*403/.test(errorJs) && /err\.code = 'FORBIDDEN'/.test(adminJs), 'un rol distinto de empresa_admin termina en 403');
check(/NOT_FOUND:\s*404/.test(errorJs) && serviceJs.includes('assertWorkforceEmployeeInOrg'), 'empleado ajeno o inexistente usa el 404 de la organización');
check(punctualityUtilJs.includes("from './timezoneLocalInstant.util.js'") && !punctualityUtilJs.includes('recruitmentInterviewSchedule'), 'puntualidad no depende de entrevistas');
check(interviewJs.includes("from '../utils/timezoneLocalInstant.util.js'") && !/while \(lo < hi\)/.test(interviewJs), 'entrevistas usan el helper neutro');
check(!historyJs.includes('timezoneLocalInstant') && !historyJs.includes('recruitmentInterviewSchedule'), 'el historial no crea un ciclo con el helper');
check(!indexHtml.includes('schedule.summary') && indexHtml.includes('function tcPunctScheduleLine'), 'la interfaz arma el horario desde el contrato, sin summary duplicado');
check(indexHtml.includes('if(onPunct&&tcHistoryFetchAbort)') && indexHtml.includes('if(!onPunct&&tcPunctAbort)') && indexHtml.includes("tcHistoryView='history'") && indexHtml.includes('if(tcPunctDocBound) return') && indexHtml.includes('removeEventListener') && indexHtml.includes('Reintentar'), 'el cambio de pestaña, el cierre y el reintento limpian la carga');
check(indexHtml.includes("tcHistorySetView('history')") && indexHtml.includes("tcHistorySetView('punctuality')"), 'tabs Historial y Puntualidad semanal');
check(indexHtml.includes('id="tc-hist-view-history"') && indexHtml.includes('id="tc-hist-view-punct"'), 'la puntualidad sustituye el panel del historial');
check(!/tc-jornada-tab-indicators[\s\S]{0,200}Puntualidad semanal/.test(indexHtml), 'no se coloca en Indicadores');
check(indexHtml.includes('Semana anterior') && indexHtml.includes('Semana siguiente') && indexHtml.includes('canGoNext===false'), 'navegación semanal con siguiente deshabilitada');
check(indexHtml.includes('tc-punct-days') && indexHtml.includes('overflow-x:auto') && indexHtml.includes('overflow-x:hidden'), 'la fila de días se desplaza sin mover el diálogo');
check(indexHtml.includes('tcPunctCardClick') && indexHtml.includes('tcPunctClosePopover') && indexHtml.includes("e.key!=='Escape'") && indexHtml.includes('tcPunctIgnoreHover'), 'popover por clic, Escape y devolución de foco');
check(/id="tc-hist-view-punct"[\s\S]{0,280}<\/div>\s*<\/div>\s*<div id="tc-punct-pop"/.test(indexHtml), 'el popover queda fuera del scroll del historial');
check(indexHtml.includes('tcPunctOnScroll') && indexHtml.includes('min-width:0;max-width:100%'), 'scroll de tarjetas acotado y el popover se reubica');
check(indexHtml.includes("'<p>'+tcEsc(line)+'</p>'") && indexHtml.includes('tcEsc(day.headline'), 'el detalle y el estado se escapan');
check(indexHtml.includes('tcPunctSeq') && indexHtml.includes('tcPunctAbort') && indexHtml.includes("e.name==='AbortError'"), 'abort y descarte de respuestas');
check(indexHtml.includes('tcRefreshPunctuality') && indexHtml.includes('aria-label="Actualizar puntualidad semanal"'), 'actualizar conserva la vista semanal');
check(indexHtml.includes('Este colaborador todavía no tiene un horario laboral asignado.') && indexHtml.includes('El horario actual todavía no aplicaba en esta semana.') && indexHtml.includes('Aún no hay días evaluables en esta semana.'), 'empty states');
check(!/tc-punct[\s\S]{0,800}Descargar|download/.test(indexHtml.slice(indexHtml.indexOf('tc-punct-panel'), indexHtml.indexOf('tc-punct-panel') + 2500)), 'sin botón de descarga inerte');
check(indexHtml.includes('prefers-reduced-motion') && indexHtml.includes('tc-history-tab:focus-visible'), 'foco visible y reduced motion');
check(indexHtml.includes('Historial de jornadas') && indexHtml.includes('aria-label="Actualizar historial"') && indexHtml.includes('tc-cal-root'), 'el historial original sigue en el modal');
check(fs.readFileSync(path.join(rootDir, 'public/index.html')).equals(fs.readFileSync(path.join(repoDir, 'index.html'))), 'HTML idéntico');

let integration = 'SKIP';
try {
  const { prisma } = await import('../src/db/client.js');
  try {
    await prisma.$queryRaw`SELECT 1`;
    integration = 'RUN';
  } catch (err) {
    integration = `SKIP ${err.message}`;
  } finally {
    await prisma.$disconnect();
  }
} catch (err) {
  integration = `SKIP ${err.message}`;
}
console.log(`  ${integration.startsWith('SKIP') ? 'SKIP' : 'OK'}  integración PostgreSQL: ${integration}`);

if (failed) {
  console.error(`\n${failed} fallo(s)`);
  process.exit(1);
}
console.log('\nPuntualidad semanal: OK');

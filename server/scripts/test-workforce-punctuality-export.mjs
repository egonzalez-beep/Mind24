/**
 * Exportación PDF de puntualidad semanal.
 * node server/scripts/test-workforce-punctuality-export.mjs
 */
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(rootDir, '..');
dotenv.config({ path: path.join(rootDir, '.env') });
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'workforce-punctuality-export-test-secret';
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';

const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (chromePath) process.env.PUPPETEER_EXECUTABLE_PATH = chromePath;

const { encodeWeekdayMask } = await import('../src/utils/workforceWorkSchedule.util.js');
const { buildWeekPunctuality, formatTimeEs } = await import('../src/utils/workforcePunctuality.util.js');
const { localMidnightUtc, utcRangeForLocalDateInclusive } = await import('../src/services/remoteWorkSessionHistory.service.js');
const {
  buildWeeklyPunctualityReportDocument,
  escapeReportHtml,
  paginatePunctualityPeople,
  punctualityExportContentDisposition,
  punctualityExportFilename,
  punctualityPdfDayCells,
  summarizePunctualityReports,
} = await import('../src/utils/workforcePunctualityReport.util.js');
const { assembleWeeklyPunctualityExport, exportWeeklyPunctualityPdf } = await import('../src/services/workforcePunctualityExport.service.js');
const orgRoutes = (await import('../src/routes/org.routes.js')).default;

const indexHtml = fs.readFileSync(path.join(repoDir, 'index.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');
const routesJs = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.org.routes.js'), 'utf8');
const individualJs = fs.readFileSync(path.join(rootDir, 'src/services/workforcePunctuality.service.js'), 'utf8');
const exportJs = fs.readFileSync(path.join(rootDir, 'src/services/workforcePunctualityExport.service.js'), 'utf8');
const pdfJs = fs.readFileSync(path.join(rootDir, 'src/services/pdf.service.js'), 'utf8');
const unifiedJs = fs.readFileSync(path.join(rootDir, 'src/services/unifiedReport.service.js'), 'utf8');

let failed = 0;
function check(cond, label) {
  if (cond) console.log('  OK ', label);
  else {
    failed += 1;
    console.error('  FAIL', label);
  }
}

const TZ = 'America/Mexico_City';
const WEEK = '2026-11-02';
const NOW = new Date('2026-11-06T23:30:00.000Z');
const SECRET_EMAIL = 'secreto-export@ejemplo.test';
const SECRET_PHONE = '555-0199-7788';
const SECRET_CURP = 'LOPM800101HDFRNS09';
const SECRET_NOTE = 'NOTA-PRIVADA-XYZ';
const SECRET_LOG = 'BITACORA-PRIVADA-XYZ';

function scheduleRow(weekdays, assignedAt, extra = {}) {
  return {
    timezone: TZ,
    isActive: true,
    organizationId: 'org-a',
    organization: { name: 'Clínica Niño' },
    email: SECRET_EMAIL,
    phone: SECRET_PHONE,
    curp: SECRET_CURP,
    notes: SECRET_NOTE,
    workScheduleStartMinute: 8 * 60,
    workScheduleEndMinute: 15 * 60,
    workScheduleToleranceMinutes: 10,
    workScheduleWeekdayMask: encodeWeekdayMask(weekdays),
    workScheduleAssignedAt: new Date(assignedAt),
    ...extra,
  };
}

function sess(employeeId, checkInAt, checkOutAt) {
  return {
    id: `${employeeId}-${checkInAt}`,
    employeeId,
    checkInAt: new Date(checkInAt),
    checkOutAt: checkOutAt ? new Date(checkOutAt) : null,
    workLog: SECRET_LOG,
    signalDurationSeconds: 1,
  };
}

const mariaId = 'emp-maria';
const employees = [
  scheduleRow([1, 2, 3, 4, 5, 6], '2026-10-01T14:00:00.000Z', {
    id: mariaId,
    fullName: 'María José López Hernández de la Torre y Núñez',
  }),
  scheduleRow([1, 2, 4, 5], '2026-10-01T14:00:00.000Z', {
    id: 'emp-pedro',
    fullName: 'Pedro Días <script>',
  }),
  scheduleRow([1, 2, 3, 4, 5], '2026-10-01T14:00:00.000Z', {
    id: 'emp-ana',
    fullName: 'Ana Encurso',
  }),
  scheduleRow([1, 2, 3, 4, 5], '2026-10-01T14:00:00.000Z', {
    id: 'emp-luis',
    fullName: 'Luis Adicional',
  }),
  scheduleRow([1, 2, 3, 4, 5], '2026-11-04T14:00:00.000Z', {
    id: 'emp-ines',
    fullName: 'Inés Vigencia',
  }),
  scheduleRow([1, 2, 3, 4, 5], '2026-11-10T14:00:00.000Z', {
    id: 'emp-olga',
    fullName: 'Olga Anterior',
  }),
  scheduleRow([1, 2, 3, 4, 5, 6, 7], '2026-10-01T14:00:00.000Z', {
    id: 'emp-nora',
    fullName: 'Nora Medianoche',
  }),
  ...Array.from({ length: 6 }, (_, index) => scheduleRow([1, 2, 3, 4, 5], '2026-10-01T14:00:00.000Z', {
    id: `emp-fill-${index}`,
    fullName: `Colaborador de apoyo ${String(index + 1).padStart(2, '0')}`,
  })),
  scheduleRow([1, 2, 3, 4, 5], '2026-10-01T14:00:00.000Z', {
    id: 'emp-off',
    fullName: 'Inactivo No Debe Salir',
    isActive: false,
  }),
  scheduleRow([1, 2, 3, 4, 5], '2026-10-01T14:00:00.000Z', {
    id: 'emp-b',
    fullName: 'Beatriz Otra Organización',
    organizationId: 'org-b',
    organization: { name: 'Otra Clínica' },
  }),
  {
    id: 'emp-none',
    fullName: 'Sin Horario Activo',
    timezone: TZ,
    isActive: true,
    organizationId: 'org-a',
    organization: { name: 'Clínica Niño' },
    email: SECRET_EMAIL,
    workScheduleStartMinute: null,
    workScheduleEndMinute: null,
    workScheduleToleranceMinutes: null,
    workScheduleWeekdayMask: null,
    workScheduleAssignedAt: null,
  },
];

const sessions = [
  sess(mariaId, '2026-11-02T14:00:00.000Z', '2026-11-02T21:00:00.000Z'),
  sess(mariaId, '2026-11-03T14:17:00.000Z', '2026-11-03T21:17:00.000Z'),
  sess(mariaId, '2026-11-04T14:00:00.000Z', '2026-11-04T18:00:00.000Z'),
  sess(mariaId, '2026-11-06T14:00:00.000Z', '2026-11-06T21:40:00.000Z'),
  sess('emp-ana', '2026-11-06T14:05:00.000Z', null),
  sess('emp-luis', '2026-11-05T14:00:00.000Z', '2026-11-05T21:40:00.000Z'),
  sess('emp-nora', '2026-11-02T14:00:00.000Z', '2026-11-02T18:00:00.000Z'),
  sess('emp-nora', '2026-11-02T16:00:00.000Z', '2026-11-02T19:00:00.000Z'),
  sess('emp-nora', '2026-11-03T05:30:00.000Z', '2026-11-03T07:00:00.000Z'),
  sess('emp-b', '2026-11-02T14:00:00.000Z', '2026-11-02T21:00:00.000Z'),
];

function project(row, select) {
  const out = {};
  for (const [key, value] of Object.entries(select || {})) {
    if (value === true) out[key] = row[key];
    else if (value && value.select) out[key] = project(row[key] || {}, value.select);
  }
  return out;
}

function matchesEmployee(row, where) {
  if (where.organizationId && row.organizationId !== where.organizationId) return false;
  if (where.isActive === true && row.isActive !== true) return false;
  for (const key of ['workScheduleAssignedAt', 'workScheduleWeekdayMask', 'workScheduleStartMinute', 'workScheduleEndMinute', 'workScheduleToleranceMinutes']) {
    if (where[key] && Object.prototype.hasOwnProperty.call(where[key], 'not') && where[key].not === null && row[key] == null) return false;
  }
  return true;
}

function matchesSession(row, where) {
  const ids = where.employeeId?.in || [];
  if (!ids.includes(row.employeeId)) return false;
  const at = new Date(row.checkInAt).getTime();
  if (where.checkInAt?.gte && at < new Date(where.checkInAt.gte).getTime()) return false;
  if (where.checkInAt?.lt && at >= new Date(where.checkInAt.lt).getTime()) return false;
  return true;
}

function dbFrom(rows, sessionRows, calls = {}) {
  return {
    workforceEmployee: {
      async findMany(args) {
        calls.employeeWhere = args.where;
        calls.employeeSelect = args.select;
        return rows.filter((row) => matchesEmployee(row, args.where)).map((row) => project(row, args.select));
      },
    },
    remoteWorkSession: {
      async findMany(args) {
        calls.sessionWhere = args.where;
        calls.sessionSelect = args.select;
        return sessionRows.filter((row) => matchesSession(row, args.where)).map((row) => project(row, args.select));
      },
    },
  };
}

function fakeDb(calls) {
  return dbFrom(employees, sessions, calls);
}

function personEngine(row, ownSessions) {
  const schedule = {
    weekdays: null,
    startMinute: row.workScheduleStartMinute,
    endMinute: row.workScheduleEndMinute,
    toleranceMinutes: row.workScheduleToleranceMinutes,
    assignedAt: new Date(row.workScheduleAssignedAt).toISOString(),
  };
  const mask = row.workScheduleWeekdayMask;
  const weekdays = [];
  for (let day = 1; day <= 7; day += 1) if (mask & (1 << (day - 1))) weekdays.push(day);
  schedule.weekdays = weekdays;
  return buildWeekPunctuality({
    schedule: { ...schedule, restDays: [1, 2, 3, 4, 5, 6, 7].filter((day) => !weekdays.includes(day)) },
    timeZone: row.timezone,
    weekStart: WEEK,
    now: NOW,
    sessions: ownSessions,
  });
}

const calls = {};
const report = await assembleWeeklyPunctualityExport({
  organizationId: 'org-a',
  weekKey: WEEK,
  now: NOW,
  db: fakeDb(calls),
});

check(report.weekStart === WEEK, 'exporta la semana seleccionada, no otra');
check(report.people.some((person) => person.fullName.startsWith('María José')) && !report.people.some((person) => person.fullName.includes('Beatriz') || person.fullName.includes('Inactivo') || person.fullName.includes('Sin Horario')), 'solo activos con horario de la organización');
check(calls.employeeWhere.organizationId === 'org-a' && calls.employeeWhere.isActive === true, 'la consulta filtra organización y activos');
check(!calls.employeeSelect.email && !calls.employeeSelect.curp && !calls.sessionSelect.workLog, 'no selecciona correo, CURP ni bitácora');
check(!report.html.includes(SECRET_EMAIL) && !report.html.includes(SECRET_PHONE) && !report.html.includes(SECRET_CURP) && !report.html.includes(SECRET_NOTE) && !report.html.includes(SECRET_LOG), 'el HTML no contiene datos sensibles');
check(report.html.includes('Reporte semanal de horarios y puntualidad') && report.html.includes('Clínica Niño') && report.html.includes('María'), 'título, organización y acentos');
check(report.html.includes('&lt;script&gt;') && !report.html.includes('<script>'), 'el nombre se escapa');
check(report.html.includes('Lun–Vie') || report.html.includes('Lun–Sáb'), 'el horario usa el resumen canónico');
check(report.html.includes('Entrada real') && report.html.includes('Salida real') && report.html.includes('Tiempo trabajado') && report.html.includes('Retardo') && report.html.includes('Estado'), 'columnas del detalle');
check(!report.html.includes('Entrada esperada') && !report.html.includes('Salida esperada'), 'no repite entrada ni salida esperadas');

const maria = report.people.find((person) => person.fullName.startsWith('María'));
const mariaEngine = personEngine(employees[0], sessions.filter((row) => row.employeeId === mariaId).map(({ checkInAt, checkOutAt }) => ({ checkInAt, checkOutAt })));
check(maria.summary.punctualityPct === mariaEngine.summary.punctualityPct && maria.summary.expectedCoveragePct === mariaEngine.summary.expectedCoveragePct && maria.summary.lateDays === mariaEngine.summary.lateDays, 'María conserva el resumen del motor');
check(maria.summary.lateDays === 1 && maria.summary.punctualityPct === 60, 'un retardo y puntualidad 60');
const tue = maria.days.find((day) => day.dateKey === '2026-11-03');
const tueCells = punctualityPdfDayCells(tue, TZ);
check(tue.status === 'LATE' && tueCells.status === 'Retardo' && tueCells.late === '7 min' && tueCells.late !== 'Puntual', 'el retardo muestra 7 min');
check(tueCells.entry === formatTimeEs(new Date(tue.firstCheckInAt), TZ), 'la entrada real usa el formateador canónico');
const wed = maria.days.find((day) => day.dateKey === '2026-11-04');
check(wed.status === 'INCOMPLETE' && punctualityPdfDayCells(wed, TZ).status === 'Jornada incompleta', 'incompleta conserva prioridad sobre tiempo adicional');
const fri = maria.days.find((day) => day.dateKey === '2026-11-06');
check(fri.status === 'EXTRA' && punctualityPdfDayCells(fri, TZ).status === 'Tiempo adicional', 'tiempo adicional cuando no hay alerta mayor');
const sat = maria.days.find((day) => day.dateKey === '2026-11-07');
check(sat.status === 'NOT_EVALUABLE' && sat.statusLabel === 'No evaluable', 'el sábado futuro no es Sin jornada');
const thu = maria.days.find((day) => day.dateKey === '2026-11-05');
check(thu.status === 'NO_SHIFT' && punctualityPdfDayCells(thu, TZ).entry === '—' && punctualityPdfDayCells(thu, TZ).worked === '—', 'sin registro usa guion y Sin jornada');

const pedro = report.people.find((person) => person.fullName.startsWith('Pedro'));
check(!pedro.days.some((day) => day.dateKey === '2026-11-04'), 'el descanso entre semana no aparece');
const ana = report.people.find((person) => person.fullName === 'Ana Encurso');
const anaFri = ana.days.find((day) => day.dateKey === '2026-11-06');
check(anaFri.status === 'IN_PROGRESS' && punctualityPdfDayCells(anaFri, TZ).exit === 'En curso' && !anaFri.lastCheckOutAt, 'la jornada abierta sigue en curso');
const nora = report.people.find((person) => person.fullName === 'Nora Medianoche');
const noraMon = nora.days.find((day) => day.dateKey === '2026-11-02');
const noraEngine = personEngine(employees.find((row) => row.id === 'emp-nora'), sessions.filter((row) => row.employeeId === 'emp-nora').map(({ checkInAt, checkOutAt }) => ({ checkInAt, checkOutAt })));
check(noraMon.workedSec === noraEngine.days.find((day) => day.dateKey === '2026-11-02').workedSec && noraMon.workedSec === (5 * 3600) + (90 * 60), 'las sesiones superpuestas no se duplican y la que cruza medianoche se suma una vez');
check(!nora.days.find((day) => day.dateKey === '2026-11-03').firstCheckInAt && nora.days.find((day) => day.dateKey === '2026-11-03').status === 'NO_SHIFT', 'la sesión que cruza medianoche no abre el día siguiente');
const ines = report.people.find((person) => person.fullName.startsWith('Inés'));
check(!ines.days.some((day) => day.dateKey === '2026-11-02' || day.dateKey === '2026-11-03') && ines.days.some((day) => day.dateKey === '2026-11-04'), 'assignedAt a mitad de semana no penaliza los días previos');
const olga = report.people.find((person) => person.fullName.startsWith('Olga'));
check(olga.emptyReason === 'NOT_IN_FORCE' && olga.summary == null && olga.days.length === 0, 'la semana anterior a la vigencia no trae ausencias');
check(report.summary.collaborators === report.people.length, 'colaboradores es la cantidad incluida');
check(report.summary.lateDays === report.people.reduce((sum, person) => sum + (person.summary?.lateDays || 0), 0) && report.summary.lateDays === 1, 'el total de retardos suma el motor');
check(report.summary.punctualityPct === summarizePunctualityReports(report.people).punctualityPct && report.summary.punctualityPct !== 0, 'la puntualidad promedio sale de los porcentajes canónicos');
check(report.summary.expectedCoveragePct === summarizePunctualityReports(report.people).expectedCoveragePct, 'la cobertura promedio sale de los porcentajes canónicos');
check(paginatePunctualityPeople(report.people).length > 1, 'un equipo grande ocupa varias páginas');
check(!/req\.query\.organizationId|req\.body/.test(routesJs.slice(routesJs.indexOf("'/punctuality/export'"), routesJs.indexOf("'/punctuality/export'") + 900)), 'el endpoint no toma organización ni cuerpo del cliente');
check(routesJs.includes("'/punctuality/export'") && routesJs.includes('assertEmpresaAdmin(req.session.userId)') && routesJs.includes('exportWeeklyPunctualityPdf'), 'endpoint administrativo de exportación');
check((individualJs.match(/findMany/g) || []).length === 1 && individualJs.includes('rejectFuturePunctualityWeek') && exportJs.includes('buildWeekPunctuality'), 'la consulta individual sigue siendo una y el PDF usa el mismo motor');
check(!/resolved\.future\)\s*\{[^}]*continue/.test(exportJs), 'una zona futura no elimina al colaborador');
check(punctualityExportFilename('Clínica Niño', WEEK) === 'mind24-puntualidad-semanal-clinica-nino-2026-11-02.pdf', 'nombre de archivo sanitizado');
check(!punctualityExportFilename('Acme/../evil\\org', WEEK).includes('/') && !punctualityExportFilename('Acme/../evil\\org', WEEK).includes('..'), 'el nombre no admite rutas');
check(punctualityExportContentDisposition(report.filename).startsWith('attachment; filename="') && report.filename.endsWith('.pdf'), 'Content-Disposition attachment');
check(escapeReportHtml('Ñandú <b>') === 'Ñandú &lt;b&gt;', 'escapa nombres con acentos y marcas');

let emptyThrew = false;
try {
  await assembleWeeklyPunctualityExport({
    organizationId: 'org-vacia',
    weekKey: WEEK,
    now: NOW,
    db: fakeDb({}),
  });
} catch (err) {
  emptyThrew = err.code === 'VALIDATION_ERROR' && err.message.includes('No hay colaboradores activos');
}
check(emptyThrew, 'sin personal exportable no genera PDF');

let badWeek = false;
try {
  await assembleWeeklyPunctualityExport({ organizationId: 'org-a', weekKey: '11/02/2026', now: NOW, db: fakeDb({}) });
} catch (err) {
  badWeek = err.code === 'VALIDATION_ERROR';
}
check(badWeek, 'semana inválida');

let futureThrew = false;
try {
  await assembleWeeklyPunctualityExport({ organizationId: 'org-a', weekKey: '2026-11-09', now: NOW, db: fakeDb({}) });
} catch (err) {
  futureThrew = err.message === 'No puedes consultar una semana futura.';
}
check(futureThrew, 'semana futura usa la regla vigente');

const otherWeek = await assembleWeeklyPunctualityExport({
  organizationId: 'org-a',
  weekKey: '2026-10-26',
  now: NOW,
  db: fakeDb({}),
});
check(otherWeek.weekStart === '2026-10-26', 'cambiar la semana cambia el periodo exportado');

const mixedMean = summarizePunctualityReports([
  { summary: { punctualityPct: 40, expectedCoveragePct: 50, lateDays: 1, evaluableDays: 5 } },
  { summary: { punctualityPct: 100, expectedCoveragePct: 80, lateDays: 0, evaluableDays: 1 } },
  { summary: null },
]);
check(mixedMean.punctualityPct === 70 && mixedMean.expectedCoveragePct === 65 && mixedMean.collaborators === 3 && mixedMean.lateDays === 1, 'promedio simple de quien tiene días evaluables, sin ponderar');
const noneMean = summarizePunctualityReports([
  { summary: null },
  { summary: { punctualityPct: null, expectedCoveragePct: null, lateDays: 0, evaluableDays: 0 } },
]);
check(noneMean.punctualityPct == null && noneMean.expectedCoveragePct == null && noneMean.collaborators === 2, 'sin días evaluables el promedio queda vacío');
const noneHtml = buildWeeklyPunctualityReportDocument({
  organizationName: 'Org',
  weekStart: WEEK,
  weekLabel: '2–8 nov 2026',
  timeZoneLabel: TZ,
  generatedAtLabel: '6 nov 2026',
  summary: noneMean,
  people: [{
    fullName: 'Nadie Evaluable',
    timeZone: TZ,
    schedule: { weekdays: [1, 2, 3, 4, 5], restDays: [6, 7], startMinute: 480, endMinute: 900, toleranceMinutes: 10, assignedAt: '2026-10-01T14:00:00.000Z' },
    summary: null,
    days: [],
    emptyReason: 'NOT_IN_FORCE',
  }],
});
check(noneHtml.includes('<strong>—</strong>') && !noneHtml.includes('<strong>0%</strong>'), 'sin días evaluables el PDF muestra — y no 0 %');

const AUCKLAND = 'Pacific/Auckland';
const splitNow = new Date('2026-11-09T02:30:00.000Z');
const splitCalls = {};
const split = await assembleWeeklyPunctualityExport({
  organizationId: 'org-a',
  weekKey: '2026-11-09',
  now: splitNow,
  db: dbFrom([
    scheduleRow([1, 2, 3, 4, 5], '2026-10-01T14:00:00.000Z', { id: 'emp-mx', fullName: 'Mario México', timezone: TZ }),
    scheduleRow([1, 2, 3, 4, 5], '2026-10-01T14:00:00.000Z', {
      id: 'emp-akl',
      fullName: 'Aroha Auckland',
      timezone: AUCKLAND,
    }),
  ], [
    sess('emp-akl', '2026-11-08T19:00:00.000Z', '2026-11-09T02:00:00.000Z'),
  ], splitCalls),
});
const mario = split.people.find((person) => person.fullName === 'Mario México');
const aroha = split.people.find((person) => person.fullName === 'Aroha Auckland');
check(split.people.length === 2 && mario && aroha, 'la semana aceptada incluye a las dos zonas');
check(mario.days.length > 0 && mario.days.every((day) => day.status === 'NOT_EVALUABLE') && mario.summary.punctualityPct == null, 'la zona que aún no llega muestra No evaluable y no entra al promedio');
check(aroha.summary.punctualityPct === 100 && split.summary.punctualityPct === 100 && split.summary.expectedCoveragePct === aroha.summary.expectedCoveragePct && split.summary.collaborators === 2, 'el promedio no se diluye con quien no tiene días evaluables');

const edgeWeek = '2026-11-02';
const edgeNow = new Date('2026-11-16T12:00:00.000Z');
const mxRange = utcRangeForLocalDateInclusive(edgeWeek, '2026-11-08', TZ);
const aklRange = utcRangeForLocalDateInclusive(edgeWeek, '2026-11-08', AUCKLAND);
const mxMonday = localMidnightUtc(edgeWeek, TZ);
const aklMonday = localMidnightUtc(edgeWeek, AUCKLAND);
const mxNextMonday = localMidnightUtc('2026-11-09', TZ);
const edgeCalls = {};
const edgeSessions = [
  sess('emp-akl', aklMonday.toISOString(), new Date(aklMonday.getTime() + 60 * 60 * 1000).toISOString()),
  sess('emp-mx', mxMonday.toISOString(), new Date(mxMonday.getTime() + 60 * 60 * 1000).toISOString()),
  sess('emp-mx', '2026-11-03T05:50:00.000Z', '2026-11-03T06:20:00.000Z'),
  sess('emp-mx', '2026-11-09T05:30:00.000Z', '2026-11-09T07:00:00.000Z'),
  sess('emp-mx', new Date(mxNextMonday.getTime() - 60 * 1000).toISOString(), new Date(mxNextMonday.getTime() - 1000).toISOString()),
  sess('emp-mx', mxNextMonday.toISOString(), new Date(mxNextMonday.getTime() + 60 * 1000).toISOString()),
  sess('emp-akl', new Date(aklMonday.getTime() - 1).toISOString(), aklMonday.toISOString()),
];
const edge = await assembleWeeklyPunctualityExport({
  organizationId: 'org-a',
  weekKey: edgeWeek,
  now: edgeNow,
  db: dbFrom([
    scheduleRow([1, 2, 3, 4, 5, 6, 7], '2026-10-01T14:00:00.000Z', { id: 'emp-mx', fullName: 'Mario México', timezone: TZ }),
    scheduleRow([1, 2, 3, 4, 5, 6, 7], '2026-10-01T14:00:00.000Z', { id: 'emp-akl', fullName: 'Aroha Auckland', timezone: AUCKLAND }),
  ], edgeSessions, edgeCalls),
});
const unionStart = Math.min(mxRange.start.getTime(), aklRange.start.getTime());
const unionEnd = Math.max(mxRange.end.getTime(), aklRange.end.getTime());
check(mxRange.start.getTime() !== aklRange.start.getTime() && edgeCalls.sessionWhere.checkInAt.gte.getTime() === unionStart && edgeCalls.sessionWhere.checkInAt.lt.getTime() === unionEnd, 'el rango UTC es la unión exacta de las semanas civiles');
const edgeMx = edge.people.find((person) => person.fullName === 'Mario México');
const edgeAkl = edge.people.find((person) => person.fullName === 'Aroha Auckland');
const mxMon = edgeMx.days.find((day) => day.dateKey === edgeWeek);
const aklMon = edgeAkl.days.find((day) => day.dateKey === edgeWeek);
check(mxMon.firstCheckInAt === mxMonday.toISOString() && aklMon.firstCheckInAt === aklMonday.toISOString(), 'la entrada en el lunes local de cada zona se conserva');
check(mxMon.firstCheckInAt !== aklMon.firstCheckInAt, 'la entrada de una zona no se asigna al día de la otra');
const within = (rows, range) => rows.filter((row) => {
  const at = new Date(row.checkInAt).getTime();
  return at >= range.start.getTime() && at < range.end.getTime();
});
const mxExpected = buildWeekPunctuality({
  schedule: edgeMx.schedule,
  timeZone: TZ,
  weekStart: edgeWeek,
  now: edgeNow,
  sessions: within(edgeSessions.filter((row) => row.employeeId === 'emp-mx'), mxRange).map((row) => ({ checkInAt: row.checkInAt, checkOutAt: row.checkOutAt })),
});
const dayStamp = (days) => days.map((day) => `${day.dateKey}:${day.firstCheckInAt || ''}:${day.lastCheckOutAt || ''}:${day.workedSec || 0}`).join('|');
check(dayStamp(edgeMx.days) === dayStamp(mxExpected.days) && dayStamp(edgeAkl.days) === dayStamp(buildWeekPunctuality({
  schedule: edgeAkl.schedule,
  timeZone: AUCKLAND,
  weekStart: edgeWeek,
  now: edgeNow,
  sessions: within(edgeSessions.filter((row) => row.employeeId === 'emp-akl'), aklRange).map((row) => ({ checkInAt: row.checkInAt, checkOutAt: row.checkOutAt })),
}).days), 'cada sesión se clasifica después con la zona del colaborador');
check(!edgeMx.days.find((day) => day.dateKey === '2026-11-03').firstCheckInAt && mxMon.workedSec > 3600, 'la jornada de las 23:50 permanece en el lunes y no pasa al martes');
const mxSunday = edgeMx.days.find((day) => day.dateKey === '2026-11-08');
check(mxSunday.firstCheckInAt === '2026-11-09T05:30:00.000Z' && mxSunday.lastCheckOutAt === '2026-11-09T07:00:00.000Z', 'la salida del domingo y el cruce de medianoche quedan en el domingo');
check(within(edgeSessions, { start: { getTime: () => unionEnd }, end: { getTime: () => unionEnd + 1 } }).length === 1 && !dayStamp(edgeMx.days).includes(mxNextMonday.toISOString()), 'el instante exacto del lunes siguiente queda fuera');
check(!dayStamp(edgeAkl.days).includes(new Date(aklMonday.getTime() - 1).toISOString()), 'un milisegundo antes del lunes no entra');

check(unifiedJs.includes('renderHtmlToPdfBuffer(html);') && !unifiedJs.includes('landscape: true'), 'el reporte de evaluaciones sigue llamando al PDF sin opciones nuevas');
check(/format: options\.format \|\| 'A4'/.test(pdfJs) && /landscape: options\.landscape === true/.test(pdfJs) && /top: '10mm', right: '10mm', bottom: '10mm', left: '10mm'/.test(pdfJs), 'sin opciones, el PDF compartido conserva A4 vertical y márgenes de 10 mm');
check(/finally \{\s*await page\.close\(\);/.test(pdfJs) && !exportJs.includes('writeFile') && !pdfJs.includes('writeFile'), 'la página se cierra en finally y no se guardan temporales');
check(pdfJs.includes('export async function closePdfBrowser') && !pdfJs.slice(0, pdfJs.indexOf('export async function closePdfBrowser')).includes('closePdfBrowser'), 'el render de producción no cierra el navegador compartido');

function listen(session) {
  const app = express();
  app.use((req, _res, next) => {
    req.session = session;
    next();
  });
  app.use('/api/org', orgRoutes);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
const noSession = await listen({});
const noSessionRes = await fetch(`http://127.0.0.1:${noSession.address().port}/api/org/timeclock/punctuality/export?week=${WEEK}`);
check(noSessionRes.status === 401, 'sin sesión responde 401');
await closeServer(noSession);
const wrongRole = await listen({ userId: 'user-1', role: 'candidato', organizationId: 'org-a' });
const wrongRoleRes = await fetch(`http://127.0.0.1:${wrongRole.address().port}/api/org/timeclock/punctuality/export?week=${WEEK}&organizationId=org-b`);
check(wrongRoleRes.status === 403, 'rol incorrecto responde 403');
await closeServer(wrongRole);

check(indexHtml.includes('aria-label="Descargar reporte semanal en PDF"') && indexHtml.includes('title="Descargar reporte semanal en PDF"'), 'botón con aria-label y title');
check(indexHtml.includes('class="tc-punct-pdf') && indexHtml.includes('width:36px;height:36px') && indexHtml.includes('<path d="M12 3v12"/>'), 'botón compacto solo SVG');
check(indexHtml.includes('if(tcPunctPdfBusy) return') && indexHtml.includes("e.name==='AbortError'") && indexHtml.includes('tcPunctPdfSetErr'), 'evita doble clic y no avisa un abort');
check(indexHtml.includes('tcPunctPdfAbort.abort()') && indexHtml.includes('encodeURIComponent(week)'), 'cierra la descarga y usa la semana seleccionada');
check(!indexHtml.includes('addEventListener(\'click\', tcDownloadPunctualityPdf)') && indexHtml.includes('tc-punct-pdf:focus-visible'), 'no duplica listeners y el foco es visible');
check(indexHtml === publicHtml, 'index.html y server/public/index.html son idénticos');

const {
  renderHtmlToPdfBuffer,
  closePdfBrowser,
  setPdfBrowserLauncherForTests,
  getPdfBrowserPromiseForTests,
} = await import('../src/services/pdf.service.js');

function fakePdfBrowser() {
  const browser = {
    connected: true,
    pages: 0,
    async newPage() {
      browser.pages += 1;
      return {
        async setContent() {},
        async pdf() { return Buffer.from('%PDF-1.4\n'); },
        async close() {},
      };
    },
    async close() { browser.connected = false; },
  };
  return browser;
}

let recoveryUnhandled = 0;
const onRecoveryUnhandled = () => { recoveryUnhandled += 1; };
process.on('unhandledRejection', onRecoveryUnhandled);
try {
  setPdfBrowserLauncherForTests(async () => {
    throw new Error('arranque fallido');
  });
  let firstError = null;
  try {
    await renderHtmlToPdfBuffer('<p>falla</p>');
  } catch (err) {
    firstError = err;
  }
  check(firstError instanceof Error && firstError.message === 'arranque fallido', 'el primer lanzamiento falla y la generación rechaza');
  check(getPdfBrowserPromiseForTests() == null, 'el singleton queda limpio sin closePdfBrowser');

  setPdfBrowserLauncherForTests(async () => fakePdfBrowser());
  const second = await renderHtmlToPdfBuffer('<p>reintento</p>');
  check(second.subarray(0, 5).toString() === '%PDF-' && getPdfBrowserPromiseForTests() != null, 'el segundo lanzamiento funciona y genera un PDF');
  await closePdfBrowser();
  await closePdfBrowser();
  check(getPdfBrowserPromiseForTests() == null, 'closePdfBrowser sigue siendo idempotente');

  let sharedLaunches = 0;
  const shared = fakePdfBrowser();
  let releaseLaunch;
  const launchGate = new Promise((resolve) => { releaseLaunch = resolve; });
  setPdfBrowserLauncherForTests(() => {
    sharedLaunches += 1;
    return launchGate.then(() => shared);
  });
  const left = renderHtmlToPdfBuffer('<p>a</p>');
  const right = renderHtmlToPdfBuffer('<p>b</p>');
  releaseLaunch();
  const [leftPdf, rightPdf] = await Promise.all([left, right]);
  check(sharedLaunches === 1 && shared.pages === 2 && leftPdf.subarray(0, 5).toString() === '%PDF-' && rightPdf.subarray(0, 5).toString() === '%PDF-', 'dos solicitudes concurrentes comparten el mismo browser');

  await closePdfBrowser();
  let replacements = 0;
  setPdfBrowserLauncherForTests(async () => {
    replacements += 1;
    return fakePdfBrowser();
  });
  await renderHtmlToPdfBuffer('<p>vivo</p>');
  const live = await getPdfBrowserPromiseForTests();
  live.connected = false;
  const replaced = await renderHtmlToPdfBuffer('<p>nuevo</p>');
  check(replacements === 2 && replaced.subarray(0, 5).toString() === '%PDF-', 'un browser desconectado se reemplaza en la siguiente generación');

  await closePdfBrowser();
  let rejectStale;
  let staleStarted;
  const staleGate = new Promise((resolve) => { staleStarted = resolve; });
  let staleCalls = 0;
  setPdfBrowserLauncherForTests(() => {
    staleCalls += 1;
    if (staleCalls === 1) {
      return new Promise((resolve, reject) => {
        rejectStale = reject;
        staleStarted();
      });
    }
    return fakePdfBrowser();
  });
  const staleRender = renderHtmlToPdfBuffer('<p>viejo</p>');
  const staleRejected = staleRender.then(() => false, () => true);
  await staleGate;
  const closingStale = closePdfBrowser();
  const freshRender = renderHtmlToPdfBuffer('<p>fresco</p>');
  rejectStale(new Error('promesa vieja'));
  const freshPdf = await freshRender;
  await closingStale;
  check(await staleRejected && staleCalls === 2 && freshPdf.subarray(0, 5).toString() === '%PDF-' && getPdfBrowserPromiseForTests() != null, 'una promesa vieja no borra el browser nuevo');
  check(recoveryUnhandled === 0, 'un fallo de lanzamiento no produce unhandledRejection');
} finally {
  process.off('unhandledRejection', onRecoveryUnhandled);
  setPdfBrowserLauncherForTests(null);
  await closePdfBrowser();
}

if (!chromePath) {
  check(false, 'Chrome o Edge disponible para renderizar el PDF');
} else {
  try {
  const savedExe = process.env.PUPPETEER_EXECUTABLE_PATH;
  process.env.PUPPETEER_EXECUTABLE_PATH = path.join(repoDir, 'missing-chrome-mind24.exe');
  let realLaunchError = null;
  try {
    await renderHtmlToPdfBuffer('<p>falla</p>');
  } catch (err) {
    realLaunchError = err;
  } finally {
    if (savedExe) process.env.PUPPETEER_EXECUTABLE_PATH = savedExe;
    else delete process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  check(realLaunchError instanceof Error, 'el lanzamiento real fallido rechaza la generación');
  check(getPdfBrowserPromiseForTests() == null, 'el fallo real deja el singleton limpio');
  const retried = await renderHtmlToPdfBuffer('<!doctype html><meta charset="utf-8"><p>reintento real</p>');
  check(retried.length > 500 && retried.subarray(0, 5).toString() === '%PDF-', 'el segundo lanzamiento real genera un PDF válido');

  const pdf = await exportWeeklyPunctualityPdf({
    organizationId: 'org-a',
    weekKey: WEEK,
    now: NOW,
    db: fakeDb({}),
  });
  check(pdf.buffer.subarray(0, 5).toString() === '%PDF-', 'firma PDF');
  check(pdf.contentType === 'application/pdf' && pdf.contentDisposition.startsWith('attachment; filename="'), 'headers de descarga');
  const raw = pdf.buffer.toString('latin1');
  const boxes = [...raw.matchAll(/\/MediaBox\s*\[\s*([0-9.\s]+)\]/g)].map((match) => match[1].trim().split(/\s+/).map(Number));
  check(boxes.length > 0 && boxes.every((box) => box[2] > box[3]), 'orientación horizontal');
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: pdf.buffer });
  let text = '';
  let pageCount = 0;
  try {
    const parsed = await parser.getText({ pageJoiner: '\n' });
    text = parsed.text || '';
    pageCount = parsed.total || (parsed.pages || []).length;
  } finally {
    await Promise.resolve(parser.destroy()).catch(() => {});
  }
  check(pageCount > 1, 'el PDF tiene varias páginas');
  check(text.includes('Reporte semanal') && text.includes('Clínica') && text.includes('María') && text.includes('Núñez'), 'el PDF conserva título, organización y acentos');
  check(text.includes('7 min') && text.includes('En curso') && text.includes('Sin jornada') && text.includes('Jornada incompleta'), 'el PDF contiene retardo, jornada abierta, sin registro e incompleta');
  check(!text.includes(SECRET_EMAIL) && !text.includes(SECRET_CURP) && !text.includes(SECRET_NOTE) && !text.includes(SECRET_LOG), 'el PDF no contiene datos sensibles');

  const puppeteer = await import('puppeteer-core');
  const browser = await puppeteer.default.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1123, height: 794 });
    await page.setContent(report.html, { waitUntil: 'networkidle0' });
    await page.emulateMediaType('print');
    const layout = await page.evaluate(() => {
      const sheets = [...document.querySelectorAll('.sheet')];
      const issues = [];
      sheets.forEach((sheet, index) => {
        const sheetBox = sheet.getBoundingClientRect();
        if (sheet.scrollWidth > sheet.clientWidth + 2) issues.push(`sheet ${index} overflow`);
        const nodes = [...sheet.querySelectorAll('h1,h2,th,td,p,strong,span')];
        const boxes = nodes.map((el) => {
          const rect = el.getBoundingClientRect();
          return { x: rect.x, y: rect.y, r: rect.right, b: rect.bottom, w: rect.width, h: rect.height };
        }).filter((box) => box.w > 2 && box.h > 2);
        const contains = (a, b) => a.x <= b.x + 1 && a.y <= b.y + 1 && a.r >= b.r - 1 && a.b >= b.b - 1;
        for (let i = 0; i < boxes.length; i += 1) {
          if (boxes[i].x < sheetBox.x - 1 || boxes[i].r > sheetBox.right + 1) issues.push(`sheet ${index} fuera`);
          for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i];
            const b = boxes[j];
            if (contains(a, b) || contains(b, a)) continue;
            const iw = Math.min(a.r, b.r) - Math.max(a.x, b.x);
            const ih = Math.min(a.b, b.b) - Math.max(a.y, b.y);
            if (iw > 3 && ih > 3) issues.push(`sheet ${index} overlap`);
          }
        }
      });
      return { sheets: sheets.length, issues: [...new Set(issues)] };
    });
    check(layout.sheets > 1 && layout.issues.length === 0, `sin desborde ni superposición (${layout.issues.join(', ') || 'limpio'})`);
    const previewDir = path.join(os.tmpdir(), 'mind24-punctuality-preview');
    fs.mkdirSync(previewDir, { recursive: true });
    const sheets = await page.$$('.sheet');
    for (let index = 0; index < sheets.length; index += 1) {
      await sheets[index].screenshot({ path: path.join(previewDir, `page-${index + 1}.png`) });
    }
    console.log('  PDF_PREVIEW', previewDir);

    await page.setViewport({ width: 390, height: 800 });
    await page.setContent(indexHtml, { waitUntil: 'domcontentloaded' });
    const narrow = await page.evaluate(() => {
      const host = document.createElement('div');
      host.className = 'tc-history-dialog tc-history-dialog--punctuality';
      host.style.position = 'relative';
      host.style.left = '0';
      host.style.top = '0';
      host.innerHTML = `<div class="tc-history-dialog-body">${tcPunctChrome({
        weekLabel: '2–8 nov 2026',
        canGoNext: false,
        schedule: { weekdays: [1, 2, 3, 4, 5, 6], startMinute: 480, endMinute: 900, toleranceMinutes: 10 },
      })}</div>`;
      document.body.appendChild(host);
      const btn = host.querySelector('#tc-punct-pdf-btn');
      const box = btn.getBoundingClientRect();
      return {
        label: btn.getAttribute('aria-label'),
        visibleText: btn.innerText.trim(),
        width: Math.round(box.width),
        height: Math.round(box.height),
        docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        hostOverflow: host.scrollWidth > host.clientWidth + 1,
      };
    });
    check(narrow.label === 'Descargar reporte semanal en PDF' && narrow.visibleText === '' && narrow.width === 36 && narrow.height === 36, 'en 390 px el botón mide 36 y no muestra texto');
    check(!narrow.docOverflow && !narrow.hostOverflow, 'en 390 px no hay scroll horizontal');
  } finally {
    await browser.close();
  }

  await closePdfBrowser();
  await closePdfBrowser();
  check(true, 'cerrar el navegador compartido dos veces no falla');
  const again = await renderHtmlToPdfBuffer('<!doctype html><meta charset="utf-8"><title>segunda</title><p>segunda generación</p>');
  check(Buffer.isBuffer(again) && again.subarray(0, 5).toString() === '%PDF-', 'después de cerrar, una generación nueva vuelve a abrir Chromium');
  let renderFailed = false;
  try {
    await renderHtmlToPdfBuffer('<p>falla</p>', { format: 'no-existe' });
  } catch {
    renderFailed = true;
  }
  await closePdfBrowser();
  check(renderFailed, 'un error de render permite cerrar el navegador');
  } finally {
    await closePdfBrowser();
  }
}

if (failed) {
  console.error(`\n${failed} fallo(s).\n`);
  process.exitCode = 1;
} else {
  console.log('\nExportación de puntualidad semanal OK.\n');
}

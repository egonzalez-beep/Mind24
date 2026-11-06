/**
 * Fase 1: horario fijo lun–vie del colaborador.
 * node server/scripts/test-workforce-work-schedule.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(rootDir, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const {
  WORK_SCHEDULE_ORDER_MESSAGE,
  WORK_SCHEDULE_TOLERANCE_MESSAGE,
  WORK_SCHEDULE_DAYS_MESSAGE,
  formatWeekdaySelection,
  parseHmToMinute,
  formatMinuteToHm,
  formatWorkScheduleSummary,
  parseWorkScheduleInput,
  buildWorkScheduleDto,
  describeWorkScheduleForEvaluation,
  resolveWorkSchedulePersistence,
  workScheduleConfigEqual,
} = await import('../src/utils/workforceWorkSchedule.util.js');

const indexHtml = fs.readFileSync(path.join(repoDir, 'index.html'), 'utf8');
const publicHtmlPath = path.join(rootDir, 'public', 'index.html');
const schema = fs.readFileSync(path.join(rootDir, 'prisma', 'schema.prisma'), 'utf8');
const migration = fs.readFileSync(
  path.join(rootDir, 'prisma', 'migrations', '20261105183000_workforce_employee_work_schedule', 'migration.sql'),
  'utf8',
);
const previousMigration = fs.readFileSync(
  path.join(rootDir, 'prisma', 'migrations', '20261027120000_workforce_expected_work_minutes', 'migration.sql'),
  'utf8',
);
const employeeService = fs.readFileSync(path.join(rootDir, 'src/services/workforceEmployee.service.js'), 'utf8');
const orgRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.org.routes.js'), 'utf8');
const publicRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.public.routes.js'), 'utf8');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}
function throwsMessage(fn, message) {
  try {
    fn();
    return false;
  } catch (err) {
    return err && err.message === message && err.code === 'VALIDATION_ERROR' && !err.stack?.includes('at prisma');
  }
}

const employeeModel = schema.slice(schema.indexOf('model WorkforceEmployee'), schema.indexOf('enum WorkforceDocumentCategory'));
check(employeeModel.includes('timezone        String'), 'timezone existente se reutiliza');
check(!/workScheduleTimezone/.test(schema), 'no hay un segundo campo de timezone');
for (const field of [
  'workScheduleStartMinute       Int?',
  'workScheduleEndMinute         Int?',
  'workScheduleToleranceMinutes  Int?',
  'workScheduleWeekdayMask       Int?',
  'workScheduleAssignedAt        DateTime? @db.Timestamptz(6)',
]) {
  check(employeeModel.includes(field), `schema nullable ${field.split(' ')[0]}`);
}
check(!/workSchedule\w+.*@default/.test(employeeModel), 'el horario no tiene default en el modelo');
check(migration.includes('ADD COLUMN "workScheduleStartMinute" INTEGER'), 'migración agrega inicio nullable');
check(migration.includes('ADD COLUMN "workScheduleWeekdayMask" INTEGER'), 'migración agrega la máscara de días');
check(migration.includes('ADD COLUMN "workScheduleAssignedAt" TIMESTAMPTZ(6)'), 'migración agrega assignedAt');
const migrationSql = migration.replace(/--.*$/gm, '');
check(!/\bDEFAULT\b/i.test(migrationSql), 'migración sin DEFAULT');
check(!/\bUPDATE\b/i.test(migrationSql), 'migración sin backfill');
check(!/\bNOT NULL\b/i.test(migration), 'migración sin NOT NULL');
check(!/CREATE INDEX/i.test(migration), 'migración sin índice nuevo');
check(previousMigration.includes('UPDATE "WorkforceEmployee"'), 'la migración anterior de jornada esperada sigue intacta');

check(parseHmToMinute('08:00') === 480, '08:00 → 480');
check(parseHmToMinute('15:00') === 900, '15:00 → 900');
check(parseHmToMinute('00:00') === 0, '00:00 es un inicio válido');
check(parseHmToMinute('23:59') === 1439, '23:59 cabe en el día');
check(parseHmToMinute('8:00') == null, '8:00 sin cero inicial se rechaza');
check(parseHmToMinute('08:00 ') == null, 'espacio final se rechaza');
check(parseHmToMinute(' 08:00') == null, 'espacio inicial se rechaza');
check(parseHmToMinute('08:00:00') == null, 'segundos se rechazan');
check(parseHmToMinute('24:00') == null, '24:00 se rechaza');
check(parseHmToMinute(480) == null, 'número suelto se rechaza');
check(parseHmToMinute({ hour: 8 }) == null, 'objeto se rechaza');
check(formatMinuteToHm(480) === '08:00' && formatMinuteToHm(900) === '15:00', 'minuto → HH:mm');

const valid = { start: '08:00', end: '15:00', toleranceMinutes: 10, weekdays: [1, 2, 3, 4, 5] };
check(
  JSON.stringify(parseWorkScheduleInput(valid)) ===
    JSON.stringify({ startMinute: 480, endMinute: 900, toleranceMinutes: 10, weekdays: [1, 2, 3, 4, 5], weekdayMask: 31 }),
  '08:00–15:00 con tolerancia 10 es válido',
);
check(throwsMessage(() => parseWorkScheduleInput({ start: '08:00', end: '08:00', toleranceMinutes: 10 }), WORK_SCHEDULE_ORDER_MESSAGE), 'fin igual al inicio es inválido');
check(throwsMessage(() => parseWorkScheduleInput({ start: '15:00', end: '08:00', toleranceMinutes: 10 }), WORK_SCHEDULE_ORDER_MESSAGE), 'fin anterior es inválido');
check(throwsMessage(() => parseWorkScheduleInput({ start: '22:00', end: '06:00', toleranceMinutes: 10 }), WORK_SCHEDULE_ORDER_MESSAGE), 'cruce de medianoche es inválido');
check(throwsMessage(() => parseWorkScheduleInput({ start: '06:00', end: '22:01', toleranceMinutes: 10 }), WORK_SCHEDULE_ORDER_MESSAGE), 'más de 16 horas es inválido');
check(parseWorkScheduleInput({ start: '06:00', end: '22:00', toleranceMinutes: 0, weekdays: [1] }).toleranceMinutes === 0, '16 horas exactas y tolerancia 0 son válidas');
check(parseWorkScheduleInput({ start: '00:00', end: '00:01', toleranceMinutes: 120, weekdays: [7] }).endMinute === 1, '00:00–00:01 y tolerancia 120 son válidos');
check(throwsMessage(() => parseWorkScheduleInput({ start: '08:00', end: '00:00', toleranceMinutes: 10 }), WORK_SCHEDULE_ORDER_MESSAGE), '00:00 no es una salida válida');
check(throwsMessage(() => parseWorkScheduleInput({ start: '23:59', end: '23:59', toleranceMinutes: 10 }), WORK_SCHEDULE_ORDER_MESSAGE), '23:59 no puede ser inicio sin salida posterior');
for (const bad of [-1, 121, 10.5, NaN, '10', ' 10 ', null, { minutes: 10 }, true]) {
  check(
    throwsMessage(() => parseWorkScheduleInput({ start: '08:00', end: '15:00', toleranceMinutes: bad }), WORK_SCHEDULE_TOLERANCE_MESSAGE),
    `tolerancia inválida ${JSON.stringify(bad)}`,
  );
}
check(throwsMessage(() => parseWorkScheduleInput('08:00'), WORK_SCHEDULE_ORDER_MESSAGE), 'cadena suelta se rechaza');
check(throwsMessage(() => parseWorkScheduleInput(['08:00', '15:00']), WORK_SCHEDULE_ORDER_MESSAGE), 'arreglo se rechaza');
check(
  throwsMessage(
    () => parseWorkScheduleInput({ startMinute: 480, endMinute: 900, toleranceMinutes: 10, assignedAt: '2000-01-01T00:00:00.000Z' }),
    WORK_SCHEDULE_ORDER_MESSAGE,
  ),
  'minutos o assignedAt enviados por el cliente no se aceptan como horario',
);
check(parseWorkScheduleInput(null) == null, 'horario ausente es null');
check(throwsMessage(() => parseWorkScheduleInput({ ...valid, weekdays: [] }), WORK_SCHEDULE_DAYS_MESSAGE), 'sin días no se asume lunes a viernes');
check(throwsMessage(() => parseWorkScheduleInput({ start: '08:00', end: '15:00', toleranceMinutes: 10 }), WORK_SCHEDULE_DAYS_MESSAGE), 'omitir los días es inválido');
for (const badDays of [[0], [8], [1.5], ['1'], [1, 1], [1, 2, 3, 4, 5, 6, 7, 1]]) {
  check(throwsMessage(() => parseWorkScheduleInput({ ...valid, weekdays: badDays }), WORK_SCHEDULE_DAYS_MESSAGE), `días inválidos ${JSON.stringify(badDays)}`);
}
const saturday = parseWorkScheduleInput({ ...valid, weekdays: [1, 2, 3, 4, 5, 6] });
check(saturday.weekdayMask === 63 && formatWeekdaySelection(saturday.weekdays) === 'Lun–Sáb', 'lunes a sábado es una selección válida');
const everyday = parseWorkScheduleInput({ ...valid, weekdays: [1, 2, 3, 4, 5, 6, 7] });
check(everyday.weekdayMask === 127 && formatWeekdaySelection(everyday.weekdays) === 'Lun–Dom', 'lunes a domingo es una selección válida');
check(formatWeekdaySelection([1, 3, 5]) === 'Lun, Mié, Vie', 'los días sueltos no se presentan como un rango');

const now = new Date('2026-11-05T22:00:00.000Z');
const later = new Date('2026-11-06T22:00:00.000Z');
const created = resolveWorkSchedulePersistence(null, valid, now);
check(
  created.workScheduleStartMinute === 480 &&
    created.workScheduleEndMinute === 900 &&
    created.workScheduleToleranceMinutes === 10 &&
    created.workScheduleWeekdayMask === 31 &&
    created.workScheduleAssignedAt === now &&
    Object.keys(created).length === 5,
  'alta con horario escribe días, inicio, fin, tolerancia y assignedAt juntos',
);
const cleared = resolveWorkSchedulePersistence(created, null, later);
check(
  Object.values(cleared).every((value) => value == null) && Object.keys(cleared).length === 5,
  'eliminar horario deja todos los campos en null',
);
check(Object.keys(resolveWorkSchedulePersistence(null, null, now)).length === 5, 'alta sin horario persiste null y no un horario implícito');
const existing = {
  workScheduleStartMinute: 480,
  workScheduleEndMinute: 900,
  workScheduleToleranceMinutes: 10,
  workScheduleWeekdayMask: 31,
  workScheduleAssignedAt: now,
  timezone: 'America/Mexico_City',
};
check(Object.keys(resolveWorkSchedulePersistence(existing, valid, later)).length === 0, 'guardar sin cambios no reescribe assignedAt');
check(resolveWorkSchedulePersistence(existing, { ...valid, start: '09:00' }, later).workScheduleAssignedAt === later, 'cambiar entrada actualiza assignedAt');
check(resolveWorkSchedulePersistence(existing, { ...valid, end: '16:00' }, later).workScheduleEndMinute === 960, 'cambiar salida actualiza el fin');
check(resolveWorkSchedulePersistence(existing, { ...valid, toleranceMinutes: 15 }, later).workScheduleToleranceMinutes === 15, 'cambiar tolerancia actualiza la tolerancia');
check(resolveWorkSchedulePersistence(existing, { ...valid, weekdays: [1, 2, 3, 4, 5, 6] }, later).workScheduleWeekdayMask === 63, 'cambiar los días actualiza la máscara');
check(Object.keys(resolveWorkSchedulePersistence(existing, undefined, later)).length === 0, 'omitir el horario en edición no lo borra');
let partial = false;
try {
  resolveWorkSchedulePersistence(existing, { start: '08:00', end: '08:00', toleranceMinutes: 10 }, later);
  partial = true;
} catch (err) {
  partial = err.message !== WORK_SCHEDULE_ORDER_MESSAGE;
}
check(partial === false && existing.workScheduleAssignedAt === now, 'un error no altera la configuración previa');

const dto = buildWorkScheduleDto(existing);
check(
  dto.weekdays.join() === '1,2,3,4,5' &&
    dto.restDays.join() === '6,7' &&
    dto.startMinute === 480 &&
    dto.endMinute === 900 &&
    dto.toleranceMinutes === 10 &&
    dto.assignedAt === now.toISOString(),
  'DTO expone los días elegidos y el descanso',
);
check(buildWorkScheduleDto({ workScheduleStartMinute: 480, workScheduleEndMinute: 900, workScheduleToleranceMinutes: 10, workScheduleWeekdayMask: null }) == null, 'sin días guardados no se publica un lunes a viernes implícito');
check(formatWorkScheduleSummary(dto) === 'Lun–Vie · 8:00 a. m.–3:00 p. m. · Tolerancia 10 min', 'resumen es-MX');
check(formatWorkScheduleSummary({ ...dto, weekdays: [1, 2, 3, 4, 5, 6, 7], restDays: [] }) === 'Lun–Dom · 8:00 a. m.–3:00 p. m. · Tolerancia 10 min', 'resumen de lunes a domingo');
check(workScheduleConfigEqual(dto, { startMinute: 480, endMinute: 900, toleranceMinutes: 10, weekdays: [1, 2, 3, 4, 5] }), 'comparación de configuración');
const facts = describeWorkScheduleForEvaluation(existing);
check(
  facts.scheduledStartMinute === 480 &&
    facts.toleranceEndMinute === 490 &&
    facts.scheduledEndMinute === 900 &&
    facts.expectedMinutesPerDay === 420 &&
    facts.evaluableFrom === now.toISOString() &&
    facts.weekdays.join() === '1,2,3,4,5' &&
    facts.timezone === 'America/Mexico_City' &&
    facts.punctualityPercent == null &&
    facts.dailyStatus == null,
  'contrato de Fase 2 sin métricas guardadas',
);

const adminBody = z
  .object({
    fullName: z.string().min(2).max(200).optional(),
    workSchedule: z.unknown().optional(),
  })
  .parse({
    fullName: 'Ana López',
    organizationId: 'otra-org',
    workScheduleAssignedAt: later.toISOString(),
    workSchedule: { start: '08:00', end: '15:00', toleranceMinutes: 10, weekdays: [1, 2, 3, 4, 5, 6], assignedAt: later.toISOString() },
  });
check(adminBody.organizationId == null && adminBody.workScheduleAssignedAt == null, 'organizationId y assignedAt del body se ignoran');
check(adminBody.workSchedule.assignedAt != null && parseWorkScheduleInput(adminBody.workSchedule).startMinute === 480, 'assignedAt dentro del horario no define la fecha');

check(employeeService.includes('workSchedule: buildWorkScheduleDto(emp)'), 'el serializador administrativo incluye el horario');
check(employeeService.includes('...scheduleColumns'), 'inicio, fin, tolerancia y assignedAt viajan en la misma escritura');
check(employeeService.indexOf('resolveWorkSchedulePersistence') < employeeService.indexOf('prisma.workforceEmployee.create'), 'la validación ocurre antes del alta');
check(employeeService.indexOf('resolveWorkSchedulePersistence(existing') < employeeService.lastIndexOf('prisma.workforceEmployee.update'), 'la validación ocurre antes de la edición');
check(orgRoutes.includes('assertEmpresaAdmin(req.session.userId)') && orgRoutes.includes('createWorkforceEmployee(u.organizationId, body)'), 'el alta usa la organización de la sesión');
check(!publicRoutes.includes('workSchedule'), 'el portal público no recibe ni edita el horario');
check(publicRoutes.includes("'/tasks/:taskId'") && !/router\.patch\(\s*'\/employees/.test(publicRoutes), 'el único patch del portal sigue siendo el de actividades');

function extractFunction(source, name) {
  const token = `function ${name}(`;
  const start = source.indexOf(token);
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed ${name}`);
}
const names = [
  'tcMinuteToHm',
  'tcFormatMinuteEsMx',
  'tcFormatWeekdaySelection',
  'tcFormatWorkScheduleSummary',
  'tcJornadaScheduleHtml',
  'tcWorkScheduleDayToggle',
  'tcWorkScheduleSelectedDays',
  'tcWorkScheduleApplyDays',
  'tcWorkScheduleToggle',
  'tcWorkScheduleSet',
  'tcWorkScheduleRead',
];
const elements = new Map();
function makeEl(id, value, className) {
  const el = {
    id,
    value,
    checked: false,
    className,
    attrs: { 'aria-pressed': 'false' },
    getAttribute(name) { return this.attrs[name] ?? null; },
    setAttribute(name, val) { this.attrs[name] = String(val); },
    classList: {
      toggle(name, force) {
        const on = force != null ? force : !el.className.includes(name);
        const parts = el.className.split(/\s+/).filter(Boolean).filter((part) => part !== name);
        if (on) parts.push(name);
        el.className = parts.join(' ');
      },
      contains(name) {
        return el.className.split(/\s+/).includes(name);
      },
    },
  };
  elements.set(id, el);
  return el;
}
makeEl('tc-add-ws-on', '', '');
makeEl('tc-add-ws-fields', '', 'tc-work-schedule-fields hidden');
makeEl('tc-add-ws-start', '', '');
makeEl('tc-add-ws-end', '', '');
makeEl('tc-add-ws-tol', '', '');
for (let day = 1; day <= 7; day += 1) makeEl(`tc-add-ws-day-${day}`, '', 'tc-work-schedule-day');
makeEl('tc-edit-ws-on', '', '');
makeEl('tc-edit-ws-fields', '', 'tc-work-schedule-fields hidden');
makeEl('tc-edit-ws-start', '08:00', '');
makeEl('tc-edit-ws-end', '15:00', '');
makeEl('tc-edit-ws-tol', '10', '');
for (let day = 1; day <= 7; day += 1) makeEl(`tc-edit-ws-day-${day}`, '', 'tc-work-schedule-day');
const ui = vm.runInNewContext(
  `${names.map((name) => extractFunction(indexHtml, name)).join('\n')}\n({ ${names.join(', ')} })`,
  {
    document: { getElementById: (id) => elements.get(id) || null },
    tcEsc: (value) => String(value),
    tcSvgClock: () => '<svg></svg>',
  },
);
check(elements.get('tc-add-ws-fields').classList.contains('hidden'), 'el alta empieza con el horario cerrado');
ui.tcWorkScheduleToggle('add');
check(
  elements.get('tc-add-ws-on').checked === false && elements.get('tc-add-ws-fields').classList.contains('hidden'),
  'activar no ocurre solo al pintar el formulario',
);
elements.get('tc-add-ws-on').checked = true;
ui.tcWorkScheduleToggle('add');
check(
  elements.get('tc-add-ws-start').value === '08:00' &&
    elements.get('tc-add-ws-end').value === '15:00' &&
    elements.get('tc-add-ws-tol').value === '10' &&
    !elements.get('tc-add-ws-fields').classList.contains('hidden') &&
    [1, 2, 3, 4, 5].every((day) => elements.get(`tc-add-ws-day-${day}`).getAttribute('aria-pressed') === 'true') &&
    [6, 7].every((day) => elements.get(`tc-add-ws-day-${day}`).getAttribute('aria-pressed') === 'false'),
  'la primera activación precarga 08:00, 15:00, 10 y lunes a viernes',
);
check(JSON.stringify(ui.tcWorkScheduleRead('add').weekdays) === JSON.stringify([1, 2, 3, 4, 5]), 'el alta inicial envía lunes a viernes');
ui.tcWorkScheduleDayToggle(elements.get('tc-add-ws-day-6'));
check(JSON.stringify(ui.tcWorkScheduleRead('add').weekdays) === JSON.stringify([1, 2, 3, 4, 5, 6]), 'se puede sumar sábado sin perder los días ya elegidos');
elements.get('tc-add-ws-on').checked = false;
check(ui.tcWorkScheduleRead('add') == null, 'desactivar envía null');
ui.tcWorkScheduleSet('edit', dto);
check(
  elements.get('tc-edit-ws-on').checked &&
    elements.get('tc-edit-ws-start').value === '08:00' &&
    elements.get('tc-edit-ws-end').value === '15:00' &&
    elements.get('tc-edit-ws-tol').value === '10' &&
    [1, 2, 3, 4, 5].every((day) => elements.get(`tc-edit-ws-day-${day}`).getAttribute('aria-pressed') === 'true') &&
    [6, 7].every((day) => elements.get(`tc-edit-ws-day-${day}`).getAttribute('aria-pressed') === 'false'),
  'la edición precarga los días guardados y deja el descanso sin marcar',
);
ui.tcWorkScheduleSet('edit', { ...dto, weekdays: [1, 2, 3, 4, 6] });
check(
  [1, 2, 3, 4, 6].every((day) => elements.get(`tc-edit-ws-day-${day}`).getAttribute('aria-pressed') === 'true') &&
    [5, 7].every((day) => elements.get(`tc-edit-ws-day-${day}`).getAttribute('aria-pressed') === 'false'),
  'la edición no vuelve a marcar lunes a viernes si el horario guardado es otro',
);
const typed = ui.tcWorkScheduleRead('edit');
ui.tcWorkScheduleSet('edit', null);
check(typed.start === '08:00' && elements.get('tc-edit-ws-on').checked === false, 'cancelar no forma parte de la lectura y desactivar limpia el envío');
check(ui.tcJornadaScheduleHtml({ workSchedule: dto }).includes('Lun–Vie · 8:00 a. m.–3:00 p. m. · Tolerancia 10 min'), 'el resumen visible sale del DTO');
check(ui.tcJornadaScheduleHtml({}) === '' && ui.tcJornadaScheduleHtml({ workSchedule: null }) === '', 'sin horario no hay placeholder');
check(indexHtml.includes('tcJornadaScheduleHtml(emp)'), 'el resumen vive en la jornada administrativa');
check(!/Sin horario/.test(extractFunction(indexHtml, 'tcJornadaScheduleHtml')), 'no se muestra “Sin horario”');
check(indexHtml.includes('overflow-wrap:anywhere') && indexHtml.includes('.tc-work-schedule-fields{display:flex;flex-wrap:wrap'), 'el horario hace wrap y no fuerza scroll horizontal');
check(indexHtml.includes('Horario laboral') && indexHtml.includes('Asignar horario fijo') && indexHtml.includes('Elige los días laborales. Los demás quedan como descanso, en la zona horaria del colaborador.'), 'copy del formulario');
check(!indexHtml.includes('Aplica de lunes a viernes'), 'el formulario ya no anuncia lunes a viernes como regla fija');
check(!/id="tc-(?:add|edit)-ws-day-\d"[^>]*aria-pressed="true"/.test(indexHtml), 'ningún día llega marcado por defecto');
check(indexHtml.includes("workSchedule: tcWorkScheduleRead('add')") && indexHtml.includes("workSchedule: tcWorkScheduleRead('edit')"), 'alta y edición envían el contrato');
const saveFn = extractFunction(indexHtml, 'tcSaveEmpEdit');
const closeFn = extractFunction(indexHtml, 'tcCloseEmpEdit');
check(saveFn.includes('tcCloseEmpEdit()') && saveFn.indexOf('catch(e)') > saveFn.indexOf('tcCloseEmpEdit()'), 'un error de edición no cierra ni borra el formulario');
check(!closeFn.includes('apiJson'), 'cancelar no guarda');
check(!indexHtml.includes('workSchedule') || !/tc-ws-jornada-cta[\s\S]{0,200}workSchedule/.test(indexHtml), 'el resumen no se inserta junto al CTA del portal');
check(fs.existsSync(publicHtmlPath) && fs.readFileSync(publicHtmlPath).equals(fs.readFileSync(path.join(repoDir, 'index.html'))), 'index.html y server/public/index.html son idénticos');

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
if (integration.startsWith('SKIP')) {
  console.log('  SKIP  la integración no certifica persistencia ni aislamiento real');
}

if (failed) {
  console.error(`\n${failed} fallo(s)`);
  process.exit(1);
}
console.log('\nHorario laboral fase 1: OK');

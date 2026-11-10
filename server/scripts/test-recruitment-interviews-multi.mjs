/**
 * Entrevistas múltiples por postulación.
 * node server/scripts/test-recruitment-interviews-multi.mjs
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(root, 'server', 'public', 'index.html'), 'utf8');
const interviewSrc = fs.readFileSync(
  path.join(root, 'server', 'src', 'services', 'recruitmentApplicationInterviewEvent.service.js'),
  'utf8',
);
const routesSrc = fs.readFileSync(
  path.join(root, 'server', 'src', 'routes', 'org.recruitment.routes.js'),
  'utf8',
);
const publicRoutes = fs.readFileSync(
  path.join(root, 'server', 'src', 'routes', 'timeclock.public.routes.js'),
  'utf8',
);
const migration = fs.readFileSync(
  path.join(root, 'server', 'prisma', 'migrations', '20261109160000_recruitment_interview_appointments', 'migration.sql'),
  'utf8',
);
const slotMigration = fs.readFileSync(
  path.join(root, 'server', 'prisma', 'migrations', '20261109160100_recruitment_interview_scheduled_slot_index', 'migration.sql'),
  'utf8',
);

process.env.SESSION_SECRET ||= 'test-secret';
process.env.DATABASE_URL ||= 'postgresql://127.0.0.1:5432/mind24';

const {
  buildApplicationInterviewRows,
  orderInterviewsForDisplay,
  scheduleRecruitmentApplicationInterview,
  updateRecruitmentApplicationInterview,
  cancelScheduledInterviewsForClosedApplication,
  normalizeInterviewComment,
  INTERVIEW_CLOSED_SYSTEM_COMMENT,
  INTERVIEW_CLOSED_UNRESOLVED_COMMENT,
  selectNextInterviewPointer,
  countVisibleInterviews,
  isScheduledInterviewSlotConflict,
  applyRecruitmentInterviewFormChange,
  recordUnattributedInterviewSnapshot,
  INTERVIEW_CLEARED_SYSTEM_COMMENT,
  INTERVIEW_SLOT_TAKEN_MESSAGE,
} = await import('../src/services/recruitmentApplicationInterviewEvent.service.js');
const { resolveInterviewScheduledAtForApplicationUpdate } = await import(
  '../src/services/recruitmentInterviewSchedule.service.js'
);
const { utcInstantFromLocalParts } = await import('../src/utils/timezoneLocalInstant.util.js');
const { formatInterviewScheduledAtLabel } = await import('../src/services/recruitmentInterviewSchedule.service.js');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function matches(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    const current = row[key];
    if (current instanceof Date || value instanceof Date) {
      const left = current == null ? null : new Date(current).getTime();
      const right = value == null ? null : new Date(value).getTime();
      return left === right;
    }
    return current === value;
  });
}

function decorate(row) {
  return {
    ...row,
    stage: { id: row.stageId, key: 'CONTACT', name: 'Contacto inicial' },
    createdBy: { fullName: 'Admin' },
  };
}

function memoryDb() {
  const apps = [];
  const events = [];
  let seq = 0;
  const eventsApi = {
    async findFirst({ where }) {
      const row = events.find((item) => matches(item, where));
      return row ? decorate(row) : null;
    },
    async findMany({ where }) {
      return events
        .filter((item) => matches(item, where))
        .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
        .map((item) => decorate(item));
    },
    async create({ data }) {
      if (data.eventType === 'SCHEDULED') {
        const clash = events.find((item) => item.eventType === 'SCHEDULED'
          && item.organizationId === data.organizationId
          && item.applicationId === data.applicationId
          && item.scheduledTimeSpecified === data.scheduledTimeSpecified
          && new Date(item.scheduledAt).getTime() === new Date(data.scheduledAt).getTime());
        if (db.foreignUnique) {
          db.foreignUnique = false;
          const err = new Error('Unique');
          err.code = 'P2002';
          err.meta = { target: 'RecruitmentApplicationInterviewEvent_pkey' };
          throw err;
        }
        if (clash || db.failNextScheduledCreate) {
          const err = new Error('Unique');
          err.code = 'P2002';
          err.meta = { target: 'RecruitmentApplicationInterviewEvent_one_scheduled_slot' };
          if (db.failNextScheduledCreate && !clash) {
            db.failNextScheduledCreate = false;
            events.push({
              id: `evt-${++seq}`,
              createdAt: new Date(),
              rescheduledToAt: null,
              rescheduledToTimeSpecified: null,
              label: null,
              comment: null,
              ...data,
            });
          }
          throw err;
        }
      }
      const row = {
        id: `evt-${++seq}`,
        createdAt: new Date(),
        rescheduledToAt: null,
        rescheduledToTimeSpecified: null,
        label: null,
        comment: null,
        ...data,
      };
      events.push(row);
      return decorate(row);
    },
    async update({ where, data }) {
      const row = events.find((item) => item.id === where.id);
      if (!row) return null;
      Object.assign(row, data);
      return decorate(row);
    },
  };
  const db = {
    apps,
    events,
    recruitmentApplication: {
      async findFirst({ where }) {
        return apps.find((item) => matches(item, where)) || null;
      },
      async updateMany({ where, data }) {
        const rows = apps.filter((item) => matches(item, where));
        rows.forEach((item) => Object.assign(item, data));
        return { count: rows.length };
      },
    },
    recruitmentApplicationInterviewEvent: eventsApi,
    async $transaction(fn) {
      const eventSnap = events.map((row) => ({ ...row }));
      const appSnap = apps.map((row) => ({ ...row }));
      try {
        return await fn(db);
      } catch (err) {
        events.splice(0, events.length, ...eventSnap.map((row) => ({ ...row })));
        for (let index = 0; index < appSnap.length; index += 1) {
          const live = apps[index];
          const snap = appSnap[index];
          if (!live || !snap) continue;
          for (const key of Object.keys(live)) {
            if (!Object.prototype.hasOwnProperty.call(snap, key)) delete live[key];
          }
          Object.assign(live, snap);
        }
        if (apps.length > appSnap.length) apps.splice(appSnap.length);
        throw err;
      }
    },
  };
  return db;
}

function openApp(db, patch = {}) {
  const app = {
    id: patch.id || 'app-1',
    organizationId: patch.organizationId || 'org-1',
    stageId: 'stage-1',
    stage: { id: 'stage-1', key: patch.stageKey || 'CONTACT', name: 'Contacto inicial' },
    candidate: { id: patch.candidateId || 'cand-1', archivedAt: patch.archivedAt || null },
    vacancy: { id: patch.vacancyId || 'vac-1' },
    interviewScheduledAt: patch.interviewScheduledAt || null,
    interviewTimeSpecified: patch.interviewTimeSpecified !== false,
    closureOutcome: patch.closureOutcome || null,
    notes: 'nota general',
  };
  db.apps.push(app);
  return app;
}

const TZ = 'America/Mexico_City';

console.log('\n=== Entrevistas múltiples ===\n');

check(
  crypto.createHash('sha256').update(indexHtml).digest('hex')
    === crypto.createHash('sha256').update(publicHtml).digest('hex'),
  'T HTML idénticos',
);
check(indexHtml.includes('Entrevistas · '), 'el expediente anuncia Entrevistas · N');
check(indexHtml.includes('Programar otra'), 'la acción compacta es Programar otra');
check(indexHtml.includes('aria-expanded'), 'el acordeón expone aria-expanded');
check(indexHtml.includes('__recInterviewEscape'), 'un repintado no registra otro Escape');
check(indexHtml.includes("e.name==='AbortError'"), 'AbortError no se muestra como fallo');
check(indexHtml.includes('recCandInterviewEpoch'), 'una respuesta vieja no pisa una entrevista más reciente');
check(indexHtml.includes('tcEsc(comment)') && indexHtml.includes('rec-iv-comment-box'), 'el comentario se escapa dentro del diálogo');
check(!indexHtml.includes('Sin comentarios'), 'no aparece el texto Sin comentarios');
check(routesSrc.includes(".strict()"), 'el alta de entrevista rechaza campos ajenos');
check(routesSrc.includes("z.enum(['ATTENDED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED', 'COMMENT', 'EDIT'])"), 'las acciones son un estado canónico');
check(indexHtml.includes("form.dataset.pending==='1'"), 'Guardar queda deshabilitado mientras la petición sigue en curso');
check(!/\/interviews/.test(publicRoutes), 'el portal público no escribe entrevistas');
check(!/novedad|setInterval|recordatorio/i.test(interviewSrc), 'esta fase no crea avisos ni un scheduler de recordatorios');
check(migration.includes("ADD VALUE 'SCHEDULED'") && migration.includes("ADD VALUE 'CANCELLED'"), 'la migración agrega los estados');
check(!migration.includes('CREATE UNIQUE INDEX') && !/\b(UPDATE|INSERT|WHERE|DEFAULT)\b/i.test(migration), 'la primera migración no crea el índice ni usa el valor nuevo');
check(slotMigration.includes('CREATE UNIQUE INDEX "RecruitmentApplicationInterviewEvent_one_scheduled_slot"'), 'el horario Programada no se duplica');
check(!/\bUPDATE\b/i.test(migration) && !/\bUPDATE\b/i.test(slotMigration), 'la migración no reescribe históricos');

const longOk = `${'a'.repeat(500)}`;
check(normalizeInterviewComment(longOk) === longOk, 'I un comentario de 500 caracteres se conserva');
let tooLong = false;
try { normalizeInterviewComment(`${longOk}b`); } catch (err) {
  tooLong = err.code === 'VALIDATION_ERROR';
}
check(tooLong, 'I un comentario de 501 caracteres se rechaza');
check(normalizeInterviewComment('  <script>alert(1)</script>  ') === '<script>alert(1)</script>', 'J el comentario se guarda como texto');
check(normalizeInterviewComment('   ') == null, 'un comentario vacío no se guarda');

const springEarly = utcInstantFromLocalParts('2026-03-08', 1, 30, 'America/New_York');
const springLate = utcInstantFromLocalParts('2026-03-08', 3, 30, 'America/New_York');
check(springLate.getTime() - springEarly.getTime() === 60 * 60 * 1000, 'R el salto de primavera no convierte dos horas civiles en dos horas UTC');
check(
  formatInterviewScheduledAtLabel(springEarly.toISOString(), 'America/New_York').includes('01:30'),
  'R las 01:30 se muestran en la zona de la cita',
);
const fall = utcInstantFromLocalParts('2026-11-01', 1, 30, 'America/New_York');
check(
  utcInstantFromLocalParts('2026-11-01', 1, 30, 'America/New_York').getTime() === fall.getTime()
    && formatInterviewScheduledAtLabel(fall.toISOString(), 'America/New_York').includes('01:30'),
  'R la hora repetida de otoño no se duplica ni se desplaza',
);

const db = memoryDb();
const app = openApp(db);
const first = await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1',
  applicationId: 'app-1',
  createdByUserId: 'user-1',
  interviewDate: '2026-11-12',
  interviewTime: '10:30',
  label: 'Entrevista con supervisor',
  comment: null,
  timeZone: TZ,
  db,
});
check(first.alreadyScheduled === false && first.interview.eventType === 'SCHEDULED', 'A la primera entrevista queda Programada');
check(first.interview.scheduledAt === '2026-11-12T16:30:00.000Z', 'Q la hora se guarda como instante canónico');
check(
  formatInterviewScheduledAtLabel(first.interview.scheduledAt, TZ).includes('10:30'),
  'Q el formateo de esa cita vuelve a las 10:30',
);
check(app.notes === 'nota general', 'el comentario no se copia a las notas del candidato');

let againCode = null;
let againMessage = null;
try {
  await scheduleRecruitmentApplicationInterview({
    organizationId: 'org-1',
    applicationId: 'app-1',
    createdByUserId: 'user-1',
    interviewDate: '2026-11-12',
    interviewTime: '10:30',
    label: 'Otro nombre',
    timeZone: TZ,
    db,
  });
} catch (err) {
  againCode = err.code;
  againMessage = err.message;
}
check(
  againCode === 'CONFLICT'
    && againMessage === INTERVIEW_SLOT_TAKEN_MESSAGE
    && db.events.length === 1
    && db.events[0].label === 'Entrevista con supervisor'
    && db.events[0].id === first.interview.id,
  'K un horario ocupado responde 409 y no sustituye la entrevista',
);

const second = await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1',
  applicationId: 'app-1',
  createdByUserId: 'user-1',
  interviewDate: '2026-11-20',
  interviewTime: '16:00',
  label: 'Entrevista final',
  comment: 'Traer identificación',
  timeZone: TZ,
  db,
});
check(second.alreadyScheduled === false && db.events.filter((row) => row.applicationId === 'app-1').length === 2, 'B la segunda entrevista no borra la primera');
check(app.interviewScheduledAt.toISOString() === first.interview.scheduledAt, 'la cita visible sigue siendo la más próxima');

const other = openApp(db, { id: 'app-2', vacancyId: 'vac-2' });
await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1',
  applicationId: 'app-2',
  createdByUserId: 'user-1',
  interviewDate: '2026-11-18',
  interviewTime: '09:00',
  label: 'Otra vacante',
  timeZone: TZ,
  db,
});
check(
  db.events.filter((row) => row.applicationId === 'app-1').length === 2
    && db.events.filter((row) => row.applicationId === 'app-2').length === 1
    && other.vacancy.id === 'vac-2',
  'C cada postulación conserva sus propias entrevistas',
);

const rows = buildApplicationInterviewRows(app, db.events.filter((row) => row.applicationId === 'app-1').map(decorate));
const ordered = orderInterviewsForDisplay(rows);
check(ordered.upcoming.map((row) => row.label).join('|') === 'Entrevista con supervisor|Entrevista final', 'D la próxima queda antes que la posterior');
check(ordered.total === 2 && rows.filter((row) => row.legacy).length === 0, 'una cita ya registrada no se duplica con la columna');

const attended = await updateRecruitmentApplicationInterview({
  organizationId: 'org-1',
  applicationId: 'app-1',
  eventId: first.interview.id,
  action: 'ATTENDED',
  createdByUserId: 'user-1',
  comment: 'Buena impresión',
  timeZone: TZ,
  db,
});
check(attended.interview.eventType === 'ATTENDED' && attended.interview.comment === 'Buena impresión', 'E e I realizada conserva su comentario');
const attendedAgain = await updateRecruitmentApplicationInterview({
  organizationId: 'org-1',
  applicationId: 'app-1',
  eventId: first.interview.id,
  action: 'ATTENDED',
  createdByUserId: 'user-1',
  timeZone: TZ,
  db,
});
check(attendedAgain.alreadyApplied === true && db.events.filter((row) => row.eventType === 'ATTENDED').length === 1, 'E repetir realizada no crea otra fila');

const oldInstant = second.interview.scheduledAt;
const moved = await updateRecruitmentApplicationInterview({
  organizationId: 'org-1',
  applicationId: 'app-1',
  eventId: second.interview.id,
  action: 'RESCHEDULED',
  createdByUserId: 'user-1',
  interviewDate: '2026-11-21',
  interviewTime: '11:00',
  timeZone: TZ,
  db,
});
const previous = db.events.find((row) => row.id === second.interview.id);
check(
  previous.eventType === 'RESCHEDULED'
    && previous.scheduledAt.toISOString() === oldInstant
    && moved.interview.eventType === 'SCHEDULED'
    && moved.interview.scheduledAt === '2026-11-21T17:00:00.000Z',
  'F reprogramar conserva la fecha anterior y crea la cita nueva',
);

await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1',
  applicationId: 'app-1',
  createdByUserId: 'user-1',
  interviewDate: '2026-11-22',
  interviewTime: '12:00',
  label: 'Entrevista de cierre',
  comment: 'Sala 2',
  timeZone: TZ,
  db,
});
const cancelTarget = db.events.find((row) => row.label === 'Entrevista de cierre');
const cancelled = await updateRecruitmentApplicationInterview({
  organizationId: 'org-1',
  applicationId: 'app-1',
  eventId: cancelTarget.id,
  action: 'CANCELLED',
  createdByUserId: 'user-1',
  comment: 'El cliente canceló',
  timeZone: TZ,
  db,
});
check(cancelled.interview.eventType === 'CANCELLED' && cancelled.interview.comment === 'El cliente canceló', 'G cancelada conserva el motivo');

await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1',
  applicationId: 'app-1',
  createdByUserId: 'user-1',
  interviewDate: '2026-11-23',
  interviewTime: '13:00',
  label: 'Entrevista inicial',
  timeZone: TZ,
  db,
});
const absentTarget = db.events.find((row) => row.label === 'Entrevista inicial');
const absent = await updateRecruitmentApplicationInterview({
  organizationId: 'org-1',
  applicationId: 'app-1',
  eventId: absentTarget.id,
  action: 'NO_SHOW',
  createdByUserId: 'user-1',
  comment: 'No confirmó su asistencia.',
  timeZone: TZ,
  db,
});
check(absent.interview.eventType === 'NO_SHOW' && absent.interview.comment === 'No confirmó su asistencia.', 'H no asistió conserva el comentario');

const past = orderInterviewsForDisplay(db.events.filter((row) => row.applicationId === 'app-1').map(decorate));
check(
  past.upcoming.every((row) => row.eventType === 'SCHEDULED')
    && past.past.every((row) => row.eventType !== 'SCHEDULED')
    && past.past.map((row) => row.scheduledAt).join('|')
      === past.past.map((row) => row.scheduledAt).slice().sort((a, b) => new Date(b) - new Date(a)).join('|'),
  'D las anteriores quedan de la más reciente a la más antigua',
);

let missing = null;
try {
  await scheduleRecruitmentApplicationInterview({
    organizationId: 'org-2',
    applicationId: 'app-1',
    createdByUserId: 'user-2',
    interviewDate: '2026-11-24',
    interviewTime: '10:00',
    timeZone: TZ,
    db,
  });
} catch (err) { missing = err.code; }
check(missing === 'NOT_FOUND', 'L otra organización recibe not found');

for (const [label, patch] of [
  ['HIRED', { id: 'app-hired', stageKey: 'HIRED' }],
  ['REJECTED', { id: 'app-rejected', stageKey: 'REJECTED' }],
  ['DECLINED', { id: 'app-declined', closureOutcome: 'DECLINED' }],
]) {
  openApp(db, patch);
  let code = null;
  try {
    await scheduleRecruitmentApplicationInterview({
      organizationId: 'org-1',
      applicationId: patch.id,
      createdByUserId: 'user-1',
      interviewDate: '2026-11-24',
      interviewTime: '10:00',
      timeZone: TZ,
      db,
    });
  } catch (err) { code = err.code; }
  check(code === 'CONFLICT', `M ${label} bloquea una entrevista nueva`);
}

openApp(db, { id: 'app-archived', archivedAt: '2026-11-01T00:00:00.000Z' });
let archivedCode = null;
try {
  await scheduleRecruitmentApplicationInterview({
    organizationId: 'org-1',
    applicationId: 'app-archived',
    createdByUserId: 'user-1',
    interviewDate: '2026-11-24',
    interviewTime: '10:00',
    timeZone: TZ,
    db,
  });
} catch (err) { archivedCode = err.code; }
check(archivedCode === 'CONFLICT', 'S un candidato archivado bloquea la escritura');

const closing = memoryDb();
const closingApp = openApp(closing, {
  id: 'app-close',
  interviewScheduledAt: new Date('2026-11-30T16:00:00.000Z'),
});
await closing.recruitmentApplicationInterviewEvent.create({
  data: {
    organizationId: 'org-1',
    applicationId: 'app-close',
    stageId: 'stage-1',
    eventType: 'SCHEDULED',
    scheduledAt: new Date('2026-11-30T16:00:00.000Z'),
    scheduledTimeSpecified: true,
    comment: 'Conservar este comentario',
    createdByUserId: 'user-1',
  },
});
await closing.recruitmentApplicationInterviewEvent.create({
  data: {
    organizationId: 'org-1',
    applicationId: 'app-close',
    stageId: 'stage-1',
    eventType: 'SCHEDULED',
    scheduledAt: new Date('2026-12-02T16:00:00.000Z'),
    scheduledTimeSpecified: true,
    createdByUserId: 'user-1',
  },
});
await closing.recruitmentApplicationInterviewEvent.create({
  data: {
    organizationId: 'org-1',
    applicationId: 'app-close',
    stageId: 'stage-1',
    eventType: 'ATTENDED',
    scheduledAt: new Date('2026-11-01T16:00:00.000Z'),
    scheduledTimeSpecified: true,
    comment: 'Ya realizada',
    createdByUserId: 'user-1',
  },
});
const closed = await cancelScheduledInterviewsForClosedApplication(closing, {
  organizationId: 'org-1',
  applicationId: 'app-close',
  createdByUserId: 'user-1',
  legacyScheduledAt: closingApp.interviewScheduledAt,
  stageId: 'stage-1',
});
check(closed.cancelled === 2, 'N y P el cierre cancela las citas que seguían programadas');
check(
  closing.events.filter((row) => row.eventType === 'CANCELLED').length === 2
    && closing.events.find((row) => row.comment === 'Conservar este comentario').eventType === 'CANCELLED'
    && closing.events.find((row) => row.scheduledAt.toISOString() === '2026-12-02T16:00:00.000Z').comment === INTERVIEW_CLOSED_SYSTEM_COMMENT
    && closing.events.find((row) => row.comment === 'Ya realizada').eventType === 'ATTENDED'
    && closingApp.interviewScheduledAt == null,
  'N el cierre conserva realizadas y comentarios, y deja razón de sistema si no había una',
);
const memorySkip = await cancelScheduledInterviewsForClosedApplication({ recruitmentApplication: { async findFirst() { throw new Error('no debe leer'); } } }, {
  organizationId: 'org-1',
  applicationId: 'app-close',
});
check(memorySkip.cancelled === 0, 'P sin tabla de entrevistas el cierre no inventa recordatorios');

const legacyDb = memoryDb();
const legacyApp = openApp(legacyDb, {
  id: 'app-legacy',
  interviewScheduledAt: new Date('2026-11-09T22:00:00.000Z'),
});
const legacyRows = buildApplicationInterviewRows(legacyApp, []);
check(legacyRows.length === 1 && legacyRows[0].legacy === true && legacyRows[0].eventType === 'SCHEDULED', 'la cita antigua aparece como la primera entrevista');
const legacyDone = await updateRecruitmentApplicationInterview({
  organizationId: 'org-1',
  applicationId: 'app-legacy',
  eventId: 'legacy',
  action: 'ATTENDED',
  createdByUserId: 'user-1',
  comment: 'Primera entrevista histórica',
  timeZone: TZ,
  db: legacyDb,
});
check(
  legacyDone.interview.eventType === 'ATTENDED'
    && legacyDone.interview.scheduledAt === '2026-11-09T22:00:00.000Z'
    && legacyApp.interviewScheduledAt == null,
  'la cita antigua se resuelve sin perder su horario',
);

const clock = new Date('2026-11-09T18:00:00.000Z');
const keptOnMove = resolveInterviewScheduledAtForApplicationUpdate({
  stageChanged: true,
  fromStageKey: 'INITIAL_INTERVIEW',
  toStageKey: 'FINALIST',
  existingInterviewScheduledAt: new Date('2026-11-15T16:00:00.000Z'),
});
check(keptOnMove?.toISOString() === '2026-11-15T16:00:00.000Z', 'A pasar a Finalista conserva la próxima cita');
const keptOpen = resolveInterviewScheduledAtForApplicationUpdate({
  stageChanged: true,
  fromStageKey: 'INITIAL_INTERVIEW',
  toStageKey: 'EVALUATIONS',
  existingInterviewScheduledAt: new Date('2026-11-15T16:00:00.000Z'),
});
check(keptOpen?.toISOString() === '2026-11-15T16:00:00.000Z', 'B un cambio entre etapas abiertas no toca el apuntador');
check(
  /toStageKey === 'HIRED' \|\| toStageKey === 'REJECTED'/.test(
    fs.readFileSync(path.join(root, 'server', 'src', 'services', 'recruitmentApplication.service.js'), 'utf8'),
  ),
  'B solo el cierre cancela entrevistas, no el cambio de etapa',
);

const several = memoryDb();
openApp(several, { id: 'app-several' });
await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-several', createdByUserId: 'user-1',
  interviewDate: '2026-11-20', interviewTime: '10:00', label: 'Día 20', timeZone: TZ, now: clock, db: several,
});
await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-several', createdByUserId: 'user-1',
  interviewDate: '2026-11-15', interviewTime: '10:00', label: 'Día 15', timeZone: TZ, now: clock, db: several,
});
const severalApp = several.apps[0];
check(severalApp.interviewScheduledAt.toISOString() === '2026-11-15T16:00:00.000Z', 'C dos futuras eligen la más próxima');
const day15 = several.events.find((row) => row.label === 'Día 15');
await updateRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-several', eventId: day15.id, action: 'RESCHEDULED',
  createdByUserId: 'user-1', interviewDate: '2026-11-25', interviewTime: '10:00', timeZone: TZ, now: clock, db: several,
});
check(
  several.events.find((row) => row.id === day15.id).eventType === 'RESCHEDULED'
    && several.events.find((row) => row.id === day15.id).scheduledAt.toISOString() === '2026-11-15T16:00:00.000Z'
    && several.events.some((row) => row.eventType === 'SCHEDULED' && row.scheduledAt.toISOString() === '2026-11-25T16:00:00.000Z')
    && severalApp.interviewScheduledAt.toISOString() === '2026-11-20T16:00:00.000Z',
  'E reprogramar la del 15 al 25 deja el apuntador en el 20',
);
const day20 = several.events.find((row) => row.label === 'Día 20');
await updateRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-several', eventId: day20.id, action: 'ATTENDED',
  createdByUserId: 'user-1', timeZone: TZ, now: clock, db: several,
});
check(severalApp.interviewScheduledAt.toISOString() === '2026-11-25T16:00:00.000Z', 'D resolver la más próxima avanza a la siguiente');

const overdueOnly = memoryDb();
openApp(overdueOnly, { id: 'app-overdue' });
await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-overdue', createdByUserId: 'user-1',
  interviewDate: '2026-11-01', interviewTime: '10:00', label: 'Atrasada', timeZone: TZ, now: clock, db: overdueOnly,
});
await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-overdue', createdByUserId: 'user-1',
  interviewDate: '2026-11-18', interviewTime: '10:00', label: 'Futura', timeZone: TZ, now: clock, db: overdueOnly,
});
check(
  overdueOnly.apps[0].interviewScheduledAt.toISOString() === '2026-11-18T16:00:00.000Z'
    && overdueOnly.events.find((row) => row.label === 'Atrasada').eventType === 'SCHEDULED',
  'G la cita atrasada sigue Programada y no desplaza a la futura',
);
const closedMix = await cancelScheduledInterviewsForClosedApplication(overdueOnly, {
  organizationId: 'org-1', applicationId: 'app-overdue', createdByUserId: 'user-1', now: clock,
});
check(closedMix.cancelled === 2 && overdueOnly.apps[0].interviewScheduledAt == null, 'F el cierre limpia el apuntador');
check(
  overdueOnly.events.every((row) => row.eventType === 'CANCELLED')
    && overdueOnly.events.find((row) => row.label === 'Atrasada').comment === INTERVIEW_CLOSED_UNRESOLVED_COMMENT
    && overdueOnly.events.find((row) => row.label === 'Futura').comment === INTERVIEW_CLOSED_SYSTEM_COMMENT
    && !overdueOnly.events.some((row) => row.eventType === 'NO_SHOW'),
  'G el cierre no convierte la cita atrasada en No asistió',
);
check(overdueOnly.events.length === 2, 'M el cierre conserva las filas para lectura');

const virtual = memoryDb();
const virtualApp = openApp(virtual, {
  id: 'app-virtual',
  interviewScheduledAt: new Date('2026-11-15T16:00:00.000Z'),
});
const beforeRows = buildApplicationInterviewRows(virtualApp, []);
check(countVisibleInterviews(beforeRows) === 1 && beforeRows[0].legacy === true, 'L la cita virtual cuenta una sola vez al leer');
await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-virtual', createdByUserId: 'user-1',
  interviewDate: '2026-11-20', interviewTime: '10:00', label: 'Segunda', timeZone: TZ, now: clock, db: virtual,
});
const afterRows = buildApplicationInterviewRows(virtualApp, virtual.events.map(decorate));
check(
  virtual.events.filter((row) => row.eventType === 'SCHEDULED').length === 2
    && countVisibleInterviews(afterRows) === 2
    && afterRows.filter((row) => row.legacy).length === 0
    && virtualApp.interviewScheduledAt.toISOString() === '2026-11-15T16:00:00.000Z',
  'H y L programar otra materializa la cita histórica y no la sustituye',
);

const race = memoryDb();
openApp(race, {
  id: 'app-race',
  interviewScheduledAt: new Date('2026-11-15T16:00:00.000Z'),
});
race.failNextScheduledCreate = true;
await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-race', createdByUserId: 'user-1',
  interviewDate: '2026-11-20', interviewTime: '10:00', label: 'Nueva', timeZone: TZ, now: clock, db: race,
});
check(
  race.events.filter((row) => row.eventType === 'SCHEDULED').length === 2
    && race.events.filter((row) => row.scheduledAt.toISOString() === '2026-11-15T16:00:00.000Z').length === 1,
  'I la materialización concurrente no duplica la cita histórica',
);
const otherUnique = memoryDb();
openApp(otherUnique, { id: 'app-other' });
otherUnique.foreignUnique = true;
let foreignCode = null;
try {
  await scheduleRecruitmentApplicationInterview({
    organizationId: 'org-1', applicationId: 'app-other', createdByUserId: 'user-1',
    interviewDate: '2026-11-20', interviewTime: '10:00', timeZone: TZ, now: clock, db: otherUnique,
  });
} catch (err) {
  foreignCode = err.code;
  check(!isScheduledInterviewSlotConflict(err), 'otro conflicto único no se trata como cita repetida');
}
check(foreignCode === 'P2002' && otherUnique.events.length === 0, 'otro error único se propaga');
check(
  slotMigration.includes('WHERE "eventType" = \'SCHEDULED\'')
    && slotMigration.includes('"applicationId"')
    && slotMigration.includes('"scheduledAt"')
    && !slotMigration.includes('RecruitmentApplicationInterviewEvent_applicationId_createdAt_idx'),
  'J y K el índice parcial solo cubre Programada y no choca con los índices anteriores',
);
const rescheduledAtSameTime = race.events.find((row) => row.scheduledAt.toISOString() === '2026-11-15T16:00:00.000Z');
await race.recruitmentApplicationInterviewEvent.create({
  data: {
    organizationId: 'org-1', applicationId: 'app-race', stageId: 'stage-1',
    eventType: 'RESCHEDULED', scheduledAt: rescheduledAtSameTime.scheduledAt,
    scheduledTimeSpecified: true, createdByUserId: 'user-1',
  },
});
check(
  race.events.filter((row) => row.scheduledAt.toISOString() === '2026-11-15T16:00:00.000Z' && row.eventType === 'SCHEDULED').length === 1
    && race.events.some((row) => row.eventType === 'RESCHEDULED'),
  'K el antecedente Reprogramada puede compartir la hora histórica',
);
check(selectNextInterviewPointer(overdueOnly.events, clock) == null, 'sin Programada futura el apuntador no elige una cancelada');

const appSvc = fs.readFileSync(
  path.join(root, 'server', 'src', 'services', 'recruitmentApplication.service.js'),
  'utf8',
);
check(!appSvc.includes('data.interviewScheduledAt'), 'ningún update del proceso asigna interviewScheduledAt');
check(
  appSvc.includes('applyRecruitmentInterviewFormChange')
    && appSvc.includes('recordUnattributedInterviewSnapshot')
    && interviewSrc.includes('async function pointSnapshotAt'),
  'el formulario y el portal pasan por el helper del apuntador',
);
const lockAt = interviewSrc.indexOf('interviewScheduledAt: null');
check(
  lockAt > 0 && interviewSrc.indexOf('recalculateInterviewScheduledAt', lockAt) > lockAt,
  'el candado del endpoint anterior recalcula el apuntador en la misma transacción',
);
check(indexHtml.includes("row.eventType!=='RESCHEDULED'"), 'N no cuenta una reprogramación');
check(indexHtml.includes('rec-cand-interview-row--history'), 'Reprogramada se ve como antecedente');

async function oldForm(db, applicationId, scheduledAt) {
  return applyRecruitmentInterviewFormChange(db, {
    organizationId: 'org-1',
    applicationId,
    createdByUserId: 'user-1',
    scheduledAt,
    timeSpecified: true,
    now: clock,
  });
}

function appointmentCount(db) {
  return countVisibleInterviews(buildApplicationInterviewRows(db.apps[0], db.events.map(decorate)));
}

function pointerMatchesAScheduledRow(db, now) {
  const app = db.apps[0];
  const scheduled = db.events.filter((row) => row.eventType === 'SCHEDULED');
  const keys = scheduled.map((row) => `${row.scheduledAt.toISOString()}|${row.scheduledTimeSpecified !== false}`);
  if (new Set(keys).size !== keys.length) return false;
  if (!app.interviewScheduledAt) {
    return !scheduled.some((row) => new Date(row.scheduledAt).getTime() >= now.getTime());
  }
  const pointed = scheduled.find((row) => row.scheduledAt.toISOString() === new Date(app.interviewScheduledAt).toISOString());
  return !!pointed
    && pointed.eventType === 'SCHEDULED'
    && new Date(pointed.scheduledAt).getTime() >= now.getTime();
}

const formDb = memoryDb();
const formApp = openApp(formDb, { id: 'app-form' });
const firstSlot = new Date('2026-11-15T16:00:00.000Z');
const createdForm = await oldForm(formDb, 'app-form', firstSlot);
check(
  createdForm.action === 'scheduled'
    && formDb.events.length === 1
    && formDb.events[0].eventType === 'SCHEDULED'
    && formApp.interviewScheduledAt.toISOString() === firstSlot.toISOString()
    && appointmentCount(formDb) === 1,
  'A el formulario anterior crea la primera fila Programada',
);
formDb.events[0].comment = 'Motivo de la primera';
const sameForm = await oldForm(formDb, 'app-form', new Date(firstSlot.getTime()));
check(
  sameForm.action === 'unchanged'
    && formDb.events.length === 1
    && formApp.interviewScheduledAt.toISOString() === firstSlot.toISOString(),
  'B guardar la misma fecha no crea fila, evento ni reescritura',
);
const movedSlot = new Date('2026-11-20T16:00:00.000Z');
const movedForm = await oldForm(formDb, 'app-form', movedSlot);
const previousForm = formDb.events.find((row) => row.scheduledAt.toISOString() === firstSlot.toISOString());
const currentForm = formDb.events.find((row) => row.eventType === 'SCHEDULED');
check(
  movedForm.action === 'rescheduled'
    && previousForm.eventType === 'RESCHEDULED'
    && previousForm.rescheduledToAt.toISOString() === movedSlot.toISOString()
    && previousForm.comment === 'Motivo de la primera'
    && currentForm.scheduledAt.toISOString() === movedSlot.toISOString()
    && !currentForm.comment
    && formApp.interviewScheduledAt.toISOString() === movedSlot.toISOString(),
  'C cambiar la fecha reprograma: la anterior queda Reprogramada y nace una Programada',
);
await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-form', createdByUserId: 'user-1',
  interviewDate: '2026-11-25', interviewTime: '10:00', label: 'Otra cita', timeZone: TZ, now: clock, db: formDb,
});
check(
  formDb.events.filter((row) => row.eventType === 'SCHEDULED').length === 2
    && formApp.interviewScheduledAt.toISOString() === movedSlot.toISOString(),
  'la otra entrevista independiente sigue programada',
);
const clearedForm = await oldForm(formDb, 'app-form', null);
const cancelledNext = formDb.events.find((row) => row.scheduledAt.toISOString() === movedSlot.toISOString());
const keptIndependent = formDb.events.find((row) => row.label === 'Otra cita');
check(
  clearedForm.action === 'cleared'
    && cancelledNext.eventType === 'CANCELLED'
    && cancelledNext.comment === INTERVIEW_CLEARED_SYSTEM_COMMENT
    && keptIndependent.eventType === 'SCHEDULED'
    && previousForm.eventType === 'RESCHEDULED',
  'D clearInterview cancela solo la próxima cita',
);
check(
  formApp.interviewScheduledAt.toISOString() === '2026-11-25T16:00:00.000Z',
  'E después de clearInterview el apuntador avanza a la siguiente',
);

const virtualForm = memoryDb();
const virtualFormApp = openApp(virtualForm, {
  id: 'app-virtual-form',
  interviewScheduledAt: new Date('2026-11-12T16:00:00.000Z'),
});
const clearedVirtual = await oldForm(virtualForm, 'app-virtual-form', null);
check(
  clearedVirtual.action === 'cleared'
    && virtualForm.events.length === 1
    && virtualForm.events[0].eventType === 'CANCELLED'
    && virtualForm.events[0].scheduledAt.toISOString() === '2026-11-12T16:00:00.000Z'
    && virtualForm.events[0].comment === INTERVIEW_CLEARED_SYSTEM_COMMENT
    && virtualFormApp.interviewScheduledAt == null
    && appointmentCount(virtualForm) === 1,
  'F clearInterview materializa y cancela la cita virtual, y esa cancelada cuenta 1',
);

const overdueForm = memoryDb();
openApp(overdueForm, { id: 'app-overdue-form', interviewScheduledAt: null });
await overdueForm.recruitmentApplicationInterviewEvent.create({
  data: {
    organizationId: 'org-1', applicationId: 'app-overdue-form', stageId: 'stage-1',
    eventType: 'SCHEDULED', scheduledAt: new Date('2026-11-01T16:00:00.000Z'),
    scheduledTimeSpecified: true, createdByUserId: 'user-1',
  },
});
const ignoredOverdue = await oldForm(overdueForm, 'app-overdue-form', null);
check(
  ignoredOverdue.action === 'noop'
    && overdueForm.events.length === 1
    && overdueForm.events[0].eventType === 'SCHEDULED'
    && overdueForm.apps[0].interviewScheduledAt == null,
  'G clearInterview no toca una Programada atrasada si no era el apuntador',
);
check(
  pointerMatchesAScheduledRow(formDb, clock) && pointerMatchesAScheduledRow(virtualForm, clock),
  'H el formulario anterior no deja Programada huérfana ni apuntador hacia una cancelada',
);

const chain = memoryDb();
openApp(chain, { id: 'app-chain' });
await oldForm(chain, 'app-chain', new Date('2026-11-15T16:00:00.000Z'));
await oldForm(chain, 'app-chain', new Date('2026-11-18T16:00:00.000Z'));
const chainRows = buildApplicationInterviewRows(chain.apps[0], chain.events.map(decorate));
const chainView = orderInterviewsForDisplay(chainRows, clock);
check(
  appointmentCount(chain) === 1
    && chain.events.filter((row) => row.eventType === 'RESCHEDULED').length === 1
    && chain.events.filter((row) => row.eventType === 'SCHEDULED').length === 1
    && chainView.past.some((row) => row.eventType === 'RESCHEDULED')
    && chainView.upcoming.some((row) => row.eventType === 'SCHEDULED')
    && chainView.total === 1,
  'I y M una reprogramación mantiene N = 1 y el antecedente sigue visible',
);
await oldForm(chain, 'app-chain', new Date('2026-11-22T16:00:00.000Z'));
check(
  appointmentCount(chain) === 1
    && chain.events.filter((row) => row.eventType === 'RESCHEDULED').length === 2
    && chain.events.filter((row) => row.eventType === 'SCHEDULED').length === 1,
  'J varias reprogramaciones mantienen N = 1',
);

const independent = memoryDb();
openApp(independent, { id: 'app-independent' });
await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-independent', createdByUserId: 'user-1',
  interviewDate: '2026-11-15', interviewTime: '10:00', timeZone: TZ, now: clock, db: independent,
});
await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-independent', createdByUserId: 'user-1',
  interviewDate: '2026-11-20', interviewTime: '10:00', timeZone: TZ, now: clock, db: independent,
});
check(appointmentCount(independent) === 2, 'K dos entrevistas independientes dan N = 2');
const nearest = independent.events.find((row) => row.scheduledAt.toISOString() === '2026-11-15T16:00:00.000Z');
await updateRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-independent', eventId: nearest.id, action: 'ATTENDED',
  createdByUserId: 'user-1', timeZone: TZ, now: clock, db: independent,
});
check(
  appointmentCount(independent) === 2
    && independent.events.some((row) => row.eventType === 'ATTENDED')
    && independent.events.some((row) => row.eventType === 'SCHEDULED'),
  'L una realizada y una futura dan N = 2',
);
check(
  !appSvc.includes('data.interviewScheduledAt')
    && /toStageKey === 'HIRED' \|\| toStageKey === 'REJECTED'/.test(appSvc),
  'N cambiar de etapa abierta no escribe el apuntador; solo el cierre cancela',
);
const formClosed = await cancelScheduledInterviewsForClosedApplication(formDb, {
  organizationId: 'org-1', applicationId: 'app-form', createdByUserId: 'user-1', now: clock,
});
check(
  formClosed.cancelled === 1
    && formApp.interviewScheduledAt == null
    && !formDb.events.some((row) => row.eventType === 'SCHEDULED')
    && formDb.events.some((row) => row.eventType === 'RESCHEDULED')
    && formDb.events.some((row) => row.eventType === 'CANCELLED'),
  'O cerrar el proceso cancela pendientes y conserva reprogramadas',
);

const portalDb = memoryDb();
openApp(portalDb, { id: 'app-portal' });
await recordUnattributedInterviewSnapshot(portalDb, {
  organizationId: 'org-1',
  applicationId: 'app-portal',
  scheduledAt: new Date('2026-11-15T16:00:00.000Z'),
  timeSpecified: true,
});
check(portalDb.events.length === 0 && appointmentCount(portalDb) === 1, 'el portal sin usuario deja una cita virtual y N = 1');
await oldForm(portalDb, 'app-portal', new Date('2026-11-18T16:00:00.000Z'));
check(
  portalDb.events.some((row) => row.eventType === 'RESCHEDULED' && row.scheduledAt.toISOString() === '2026-11-15T16:00:00.000Z')
    && portalDb.events.some((row) => row.eventType === 'SCHEDULED' && row.scheduledAt.toISOString() === '2026-11-18T16:00:00.000Z')
    && appointmentCount(portalDb) === 1
    && portalDb.apps[0].interviewScheduledAt.toISOString() === '2026-11-18T16:00:00.000Z',
  'reprogramar la cita virtual no la pierde y conserva N = 1',
);

const separate = memoryDb();
openApp(separate, { id: 'app-separate' });
await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-separate', createdByUserId: 'user-1',
  interviewDate: '2026-11-15', interviewTime: '10:00', label: 'Primera', comment: 'Comentario de la primera',
  timeZone: TZ, now: clock, db: separate,
});
await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-separate', createdByUserId: 'user-1',
  interviewDate: '2026-11-20', interviewTime: '10:00', label: 'Segunda', comment: 'Comentario de la segunda',
  timeZone: TZ, now: clock, db: separate,
});
const firstSeparate = separate.events.find((row) => row.label === 'Primera');
const secondSeparate = separate.events.find((row) => row.label === 'Segunda');
check(appointmentCount(separate) === 2, 'A dos entrevistas independientes cuentan N = 2');
let occupiedCode = null;
let occupiedMessage = null;
try {
  await updateRecruitmentApplicationInterview({
    organizationId: 'org-1', applicationId: 'app-separate', eventId: firstSeparate.id, action: 'RESCHEDULED',
    createdByUserId: 'user-1', interviewDate: '2026-11-20', interviewTime: '10:00', timeZone: TZ, now: clock, db: separate,
  });
} catch (err) {
  occupiedCode = err.code;
  occupiedMessage = err.message;
}
check(
  occupiedCode === 'CONFLICT' && occupiedMessage === INTERVIEW_SLOT_TAKEN_MESSAGE,
  'B reprogramar al horario de la otra responde 409',
);
check(
  separate.events.find((row) => row.id === firstSeparate.id).eventType === 'SCHEDULED'
    && separate.events.find((row) => row.id === firstSeparate.id).comment === 'Comentario de la primera'
    && separate.events.find((row) => row.id === firstSeparate.id).label === 'Primera'
    && separate.events.find((row) => row.id === secondSeparate.id).eventType === 'SCHEDULED'
    && separate.events.find((row) => row.id === secondSeparate.id).comment === 'Comentario de la segunda'
    && separate.events.find((row) => row.id === secondSeparate.id).label === 'Segunda'
    && separate.events.filter((row) => row.eventType === 'RESCHEDULED').length === 0,
  'C y J ninguna cambia y los textos distintos no se fusionan',
);
check(appointmentCount(separate) === 2, 'D N continúa en 2');
check(
  separate.apps[0].interviewScheduledAt.toISOString() === '2026-11-15T16:00:00.000Z',
  'K el apuntador conserva la próxima cita tras el conflicto',
);
const movedSeparate = await updateRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-separate', eventId: firstSeparate.id, action: 'RESCHEDULED',
  createdByUserId: 'user-1', interviewDate: '2026-11-25', interviewTime: '10:00', timeZone: TZ, now: clock, db: separate,
});
check(
  movedSeparate.alreadyApplied === false
    && movedSeparate.interview.eventType === 'SCHEDULED'
    && movedSeparate.interview.label === 'Primera'
    && !movedSeparate.interview.comment
    && separate.events.find((row) => row.id === firstSeparate.id).eventType === 'RESCHEDULED'
    && separate.events.find((row) => row.id === firstSeparate.id).rescheduledToAt.toISOString() === '2026-11-25T16:00:00.000Z'
    && separate.events.find((row) => row.id === secondSeparate.id).eventType === 'SCHEDULED'
    && appointmentCount(separate) === 2,
  'E reprogramar a un horario libre conserva N',
);
const beforeRepeat = separate.events.length;
const repeatedSeparate = await updateRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-separate', eventId: firstSeparate.id, action: 'RESCHEDULED',
  createdByUserId: 'user-1', interviewDate: '2026-11-25', interviewTime: '10:00', timeZone: TZ, now: clock, db: separate,
});
check(
  repeatedSeparate.alreadyApplied === true
    && repeatedSeparate.interview.id === movedSeparate.interview.id
    && separate.events.length === beforeRepeat,
  'F repetir la reprogramación devuelve la cadena existente',
);
const sameSlot = await updateRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-separate', eventId: secondSeparate.id, action: 'RESCHEDULED',
  createdByUserId: 'user-1', interviewDate: '2026-11-20', interviewTime: '10:00', timeZone: TZ, now: clock, db: separate,
});
check(
  sameSlot.alreadyApplied === true
    && sameSlot.interview.id === secondSeparate.id
    && separate.events.find((row) => row.id === secondSeparate.id).eventType === 'SCHEDULED'
    && separate.events.filter((row) => row.eventType === 'RESCHEDULED').length === 1,
  'I guardar el mismo horario de la propia cita es no-op',
);

const raced = memoryDb();
openApp(raced, { id: 'app-raced' });
await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-raced', createdByUserId: 'user-1',
  interviewDate: '2026-11-15', interviewTime: '10:00', label: 'Origen', comment: 'No mezclar',
  timeZone: TZ, now: clock, db: raced,
});
await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-raced', createdByUserId: 'user-1',
  interviewDate: '2026-11-20', interviewTime: '10:00', label: 'Ocupante', comment: 'Sigo siendo otra',
  timeZone: TZ, now: clock, db: raced,
});
const racedOrigin = raced.events.find((row) => row.label === 'Origen');
const racedOccupant = raced.events.find((row) => row.label === 'Ocupante');
const racedFind = raced.recruitmentApplicationInterviewEvent.findFirst.bind(raced.recruitmentApplicationInterviewEvent);
let hiddenLookups = 0;
raced.recruitmentApplicationInterviewEvent.findFirst = async (args) => {
  const where = args?.where || {};
  if (hiddenLookups < 2 && where.eventType === 'SCHEDULED' && where.scheduledAt
    && new Date(where.scheduledAt).toISOString() === '2026-11-20T16:00:00.000Z') {
    hiddenLookups += 1;
    return null;
  }
  return racedFind(args);
};
let racedCode = null;
let racedMessage = null;
try {
  await updateRecruitmentApplicationInterview({
    organizationId: 'org-1', applicationId: 'app-raced', eventId: racedOrigin.id, action: 'RESCHEDULED',
    createdByUserId: 'user-1', interviewDate: '2026-11-20', interviewTime: '10:00', timeZone: TZ, now: clock, db: raced,
  });
} catch (err) {
  racedCode = err.code;
  racedMessage = err.message;
}
const scheduledAtTarget = raced.events.filter((row) => row.eventType === 'SCHEDULED'
  && row.scheduledAt.toISOString() === '2026-11-20T16:00:00.000Z');
check(
  racedCode === 'CONFLICT'
    && racedMessage === INTERVIEW_SLOT_TAKEN_MESSAGE
    && scheduledAtTarget.length === 1
    && scheduledAtTarget[0].id === racedOccupant.id
    && raced.events.find((row) => row.id === racedOrigin.id).eventType === 'SCHEDULED'
    && raced.events.find((row) => row.id === racedOrigin.id).comment === 'No mezclar'
    && raced.events.find((row) => row.id === racedOccupant.id).comment === 'Sigo siendo otra'
    && raced.apps[0].interviewScheduledAt.toISOString() === '2026-11-15T16:00:00.000Z'
    && appointmentCount(raced) === 2,
  'G y H la solicitud perdedora no crea otra Programada ni fusiona la entrevista',
);
check(
  slotMigration.includes('WHERE "eventType" = \'SCHEDULED\''),
  'L el índice parcial sigue siendo la última defensa',
);
const formClash = memoryDb();
const formClashApp = openApp(formClash, { id: 'app-form-clash' });
await oldForm(formClash, 'app-form-clash', new Date('2026-11-15T16:00:00.000Z'));
await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-form-clash', createdByUserId: 'user-1',
  interviewDate: '2026-11-20', interviewTime: '10:00', label: 'Independiente',
  timeZone: TZ, now: clock, db: formClash,
});
let formClashCode = null;
let formClashMessage = null;
try {
  await oldForm(formClash, 'app-form-clash', new Date('2026-11-20T16:00:00.000Z'));
} catch (err) {
  formClashCode = err.code;
  formClashMessage = err.message;
}
check(
  formClashCode === 'CONFLICT'
    && formClashMessage === INTERVIEW_SLOT_TAKEN_MESSAGE
    && formClash.events.filter((row) => row.eventType === 'SCHEDULED').length === 2
    && formClash.events.filter((row) => row.eventType === 'RESCHEDULED').length === 0
    && formClashApp.interviewScheduledAt.toISOString() === '2026-11-15T16:00:00.000Z'
    && appointmentCount(formClash) === 2,
  'el formulario anterior tampoco fusiona dos entrevistas independientes',
);

const editDb = memoryDb();
const editApp = openApp(editDb, { id: 'app-edit' });
const editNow = new Date('2026-11-09T18:00:00.000Z');
const editable = await scheduleRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-edit', createdByUserId: 'user-1',
  interviewDate: '2026-11-12', interviewTime: '10:30', label: 'Inicial', comment: 'Nota',
  timeZone: TZ, now: editNow, db: editDb,
});
const renamed = await updateRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-edit', eventId: editable.interview.id,
  action: 'EDIT', createdByUserId: 'user-1', label: '3ª Entrevista con Dirección',
  comment: 'Validar disponibilidad', interviewDate: '2026-11-12', interviewTime: '10:30',
  timeZone: TZ, now: editNow, db: editDb,
});
check(
  renamed.alreadyApplied === false
    && renamed.interview.id === editable.interview.id
    && renamed.interview.eventType === 'SCHEDULED'
    && renamed.interview.label === '3ª Entrevista con Dirección'
    && renamed.interview.comment === 'Validar disponibilidad'
    && editDb.events.length === 1
    && appointmentCount(editDb) === 1,
  'C editar nombre o comentario conserva la misma Programada y N',
);
const unchangedEdit = await updateRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-edit', eventId: editable.interview.id,
  action: 'EDIT', createdByUserId: 'user-1', label: '3ª Entrevista con Dirección',
  comment: 'Validar disponibilidad', interviewDate: '2026-11-12', interviewTime: '10:30',
  timeZone: TZ, now: editNow, db: editDb,
});
check(unchangedEdit.alreadyApplied === true && editDb.events.length === 1, 'E guardar los mismos valores es no-op');
const shifted = await updateRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-edit', eventId: editable.interview.id,
  action: 'EDIT', createdByUserId: 'user-1', label: '3ª Entrevista con Dirección',
  comment: 'Nuevo comentario', interviewDate: '2026-11-18', interviewTime: '11:00',
  timeZone: TZ, now: editNow, db: editDb,
});
check(
  shifted.interview.eventType === 'SCHEDULED'
    && shifted.interview.id !== editable.interview.id
    && shifted.interview.comment === 'Nuevo comentario'
    && editDb.events.find((row) => row.id === editable.interview.id).eventType === 'RESCHEDULED'
    && editDb.events.find((row) => row.id === editable.interview.id).comment === 'Validar disponibilidad'
    && editDb.events.filter((row) => row.eventType === 'SCHEDULED').length === 1
    && appointmentCount(editDb) === 1,
  'D editar fecha u hora reprograma y N no aumenta',
);
await updateRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-edit', eventId: shifted.interview.id,
  action: 'ATTENDED', createdByUserId: 'user-1', timeZone: TZ, now: editNow, db: editDb,
});
let terminalCode = null;
try {
  await updateRecruitmentApplicationInterview({
    organizationId: 'org-1', applicationId: 'app-edit', eventId: shifted.interview.id,
    action: 'EDIT', createdByUserId: 'user-1', interviewDate: '2026-11-19', interviewTime: '09:00',
    timeZone: TZ, now: editNow, db: editDb,
  });
} catch (err) {
  terminalCode = err.code;
}
const commented = await updateRecruitmentApplicationInterview({
  organizationId: 'org-1', applicationId: 'app-edit', eventId: shifted.interview.id,
  action: 'COMMENT', createdByUserId: 'user-1', comment: 'Solo el comentario',
  timeZone: TZ, now: editNow, db: editDb,
});
let terminalLabelCode = null;
try {
  await updateRecruitmentApplicationInterview({
    organizationId: 'org-1', applicationId: 'app-edit', eventId: shifted.interview.id,
    action: 'COMMENT', createdByUserId: 'user-1', label: 'Otro nombre',
    timeZone: TZ, now: editNow, db: editDb,
  });
} catch (err) {
  terminalLabelCode = err.code;
}
check(
  terminalCode === 'CONFLICT'
    && commented.interview.eventType === 'ATTENDED'
    && commented.interview.comment === 'Solo el comentario'
    && terminalLabelCode === 'CONFLICT'
    && editDb.events.filter((row) => row.eventType === 'SCHEDULED').length === 0,
  'F un estado terminal no cambia fecha, hora ni nombre',
);
editApp.stage.key = 'HIRED';
editApp.closureOutcome = 'HIRED';
let closedCode = null;
try {
  await updateRecruitmentApplicationInterview({
    organizationId: 'org-1', applicationId: 'app-edit', eventId: shifted.interview.id,
    action: 'COMMENT', createdByUserId: 'user-1', comment: 'No debe guardarse',
    timeZone: TZ, now: editNow, db: editDb,
  });
} catch (err) {
  closedCode = err.code;
}
editApp.stage.key = 'CONTACT';
editApp.closureOutcome = null;
editApp.candidate.archivedAt = new Date('2026-11-09T18:00:00.000Z');
let archivedEditCode = null;
try {
  await updateRecruitmentApplicationInterview({
    organizationId: 'org-1', applicationId: 'app-edit', eventId: shifted.interview.id,
    action: 'COMMENT', createdByUserId: 'user-1', comment: 'Tampoco',
    timeZone: TZ, now: editNow, db: editDb,
  });
} catch (err) {
  archivedEditCode = err.code;
}
check(
  closedCode === 'CONFLICT'
    && archivedEditCode === 'CONFLICT'
    && editDb.events.find((row) => row.id === shifted.interview.id).comment === 'Solo el comentario',
  'G un proceso cerrado o un candidato archivado queda en solo lectura',
);

function chromePath() {
  return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((item) => fs.existsSync(item)) || null;
}

const executablePath = chromePath();
if (!executablePath) {
  console.log('  SKIP  Chrome o Edge no está disponible para el bloque visual');
} else {
  const puppeteer = await import('puppeteer-core');
  const browser = await puppeteer.default.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(indexHtml);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const xss = '<script>alert(1)</script>';
  const interviews = [
    { id: 'n1', eventType: 'SCHEDULED', scheduledAt: '2027-11-12T16:30:00.000Z', scheduledTimeSpecified: true, label: 'Entrevista con supervisor', comment: null, stageName: 'Contacto' },
    { id: 'n2', eventType: 'NO_SHOW', scheduledAt: '2026-11-09T22:00:00.000Z', scheduledTimeSpecified: true, label: 'Entrevista inicial', comment: 'No confirmó su asistencia.', stageName: 'Contacto' },
    { id: 'n3', eventType: 'ATTENDED', scheduledAt: '2026-11-08T18:00:00.000Z', scheduledTimeSpecified: true, label: `Nombre ${'largo '.repeat(20)}`, comment: `${'comentario '.repeat(40)}${xss}`, stageName: 'Contacto' },
    { id: 'n4', eventType: 'CANCELLED', scheduledAt: '2026-11-07T17:00:00.000Z', scheduledTimeSpecified: true, label: 'Entrevista cancelada', comment: null, stageName: 'Contacto' },
    { id: 'n5', eventType: 'RESCHEDULED', scheduledAt: '2026-11-06T15:00:00.000Z', scheduledTimeSpecified: true, label: 'Entrevista reprogramada', comment: 'Pasó al día 12', stageName: 'Contacto' },
  ];
  for (const width of [1280, 900, 390]) {
    await page.setViewport({ width, height: 800 });
    const view = await page.evaluate(async (payload) => {
      const host = document.createElement('div');
      host.id = 'interview-host';
      host.style.width = '100%';
      document.body.appendChild(host);
      const previous = document.getElementById('interview-host');
      if (previous && previous !== host) previous.remove();
      const app = {
        applicationId: 'app-visual',
        closureOutcome: null,
        stage: { key: 'CONTACT', name: 'Contacto' },
        interviews: payload.interviews,
      };
      const st = recEnsureState();
      st.detailCandidate = { id: 'cand-visual', archivedAt: null, applications: [app] };
      st.recruitmentOrgTimeZone = 'America/Mexico_City';
      host.innerHTML = recCandInterviewsBlockHtml(app);
      const toggle = host.querySelector('.rec-cand-interviews-toggle');
      toggle.focus();
      toggle.click();
      const list = host.querySelector('.rec-cand-interviews-list');
      const text = host.textContent;
      const listHeight = list.getBoundingClientRect().height;
      const row = host.querySelector('.rec-cand-interview-row');
      row.focus();
      row.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const dialog = document.querySelector('.rec-cand-interview-detail');
      const listHeightAfter = list.getBoundingClientRect().height;
      const buttons = dialog ? [...dialog.querySelectorAll('button')] : [];
      const unstyled = buttons.filter((button) => !/(^|\s)(rec-|form-)/.test(button.className || ''));
      const before = document.activeElement;
      const focusedInside = !!(before && before.isConnected && before.closest('#rec-iv-overlay'));
      const dialogWidth = dialog && dialog.querySelector('.rec-iv-dialog')
        ? dialog.querySelector('.rec-iv-dialog').getBoundingClientRect().width
        : 0;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return {
        scripts: document.querySelectorAll('#rec-iv-overlay script, #interview-host script').length,
        expanded: toggle.getAttribute('aria-expanded'),
        hasNext: text.includes('Entrevistas · 4') && text.includes('Próxima:'),
        commentStaysOut: !text.includes('No confirmó su asistencia.'),
        noEmpty: !text.includes('Sin comentarios') && !text.includes('—'),
        schedule: !!host.querySelector('.rec-cand-interviews-add'),
        sectionWidth: host.scrollWidth - host.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - payload.width,
        detailInside: !!list.querySelector('.rec-cand-interview-detail, textarea, form'),
        listStable: Math.abs(listHeightAfter - listHeight) < 1,
        unstyled: unstyled.length,
        buttonCount: buttons.length,
        dialogWidth,
        detailHidden: !!(dialog && dialog.classList.contains('hidden')),
        focusBack: document.activeElement === row,
        focusedInside,
      };
    }, { interviews, width });
    check(view.scripts === 0 && view.noEmpty && view.commentStaysOut, `O a ${width}px el comentario no se vuelca en la lista`);
    check(view.expanded === 'true' && view.hasNext && view.schedule, `el bloque a ${width}px separa el contador y conserva Programar otra`);
    check(view.sectionWidth <= 1 && view.pageOverflow <= 1 && view.dialogWidth > 0 && view.dialogWidth <= 640, `N a ${width}px no hay desborde`);
    check(view.listStable && !view.detailInside && view.unstyled === 0 && view.buttonCount > 0, `A y B a ${width}px el detalle es un diálogo con botones del sistema`);
    check(view.detailHidden && view.focusBack && view.focusedInside, `L Escape a ${width}px cierra el detalle y devuelve el foco`);
  }
  const many = await page.evaluate(() => {
    const host = document.getElementById('interview-host');
    const extra = Array.from({ length: 10 }, (_, index) => ({
      id: `x${index}`,
      eventType: index === 0 ? 'SCHEDULED' : 'ATTENDED',
      scheduledAt: new Date(Date.UTC(2026, 10, 20 - index, 16, 0)).toISOString(),
      scheduledTimeSpecified: true,
      label: `Entrevista ${index + 1}`,
      comment: index % 2 ? null : 'Nota breve',
      stageName: 'Contacto',
    }));
    host.innerHTML = recCandInterviewsBlockHtml({
      applicationId: 'app-visual',
      closureOutcome: null,
      stage: { key: 'CONTACT', name: 'Contacto' },
      interviews: extra,
    });
    host.querySelector('.rec-cand-interviews-toggle').click();
    const list = host.querySelector('.rec-cand-interviews-list');
    const closed = recCandInterviewsBlockHtml({
      applicationId: 'app-closed',
      closureOutcome: 'HIRED',
      stage: { key: 'HIRED', name: 'Contratado' },
      interviews: extra,
    }, { readonly: true });
    const closedHost = document.createElement('div');
    closedHost.innerHTML = closed;
    return {
      count: host.textContent.includes('Entrevistas · 10'),
      scrolls: list.scrollHeight > list.clientHeight,
      bounded: list.clientHeight <= 180,
      closedSchedule: closedHost.querySelectorAll('.rec-cand-interviews-add').length,
      closedRows: closedHost.querySelectorAll('button.rec-cand-interview-row').length,
      closedText: closedHost.textContent.includes('Entrevistas · 10'),
    };
  });
  check(many.count && many.scrolls && many.bounded, 'diez entrevistas usan scroll interno y no crecen sin límite');
  check(many.closedSchedule === 0 && many.closedRows > 0 && many.closedText, 'G el historial cerrado no ofrece programar otra');

  const abort = await page.evaluate(async () => {
    const err = document.createElement('p');
    err.id = 'rec-cand-detail-op-err';
    document.body.appendChild(err);
    apiJson = () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    };
    const target = {
      date: { value: '2026-11-12' },
      time: { value: '10:30' },
      label: { value: '' },
      comment: { value: '' },
    };
    await recCandScheduleInterview({ preventDefault() {}, target }, 'app-visual');
    const abortText = err.textContent;
    let release;
    apiJson = () => new Promise((resolve) => { release = resolve; });
    const pending = recCandScheduleInterview({ preventDefault() {}, target }, 'app-visual');
    recCandInterviewEpoch += 1;
    release({});
    await pending;
    return { abortText, epoch: recCandInterviewEpoch };
  });
  const chainView = await page.evaluate(() => {
    const host = document.getElementById('interview-host');
    const chainApp = {
      applicationId: 'app-chain',
      closureOutcome: null,
      stage: { key: 'CONTACT', name: 'Contacto' },
      interviews: [
        {
          id: 'old', eventType: 'RESCHEDULED', scheduledAt: '2026-11-15T16:00:00.000Z',
          scheduledTimeSpecified: true, label: 'Entrevista inicial', comment: 'Se movió', stageName: 'Contacto',
        },
        {
          id: 'new', eventType: 'SCHEDULED', scheduledAt: '2026-11-18T16:00:00.000Z',
          scheduledTimeSpecified: true, label: 'Entrevista inicial', comment: null, stageName: 'Contacto',
        },
      ],
    };
    host.innerHTML = recCandInterviewsBlockHtml(chainApp);
    const st = recEnsureState();
    st.detailCandidate = { id: 'cand-chain', archivedAt: null, applications: [chainApp] };
    host.querySelector('.rec-cand-interviews-toggle').click();
    const history = host.querySelector('.rec-cand-interview-row--history');
    history.click();
    const dialogText = document.querySelector('.rec-iv-dialog').textContent;
    const scheduled = host.querySelector('.rec-cand-interview-status--scheduled');
    return {
      count: host.textContent.includes('Entrevistas · 1'),
      history: !!history && history.textContent.includes('Reprogramada') && !!history.querySelector('.rec-cand-interview-has-note'),
      moved: dialogText.includes('Se movió') && !dialogText.includes('<'),
      scheduled: !!scheduled && scheduled.textContent.includes('Programada'),
      comments: host.querySelectorAll('.rec-cand-interview-comment').length,
    };
  });
  check(
    chainView.count && chainView.history && chainView.moved && chainView.scheduled && chainView.comments === 0,
    'Q una reprogramación se ve como antecedente y el encabezado queda en 1',
  );
  const dialogFlow = await page.evaluate(async () => {
    const host = document.getElementById('interview-host');
    const xss = '<script>alert(1)</script>';
    const app = {
      applicationId: 'app-visual',
      closureOutcome: null,
      stage: { key: 'CONTACT', name: 'Contacto' },
      interviews: [
        { id: 'n1', eventType: 'SCHEDULED', scheduledAt: '2027-11-12T16:30:00.000Z', scheduledTimeSpecified: true, label: 'Primera cita', comment: null, stageName: 'Contacto' },
        { id: 'n2', eventType: 'SCHEDULED', scheduledAt: '2027-11-20T16:00:00.000Z', scheduledTimeSpecified: true, label: 'Segunda cita', comment: `${'comentario '.repeat(40)}${xss}`, stageName: 'Contacto' },
      ],
    };
    host.innerHTML = recCandInterviewsBlockHtml(app);
    recEnsureState().detailCandidate = { id: 'cand-visual', archivedAt: null, applications: [app] };
    host.querySelector('.rec-cand-interviews-toggle').click();
    const rows = [...host.querySelectorAll('.rec-cand-interview-row')];
    rows[1].click();
    const safeDialog = document.querySelector('.rec-iv-dialog');
    const safeText = safeDialog.textContent.includes('alert(1)');
    const safeEscaped = safeDialog.innerHTML.includes('&lt;script');
    const safeScripts = document.querySelectorAll('#rec-iv-overlay script').length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    let calls = 0;
    apiJson = () => {
      calls += 1;
      return Promise.reject(Object.assign(
        new Error('Ya existe una entrevista programada en ese horario para este proceso.'),
        { code: 'CONFLICT', httpStatus: 409 },
      ));
    };
    host.querySelector('.rec-cand-interviews-add').click();
    const form = document.getElementById('rec-iv-form');
    form.label.value = 'Conservar';
    form.date.value = '2027-11-21';
    form.time.value = '09:15';
    form.comment.value = '<b>seguro</b>';
    await recCandScheduleInterview({ preventDefault() {}, target: form }, 'app-visual');
    const overlay = document.getElementById('rec-iv-overlay');
    const conflict = {
      open: overlay && !overlay.classList.contains('hidden'),
      message: document.getElementById('rec-iv-error').textContent,
      label: form.label.value,
      date: form.date.value,
      time: form.time.value,
      comment: form.comment.value,
    };
    calls = 0;
    apiJson = () => {
      calls += 1;
      return new Promise(() => {});
    };
    const first = recCandScheduleInterview({ preventDefault() {}, target: form }, 'app-visual');
    const second = recCandScheduleInterview({ preventDefault() {}, target: form }, 'app-visual');
    await Promise.resolve();
    let release;
    apiJson = () => new Promise((resolve) => { release = resolve; });
    rows[0].click();
    const pending = recCandInterviewAction('app-visual', 'n1', 'COMMENT', { comment: 'tarde' });
    rows[1].click();
    release({});
    await pending;
    const dialog = document.querySelector('.rec-iv-dialog');
    return {
      safeText: safeText && safeEscaped,
      safeScripts,
      conflict,
      calls,
      firstPending: !!first,
      secondPending: !!second,
      staleOpen: overlay && !overlay.classList.contains('hidden'),
      showsSecond: dialog.textContent.includes('Segunda cita'),
      hidesFirst: !dialog.textContent.includes('Primera cita'),
    };
  });
  check(dialogFlow.safeText && dialogFlow.safeScripts === 0, 'O un comentario largo con HTML se muestra como texto');
  check(
    dialogFlow.conflict.open
      && dialogFlow.conflict.message === 'Ya existe una entrevista programada en ese horario para este proceso.'
      && dialogFlow.conflict.label === 'Conservar'
      && dialogFlow.conflict.date === '2027-11-21'
      && dialogFlow.conflict.time === '09:15'
      && dialogFlow.conflict.comment === '<b>seguro</b>',
    'H e I el 409 permanece en el diálogo y conserva los campos',
  );
  check(dialogFlow.calls === 1, 'J un doble clic no envía dos solicitudes');
  check(dialogFlow.staleOpen && dialogFlow.showsSecond && dialogFlow.hidesFirst, 'M una respuesta vieja no pisa la entrevista recién abierta');
  check(abort.abortText === '', 'AbortError no muestra fallo');
  check(abort.epoch > 0, 'una respuesta vieja queda descartada');
  check(pageErrors.length === 0, pageErrors.length ? `errores de página: ${pageErrors[0]}` : 'la página no lanza errores');
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (failed) {
  console.error(`\n${failed} comprobaciones de entrevistas fallaron\n`);
  process.exit(1);
}
console.log('\nEntrevistas múltiples en orden\n');

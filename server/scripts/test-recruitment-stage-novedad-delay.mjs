/**
 * Espera de dos horas para la novedad de cambio de etapa.
 * node server/scripts/test-recruitment-stage-novedad-delay.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(serverDir, '..');
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'stage-novedad-delay-test';
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';

const {
  armManualStageNovedadWait,
  cancelOpenStageNovedadWaits,
  deliverDueRecruitmentStageNovedades,
  runRecruitmentStageNovedadSweepTick,
  stageNovedadEligibleAt,
  STAGE_NOVEDAD_DELAY_MS,
} = await import('../src/services/workforceRecruitmentNovedad.service.js');
const { shouldRecordStageEvent } = await import('../src/services/recruitmentCoverage.service.js');

const schema = fs.readFileSync(path.join(serverDir, 'prisma/schema.prisma'), 'utf8');
const migration = fs.readFileSync(
  path.join(serverDir, 'prisma/migrations/20261109020000_recruitment_stage_novedad_wait/migration.sql'),
  'utf8',
);
const appSvc = fs.readFileSync(path.join(serverDir, 'src/services/recruitmentApplication.service.js'), 'utf8');
const novedadSvc = fs.readFileSync(path.join(serverDir, 'src/services/workforceRecruitmentNovedad.service.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(serverDir, 'src/server.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function matchWhere(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'AND') return expected.every((part) => matchWhere(row, part));
    if (key === 'OR') return expected.some((part) => matchWhere(row, part));
    const value = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('not' in expected) {
        if (expected.not === null) return value != null;
        if (expected.not && typeof expected.not === 'object' && !(expected.not instanceof Date)) {
          return !matchWhere({ [key]: value }, { [key]: expected.not });
        }
        return value !== expected.not;
      }
      if ('lte' in expected) return value != null && value <= expected.lte;
      if ('gt' in expected) return value != null && value > expected.gt;
      return true;
    }
    return value === expected;
  });
}

function createMemoryDb() {
  const store = { events: [], apps: [], novedades: [], employees: [], stages: [], failCreates: 0 };
  const tables = {
    recruitmentApplicationStageEvent: 'events',
    recruitmentApplication: 'apps',
    workforceRecruitmentNovedad: 'novedades',
    workforceEmployee: 'employees',
    recruitmentStage: 'stages',
  };
  function tableApi(name) {
    const key = tables[name];
    return {
      async findFirst({ where } = {}) {
        if (store.pendingThrow) {
          store.pendingThrow = false;
          const err = new Error('fail before create');
          err.code = 'DB_DOWN';
          throw err;
        }
        return store[key].find((row) => matchWhere(row, where)) || null;
      },
      async findMany({ where, take } = {}) {
        const rows = store[key].filter((row) => matchWhere(row, where));
        return take ? rows.slice(0, take) : rows;
      },
      async create({ data }) {
        if (store.pendingThrow) {
          store.pendingThrow = false;
          const err = new Error('fail before create');
          err.code = 'DB_DOWN';
          throw err;
        }
        if (name === 'workforceRecruitmentNovedad' && store.failCreateIds?.has(data.dedupeKey)) {
          store.failCreateIds.delete(data.dedupeKey);
          const err = new Error('db down');
          err.code = 'DB_DOWN';
          throw err;
        }
        if (name === 'workforceRecruitmentNovedad' && store.failCreates > 0) {
          store.failCreates -= 1;
          const err = new Error('db down');
          err.code = 'DB_DOWN';
          throw err;
        }
        if (name === 'workforceRecruitmentNovedad') {
          const dup = store.novedades.some(
            (row) => row.organizationId === data.organizationId && row.dedupeKey === data.dedupeKey,
          );
          if (dup) {
            const err = new Error('unique');
            err.code = 'P2002';
            err.meta = { target: ['organizationId', 'dedupeKey'] };
            throw err;
          }
        }
        const row = { id: data.id || `${name}-${store[key].length + 1}`, ...data };
        store[key].push(row);
        return row;
      },
      async update({ where, data }) {
        const row = store[key].find((item) => item.id === where.id);
        if (!row) return null;
        Object.assign(row, data);
        return row;
      },
      async updateMany({ where, data }) {
        const rows = store[key].filter((row) => matchWhere(row, where));
        rows.forEach((row) => Object.assign(row, data));
        if (data && Object.prototype.hasOwnProperty.call(data, 'novedadNotifiedAt') && data.novedadNotifiedAt && store.failAfterReserve) {
          store.failAfterReserve = false;
          store.pendingThrow = true;
        }
        return { count: rows.length };
      },
    };
  }
  const db = {
    store,
    $transaction: async (fn) => {
      const eventSnap = store.events.map((row) => ({
        id: row.id,
        novedadEligibleAt: row.novedadEligibleAt,
        novedadNotifiedAt: row.novedadNotifiedAt,
      }));
      const eventIds = new Set(store.events.map((row) => row.id));
      const novedadIds = new Set(store.novedades.map((row) => row.id));
      try {
        return await fn(db);
      } catch (err) {
        for (const snap of eventSnap) {
          const row = store.events.find((item) => item.id === snap.id);
          if (!row) continue;
          row.novedadEligibleAt = snap.novedadEligibleAt;
          row.novedadNotifiedAt = snap.novedadNotifiedAt;
        }
        store.events = store.events.filter((row) => eventIds.has(row.id));
        store.novedades = store.novedades.filter((row) => novedadIds.has(row.id));
        throw err;
      }
    },
  };
  for (const name of Object.keys(tables)) db[name] = tableApi(name);
  return db;
}

function seedWorld(db, { orgId = 'org-a', stageId = 'stage-final', fromStageId = 'stage-new', archivedAt = null, active = true, fullName = 'Ana' } = {}) {
  const app = {
    id: 'app-1',
    organizationId: orgId,
    stageId,
    candidateId: 'cand-1',
    vacancyId: 'vac-1',
    candidate: {
      id: 'cand-1',
      organizationId: orgId,
      fullName,
      registeredByWorkforceEmployeeId: 'emp-1',
      archivedAt,
    },
    vacancy: { id: 'vac-1', organizationId: orgId, title: 'Ventas' },
  };
  db.store.apps.push(app);
  db.store.employees.push({ id: 'emp-1', organizationId: orgId, isActive: active });
  db.store.stages.push(
    { id: fromStageId, organizationId: orgId, key: 'NEW', name: 'Nuevo' },
    { id: stageId, organizationId: orgId, key: 'FINALIST', name: 'Finalista' },
  );
  return app;
}

async function addEvent(db, fields) {
  const row = {
    id: fields.id,
    organizationId: 'org-a',
    applicationId: 'app-1',
    fromStageId: 'stage-new',
    toStageId: 'stage-final',
    changedByUserId: 'user-1',
    createdAt: fields.createdAt || new Date('2026-11-08T16:00:00.000Z'),
    novedadEligibleAt: null,
    novedadNotifiedAt: null,
    ...fields,
  };
  db.store.events.push(row);
  return row;
}

console.log('\n=== Espera de novedad de etapa ===\n');

check(STAGE_NOVEDAD_DELAY_MS === 2 * 60 * 60 * 1000, 'espera de dos horas');
check(/novedadEligibleAt\s+DateTime\?/.test(schema) && /novedadNotifiedAt\s+DateTime\?/.test(schema), 'columnas anulables');
check(!/DEFAULT/i.test(migration) && !/UPDATE/i.test(migration), 'migración sin backfill ni default');
check(!/20\d{2}-\d{2}-\d{2}/.test(novedadSvc), 'sin fecha fija en el servicio');
check(/startRecruitmentStageNovedadSweep\(/.test(serverJs), 'scheduler arranca con el servidor');
check(/stageNovedadRunning/.test(novedadSvc) && /\.unref\(/.test(novedadSvc), 'un barrido por proceso y unref');
check(!/setTimeout\(/.test(novedadSvc), 'sin temporizador por candidato');
check((appSvc.match(/scheduleNovedad: true/g) || []).length === 1, 'el alta no arma espera');
check(/tcEsc\(n\.message\)/.test(indexHtml), 'el mensaje se escapa en la interfaz');
check(/cambió a la etapa \$\{stage\} en \$\{vacancy\}/.test(novedadSvc), 'copy neutro del cambio de etapa');
check(/llegó a contratación en \$\{vacancy\}/.test(novedadSvc), 'copy neutro de contratación');
check(/salió del proceso \$\{vacancy\}/.test(novedadSvc), 'copy neutro de salida del proceso');
check(/const STAGE_NOVEDAD_SWEEP_MS = 5 \* 60 \* 1000/.test(novedadSvc), 'intervalo de cinco minutos');
check(/if \(stageNovedadTimer\) return/.test(novedadSvc), 'el scheduler arranca una vez por proceso');
check(/stageNovedadRunning = false/.test(novedadSvc), 'la bandera se libera al terminar');
check(/\$transaction\(\(tx\) => deliverOneStageNovedad/.test(novedadSvc), 'reserva y creación van en una transacción');
const deliverFn = novedadSvc.slice(
  novedadSvc.indexOf('async function deliverOneStageNovedad'),
  novedadSvc.indexOf('export async function deliverDueRecruitmentStageNovedades'),
);
check(deliverFn.includes('updateMany') && !deliverFn.includes('$transaction'), 'la entrega no abre otra transacción');
check(/if \(armWait\) await cancelOpenStageNovedadWaits/.test(appSvc), 'el PATCH cancela el pendiente anterior');
check(/novedadEligibleAt: armWait \? stageNovedadEligibleAt\(movedAt\) : null/.test(appSvc), 'el evento nuevo nace con la espera');
check(/stageId: existing\.stageId/.test(appSvc), 'el PATCH conserva la protección concurrente');
check(shouldRecordStageEvent({ stageChanged: false, updatedCount: 1 }) === false, 'repetir la etapa no reinicia el reloj');

const t0 = new Date('2026-11-08T16:00:00.000Z');
const hour = 60 * 60 * 1000;

{
  const db = createMemoryDb();
  seedWorld(db);
  const event = await addEvent(db, { id: 'ev-short', createdAt: t0 });
  await armManualStageNovedadWait(db, event, t0);
  const early = await deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + hour), db });
  check(early.sent === 0 && db.store.novedades.length === 0, '1 permanencia menor a dos horas sin aviso');
  const due = await deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + 2 * hour), db });
  check(due.sent === 1 && db.store.novedades.length === 1, '2 permanencia de dos horas, un aviso');
  check(db.store.novedades[0].message === 'Ana cambió a la etapa Finalista en Ventas.', 'mensaje de la etapa estable');
  check(db.store.events[0].novedadNotifiedAt != null, 'el movimiento queda marcado como avisado');
  const again = await deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + 3 * hour), db });
  check(again.sent === 0 && db.store.novedades.length === 1, '2 un segundo barrido no duplica');
}

{
  const db = createMemoryDb();
  seedWorld(db, { stageId: 'stage-hired' });
  db.store.stages.push({ id: 'stage-interview', organizationId: 'org-a', key: 'INITIAL_INTERVIEW', name: 'Entrevista' });
  const first = await addEvent(db, { id: 'ev-1', toStageId: 'stage-interview', createdAt: t0 });
  const second = await addEvent(db, { id: 'ev-2', fromStageId: 'stage-interview', toStageId: 'stage-final', createdAt: new Date(t0.getTime() + 10 * 60 * 1000) });
  const third = await addEvent(db, { id: 'ev-3', fromStageId: 'stage-final', toStageId: 'stage-hired', createdAt: new Date(t0.getTime() + 20 * 60 * 1000) });
  db.store.apps[0].stageId = 'stage-hired';
  db.store.stages.find((s) => s.id === 'stage-hired').key = 'HIRED';
  db.store.stages.find((s) => s.id === 'stage-hired').name = 'Contratado';
  await armManualStageNovedadWait(db, first, first.createdAt);
  await armManualStageNovedadWait(db, second, second.createdAt);
  await armManualStageNovedadWait(db, third, third.createdAt);
  check(first.novedadEligibleAt == null && second.novedadEligibleAt == null && third.novedadEligibleAt != null, '3 solo queda pendiente la última etapa');
  await deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + 3 * hour), db });
  check(db.store.novedades.length === 1 && db.store.novedades[0].dedupeKey === 'ev-3', '3 se avisa solo la etapa estable');
}

{
  const db = createMemoryDb();
  seedWorld(db, { stageId: 'stage-new' });
  const gone = await addEvent(db, { id: 'ev-gone', toStageId: 'stage-final', createdAt: t0 });
  const back = await addEvent(db, { id: 'ev-back', fromStageId: 'stage-final', toStageId: 'stage-new', createdAt: new Date(t0.getTime() + 15 * 60 * 1000) });
  await armManualStageNovedadWait(db, gone, gone.createdAt);
  await armManualStageNovedadWait(db, back, back.createdAt);
  await deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + 30 * 60 * 1000), db });
  check(db.store.novedades.length === 0 && gone.novedadEligibleAt == null, '4 el pendiente anterior no se entrega');
  await deliverDueRecruitmentStageNovedades({ now: new Date(back.createdAt.getTime() + 2 * hour), db });
  check(db.store.novedades.length === 1 && db.store.novedades[0].dedupeKey === 'ev-back', '4 se avisa el regreso cuando se estabiliza');
}

{
  const db = createMemoryDb();
  seedWorld(db);
  const event = await addEvent(db, { id: 'ev-race', createdAt: t0 });
  event.novedadEligibleAt = new Date(t0.getTime() + 2 * hour);
  await Promise.all([
    deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + 2 * hour), db }),
    deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + 2 * hour), db }),
  ]);
  await deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + 3 * hour), db });
  check(db.store.novedades.length === 1, '5 dos barridos producen un solo aviso');
  check(db.store.novedades[0].dedupeKey === 'ev-race', '5 la clave es el id del movimiento');
}

{
  const db = createMemoryDb();
  seedWorld(db);
  const event = await addEvent(db, { id: 'ev-restart', createdAt: t0 });
  await armManualStageNovedadWait(db, event, t0);
  const reloaded = createMemoryDb();
  reloaded.store.events = db.store.events;
  reloaded.store.apps = db.store.apps;
  reloaded.store.employees = db.store.employees;
  reloaded.store.stages = db.store.stages;
  const due = await deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + 2 * hour), db: reloaded });
  check(due.sent === 1, '6 el pendiente sobrevive sin temporizador en memoria');
}

{
  const db = createMemoryDb();
  seedWorld(db);
  await addEvent(db, { id: 'ev-old', createdAt: new Date('2020-01-01T00:00:00.000Z'), novedadEligibleAt: null });
  const result = await deliverDueRecruitmentStageNovedades({ now: new Date('2026-11-09T00:00:00.000Z'), db });
  check(result.scanned === 0 && db.store.novedades.length === 0, '7 un evento histórico no genera aviso');
}

{
  const db = createMemoryDb();
  const initial = await addEvent(db, { id: 'ev-initial', fromStageId: null, toStageId: 'stage-new', createdAt: t0 });
  const armed = await armManualStageNovedadWait(db, initial, t0);
  check(armed == null && initial.novedadEligibleAt == null, '8 la etapa inicial no arma aviso de movimiento');
}

{
  const db = createMemoryDb();
  seedWorld(db);
  const missing = await addEvent(db, { id: 'ev-missing', applicationId: 'app-missing', createdAt: t0 });
  missing.novedadEligibleAt = new Date(t0.getTime() + 2 * hour);
  await deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + 2 * hour), db });
  check(db.store.novedades.length === 0 && missing.novedadEligibleAt == null && missing.novedadNotifiedAt == null, '9 postulación inexistente no avisa');

  const archivedDb = createMemoryDb();
  seedWorld(archivedDb, { archivedAt: t0 });
  const archived = await addEvent(archivedDb, { id: 'ev-arch', createdAt: t0 });
  archived.novedadEligibleAt = new Date(t0.getTime() + 2 * hour);
  await deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + 2 * hour), db: archivedDb });
  check(archivedDb.store.novedades.length === 0 && archived.novedadNotifiedAt == null, '9 candidato archivado no avisa');
}

{
  const db = createMemoryDb();
  seedWorld(db, { orgId: 'org-b' });
  const event = await addEvent(db, { id: 'ev-org', organizationId: 'org-a', createdAt: t0 });
  event.novedadEligibleAt = new Date(t0.getTime() + 2 * hour);
  await deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + 2 * hour), db });
  check(db.store.novedades.length === 0, '10 otra organización no recibe el aviso');
}

{
  const db = createMemoryDb();
  seedWorld(db, { active: false });
  const event = await addEvent(db, { id: 'ev-recipient', createdAt: t0 });
  event.novedadEligibleAt = new Date(t0.getTime() + 2 * hour);
  await deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + 2 * hour), db });
  check(db.store.novedades.length === 0 && event.novedadNotifiedAt == null, '11 destinatario inactivo no recibe aviso');
}

{
  const db = createMemoryDb();
  seedWorld(db, { fullName: '<img src=x onerror=alert(1)>' });
  const event = await addEvent(db, { id: 'ev-html', createdAt: t0 });
  event.novedadEligibleAt = new Date(t0.getTime() + 2 * hour);
  await deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + 2 * hour), db });
  const message = db.store.novedades[0]?.message || '';
  const escaped = message.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  check(message.includes('<img') && escaped.includes('&lt;img') && !escaped.includes('<img'), '12 el nombre hostil queda como texto');
}

{
  const db = createMemoryDb();
  seedWorld(db);
  const event = await addEvent(db, { id: 'ev-db', createdAt: t0 });
  event.novedadEligibleAt = new Date(t0.getTime() + 2 * hour);
  db.store.failCreates = 1;
  await deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + 2 * hour), db });
  check(db.store.novedades.length === 0 && event.novedadNotifiedAt == null && event.novedadEligibleAt != null, '13 un error de base no marca el aviso como enviado');
}

{
  const db = createMemoryDb();
  seedWorld(db, { stageId: 'stage-final' });
  db.store.stages.push({ id: 'stage-interview', organizationId: 'org-a', key: 'INITIAL_INTERVIEW', name: 'Entrevista' });
  const first = await addEvent(db, { id: 'ev-a', toStageId: 'stage-final', createdAt: t0 });
  await armManualStageNovedadWait(db, first, t0);
  await deliverDueRecruitmentStageNovedades({ now: new Date(t0.getTime() + 2 * hour), db });
  db.store.apps[0].stageId = 'stage-interview';
  const later = await addEvent(db, {
    id: 'ev-b',
    fromStageId: 'stage-final',
    toStageId: 'stage-interview',
    createdAt: new Date(t0.getTime() + 3 * hour),
  });
  await armManualStageNovedadWait(db, later, later.createdAt);
  await deliverDueRecruitmentStageNovedades({ now: new Date(later.createdAt.getTime() + 2 * hour), db });
  check(db.store.novedades.length === 2, '14 un movimiento posterior puede avisar por su cuenta');
  check(db.store.events.length === 2, '14 el historial de movimientos se conserva');
}

{
  let started = 0;
  const slow = () => new Promise((resolve) => {
    started += 1;
    setTimeout(resolve, 20);
  });
  const first = runRecruitmentStageNovedadSweepTick(slow);
  const second = await runRecruitmentStageNovedadSweepTick(slow);
  await first;
  check(started === 1 && second?.skipped === true, 'el barrido no se solapa en el mismo proceso');
}

{
  const dueAt = new Date(t0.getTime() + 2 * hour);
  const db = createMemoryDb();
  seedWorld(db);
  const event = await addEvent(db, { id: 'ev-a', createdAt: t0 });
  event.novedadEligibleAt = dueAt;
  const sent = await deliverDueRecruitmentStageNovedades({ now: dueAt, db });
  check(sent.sent === 1 && db.store.novedades.length === 1 && event.novedadNotifiedAt != null, 'A reserva y creación correctas');
}

{
  const dueAt = new Date(t0.getTime() + 2 * hour);
  const db = createMemoryDb();
  seedWorld(db);
  const event = await addEvent(db, { id: 'ev-b', createdAt: t0 });
  event.novedadEligibleAt = dueAt;
  db.store.failCreates = 1;
  await deliverDueRecruitmentStageNovedades({ now: dueAt, db });
  check(db.store.novedades.length === 0 && event.novedadNotifiedAt == null && event.novedadEligibleAt != null, 'B fallo al crear revierte la reserva');
  const retry = await deliverDueRecruitmentStageNovedades({ now: dueAt, db });
  check(retry.sent === 1 && db.store.novedades.length === 1 && event.novedadNotifiedAt != null, 'C el reintento crea el aviso');
}

{
  const dueAt = new Date(t0.getTime() + 2 * hour);
  const db = createMemoryDb();
  seedWorld(db);
  const event = await addEvent(db, { id: 'ev-d', createdAt: t0 });
  event.novedadEligibleAt = dueAt;
  await Promise.all([
    deliverDueRecruitmentStageNovedades({ now: dueAt, db }),
    deliverDueRecruitmentStageNovedades({ now: dueAt, db }),
  ]);
  check(db.store.novedades.length === 1 && event.novedadNotifiedAt != null, 'D dos barridos simultáneos dejan una fila');
}

{
  const dueAt = new Date(t0.getTime() + 2 * hour);
  const db = createMemoryDb();
  seedWorld(db);
  const event = await addEvent(db, { id: 'ev-e', createdAt: t0 });
  event.novedadEligibleAt = dueAt;
  db.store.failAfterReserve = true;
  await deliverDueRecruitmentStageNovedades({ now: dueAt, db });
  check(db.store.novedades.length === 0 && event.novedadNotifiedAt == null && event.novedadEligibleAt != null, 'E un fallo entre reserva y creación revierte la reserva');
}

{
  const dueAt = new Date(t0.getTime() + 2 * hour);
  const db = createMemoryDb();
  seedWorld(db);
  const bad = await addEvent(db, { id: 'ev-bad', createdAt: t0 });
  bad.novedadEligibleAt = dueAt;
  const app2 = { ...db.store.apps[0], id: 'app-2', candidate: { ...db.store.apps[0].candidate }, vacancy: { ...db.store.apps[0].vacancy } };
  db.store.apps.push(app2);
  const good = await addEvent(db, { id: 'ev-good', applicationId: 'app-2', createdAt: t0 });
  good.novedadEligibleAt = dueAt;
  db.store.failCreateIds = new Set(['ev-bad']);
  const result = await deliverDueRecruitmentStageNovedades({ now: dueAt, db });
  check(result.sent === 1 && bad.novedadNotifiedAt == null && good.novedadNotifiedAt != null, 'F un error distinto al conflicto no marca y no frena al resto');
  check(db.store.novedades.length === 1 && db.store.novedades[0].dedupeKey === 'ev-good', 'F solo se crea el aviso que sí pudo guardarse');
}

{
  const dueAt = new Date(t0.getTime() + 2 * hour);
  const db = createMemoryDb();
  seedWorld(db);
  const event = await addEvent(db, { id: 'ev-g', createdAt: t0, novedadNotifiedAt: dueAt });
  event.novedadEligibleAt = dueAt;
  const result = await deliverDueRecruitmentStageNovedades({ now: dueAt, db });
  check(result.scanned === 0 && result.sent === 0 && db.store.novedades.length === 0, 'G un evento ya notificado no se vuelve a procesar');
}

{
  async function closes(label, prepare) {
    const dueAt = new Date(t0.getTime() + 2 * hour);
    const db = createMemoryDb();
    seedWorld(db);
    const event = await addEvent(db, { id: 'ev-x', createdAt: t0 });
    event.novedadEligibleAt = dueAt;
    prepare(db, event);
    await deliverDueRecruitmentStageNovedades({ now: dueAt, db });
    const again = await deliverDueRecruitmentStageNovedades({ now: new Date(dueAt.getTime() + hour), db });
    check(
      db.store.novedades.length === 0 && event.novedadNotifiedAt == null && event.novedadEligibleAt == null && again.scanned === 0,
      label,
    );
  }
  await closes('pendiente inválido: candidato ausente', (db) => { db.store.apps[0].candidate = null; });
  await closes('pendiente inválido: postulación ausente', (db) => { db.store.apps.length = 0; });
  await closes('pendiente inválido: candidato archivado', (db) => { db.store.apps[0].candidate.archivedAt = t0; });
  await closes('pendiente inválido: destinatario inactivo', (db) => { db.store.employees[0].isActive = false; });
  await closes('pendiente inválido: la etapa ya cambió', (db) => { db.store.apps[0].stageId = 'stage-other'; });
  await closes('pendiente inválido: organización distinta', (db) => { db.store.apps[0].organizationId = 'org-b'; });
}

{
  const db = createMemoryDb();
  seedWorld(db);
  const previous = await addEvent(db, { id: 'ev-prev', createdAt: t0 });
  previous.novedadEligibleAt = new Date(t0.getTime() + 2 * hour);
  let failedPatch = false;
  try {
    await db.$transaction(async (tx) => {
      await cancelOpenStageNovedadWaits(tx, 'app-1');
      await tx.recruitmentApplicationStageEvent.create({
        data: {
          id: 'ev-rolled',
          organizationId: 'org-a',
          applicationId: 'app-1',
          fromStageId: 'stage-new',
          toStageId: 'stage-final',
          changedByUserId: 'user-1',
          createdAt: new Date(t0.getTime() + 60 * 60 * 1000),
          novedadEligibleAt: stageNovedadEligibleAt(t0),
          novedadNotifiedAt: null,
        },
      });
      const err = new Error('CONFLICT');
      err.code = 'CONFLICT';
      throw err;
    });
  } catch (err) {
    failedPatch = err.code === 'CONFLICT';
  }
  check(
    failedPatch && previous.novedadEligibleAt != null && !db.store.events.some((row) => row.id === 'ev-rolled'),
    'si el movimiento falla, no queda una espera nueva',
  );
}

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Espera de novedad de etapa OK.\n');

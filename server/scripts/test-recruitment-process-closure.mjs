/**
 * Cierre de proceso, declinación y archivado automático a 24 horas.
 * node server/scripts/test-recruitment-process-closure.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(serverDir, '..');
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'process-closure-test';
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';

const {
  AUTO_ARCHIVE_DELAY_MS,
  AUTO_ARCHIVE_SWEEP_MS,
  CLOSED_PROCESS_STAGE_MESSAGE,
  HIRED_STAGE_MOVE_MESSAGE,
  DECLINE_REASON_KEYS,
  assertCandidateCanBeArchived,
  assertRecruitmentProcessStageChangeAllowed,
  classifyRecruitmentApplication,
  clearCandidateAutoArchive,
  closurePatchForStageMove,
  declineRecruitmentApplication,
  deliverDueCandidateAutoArchives,
  lockRecruitmentCandidateForProcessChange,
  isRecruitmentApplicationOpen,
  isRecruitmentApplicationVisibleInKanban,
  recruitmentApplicationIsOpen,
  runCandidateAutoArchiveSweepTick,
  recruitmentTerminalOutcomeAt,
  syncCandidateAutoArchive,
} = await import('../src/services/recruitmentProcessClosure.service.js');
const {
  buildWorkforceRegisteredCandidatesWhere,
  pickCandidateTerminalListPreview,
  resolveCandidateListProcessPreview,
} = await import('../src/services/recruitmentCandidate.service.js');

const schema = fs.readFileSync(path.join(serverDir, 'prisma/schema.prisma'), 'utf8');
const migration = fs.readFileSync(
  path.join(serverDir, 'prisma/migrations/20261109033000_recruitment_process_closure/migration.sql'),
  'utf8',
);
const appSvc = fs.readFileSync(path.join(serverDir, 'src/services/recruitmentApplication.service.js'), 'utf8');
const candidateSvc = fs.readFileSync(path.join(serverDir, 'src/services/recruitmentCandidate.service.js'), 'utf8');
const novedadSvc = fs.readFileSync(path.join(serverDir, 'src/services/workforceRecruitmentNovedad.service.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(serverDir, 'src/server.js'), 'utf8');
const routes = fs.readFileSync(path.join(serverDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(serverDir, 'public/index.html'), 'utf8');

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
        return value !== expected.not;
      }
      if ('lte' in expected) return value != null && new Date(value).getTime() <= new Date(expected.lte).getTime();
      if ('notIn' in expected) return !expected.notIn.includes(value);
      if ('in' in expected) return expected.in.includes(value);
      if (value && typeof value === 'object' && !(value instanceof Date)) return matchWhere(value, expected);
      return false;
    }
    if (expected instanceof Date || value instanceof Date) {
      if (value == null || expected == null) return value == null && expected == null;
      return new Date(value).getTime() === new Date(expected).getTime();
    }
    return value === expected;
  });
}

console.log('\n=== Fecha terminal del historial ===\n');

{
  const hiredClose = new Date('2026-11-08T18:00:00.000Z');
  const fromClose = recruitmentTerminalOutcomeAt({
    stageKey: 'HIRED',
    closureOutcome: null,
    closedAt: hiredClose,
    updatedAt: new Date('2026-12-01T00:00:00.000Z'),
    stageEvents: [{ id: 'later', createdAt: new Date('2026-11-20T00:00:00.000Z'), toStageKey: 'HIRED' }],
  });
  check(fromClose && fromClose.toISOString() === hiredClose.toISOString(), 'Contratado con closedAt usa ese cierre');

  const rejectedClose = new Date('2026-11-09T18:00:00.000Z');
  const fromRejected = recruitmentTerminalOutcomeAt({
    stageKey: 'REJECTED',
    closureOutcome: 'REJECTED',
    closedAt: rejectedClose,
    stageEvents: [{ id: 'old', createdAt: new Date('2026-10-01T00:00:00.000Z'), toStageKey: 'REJECTED' }],
  });
  check(fromRejected && fromRejected.toISOString() === rejectedClose.toISOString(), 'Rechazado con closedAt usa ese cierre');

  const firstHire = new Date('2026-03-01T15:00:00.000Z');
  const definitiveHire = new Date('2026-08-11T15:00:00.000Z');
  const hiredEvent = recruitmentTerminalOutcomeAt({
    stageKey: 'HIRED',
    closureOutcome: null,
    hiredStageEnteredAt: new Date('2026-01-01T00:00:00.000Z'),
    stageEvents: [
      { id: 'a', createdAt: firstHire, toStageKey: 'HIRED' },
      { id: 'b', createdAt: new Date('2026-04-01T00:00:00.000Z'), toStageKey: 'INTERVIEW' },
      { id: 'c', createdAt: definitiveHire, toStageKey: 'HIRED' },
    ],
  });
  check(hiredEvent && hiredEvent.toISOString() === definitiveHire.toISOString(), 'varios ingresos a HIRED usan el cierre que permanece');

  const definitiveReject = new Date('2026-09-11T15:00:00.000Z');
  const rejectedEvent = recruitmentTerminalOutcomeAt({
    stageKey: 'REJECTED',
    closureOutcome: null,
    updatedAt: new Date('2026-12-02T00:00:00.000Z'),
    appliedAt: new Date('2026-01-02T00:00:00.000Z'),
    stageEvents: [
      { id: 'r1', createdAt: new Date('2026-02-01T00:00:00.000Z'), toStageKey: 'REJECTED' },
      { id: 'r2', createdAt: new Date('2026-05-01T00:00:00.000Z'), toStageKey: 'CONTACT' },
      { id: 'r3', createdAt: definitiveReject, toStageKey: 'REJECTED' },
    ],
  });
  check(rejectedEvent && rejectedEvent.toISOString() === definitiveReject.toISOString(), 'el rechazo histórico sin closedAt usa el evento REJECTED definitivo');

  const entered = new Date('2026-07-04T16:00:00.000Z');
  const hiredEntry = recruitmentTerminalOutcomeAt({
    stageKey: 'HIRED',
    closureOutcome: null,
    hiredStageEnteredAt: entered,
    stageEvents: [],
    updatedAt: new Date('2026-12-03T00:00:00.000Z'),
  });
  check(hiredEntry && hiredEntry.toISOString() === entered.toISOString(), 'una contratación sin eventos usa la entrada registrada a HIRED');

  const missing = recruitmentTerminalOutcomeAt({
    stageKey: 'HIRED',
    closureOutcome: null,
    updatedAt: new Date('2026-11-08T18:00:00.000Z'),
    appliedAt: new Date('2026-01-08T18:00:00.000Z'),
    archivedAt: new Date('2026-11-10T18:00:00.000Z'),
  });
  const missingRejected = recruitmentTerminalOutcomeAt({
    stageKey: 'REJECTED',
    closureOutcome: null,
    updatedAt: new Date('2026-11-09T18:00:00.000Z'),
    appliedAt: new Date('2026-01-09T18:00:00.000Z'),
  });
  check(missing == null && missingRejected == null, 'sin fecha terminal no usa updatedAt, appliedAt ni el archivo');

  const left = recruitmentTerminalOutcomeAt({
    stageKey: 'HIRED',
    closureOutcome: null,
    hiredStageEnteredAt: new Date('2026-01-01T00:00:00.000Z'),
    stageEvents: [
      { id: 'h', createdAt: new Date('2026-02-01T00:00:00.000Z'), toStageKey: 'HIRED' },
      { id: 'out', createdAt: new Date('2026-03-01T00:00:00.000Z'), toStageKey: 'CONTACT' },
    ],
  });
  check(left == null, 'un ingreso a HIRED que el historial abandona no se presenta como cierre');

  const declined = recruitmentTerminalOutcomeAt({
    stageKey: 'FINALIST',
    closureOutcome: 'DECLINED',
    closedAt: new Date('2026-11-09T15:00:00.000Z'),
  });
  check(declined == null, 'Declinó no recibe la fecha compacta de contratación o rechazo');

  const older = recruitmentTerminalOutcomeAt({
    stageKey: 'REJECTED',
    closureOutcome: 'REJECTED',
    closedAt: new Date('2026-05-02T12:00:00.000Z'),
    archivedAt: new Date('2026-05-03T12:00:00.000Z'),
  });
  const newer = recruitmentTerminalOutcomeAt({
    stageKey: 'HIRED',
    closureOutcome: null,
    hiredStageEnteredAt: new Date('2026-11-08T12:00:00.000Z'),
  });
  check(older.toISOString() !== newer.toISOString(), 'cada postulación conserva su propia fecha');

  const oldHire = new Date('2026-02-02T15:00:00.000Z');
  const finalReject = new Date('2026-11-09T15:00:00.000Z');
  const hiredThenRejected = recruitmentTerminalOutcomeAt({
    stageKey: 'REJECTED',
    closureOutcome: null,
    hiredStageEnteredAt: oldHire,
    stageEvents: [
      { id: 'old-hire', createdAt: oldHire, toStageKey: 'HIRED' },
      { id: 'final-reject', createdAt: finalReject, toStageKey: 'REJECTED' },
    ],
  });
  check(
    hiredThenRejected && hiredThenRejected.toISOString() === finalReject.toISOString(),
    'un HIRED antiguo no fecha el rechazo definitivo',
  );

  const oldReject = new Date('2026-03-03T15:00:00.000Z');
  const finalHire = new Date('2026-11-08T15:00:00.000Z');
  const rejectedThenHired = recruitmentTerminalOutcomeAt({
    stageKey: 'HIRED',
    closureOutcome: null,
    stageEvents: [
      { id: 'old-reject', createdAt: oldReject, toStageKey: 'REJECTED' },
      { id: 'final-hire', createdAt: finalHire, toStageKey: 'HIRED' },
    ],
  });
  check(
    rejectedThenHired && rejectedThenHired.toISOString() === finalHire.toISOString(),
    'un REJECTED antiguo no fecha la contratación definitiva',
  );

  const tied = new Date('2026-11-09T12:00:00.000Z');
  const rejectedWinsById = recruitmentTerminalOutcomeAt({
    stageKey: 'REJECTED',
    closureOutcome: null,
    stageEvents: [
      { id: 'b', createdAt: tied, toStage: { key: 'REJECTED' } },
      { id: 'a', createdAt: tied, toStage: { key: 'HIRED' } },
    ],
  });
  const hiredWinsById = recruitmentTerminalOutcomeAt({
    stageKey: 'HIRED',
    closureOutcome: null,
    stageEvents: [
      { id: 'b', createdAt: tied, toStageKey: 'HIRED' },
      { id: 'a', createdAt: tied, toStageKey: 'REJECTED' },
    ],
  });
  const laterIdAbandonsHire = recruitmentTerminalOutcomeAt({
    stageKey: 'HIRED',
    closureOutcome: null,
    hiredStageEnteredAt: new Date('2026-01-01T00:00:00.000Z'),
    stageEvents: [
      { id: 'b', createdAt: tied, toStageKey: 'REJECTED' },
      { id: 'a', createdAt: tied, toStageKey: 'HIRED' },
    ],
  });
  check(
    rejectedWinsById && rejectedWinsById.toISOString() === tied.toISOString()
      && hiredWinsById && hiredWinsById.toISOString() === tied.toISOString()
      && laterIdAbandonsHire == null,
    'dos eventos con el mismo instante se ordenan por id',
  );

  const fallbackReject = new Date('2026-09-09T15:00:00.000Z');
  const invalidClosedAt = recruitmentTerminalOutcomeAt({
    stageKey: 'REJECTED',
    closureOutcome: 'REJECTED',
    closedAt: 'no-es-fecha',
    updatedAt: new Date('2026-12-09T00:00:00.000Z'),
    stageEvents: [{ id: 'valid-reject', createdAt: fallbackReject, toStageKey: 'REJECTED' }],
  });
  const invalidDateObject = recruitmentTerminalOutcomeAt({
    stageKey: 'HIRED',
    closureOutcome: null,
    closedAt: new Date(NaN),
    hiredStageEnteredAt: finalHire,
    stageEvents: [],
  });
  check(
    invalidClosedAt && invalidClosedAt.toISOString() === fallbackReject.toISOString()
      && invalidDateObject && invalidDateObject.toISOString() === finalHire.toISOString(),
    'un closedAt inválido se ignora y sigue el fallback confiable',
  );

  const parkedHire = recruitmentTerminalOutcomeAt({
    stageKey: 'REJECTED',
    closureOutcome: null,
    hiredStageEnteredAt: oldHire,
    stageEvents: [],
  });
  const active = recruitmentTerminalOutcomeAt({
    stageKey: 'INTERVIEW',
    closureOutcome: null,
    hiredStageEnteredAt: oldHire,
    closedAt: finalHire,
  });
  check(parkedHire == null && active == null, 'hiredStageEnteredAt no fecha un rechazo ni un proceso activo');

  const detailFn = candidateSvc.slice(candidateSvc.indexOf('export async function getRecruitmentCandidate'), candidateSvc.indexOf('export async function updateRecruitmentCandidate'));
  const eventSelect = detailFn.slice(detailFn.indexOf('stageEvents:'), detailFn.indexOf('orderBy:', detailFn.indexOf('stageEvents:')));
  const serializeFn = candidateSvc.slice(candidateSvc.indexOf('function serializeCandidateApplicationProcess'), candidateSvc.indexOf('export async function assertRecruitmentCandidateInOrg'));
  check(/stageEvents:/.test(detailFn) && /terminalOutcomeAt/.test(serializeFn) && !/recruitmentApplication\.update/.test(detailFn), 'el expediente lee la fecha y no reescribe el histórico');
  check(
    /id:\s*true/.test(eventSelect) && /createdAt:\s*true/.test(eventSelect) && /key:\s*true/.test(eventSelect)
      && !/changedBy|fromStage|novedad|notes|candidate|vacancy|application/.test(eventSelect),
    'los eventos del expediente solo traen id, instante y clave de etapa',
  );
  check(!/stageEvents/.test(serializeFn) && (detailFn.match(/stageEvents:/g) || []).length === 1, 'el JSON no expone stageEvents y no hay una consulta por postulación');
}

function createMemoryDb({ locking = false } = {}) {
  const chains = new Map();
  function acquire(id) {
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    const prev = chains.get(id) || Promise.resolve();
    chains.set(id, next);
    return prev.then(() => release);
  }
  const store = {
    applications: [],
    candidates: [],
    events: [],
    novedades: [],
    employees: [],
    stages: [],
    failNovedad: false,
  };
  const tables = {
    recruitmentApplication: 'applications',
    recruitmentCandidate: 'candidates',
    recruitmentApplicationStageEvent: 'events',
    workforceRecruitmentNovedad: 'novedades',
    workforceEmployee: 'employees',
    recruitmentStage: 'stages',
  };
  function rowsOf(name) {
    return store[tables[name]];
  }
  const db = {
    store,
    async $transaction(fn) {
      const snap = structuredClone({
        applications: store.applications,
        candidates: store.candidates,
        events: store.events,
        novedades: store.novedades,
        employees: store.employees,
        stages: store.stages,
      });
      const releases = [];
      const tx = Object.create(db);
      if (locking) {
        tx.$queryRaw = async (_query, candidateId) => {
          releases.push(await acquire(candidateId));
          if (store.lockWait) {
            const wait = store.lockWait;
            store.lockWait = null;
            await wait;
          }
          return [{ id: candidateId }];
        };
      }
      try {
        return await fn(tx);
      } catch (err) {
        if (!locking) {
          store.applications = snap.applications;
          store.candidates = snap.candidates;
          store.events = snap.events;
          store.novedades = snap.novedades;
          store.employees = snap.employees;
          store.stages = snap.stages;
        }
        throw err;
      } finally {
        while (releases.length) releases.pop()();
      }
    },
  };
  for (const name of Object.keys(tables)) {
    db[name] = {
      async findFirst({ where } = {}) {
        return rowsOf(name).find((row) => matchWhere(row, where)) || null;
      },
      async findMany({ where, take } = {}) {
        let rows = rowsOf(name).filter((row) => matchWhere(row, where));
        if (take) rows = rows.slice(0, take);
        return rows.map((row) => ({ ...row }));
      },
      async count({ where } = {}) {
        return rowsOf(name).filter((row) => matchWhere(row, where)).length;
      },
      async update({ where, data }) {
        const row = rowsOf(name).find((item) => matchWhere(item, where));
        if (!row) throw new Error('NOT_FOUND');
        Object.assign(row, data);
        return row;
      },
      async updateMany({ where, data }) {
        const hits = rowsOf(name).filter((row) => matchWhere(row, where));
        for (const row of hits) Object.assign(row, data);
        return { count: hits.length };
      },
      async create({ data }) {
        if (name === 'workforceRecruitmentNovedad' && store.failNovedad) {
          throw new Error('novedad no disponible');
        }
        if (name === 'workforceRecruitmentNovedad') {
          const dup = store.novedades.some(
            (row) => row.organizationId === data.organizationId && row.dedupeKey === data.dedupeKey,
          );
          if (dup) {
            const err = new Error('duplicate');
            err.code = 'P2002';
            throw err;
          }
        }
        const row = { id: data.id || `row-${rowsOf(name).length + 1}`, ...data };
        rowsOf(name).push(row);
        return row;
      },
    };
  }
  return db;
}

function workforceMyCandidateMatches(where, row) {
  return (where.AND || []).every((clause) => {
    const keys = Object.keys(clause);
    if (keys.length === 1 && keys[0] === 'archivedAt') return clause.archivedAt === null && row.archivedAt == null;
    if (keys.length === 1 && keys[0] === 'organizationId') return row.organizationId === clause.organizationId;
    if (keys.length === 1 && keys[0] === 'registeredByWorkforceEmployeeId') {
      return row.registeredByWorkforceEmployeeId === clause.registeredByWorkforceEmployeeId;
    }
    if (clause.applications?.some) {
      const some = clause.applications.some;
      return (row.applications || []).some((app) => (
        app.organizationId === some.organizationId
        && app.closureOutcome == null
        && !['HIRED', 'REJECTED'].includes(app.stage?.key)
      ));
    }
    return true;
  });
}

function seedOpenApplication(db, extras = {}) {
  const now = new Date('2026-11-08T12:00:00.000Z');
  db.store.stages.push({ id: 'stage-contact', organizationId: 'org-1', key: 'CONTACT', name: 'Contacto' });
  db.store.employees.push({ id: 'emp-1', organizationId: 'org-1', isActive: true });
  db.store.candidates.push({
    id: 'cand-1',
    organizationId: 'org-1',
    fullName: extras.fullName || 'Juan Pérez',
    archivedAt: null,
    autoArchiveEligibleAt: null,
    registeredByWorkforceEmployeeId: 'emp-1',
  });
  db.store.applications.push({
    id: 'app-1',
    organizationId: 'org-1',
    candidateId: 'cand-1',
    vacancyId: 'vac-1',
    stageId: 'stage-contact',
    closureOutcome: null,
    closureReason: null,
    closureNote: null,
    closedAt: null,
    stage: { id: 'stage-contact', key: 'CONTACT', name: 'Contacto' },
    candidate: {
      id: 'cand-1',
      organizationId: 'org-1',
      fullName: extras.fullName || 'Juan Pérez',
      archivedAt: null,
      registeredByWorkforceEmployeeId: 'emp-1',
    },
    vacancy: { id: 'vac-1', organizationId: 'org-1', title: extras.vacancyTitle || 'Operador de producción' },
  });
  db.store.events.push({
    id: 'event-1',
    applicationId: 'app-1',
    organizationId: 'org-1',
    novedadEligibleAt: new Date(now.getTime() + 60 * 60 * 1000),
    novedadNotifiedAt: null,
  });
  return now;
}

console.log('\n=== Cierre de proceso ===\n');

check(recruitmentApplicationIsOpen('CONTACT', null) === true, 'contacto sin cierre sigue activo');
check(recruitmentApplicationIsOpen('CONTACT', 'DECLINED') === false, 'declinado no sigue activo');
check(recruitmentApplicationIsOpen('REJECTED', null) === false, 'etapa REJECTED cierra');
check(recruitmentApplicationIsOpen('HIRED', null) === false, 'contratado no es proceso abierto');
check(recruitmentApplicationIsOpen('Descartado', null) === true, 'el nombre visible no cierra el proceso');
check(classifyRecruitmentApplication('HIRED', null) === 'hired', 'histórico HIRED sin resultado es Contratado');
check(classifyRecruitmentApplication('REJECTED', null) === 'rejected', 'histórico REJECTED sin resultado es Rechazado');
check(classifyRecruitmentApplication('CONTACT', 'DECLINED') === 'declined', 'DECLINED no depende del nombre de la etapa');
check(classifyRecruitmentApplication('FINALIST', null) === 'active', 'etapa no terminal sin cierre sigue activa');
check(isRecruitmentApplicationOpen('HIRED', null) === false && isRecruitmentApplicationVisibleInKanban('HIRED', null) === true, 'HIRED está cerrado y visible en Contratado');
check(isRecruitmentApplicationVisibleInKanban('CONTACT', 'DECLINED') === true, 'DECLINED sigue visible en su columna');
check(isRecruitmentApplicationVisibleInKanban('REJECTED', null) === true, 'el REJECTED histórico sigue en Descartado');
check(isRecruitmentApplicationVisibleInKanban('REJECTED', 'REJECTED') === true, 'el REJECTED cerrado sigue en Descartado');
check(isRecruitmentApplicationOpen('CONTACT', null) && isRecruitmentApplicationVisibleInKanban('CONTACT', null), 'una etapa ordinaria sigue abierta y visible');

{
  const open = { stage: { key: 'CONTACT' }, closureOutcome: null, updatedAt: '2026-11-09T12:00:00.000Z', vacancy: { title: 'Activa' } };
  const oldDecline = { stage: { key: 'CONTACT' }, closureOutcome: 'DECLINED', closureReason: 'SCHEDULE', closedAt: '2026-11-01T12:00:00.000Z', vacancy: { title: 'Vieja' } };
  const laterReject = { stage: { key: 'REJECTED' }, closureOutcome: 'REJECTED', closedAt: '2026-11-08T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z', vacancy: { title: 'Descartada' } };
  const laterDecline = { stage: { key: 'FINALIST' }, closureOutcome: 'DECLINED', closureReason: null, closedAt: '2026-11-09T12:00:00.000Z', vacancy: { title: 'Nueva' } };
  const hired = { stage: { key: 'HIRED' }, closureOutcome: null, closedAt: null, updatedAt: '2026-10-01T12:00:00.000Z', vacancy: { title: 'Plaza' } };
  const historical = { stage: { key: 'REJECTED' }, closureOutcome: null, closedAt: null, updatedAt: '2026-09-01T12:00:00.000Z', appliedAt: '2026-08-01T12:00:00.000Z', vacancy: { title: 'Histórica' } };
  const activeWins = resolveCandidateListProcessPreview({ listPreviewKind: 'active' }, pickCandidateTerminalListPreview([oldDecline]));
  check(activeWins.listPreviewKind === 'active', 'otro proceso activo conserva En proceso');
  check(pickCandidateTerminalListPreview([hired, laterDecline]).listPreviewKind === 'hired', 'HIRED tiene prioridad sin proceso abierto');
  const recent = pickCandidateTerminalListPreview([laterReject, laterDecline]);
  check(recent.listPreviewKind === 'declined' && recent.vacancyTitle === 'Nueva' && recent.closureReason == null, 'el terminal más reciente decide y no inventa motivo');
  check(pickCandidateTerminalListPreview([laterDecline, laterReject]).listPreviewKind === 'declined', 'un rechazo antiguo no tapa la declinación posterior');
  check(pickCandidateTerminalListPreview([oldDecline, { ...laterReject, closedAt: '2026-11-02T12:00:00.000Z' }]).vacancyTitle === 'Descartada', 'una declinación antigua no tapa el rechazo posterior');
  const hist = pickCandidateTerminalListPreview([historical]);
  check(hist.listPreviewKind === 'rejected' && hist.closedAt == null, 'el histórico sin closedAt usa updatedAt y no inventa cierre');
  const two = pickCandidateTerminalListPreview([oldDecline, laterDecline]);
  check(two.listPreviewKind === 'declined' && two.closureReason == null, 'dos declinaciones de una persona producen un solo resultado');
}

const rejectedPatch = closurePatchForStageMove({
  stageChanged: true,
  toStageKey: 'REJECTED',
  now: new Date('2026-11-08T15:00:00.000Z'),
});
check(rejectedPatch.closureOutcome === 'REJECTED' && rejectedPatch.closureReason == null, 'rechazo guarda REJECTED sin motivo de declinación');
check(rejectedPatch.closedAt.toISOString() === '2026-11-08T15:00:00.000Z', 'rechazo guarda la hora del servidor');
const kept = closurePatchForStageMove({
  stageChanged: true,
  fromStageKey: 'REJECTED',
  fromOutcome: 'REJECTED',
  toStageKey: 'CONTACT',
});
check(Object.keys(kept).length === 0, 'salir de REJECTED no borra el cierre');
check(Object.keys(closurePatchForStageMove({ stageChanged: false, toStageKey: 'REJECTED', fromOutcome: 'REJECTED' })).length === 0, 'repetir REJECTED no reescribe el cierre');
let immutable = false;
try {
  assertRecruitmentProcessStageChangeAllowed({
    stageKey: 'REJECTED',
    closureOutcome: null,
    stageChanged: true,
  });
} catch (err) {
  immutable = err.message === CLOSED_PROCESS_STAGE_MESSAGE;
}
check(immutable, 'el histórico REJECTED tampoco se reabre');
let hiredBlocked = false;
try {
  assertRecruitmentProcessStageChangeAllowed({ stageKey: 'HIRED', closureOutcome: null, stageChanged: true });
} catch (err) {
  hiredBlocked = err.message === HIRED_STAGE_MOVE_MESSAGE;
}
check(hiredBlocked, 'el arrastre no saca a un contratado de HIRED');
assertRecruitmentProcessStageChangeAllowed({ stageKey: 'HIRED', closureOutcome: null, stageChanged: false });
check(true, 'repetir HIRED no reescribe el cierre');

{
  const db = createMemoryDb();
  seedOpenApplication(db);
  let threw = false;
  try {
    await declineRecruitmentApplication({
      organizationId: 'org-1',
      applicationId: 'app-1',
      reason: '',
      db,
    });
  } catch (err) {
    threw = err.code === 'VALIDATION_ERROR';
  }
  check(!threw && db.store.applications[0].closureOutcome === 'DECLINED' && db.store.applications[0].closureReason == null && db.store.applications[0].closureNote == null, 'declinar sin motivo deja el cierre en blanco');
}

for (const reason of DECLINE_REASON_KEYS.filter((key) => key !== 'OTHER')) {
  const db = createMemoryDb();
  seedOpenApplication(db);
  const result = await declineRecruitmentApplication({
    organizationId: 'org-1',
    applicationId: 'app-1',
    reason,
    note: 'no debe guardarse',
    db,
  });
  const app = db.store.applications[0];
  check(result.alreadyClosed === false && app.closureReason === reason && app.closureNote == null, `motivo ${reason} sin detalle`);
}

{
  const db = createMemoryDb();
  seedOpenApplication(db);
  let missingDetail = false;
  try {
    await declineRecruitmentApplication({
      organizationId: 'org-1',
      applicationId: 'app-1',
      reason: 'OTHER',
      note: '   ',
      db,
    });
  } catch (err) {
    missingDetail = err.code === 'VALIDATION_ERROR';
  }
  check(missingDetail && db.store.applications[0].closureOutcome == null, 'Otro exige detalle');
}

{
  const db = createMemoryDb();
  const now = seedOpenApplication(db);
  const result = await declineRecruitmentApplication({
    organizationId: 'org-1',
    applicationId: 'app-1',
    reason: 'OTHER',
    note: 'Se mudó de ciudad',
    now,
    db,
  });
  const app = db.store.applications[0];
  check(result.alreadyClosed === false && app.closureOutcome === 'DECLINED', 'declinar un proceso activo');
  check(app.closureReason === 'OTHER' && app.closureNote === 'Se mudó de ciudad', 'Otro guarda el detalle');
  check(app.stageId === 'stage-contact' && app.stage.key === 'CONTACT', 'conserva la última etapa');
  check(app.closedAt.toISOString() === now.toISOString(), 'fecha de cierre del servidor');
  check(db.store.events[0].novedadEligibleAt == null, 'cancela el aviso de etapa pendiente');
  check(db.store.novedades.length === 1 && db.store.novedades[0].eventType === 'DECLINED', 'una novedad de declinación');
  check(
    db.store.novedades[0].message === 'Juan Pérez declinó el proceso Operador de producción.',
    'el aviso no dice rechazado',
  );
  check(!db.store.novedades[0].message.includes('Se mudó'), 'el motivo no va en la campana');
  check(db.store.novedades[0].dedupeKey === 'application_declined:app-1', 'dedupe estable por postulación');
  check(!('phone' in db.store.novedades[0].metadata) && !('email' in db.store.novedades[0].metadata), 'sin teléfono ni correo');
  const again = await declineRecruitmentApplication({
    organizationId: 'org-1',
    applicationId: 'app-1',
    reason: 'OTHER',
    note: 'otro texto',
    now,
    db,
  });
  check(again.alreadyClosed === true && db.store.novedades.length === 1, 'repetir el cierre no duplica');
  check(
    db.store.candidates[0].autoArchiveEligibleAt.getTime() === now.getTime() + AUTO_ARCHIVE_DELAY_MS,
    'el último proceso programa 24 horas',
  );
  const early = await deliverDueCandidateAutoArchives({
    now: new Date(now.getTime() + 23 * 60 * 60 * 1000),
    db,
  });
  const stillDeclined = pickCandidateTerminalListPreview(db.store.applications);
  const waiting = {
    id: 'cand-1',
    organizationId: 'org-1',
    registeredByWorkforceEmployeeId: 'emp-1',
    archivedAt: null,
    applications: db.store.applications,
  };
  const openColleague = {
    id: 'cand-open',
    organizationId: 'org-1',
    registeredByWorkforceEmployeeId: 'emp-1',
    archivedAt: null,
    applications: [{ organizationId: 'org-1', closureOutcome: null, stage: { key: 'CONTACT' } }],
  };
  const otherOrg = { ...waiting, id: 'cand-other-org', organizationId: 'org-2' };
  const otherEmployee = { ...waiting, id: 'cand-other-emp', registeredByWorkforceEmployeeId: 'emp-2' };
  const allWhere = buildWorkforceRegisteredCandidatesWhere('org-1', 'emp-1', {
    previewFilter: 'all',
    archivedOnly: true,
    includeArchived: true,
  });
  const declinedWhere = buildWorkforceRegisteredCandidatesWhere('org-1', 'emp-1', { previewFilter: 'declined' });
  const inProcessWhere = buildWorkforceRegisteredCandidatesWhere('org-1', 'emp-1', { previewFilter: 'in_process' });
  const beforeRows = [waiting, openColleague, otherOrg, otherEmployee].filter((row) => workforceMyCandidateMatches(allWhere, row));
  const beforeDeclined = beforeRows.filter((row) => pickCandidateTerminalListPreview(row.applications)?.listPreviewKind === 'declined');
  check(
    early.archived === 0
      && db.store.candidates[0].archivedAt == null
      && stillDeclined?.listPreviewKind === 'declined'
      && stillDeclined.closureReason === 'OTHER'
      && beforeDeclined.length === 1
      && beforeDeclined[0].id === 'cand-1',
    'antes del vencimiento el declinado sigue en Declinados',
  );
  check(beforeRows.map((row) => row.id).join('|') === 'cand-1|cand-open', 'antes de 24 horas aparece una vez en Todos');
  check(
    [waiting, openColleague].filter((row) => workforceMyCandidateMatches(inProcessWhere, row)).map((row) => row.id).join('|') === 'cand-open',
    'un candidato no archivado sigue en En proceso',
  );
  const due = await deliverDueCandidateAutoArchives({
    now: new Date(now.getTime() + AUTO_ARCHIVE_DELAY_MS),
    db,
  });
  const archived = { ...waiting, archivedAt: db.store.candidates[0].archivedAt };
  check(
    due.archived === 1
      && archived.archivedAt != null
      && db.store.applications.length === 1
      && db.store.applications[0].closureOutcome === 'DECLINED'
      && db.store.applications[0].closureReason === 'OTHER'
      && db.store.novedades.length === 1
      && isRecruitmentApplicationVisibleInKanban(db.store.applications[0].stage?.key, 'DECLINED'),
    'al vencer archiva al declinado, la postulación sigue en el Kanban y no hay segundo aviso',
  );
  check(!workforceMyCandidateMatches(allWhere, archived), 'después del archivo no entra en Todos');
  check(!workforceMyCandidateMatches(declinedWhere, archived), 'después del archivo no entra en Declinados');
  const reactivated = { ...archived, archivedAt: null };
  check(
    workforceMyCandidateMatches(allWhere, reactivated)
      && pickCandidateTerminalListPreview(reactivated.applications)?.listPreviewKind === 'declined',
    'reactivarlo vuelve a Declinados',
  );
}

{
  const db = createMemoryDb();
  seedOpenApplication(db, { fullName: '<img src=x onerror=alert(1)>' });
  await declineRecruitmentApplication({
    organizationId: 'org-1',
    applicationId: 'app-1',
    reason: 'SCHEDULE',
    note: '<script>alert(1)</script>',
    db,
  });
  check(db.store.applications[0].closureNote == null, 'un motivo distinto de Otro no guarda detalle');
  check(db.store.novedades[0].message.includes('<img'), 'el nombre viaja como texto');
}

{
  const db = createMemoryDb();
  seedOpenApplication(db);
  const [first, second] = await Promise.all([
    declineRecruitmentApplication({ organizationId: 'org-1', applicationId: 'app-1', reason: 'PERSONAL', db }),
    declineRecruitmentApplication({ organizationId: 'org-1', applicationId: 'app-1', reason: 'SCHEDULE', db }),
  ]);
  const closed = [first, second].filter((row) => row.alreadyClosed !== true);
  check(closed.length === 1 && db.store.novedades.length === 1, 'la carrera deja un solo cierre y una sola novedad');
  check(db.store.applications[0].closureOutcome === 'DECLINED', 'el ganador queda DECLINED');
}

{
  const db = createMemoryDb();
  seedOpenApplication(db);
  db.store.failNovedad = true;
  let threw = false;
  try {
    await declineRecruitmentApplication({
      organizationId: 'org-1',
      applicationId: 'app-1',
      reason: 'PERSONAL',
      db,
    });
  } catch (err) {
    threw = true;
  }
  check(
    threw && db.store.applications[0].closureOutcome == null && db.store.events[0].novedadEligibleAt != null,
    'si la novedad falla, el cierre se revierte',
  );
}

{
  const db = createMemoryDb();
  const now = seedOpenApplication(db);
  db.store.stages.push({ id: 'stage-final', organizationId: 'org-1', key: 'FINALIST', name: 'Finalista' });
  db.store.applications.push({
    id: 'app-2',
    organizationId: 'org-1',
    candidateId: 'cand-1',
    vacancyId: 'vac-2',
    stageId: 'stage-final',
    closureOutcome: null,
    stage: { key: 'FINALIST', name: 'Finalista' },
  });
  await declineRecruitmentApplication({
    organizationId: 'org-1',
    applicationId: 'app-1',
    reason: 'PAY_OR_CONDITIONS',
    now,
    db,
  });
  check(db.store.candidates[0].autoArchiveEligibleAt == null, 'cerrar uno de dos procesos no programa archivo');
  await declineRecruitmentApplication({
    organizationId: 'org-1',
    applicationId: 'app-2',
    reason: 'NO_LONGER_INTERESTED',
    now,
    db,
  });
  check(
    db.store.candidates[0].autoArchiveEligibleAt.getTime() === now.getTime() + 24 * 60 * 60 * 1000,
    'cerrar el último proceso programa +24 horas',
  );
}

{
  const db = createMemoryDb();
  const now = new Date('2026-11-08T12:00:00.000Z');
  db.store.candidates.push({
    id: 'cand-wait',
    organizationId: 'org-1',
    archivedAt: null,
    autoArchiveEligibleAt: new Date(now.getTime() + 60 * 60 * 1000),
  });
  db.store.applications.push({
    id: 'app-closed',
    organizationId: 'org-1',
    candidateId: 'cand-wait',
    closureOutcome: 'REJECTED',
    stage: { key: 'REJECTED' },
  });
  const early = await deliverDueCandidateAutoArchives({ now, db });
  check(early.archived === 0 && db.store.candidates[0].archivedAt == null, 'antes de 24 horas no archiva');
  const due = await deliverDueCandidateAutoArchives({
    now: new Date(now.getTime() + 2 * 60 * 60 * 1000),
    db,
  });
  check(due.archived === 1 && db.store.candidates[0].archivedAt != null, 'al vencer archiva');
  check(db.store.candidates[0].autoArchiveEligibleAt == null && db.store.novedades.length === 0, 'el archivo limpia el vencimiento y no avisa');
  const repeat = await deliverDueCandidateAutoArchives({
    now: new Date(now.getTime() + 3 * 60 * 60 * 1000),
    db,
  });
  check(repeat.archived === 0 && repeat.scanned === 0, 'un barrido repetido no duplica');
}

{
  const db = createMemoryDb();
  const eligible = new Date('2026-11-08T12:00:00.000Z');
  db.store.candidates.push({
    id: 'cand-race',
    organizationId: 'org-1',
    archivedAt: null,
    autoArchiveEligibleAt: eligible,
  });
  db.store.applications.push({
    id: 'app-race',
    organizationId: 'org-1',
    candidateId: 'cand-race',
    closureOutcome: 'DECLINED',
    stage: { key: 'CONTACT' },
  });
  const dueAt = new Date(eligible.getTime() + 1000);
  const [a, b] = await Promise.all([
    deliverDueCandidateAutoArchives({ now: dueAt, db }),
    deliverDueCandidateAutoArchives({ now: dueAt, db }),
  ]);
  check(a.archived + b.archived === 1, 'dos instancias solo permiten un archivado');
  check(db.store.candidates[0].archivedAt != null, 'el candidato queda archivado una vez');
}

{
  const db = createMemoryDb();
  db.store.candidates.push({
    id: 'cand-old',
    organizationId: 'org-1',
    archivedAt: null,
    autoArchiveEligibleAt: null,
  });
  db.store.applications.push({
    id: 'app-old',
    organizationId: 'org-1',
    candidateId: 'cand-old',
    closureOutcome: 'REJECTED',
    stage: { key: 'REJECTED' },
  });
  const swept = await deliverDueCandidateAutoArchives({ now: new Date('2026-11-10T00:00:00.000Z'), db });
  check(swept.scanned === 0 && db.store.candidates[0].archivedAt == null, 'históricos sin vencimiento no se archivan');
}

{
  const db = createMemoryDb();
  const now = new Date('2026-11-08T12:00:00.000Z');
  db.store.candidates.push({
    id: 'cand-new',
    organizationId: 'org-1',
    archivedAt: null,
    autoArchiveEligibleAt: new Date(now.getTime() + AUTO_ARCHIVE_DELAY_MS),
  });
  await clearCandidateAutoArchive(db, 'cand-new');
  check(db.store.candidates[0].autoArchiveEligibleAt == null, 'una postulación nueva cancela el autoarchivo');
  db.store.candidates[0].autoArchiveEligibleAt = new Date(now.getTime() + AUTO_ARCHIVE_DELAY_MS);
  db.store.applications.push({
    id: 'app-hired',
    organizationId: 'org-1',
    candidateId: 'cand-new',
    closureOutcome: null,
    stage: { key: 'HIRED' },
  });
  const hiredSchedule = await syncCandidateAutoArchive(db, {
    organizationId: 'org-1',
    candidateId: 'cand-new',
    now,
  });
  check(hiredSchedule == null && db.store.candidates[0].autoArchiveEligibleAt == null, 'contratado no se autoarchiva');
}

{
  const db = createMemoryDb();
  db.store.applications.push({
    id: 'app-open',
    organizationId: 'org-1',
    candidateId: 'cand-block',
    closureOutcome: null,
    stage: { key: 'CONTACT' },
  });
  let blocked = false;
  try {
    await assertCandidateCanBeArchived(db, { organizationId: 'org-1', candidateId: 'cand-block' });
  } catch (err) {
    blocked = err.code === 'VALIDATION_ERROR' && /procesos activos/.test(err.message);
  }
  check(blocked, 'archivado manual bloqueado con procesos activos');
  db.store.applications[0].closureOutcome = 'DECLINED';
  const open = await assertCandidateCanBeArchived(db, { organizationId: 'org-1', candidateId: 'cand-block' });
  check(open === 0, 'sin procesos activos el archivo puede continuar');
}

{
  const db = createMemoryDb();
  const now = new Date('2026-11-08T12:00:00.000Z');
  db.store.candidates.push({
    id: 'cand-stale',
    organizationId: 'org-1',
    archivedAt: null,
    autoArchiveEligibleAt: now,
  });
  db.store.applications.push({
    id: 'app-still-open',
    organizationId: 'org-1',
    candidateId: 'cand-stale',
    closureOutcome: null,
    stage: { key: 'CONTACT' },
  });
  const swept = await deliverDueCandidateAutoArchives({ now: new Date(now.getTime() + 1000), db });
  check(swept.archived === 0 && db.store.candidates[0].archivedAt == null, 'si volvió a tener proceso activo no archiva');
  check(db.store.candidates[0].autoArchiveEligibleAt == null, 'limpia el vencimiento que ya no aplica');
}

{
  const db = createMemoryDb();
  seedOpenApplication(db);
  db.store.applications[0].closureOutcome = 'REJECTED';
  db.store.applications[0].stage = { id: 'stage-rejected', key: 'REJECTED', name: 'Descartado' };
  db.store.applications[0].stageId = 'stage-rejected';
  let blocked = false;
  try {
    await declineRecruitmentApplication({
      organizationId: 'org-1',
      applicationId: 'app-1',
      reason: 'PERSONAL',
      db,
    });
  } catch (err) {
    blocked = err.message === CLOSED_PROCESS_STAGE_MESSAGE;
  }
  check(blocked && db.store.applications[0].closureOutcome === 'REJECTED', 'declinar no convierte un REJECTED en DECLINED');
  let declinedBlocked = false;
  try {
    assertRecruitmentProcessStageChangeAllowed({
      stageKey: 'CONTACT',
      closureOutcome: 'DECLINED',
      stageChanged: true,
    });
  } catch (err) {
    declinedBlocked = err.message === CLOSED_PROCESS_STAGE_MESSAGE;
  }
  check(declinedBlocked, 'PATCH de etapa sobre DECLINED queda bloqueado');
  assertRecruitmentProcessStageChangeAllowed({
    stageKey: 'REJECTED',
    closureOutcome: 'REJECTED',
    stageChanged: false,
  });
  check(true, 'repetir la etapa terminal no entra al rechazo de movimiento');
}

function raceCandidate(id) {
  return {
    id,
    organizationId: 'org-1',
    archivedAt: null,
    autoArchiveEligibleAt: new Date('2026-11-08T12:00:00.000Z'),
  };
}
function hasArchivedWithOpenProcess(db, candidateId) {
  const candidate = db.store.candidates.find((row) => row.id === candidateId);
  const open = db.store.applications.some(
    (row) => row.candidateId === candidateId && recruitmentApplicationIsOpen(row.stage?.key, row.closureOutcome),
  );
  return !!(candidate && candidate.archivedAt && open);
}
/**
 * Espejo conceptual de createRecruitmentApplication: candado → (si archivado) desarchivo → create → clear autoarchivo.
 * El alta ya no rechaza por archivedAt; un rollback de TX restauraría archivedAt.
 */
async function attemptNewApplication(db, candidateId) {
  await db.$transaction(async (tx) => {
    await lockRecruitmentCandidateForProcessChange(tx, candidateId);
    const candidate = await tx.recruitmentCandidate.findFirst({ where: { id: candidateId } });
    if (candidate?.archivedAt) {
      await tx.recruitmentCandidate.update({
        where: { id: candidateId },
        data: { archivedAt: null, autoArchiveEligibleAt: null },
      });
    } else {
      await clearCandidateAutoArchive(tx, candidateId);
    }
    await tx.recruitmentApplication.create({
      data: {
        id: `app-new-${candidateId}`,
        organizationId: 'org-1',
        candidateId,
        closureOutcome: null,
        stage: { key: 'NEW' },
      },
    });
  });
  return 'created';
}

{
  const db = createMemoryDb({ locking: true });
  db.store.candidates.push(raceCandidate('cand-archive-wins'));
  let release;
  db.store.lockWait = new Promise((resolve) => {
    release = resolve;
  });
  const dueAt = new Date('2026-11-09T12:00:01.000Z');
  const archivePromise = deliverDueCandidateAutoArchives({ now: dueAt, db });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const createPromise = attemptNewApplication(db, 'cand-archive-wins');
  release();
  const [archiveResult, createResult] = await Promise.all([archivePromise, createPromise]);
  const cand = db.store.candidates.find((row) => row.id === 'cand-archive-wins');
  const openApps = db.store.applications.filter(
    (row) => row.candidateId === 'cand-archive-wins' && recruitmentApplicationIsOpen(row.stage?.key, row.closureOutcome),
  );
  check(
    archiveResult.archived === 1 && createResult === 'created' && !cand.archivedAt && openApps.length === 1,
    'si el autoarchivo gana el candado, el alta posterior desarchiva y crea el proceso',
  );
  check(!hasArchivedWithOpenProcess(db, 'cand-archive-wins'), 'no queda archivado con un proceso activo');
}

{
  const db = createMemoryDb({ locking: true });
  db.store.candidates.push(raceCandidate('cand-create-wins'));
  let release;
  db.store.lockWait = new Promise((resolve) => {
    release = resolve;
  });
  const createPromise = attemptNewApplication(db, 'cand-create-wins');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const dueAt = new Date('2026-11-09T12:00:01.000Z');
  const archivePromise = deliverDueCandidateAutoArchives({ now: dueAt, db });
  release();
  const [createResult, archiveResult] = await Promise.all([createPromise, archivePromise]);
  const candidate = db.store.candidates[0];
  check(createResult === 'created' && archiveResult.archived === 0 && candidate.archivedAt == null, 'si la postulación gana, el candidato sigue activo');
  check(candidate.autoArchiveEligibleAt == null, 'la postulación nueva limpia el vencimiento');
  check(!hasArchivedWithOpenProcess(db, 'cand-create-wins'), 'la carrera no archiva y crea a la vez');
}

check(AUTO_ARCHIVE_DELAY_MS === 24 * 60 * 60 * 1000, 'la espera de archivo es de 24 horas');
check(AUTO_ARCHIVE_SWEEP_MS === 5 * 60 * 1000, 'el barrido corre cada cinco minutos');
check(DECLINE_REASON_KEYS.includes('OTHER') && DECLINE_REASON_KEYS.includes('ACCEPTED_OTHER_OFFER'), 'claves estables de motivo');

{
  let skipped = false;
  const first = runCandidateAutoArchiveSweepTick(() => new Promise((resolve) => setTimeout(() => resolve({ archived: 1 }), 30)));
  const second = await runCandidateAutoArchiveSweepTick(async () => ({ archived: 9 }));
  skipped = second && second.skipped === true;
  await first;
  check(skipped, 'el barrido no se solapa en el mismo proceso');
  const failedTick = await runCandidateAutoArchiveSweepTick(async () => {
    throw new Error('fallo aislado');
  });
  check(failedTick && failedTick.failed === true, 'un error de barrido no detiene el proceso');
}

const closureSvc = fs.readFileSync(path.join(serverDir, 'src/services/recruitmentProcessClosure.service.js'), 'utf8');
check(/scheduleNovedad: true/.test(appSvc) && (appSvc.match(/scheduleNovedad: true/g) || []).length === 1, 'la espera de dos horas del movimiento manual sigue una sola vez');
const updateSlice = appSvc.slice(appSvc.indexOf('export async function updateRecruitmentApplication'));
check(updateSlice.indexOf('assertRecruitmentProcessStageChangeAllowed') < updateSlice.indexOf('recordStageEvent'), 'un proceso cerrado se rechaza antes de registrar otro movimiento');
check(/kanbanVisibleApplicationWhere\(\)/.test(appSvc), 'el listado del Kanban usa la consulta de visibilidad');
{
  const whereStart = closureSvc.indexOf('export function kanbanVisibleApplicationWhere');
  const whereBody = closureSvc.slice(whereStart, closureSvc.indexOf('/**', whereStart + 10));
  check(/return \{\s*\};/.test(whereBody), 'la consulta del Kanban incluye declinados, contratados y descartados');
  check(/if \(previewFilter === 'in_process'\)[\s\S]{0,280}closureOutcome: null/.test(candidateSvc), 'En proceso exige un proceso abierto');
  const publicRoutes = fs.readFileSync(path.join(serverDir, 'src/routes/timeclock.public.routes.js'), 'utf8');
  const myRouteStart = publicRoutes.indexOf("router.get('/recruitment/my-candidates'");
  const myRoute = publicRoutes.slice(myRouteStart, publicRoutes.indexOf('router.post(', myRouteStart + 20));
  const workforceWhere = candidateSvc.slice(
    candidateSvc.indexOf('export function buildWorkforceRegisteredCandidatesWhere'),
    candidateSvc.indexOf('/** Filtra IDs usando la misma regla de preview'),
  );
  check(workforceWhere.includes('archivedAt: null'), 'Mis candidatos exige archivedAt nulo en servidor');
  check(!/archivedOnly|includeArchived/.test(workforceWhere), 'Mis candidatos no acepta un parámetro de archivados');
  check(/organizationId/.test(workforceWhere) && /registeredByWorkforceEmployeeId/.test(workforceWhere), 'Mis candidatos filtra organización y colaborador');
  check(/req\.timeclockEmployee\.organizationId/.test(myRoute) && /req\.timeclockEmployee\.id/.test(myRoute), 'organización y colaborador salen de la sesión');
  check(!/archivedOnly|includeArchived|req\.query\.archived/.test(myRoute), 'el portal no puede pedir archivados');
  check(/archivedOnly === true/.test(candidateSvc) && /archivedAt: \{ not: null \}/.test(candidateSvc), 'Archivados administrativos sigue disponible');
  const detailFn = candidateSvc.slice(candidateSvc.indexOf('export async function getRecruitmentCandidate'), candidateSvc.indexOf('export async function updateRecruitmentCandidate'));
  check(/where: \{ id: candidateId, organizationId \}/.test(detailFn) && !/archivedAt:\s*null/.test(detailFn), 'el GET administrativo por id incluye archivados');
  check(/if \(patch\.archived === false\) \{\s*data\.archivedAt = null/.test(candidateSvc), 'reactivar limpia archivedAt');
  check(/'declined'/.test(publicRoutes), 'el portal acepta el filtro Declinados');
  check(!/REJECTED|DECLINED|archivedAt/.test(whereBody), 'la consulta no filtra columnas ni candidatos archivados');
}
check(/FOR UPDATE/.test(closureSvc), 'el candado es SELECT FOR UPDATE');
check(/lockRecruitmentCandidateForProcessChange\(tx, candidateId\)/.test(appSvc), 'crear una postulación toma el candado del candidato');
check(/lockRecruitmentCandidateForProcessChange\(tx, row\.id\)/.test(closureSvc), 'el autoarchivo toma el mismo candado');
check(/function recKanbanApplicationIsVisible/.test(indexHtml), 'el tablero distingue visibilidad de proceso activo');
check(indexHtml.includes("const canDrag=stageKey!=='HIRED'&&stageKey!=='REJECTED'&&stageKey!=='DECLINED'") && indexHtml.includes('return !!app'), 'Declinó, Descartado y Contratado se pintan y no se arrastran');
check(indexHtml.includes("name:'Declinó'") && indexHtml.includes('recKanbanBoardColumns'), 'la columna Declinó es virtual');
check(/virtual\?'':' ondragover=/.test(indexHtml), 'Declinó no acepta un arrastre de etapa');
const candidateCreateSvc = fs.readFileSync(path.join(serverDir, 'src/services/recruitmentCandidateCreate.service.js'), 'utf8');
check(/createRecruitmentApplication\(/.test(candidateCreateSvc), 'el portal crea la postulación por el orquestador que toma el candado');
check(!/lockRecruitmentCandidateForProcessChange/.test(candidateCreateSvc), 'el portal no abre otro candado');
{
  const createBody = appSvc.slice(appSvc.indexOf('export async function createRecruitmentApplication'), appSvc.indexOf('export async function listRecruitmentApplicationsForVacancy'));
  const lockAt = createBody.indexOf('lockRecruitmentCandidateForProcessChange(tx, candidateId)');
  const vacAssertAt = createBody.indexOf('assertRecruitmentVacancyInOrg');
  const blockFindAt = createBody.indexOf('blocksReapplication: true');
  const unarchiveAt = createBody.indexOf('archivedAt: null');
  const createAt = createBody.indexOf('recruitmentApplication.create');
  const syncAt = createBody.indexOf('syncCandidateAutoArchive');
  check(lockAt >= 0 && lockAt < createAt, 'el alta bloquea la fila antes de insertar');
  check(lockAt >= 0 && lockAt < vacAssertAt, 'el alta toma el candado antes de validar vacante');
  check(lockAt >= 0 && blockFindAt > vacAssertAt && blockFindAt < unarchiveAt, 'busca bloqueo de reaplicación antes de desarchivar');
  check(unarchiveAt >= 0 && unarchiveAt < createAt, 'desarchiva antes de create');
  check(createAt >= 0 && syncAt > createAt, 'sincroniza autoarchivo después del create');
  check(lockAt >= 0 && lockAt < createBody.indexOf('blocksReapplication: true'), 'el alta bloquea antes de crear con blocksReapplication');
  check(!/prisma\.\$queryRaw/.test(createBody), 'el alta no usa el cliente global para el candado');
  const sweepBody = closureSvc.slice(closureSvc.indexOf('export async function deliverDueCandidateAutoArchives'));
  const sweepLock = sweepBody.indexOf('lockRecruitmentCandidateForProcessChange(tx, row.id)');
  check(sweepLock >= 0 && sweepLock < sweepBody.indexOf('candidateStillEligibleToArchive') && sweepLock < sweepBody.indexOf('archivedAt: now'), 'el autoarchivo bloquea la fila antes de decidir');
  const manualBody = candidateSvc.slice(candidateSvc.indexOf('export async function updateRecruitmentCandidate'));
  const manualLock = manualBody.indexOf('lockRecruitmentCandidateForProcessChange(tx, candidateId)');
  check(manualLock >= 0 && manualLock < manualBody.indexOf('assertCandidateCanBeArchived'), 'el archivo manual usa el mismo candado');
  const lockBody = closureSvc.slice(closureSvc.indexOf('export async function lockRecruitmentCandidateForProcessChange'), closureSvc.indexOf('function normalizeDeclineReason'));
  check(/tx\.\$queryRaw/.test(lockBody) && !/prisma\.\$queryRaw/.test(lockBody), 'el candado corre sobre tx');
  check(/\$\{candidateId\}/.test(lockBody) && !/['"`]\s*\+\s*candidateId/.test(lockBody), 'candidateId viaja como parámetro');
}
check(/recKanbanPlaceDeclinedApplication\(applicationId/.test(indexHtml) && !/recKanbanLoad\(/.test(indexHtml.slice(indexHtml.indexOf('async function recCandConfirmDecline'), indexHtml.indexOf('function recCandOpenArchiveDialog'))), 'declinar mueve la tarjeta a Declinó sin recargar el tablero');
check(/terminalKind\?'':\(a\.closedAt\?\('Cierre '\+recCandFmtDetailDate\(a\.closedAt\)\)/.test(indexHtml), 'Declinó conserva el cierre y Contratado o Rechazado no lo repiten');
check(/recCandFmtTerminalDate\(a\.terminalOutcomeAt/.test(indexHtml) && /\.rec-cand-history-outcome--hired\{color:#047857;\}/.test(indexHtml) && /\.rec-cand-history-outcome--rej\{color:#b91c1c;\}/.test(indexHtml), 'la fecha compacta queda bajo el resultado, verde o rojo');
check(/closurePatchForStageMove/.test(appSvc), 'el rechazo canónico se escribe en el mismo movimiento');
check(/syncCandidateAutoArchive/.test(appSvc), 'mover la etapa reevalúa el autoarchivo');
check(/clearCandidateAutoArchive/.test(appSvc), 'crear una postulación cancela el autoarchivo en la misma transacción');
check(/archivedAt: null/.test(appSvc) && /autoArchiveEligibleAt: null/.test(appSvc), 'el alta desarchiva en la misma transacción');
check(/Este candidato está archivado/.test(appSvc), 'un archivado no se mueve de etapa');
check(/blocksReapplication: false/.test(closureSvc), 'declinar libera blocksReapplication');
check(/expectedBlocksReapplication/.test(closureSvc), 'helper esperado de blocksReapplication');
check(closureSvc.includes(CLOSED_PROCESS_STAGE_MESSAGE), 'un proceso cerrado no se reabre al arrastrarlo');
check(/assertCandidateCanBeArchived/.test(candidateSvc), 'el archivo manual valida procesos activos en servidor');
check(/autoArchiveEligibleAt: null/.test(candidateSvc), 'archivar o reactivar cancela el autoarchivo');
check(/declinó el proceso/.test(novedadSvc), 'copy de declinación');
check(/application_declined:/.test(novedadSvc), 'dedupe de declinación');
check(/startCandidateAutoArchiveSweep/.test(serverJs), 'el barrido arranca con el servidor');
check(/\.strict\(\)/.test(routes) && /\/applications\/:id\/decline/.test(routes), 'la ruta de declinación no acepta campos de más');
check(!/closedAt:/.test(routes.slice(routes.indexOf('declineApplicationSchema'), routes.indexOf('declineApplicationSchema') + 400)), 'el cliente no envía closedAt');

check(/aria-label="Declinó"/.test(indexHtml) && /El candidato declinó el proceso/.test(indexHtml) && /Confirmar declinación/.test(indexHtml), 'acción y diálogo de declinación');
check(/reason: z\.enum\(DECLINE_REASON_KEYS\)\.optional\(\)/.test(routes), 'el motivo de declinación es opcional');
check(/Este candidato tiene procesos activos/.test(indexHtml), 'archivo con procesos activos');
check(/Este candidato dejará de aparecer entre los candidatos activos/.test(indexHtml), 'archivo sin procesos activos');
check(!/No podrá recibir nuevas postulaciones/.test(indexHtml), 'se retiró el aviso engañoso');
check(/Al añadir una vacante se creará un nuevo proceso/.test(indexHtml), 'archivado puede iniciar nuevo proceso desde la ficha');
check(/addBtn\.disabled=false/.test(indexHtml) && /addBtn\.title='Añadir a vacante'/.test(indexHtml), 'la acción de vacante permanece disponible si está archivado');
check(/function recCandHistoryAsideHtml[\s\S]{0,2500}tcEsc\(stageName\)/.test(indexHtml) && /tcEsc\(reasonLabel\)/.test(indexHtml) && /tcEsc\(note\)/.test(indexHtml), 'el historial escapa etapa, motivo y detalle');
check(/function recCandHistoryAsideHtml[\s\S]{0,2500}tcEsc\(outcome\)/.test(indexHtml), 'el historial escapa el resultado');
check(/vac\.textContent/.test(indexHtml) && /stage\.textContent/.test(indexHtml), 'el diálogo pinta vacante y etapa como texto');
check(/kind==='declined'/.test(indexHtml), 'la cartera distingue Declinó');
check(!/Proceso cerrado/.test(indexHtml), 'el historial no agrega el texto redundante');
check(indexHtml.includes('recKanbanColumnShouldCollapse') && !indexHtml.includes('recKanbanRevealEmptyForDrag'), 'el Kanban conservado no reabre columnas vacías al arrastrar');

check(/ADD VALUE 'DECLINED'/.test(migration), 'la migración agrega DECLINED');
check(!/UPDATE /i.test(migration) && !/DEFAULT/.test(migration), 'sin backfill ni valores por defecto');
check(/autoArchiveEligibleAt/.test(schema) && /closureOutcome/.test(schema), 'el esquema guarda cierre y vencimiento');
check(indexHtml === publicHtml, 'index.html y server/public/index.html son idénticos');

{
  let prisma;
  try {
    ({ prisma } = await import('../src/db/client.js'));
    await prisma.$queryRaw`SELECT 1`;
    const where = buildWorkforceRegisteredCandidatesWhere(
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000000',
      { previewFilter: 'declined', archivedOnly: true, includeArchived: true },
    );
    const rows = await prisma.recruitmentCandidate.findMany({ where, take: 1 });
    check(Array.isArray(rows) && rows.length === 0, 'el filtro SQL de Mis candidatos corre en PostgreSQL');
  } catch (err) {
    const text = String(err && err.message ? err.message : err);
    const line = text.split('\n').map((item) => item.trim()).find((item) => /Can't reach|ECONNREFUSED|connect/i.test(item))
      || 'sin conexión';
    console.log(`  SKIP  filtro SQL de Mis candidatos: ${line}`);
  } finally {
    if (prisma) {
      try { await prisma.$disconnect(); } catch { /* la suite no depende de la conexión */ }
    }
  }
}

if (failed) {
  console.error(`\n${failed} comprobaciones fallaron\n`);
  process.exit(1);
}
console.log('\nCierre de proceso en orden\n');

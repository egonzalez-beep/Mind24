/**
 * Aviso administrativo al crear un candidato de reclutamiento.
 * node server/scripts/test-recruitment-candidate-created-notification.mjs
 *
 * La integración contra Postgres se marca SKIP si no hay base o si la migración
 * nueva no está aplicada. SKIP no certifica el flujo persistido.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(rootDir, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'recruitment-candidate-notif-test-secret';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
const migration = fs.readFileSync(
  path.join(
    rootDir,
    'prisma/migrations/20261105060000_org_notification_recruitment_candidate_created/migration.sql',
  ),
  'utf8',
);
const notifSvc = fs.readFileSync(path.join(rootDir, 'src/services/orgNotification.service.js'), 'utf8');
const createSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentCandidateCreate.service.js'),
  'utf8',
);
const candidateSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentCandidate.service.js'),
  'utf8',
);
const applicationSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentApplication.service.js'),
  'utf8',
);
const portalSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/workforceRecruitmentPortal.service.js'),
  'utf8',
);
const routes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const notifRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/org.notifications.routes.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(repoDir, 'index.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function sliceBetween(src, startMark, endMark) {
  const start = src.indexOf(startMark);
  const end = start >= 0 ? src.indexOf(endMark, start + startMark.length) : -1;
  if (start < 0 || end < 0) return '';
  return src.slice(start, end);
}

const { buildRecruitmentCandidateCreatedMessage, notifyRecruitmentCandidateCreated } =
  await import('../src/services/orgNotification.service.js');

console.log('\n=== Mensaje ===\n');

check(
  buildRecruitmentCandidateCreatedMessage({
    actorKind: 'admin',
    actorLabel: 'María López',
    candidateName: 'Juan Pérez',
  }) === 'María López agregó a Juan Pérez como nuevo candidato.',
  'admin sin vacante ni etapa',
);
check(
  buildRecruitmentCandidateCreatedMessage({
    actorKind: 'admin',
    actorLabel: 'María López',
    candidateName: 'Juan Pérez',
    vacancyTitle: 'Operador de producción',
  }) === 'María López agregó a Juan Pérez a la vacante Operador de producción.',
  'admin con vacante',
);
check(
  buildRecruitmentCandidateCreatedMessage({
    actorKind: 'workforce',
    actorLabel: 'María López',
    candidateName: 'Juan Pérez',
    vacancyTitle: 'Operador de producción',
    stageName: 'Entrevista',
  }) === 'María López agregó a Juan Pérez a Operador de producción en la etapa Entrevista.',
  'colaborador con vacante y etapa',
);
check(
  buildRecruitmentCandidateCreatedMessage({
    actorKind: 'public',
    actorLabel: 'No usar',
    candidateName: 'Juan Pérez',
    vacancyTitle: 'Operador de producción',
    stageName: 'Entrevista',
  }) === 'Juan Pérez se registró como nuevo candidato.',
  'registro público neutro',
);
check(
  buildRecruitmentCandidateCreatedMessage({
    actorKind: 'system',
    candidateName: 'Juan Pérez',
  }) === 'Se agregó un nuevo candidato: Juan Pérez.',
  'proceso de sistema',
);
check(
  buildRecruitmentCandidateCreatedMessage({
    actorKind: 'admin',
    actorLabel: '   ',
    candidateName: 'Juan Pérez',
  }) === 'Se agregó un nuevo candidato: Juan Pérez.',
  'actor vacío no inventa persona',
);
const omitted = buildRecruitmentCandidateCreatedMessage({
  actorKind: 'admin',
  actorLabel: 'María López',
  candidateName: 'Juan Pérez',
  vacancyTitle: '',
  stageName: '',
});
check(!/Sin vacante|Sin etapa|—/.test(omitted), 'omite vacante y etapa vacías');
check(
  !buildRecruitmentCandidateCreatedMessage({
    actorKind: 'admin',
    actorLabel: 'María López',
    candidateName: 'Juan Pérez',
    stageName: 'Entrevista',
  }).includes('Entrevista'),
  'etapa sin vacante no aparece',
);
const hostile = buildRecruitmentCandidateCreatedMessage({
  actorKind: 'admin',
  actorLabel: '<img src=x onerror="alert(1)">',
  candidateName: 'Juan <script>alert(1)</script>',
  vacancyTitle: 'Ops "quoted"',
});
check(hostile.includes('<script>') && hostile.includes('<img'), 'el mensaje conserva el texto, sin HTML propio');
check(!/curp|@|whatsapp|teléfono/i.test(omitted), 'sin datos de contacto en el mensaje base');
check(
  buildRecruitmentCandidateCreatedMessage({
    actorKind: 'admin',
    actorLabel: 'Ana',
    candidateName: '',
  }).includes('un candidato'),
  'nombre vacío usa un candidato',
);

console.log('\n=== Dedupe en memoria ===\n');

function uniqueErr() {
  const err = new Error('Unique constraint failed');
  err.code = 'P2002';
  err.meta = { target: ['organizationId', 'dedupeKey'] };
  return err;
}

function memoryTx() {
  const rows = [];
  const inflight = new Map();
  return {
    rows,
    orgNotification: {
      async upsert({ where, create }) {
        const { organizationId, dedupeKey } = where.organizationId_dedupeKey;
        const key = `${organizationId}\0${dedupeKey}`;
        const found = rows.find(
          (row) => row.organizationId === organizationId && row.dedupeKey === dedupeKey,
        );
        if (found) throw uniqueErr();
        if (inflight.has(key)) {
          await inflight.get(key);
          throw uniqueErr();
        }
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        inflight.set(key, gate);
        await Promise.resolve();
        const row = { id: `n${rows.length + 1}`, ...create };
        rows.push(row);
        inflight.delete(key);
        release();
        return row;
      },
      async findUnique({ where }) {
        const { organizationId, dedupeKey } = where.organizationId_dedupeKey;
        return (
          rows.find((row) => row.organizationId === organizationId && row.dedupeKey === dedupeKey) ||
          null
        );
      },
    },
  };
}

const tx = memoryTx();
const first = await notifyRecruitmentCandidateCreated(tx, {
  organizationId: 'org-a',
  candidateId: 'cand-1',
  candidateName: 'Juan Pérez',
  actorKind: 'admin',
  actorLabel: 'María López',
});
const second = await notifyRecruitmentCandidateCreated(tx, {
  organizationId: 'org-a',
  candidateId: 'cand-1',
  candidateName: 'Otro nombre',
  actorKind: 'workforce',
  actorLabel: 'Otra persona',
  vacancyTitle: 'No debió reescribirse',
});
check(tx.rows.length === 1, 'mismo candidateId produce una notificación');
check(first.id === second.id, 'reintento devuelve la misma fila');
check(second.message === first.message, 'el primer mensaje se conserva');
check(second.message === 'María López agregó a Juan Pérez como nuevo candidato.', 'actor y candidato del primer aviso');
check(!second.recruitmentVacancyId, 'un reintento no adjunta vacante posterior');

const [raceA, raceB] = await Promise.all([
  notifyRecruitmentCandidateCreated(tx, {
    organizationId: 'org-a',
    candidateId: 'cand-race',
    candidateName: 'Ana',
    actorKind: 'admin',
    actorLabel: 'María',
  }),
  notifyRecruitmentCandidateCreated(tx, {
    organizationId: 'org-a',
    candidateId: 'cand-race',
    candidateName: 'Ana',
    actorKind: 'workforce',
    actorLabel: 'Pedro',
  }),
]);
check(
  tx.rows.filter((row) => row.dedupeKey === 'recruitment_candidate_created:cand-race').length === 1,
  'dos solicitudes concurrentes no duplican',
);
check(raceA.id === raceB.id, 'la concurrencia converge en la misma fila');

const otherOrg = await notifyRecruitmentCandidateCreated(tx, {
  organizationId: 'org-b',
  candidateId: 'cand-1',
  candidateName: 'Juan Pérez',
  actorKind: 'admin',
  actorLabel: 'Otra admin',
});
check(otherOrg.id !== first.id, 'organizaciones distintas quedan aisladas');
check(tx.rows.filter((row) => row.dedupeKey === 'recruitment_candidate_created:cand-1').length === 2, 'dedupe es por organización');

const sameOrgOtherCandidate = await notifyRecruitmentCandidateCreated(tx, {
  organizationId: 'org-a',
  candidateId: 'cand-2',
  candidateName: 'Juan Pérez',
  actorKind: 'admin',
  actorLabel: 'María López',
});
check(sameOrgOtherCandidate.id !== first.id, 'otro candidateId genera otro aviso aunque el nombre coincida');
check(
  tx.rows.filter((row) => row.organizationId === 'org-a' && row.dedupeKey.endsWith('cand-2')).length === 1,
  'el dedupe no usa nombre, correo ni CURP',
);

let otherDbRejected = false;
try {
  await notifyRecruitmentCandidateCreated(
    {
      orgNotification: {
        async upsert() {
          const err = new Error('relation missing');
          err.code = 'P2021';
          throw err;
        },
        async findUnique() {
          return null;
        },
      },
    },
    {
      organizationId: 'org-a',
      candidateId: 'cand-err',
      candidateName: 'Ana',
      actorKind: 'admin',
      actorLabel: 'María',
    },
  );
} catch (err) {
  otherDbRejected = err?.code === 'P2021';
}
check(otherDbRejected, 'un error de base distinto no se convierte en éxito');

console.log('\n=== Contrato de emisión ===\n');

check(/RECRUITMENT_CANDIDATE_CREATED/.test(schema), 'enum en el schema');
check(/recruitmentCandidateId/.test(schema) && /onDelete: SetNull/.test(schema), 'FKs opcionales en SetNull');
check(/ADD VALUE 'RECRUITMENT_CANDIDATE_CREATED'/.test(migration), 'migración agrega el enum');
check(!/INSERT INTO "OrgNotification"|UPDATE "OrgNotification"/i.test(migration), 'migración sin backfill');
check(!/\bDEFAULT\b|\bNOT NULL\b/i.test(migration), 'columnas nuevas sin default ni NOT NULL');
check(/ON DELETE SET NULL/.test(migration), 'borrar candidato no borra el aviso');
check(/recruitment_candidate_created:\$\{candidateId\}/.test(notifSvc), 'clave determinista');
check(/update: \{\}/.test(notifSvc), 'upsert no reescribe el aviso');
check(/isDedupeUniqueConflict/.test(notifSvc) && /if \(!isDedupeUniqueConflict\(err\)\) throw err;/.test(notifSvc), 'solo el conflicto de dedupe se relee');
check(!/notifyGoalPeriodReportedByEmployee[\s\S]*P2002/.test(notifSvc), 'el catch no cae dentro de metas');
const createFn = sliceBetween(candidateSvc, 'export async function createRecruitmentCandidate(', 'export async function getRecruitmentCandidate');
check(!createFn.includes('notifyRecruitmentCandidateCreated'), 'crear el registro base no avisa');
check(/notifyRecruitmentCandidateCreated\(tx/.test(createSvc), 'el aviso vive en la transacción de orquestación');
check(/prisma\.\$transaction/.test(createSvc), 'candidato, postulación y aviso en una transacción');
check(!/notifyRecruitmentCandidateCreated/.test(applicationSvc), 'una postulación posterior no avisa candidato nuevo');
const postCandidates = sliceBetween(routes, "router.post('/candidates'", "router.get('/candidates'");
check(postCandidates.includes('createRecruitmentCandidateAndNotify'), 'alta admin usa la orquestación');
check(postCandidates.includes('u.organizationId') && postCandidates.includes('u.fullName'), 'actor y organización salen de la sesión');
check(!/actorName|createdBy|employeeId/.test(postCandidates), 'el alta admin no lee actor desde el body');
const parseRoute = sliceBetween(routes, "'/candidates/resume/parse'", "router.get('/candidates/:candidateId/resume'");
check(!parseRoute.includes('createRecruitmentCandidate') && !parseRoute.includes('notifyRecruitment'), 'analizar CV no crea ni avisa');
const patchRoute = sliceBetween(routes, "router.patch('/candidates/:id'", "router.post('/vacancies/:vacancyId/applications'");
check(!patchRoute.includes('notifyRecruitmentCandidateCreated'), 'editar candidato no avisa');
const assignRoute = sliceBetween(
  routes,
  "router.post('/vacancies/:vacancyId/applications'",
  "router.get('/vacancies/:vacancyId/applications'",
);
check(
  assignRoute.includes('createRecruitmentApplication') && !assignRoute.includes('notifyRecruitmentCandidateCreated'),
  'asignación posterior no emite CANDIDATE_CREATED',
);
check(portalSvc.includes("actorKind: 'workforce'") && portalSvc.includes('employee.fullName'), 'portal usa el nombre del colaborador en servidor');
check(/\.strict\(\)/.test(portalSvc), 'el portal rechaza campos extra del cliente');
check(!/createRecruitmentCandidate\(/.test(portalSvc), 'el portal no crea por la función base');
check(applicationSvc.includes('db ? await run(db) : await prisma.$transaction(run)'), 'la postulación acepta tx sin anidar otra');
check(/findMany\(\{\s*where,\s*orderBy:/.test(notifSvc) && !/include:[\s\S]{0,80}recruitmentCandidate/.test(notifSvc), 'el listado no vuelve a consultar candidato');
check(/recruitmentCandidateId: row\.recruitmentCandidateId/.test(notifSvc), 'el listado proyecta ids ya guardados');
check(/organizationId: u\.organizationId|req\.session/.test(notifRoutes), 'rutas de campana autenticadas');

console.log('\n=== Campana y deep-link ===\n');

check(indexHtml === publicHtml, 'HTML raíz y public idénticos');
check(/MIND24_NOTIF_POLL_MS=60000/.test(indexHtml), 'polling de 60 segundos');
check((indexHtml.match(/setInterval\(mind24NotifRefreshBadge/g) || []).length === 1, 'un solo intervalo de campana');
check(/RECRUITMENT_CANDIDATE_CREATED/.test(indexHtml), 'tipo en la campana');
check(/mind24-notif-item-mark--candidate/.test(indexHtml) && /M19 8v6/.test(indexHtml), 'icono de usuario con más');
check(/mind24-notif-item-dot--candidate/.test(indexHtml), 'marca de color de reclutamiento');
check(/data-notif-id=/.test(indexHtml) && /getAttribute\('data-notif-id'\)/.test(indexHtml), 'apertura por data-notif-id');
check(!/onclick="mind24NotifOpenItem\(/.test(indexHtml), 'el id no se interpola en onclick');
check(/title="'\+tcEsc\(n\.message\)/.test(indexHtml) && /tcEsc\(n\.message\)/.test(indexHtml), 'mensaje escapado y título completo');
const openFn = sliceBetween(
  indexHtml,
  'async function mind24NotifOpenRecruitmentCandidate',
  'function mind24NotifEnsureListeners',
);
check(openFn.includes("showView('dash-recruitment')"), 'abre Reclutamiento');
check(openFn.includes('recCandOpenDetail') && openFn.includes('notifyMissing:true'), 'abre el expediente existente');
check(openFn.includes('notifVacancyFocusId'), 'puede enfocar la vacante del aviso');
check(openFn.includes('mind24NotifCandidateNavSeq'), 'ignora una navegación vieja');
check(openFn.includes('El candidato ya no está disponible.'), 'candidato eliminado muestra aviso');
check(
  openFn.includes('recCandDetailAbortPending()') && openFn.includes('recCandDetailFetchSeq++') && openFn.includes('st.candNavIds=[]'),
  'candidato eliminado invalida la carga y el snapshot anterior',
);
check(!openFn.includes('location.reload'), 'el deep-link no recarga la página');
check(/let recVacLoadSeq=0/.test(indexHtml), 'las cargas de vacantes tienen secuencia');
check(/if\(opts\.notifyMissing\)/.test(indexHtml), '404 del expediente no bloquea la navegación');
check(/j\.application&&j\.application\.id/.test(indexHtml), 'no reasigna si la alta ya creó la postulación');
const dupeFn = sliceBetween(indexHtml, 'async function recCandDupeCreateAnyway', 'async function recCandCreateAndOpen');
check(dupeFn.includes('recCandCreateAndOpen(body)') && dupeFn.includes('recCandWorkforceCreateAndConfirm(body)'), 'crear de todos modos usa el mismo alta');
check(/\/notifications\/:id\/read/.test(notifRoutes) && /read-all/.test(notifRoutes), 'lectura individual y read-all existentes');

console.log('\n=== El body no elige actor ni tenant ===\n');

const { candidateCreateSchema } = await import('../src/routes/org.recruitment.routes.js');
const { workforceCandidateCreateSchema } = await import('../src/services/workforceRecruitmentPortal.service.js');
const poisoned = {
  fullName: 'Juan Pérez',
  profile: 'Operaciones',
  whatsapp: '4421112233',
  actor: 'Intruso',
  actorId: 'user-1',
  actorName: 'Intruso',
  createdBy: 'user-1',
  userId: 'user-1',
  employeeId: 'emp-1',
  organizationId: 'org-evil',
  candidateId: 'cand-evil',
  type: 'RECRUITMENT_CANDIDATE_CREATED',
  dedupeKey: 'recruitment_candidate_created:cand-evil',
};
const adminParsed = candidateCreateSchema.parse(poisoned);
for (const key of [
  'actor',
  'actorId',
  'actorName',
  'createdBy',
  'userId',
  'employeeId',
  'organizationId',
  'candidateId',
  'type',
  'dedupeKey',
]) {
  check(!(key in adminParsed), `admin descarta ${key} enviado en el body`);
}
let portalRejected = false;
try {
  workforceCandidateCreateSchema.parse(poisoned);
} catch {
  portalRejected = true;
}
check(portalRejected, 'portal rechaza actor, organización, tipo y dedupe del body');

console.log('\n=== Integración Postgres ===\n');

let integration = 'SKIP';
try {
  const { prisma } = await import('../src/db/client.js');
  await prisma.$queryRaw`SELECT 1`;
  const enums = await prisma.$queryRaw`
    SELECT e.enumlabel AS label
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'OrgNotificationType'
      AND e.enumlabel = 'RECRUITMENT_CANDIDATE_CREATED'
  `;
  if (!Array.isArray(enums) || enums.length === 0) {
    integration = 'SKIP';
    console.log('  SKIP integration: Postgres responde, pero la migración del aviso no está aplicada. No se ejecutó migrate.');
  } else {
    integration = 'RAN';
    console.log('  OK  enum presente; no se certificó un alta completa en esta corrida.');
  }
  await prisma.$disconnect();
} catch (err) {
  integration = 'SKIP';
  console.log(`  SKIP integration: ${err?.message || err}`);
}
if (integration === 'SKIP') {
  console.log('  SKIP no certifica persistencia, dedupe en base ni alta real.');
}

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Aviso de candidato creado OK.\n');

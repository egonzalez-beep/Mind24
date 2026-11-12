/**
 * Reaplicación a la misma vacante tras Declinó / Rechazado (blocksReapplication).
 * node server/scripts/test-recruitment-application-reapply.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(rootDir, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-reapply-test-secret';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
const migrationSql = fs.readFileSync(
  path.join(rootDir, 'prisma/migrations/20261111194500_recruitment_application_blocks_reapplication/migration.sql'),
  'utf8',
);
const appSvc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentApplication.service.js'), 'utf8');
const closureSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentProcessClosure.service.js'),
  'utf8',
);
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const pubHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');

const {
  classifyRecruitmentApplication,
  expectedBlocksReapplication,
  isBlocksReapplicationUniqueViolation,
  BLOCKS_REAPPLICATION_UNIQUE_INDEX,
} = await import('../src/services/recruitmentProcessClosure.service.js');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

console.log('\n=== Reaplicación — invariantes blocksReapplication ===\n');

const cases = [
  [null, null, true, 'activo sin outcome'],
  ['CONTACT', null, true, 'etapa activa'],
  ['FINALIST', null, true, 'finalista'],
  ['HIRED', null, true, 'contratado bloquea'],
  ['CONTACT', 'DECLINED', false, 'declinó'],
  ['REJECTED', 'REJECTED', false, 'rechazado con outcome'],
  ['REJECTED', null, false, 'rechazado histórico solo etapa'],
  ['HIRED', 'DECLINED', true, 'HIRED nunca false aunque outcome raro'],
];
for (const [stageKey, outcome, expected, label] of cases) {
  const kind = classifyRecruitmentApplication(stageKey, outcome);
  const got = expectedBlocksReapplication(stageKey, outcome);
  check(got === expected, `invariante ${label}: classify=${kind} → blocks=${got}`);
}
check(
  expectedBlocksReapplication('HIRED', null) === true &&
    classifyRecruitmentApplication('HIRED', null) === 'hired',
  'invariante hired: classify=hired y blocks=true',
);
check(
  expectedBlocksReapplication('CONTACT', 'DECLINED') === false &&
    classifyRecruitmentApplication('CONTACT', 'DECLINED') === 'declined',
  'invariante declined: classify=declined y blocks=false',
);
check(
  expectedBlocksReapplication('APROBADO', null) === true &&
    classifyRecruitmentApplication('APROBADO', null) === 'active',
  'etapa futura desconocida (Aprobado) bloquea por default',
);
check(
  expectedBlocksReapplication('UNKNOWN_STAGE', null) === true,
  'condición desconocida bloquea por seguridad',
);

check(
  BLOCKS_REAPPLICATION_UNIQUE_INDEX ===
    'RecruitmentApplication_candidate_vacancy_blocks_reapplication_key',
  'nombre estable del índice parcial',
);
check(
  isBlocksReapplicationUniqueViolation({
    code: 'P2002',
    meta: { target: [BLOCKS_REAPPLICATION_UNIQUE_INDEX] },
  }),
  'P2002 del índice parcial reconocido',
);
check(
  isBlocksReapplicationUniqueViolation({
    code: 'P2002',
    meta: { target: ['candidateId', 'vacancyId'] },
  }),
  'P2002 con campos candidateId+vacancyId (meta Prisma) reconocido',
);
check(
  !isBlocksReapplicationUniqueViolation({
    code: 'P2002',
    meta: { target: ['organizationId', 'dedupeKey'] },
  }),
  'otro P2002 no se traduce a conflicto de vacante',
);
check(
  !isBlocksReapplicationUniqueViolation({ code: 'P2002', meta: {} }),
  'P2002 sin meta.target no se traduce a 409 de vacante',
);
check(
  !isBlocksReapplicationUniqueViolation({ code: 'P2003', meta: { target: [BLOCKS_REAPPLICATION_UNIQUE_INDEX] } }),
  'códigos distintos de P2002 no se traducen',
);

console.log('\n=== Reaplicación — estático migración / servicio / UI ===\n');

check(/blocksReapplication Boolean @default\(true\)/.test(schema), 'schema columna default true');
check(
  !/^\s*@@unique\(\[candidateId,\s*vacancyId\]\)/m.test(schema),
  'schema sin unique absoluto',
);
check(
  /RecruitmentApplication_candidate_vacancy_blocks_reapplication_key/.test(schema),
  'schema documenta el índice parcial por comentario',
);
check(/duplicate candidateId\+vacancyId pairs/.test(migrationSql), 'migración aborta si hay duplicados');
check(
  migrationSql.indexOf('RAISE EXCEPTION') < migrationSql.indexOf('ADD COLUMN'),
  'verificación de duplicados antes de ALTER',
);
check(/ADD COLUMN "blocksReapplication" BOOLEAN NOT NULL DEFAULT true/.test(migrationSql), 'columna NOT NULL DEFAULT true');
check(/UPDATE "RecruitmentApplication" AS a/.test(migrationSql), 'backfill SQL');
check(/FROM "RecruitmentStage" AS s/.test(migrationSql), 'backfill une RecruitmentStage');
check(/closureOutcome' = 'DECLINED'/.test(migrationSql) || /"closureOutcome" = 'DECLINED'/.test(migrationSql), 'backfill Declined → false');
check(/"closureOutcome" = 'REJECTED'/.test(migrationSql), 'backfill REJECTED outcome → false');
check(/s\."key" = 'REJECTED'/.test(migrationSql), 'backfill REJECTED por etapa → false');
check(!/\bDELETE\b/i.test(migrationSql), 'migración sin DELETE');
check(
  migrationSql.includes(`CREATE UNIQUE INDEX "${BLOCKS_REAPPLICATION_UNIQUE_INDEX}"`),
  'CREATE UNIQUE INDEX parcial con nombre del servicio',
);
check(
  /DROP INDEX IF EXISTS "RecruitmentApplication_candidateId_vacancyId_key"/.test(migrationSql),
  'DROP unique absoluto después del parcial',
);
check(
  migrationSql.indexOf('CREATE UNIQUE INDEX') <
    migrationSql.indexOf('DROP INDEX IF EXISTS "RecruitmentApplication_candidateId_vacancyId_key"'),
  'orden: parcial antes de drop absoluto',
);

const createBody = appSvc.slice(
  appSvc.indexOf('export async function createRecruitmentApplication'),
  appSvc.indexOf('export async function listRecruitmentApplicationsForVacancy'),
);
const lockAt = createBody.indexOf('lockRecruitmentCandidateForProcessChange(tx, candidateId)');
const vacAt = createBody.indexOf('assertRecruitmentVacancyInOrg');
const blockAt = createBody.indexOf('findFirst');
const unarchiveAt = createBody.indexOf('archivedAt: null');
const createAt = createBody.indexOf('recruitmentApplication.create');
const syncAt = createBody.indexOf('syncCandidateAutoArchive');
check(lockAt >= 0 && lockAt < vacAt && vacAt < blockAt && blockAt < unarchiveAt && unarchiveAt < createAt && createAt < syncAt,
  'orden TX: candado → vacante → bloqueo → desarchivo → create → sync');
check(/blocksReapplication:\s*true/.test(appSvc), 'create fija true');
check(/isBlocksReapplicationUniqueViolation/.test(appSvc), 'traduce P2002 específico');
check(/El candidato ya está asignado a esta vacante\./.test(appSvc), 'mensaje 409 estable');
check(/blocksReapplication: false/.test(closureSvc), 'decline → false');
check(/blocksReapplication: false/.test(closureSvc.match(/toStageKey === 'REJECTED'[\s\S]{0,200}/)?.[0] || ''), 'move REJECTED → false');
check(
  !/blocksReapplication\s*[:=]/.test(
    fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8'),
  ),
  'rutas no aceptan patches directos de blocksReapplication',
);

check(/recCandVacancyPriorParticipation/.test(indexHtml), 'UI participación previa');
check(/Participó antes · Declinó/.test(indexHtml), 'copy Declinó');
check(/Participó antes · Rechazado/.test(indexHtml), 'copy Rechazado');
check(/permanecerá en el historial/.test(indexHtml), 'confirmación reincorporación');
check(
  /async function recCandSubmitAddVacancy[\s\S]{0,800}window\.confirm\(/.test(indexHtml),
  'reapply usa window.confirm (deuda visual; no hay diálogo Mind24 reutilizable)',
);
check(!/duplicar candidato/i.test(indexHtml), 'sin copy duplicar candidato');
check(/Al añadir una vacante se creará un nuevo proceso/.test(indexHtml), 'archivado puede añadir vacante');
check(pubHtml === indexHtml, 'index.html raíz idéntico a server/public');

check(
  /Talento registrado|enteredProcess|distinct:\s*\['candidateId'\]/.test(
    fs.readFileSync(path.join(rootDir, 'src/services/recruitmentMetrics.service.js'), 'utf8'),
  ),
  'métricas: enteredProcess sigue por candidatos distintos',
);

console.log('\n=== Reaplicación — integración PG ===\n');

let pgSkip = false;
async function runPg() {
  const { prisma } = await import('../src/db/client.js');
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    pgSkip = true;
    console.log('  SKIP  PostgreSQL no disponible');
    return;
  }

  const { createApp } = await import('../src/app.js');
  const { hashPassword } = await import('../src/services/auth.service.js');
  const { createRecruitmentApplication } = await import(
    '../src/services/recruitmentApplication.service.js'
  );
  const { declineRecruitmentApplication } = await import(
    '../src/services/recruitmentProcessClosure.service.js'
  );
  const { ensureOrgRecruitmentStages } = await import('../src/services/recruitmentStage.service.js');

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const pass = 'ReapplyTest!9x';

  async function jsonFetch(urlPath, { method = 'GET', body, cookie } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { res, data };
  }
  function cookieFrom(res, name) {
    for (const line of res.headers.getSetCookie?.() || []) {
      const part = line.split(';')[0];
      if (part.startsWith(`${name}=`)) return part;
    }
    return '';
  }

  const org = await prisma.organization.create({
    data: { name: 'Reapply Org', slug: `reapply-${Date.now()}`, credits: 10 },
  });
  const admin = await prisma.user.create({
    data: {
      email: `reapply-${Date.now()}@test.local`,
      passwordHash: await hashPassword(pass),
      fullName: 'Admin Reapply',
      role: 'empresa_admin',
      organizationId: org.id,
    },
  });
  await ensureOrgRecruitmentStages(org.id);
  const stages = await prisma.recruitmentStage.findMany({ where: { organizationId: org.id } });
  const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));
  const vac = await prisma.recruitmentVacancy.create({
    data: {
      organizationId: org.id,
      title: 'Vacante Reapply',
      status: 'ACTIVE',
      openedAt: new Date(),
    },
  });
  const cand = await prisma.recruitmentCandidate.create({
    data: {
      organizationId: org.id,
      fullName: 'Cand Reapply',
      profile: 'Operador',
      phone: '5511111111',
    },
  });

  try {
    const login = await jsonFetch('/api/auth/login', {
      method: 'POST',
      body: { email: admin.email, password: pass },
    });
    const cookie = cookieFrom(login.res, 'mind24.sid');

    const first = await createRecruitmentApplication({
      organizationId: org.id,
      vacancyId: vac.id,
      candidateId: cand.id,
      changedByUserId: admin.id,
    });
    check(first.blocksReapplication === true, '1 alta inicial blocks=true');

    const activeConflict = await jsonFetch(`/api/org/recruitment/vacancies/${vac.id}/applications`, {
      method: 'POST',
      cookie,
      body: { candidateId: cand.id },
    });
    check(activeConflict.res.status === 409, '4 activo → 409');

    await declineRecruitmentApplication({
      organizationId: org.id,
      applicationId: first.id,
      reason: 'PERSONAL',
      createdByUserId: admin.id,
    });
    const afterDecline = await prisma.recruitmentApplication.findUnique({ where: { id: first.id } });
    check(afterDecline.blocksReapplication === false, 'Declinó → blocks=false');

    const second = await createRecruitmentApplication({
      organizationId: org.id,
      vacancyId: vac.id,
      candidateId: cand.id,
      changedByUserId: admin.id,
    });
    check(second.id !== first.id && second.blocksReapplication === true, '1 Declinó → nuevo proceso');
    const eventsNew = await prisma.recruitmentApplicationStageEvent.count({
      where: { applicationId: second.id },
    });
    const eventsOld = await prisma.recruitmentApplicationStageEvent.count({
      where: { applicationId: first.id },
    });
    check(eventsNew >= 1 && eventsOld >= 1, '11 eventos separados por applicationId');
    const interviewsNew = await prisma.recruitmentApplicationInterviewEvent.count({
      where: { applicationId: second.id },
    });
    check(interviewsNew === 0, '11 nuevo sin entrevistas heredadas');

    await prisma.recruitmentApplication.update({
      where: { id: second.id },
      data: {
        stageId: byKey.REJECTED.id,
        closureOutcome: 'REJECTED',
        closedAt: new Date(),
        blocksReapplication: false,
      },
    });

    await prisma.recruitmentCandidate.update({
      where: { id: cand.id },
      data: { archivedAt: new Date(), autoArchiveEligibleAt: null },
    });
    const third = await createRecruitmentApplication({
      organizationId: org.id,
      vacancyId: vac.id,
      candidateId: cand.id,
      changedByUserId: admin.id,
    });
    const candFresh = await prisma.recruitmentCandidate.findUnique({ where: { id: cand.id } });
    check(!candFresh.archivedAt && third.blocksReapplication === true, '7 archivado → desarchivo + nuevo');

    await prisma.recruitmentApplication.update({
      where: { id: third.id },
      data: {
        stageId: byKey.HIRED.id,
        hiredStageEnteredAt: new Date(),
        blocksReapplication: true,
        closureOutcome: null,
        closedAt: null,
      },
    });
    const hiredBlock = await jsonFetch(`/api/org/recruitment/vacancies/${vac.id}/applications`, {
      method: 'POST',
      cookie,
      body: { candidateId: cand.id },
    });
    check(hiredBlock.res.status === 409, '5 HIRED → 409');

    const histReject = await prisma.recruitmentApplication.create({
      data: {
        organizationId: org.id,
        candidateId: cand.id,
        vacancyId: vac.id,
        stageId: byKey.REJECTED.id,
        position: 1,
        appliedAt: new Date('2025-01-01T00:00:00.000Z'),
        closureOutcome: null,
        blocksReapplication: false,
      },
    });
    check(histReject.blocksReapplication === false, '3 rechazo histórico stage-only permite slot');

    const vac2 = await prisma.recruitmentVacancy.create({
      data: {
        organizationId: org.id,
        title: 'Otra vacante',
        status: 'ACTIVE',
        openedAt: new Date(),
      },
    });
    const otherVac = await createRecruitmentApplication({
      organizationId: org.id,
      vacancyId: vac2.id,
      candidateId: cand.id,
      changedByUserId: admin.id,
    });
    check(otherVac.blocksReapplication === true, 'misma persona en otra vacante OK');

    const orgB = await prisma.organization.create({
      data: { name: 'Org B', slug: `reapply-b-${Date.now()}`, credits: 5 },
    });
    const adminB = await prisma.user.create({
      data: {
        email: `reapply-b-${Date.now()}@test.local`,
        passwordHash: await hashPassword(pass),
        fullName: 'B',
        role: 'empresa_admin',
        organizationId: orgB.id,
      },
    });
    const loginB = await jsonFetch('/api/auth/login', {
      method: 'POST',
      body: { email: adminB.email, password: pass },
    });
    const cookieB = cookieFrom(loginB.res, 'mind24.sid');
    const cross = await jsonFetch(`/api/org/recruitment/vacancies/${vac.id}/applications`, {
      method: 'POST',
      cookie: cookieB,
      body: { candidateId: cand.id },
    });
    check(cross.res.status === 404 || cross.res.status === 403 || cross.res.status === 409, '9 aislamiento org');

    await prisma.recruitmentApplication.updateMany({
      where: { candidateId: cand.id, vacancyId: vac.id, blocksReapplication: true },
      data: {
        stageId: byKey.CONTACT.id,
        closureOutcome: 'DECLINED',
        closedAt: new Date(),
        blocksReapplication: false,
        hiredStageEnteredAt: null,
      },
    });
    const race = await Promise.all([
      createRecruitmentApplication({
        organizationId: org.id,
        vacancyId: vac.id,
        candidateId: cand.id,
        changedByUserId: admin.id,
      })
        .then((r) => ({ ok: true, id: r.id }))
        .catch((e) => ({ ok: false, code: e.code })),
      createRecruitmentApplication({
        organizationId: org.id,
        vacancyId: vac.id,
        candidateId: cand.id,
        changedByUserId: admin.id,
      })
        .then((r) => ({ ok: true, id: r.id }))
        .catch((e) => ({ ok: false, code: e.code })),
    ]);
    const wins = race.filter((r) => r.ok);
    const loses = race.filter((r) => !r.ok);
    check(wins.length === 1 && loses.length === 1 && loses[0].code === 'CONFLICT', '8 concurrentes → uno OK uno 409');
    const blockingCount = await prisma.recruitmentApplication.count({
      where: { candidateId: cand.id, vacancyId: vac.id, blocksReapplication: true },
    });
    check(blockingCount === 1, '8 exactamente una fila blocks=true');

    await prisma.user.delete({ where: { id: adminB.id } });
    await prisma.organization.delete({ where: { id: orgB.id } });
  } finally {
    await new Promise((r) => server.close(r));
    await prisma.recruitmentApplicationInterviewEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.recruitmentApplicationStageEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.workforceRecruitmentNovedad.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.recruitmentApplication.deleteMany({ where: { organizationId: org.id } });
    await prisma.recruitmentVacancyStage.deleteMany({ where: { vacancy: { organizationId: org.id } } }).catch(() => {});
    await prisma.recruitmentVacancy.deleteMany({ where: { organizationId: org.id } });
    await prisma.recruitmentCandidate.deleteMany({ where: { organizationId: org.id } });
    await prisma.recruitmentStage.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

await runPg().catch((e) => {
  if (String(e.message || e).includes('connect') || e.code === 'P1001') {
    pgSkip = true;
    console.log('  SKIP  PostgreSQL no disponible');
  } else {
    console.error('  FAIL  integración:', e.message || e);
    failed += 1;
  }
});

console.log('\n=== Reaplicación — visual 6 escenarios (HTML real) ===\n');

function chromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((item) => fs.existsSync(item)) || null;
}

async function runVisualReapply() {
  const http = await import('http');
  const executablePath = chromePath();
  if (!executablePath) {
    check(false, 'Chrome o Edge local para escenarios visuales de reaplicación');
    return;
  }
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
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const ready = await page.evaluate(
      () =>
        typeof recCandVacancyPriorParticipation === 'function' &&
        typeof recCandSyncAddVacancyParticipationUi === 'function' &&
        typeof recCandHistoryAsideHtml === 'function' &&
        typeof recCandPartitionApplications === 'function',
    );
    check(ready, 'HTML real expone helpers de reaplicación');
    if (!ready) return;

    async function probeVacancyUi(candidate, vacancyId) {
      return page.evaluate(
        (c, vacId) => {
          const st = recEnsureState();
          st.detailCandidateId = c.id;
          st.detailCandidate = c;
          const sel = document.getElementById('rec-cand-add-vac-select');
          sel.innerHTML = `<option value="${vacId}">Vacante prueba</option>`;
          sel.value = vacId;
          openModal('modal-rec-candidate-add-vacancy');
          const ui = recCandSyncAddVacancyParticipationUi();
          const hint = document.getElementById('rec-cand-add-vac-hint');
          const note = document.getElementById('rec-cand-add-vac-reapply-note');
          const btn = document.getElementById('rec-cand-add-vac-submit');
          const modal = document.getElementById('modal-rec-candidate-add-vacancy');
          const card = modal && modal.querySelector('.rec-cand-add-vac-modal');
          return {
            ui,
            hint: hint ? hint.textContent : '',
            hintHidden: hint ? hint.classList.contains('hidden') : true,
            noteHidden: note ? note.classList.contains('hidden') : true,
            btnDisabled: !!(btn && btn.disabled),
            modalOverflow: card ? card.scrollWidth - card.clientWidth : 999,
            pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        },
        candidate,
        vacancyId,
      );
    }

    const vac = 'vac-reapply';
    const declinedCand = {
      id: 'cand-declined',
      fullName: 'Ana Declinó',
      archivedAt: null,
      applications: [
        {
          applicationId: 'app-decl-1',
          appliedAt: '2026-10-01T12:00:00.000Z',
          closedAt: '2026-10-15T12:00:00.000Z',
          closureOutcome: 'DECLINED',
          blocksReapplication: false,
          vacancy: { id: vac, title: 'Operador', clientName: 'Norte' },
          stage: { id: 's1', key: 'CONTACT', name: 'Contacto' },
        },
      ],
    };
    const rejectedCand = {
      id: 'cand-rej',
      fullName: 'Luis Rechazado',
      archivedAt: null,
      applications: [
        {
          applicationId: 'app-rej-1',
          appliedAt: '2026-09-01T12:00:00.000Z',
          closedAt: '2026-09-20T12:00:00.000Z',
          closureOutcome: 'REJECTED',
          blocksReapplication: false,
          vacancy: { id: vac, title: 'Operador', clientName: 'Norte' },
          stage: { id: 's2', key: 'REJECTED', name: 'Descartado' },
        },
      ],
    };
    const activeCand = {
      id: 'cand-act',
      fullName: 'Pedro Activo',
      archivedAt: null,
      applications: [
        {
          applicationId: 'app-act-1',
          appliedAt: '2026-11-01T12:00:00.000Z',
          closureOutcome: null,
          blocksReapplication: true,
          vacancy: { id: vac, title: 'Operador', clientName: 'Norte' },
          stage: { id: 's3', key: 'FINALIST', name: 'Finalista' },
        },
      ],
    };
    const hiredCand = {
      id: 'cand-hired',
      fullName: 'María Contratada',
      archivedAt: null,
      applications: [
        {
          applicationId: 'app-hired-1',
          appliedAt: '2026-08-01T12:00:00.000Z',
          terminalOutcomeAt: '2026-08-20T12:00:00.000Z',
          closureOutcome: null,
          blocksReapplication: true,
          vacancy: { id: vac, title: 'Operador', clientName: 'Norte' },
          stage: { id: 's4', key: 'HIRED', name: 'Contratado' },
        },
      ],
    };
    const archivedCand = {
      id: 'cand-arch',
      fullName: 'Carla Archivada',
      archivedAt: '2026-11-10T12:00:00.000Z',
      applications: [
        {
          applicationId: 'app-arch-1',
          appliedAt: '2026-07-01T12:00:00.000Z',
          closedAt: '2026-07-15T12:00:00.000Z',
          closureOutcome: 'DECLINED',
          blocksReapplication: false,
          vacancy: { id: vac, title: 'Operador', clientName: 'Norte' },
          stage: { id: 's5', key: 'CONTACT', name: 'Contacto' },
        },
      ],
    };
    const multiCand = {
      id: 'cand-multi',
      fullName: 'Diego Multi',
      archivedAt: null,
      applications: [
        {
          applicationId: 'app-hist-a',
          appliedAt: '2026-05-01T12:00:00.000Z',
          closedAt: '2026-05-20T12:00:00.000Z',
          closureOutcome: 'DECLINED',
          blocksReapplication: false,
          vacancy: { id: vac, title: 'Operador', clientName: 'Norte' },
          stage: { id: 's6', key: 'CONTACT', name: 'Contacto' },
        },
        {
          applicationId: 'app-hist-b',
          appliedAt: '2026-07-01T12:00:00.000Z',
          closedAt: '2026-07-22T12:00:00.000Z',
          terminalOutcomeAt: '2026-07-22T12:00:00.000Z',
          closureOutcome: 'REJECTED',
          blocksReapplication: false,
          vacancy: { id: vac, title: 'Operador', clientName: 'Norte' },
          stage: { id: 's7', key: 'REJECTED', name: 'Descartado' },
        },
        {
          applicationId: 'app-active-new',
          appliedAt: '2026-11-05T12:00:00.000Z',
          closureOutcome: null,
          blocksReapplication: true,
          vacancy: { id: vac, title: 'Operador', clientName: 'Norte' },
          stage: { id: 's8', key: 'CONTACT', name: 'Contacto' },
        },
      ],
    };

    for (const width of [1280, 900, 390]) {
      await page.setViewport({ width, height: 800 });
      const d = await probeVacancyUi(declinedCand, vac);
      check(
        d.ui.ok && d.ui.reapply && d.hint === 'Participó antes · Declinó' && !d.btnDisabled && !d.noteHidden,
        `${width}px: Declinó permite seleccionar y muestra hint`,
      );
      check(d.modalOverflow <= 1 && d.pageOverflow <= 1, `${width}px: modal Declinó sin desborde`);
    }

    await page.setViewport({ width: 1280, height: 800 });
    const r = await probeVacancyUi(rejectedCand, vac);
    check(
      r.ui.ok && r.ui.reapply && r.hint === 'Participó antes · Rechazado' && !r.btnDisabled,
      'Rechazado permite seleccionar y muestra hint',
    );

    const a = await probeVacancyUi(activeCand, vac);
    check(a.ui.ok === false && a.btnDisabled && /vigente/.test(a.hint), 'activo no permite otro proceso');

    const h = await probeVacancyUi(hiredCand, vac);
    check(h.ui.ok === false && h.btnDisabled && /vigente/.test(h.hint), 'Contratado no permite otro proceso');

    const arch = await probeVacancyUi(archivedCand, vac);
    check(
      arch.ui.ok && arch.ui.reapply && arch.hint === 'Participó antes · Declinó',
      'archivado con Declinó puede iniciar nuevo proceso',
    );

    const hist = await page.evaluate((c) => {
      const st = recEnsureState();
      st.detailCandidate = c;
      st.recruitmentOrgTimeZone = 'America/Mexico_City';
      const parts = recCandPartitionApplications(c.applications);
      const host = document.createElement('div');
      host.style.width = '360px';
      host.innerHTML = recCandHistoryAsideHtml(parts.closed);
      document.body.appendChild(host);
      const items = [...host.querySelectorAll('.rec-cand-history-item')];
      const dateIds = [...host.querySelectorAll('time')].map((el) => el.id);
      const primary = recCandPickPrimaryApplication(st, parts.active);
      const prior = recCandVacancyPriorParticipation(c.applications, 'vac-reapply');
      return {
        closedCount: parts.closed.length,
        activeCount: parts.active.length,
        historyRows: items.length,
        outcomes: items.map((item) => (item.querySelector('.rec-cand-history-outcome') || {}).textContent || ''),
        periods: items.map((item) => (item.querySelector('.rec-cand-history-period') || {}).textContent || ''),
        dateIds,
        primaryId: primary && (primary.applicationId || primary.id),
        priorBlocking: prior.blocking,
        dedupeKeys: items.map((_, i) => parts.closed[i] && parts.closed[i].applicationId),
      };
    }, multiCand);
    check(
      hist.closedCount === 2 && hist.historyRows === 2 && hist.activeCount === 1,
      'historial: dos intentos históricos + uno activo (sin dedupe por vacancyId)',
    );
    check(
      hist.outcomes.includes('Declinó') && hist.outcomes.includes('Rechazado'),
      'historial distingue Declinó y Rechazado',
    );
    check(hist.periods.every((p) => /Inicio /.test(p)), 'historial distingue por fecha de inicio');
    check(hist.primaryId === 'app-active-new', 'proceso activo es el contexto principal');
    check(hist.priorBlocking === true, 'con activo vigente la vacante bloquea reaplicación');
    check(
      hist.dedupeKeys.includes('app-hist-a') && hist.dedupeKeys.includes('app-hist-b'),
      'claves visuales usan applicationId distintos',
    );
    check(
      hist.dateIds.every((id) => /app-hist-/.test(id)),
      'ids de fecha terminal anclados a applicationId',
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

await runVisualReapply().catch((e) => {
  console.error('  FAIL  visual reapply:', e.message || e);
  failed += 1;
});

if (failed) {
  console.error(`\n✗ ${failed} fallo(s)${pgSkip ? ' (PG skipped)' : ''}\n`);
  process.exit(1);
}
console.log(`\n✓ Reaplicación tests OK${pgSkip ? ' (PG skipped)' : ''}.\n`);

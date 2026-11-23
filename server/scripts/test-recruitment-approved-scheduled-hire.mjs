/**
 * Aprobado + programación de ingreso + recordatorio Admin.
 * node server/scripts/test-recruitment-approved-scheduled-hire.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(serverDir, '..');
dotenv.config({ path: path.join(serverDir, '.env') });
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'approved-scheduled-hire-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

console.log('\n=== Aprobado / programación / recordatorio — estático ===\n');

const schema = fs.readFileSync(path.join(serverDir, 'prisma/schema.prisma'), 'utf8');
const migPath = path.join(
  serverDir,
  'prisma/migrations/20261123010000_recruitment_approved_scheduled_hire/migration.sql',
);
check(fs.existsSync(migPath), 'migración existe');
const migBuf = fs.readFileSync(migPath);
check(migBuf[0] !== 0xef && migBuf[1] !== 0xbb, 'migración UTF-8 sin BOM');
const mig = migBuf.toString('utf8');
check(/'APPROVED'/.test(mig) && /'Aprobado'/.test(mig), 'etapa Aprobado en catálogo');
check(/scheduledEmploymentStartDate/.test(mig), 'columna fecha programada');
check(/RECRUITMENT_SCHEDULED_HIRE/.test(mig), 'enum aviso Admin');
check(/recruitmentApplicationId/.test(mig), 'vínculo a postulación en OrgNotification');
check(/INSERT INTO "RecruitmentVacancyStage"/.test(mig), 'habilita Aprobado en vacantes');
check(/isEnabled" = true/.test(mig) && /FINALIST/.test(mig), 'migración usa Finalista habilitada');
check(/isTerminal" = true/.test(mig), 'migración cae a primera terminal sin Finalista');
check(!/\bDROP TABLE\b|\bDROP COLUMN\b/.test(mig.replace(/--.*$/gm, '')), 'migración aditiva');

check(/key: 'APPROVED'/.test(schema) || /APPROVED/.test(schema), 'schema APPROVED');
check(/scheduledEmploymentStartDate DateTime\? @db\.Date/.test(schema), 'campo Date en Application');
check(/RECRUITMENT_SCHEDULED_HIRE/.test(schema), 'enum OrgNotificationType');

const stageSvc = fs.readFileSync(path.join(serverDir, 'src/services/recruitmentStage.service.js'), 'utf8');
const vacStageSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/recruitmentVacancyStage.service.js'),
  'utf8',
);
const schedSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/recruitmentApplicationScheduledHire.service.js'),
  'utf8',
);
const remSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/recruitmentScheduledHireReminder.service.js'),
  'utf8',
);
const notifSvc = fs.readFileSync(path.join(serverDir, 'src/services/orgNotification.service.js'), 'utf8');
const appSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/recruitmentApplication.service.js'),
  'utf8',
);
const routes = fs.readFileSync(path.join(serverDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(serverDir, 'src/server.js'), 'utf8');
const coverageSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/recruitmentCoverage.service.js'),
  'utf8',
);

check(/APPROVED_STAGE_KEY/.test(stageSvc) && /name: 'Aprobado'/.test(stageSvc), 'catálogo default Aprobado');
check(/position: 7600/.test(stageSvc), 'posición entre Finalista/No-show y Contratado');
check(/APPROVED/.test(vacStageSvc), 'APPROVED en etapas obligatorias');
check(/setRecruitmentApplicationScheduledHire/.test(schedSvc), 'servicio programar');
check(/clearRecruitmentApplicationScheduledHire/.test(schedSvc), 'servicio quitar');
check(/SCHEDULED_HIRE_PAST_MESSAGE/.test(schedSvc), 'rechaza fechas pasadas');
check(/invalidateScheduledHireNotificationsForApplication/.test(notifSvc), 'invalida avisos previos');
check(/recruitment_scheduled_hire:/.test(notifSvc), 'dedupe por aplicación+fecha');
check(/Pendiente de confirmar/.test(notifSvc), 'mensaje atrasado');
check(/Hoy está previsto el ingreso/.test(notifSvc), 'mensaje del día');
check(/sweepScheduledHireReminders/.test(remSvc), 'barrido de recordatorios');
check(/emitScheduledHireReminderIfEligible/.test(remSvc), 'revalida antes de publicar aviso');
check(/closureOutcome: null/.test(remSvc), 'barrido solo postulaciones abiertas');
check(/expectedScheduledYmd/.test(remSvc), 'emisión exige fecha vigente');
check(/lockRecruitmentApplicationRow/.test(remSvc), 'emisión toma candado de postulación');
check(/startScheduledHireReminderSweep/.test(serverJs), 'sweep en arranque');
check(/scheduled-hire/.test(routes), 'rutas PUT/DELETE scheduled-hire');
check(/isOpenApprovedForScheduledHire/.test(schedSvc), 'programación limitada a Aprobado abierto');
check(
  (schedSvc.match(/lockRecruitmentApplicationRow/g) || []).length >= 2,
  'programar y quitar toman el mismo candado',
);
check(
  /Sale de Aprobado: quita programación/.test(appSvc)
    || /scheduledEmploymentStartDate = null/.test(appSvc.replace(/\s+/g, ' ')),
  'al salir de Aprobado limpia programación',
);
check(
  /leavingApproved/.test(appSvc)
    && /lockRecruitmentApplicationRow/.test(appSvc)
    && /fromClosureOutcome/.test(appSvc),
  'salir de Aprobado toma el candado y relee el cierre',
);
const closureSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/recruitmentProcessClosure.service.js'),
  'utf8',
);
check(
  /clearScheduledHireOnApplication/.test(closureSvc)
    && /scheduledEmploymentStartDate: null/.test(closureSvc)
    && /invalidateScheduledHireNotificationsForApplication/.test(closureSvc),
  'Declinó limpia programación e invalida aviso',
);
check(
  /lockRecruitmentApplicationRow/.test(closureSvc)
    && closureSvc.indexOf('lockRecruitmentApplicationRow')
      < closureSvc.indexOf('recruitmentApplication.findFirst', closureSvc.indexOf('declineRecruitmentApplication')),
  'Declinó adquiere el candado antes de validar',
);
check(/resolveApprovedVacancyStageInsertPosition/.test(vacStageSvc), 'helper posición migración');
check(
  /stageKey !== HIRED_STAGE_KEY/.test(coverageSvc.replace(/\s+/g, ''))
    || /stageKey !== HIRED_STAGE_KEY/.test(coverageSvc),
  'cobertura solo cuenta HIRED (programado no ocupa plaza)',
);

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(serverDir, 'public/index.html'));
check(Buffer.from(indexHtml).equals(publicHtml), 'HTML espejo index ↔ public');
check(/modal-rec-scheduled-hire/.test(indexHtml), 'modal Programar contratación');
check(
  /aria-label="Programar contratación"/.test(indexHtml) && /recScheduledHireIconCalendarPlus/.test(indexHtml),
  'CTA compacto calendario+ en Aprobado',
);
check(
  /aria-label="Cambiar fecha programada"/.test(indexHtml)
    && /aria-label="Quitar programación"/.test(indexHtml)
    && /rec-sched-hire-date/.test(indexHtml),
  'acciones compactas editar/quitar',
);
check(
  /recKanbanSyncScheduledHireControls/.test(indexHtml)
    && /recScheduledHireSyncViews/.test(indexHtml)
    && /recScheduledHireResolveApp/.test(indexHtml),
  'sync Kanban↔ficha por applicationId',
);
check(
  /recCandHeroHtml[\s\S]{0,2500}recScheduledHireControlsHtml/.test(indexHtml)
    && /recCandAsideRowHtml[\s\S]{0,1500}recScheduledHireControlsHtml/.test(indexHtml),
  'controles también en ficha técnica (héroe y otros procesos)',
);
check(/RECRUITMENT_SCHEDULED_HIRE/.test(indexHtml), 'campana Admin destaca aviso');
check(/notifApplicationFocusId/.test(indexHtml), 'abre la postulación correcta desde campana');
check(/'APPROVED'/.test(indexHtml) && /REC_REQUIRED_STAGE_KEYS/.test(indexHtml), 'Aprobado requerido en UI');
check(
  /kanbanMoveSeq/.test(indexHtml)
    && /moveStillOwned/.test(indexHtml)
    && /st\.kanbanPendingMoves\[appId\]===moveToken/.test(indexHtml)
    && /st\.selectedId===vacancyId/.test(indexHtml),
  'respuesta de move validada por applicationId + vacante',
);
check(
  /st\.kanbanEpoch=\(st\.kanbanEpoch\|\|0\)\+1/.test(indexHtml.replace(/\s+/g, ''))
    && /st\.kanbanPendingMoves=\{\}/.test(indexHtml.replace(/\s+/g, ''))
    && /async function recKanbanLoad/.test(indexHtml),
  'cambio de vacante invalida pending y sube epoch',
);
check(
  !/st\.kanbanEpoch=\(st\.kanbanEpoch\|\|0\)\+1;\s*const moveEpoch=st\.kanbanEpoch/.test(indexHtml)
    && !/st\.kanbanEpoch!==moveEpoch\|\|st\.kanbanPendingMoves\[appId\]!==moveEpoch/.test(indexHtml),
  'CommitStageMove ya no descarta por epoch global del move',
);

const {
  buildScheduledHireReminderMessage,
  scheduledHireReminderDedupeKey,
  scheduledHireReminderDedupePrefix,
} = await import('../src/services/orgNotification.service.js');
const {
  SCHEDULED_HIRE_PAST_MESSAGE,
  assertScheduledHireDateNotPast,
  isOpenApprovedForScheduledHire,
} = await import('../src/services/recruitmentApplicationScheduledHire.service.js');
const { resolveApprovedVacancyStageInsertPosition } = await import(
  '../src/services/recruitmentVacancyStage.service.js'
);
const { emitScheduledHireReminderIfEligible } = await import(
  '../src/services/recruitmentScheduledHireReminder.service.js'
);

console.log('\n=== Lógica de mensajes / dedupe / fechas ===\n');

check(
  scheduledHireReminderDedupeKey('app1', '2026-11-22') === 'recruitment_scheduled_hire:app1:2026-11-22',
  'dedupe estable por programación',
);
check(
  scheduledHireReminderDedupePrefix('app1') === 'recruitment_scheduled_hire:app1:',
  'prefijo para invalidar todas las versiones',
);
check(
  /Hoy está previsto el ingreso de Ana Pérez a Operador/.test(
    buildScheduledHireReminderMessage({
      candidateName: 'Ana Pérez',
      vacancyTitle: 'Operador de Producción',
      scheduledYmd: '2026-11-22',
      todayYmd: '2026-11-22',
    }),
  ),
  'mensaje del día con nombre y vacante',
);
check(
  /Pendiente de confirmar/.test(
    buildScheduledHireReminderMessage({
      candidateName: 'Ana Pérez',
      vacancyTitle: 'Operador',
      scheduledYmd: '2026-11-20',
      todayYmd: '2026-11-22',
    }),
  ) && /20\/11\/2026/.test(
    buildScheduledHireReminderMessage({
      candidateName: 'Ana Pérez',
      vacancyTitle: 'Operador',
      scheduledYmd: '2026-11-20',
      todayYmd: '2026-11-22',
    }),
  ),
  'mensaje atrasado conserva fecha original',
);

{
  let msg = '';
  try {
    assertScheduledHireDateNotPast('1999-01-01', '2026-11-22');
  } catch (e) {
    msg = e.message;
  }
  check(msg === SCHEDULED_HIRE_PAST_MESSAGE, 'fecha pasada se rechaza');
  check(
    assertScheduledHireDateNotPast('2026-11-22', '2026-11-22') === '2026-11-22',
    'hoy o futuro se acepta',
  );
}

{
  // Simula vigencia: cambiar fecha o salir de Aprobado invalida dedupe anterior.
  const keys = new Set();
  function emit(appId, ymd) {
    keys.add(scheduledHireReminderDedupeKey(appId, ymd));
  }
  function invalidate(appId) {
    const prefix = scheduledHireReminderDedupePrefix(appId);
    for (const k of [...keys]) {
      if (k.startsWith(prefix)) keys.delete(k);
    }
  }
  emit('app-a', '2026-11-22');
  emit('app-a', '2026-11-22'); // repetición / otra instancia
  check(keys.size === 1, 'mismo aviso no se duplica');
  invalidate('app-a');
  emit('app-a', '2026-11-25');
  check(
    keys.size === 1 && keys.has('recruitment_scheduled_hire:app-a:2026-11-25'),
    'cambiar fecha reemplaza el aviso anterior',
  );
  invalidate('app-a');
  check(keys.size === 0, 'quitar programación / salir de Aprobado invalida aviso');
}

check(
  isOpenApprovedForScheduledHire('APPROVED', null) === true
    && isOpenApprovedForScheduledHire('APPROVED', 'DECLINED') === false
    && isOpenApprovedForScheduledHire('FINALIST', null) === false,
  'solo Aprobado abierto admite programación/aviso',
);

{
  // Finalista 7000, No-show 7500, Contratado 8000 → Aprobado tras el último del tramo.
  const withFinalist = resolveApprovedVacancyStageInsertPosition({
    finalistEnabledPosition: 7000,
    firstTerminalPosition: 8000,
    maxPositionBeforeFirstTerminal: 7500,
  });
  check(
    withFinalist > 7500 && withFinalist < 8000,
    'migración con Finalista: entre último del tramo y Contratado',
  );
  const withoutFinalist = resolveApprovedVacancyStageInsertPosition({
    finalistEnabledPosition: null,
    firstTerminalPosition: 8000,
    maxPositionBeforeFirstTerminal: 6000,
  });
  check(
    withoutFinalist > 6000 && withoutFinalist < 8000,
    'migración sin Finalista: antes de la primera terminal',
  );
}

{
  // Emisión: si cambió/quitó la fecha o ya no está abierta, no publica.
  function makeTx(rowFactory) {
    let locked = false;
    return {
      locked: () => locked,
      async $executeRaw() {
        locked = true;
        return 1;
      },
      recruitmentApplication: {
        findFirst: async () => {
          if (!locked) throw new Error('debe adquirir candado antes de validar');
          return rowFactory();
        },
      },
    };
  }
  const cleared = await emitScheduledHireReminderIfEligible(
    makeTx(() => ({
      id: 'app-clear',
      candidateId: 'c1',
      vacancyId: 'v1',
      stageId: 'st',
      closureOutcome: null,
      scheduledEmploymentStartDate: null,
      stage: { key: 'APPROVED' },
      candidate: { fullName: 'Ana' },
      vacancy: { title: 'Ops' },
    })),
    {
      organizationId: 'org',
      applicationId: 'app-clear',
      todayYmd: '2026-11-22',
      expectedScheduledYmd: '2026-11-22',
    },
  );
  const changed = await emitScheduledHireReminderIfEligible(
    makeTx(() => ({
      id: 'app-changed',
      candidateId: 'c1',
      vacancyId: 'v1',
      stageId: 'st',
      closureOutcome: null,
      scheduledEmploymentStartDate: new Date('2026-11-28T00:00:00.000Z'),
      stage: { key: 'APPROVED' },
      candidate: { fullName: 'Ana' },
      vacancy: { title: 'Ops' },
    })),
    {
      organizationId: 'org',
      applicationId: 'app-changed',
      todayYmd: '2026-11-22',
      expectedScheduledYmd: '2026-11-22',
    },
  );
  const declined = await emitScheduledHireReminderIfEligible(
    makeTx(() => ({
      id: 'app-declined',
      candidateId: 'c1',
      vacancyId: 'v1',
      stageId: 'st',
      closureOutcome: 'DECLINED',
      scheduledEmploymentStartDate: new Date('2026-11-22T00:00:00.000Z'),
      stage: { key: 'APPROVED' },
      candidate: { fullName: 'Ana' },
      vacancy: { title: 'Ops' },
    })),
    {
      organizationId: 'org',
      applicationId: 'app-declined',
      todayYmd: '2026-11-22',
      expectedScheduledYmd: '2026-11-22',
    },
  );
  check(cleared == null, 'quitar fecha durante emisión no publica');
  check(changed == null, 'cambiar fecha durante emisión no publica la anterior');
  check(declined == null, 'Declinó durante emisión no publica');

  // Quitar programación se guarda entre la lectura previa del barrido y la publicación:
  // el emisor toma el candado, relee y ve fecha null → no publica.
  let sawLockBeforeRead = false;
  const raceTx = {
    async $executeRaw() {
      return 1;
    },
    recruitmentApplication: {
      findFirst: async () => {
        sawLockBeforeRead = true;
        return {
          id: 'app-race',
          candidateId: 'c1',
          vacancyId: 'v1',
          stageId: 'st',
          closureOutcome: null,
          scheduledEmploymentStartDate: null,
          stage: { key: 'APPROVED' },
          candidate: { fullName: 'Ana' },
          vacancy: { title: 'Ops' },
        };
      },
    },
  };
  const raced = await emitScheduledHireReminderIfEligible(raceTx, {
    organizationId: 'org',
    applicationId: 'app-race',
    todayYmd: '2026-11-22',
    expectedScheduledYmd: '2026-11-22',
  });
  check(sawLockBeforeRead && raced == null, 'Quitar entre barrido y publicación no emite');
}

console.log('\n=== Escenarios UI (DOM sintético) ===\n');

{
  check(
    /aria-label="Programar contratación"/.test(indexHtml) && /rec-sched-hire-btn/.test(indexHtml),
    'tarjeta Aprobado sin fecha ofrece CTA calendario+',
  );
  check(
    /rec-sched-hire-date/.test(indexHtml)
      && /Cambiar fecha programada/.test(indexHtml)
      && /Quitar programación/.test(indexHtml),
    'con fecha muestra fecha + lápiz + basura',
  );
}

function chromePath() {
  return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((item) => fs.existsSync(item)) || null;
}

const executablePath = chromePath();
if (!executablePath) {
  console.log('  SKIP  Chrome/Edge no disponible para flujo visual');
} else {
  console.log('\n=== Flujo visual Kanban Aprobado ===\n');
  const http = await import('http');
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
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  const flow = await page.evaluate(async () => {
    function hasProgramCta(root) {
      return !!(root && root.querySelector('[aria-label="Programar contratación"]'));
    }
    function dateLabel(root) {
      const el = root && root.querySelector('.rec-sched-hire-date');
      return el ? el.textContent.trim() : '';
    }
    function hostFor(appId) {
      return document.querySelector('[data-sched-hire-for="' + appId + '"]');
    }
    function dateFor(appId) {
      const host = hostFor(appId);
      if (!host) return '';
      const el = host.querySelector('.rec-sched-hire-date');
      return el ? el.textContent.trim() : '';
    }
    function ctaFor(appId) {
      const host = hostFor(appId);
      return !!(host && host.querySelector('[aria-label="Programar contratación"]'));
    }
    let slot = document.getElementById('rec-pipeline-slot');
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'rec-pipeline-slot';
      document.body.appendChild(slot);
    }
    let detailHost = document.getElementById('rec-cand-pipeline-host');
    if (!detailHost) {
      detailHost = document.createElement('div');
      detailHost.id = 'rec-cand-pipeline-host';
      document.body.appendChild(detailHost);
    }
    let aside = document.getElementById('rec-cand-body-aside');
    if (!aside) {
      aside = document.createElement('div');
      aside.id = 'rec-cand-body-aside';
      document.body.appendChild(aside);
    }
    const modalDetail = document.getElementById('modal-rec-candidate-detail') || document.createElement('div');
    modalDetail.id = 'modal-rec-candidate-detail';
    modalDetail.classList.remove('hidden');
    if (!modalDetail.parentElement) document.body.appendChild(modalDetail);

    const st = recEnsureState();
    st.recruitmentOrgTimeZone = 'America/Mexico_City';
    st.selectedId = 'v1';
    st.detailCandidateId = 'c1';
    st.vacancies = [
      { id: 'v1', title: 'Operador de Producción' },
      { id: 'v2', title: 'Supervisor de Turno' },
    ];
    st.kanbanStages = [
      { stageId: 'st-contact', stage: { id: 'st-contact', key: 'CONTACT', name: 'Contactación' }, isEnabled: true },
      { stageId: 'st-appr', stage: { id: 'st-appr', key: 'APPROVED', name: 'Aprobado' }, isEnabled: true },
      { stageId: 'st-hired', stage: { id: 'st-hired', key: 'HIRED', name: 'Contratado' }, isEnabled: true },
    ];
    st.kanbanApplications = [{
      id: 'app-1',
      stageId: 'st-appr',
      stage: { id: 'st-appr', key: 'APPROVED', name: 'Aprobado' },
      scheduledEmploymentStartDate: null,
      candidateId: 'c1',
      candidate: { id: 'c1', fullName: 'Ana Pérez', profile: 'Ops' },
      vacancy: { id: 'v1', title: 'Operador de Producción' },
      updatedAt: '2026-11-22T12:00:00.000Z',
    }];
    recKanbanRender('v1');
    const card = document.querySelector('.rec-kanban-card[data-app-id="app-1"]');
    const noDate = {
      hasCta: hasProgramCta(card),
      noSchedLabel: !dateLabel(card),
    };
    const today = recOrgTodayYmd();
    apiJson = (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      if (method === 'PUT' && /scheduled-hire/.test(url)) {
        const body = JSON.parse(opts.body || '{}');
        const appId = decodeURIComponent(url.split('/applications/')[1].split('/')[0]);
        return Promise.resolve({
          applicationId: appId,
          scheduledEmploymentStartDate: body.scheduledEmploymentStartDate,
          application: {
            id: appId,
            scheduledEmploymentStartDate: body.scheduledEmploymentStartDate,
            stage: { key: 'APPROVED' },
          },
        });
      }
      if (method === 'DELETE' && /scheduled-hire/.test(url)) {
        const appId = decodeURIComponent(url.split('/applications/')[1].split('/')[0]);
        return Promise.resolve({
          applicationId: appId,
          scheduledEmploymentStartDate: null,
          application: { id: appId, scheduledEmploymentStartDate: null, stage: { key: 'APPROVED' } },
        });
      }
      if (method === 'PATCH' && /applications\//.test(url)) {
        const body = JSON.parse(opts.body || '{}');
        const appId = decodeURIComponent(url.split('/applications/')[1].split(/[/?]/)[0]);
        const stageId = body.stageId;
        const stage = (st.kanbanStages || []).map((x) => x.stage).find((s) => s && s.id === stageId) || { id: stageId, key: 'APPROVED' };
        return Promise.resolve({
          application: {
            id: appId,
            stageId,
            stage,
            scheduledEmploymentStartDate: stage.key === 'APPROVED' ? (st.kanbanApplications[0] && st.kanbanApplications[0].scheduledEmploymentStartDate) : null,
          },
        });
      }
      return Promise.reject(new Error('unexpected ' + method + ' ' + url));
    };
    await recScheduledHireOpen('app-1');
    const modal = document.getElementById('modal-rec-scheduled-hire');
    const afterOpen = {
      open: modal && !modal.classList.contains('hidden'),
      candidate: (document.getElementById('rec-sched-hire-candidate') || {}).textContent || '',
      vacancy: (document.getElementById('rec-sched-hire-vacancy') || {}).textContent || '',
      min: (document.getElementById('rec-sched-hire-date') || {}).min || '',
    };
    document.getElementById('rec-sched-hire-date').value = today;
    await recScheduledHireSave();
    const cardAfter = document.querySelector('.rec-kanban-card[data-app-id="app-1"]');
    const afterSave = {
      closed: !modal || modal.classList.contains('hidden'),
      label: dateLabel(cardAfter),
      local: st.kanbanApplications[0].scheduledEmploymentStartDate,
      hasEdit: !!(cardAfter && cardAfter.querySelector('[aria-label="Cambiar fecha programada"]')),
    };
    await recScheduledHireOpen('app-1');
    const nextDay = today.slice(0, 8) + String(Math.min(28, Number(today.slice(8, 10)) + 1)).padStart(2, '0');
    document.getElementById('rec-sched-hire-date').value = nextDay >= today ? nextDay : today;
    const changedTo = document.getElementById('rec-sched-hire-date').value;
    await recScheduledHireSave();
    const afterChange = {
      local: st.kanbanApplications[0].scheduledEmploymentStartDate,
      shown: dateLabel(document.querySelector('.rec-kanban-card[data-app-id="app-1"]')),
    };
    await recScheduledHireClear('app-1');
    const afterClear = {
      local: st.kanbanApplications[0].scheduledEmploymentStartDate,
      ctaBack: hasProgramCta(document.querySelector('.rec-kanban-card[data-app-id="app-1"]')),
    };

    // Movimiento a Aprobado: el control aparece al confirmar; al salir desaparece.
    st.kanbanApplications[0].stageId = 'st-contact';
    st.kanbanApplications[0].stage = { id: 'st-contact', key: 'CONTACT', name: 'Contactación' };
    st.kanbanApplications[0].scheduledEmploymentStartDate = null;
    recKanbanRender('v1');
    const moveCard = document.querySelector('.rec-kanban-card[data-app-id="app-1"]');
    const beforeMove = !hasProgramCta(moveCard);
    await recKanbanCommitStageMove('app-1', 'st-contact', 'st-appr', recKanbanFindCol('st-appr'));
    const afterEnter = hasProgramCta(document.querySelector('.rec-kanban-card[data-app-id="app-1"]'));
    await recKanbanCommitStageMove('app-1', 'st-appr', 'st-contact', recKanbanFindCol('st-contact'));
    const afterLeave = !hasProgramCta(document.querySelector('.rec-kanban-card[data-app-id="app-1"]'));
    // Evita que un SilentReconcile del move pise el tablero del escenario dual.
    st.kanbanEpoch = (st.kanbanEpoch || 0) + 1;
    st.kanbanPendingMoves = {};

    // Ficha + Kanban sync; dos postulaciones independientes.
    st.kanbanApplications = [{
      id: 'app-1',
      stageId: 'st-appr',
      stage: { id: 'st-appr', key: 'APPROVED', name: 'Aprobado' },
      scheduledEmploymentStartDate: null,
      candidateId: 'c1',
      candidate: { id: 'c1', fullName: 'Ana Pérez' },
      vacancy: { id: 'v1', title: 'Operador de Producción' },
    }];
    recKanbanRender('v1');
    const app1 = {
      applicationId: 'app-1',
      id: 'app-1',
      stage: { id: 'st-appr', key: 'APPROVED', name: 'Aprobado' },
      scheduledEmploymentStartDate: null,
      vacancy: { id: 'v1', title: 'Operador de Producción' },
      candidate: { id: 'c1', fullName: 'Ana Pérez' },
    };
    const app2 = {
      applicationId: 'app-2',
      id: 'app-2',
      stage: { id: 'st-appr', key: 'APPROVED', name: 'Aprobado' },
      scheduledEmploymentStartDate: null,
      vacancy: { id: 'v2', title: 'Supervisor de Turno' },
      candidate: { id: 'c1', fullName: 'Ana Pérez' },
    };
    st.detailCandidate = { id: 'c1', fullName: 'Ana Pérez', applications: [app1, app2] };
    st.detailPrimaryApplication = app1;
    st.detailOtherActiveApps = [app2];
    detailHost.innerHTML = recCandHeroHtml(app1);
    aside.innerHTML = '<div id="rec-cand-aside-panel">' + recCandAsideRowHtml(app2) + '</div>';
    await recScheduledHireOpen('app-1');
    document.getElementById('rec-sched-hire-date').value = today;
    await recScheduledHireSave();
    const cardEl = document.querySelector('#rec-kanban-board .rec-kanban-card[data-app-id="app-1"]')
      || document.querySelector('.rec-kanban-card[data-app-id="app-1"]');
    const syncFromKanban = {
      hero: dateFor('app-1'),
      card: dateLabel(cardEl),
      otherStillEmpty: !dateFor('app-2') && ctaFor('app-2'),
      detailStillOpen: !modalDetail.classList.contains('hidden'),
    };
    await recScheduledHireOpen('app-2');
    document.getElementById('rec-sched-hire-date').value = today;
    await recScheduledHireSave();
    const dual = {
      app2Aside: dateFor('app-2'),
      app1Unchanged: dateFor('app-1') === syncFromKanban.hero,
      detailStillOpen: !modalDetail.classList.contains('hidden'),
    };
    await recScheduledHireClear('app-1');
    const clearSync = {
      heroCta: ctaFor('app-1'),
      cardCta: hasProgramCta(document.querySelector('.rec-kanban-card[data-app-id="app-1"]')),
      app2Kept: !!dateFor('app-2'),
    };

    st.notifApplicationFocusId = 'app-focus';
    const picked = recCandPickPrimaryApplication(st, [
      { applicationId: 'other', vacancy: { id: 'v1' } },
      { applicationId: 'app-focus', vacancy: { id: 'v2' } },
    ]);
    const deepLink = picked && picked.applicationId === 'app-focus';

    // Moves concurrentes a Aprobado: respuesta por applicationId (ambos órdenes + fallo aislado).
    function makeContactApps() {
      return [
        {
          id: 'app-a',
          stageId: 'st-contact',
          stage: { id: 'st-contact', key: 'CONTACT', name: 'Contactación' },
          scheduledEmploymentStartDate: null,
          candidateId: 'c-a',
          candidate: { id: 'c-a', fullName: 'Ana A' },
          vacancy: { id: 'v1', title: 'Operador de Producción' },
          updatedAt: '2026-11-22T12:00:00.000Z',
        },
        {
          id: 'app-b',
          stageId: 'st-contact',
          stage: { id: 'st-contact', key: 'CONTACT', name: 'Contactación' },
          scheduledEmploymentStartDate: null,
          candidateId: 'c-b',
          candidate: { id: 'c-b', fullName: 'Beto B' },
          vacancy: { id: 'v1', title: 'Operador de Producción' },
          updatedAt: '2026-11-22T12:00:00.000Z',
        },
      ];
    }
    function patchOk(appId, stageId) {
      const stage =
        (st.kanbanStages || []).map((x) => x.stage).find((s) => s && s.id === stageId)
        || { id: stageId, key: 'APPROVED', name: 'Aprobado' };
      const app = (st.kanbanApplications || []).find((a) => a.id === appId);
      return {
        application: {
          id: appId,
          stageId,
          stage: Object.assign({}, stage),
          scheduledEmploymentStartDate:
            stage.key === 'APPROVED' ? (app && app.scheduledEmploymentStartDate) || null : null,
        },
      };
    }
    function installDeferredPatch(deferredByApp) {
      apiJson = (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        if (method === 'PATCH' && /applications\//.test(url)) {
          const body = JSON.parse(opts.body || '{}');
          const appId = decodeURIComponent(url.split('/applications/')[1].split(/[/?]/)[0]);
          const entry = deferredByApp[appId];
          if (entry) {
            return new Promise((resolve, reject) => {
              entry.resolve = resolve;
              entry.reject = reject;
              entry.body = body;
              entry.ready = true;
            });
          }
          return Promise.resolve(patchOk(appId, body.stageId));
        }
        if (method === 'GET' && /\/applications$/.test(url)) {
          return Promise.resolve({ applications: (st.kanbanApplications || []).slice() });
        }
        return Promise.reject(new Error('unexpected ' + method + ' ' + url));
      };
    }
    async function waitReady(entry, label) {
      for (let i = 0; i < 80; i += 1) {
        if (entry.ready) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error('timeout waiting for PATCH ' + label);
    }
    async function runOverlappingOrder(firstId, secondId) {
      st.selectedId = 'v1';
      st.kanbanEpoch = (st.kanbanEpoch || 0) + 1;
      st.kanbanPendingMoves = {};
      st.kanbanApplications = makeContactApps();
      recKanbanRender('v1');
      const deferred = {
        'app-a': { ready: false, resolve: null, reject: null, body: null },
        'app-b': { ready: false, resolve: null, reject: null, body: null },
      };
      installDeferredPatch(deferred);
      const pA = recKanbanCommitStageMove('app-a', 'st-contact', 'st-appr', recKanbanFindCol('st-appr'));
      const pB = recKanbanCommitStageMove('app-b', 'st-contact', 'st-appr', recKanbanFindCol('st-appr'));
      await waitReady(deferred['app-a'], 'app-a');
      await waitReady(deferred['app-b'], 'app-b');
      const midPending =
        !!st.kanbanPendingMoves['app-a'] && !!st.kanbanPendingMoves['app-b'];
      deferred[firstId].resolve(patchOk(firstId, deferred[firstId].body.stageId));
      await Promise.race([
        firstId === 'app-a' ? pA : pB,
        new Promise((_, rej) => setTimeout(() => rej(new Error('first resolve timeout')), 2000)),
      ]);
      const afterFirst = {
        firstCta: ctaFor(firstId) || hasProgramCta(document.querySelector('.rec-kanban-card[data-app-id="' + firstId + '"]')),
        secondStillPending: !!st.kanbanPendingMoves[secondId],
        firstKey: (document.querySelector('.rec-kanban-card[data-app-id="' + firstId + '"]') || {}).getAttribute
          ? document.querySelector('.rec-kanban-card[data-app-id="' + firstId + '"]').getAttribute('data-stage-key')
          : '',
      };
      deferred[secondId].resolve(patchOk(secondId, deferred[secondId].body.stageId));
      await Promise.all([pA, pB]);
      const cardA = document.querySelector('.rec-kanban-card[data-app-id="app-a"]');
      const cardB = document.querySelector('.rec-kanban-card[data-app-id="app-b"]');
      return {
        midPending,
        afterFirst,
        bothCta: hasProgramCta(cardA) && hasProgramCta(cardB),
        keys: {
          a: cardA && cardA.getAttribute('data-stage-key'),
          b: cardB && cardB.getAttribute('data-stage-key'),
        },
        pendingEmpty: !st.kanbanPendingMoves['app-a'] && !st.kanbanPendingMoves['app-b'],
      };
    }
    const overlapAB = await runOverlappingOrder('app-a', 'app-b');
    const overlapBA = await runOverlappingOrder('app-b', 'app-a');

    st.selectedId = 'v1';
    st.kanbanEpoch = (st.kanbanEpoch || 0) + 1;
    st.kanbanPendingMoves = {};
    st.kanbanApplications = makeContactApps();
    recKanbanRender('v1');
    const failDeferred = {
      'app-a': { ready: false, resolve: null, reject: null, body: null },
      'app-b': { ready: false, resolve: null, reject: null, body: null },
    };
    installDeferredPatch(failDeferred);
    const failPA = recKanbanCommitStageMove('app-a', 'st-contact', 'st-appr', recKanbanFindCol('st-appr'));
    const failPB = recKanbanCommitStageMove('app-b', 'st-contact', 'st-appr', recKanbanFindCol('st-appr'));
    await waitReady(failDeferred['app-a'], 'fail-a');
    await waitReady(failDeferred['app-b'], 'fail-b');
    failDeferred['app-a'].resolve(patchOk('app-a', failDeferred['app-a'].body.stageId));
    await failPA;
    failDeferred['app-b'].reject(Object.assign(new Error('stage conflict'), { status: 409 }));
    let failCaught = false;
    try {
      await failPB;
    } catch (_e) {
      failCaught = true;
    }
    const cardOk = document.querySelector('.rec-kanban-card[data-app-id="app-a"]');
    const cardFail = document.querySelector('.rec-kanban-card[data-app-id="app-b"]');
    const isolatedFail = {
      failCaught,
      okCta: hasProgramCta(cardOk),
      okKey: cardOk && cardOk.getAttribute('data-stage-key'),
      failKey: cardFail && cardFail.getAttribute('data-stage-key'),
      failNoCta: !hasProgramCta(cardFail),
      failInContactCol: !!(cardFail && cardFail.closest('.rec-kanban-col[data-stage-id="st-contact"]')),
      okInApprovedCol: !!(cardOk && cardOk.closest('.rec-kanban-col[data-stage-id="st-appr"]')),
    };

    return {
      noDate,
      afterOpen,
      afterSave,
      afterChange: {
        local: afterChange.local,
        shown: afterChange.shown,
        pretty: recKanbanFmtScheduledHire(changedTo),
      },
      afterClear,
      move: { beforeMove, afterEnter, afterLeave },
      syncFromKanban,
      dual,
      clearSync,
      deepLink,
      overlapAB,
      overlapBA,
      isolatedFail,
      today,
      changedTo,
    };
  });
  check(flow.noDate.hasCta && flow.noDate.noSchedLabel, 'aprobar sin fecha: CTA Programar');
  check(
    flow.afterOpen.open
      && /Ana/.test(flow.afterOpen.candidate)
      && /Operador/.test(flow.afterOpen.vacancy)
      && flow.afterOpen.min === flow.today,
    'modal con contexto y min=hoy',
  );
  const prettyToday = flow.today.slice(8, 10) + '/' + flow.today.slice(5, 7) + '/' + flow.today.slice(0, 4);
  check(
    flow.afterSave.closed
      && flow.afterSave.local === flow.today
      && flow.afterSave.hasEdit
      && flow.afterSave.label === prettyToday,
    'programar para hoy muestra fecha en tarjeta',
  );
  const prettyChanged =
    flow.changedTo.slice(8, 10) + '/' + flow.changedTo.slice(5, 7) + '/' + flow.changedTo.slice(0, 4);
  check(
    flow.afterChange.local === flow.changedTo && flow.afterChange.shown === prettyChanged,
    'cambiar fecha actualiza la tarjeta',
  );
  check(flow.afterClear.local == null && flow.afterClear.ctaBack, 'quitar programación restaura CTA');
  check(
    flow.move.beforeMove && flow.move.afterEnter && flow.move.afterLeave,
    'ícono aparece al entrar a Aprobado y desaparece al salir',
  );
  check(
    flow.syncFromKanban.hero === prettyToday
      && flow.syncFromKanban.card === prettyToday
      && flow.syncFromKanban.otherStillEmpty
      && flow.syncFromKanban.detailStillOpen,
    'programar desde Kanban se refleja en ficha sin tocar la otra postulación',
  );
  check(
    flow.dual.app2Aside === prettyToday
      && flow.dual.app1Unchanged
      && flow.dual.detailStillOpen,
    'dos postulaciones: editar una no altera la otra y la ficha sigue abierta',
  );
  check(
    flow.clearSync.heroCta && flow.clearSync.cardCta && flow.clearSync.app2Kept,
    'quitar desde una vista sincroniza Kanban/ficha y conserva la otra postulación',
  );
  check(flow.deepLink, 'campana abre la postulación correcta por applicationId');
  check(
    flow.overlapAB.midPending
      && flow.overlapAB.afterFirst.firstCta
      && flow.overlapAB.afterFirst.secondStillPending
      && flow.overlapAB.bothCta
      && flow.overlapAB.keys.a === 'APPROVED'
      && flow.overlapAB.keys.b === 'APPROVED'
      && flow.overlapAB.pendingEmpty,
    'overlap A→B: ambas confirman y muestran calendario',
  );
  check(
    flow.overlapBA.midPending
      && flow.overlapBA.afterFirst.firstCta
      && flow.overlapBA.afterFirst.secondStillPending
      && flow.overlapBA.bothCta
      && flow.overlapBA.keys.a === 'APPROVED'
      && flow.overlapBA.keys.b === 'APPROVED'
      && flow.overlapBA.pendingEmpty,
    'overlap B→A: ambas confirman y muestran calendario',
  );
  check(
    flow.isolatedFail.failCaught
      && flow.isolatedFail.okCta
      && flow.isolatedFail.okKey === 'APPROVED'
      && flow.isolatedFail.okInApprovedCol
      && flow.isolatedFail.failKey === 'CONTACT'
      && flow.isolatedFail.failNoCta
      && flow.isolatedFail.failInContactCol,
    'si una falla, solo esa tarjeta se restaura',
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (failed) {
  console.error(`\n${failed} comprobaciones de Aprobado/programación fallaron\n`);
  process.exit(1);
}
console.log('\nAprobado + programación + recordatorio en orden\n');

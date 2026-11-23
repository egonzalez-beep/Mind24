/**
 * Baja posterior al ingreso — estático + lógica sin PG obligatorio.
 * node server/scripts/test-recruitment-employment-exit.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(serverDir, '..');
dotenv.config({ path: path.join(serverDir, '.env') });
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'employment-exit-test';
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

console.log('\n=== Baja laboral — schema / migración / API / UI ===\n');

const schema = fs.readFileSync(path.join(serverDir, 'prisma/schema.prisma'), 'utf8');
const migPath = path.join(
  serverDir,
  'prisma/migrations/20261121200000_recruitment_application_employment_exit/migration.sql',
);
const stageMigPath = path.join(
  serverDir,
  'prisma/migrations/20261121210000_recruitment_employment_exit_stage/migration.sql',
);
check(fs.existsSync(migPath), 'migración aditiva existe');
check(fs.existsSync(stageMigPath), 'migración etapa Baja existe');
const migBuf = fs.readFileSync(migPath);
const stageMigBuf = fs.readFileSync(stageMigPath);
check(migBuf[0] !== 0xef && migBuf[1] !== 0xbb, 'migración UTF-8 sin BOM');
check(stageMigBuf[0] !== 0xef && stageMigBuf[1] !== 0xbb, 'migración etapa UTF-8 sin BOM');
const mig = migBuf.toString('utf8');
const stageMig = stageMigBuf.toString('utf8');
check(/ADD VALUE 'EMPLOYMENT_EXIT'/.test(mig), 'enum novedad EMPLOYMENT_EXIT');
check(/CREATE TABLE "RecruitmentApplicationEmploymentExit"/.test(mig), 'tabla 1:1');
check(/"exitDate" DATE NOT NULL/.test(mig), 'exitDate DATE');
check(/"underWarranty" BOOLEAN NOT NULL/.test(mig), 'underWarranty');
check(/"applicationId" TEXT NOT NULL/.test(mig) && /UNIQUE INDEX .*applicationId/.test(mig), 'unique applicationId');
const migCode = mig
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');
check(
  /CREATE TABLE "RecruitmentApplicationEmploymentExit"/.test(migCode)
    && /ALTER TYPE "WorkforceRecruitmentNovedadEventType" ADD VALUE/.test(migCode)
    && !/\bDROP TABLE\b|\bDROP COLUMN\b|\bUPDATE\s+"/.test(migCode),
  'migración solo aditiva',
);
check(/'EMPLOYMENT_EXIT'/.test(stageMig) && /'Baja'/.test(stageMig), 'etapa Baja en catálogo');
check(/INSERT INTO "RecruitmentVacancyStage"/.test(stageMig), 'habilita Baja en vacantes existentes');
check(
  /INSERT INTO "RecruitmentApplicationStageEvent"/.test(stageMig)
    && /UPDATE "RecruitmentApplication"/.test(stageMig)
    && !/WorkforceRecruitmentNovedad/.test(stageMig),
  'backfill HIRED→Baja con evento y sin nuevo aviso',
);
const stageMigCode = stageMig
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');
check(!/\bDROP TABLE\b|\bDROP COLUMN\b/.test(stageMigCode), 'migración etapa solo aditiva/UPDATE dirigido');

check(/model RecruitmentApplicationEmploymentExit/.test(schema), 'modelo Prisma');
check(/employmentExit RecruitmentApplicationEmploymentExit\?/.test(schema), 'relación 1:1 en Application');
check(/EMPLOYMENT_EXIT/.test(schema), 'enum schema EMPLOYMENT_EXIT');

const exitSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/recruitmentApplicationEmploymentExit.service.js'),
  'utf8',
);
const novSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/workforceRecruitmentNovedad.service.js'),
  'utf8',
);
const routes = fs.readFileSync(path.join(serverDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const candSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/recruitmentCandidate.service.js'),
  'utf8',
);
const appSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/recruitmentApplication.service.js'),
  'utf8',
);

check(/registerRecruitmentApplicationEmploymentExit/.test(exitSvc), 'servicio registrar baja');
check(/EMPLOYMENT_EXIT_MISSING_START_MESSAGE/.test(exitSvc), 'mensaje sin fecha de ingreso');
check(/assertEmploymentStartCompatibleWithExit/.test(exitSvc), 'compatibilidad ingreso vs baja');
check(
  /EMPLOYMENT_EXIT_STAGE_KEY/.test(exitSvc)
    && /recruitmentApplicationStageEvent\.create/.test(exitSvc)
    && /emitWorkforceRecruitmentNovedadForEmploymentExit/.test(exitSvc)
    && /stageId:\s*exitStage\.id/.test(exitSvc),
  'baja mueve etapa + evento + aviso en la misma transacción',
);
check(
  /EMPLOYMENT_EXIT_GENERIC_MOVE_MESSAGE/.test(exitSvc)
    && /EMPLOYMENT_EXIT_GENERIC_MOVE_MESSAGE/.test(appSvc),
  'bloquea altas/movimientos genéricos a Baja',
);
check(
  /lockRecruitmentApplicationRow/.test(exitSvc)
    && /lockRecruitmentApplicationForEmploymentDates/.test(exitSvc)
    && /FOR UPDATE/.test(exitSvc)
    && /lockRecruitmentApplicationRow/.test(appSvc)
    && /editingHireDateOnly/.test(appSvc)
    && /leavingApproved/.test(appSvc),
  'mismo candado FOR UPDATE en baja, ingreso, Aprobado y Declinó',
);
const stageSvc = fs.readFileSync(path.join(serverDir, 'src/services/recruitmentStage.service.js'), 'utf8');
const vacStageSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/recruitmentVacancyStage.service.js'),
  'utf8',
);
const metricsSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/recruitmentMetricsTerminal.service.js'),
  'utf8',
);
const coverageSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/recruitmentCoverage.service.js'),
  'utf8',
);
check(/key: 'EMPLOYMENT_EXIT'/.test(stageSvc) && /name: 'Baja'/.test(stageSvc), 'catálogo default incluye Baja');
check(
  /REQUIRED_VACANCY_STAGE_KEYS[\s\S]*EMPLOYMENT_EXIT/.test(vacStageSvc),
  'EMPLOYMENT_EXIT obligatoria por vacante',
);
check(
  /hireSurvivesExit/.test(metricsSvc)
    && /toStageKey === 'EMPLOYMENT_EXIT'/.test(metricsSvc),
  'métricas conservan HIRED tras Baja mismo mes',
);
check(
  /status !== 'ACTIVE'/.test(coverageSvc)
    && /Solo Activa → Cubierta/.test(coverageSvc),
  'reconcile no reabre Cubierta al liberar plaza',
);
check(/emitWorkforceRecruitmentNovedadForEmploymentExit/.test(novSvc), 'emisor novedad');
check(/application_employment_exit:/.test(novSvc), 'dedupeKey por application');
check(/createMany[\s\S]*skipDuplicates:\s*true/.test(novSvc.slice(novSvc.indexOf('emitWorkforceRecruitmentNovedadForEmploymentExit'))), 'novedad skipDuplicates');
check(
  /Se registró la baja de \$\{name\} en \$\{vacancy\} el/.test(novSvc),
  'mensaje Novedades «Se registró la baja de…»',
);
check(!/\$\{name\} dio de baja en/.test(novSvc), 'ya no usa «dio de baja»');
check(/employment-exit/.test(routes) && /assertEmpresaAdmin/.test(routes), 'ruta POST employment-exit admin');
check(/underWarranty:\s*z\.boolean\(\)/.test(routes), 'garantía booleana obligatoria');
check(/employmentExit:\s*true/.test(candSvc) && /employmentExit:/.test(candSvc), 'getRecruitmentCandidate incluye baja');
check(/assertEmploymentStartCompatibleWithExit/.test(appSvc), 'editar ingreso valida contra baja');

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(serverDir, 'public/index.html'));
check(Buffer.from(indexHtml).equals(publicHtml), 'HTML espejo index ↔ public');

check(/id="modal-rec-employment-exit"/.test(indexHtml), 'modal Registrar baja');
check(/Registrar baja/.test(indexHtml) && /recCandOpenEmploymentExit/.test(indexHtml), 'CTA y opener');
check(/¿Aplica garantía\?/.test(indexHtml) && /name="rec-exit-warranty"/.test(indexHtml), 'Sí/No garantía');
check(/Motivo de baja/.test(indexHtml) && /Fecha de baja/.test(indexHtml), 'campos obligatorios en UI');
check(/rec-hire-exit-btn/.test(indexHtml) && /recCandObsIconExit/.test(indexHtml), 'botón SVG discreto');
check(/employment-exit/.test(indexHtml) && /dataset\.recBusy/.test(indexHtml), 'POST y busy anti doble clic');
check(
  /recCandShowEmploymentExitOverlay/.test(indexHtml)
    && /mind24ResetUiBlockers cierra la ficha/.test(indexHtml)
    && !/openModal\('modal-rec-employment-exit'\)/.test(indexHtml),
  'abre como modal secundario sin openModal',
);
check(
  /recCandBindEmploymentExitEscape/.test(indexHtml)
    && /stopImmediatePropagation/.test(indexHtml.slice(indexHtml.indexOf('recCandBindEmploymentExitEscape'))),
  'Escape cierra solo la baja',
);
{
  const confirmFn = indexHtml.slice(
    indexHtml.indexOf('async function recCandConfirmEmploymentExit'),
    indexHtml.indexOf('function recCandToggleAsidePanel'),
  );
  const busyAt = confirmFn.indexOf('if(recCandEmploymentExitBusy()) return;');
  const epochAt = confirmFn.indexOf('const epoch=++recEmploymentExitEpoch;');
  check(busyAt >= 0 && epochAt > busyAt, 'busy se comprueba antes de incrementar epoch');
  check(/Guardando…/.test(confirmFn) || /recCandSetEmploymentExitBusy\(true\)/.test(confirmFn), 'marca Guardando… al guardar');
  check(/if\(recCandEmploymentExitBusy\(\)\) return;/.test(indexHtml.slice(indexHtml.indexOf('function recCandCloseEmploymentExit'))), 'cierre bloqueado si busy');
}
check(/recCandEmploymentExitDetailsHtml/.test(indexHtml), 'detalle Fecha/Motivo/Garantía');
check(/eventType==='EMPLOYMENT_EXIT'/.test(indexHtml), 'filtro Novedades hired para baja');
check(
  /targetStageKey==='EMPLOYMENT_EXIT'/.test(indexHtml)
    && /recCandOpenEmploymentExit\(appId,\s*\{/.test(indexHtml)
    && /source:'kanban'/.test(indexHtml.slice(indexHtml.indexOf("targetStageKey==='EMPLOYMENT_EXIT'"))),
  'Kanban abre el mismo modal al soltar en Baja',
);
check(
  /recCandLandEmploymentExitOnKanban/.test(indexHtml)
    && /La tarjeta permanece en Contratado hasta que el servidor confirme/.test(indexHtml),
  'aterrizaje Kanban solo tras confirmación del servidor',
);
check(
  /sk!=='HIRED'&&sk!=='EMPLOYMENT_EXIT'/.test(indexHtml.replace(/\s+/g, ''))
    || /sk!=='HIRED'&&sk!=='EMPLOYMENT_EXIT'/.test(indexHtml),
  'editar ingreso permitido también en Baja',
);
check(
  /isExit\?'Baja'/.test(indexHtml)
    && /Antecedente: Contratado/.test(indexHtml)
    && /EMPLOYMENT_EXIT/.test(indexHtml),
  'historial muestra Baja con antecedente de contratación',
);
check(
  /canDrag=stageKey!=='EMPLOYMENT_EXIT'&&stageKey!=='REJECTED'&&stageKey!=='DECLINED'/.test(
    indexHtml.replace(/\s+/g, ''),
  ),
  'Contratado es arrastrable; Baja/Descartado/Declinó no',
);
check(
  /function recKanbanHiredDragAllowsTarget/.test(indexHtml)
    && /fromKey==='HIRED'\)returntargetKey==='EMPLOYMENT_EXIT'/.test(indexHtml.replace(/\s+/g, '')),
  'arrastre desde Contratado solo permite Baja',
);
check(
  /Desde Contratado solo se puede mover a Baja/.test(indexHtml),
  'drop fuera de Baja desde Contratado se rechaza',
);

const {
  parseEmploymentStartDateInput,
  serializeEmploymentStartDate,
  employmentStartDateToPrisma,
} = await import('../src/services/recruitmentApplication.service.js');
const {
  assertEmploymentStartCompatibleWithExit,
  EMPLOYMENT_EXIT_BEFORE_START_MESSAGE,
  EMPLOYMENT_START_AFTER_EXIT_MESSAGE,
  EMPLOYMENT_EXIT_REASON_MAX,
  serializeEmploymentExit,
} = await import('../src/services/recruitmentApplicationEmploymentExit.service.js');
const {
  employmentExitDedupeKey,
} = await import('../src/services/workforceRecruitmentNovedad.service.js');

console.log('\n=== Lógica de fechas / serialización / dedupe ===\n');

check(EMPLOYMENT_EXIT_REASON_MAX === 160, 'motivo breve 160');
check(employmentExitDedupeKey('app-1') === 'application_employment_exit:app-1', 'dedupe estable');
check(employmentExitDedupeKey('') == null, 'dedupe vacío');

{
  let msg = '';
  try {
    assertEmploymentStartCompatibleWithExit('2026-05-10', '2026-05-01');
  } catch (e) {
    msg = e.message;
  }
  check(msg === EMPLOYMENT_START_AFTER_EXIT_MESSAGE, 'ingreso posterior a baja se rechaza');
}
{
  let ok = true;
  try {
    assertEmploymentStartCompatibleWithExit('2026-05-01', '2026-05-10');
  } catch {
    ok = false;
  }
  check(ok, 'ingreso anterior o igual a baja se acepta');
}

const ser = serializeEmploymentExit({
  id: 'ex1',
  exitDate: employmentStartDateToPrisma('2026-11-20'),
  reason: 'Renuncia',
  underWarranty: true,
  registeredByUserId: 'u1',
  createdAt: new Date('2026-11-21T15:00:00.000Z'),
});
check(
  ser.exitDate === '2026-11-20' && ser.underWarranty === true && ser.reason === 'Renuncia',
  'serialize exit con garantía',
);
const serNo = serializeEmploymentExit({
  id: 'ex2',
  exitDate: employmentStartDateToPrisma('2026-11-18'),
  reason: 'Término',
  underWarranty: false,
  registeredByUserId: 'u1',
  createdAt: new Date('2026-11-21T15:00:00.000Z'),
});
check(serNo.underWarranty === false, 'serialize exit sin garantía');
check(serializeEmploymentStartDate(employmentStartDateToPrisma('2026-01-05')) === '2026-01-05', 'round-trip fecha');
check(parseEmploymentStartDateInput('2026-02-30') == null, 'día inválido');
check(EMPLOYMENT_EXIT_BEFORE_START_MESSAGE.includes('anterior'), 'mensaje baja < ingreso');

console.log('\n=== Concurrencia ingreso vs baja (órdenes incompatibles) ===\n');

{
  // Simula el efecto del candado: la 2ª operación ve el estado de la 1ª y falla con mensaje claro.
  function applyExit(state, exitDate) {
    if (state.exit) throw new Error('already');
    if (exitDate < state.start) throw new Error(EMPLOYMENT_EXIT_BEFORE_START_MESSAGE);
    state.exit = exitDate;
  }
  function applyStart(state, start) {
    assertEmploymentStartCompatibleWithExit(start, state.exit);
    state.start = start;
  }

  const orderExitFirst = { start: '2026-10-01', exit: null };
  applyExit(orderExitFirst, '2026-11-10');
  let exitFirstMsg = '';
  try {
    applyStart(orderExitFirst, '2026-11-20');
  } catch (e) {
    exitFirstMsg = e.message;
  }
  check(
    exitFirstMsg === EMPLOYMENT_START_AFTER_EXIT_MESSAGE
      && orderExitFirst.start === '2026-10-01'
      && orderExitFirst.exit === '2026-11-10',
    'baja primero: ingreso incompatible se rechaza y fechas quedan en orden',
  );

  const orderStartFirst = { start: '2026-10-01', exit: null };
  applyStart(orderStartFirst, '2026-11-15');
  let startFirstMsg = '';
  try {
    applyExit(orderStartFirst, '2026-11-05');
  } catch (e) {
    startFirstMsg = e.message;
  }
  check(
    startFirstMsg === EMPLOYMENT_EXIT_BEFORE_START_MESSAGE
      && orderStartFirst.start === '2026-11-15'
      && orderStartFirst.exit == null,
    'ingreso primero: baja incompatible se rechaza y fechas quedan en orden',
  );
}

console.log('\n=== Escenarios de UI (DOM sintético) ===\n');

{
  // Simula dos contrataciones: solo la seleccionada recibe employmentExit en el estado.
  const apps = [
    {
      applicationId: 'app-a',
      employmentStartDate: '2026-10-01',
      employmentExit: null,
      stage: { key: 'HIRED' },
      vacancy: { title: 'Vac A' },
    },
    {
      applicationId: 'app-b',
      employmentStartDate: '2026-09-01',
      employmentExit: null,
      stage: { key: 'HIRED' },
      vacancy: { title: 'Vac B' },
    },
  ];
  const out = {
    applicationId: 'app-a',
    employmentStartDate: '2026-10-01',
    employmentExit: {
      id: 'ex',
      exitDate: '2026-11-15',
      reason: 'Renuncia',
      underWarranty: true,
      registeredAt: '2026-11-21T12:00:00.000Z',
    },
  };
  const next = apps.map((a) =>
    a.applicationId !== out.applicationId
      ? a
      : Object.assign({}, a, {
          employmentStartDate: out.employmentStartDate,
          employmentExit: out.employmentExit,
        }),
  );
  check(next[0].employmentExit?.exitDate === '2026-11-15', 'solo app-a recibe la baja');
  check(next[1].employmentExit == null, 'app-b intacta');
  check(next[0].employmentStartDate === '2026-10-01', 'conserva ingreso');
}

{
  const html = indexHtml;
  const openFn = html.includes("if(!startRaw)") && html.includes('Registra primero la fecha real de ingreso');
  check(openFn, 'UI sin fecha de ingreso pide el lápiz');
  check(/canRegister=!exit/.test(html) || /canRegister=!exit/.test(html.replace(/\s/g, '')), 'oculta botón tras baja');
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
  console.log('  SKIP  Chrome/Edge no disponible para flujo visual de baja');
} else {
  console.log('\n=== Flujo visual: ficha + modal baja ===\n');
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
    const detail = document.getElementById('modal-rec-candidate-detail');
    detail.classList.remove('hidden');
    detail.style.visibility = '';
    detail.style.pointerEvents = '';
    detail.style.opacity = '';
    let host = document.getElementById('rec-cand-body-aside');
    if (!host) {
      host = document.createElement('div');
      host.id = 'rec-cand-body-aside';
      const card = detail.querySelector('.rec-cand-detail-modal') || detail;
      card.appendChild(host);
    }
    const st = recEnsureState();
    st.recruitmentOrgTimeZone = 'America/Mexico_City';
    st.detailCandidate = {
      id: 'cand-1',
      fullName: 'Ana Pérez',
      applications: [
        {
          applicationId: 'app-a',
          employmentStartDate: '2026-10-01',
          employmentExit: null,
          stage: { key: 'HIRED', name: 'Contratado' },
          vacancy: { id: 'v1', title: 'Operador' },
        },
        {
          applicationId: 'app-b',
          employmentStartDate: null,
          employmentExit: null,
          stage: { key: 'HIRED', name: 'Contratado' },
          vacancy: { id: 'v2', title: 'Auxiliar' },
        },
      ],
    };
    host.innerHTML = recCandHistoryAsideHtml(st.detailCandidate.applications);
    const btnA = host.querySelector('[data-app-id="app-a"] .rec-hire-exit-btn');
    if (!btnA) {
      return { error: 'no-btn-a', html: host.innerHTML.slice(0, 400) };
    }
    btnA.focus();
    btnA.click();
    const exitModal = document.getElementById('modal-rec-employment-exit');
    const afterOpen = {
      exitVisible: exitModal && !exitModal.classList.contains('hidden'),
      fichaVisible: detail && !detail.classList.contains('hidden'),
      fichaVisibility: detail.style.visibility || '',
      candidate: (document.getElementById('rec-exit-candidate') || {}).textContent || '',
      start: (document.getElementById('rec-exit-start') || {}).textContent || '',
      hasBtn: !!btnA,
    };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const afterEsc = {
      exitHidden: !exitModal || exitModal.classList.contains('hidden'),
      fichaStill: !detail.classList.contains('hidden'),
      focusBack: document.activeElement === btnA,
    };

    const btnB = host.querySelector('[data-app-id="app-b"] .rec-hire-exit-btn');
    btnB.click();
    const noDate = {
      exitVisible: exitModal && !exitModal.classList.contains('hidden'),
      err: (document.getElementById('rec-exit-err') || {}).textContent || '',
      formHidden: document.getElementById('rec-exit-form-wrap').classList.contains('hidden'),
      fichaStill: !detail.classList.contains('hidden'),
    };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    btnA.click();
    const reasonEl = document.getElementById('rec-exit-reason');
    const dateEl = document.getElementById('rec-exit-date');
    const savedDate = dateEl.value;
    reasonEl.value = 'Renuncia voluntaria';
    document.querySelector('input[name="rec-exit-warranty"][value="yes"]').checked = true;
    let calls = 0;
    let release;
    apiJson = () => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const p1 = recCandConfirmEmploymentExit();
    const p2 = recCandConfirmEmploymentExit();
    await Promise.resolve();
    const callsWhilePending = calls;
    const whileSaving = {
      label: document.getElementById('rec-exit-submit').textContent,
      cancelDisabled: document.getElementById('rec-exit-cancel').disabled,
      closeDisabled: document.getElementById('rec-exit-close').disabled,
      reasonDisabled: reasonEl.disabled,
    };
    // Intentos de cierre durante la respuesta demorada: no deben invalidar el guardado.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    recCandCloseEmploymentExit();
    document.getElementById('rec-exit-cancel').click();
    document.getElementById('rec-exit-close').click();
    recCandEmploymentExitBackdrop({ target: exitModal });
    const blockedClose = {
      stillOpen: exitModal && !exitModal.classList.contains('hidden'),
      stillBusy: recCandEmploymentExitBusy(),
      reasonKept: reasonEl.value === 'Renuncia voluntaria',
      dateKept: dateEl.value === savedDate,
      submitStillSaving: document.getElementById('rec-exit-submit').textContent === 'Guardando…',
    };
    release({
      applicationId: 'app-a',
      employmentStartDate: '2026-10-01',
      employmentExit: {
        id: 'ex1',
        exitDate: '2026-11-20',
        reason: 'Renuncia voluntaria',
        underWarranty: true,
        registeredAt: '2026-11-21T12:00:00.000Z',
      },
    });
    await Promise.all([p1, p2]);
    const blockA = document.querySelector('[data-app-id="app-a"]');
    const afterSave = {
      exitClosed: !exitModal || exitModal.classList.contains('hidden'),
      fichaAfterSave: !detail.classList.contains('hidden'),
      hasExitDetails: !!blockA && /Fecha de baja/.test(blockA.textContent),
      noExitBtn: !!(blockA && !blockA.querySelector('.rec-hire-exit-btn')),
      appBUntouched: !st.detailCandidate.applications[1].employmentExit,
      appAHasExit: !!st.detailCandidate.applications[0].employmentExit,
    };

    // Fallo: conserva datos y rehabilita controles.
    st.detailCandidate.applications[0].employmentExit = null;
    st.detailCandidate.applications[0].stage = { key: 'HIRED', name: 'Contratado' };
    host.innerHTML = recCandHistoryAsideHtml(st.detailCandidate.applications);
    const btnRetry = host.querySelector('[data-app-id="app-a"] .rec-hire-exit-btn');
    btnRetry.click();
    document.getElementById('rec-exit-reason').value = 'Motivo a conservar';
    document.querySelector('input[name="rec-exit-warranty"][value="no"]').checked = true;
    const failDate = document.getElementById('rec-exit-date').value;
    apiJson = () => Promise.reject(Object.assign(new Error('Conflicto de prueba'), { code: 'CONFLICT' }));
    await recCandConfirmEmploymentExit();
    const afterFail = {
      stillOpen: !document.getElementById('modal-rec-employment-exit').classList.contains('hidden'),
      reason: document.getElementById('rec-exit-reason').value,
      date: document.getElementById('rec-exit-date').value,
      warrantyNo: document.querySelector('input[name="rec-exit-warranty"][value="no"]').checked,
      err: document.getElementById('rec-exit-err').textContent,
      busy: recCandEmploymentExitBusy(),
      submitLabel: document.getElementById('rec-exit-submit').textContent,
      cancelEnabled: !document.getElementById('rec-exit-cancel').disabled,
    };

    // Kanban real: tarjeta HIRED renderizada → dragstart → solo Baja acepta.
    let slot = document.getElementById('rec-pipeline-slot');
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'rec-pipeline-slot';
      document.body.appendChild(slot);
    }
    // Cerrar modal de fallo previo para no interferir con el flujo Kanban.
    recCandSetEmploymentExitBusy(false);
    recCandCloseEmploymentExit();
    st.selectedId = 'v-k';
    st.kanbanError = '';
    st.kanbanCollapsed = {};
    st.kanbanHideEmpty = false;
    st.kanbanStages = [
      { stageId: 'st-new', stage: { id: 'st-new', key: 'NEW', name: 'Nuevo' }, isEnabled: true },
      { stageId: 'st-hired', stage: { id: 'st-hired', key: 'HIRED', name: 'Contratado' }, isEnabled: true },
      { stageId: 'st-exit', stage: { id: 'st-exit', key: 'EMPLOYMENT_EXIT', name: 'Baja' }, isEnabled: true },
      { stageId: 'st-rej', stage: { id: 'st-rej', key: 'REJECTED', name: 'Descartado' }, isEnabled: true },
    ];
    st.kanbanApplications = [{
      id: 'app-k',
      employmentStartDate: '2026-10-01',
      employmentExit: null,
      stageId: 'st-hired',
      stage: { id: 'st-hired', key: 'HIRED', name: 'Contratado' },
      candidateId: 'cand-k',
      candidate: { id: 'cand-k', fullName: 'Luis Kanban', profile: 'Ops' },
      vacancy: { id: 'v-k', title: 'Picking' },
      updatedAt: '2026-11-21T12:00:00.000Z',
    }];
    st.vacancies = [{ id: 'v-k', title: 'Picking' }];
    recKanbanRender('v-k');
    const board = document.getElementById('rec-kanban-board');
    const card = board && board.querySelector('.rec-kanban-card[data-app-id="app-k"]');
    const colNew = board && board.querySelector('.rec-kanban-col[data-stage-key="NEW"]');
    const colExit = board && board.querySelector('.rec-kanban-col[data-stage-key="EMPLOYMENT_EXIT"]');
    const colRej = board && board.querySelector('.rec-kanban-col[data-stage-key="REJECTED"]');
    function mockDt() {
      return { dropEffect: 'none', effectAllowed: 'all', setData() {}, getData() { return 'app-k'; } };
    }
    function fireDragStart(el) {
      const dt = mockDt();
      const ev = {
        currentTarget: el,
        preventDefault() { ev._prevented = true; },
        _prevented: false,
        dataTransfer: dt,
      };
      recKanbanCardDragStart(ev);
      return ev;
    }
    function fireOver(col) {
      const dt = mockDt();
      const ev = {
        currentTarget: col,
        clientX: 10,
        preventDefault() { ev._prevented = true; },
        _prevented: false,
        dataTransfer: dt,
      };
      recKanbanColDragOver(ev);
      return ev;
    }
    const dragStartEv = card ? fireDragStart(card) : null;
    const overNew = colNew ? fireOver(colNew) : null;
    const overRej = colRej ? fireOver(colRej) : null;
    const overExit = colExit ? fireOver(colExit) : null;
    const dragProbe = {
      rendered: !!card,
      draggable: card && card.getAttribute('draggable') === 'true',
      dragStarted: !!(dragStartEv && !dragStartEv._prevented && st.kanbanDragAppId === 'app-k'),
      fromKey: st.kanbanDragFromStageKey,
      newRejected: !!(overNew && !overNew._prevented && overNew.dataTransfer.dropEffect === 'none'),
      rejRejected: !!(overRej && !overRej._prevented && overRej.dataTransfer.dropEffect === 'none'),
      exitAllowed: !!(overExit && overExit._prevented && overExit.dataTransfer.dropEffect === 'move'),
    };
    // Drop en Nuevo: rechazo explícito, tarjeta sigue en Contratado.
    st.kanbanError = '';
    if (colNew) {
      await recKanbanColDrop({
        preventDefault() {},
        currentTarget: colNew,
        dataTransfer: mockDt(),
      });
    }
    const afterBadDrop = {
      err: st.kanbanError || '',
      stillHired: !!(card && card.closest('.rec-kanban-col')?.getAttribute('data-stage-key') === 'HIRED'),
      modalClosed: !exitModal || exitModal.classList.contains('hidden'),
    };
    // Drop en Baja: abre modal; tarjeta permanece en Contratado.
    if (colExit) {
      await recKanbanColDrop({
        preventDefault() {},
        currentTarget: colExit,
        dataTransfer: mockDt(),
      });
    }
    const cardBefore = board && board.querySelector('.rec-kanban-card[data-app-id="app-k"]');
    const kanbanOpen = {
      modalOpen: exitModal && !exitModal.classList.contains('hidden'),
      stillHired: cardBefore && cardBefore.closest('.rec-kanban-col')?.getAttribute('data-stage-key') === 'HIRED',
      candidate: (document.getElementById('rec-exit-candidate') || {}).textContent || '',
    };
    recCandCloseEmploymentExit();
    if (card) recKanbanCardDragEnd({ currentTarget: card });
    const cardAfterCancel = board && board.querySelector('.rec-kanban-card[data-app-id="app-k"]');
    const kanbanCancel = {
      modalClosed: !exitModal || exitModal.classList.contains('hidden'),
      stillHired: cardAfterCancel && cardAfterCancel.closest('.rec-kanban-col')?.getAttribute('data-stage-key') === 'HIRED',
      stageId: st.kanbanApplications[0].stageId,
    };
    recCandOpenEmploymentExit('app-k', {
      source: 'kanban',
      fromStageId: 'st-hired',
      targetStageId: 'st-exit',
      vacancyId: 'v-k',
    });
    document.getElementById('rec-exit-reason').value = 'Fin de contrato';
    document.querySelector('input[name="rec-exit-warranty"][value="no"]').checked = true;
    apiJson = () => Promise.resolve({
      applicationId: 'app-k',
      employmentStartDate: '2026-10-01',
      employmentExit: {
        id: 'ex-k',
        exitDate: '2026-11-18',
        reason: 'Fin de contrato',
        underWarranty: false,
        registeredAt: '2026-11-21T12:00:00.000Z',
      },
      application: {
        id: 'app-k',
        candidateId: 'cand-k',
        vacancyId: 'v-k',
        stageId: 'st-exit',
        stage: { id: 'st-exit', key: 'EMPLOYMENT_EXIT', name: 'Baja' },
        employmentStartDate: '2026-10-01',
        employmentExit: {
          id: 'ex-k',
          exitDate: '2026-11-18',
          reason: 'Fin de contrato',
          underWarranty: false,
          registeredAt: '2026-11-21T12:00:00.000Z',
        },
      },
      headcount: { activeVacancies: 1, headcount: 0 },
    });
    await recCandConfirmEmploymentExit();
    const cardAfterOk = board && board.querySelector('.rec-kanban-card[data-app-id="app-k"]');
    const kanbanOk = {
      landedExit: cardAfterOk && cardAfterOk.closest('.rec-kanban-col')?.getAttribute('data-stage-key') === 'EMPLOYMENT_EXIT',
      stageKey: st.kanbanApplications[0].stage && st.kanbanApplications[0].stage.key,
      noDrag: cardAfterOk && cardAfterOk.getAttribute('draggable') === 'false',
    };
    // Error: tarjeta permanece en Contratado.
    st.kanbanApplications[0].stageId = 'st-hired';
    st.kanbanApplications[0].stage = { id: 'st-hired', key: 'HIRED', name: 'Contratado' };
    st.kanbanApplications[0].employmentExit = null;
    const hiredCol = board && board.querySelector('.rec-kanban-col[data-stage-key="HIRED"] .rec-kanban-col-body');
    if (cardAfterOk && hiredCol) hiredCol.appendChild(cardAfterOk);
    if (cardAfterOk) {
      cardAfterOk.setAttribute('data-stage-key', 'HIRED');
      cardAfterOk.setAttribute('data-stage-id', 'st-hired');
      cardAfterOk.setAttribute('draggable', 'true');
    }
    recCandOpenEmploymentExit('app-k', {
      source: 'kanban',
      fromStageId: 'st-hired',
      targetStageId: 'st-exit',
      vacancyId: 'v-k',
    });
    document.getElementById('rec-exit-reason').value = 'Error esperado';
    document.querySelector('input[name="rec-exit-warranty"][value="yes"]').checked = true;
    apiJson = () => Promise.reject(Object.assign(new Error('Fallo kanban'), { code: 'VALIDATION_ERROR' }));
    await recCandConfirmEmploymentExit();
    const cardAfterErr = board && board.querySelector('.rec-kanban-card[data-app-id="app-k"]');
    const kanbanErr = {
      stillOpen: exitModal && !exitModal.classList.contains('hidden'),
      stillHired: cardAfterErr && cardAfterErr.closest('.rec-kanban-col')?.getAttribute('data-stage-key') === 'HIRED',
      err: (document.getElementById('rec-exit-err') || {}).textContent || '',
    };

    return {
      afterOpen,
      afterEsc,
      noDate,
      callsWhilePending,
      calls,
      whileSaving,
      blockedClose,
      afterSave,
      afterFail,
      failDate,
      dragProbe,
      afterBadDrop,
      kanbanOpen,
      kanbanCancel,
      kanbanOk,
      kanbanErr,
    };
  });
  if (flow.error) {
    check(false, `flujo visual falló: ${flow.error}`);
  } else {
    check(
      flow.afterOpen.exitVisible
        && flow.afterOpen.fichaVisible
        && flow.afterOpen.fichaVisibility !== 'hidden'
        && /Ana/.test(flow.afterOpen.candidate)
        && /10\/2026/.test(flow.afterOpen.start),
      'modal secundario conserva la ficha abierta con contexto',
    );
    check(
      flow.afterEsc.exitHidden && flow.afterEsc.fichaStill && flow.afterEsc.focusBack,
      'Escape cierra la baja, conserva ficha y restaura foco',
    );
    check(
      flow.noDate.exitVisible
        && /lápiz/.test(flow.noDate.err)
        && flow.noDate.formHidden
        && flow.noDate.fichaStill,
      'sin fecha de ingreso: aviso y ficha abierta',
    );
    check(flow.callsWhilePending === 1 && flow.calls === 1, 'doble envío produce una sola solicitud');
    check(
      flow.whileSaving.label === 'Guardando…'
        && flow.whileSaving.cancelDisabled
        && flow.whileSaving.closeDisabled
        && flow.whileSaving.reasonDisabled,
      'durante el guardado muestra Guardando… y bloquea controles',
    );
    check(
      flow.blockedClose.stillOpen
        && flow.blockedClose.stillBusy
        && flow.blockedClose.reasonKept
        && flow.blockedClose.dateKept
        && flow.blockedClose.submitStillSaving,
      'Escape/Cancelar/X/fondo no cierran mientras guarda',
    );
    check(
      flow.afterSave.exitClosed
        && flow.afterSave.fichaAfterSave
        && flow.afterSave.hasExitDetails
        && flow.afterSave.noExitBtn
        && flow.afterSave.appBUntouched
        && flow.afterSave.appAHasExit,
      'tras confirmar, la baja aparece en la ficha pese a intentos de cierre',
    );
    check(
      flow.afterFail.stillOpen
        && flow.afterFail.reason === 'Motivo a conservar'
        && flow.afterFail.date === flow.failDate
        && flow.afterFail.warrantyNo
        && /Conflicto/.test(flow.afterFail.err)
        && !flow.afterFail.busy
        && flow.afterFail.submitLabel === 'Guardar baja'
        && flow.afterFail.cancelEnabled,
      'si falla, conserva datos, muestra error y rehabilita controles',
    );
    check(
      flow.dragProbe.rendered
        && flow.dragProbe.draggable
        && flow.dragProbe.dragStarted
        && flow.dragProbe.fromKey === 'HIRED'
        && flow.dragProbe.newRejected
        && flow.dragProbe.rejRejected
        && flow.dragProbe.exitAllowed,
      'dragstart desde Contratado: solo Baja acepta el arrastre',
    );
    check(
      /solo se puede mover a Baja/i.test(flow.afterBadDrop.err)
        && flow.afterBadDrop.stillHired
        && flow.afterBadDrop.modalClosed,
      'soltar Contratado en otra columna se rechaza sin abrir modal',
    );
    check(
      flow.kanbanOpen.modalOpen
        && flow.kanbanOpen.stillHired
        && /Luis/.test(flow.kanbanOpen.candidate),
      'arrastre a Baja abre modal y deja la tarjeta en Contratado',
    );
    check(
      flow.kanbanCancel.modalClosed
        && flow.kanbanCancel.stillHired
        && flow.kanbanCancel.stageId === 'st-hired',
      'cancelar baja desde Kanban no mueve la tarjeta',
    );
    check(
      flow.kanbanOk.landedExit
        && flow.kanbanOk.stageKey === 'EMPLOYMENT_EXIT'
        && flow.kanbanOk.noDrag,
      'tras confirmar desde Kanban, aterriza en Baja sin arrastre',
    );
    check(
      flow.kanbanErr.stillOpen
        && flow.kanbanErr.stillHired
        && /Fallo kanban/.test(flow.kanbanErr.err),
      'error al guardar desde Kanban deja la tarjeta en Contratado',
    );
  }
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (failed) {
  console.error(`\n${failed} comprobaciones de baja laboral fallaron\n`);
  process.exit(1);
}
console.log('\nBaja laboral en orden\n');

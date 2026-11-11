/**
 * Diálogos de declinación y archivado con HTML real y datos sintéticos.
 * node server/scripts/test-recruitment-process-closure-visual.mjs
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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

function chromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((item) => fs.existsSync(item)) || null;
}

function candidate() {
  return {
    id: 'cand-visual',
    fullName: 'Juan <img src=x onerror=alert(1)>',
    archivedAt: null,
    applications: [
      {
        applicationId: 'app-active',
        appliedAt: '2026-11-01T15:00:00.000Z',
        closureOutcome: null,
        closureReason: null,
        closureNote: null,
        vacancy: { id: 'vac-1', title: 'Operador <script>alert(1)</script> de producción', clientName: 'Planta Norte' },
        stage: { id: 'stage-1', key: 'CONTACT', name: 'Contacto inicial' },
      },
      {
        applicationId: 'app-rejected',
        appliedAt: '2026-10-02T15:00:00.000Z',
        closureOutcome: 'REJECTED',
        closureReason: null,
        closureNote: null,
        vacancy: { id: 'vac-2', title: 'Supervisor de línea', clientName: 'Planta Sur' },
        stage: { id: 'stage-2', key: 'REJECTED', name: 'Descartado' },
      },
      {
        applicationId: 'app-hired',
        appliedAt: '2026-09-01T15:00:00.000Z',
        terminalOutcomeAt: '2026-11-08T18:00:00.000Z',
        closureOutcome: null,
        vacancy: { id: 'vac-4', title: 'Coordinación de almacén', clientName: 'Planta Norte' },
        stage: { id: 'stage-4', key: 'HIRED', name: 'Contratado' },
      },
      {
        applicationId: 'app-rejected-dated',
        appliedAt: '2026-08-01T15:00:00.000Z',
        terminalOutcomeAt: '2026-11-09T06:30:00.000Z',
        closureOutcome: 'REJECTED',
        closureReason: null,
        vacancy: { id: 'vac-5', title: 'Auxiliar de patio', clientName: 'Logística' },
        stage: { id: 'stage-5', key: 'REJECTED', name: 'Descartado' },
      },
      {
        applicationId: 'app-declined',
        appliedAt: '2026-10-03T15:00:00.000Z',
        closedAt: '2026-11-09T15:00:00.000Z',
        closureOutcome: 'DECLINED',
        closureReason: 'OTHER',
        closureNote: 'El candidato explicó un motivo personal muy largo que no debe desbordar el panel ni crear una barra horizontal en el expediente.',
        vacancy: { id: 'vac-3', title: 'Chofer local', clientName: 'Logística' },
        stage: { id: 'stage-3', key: 'FINALIST', name: 'Finalista' },
      },
    ],
  };
}

async function measure(page, width) {
  await page.setViewport({ width, height: 800 });
  return page.evaluate((viewport) => {
    const xss = document.getElementById('rec-decline-vacancy');
    const dialog = document.querySelector('#modal-rec-decline .rec-process-dialog');
    const overlay = document.getElementById('modal-rec-decline');
    const reason = document.getElementById('rec-decline-reason');
    const active = document.activeElement;
    return {
      open: overlay && !overlay.classList.contains('hidden'),
      role: dialog && dialog.getAttribute('role'),
      modal: dialog && dialog.getAttribute('aria-modal'),
      labelled: dialog && dialog.getAttribute('aria-labelledby'),
      vacancy: xss ? xss.textContent : '',
      candidate: (document.getElementById('rec-decline-candidate') || {}).textContent || '',
      candidateTags: document.getElementById('rec-decline-candidate') ? document.getElementById('rec-decline-candidate').children.length : -1,
      title: (document.getElementById('rec-decline-title') || {}).textContent || '',
      copy: (document.getElementById('rec-decline-copy') || {}).textContent || '',
      childTags: xss ? xss.children.length : -1,
      focused: active && active.id,
      dialogOverflow: dialog ? dialog.scrollWidth - dialog.clientWidth : 999,
      pageOverflow: document.documentElement.scrollWidth - viewport,
      reasonLabel: !!document.querySelector('label[for="rec-decline-reason"]'),
    };
  }, width);
}

console.log('\n=== Diálogos de cierre ===\n');

const executablePath = chromePath();
if (!executablePath) {
  check(false, 'Chrome o Edge local para la validación visual');
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
  const ready = await page.evaluate(() => typeof recCandOpenDecline === 'function' && typeof recCandOpenArchiveDialog === 'function');
  check(ready, 'el HTML real expone los diálogos');
  if (ready) {
    await page.evaluate((c) => {
      const st = recEnsureState();
      st.detailCandidateId = c.id;
      st.detailCandidate = c;
      recCandOpenDecline('app-active');
    }, candidate());
    const desktop = await measure(page, 1280);
    check(desktop.open && desktop.vacancy.includes('<script>') && desktop.childTags === 0, 'escritorio: la vacante se pinta como texto');
    check(desktop.candidate.includes('<img') && desktop.candidateTags === 0, 'escritorio: el nombre se pinta como texto');
    check(desktop.title === 'El candidato declinó el proceso' && desktop.copy === 'Este proceso se cerrará y aparecerá en la columna Declinó.', 'escritorio: título y copy de declinación');
    check(desktop.role === 'dialog' && desktop.modal === 'true' && desktop.labelled === 'rec-decline-title', 'escritorio: diálogo con nombre accesible');
    check(desktop.focused === 'rec-decline-reason' && desktop.reasonLabel, 'escritorio: el foco entra al motivo');
    check(desktop.dialogOverflow <= 1 && desktop.pageOverflow <= 1, 'escritorio: el diálogo no desborda');

    const mid = await measure(page, 900);
    check(mid.open && mid.dialogOverflow <= 1 && mid.pageOverflow <= 1, '900 px: el diálogo no desborda la página');

    await page.setViewport({ width: 390, height: 800 });
    const narrow = await measure(page, 390);
    check(narrow.open && narrow.dialogOverflow <= 1, '390 px: el diálogo no desborda');
    await page.select('#rec-decline-reason', 'OTHER');
    const noteVisible = await page.evaluate(() => {
      const wrap = document.getElementById('rec-decline-note-wrap');
      return wrap && !wrap.classList.contains('hidden');
    });
    check(noteVisible, '390 px: Otro muestra el detalle');
    const kept = await page.evaluate(() => {
      const note = document.getElementById('rec-decline-note');
      note.value = 'Detalle que debe conservarse';
      const err = document.getElementById('rec-decline-err');
      err.textContent = 'Error de prueba';
      err.classList.remove('hidden');
      return note.value;
    });
    check(kept === 'Detalle que debe conservarse', 'un error conserva el detalle escrito');
    const opener = await page.evaluate(() => {
      const button = document.createElement('button');
      button.id = 'rec-decline-opener';
      button.textContent = 'Declinó';
      document.body.appendChild(button);
      button.focus();
      recDeclineReturnFocus = button;
      return document.activeElement && document.activeElement.id;
    });
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => ({
      hidden: document.getElementById('modal-rec-decline').classList.contains('hidden'),
      focus: document.activeElement && document.activeElement.id,
    }));
    check(opener === 'rec-decline-opener' && closed.hidden && closed.focus === 'rec-decline-opener', 'Escape cierra la declinación y devuelve el foco');

    const archive = await page.evaluate(() => {
      recCandOpenArchiveDialog();
      const blocked = {
        title: document.getElementById('rec-archive-title').textContent,
        message: document.getElementById('rec-archive-message').textContent,
        confirmHidden: document.getElementById('rec-archive-confirm').classList.contains('hidden'),
        reviewVisible: !document.getElementById('rec-archive-review').classList.contains('hidden'),
      };
      const st = recEnsureState();
      st.detailCandidate = { ...st.detailCandidate, applications: st.detailCandidate.applications.filter((row) => row.closureOutcome) };
      recCandOpenArchiveDialog();
      const clear = {
        title: document.getElementById('rec-archive-title').textContent,
        message: document.getElementById('rec-archive-message').textContent,
        confirmVisible: !document.getElementById('rec-archive-confirm').classList.contains('hidden'),
      };
      const dialog = document.querySelector('#modal-rec-archive .rec-process-dialog');
      return { blocked, clear, overflow: dialog.scrollWidth - dialog.clientWidth };
    });
    check(archive.blocked.title === 'Este candidato tiene procesos activos' && archive.blocked.confirmHidden && archive.blocked.reviewVisible, 'con procesos activos no ofrece archivar');
    check(archive.clear.title === 'Archivar candidato' && /Podrás reactivarlo/.test(archive.clear.message) && archive.clear.confirmVisible, 'sin procesos activos el archivo es explícito');
    check(archive.overflow <= 1, '390 px: el diálogo de archivo no desborda');

    const history = await page.evaluate(() => {
      const st = recEnsureState();
      const closed = recCandPartitionApplications(st.detailCandidate.applications).closed;
      const host = document.createElement('div');
      host.style.width = '320px';
      host.innerHTML = recCandHistoryAsideHtml(closed);
      document.body.appendChild(host);
      const items = [...host.querySelectorAll('.rec-cand-history-item')];
      const declined = items.find((item) => item.textContent.includes('Chofer'));
      const rejected = items.find((item) => item.textContent.includes('Supervisor'));
      const line = (item, sel) => (item && item.querySelector(sel) ? item.querySelector(sel).textContent : '');
      return {
        scripts: host.querySelectorAll('script,img').length,
        overflow: host.scrollWidth - host.clientWidth,
        declinedOutcome: line(declined, '.rec-cand-history-outcome'),
        declinedPeriod: line(declined, '.rec-cand-history-period'),
        declinedStage: line(declined, '.rec-cand-history-stage'),
        declinedReason: line(declined, '.rec-cand-history-reason'),
        declinedNote: line(declined, '.rec-cand-history-note'),
        rejectedOutcome: line(rejected, '.rec-cand-history-outcome'),
        rejectedPeriod: line(rejected, '.rec-cand-history-period'),
        rejectedStage: line(rejected, '.rec-cand-history-stage'),
        rejectedReason: rejected ? rejected.querySelectorAll('.rec-cand-history-reason').length : -1,
        rejectedDate: rejected ? rejected.querySelectorAll('time').length : -1,
      };
    });
    check(
      history.declinedOutcome === 'Declinó'
        && /Inicio /.test(history.declinedPeriod)
        && /Cierre /.test(history.declinedPeriod)
        && history.declinedStage === 'Última etapa: Finalista'
        && history.declinedReason === 'Otro'
        && history.declinedNote.includes('motivo personal muy largo'),
      'el historial separa resultado, periodo, etapa, motivo y detalle',
    );
    check(
      history.rejectedOutcome === 'Rechazado'
        && /Inicio /.test(history.rejectedPeriod)
        && !/Cierre /.test(history.rejectedPeriod)
        && history.rejectedStage === 'Última etapa: Descartado'
        && history.rejectedReason === 0,
      'un histórico sin closedAt no inventa cierre ni motivo',
    );
    check(history.scripts === 0 && history.overflow <= 1 && history.rejectedDate === 0, 'el motivo largo no se ejecuta ni desborda y un rechazo sin fecha no inventa una');

    const dates = await page.evaluate((applications) => {
      const st = recEnsureState();
      st.recruitmentOrgTimeZone = 'America/Mexico_City';
      const closed = recCandPartitionApplications(applications).closed;
      const host = document.createElement('div');
      host.id = 'rec-hist-dates';
      host.style.width = '320px';
      host.innerHTML = recCandHistoryAsideHtml(closed);
      document.body.appendChild(host);
      const item = (title) => [...host.querySelectorAll('.rec-cand-history-item')].find((node) => node.textContent.includes(title));
      const hired = item('Coordinación');
      const rejected = item('Auxiliar');
      const hiredOutcome = hired.querySelector('.rec-cand-history-outcome');
      const rejectedOutcome = rejected.querySelector('.rec-cand-history-outcome');
      const hiredTime = hired.querySelector('time');
      const rejectedTime = rejected.querySelector('time');
      return {
        hiredText: hiredOutcome.textContent,
        rejectedText: rejectedOutcome.textContent,
        hiredDate: hiredTime.textContent,
        rejectedDate: rejectedTime.textContent,
        hiredColor: getComputedStyle(hiredOutcome).color,
        rejectedColor: getComputedStyle(rejectedOutcome).color,
        dateColor: getComputedStyle(hiredTime).color,
        described: hiredOutcome.getAttribute('aria-describedby') === hiredTime.id,
        hiredBelow: hiredTime.getBoundingClientRect().top >= hiredOutcome.getBoundingClientRect().bottom - 1,
        hiredDatetime: hiredTime.getAttribute('datetime'),
        rejectedDatetime: rejectedTime.getAttribute('datetime'),
        midnightBefore: recCandFmtTerminalDate('2026-11-09T05:30:00.000Z', 'America/Mexico_City'),
        midnightAfter: recCandFmtTerminalDate('2026-11-09T06:30:00.000Z', 'America/Mexico_City'),
        repeated: (hired.textContent.match(/08\/11\/2026/g) || []).length,
        resultText: hired.querySelector('.rec-cand-history-result').textContent.replace(/\s+/g, ''),
        noCierre: !/Cierre|Contratado el|Rechazado el|Fecha de contratación|\bFecha\b/.test(hired.textContent + rejected.textContent),
        startKept: /Inicio /.test(hired.querySelector('.rec-cand-history-period').textContent),
        companyKept: hired.textContent.includes('Coordinación de almacén'),
        activeTimes: (recCandHistoryAsideHtml(recCandPartitionApplications([{
          applicationId: 'open-1',
          vacancy: { title: 'Proceso abierto' },
          stage: { key: 'INTERVIEW', name: 'Entrevista' },
          terminalOutcomeAt: '2026-11-08T18:00:00.000Z',
          appliedAt: '2026-01-01T12:00:00.000Z',
          closureOutcome: null,
        }]).closed).match(/<time/g) || []).length,
      };
    }, candidate().applications);
    check(dates.hiredText === 'Contratado' && dates.hiredDate === '08/11/2026' && dates.hiredColor === 'rgb(4, 120, 87)', 'Contratado permanece en verde con la fecha debajo');
    check(dates.rejectedText === 'Rechazado' && dates.rejectedDate === '09/11/2026' && dates.rejectedColor === 'rgb(185, 28, 28)', 'Rechazado queda en rojo con la fecha debajo');
    check(dates.midnightBefore === '08/11/2026' && dates.midnightAfter === '09/11/2026', 'la medianoche usa la zona de la organización');
    check(dates.hiredDatetime === '2026-11-08' && dates.rejectedDatetime === '2026-11-09', 'el datetime coincide con el día mostrado');
    check(dates.hiredBelow && dates.described && dates.dateColor !== dates.hiredColor && dates.repeated === 1 && dates.resultText === 'Contratado08/11/2026' && dates.noCierre && dates.startKept && dates.companyKept && dates.activeTimes === 0, 'la fecha es secundaria, única y no aparece en un proceso activo');

    const widths = {};
    for (const width of [1280, 900, 390]) {
      await page.setViewport({ width, height: 800 });
      widths[width] = await page.evaluate((viewport) => {
        const host = document.getElementById('rec-hist-dates');
        host.style.width = `${Math.max(280, viewport - 32)}px`;
        const card = host.getBoundingClientRect();
        const item = host.querySelector('.rec-cand-history-item');
        return {
          overflow: host.scrollWidth - host.clientWidth,
          page: document.documentElement.scrollWidth - viewport,
          itemH: Math.round(item.getBoundingClientRect().height),
          cardW: Math.round(card.width),
        };
      }, width);
    }
    check(widths[1280].overflow <= 1 && widths[900].overflow <= 1 && widths[390].overflow <= 1, '1280, 900 y 390 no desbordan el historial');
    check(widths[390].page <= 1 && widths[390].itemH < 220, 'el expediente móvil no desborda y la fecha no infla la tarjeta');

    await page.setViewport({ width: 390, height: 800 });
    const workspace = await page.evaluate((viewport) => {
      const filters = [...document.querySelectorAll('[data-tc-my-cand-filter]')].map((btn) => btn.textContent.trim());
      tcEmpMyCandItems = [
        {
          id: 'c-dec',
          fullName: `${'A'.repeat(90)} <img src=x onerror=alert(1)>`,
          profile: 'Operador',
          primaryActiveProcess: {
            listPreviewKind: 'declined',
            vacancyTitle: 'Almacén nocturno',
            closureReason: 'ACCEPTED_OTHER_OFFER',
          },
        },
        {
          id: 'c-plain',
          fullName: 'Luis Sin Motivo',
          profile: 'Ayudante',
          primaryActiveProcess: { listPreviewKind: 'declined', vacancyTitle: 'Caja', closureReason: null },
        },
      ];
      tcEmpMyCandNextCursor = null;
      document.getElementById('view-timeclock').classList.remove('hidden');
      document.getElementById('tc-emp-app').classList.remove('hidden');
      ['modal-rec-decline', 'modal-rec-archive'].forEach((id) => {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('hidden');
      });
      tcEmpWorkspaceSetTab('candidates');
      tcEmpMyCandRenderList();
      const list = document.getElementById('tc-emp-my-cand-list');
      const cards = [...list.querySelectorAll('.tc-emp-my-cand-card')].map((card) => card.textContent);
      const declinedBtn = document.querySelector('[data-tc-my-cand-filter="declined"]');
      declinedBtn.focus();
      return {
        filters,
        cards,
        scripts: list.querySelectorAll('script,img').length,
        focused: document.activeElement === declinedBtn,
        listOverflow: list.scrollWidth - list.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - viewport,
      };
    }, 390);
    check(
      workspace.filters.join('|') === 'Todos|En proceso|Contratados|Rechazados|Declinados',
      'Espacio de trabajo muestra los cinco filtros',
    );
    check(
      workspace.cards[0].includes('Declinó · Aceptó otra oferta')
        && workspace.cards[0].includes('Almacén nocturno')
        && workspace.cards[0].includes('<img')
        && workspace.scripts === 0,
      'la tarjeta declinada muestra motivo y escapa el nombre',
    );
    check(
      workspace.cards[1].includes('Declinó')
        && !workspace.cards[1].includes('Declinó ·')
        && !workspace.cards[1].includes('Sin motivo')
        && workspace.cards[1].includes('Caja'),
      'sin motivo la tarjeta solo dice Declinó',
    );
    check(workspace.focused && workspace.listOverflow <= 1 && workspace.pageOverflow <= 1, 'filtros y tarjetas a 390 px no desbordan y el filtro toma foco');

    const readCards = (viewport) => page.evaluate((width) => {
      const rows = [
        { id: 'hired-plain', fullName: 'Ana Contratada', profile: 'Operador', createdAt: '2026-11-01T15:00:00.000Z', primaryActiveProcess: { listPreviewKind: 'hired', vacancyTitle: 'Almacén' } },
        { id: 'hired-tags', fullName: 'Beto <img src=x onerror=alert(1)>', profile: 'Supervisor', tags: [{ name: 'Buen perfil', colorKey: 'green' }, { name: 'Contratado', colorKey: 'slate' }], primaryActiveProcess: { listPreviewKind: 'hired', vacancyTitle: 'Vacante <script>alert(1)</script>' } },
        { id: 'rejected-plain', fullName: 'Clara Rechazada', profile: 'Ayudante', primaryActiveProcess: { listPreviewKind: 'rejected', vacancyTitle: 'Caja' } },
        { id: 'rejected-tags', fullName: 'Diego', profile: 'Chofer', tags: [{ name: 'Mala actitud', colorKey: 'red' }, { name: 'Referencias negativas', colorKey: 'red' }], primaryActiveProcess: { listPreviewKind: 'rejected', vacancyTitle: 'Ruta' } },
        { id: 'declined-reason', fullName: 'Elena', profile: 'Analista', primaryActiveProcess: { listPreviewKind: 'declined', vacancyTitle: 'Oficina', closureReason: 'ACCEPTED_OTHER_OFFER' } },
        { id: 'declined-plain', fullName: 'Fede', profile: 'Auxiliar', primaryActiveProcess: { listPreviewKind: 'declined', vacancyTitle: 'Recepción', closureReason: null } },
        { id: 'active', fullName: 'Gala', profile: 'Compras', primaryActiveProcess: { listPreviewKind: 'active', stageName: 'Entrevista', vacancyTitle: 'Compras' } },
      ];
      tcEmpMyCandItems = rows;
      tcEmpMyCandNextCursor = null;
      tcEmpMyCandFilter = 'all';
      tcEmpMyCandRenderList();
      const list = document.getElementById('tc-emp-my-cand-list');
      const byId = {};
      list.querySelectorAll('.tc-emp-my-cand-card').forEach((card) => {
        const left = card.querySelector('.tc-emp-my-cand-card-left');
        const right = card.querySelector('.tc-emp-my-cand-card-right');
        const tags = left.querySelector('.tc-emp-my-cand-tags');
        byId[card.getAttribute('data-candidate-id')] = {
          badges: [...left.querySelectorAll('.tc-emp-my-cand-badge')].map((el) => el.textContent.trim()),
          tags: tags ? [...tags.querySelectorAll('.rec-cand-tag')].map((el) => el.textContent.trim()) : [],
          tagsRow: !!tags,
          right: right.textContent.replace(/\s+/g, ' ').trim(),
          nodes: card.querySelectorAll('script,img,b').length,
        };
      });
      const base = list.innerHTML;
      const sameHtml = ['hired', 'rejected', 'declined', 'in_process'].every((filter) => {
        tcEmpMyCandFilter = filter;
        tcEmpMyCandRenderList();
        return document.getElementById('tc-emp-my-cand-list').innerHTML === base;
      });
      tcEmpMyCandFilter = 'all';
      tcEmpMyCandRenderList();
      return {
        byId,
        sameHtml,
        listOverflow: list.scrollWidth - list.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - width,
      };
    }, viewport);
    await page.setViewport({ width: 1280, height: 800 });
    const desktopCards = await readCards(1280);
    await page.setViewport({ width: 390, height: 800 });
    const mobileCards = await readCards(390);
    const cards = { desktop: desktopCards, mobile: mobileCards };
    const hiredPlain = cards.desktop.byId['hired-plain'];
    const hiredTags = cards.desktop.byId['hired-tags'];
    const rejectedPlain = cards.desktop.byId['rejected-plain'];
    const rejectedTags = cards.desktop.byId['rejected-tags'];
    const declinedReason = cards.desktop.byId['declined-reason'];
    const declinedPlain = cards.desktop.byId['declined-plain'];
    const active = cards.desktop.byId.active;
    const once = (text, needle) => text.split(needle).length - 1 === 1;
    check(hiredPlain.badges.length === 0 && !hiredPlain.tagsRow && once(hiredPlain.right, 'Contratado') && hiredPlain.right.includes('Almacén'), 'contratado sin etiquetas muestra Contratado una sola vez, a la derecha');
    check(hiredTags.badges.length === 0 && once(hiredTags.right, 'Contratado') && hiredTags.tags.join('|') === 'Buen perfil|Contratado' && hiredTags.nodes === 0, 'contratado conserva Contratado a la derecha y las etiquetas administrativas, aunque una se llame Contratado');
    check(rejectedPlain.badges.length === 0 && !rejectedPlain.tagsRow && once(rejectedPlain.right, 'Rechazado'), 'rechazado sin etiquetas muestra Rechazado una sola vez');
    check(rejectedTags.badges.length === 0 && once(rejectedTags.right, 'Rechazado') && rejectedTags.tags.join('|') === 'Mala actitud|Referencias negativas', 'rechazado conserva solo sus etiquetas administrativas abajo');
    check(declinedReason.badges.length === 0 && !declinedReason.tagsRow && once(declinedReason.right, 'Declinó · Aceptó otra oferta') && declinedReason.right.includes('Oficina'), 'declinado con motivo lo muestra una sola vez, a la derecha');
    check(declinedPlain.badges.length === 0 && !declinedPlain.tagsRow && once(declinedPlain.right, 'Declinó') && !declinedPlain.right.includes('Declinó ·'), 'declinado sin motivo muestra únicamente Declinó a la derecha');
    check(active.badges.join('|') === 'En proceso' && active.right.includes('Etapa actual') && active.right.includes('Entrevista') && !active.tagsRow, 'En proceso conserva su pastilla y la etapa, sin fila vacía');
    check(cards.desktop.sameHtml && cards.mobile.sameHtml, 'Todos, Contratados, Rechazados, Declinados y En proceso usan el mismo render de tarjeta');
    check(cards.desktop.listOverflow <= 1 && cards.desktop.pageOverflow <= 1 && cards.mobile.listOverflow <= 1 && cards.mobile.pageOverflow <= 1, 'las tarjetas no desbordan en escritorio ni en móvil');

    const archived = await page.evaluate(() => {
      const st = recEnsureState();
      st.detailCandidate = { id: 'cand-archived', archivedAt: '2026-11-08T00:00:00.000Z', applications: [] };
      recCandRenderPipelineSection(st.detailCandidate);
      const host = document.getElementById('rec-cand-pipeline-host');
      return {
        text: host ? host.textContent : '',
        buttons: host ? host.querySelectorAll('button').length : -1,
      };
    });
    check(
      archived.text.includes('Este candidato está archivado. Reactívalo para iniciar un nuevo proceso.') && archived.buttons === 0,
      'el candidato archivado no ofrece añadir vacante',
    );
    const toolbar = await page.evaluate(() => {
      recCandSyncArchivedActions(recEnsureState().detailCandidate);
      const addBtn = document.getElementById('rec-cand-toolbar-add-vac');
      return { disabled: !!addBtn.disabled, title: addBtn.title };
    });
    check(
      toolbar.disabled && toolbar.title === 'Este candidato está archivado. Reactívalo para iniciar un nuevo proceso.',
      'la acción de vacante del expediente queda deshabilitada',
    );
    const board = await page.evaluate(() => {
      const st = recEnsureState();
      st.kanbanStages = [
        { stageId: 's-contact', stage: { id: 's-contact', key: 'CONTACT', name: 'Contacto' } },
        { stageId: 's-hired', stage: { id: 's-hired', key: 'HIRED', name: 'Contratado' } },
        { stageId: 's-rejected', stage: { id: 's-rejected', key: 'REJECTED', name: 'Descartado' } },
      ];
      st.kanbanApplications = [
        { id: 'a-open', stageId: 's-contact', stage: { key: 'CONTACT' }, candidate: { id: 'c1', fullName: 'Ana Abierta' } },
        { id: 'a-hired', stageId: 's-hired', stage: { key: 'HIRED' }, candidate: { id: 'c2', fullName: 'Beto Contratado' } },
        { id: 'a-declined', stageId: 's-contact', stage: { key: 'CONTACT', name: 'Contacto' }, closureOutcome: 'DECLINED', closureReason: 'SCHEDULE', candidate: { id: 'c3', fullName: 'Clara Declinó' } },
        { id: 'a-declined-archived', stageId: 's-contact', stage: { key: 'FINALIST', name: 'Finalista' }, closureOutcome: 'DECLINED', closureReason: null, candidate: { id: 'c6', fullName: 'Fede Archivado', archivedAt: '2026-11-08T00:00:00.000Z' } },
        { id: 'a-rejected', stageId: 's-rejected', stage: { key: 'REJECTED' }, closureOutcome: 'REJECTED', candidate: { id: 'c4', fullName: 'Diego Rechazado' } },
        { id: 'a-archived', stageId: 's-rejected', stage: { key: 'REJECTED' }, closureOutcome: null, candidate: { id: 'c5', fullName: 'Elena Archivada', archivedAt: '2026-11-08T00:00:00.000Z' } },
      ];
      recKanbanRender('vac-visual');
      const hiredCol = document.querySelector('.rec-kanban-col[data-stage-id="s-hired"]');
      const hiredCard = hiredCol ? hiredCol.querySelector('.rec-kanban-card') : null;
      const contactCol = document.querySelector('.rec-kanban-col[data-stage-id="s-contact"]');
      const rejectedCol = document.querySelector('.rec-kanban-col[data-stage-id="s-rejected"]');
      const rejectedCards = rejectedCol ? [...rejectedCol.querySelectorAll('.rec-kanban-card')] : [];
      const declinedCol = document.querySelector('.rec-kanban-col[data-stage-id="__DECLINED__"]');
      const declinedCards = declinedCol ? [...declinedCol.querySelectorAll('.rec-kanban-card')] : [];
      const titles = [...document.querySelectorAll('.rec-kanban-col-title')].map((node) => node.textContent);
      let hiredBlocked = false;
      let rejectedBlocked = false;
      let declinedBlocked = false;
      if (hiredCard) recKanbanCardDragStart({ currentTarget: hiredCard, preventDefault() { hiredBlocked = true; } });
      if (rejectedCards[0]) recKanbanCardDragStart({ currentTarget: rejectedCards[0], preventDefault() { rejectedBlocked = true; } });
      if (declinedCards[0]) recKanbanCardDragStart({ currentTarget: declinedCards[0], preventDefault() { declinedBlocked = true; } });
      const actions = {
        open: recCandHeroHtml({ stage: { key: 'CONTACT', name: 'Contacto' }, vacancy: { title: 'Vacante' } }).includes('rec-cand-decline-btn'),
        hired: recCandHeroHtml({ stage: { key: 'HIRED', name: 'Contratado' }, vacancy: { title: 'Vacante' } }).includes('rec-cand-decline-btn'),
        rejected: recCandHeroHtml({ stage: { key: 'REJECTED', name: 'Descartado' }, closureOutcome: 'REJECTED', vacancy: { title: 'Vacante' } }).includes('rec-cand-decline-btn'),
        declined: recCandHeroHtml({ stage: { key: 'CONTACT', name: 'Contacto' }, closureOutcome: 'DECLINED', vacancy: { title: 'Vacante' } }).includes('rec-cand-decline-btn'),
      };
      st.kanbanApplications = st.kanbanApplications.filter((row) => row.closureOutcome !== 'DECLINED');
      st.kanbanHideEmpty = true;
      st.kanbanEmptyPinnedOpen = {};
      recKanbanRender('vac-visual');
      const emptyDeclined = document.querySelector('.rec-kanban-col[data-stage-id="__DECLINED__"]');
      const emptyKey = recKanbanColCollapseKey('vac-visual', '__DECLINED__');
      st.kanbanEmptyPinnedOpen[emptyKey] = true;
      recKanbanRender('vac-visual');
      const pinnedDeclined = document.querySelector('.rec-kanban-col[data-stage-id="__DECLINED__"]');
      st.kanbanStages = [
        { stageId: 's-contact', stage: { id: 's-contact', key: 'CONTACT', name: 'Contacto' } },
        { stageId: 's-finalist', stage: { id: 's-finalist', key: 'FINALIST', name: 'Finalista' } },
        { stageId: 's-hired', stage: { id: 's-hired', key: 'HIRED', name: 'Contratado' } },
      ];
      st.kanbanHideEmpty = false;
      recKanbanRender('vac-visual');
      const titlesWithoutRejected = [...document.querySelectorAll('.rec-kanban-col-title')].map((node) => node.textContent);
      return {
        hiredCount: hiredCol ? hiredCol.querySelector('.rec-kanban-col-count').textContent : '',
        hiredName: hiredCard ? hiredCard.querySelector('.rec-kanban-card-name').textContent : '',
        hiredDrag: hiredCard ? hiredCard.getAttribute('draggable') : '',
        contactNames: contactCol ? [...contactCol.querySelectorAll('.rec-kanban-card-name')].map((node) => node.textContent) : [],
        rejectedTitle: rejectedCol ? rejectedCol.querySelector('.rec-kanban-col-title').textContent : '',
        rejectedCount: rejectedCol ? rejectedCol.querySelector('.rec-kanban-col-count').textContent : '',
        rejectedNames: rejectedCards.map((card) => card.querySelector('.rec-kanban-card-name').textContent),
        rejectedDrag: rejectedCards.map((card) => card.getAttribute('draggable')),
        hiredBlocked,
        rejectedBlocked,
        declinedBlocked,
        dragging: !!recEnsureState().kanbanDragging,
        titles,
        declinedTitle: declinedCol ? declinedCol.querySelector('.rec-kanban-col-title').textContent : '',
        declinedCount: declinedCol ? declinedCol.querySelector('.rec-kanban-col-count').textContent : '',
        declinedNames: declinedCards.map((card) => card.querySelector('.rec-kanban-card-name').textContent),
        declinedReason: declinedCards[0] ? (declinedCards[0].querySelector('.rec-kanban-card-reason') || {}).textContent || '' : '',
        declinedBlank: declinedCards[1] ? declinedCards[1].querySelectorAll('.rec-kanban-card-reason').length : -1,
        declinedDrag: declinedCards.map((card) => card.getAttribute('draggable')),
        declinedDrop: declinedCol ? declinedCol.getAttribute('ondrop') : 'missing',
        declinedOpens: declinedCards[0] ? String(declinedCards[0].getAttribute('onclick') || '').includes('recKanbanCardClick') : false,
        titlesWithoutRejected,
        actions,
        emptyCollapsed: !!(emptyDeclined && emptyDeclined.classList.contains('rec-kanban-col--collapsed')),
        pinnedOpen: !!(pinnedDeclined && !pinnedDeclined.classList.contains('rec-kanban-col--collapsed')),
      };
    });
    check(board.titles.join('|') === 'Contacto|Contratado|Declinó|Descartado', 'Declinó queda entre Contratado y Descartado');
    check(board.titlesWithoutRejected.join('|') === 'Contacto|Finalista|Contratado|Declinó', 'sin Descartado, Declinó queda al final y el resto no se reordena');
    check(board.declinedOpens, 'el clic de una tarjeta declinada abre el expediente');
    check(board.hiredName === 'Beto Contratado' && board.hiredCount === '1' && board.hiredDrag === 'false', 'Contratado conserva la tarjeta y su contador');
    check(board.contactNames.length === 1 && board.contactNames[0] === 'Ana Abierta', 'DECLINED no cuenta en su etapa anterior');
    check(board.declinedTitle === 'Declinó' && board.declinedCount === '2' && board.declinedNames.join('|') === 'Clara Declinó|Fede Archivado', 'Declinó muestra cerradas y archivadas');
    check(board.declinedReason === 'Horario' && board.declinedBlank === 0, 'el motivo se muestra solo cuando existe');
    check(board.declinedDrag.every((value) => value === 'false') && board.declinedDrop == null, 'las tarjetas de Declinó no se arrastran ni aceptan etapa');
    check(board.rejectedTitle === 'Descartado' && board.rejectedCount === '2' && board.rejectedNames.join('|') === 'Diego Rechazado|Elena Archivada', 'Descartado conserva rechazo cerrado, histórico y archivado');
    check(board.rejectedDrag.every((value) => value === 'false'), 'las tarjetas de Descartado no son arrastrables');
    check(board.hiredBlocked && board.rejectedBlocked && board.declinedBlocked && board.dragging === false, 'Contratado, Declinó y Descartado no inician el arrastre');
    check(board.actions.open && !board.actions.hired && !board.actions.rejected && !board.actions.declined, 'Declinó solo aparece en un proceso abierto');
    check(board.emptyCollapsed && board.pinnedOpen, 'una columna Declinó vacía se oculta y puede abrirse');
    const collapsed = await page.evaluate(() => {
      const st = recEnsureState();
      st.kanbanHideEmpty = true;
      st.kanbanStages = [
        { stageId: 's-contact', stage: { id: 's-contact', key: 'CONTACT', name: 'Contacto' } },
        { stageId: 's-hired', stage: { id: 's-hired', key: 'HIRED', name: 'Contratado' } },
        { stageId: 's-rejected', stage: { id: 's-rejected', key: 'REJECTED', name: 'Descartado' } },
      ];
      st.kanbanApplications = [
        { id: 'a-declined', stageId: 's-contact', stage: { key: 'CONTACT' }, closureOutcome: 'DECLINED', closureReason: 'SCHEDULE', candidate: { id: 'c3', fullName: 'Clara <script>alert(1)</script>' } },
      ];
      st.kanbanColCollapsed = {};
      localStorage.removeItem('rec_kanban_cols_vac-visual');
      recKanbanRender('vac-visual');
      recKanbanToggleCol('vac-visual', '__DECLINED__');
      const col = document.querySelector('.rec-kanban-col[data-stage-id="__DECLINED__"]');
      const stored = JSON.parse(localStorage.getItem('rec_kanban_cols_vac-visual') || '{}');
      const afterCollapse = {
        collapsed: !!(col && col.classList.contains('rec-kanban-col--collapsed')),
        label: col ? col.querySelector('.rec-kanban-col-collapse-btn').getAttribute('aria-label') : '',
        count: col ? col.querySelector('.rec-kanban-col-count').textContent : '',
        name: col ? col.querySelector('.rec-kanban-card-name').textContent : '',
        drop: col ? col.getAttribute('ondrop') : 'missing',
        stored: stored.__DECLINED__ === true,
        other: Object.keys(stored).filter((key) => key !== '__DECLINED__').length,
      };
      recKanbanRender('vac-visual');
      document.getElementById('view-dash-recruitment').classList.remove('hidden');
      document.getElementById('rec-selected-panel').classList.remove('hidden');
      const again = document.querySelector('.rec-kanban-col[data-stage-id="__DECLINED__"]');
      const btn = again && again.querySelector('.rec-kanban-col-collapse-btn');
      if (btn) btn.focus();
      if (again) again.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
      const afterDrag = !!(again && again.classList.contains('rec-kanban-col--collapsed'));
      const focused = document.activeElement === btn;
      const title = btn ? btn.getAttribute('title') : '';
      const visible = !!(btn && btn.getClientRects().length);
      recKanbanToggleCol('vac-visual', '__DECLINED__');
      const opened = document.querySelector('.rec-kanban-col[data-stage-id="__DECLINED__"]');
      const otherVacancy = JSON.parse(localStorage.getItem('rec_kanban_cols_vac-otra') || '{}');
      return {
        ...afterCollapse,
        still: !!(again && again.classList.contains('rec-kanban-col--collapsed')),
        afterDrag,
        focused,
        visible,
        title,
        opened: !!(opened && !opened.classList.contains('rec-kanban-col--collapsed')),
        leaked: otherVacancy.__DECLINED__ === true,
        scripts: col ? col.querySelectorAll('script').length : -1,
      };
    });
    check(collapsed.collapsed && collapsed.label === 'Expandir etapa' && collapsed.count === '1', 'Declinó con tarjetas se contrae y conserva el contador');
    check(collapsed.still && collapsed.stored && collapsed.other === 0 && collapsed.afterDrag, 'la contracción persiste al repintar, queda en la vacante y el arrastre no la abre');
    check(collapsed.focused && collapsed.visible && collapsed.title === 'Expandir etapa', 'el control de Declinó toma foco y anuncia el estado');
    check(collapsed.opened, 'Declinó vuelve a expandirse');
    check(collapsed.drop == null && collapsed.name.includes('<script>') && collapsed.scripts === 0 && collapsed.leaked === false, 'contraída no acepta drop y el nombre queda como texto');
  }
  check(pageErrors.length === 0, pageErrors.length ? `errores de página: ${pageErrors[0]}` : 'la página no lanza errores al abrir');
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (failed) {
  console.error(`\n${failed} comprobaciones visuales fallaron\n`);
  process.exit(1);
}
console.log('\nDiálogos de cierre en orden\n');

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
        applicationId: 'app-declined',
        appliedAt: '2026-10-03T15:00:00.000Z',
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
      const text = host.textContent || '';
      const scripts = host.querySelectorAll('script,img').length;
      return {
        text,
        scripts,
        overflow: host.scrollWidth - host.clientWidth,
        rejected: text.includes('Rechazado') && text.includes('Descartado'),
        declined: text.includes('Declinó') && text.includes('Finalista') && text.includes('motivo personal muy largo'),
      };
    });
    check(history.rejected && history.declined, 'el historial muestra resultado, última etapa y motivo');
    check(history.scripts === 0 && history.overflow <= 1, 'el motivo largo no se ejecuta ni desborda');

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
      const declinedCol = document.querySelector('.rec-kanban-col[data-stage-id="rec-kanban-declined"]');
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
      const emptyDeclined = document.querySelector('.rec-kanban-col[data-stage-id="rec-kanban-declined"]');
      const emptyKey = recKanbanColCollapseKey('vac-visual', 'rec-kanban-declined');
      st.kanbanEmptyPinnedOpen[emptyKey] = true;
      recKanbanRender('vac-visual');
      const pinnedDeclined = document.querySelector('.rec-kanban-col[data-stage-id="rec-kanban-declined"]');
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

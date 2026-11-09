/**
 * Arrastre del Kanban con datos sintéticos, sin servidor ni producción.
 * node server/scripts/test-recruitment-kanban-drag-visual.mjs
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

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`No está ${name}`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`Función sin cerrar: ${name}`);
}

const fnNames = [
  'recEnsureState',
  'recKanbanColCollapseKey',
  'recKanbanHideEmptyEnabled',
  'recKanbanColumnShouldCollapse',
  'recKanbanEmptyToggleState',
  'recKanbanSyncEmptyChrome',
  'recKanbanColCardCount',
  'recKanbanPrefersReducedMotion',
  'recKanbanAutoScrollStop',
  'recKanbanAutoScrollTick',
  'recKanbanAutoScrollFromPointer',
  'recKanbanRestoreEmptyAfterDrag',
  'recKanbanCardDragStart',
  'recKanbanCardDragEnd',
  'recKanbanColDragOver',
];
const script = fnNames.map((name) => extractFunction(indexHtml, name)).join('\n');

function chromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((item) => fs.existsSync(item)) || '';
}

function boardHtml() {
  const cols = [];
  for (let n = 1; n <= 8; n += 1) {
    const cards = n <= 2
      ? `<div class="rec-kanban-col-body"><article class="rec-kanban-card" data-app-id="app-${n}" data-stage-id="s${n}" draggable="true">Candidato ${n}</article></div>`
      : '<div class="rec-kanban-col-body"></div>';
    cols.push(`<section class="rec-kanban-col" data-stage-id="s${n}" style="flex:0 0 280px;height:180px;">${cards}</section>`);
  }
  return `<!doctype html><html><head><style>
    html,body{margin:0;height:1400px;overflow:auto;}
    #rec-kanban-board{display:flex;gap:10px;overflow-x:auto;overflow-y:hidden;height:220px;width:100%;}
    .rec-kanban-col--collapsed{flex:0 0 52px !important;}
  </style></head><body>
    <div id="rec-kanban-board">${cols.join('')}</div>
    <script>${script}</script>
  </body></html>`;
}

async function frames(page, count) {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }, count);
}

async function runWidth(page, width) {
  await page.setViewport({ width, height: 800 });
  const result = await page.evaluate((viewport) => {
    sessionStorage.setItem('rec_kanban_hide_empty', '1');
    const beforePref = sessionStorage.getItem('rec_kanban_hide_empty');
    const st = recEnsureState();
    st.selectedId = 'vac-1';
    st.kanbanHideEmpty = true;
    st.kanbanEmptyPinnedOpen = { 'vac-1:s3': true, 'vac-1:s4': true };
    st.kanbanColCollapsed = {};
    st.kanbanDragging = false;
    st.kanbanAutoScrollX = 0;
    st.kanbanAutoScrollRaf = 0;
    const board = document.getElementById('rec-kanban-board');
    const columns = [...board.querySelectorAll('.rec-kanban-col')];
    const orderBefore = columns.map((col) => col.getAttribute('data-stage-id')).join(',');
    columns.forEach((col) => {
      const count = col.querySelectorAll('.rec-kanban-card').length;
      const collapsed = recKanbanColumnShouldCollapse('vac-1', col.getAttribute('data-stage-id'), count);
      col.classList.toggle('rec-kanban-col--collapsed', collapsed);
    });
    const collapsedBefore = columns.filter((col) => col.classList.contains('rec-kanban-col--collapsed')).map((col) => col.getAttribute('data-stage-id'));
    const heightBefore = board.getBoundingClientRect().height;
    const pageTopBefore = document.scrollingElement.scrollTop;
    const card = board.querySelector('.rec-kanban-card');
    recKanbanCardDragStart({
      currentTarget: card,
      preventDefault() {},
      dataTransfer: { setData() {}, effectAllowed: '' },
    });
    const collapsedDuring = columns.filter((col) => col.classList.contains('rec-kanban-col--collapsed')).map((col) => col.getAttribute('data-stage-id'));
    const openedDuring = ['s3', 's4'].every((id) => !board.querySelector(`[data-stage-id="${id}"]`).classList.contains('rec-kanban-col--collapsed'));
    const hiddenStay = ['s5', 's6', 's7', 's8'].every((id) => board.querySelector(`[data-stage-id="${id}"]`).classList.contains('rec-kanban-col--collapsed'));
    const overEvent = { clientX: 0, currentTarget: columns[4], dataTransfer: { dropEffect: '' }, preventDefault() { this.prevented = true; }, prevented: false };
    overEvent.currentTarget.closest = function closest(sel) { return this.matches(sel) ? this : null; };
    recKanbanColDragOver(overEvent);
    const hiddenNotTarget = overEvent.dataTransfer.dropEffect === 'none' && overEvent.prevented === false;
    return {
      viewport,
      beforePref,
      orderBefore,
      collapsedBefore: collapsedBefore.join(','),
      collapsedDuring: collapsedDuring.join(','),
      openedDuring,
      hiddenStay,
      hiddenNotTarget,
      heightBefore,
      pageTopBefore,
      columnCount: columns.length,
    };
  }, width);

  const scroll = await page.evaluate(async () => {
    const board = document.getElementById('rec-kanban-board');
    const st = recEnsureState();
    const heightDuring = board.getBoundingClientRect().height;
    board.scrollLeft = 0;
    const rect = board.getBoundingClientRect();
    st.kanbanDragging = true;
    recKanbanAutoScrollFromPointer(rect.right - 8);
    for (let i = 0; i < 12; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
    const afterRight = board.scrollLeft;
    recKanbanAutoScrollFromPointer(rect.left + rect.width / 2);
    for (let i = 0; i < 8; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
    const afterLeave = board.scrollLeft;
    board.scrollLeft = Math.max(80, board.scrollLeft);
    const beforeLeft = board.scrollLeft;
    recKanbanAutoScrollFromPointer(rect.left + 8);
    for (let i = 0; i < 12; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
    const afterLeft = board.scrollLeft;
    const card = board.querySelector('.rec-kanban-card');
    recKanbanCardDragEnd({ currentTarget: card });
    const leftAtEnd = board.scrollLeft;
    for (let i = 0; i < 8; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
    const columns = [...board.querySelectorAll('.rec-kanban-col')];
    return {
      afterRight,
      afterLeave,
      beforeLeft,
      afterLeft,
      leftAtEnd,
      afterStop: board.scrollLeft,
      dragging: !!recEnsureState().kanbanDragging,
      raf: recEnsureState().kanbanAutoScrollRaf || 0,
      heightDuring,
      heightAfter: board.getBoundingClientRect().height,
      pageTop: document.scrollingElement.scrollTop,
      pref: sessionStorage.getItem('rec_kanban_hide_empty'),
      orderAfter: columns.map((col) => col.getAttribute('data-stage-id')).join(','),
      collapsedAfter: columns.filter((col) => col.classList.contains('rec-kanban-col--collapsed')).map((col) => col.getAttribute('data-stage-id')).join(','),
      columnCount: columns.length,
      cardDragging: card.classList.contains('rec-kanban-card--dragging'),
    };
  });

  const label = `${width}px`;
  check(result.openedDuring && result.hiddenStay, `${label}: las etapas ocultas siguen ocultas y las abiertas siguen abiertas`);
  check(result.collapsedDuring === result.collapsedBefore, `${label}: el arrastre no cambia columnas`);
  check(result.hiddenNotTarget, `${label}: la columna oculta no acepta el drop`);
  check(scroll.afterRight > 0, `${label}: el borde derecho desplaza el tablero`);
  check(scroll.afterLeave === scroll.afterRight, `${label}: alejarse del borde detiene el desplazamiento`);
  check(scroll.afterLeft < scroll.beforeLeft, `${label}: el borde izquierdo desplaza hacia la izquierda`);
  check(scroll.afterStop === scroll.leftAtEnd && scroll.dragging === false && scroll.raf === 0, `${label}: dragend detiene el loop`);
  check(scroll.pref === '1' && result.beforePref === '1', `${label}: no cambia sessionStorage`);
  check(scroll.orderAfter === result.orderBefore && scroll.columnCount === 8, `${label}: el orden y la cantidad de columnas se conservan`);
  check(scroll.collapsedAfter === result.collapsedBefore, `${label}: después de soltar, la vista queda igual`);
  check(Math.abs(scroll.heightAfter - result.heightBefore) < 1, `${label}: no cambia el alto del tablero`);
  check(scroll.pageTop === 0 && result.pageTopBefore === 0, `${label}: no hay scroll vertical de la página`);
  check(scroll.cardDragging === false, `${label}: no queda la clase de arrastre`);
}

console.log('\n=== Kanban drag visual ===\n');

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
    res.end(boardHtml());
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await runWidth(page, 1280);
    await runWidth(page, 900);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Kanban drag visual OK.\n');

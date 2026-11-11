/**
 * Presentación de la novedad de contratación en el panel del colaborador.
 * node server/scripts/test-workforce-hired-novedad-visual.mjs
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(root, 'server', 'public', 'index.html'), 'utf8');

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

const renderFn = indexHtml.match(/function tcEmpNovedadesRenderList\(\)\{[\s\S]*?\n\}/)?.[0] || '';
const openFn = indexHtml.match(/function tcEmpNovedadesOpenItem\([\s\S]*?\n\}/)?.[0] || '';
const adminRender = indexHtml.match(/function mind24NotifRenderList\([\s\S]*?\n\}/)?.[0] || '';

console.log('\n=== Novedad de contratación ===\n');

check(indexHtml === publicHtml, 'index.html y server/public/index.html son idénticos');
check(/const hired=n\.eventType==='HIRED'/.test(renderFn), 'la variante se decide por eventType HIRED');
check(!/llegó a contratación|message\.includes|metadata\.toStageKey/.test(renderFn), 'no identifica la contratación por el texto ni por otro metadato');
check(/tc-ws-novedades-item--hired/.test(renderFn) && /tcWsSvgTrophy\(\)/.test(renderFn), 'solo esa rama agrega la clase y el trofeo');
check(/tcWsSvgTarget\(\)/.test(renderFn), 'el recordatorio de metas conserva su icono');
check(!/tc-ws-novedades-item--hired|tcWsSvgTrophy/.test(adminRender), 'la campana administrativa no usa la variante');
check(/tcEmpQuickGoCandidates\(filter, item\.candidateId/.test(openFn), 'el clic conserva el destino actual');
check(!/tcEmpNovedadesMarkRead|novedades\/[^'"\s]+\/read/.test(openFn), 'abrir la novedad no marca leída por sí sola');
check(/--nov-hired-bg:/.test(indexHtml) && /--nov-hired-accent:/.test(indexHtml) && /--nov-hired-icon:/.test(indexHtml), 'los colores viven en variables');
check(!/Ver anteriores|mind24NotifLoadMore/.test(indexHtml.match(/function tcEmpNovedadesFetchList\([\s\S]*?\n\}/)?.[0] || ''), 'el panel del colaborador no pagina con ver más');

const hostile = 'Ana <img src=x onerror=alert(1)> & "O\'Brien"';
const longName = 'María del Carmen Hernández de la Torre y Asociados';
const longVacancy = 'Coordinación regional de operaciones, almacén y distribución nocturna del norte';
const items = [
  {
    id: 'recruitment:hired-unread',
    source: 'recruitment',
    eventType: 'HIRED',
    message: `${hostile} llegó a contratación en <b>${longVacancy}</b>.`,
    candidateId: 'cand-hired',
    createdAt: '2026-11-10T18:00:00.000Z',
    read: false,
    metadata: { candidateName: hostile, vacancyTitle: longVacancy, toStageKey: 'HIRED' },
  },
  {
    id: 'recruitment:stage',
    source: 'recruitment',
    eventType: 'STAGE_CHANGED',
    message: `${longName} cambió a la etapa Entrevista en Operador de producción.`,
    candidateId: 'cand-stage',
    createdAt: '2026-11-10T17:00:00.000Z',
    read: false,
  },
  {
    id: 'recruitment:looks-hired',
    source: 'recruitment',
    eventType: 'STAGE_CHANGED',
    message: 'Luis llegó a contratación en Caja.',
    candidateId: 'cand-fake',
    createdAt: '2026-11-10T16:30:00.000Z',
    read: false,
    metadata: { toStageKey: 'HIRED' },
  },
  {
    id: 'recruitment:hired-two',
    source: 'recruitment',
    eventType: 'HIRED',
    message: 'Pedro llegó a contratación en Auxiliar.',
    candidateId: 'cand-hired-2',
    createdAt: '2026-11-10T16:00:00.000Z',
    read: true,
  },
  {
    id: 'recruitment:rejected',
    source: 'recruitment',
    eventType: 'REJECTED',
    message: 'Rosa salió del proceso Chofer.',
    candidateId: 'cand-rejected',
    createdAt: '2026-11-10T15:00:00.000Z',
    read: true,
  },
  {
    id: 'workplace:goal',
    source: 'workplace',
    eventType: 'WORKFORCE_DAILY_GOALS_REMINDER',
    message: 'Recordatorio',
    createdAt: '2026-11-10T14:00:00.000Z',
    read: false,
    metadata: { title: 'Metas de hoy', body: 'Tienes metas por cumplir.' },
  },
];

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

  const ready = await page.evaluate(() => typeof tcEmpNovedadesRenderList === 'function' && typeof tcWsSvgTrophy === 'function');
  check(ready, 'el HTML real expone el panel de novedades');

  if (ready) {
    const painted = await page.evaluate((rows) => {
      const opened = [];
      window.tcEmpQuickGoCandidates = (filter, id) => { opened.push({ filter, id }); };
      tcEmpNovedadesItems = rows;
      tcEmpNovedadesUpdateBadge(3);
      tcEmpNovedadesRenderList();
      const pop = document.getElementById('tc-ws-novedades-popover');
      pop.classList.remove('hidden');
      pop.setAttribute('aria-hidden', 'false');
      pop.style.left = '12px';
      pop.style.top = '12px';
      const buttons = [...document.querySelectorAll('#tc-ws-novedades-body .tc-ws-novedades-item')];
      const byId = (id) => buttons.find((btn) => btn.getAttribute('data-nov-id') === id);
      const hired = byId('recruitment:hired-unread');
      const fake = byId('recruitment:looks-hired');
      const stage = byId('recruitment:stage');
      const second = byId('recruitment:hired-two');
      const rejected = byId('recruitment:rejected');
      const goal = byId('workplace:goal');
      const style = (el) => getComputedStyle(el);
      const hiredMsg = hired.querySelector('.tc-ws-novedades-item-msg');
      const secondMsg = second.querySelector('.tc-ws-novedades-item-msg');
      hired.focus();
      return {
        opened,
        hiredClass: hired.className,
        secondClass: second.className,
        fakeClass: fake.className,
        stageClass: stage.className,
        rejectedClass: rejected.className,
        goalClass: goal.className,
        hiredTrophies: hired.querySelectorAll('.tc-ws-novedades-item-trophy svg').length,
        secondTrophies: second.querySelectorAll('.tc-ws-novedades-item-trophy svg').length,
        otherTrophies: [fake, stage, rejected, goal].reduce((n, el) => n + el.querySelectorAll('.tc-ws-novedades-item-trophy').length, 0),
        hiredPip: hired.querySelectorAll('.tc-ws-novedades-hired-pip').length,
        secondPip: second.querySelectorAll('.tc-ws-novedades-hired-pip').length,
        hiredWeight: style(hiredMsg).fontWeight,
        secondWeight: style(secondMsg).fontWeight,
        hiredBg: style(hired).backgroundColor,
        secondBg: style(second).backgroundColor,
        hiredAccent: style(hired).boxShadow,
        secondAccent: style(second).boxShadow,
        hiredText: style(hiredMsg).color,
        timeColor: style(hired.querySelector('.tc-ws-novedades-item-time')).color,
        stageBg: style(stage).backgroundColor,
        fakeDot: fake.querySelectorAll('.tc-ws-novedades-item-dot').length,
        goalMark: goal.querySelectorAll('.tc-ws-novedades-item-mark').length,
        tags: hired.querySelectorAll('img,b,script').length,
        text: hired.textContent,
        nameKept: hired.textContent.includes(rows[0].metadata.candidateName) && hired.textContent.includes(rows[0].metadata.vacancyTitle),
        longKept: stage.textContent.includes(rows[1].message),
        clamp: style(hiredMsg).webkitLineClamp,
        nestedButtons: hired.querySelectorAll('button,a').length,
        trophyHidden: hired.querySelector('.tc-ws-novedades-item-trophy').getAttribute('aria-hidden'),
        focused: document.activeElement === hired,
        badge: document.getElementById('tc-ws-quick-badge-novedades').textContent,
        closeOverlap: (() => {
          const a = hired.querySelector('.tc-ws-novedades-item-trophy').getBoundingClientRect();
          const b = document.querySelector('#tc-ws-novedades-popover .tc-icon-btn--close').getBoundingClientRect();
          return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
        })(),
        itemH: Math.round(second.getBoundingClientRect().height),
        stageH: Math.round(rejected.getBoundingClientRect().height),
      };
    }, items);

    check(painted.hiredClass.includes('tc-ws-novedades-item--hired') && painted.hiredClass.includes('tc-ws-novedades-item--unread'), 'la contratación no leída usa la variante especial');
    check(painted.secondClass.includes('tc-ws-novedades-item--hired') && painted.secondClass.includes('tc-ws-novedades-item--read') && !painted.secondClass.includes('unread'), 'la contratación leída conserva la variante');
    check(!painted.fakeClass.includes('hired') && !painted.stageClass.includes('hired') && !painted.rejectedClass.includes('hired') && !painted.goalClass.includes('hired'), 'el resto no recibe la variante, aunque el texto diga contratación');
    check(painted.hiredTrophies === 1 && painted.secondTrophies === 1 && painted.otherTrophies === 0, 'el trofeo aparece una vez y solo en contrataciones');
    check(painted.hiredPip === 1 && painted.secondPip === 0, 'el indicador de no leída desaparece al leerla y el trofeo permanece');
    check(painted.hiredWeight === '700' && painted.secondWeight === '600' && painted.hiredBg !== painted.secondBg && painted.hiredAccent !== painted.secondAccent, 'leída y no leída se distinguen por peso, fondo y acento');
    check(painted.hiredText === 'rgb(30, 41, 59)' && painted.timeColor === 'rgb(100, 116, 139)', 'el texto usa el color principal y el secundario');
    check(painted.stageBg !== painted.hiredBg && painted.fakeDot === 1 && painted.goalMark === 1, 'las demás novedades conservan punto o icono anterior');
    check(painted.tags === 0 && painted.text.includes('<img') && painted.text.includes('<b>') && painted.nameKept && painted.longKept, 'nombres, vacantes y caracteres especiales quedan como texto');
    check(painted.clamp === 'none' && painted.nestedButtons === 0 && painted.trophyHidden === 'true' && painted.focused, 'el nombre no se recorta, no hay controles anidados y el trofeo es decorativo');
    check(painted.badge === '3' && !painted.closeOverlap && painted.itemH < painted.stageH + 18, 'el contador, el cierre y la altura de la fila se mantienen');

    const widths = {};
    for (const width of [1280, 900, 390]) {
      await page.setViewport({ width, height: 800 });
      widths[width] = await page.evaluate((viewport) => {
        const pop = document.getElementById('tc-ws-novedades-popover');
        const item = pop.querySelector('.tc-ws-novedades-item--hired');
        const popBox = pop.getBoundingClientRect();
        return {
          page: document.documentElement.scrollWidth - viewport,
          pop: pop.scrollWidth - pop.clientWidth,
          item: item.scrollWidth - item.clientWidth,
          inside: popBox.right <= viewport + 1 && popBox.left >= -1,
          trophy: !!item.querySelector('.tc-ws-novedades-item-trophy'),
          message: !!item.querySelector('.tc-ws-novedades-item-msg'),
        };
      }, width);
    }
    check([1280, 900, 390].every((w) => widths[w].page <= 1 && widths[w].pop <= 1 && widths[w].item <= 1 && widths[w].inside), '1280, 900 y 390 no desbordan');
    check([1280, 900, 390].every((w) => widths[w].trophy && widths[w].message), 'en las tres medidas siguen el trofeo y el mensaje');

    const afterRead = await page.evaluate(async () => {
      window.tcPublicJson = async () => ({ ok: true });
      const before = document.getElementById('tc-ws-quick-badge-novedades').textContent;
      await tcEmpNovedadesMarkAllRead();
      const hired = document.querySelector('[data-nov-id="recruitment:hired-unread"]');
      const stage = document.querySelector('[data-nov-id="recruitment:stage"]');
      hired.click();
      return {
        before,
        badge: document.getElementById('tc-ws-quick-badge-novedades').textContent,
        hiredClass: hired.className,
        trophy: hired.querySelectorAll('.tc-ws-novedades-item-trophy svg').length,
        pip: hired.querySelectorAll('.tc-ws-novedades-hired-pip').length,
        stageClass: stage.className,
        stageDot: stage.querySelectorAll('.tc-ws-novedades-item-dot').length,
        opened: window.__hiredOpened || null,
      };
    });
    check(afterRead.before === '3' && afterRead.badge === '', 'marcar todas como leídas deja el contador en cero');
    check(afterRead.hiredClass.includes('tc-ws-novedades-item--hired') && afterRead.hiredClass.includes('--read') && afterRead.trophy === 1 && afterRead.pip === 0, 'al leerla sigue siendo una contratación, no una fila genérica');
    check(afterRead.stageClass.includes('--read') && !afterRead.stageClass.includes('hired') && afterRead.stageDot === 1, 'la novedad genérica leída conserva su punto');

    const navigated = await page.evaluate(() => {
      const calls = [];
      window.tcEmpQuickGoCandidates = (filter, id) => { calls.push({ filter, id }); };
      tcEmpNovedadesItems = tcEmpNovedadesItems.map((row) => Object.assign({}, row, { read: false }));
      tcEmpNovedadesRenderList();
      document.querySelector('[data-nov-id="recruitment:hired-unread"]').click();
      return calls;
    });
    check(navigated.length === 1 && navigated[0].filter === 'hired' && navigated[0].id === 'cand-hired', 'abrir la contratación navega a Contratados y al candidato');

    const secondPage = await page.evaluate(() => {
      tcEmpNovedadesItems = [{
        id: 'recruitment:hired-page-2',
        source: 'recruitment',
        eventType: 'HIRED',
        message: 'Elena llegó a contratación en Recepción.',
        candidateId: 'cand-page',
        createdAt: '2026-11-01T12:00:00.000Z',
        read: false,
      }];
      tcEmpNovedadesRenderList();
      const item = document.querySelector('[data-nov-id="recruitment:hired-page-2"]');
      return {
        hired: item.classList.contains('tc-ws-novedades-item--hired'),
        trophy: item.querySelectorAll('.tc-ws-novedades-item-trophy svg').length,
        more: document.querySelectorAll('#tc-ws-novedades-body .mind24-notif-more, #tc-ws-novedades-body .tc-ws-novedades-more').length,
      };
    });
    check(secondPage.hired && secondPage.trophy === 1 && secondPage.more === 0, 'un lote posterior conserva la variante; el panel no tiene ver más');

    const admin = await page.evaluate(() => {
      mind24NotifItems = [{
        id: 'admin-1',
        type: 'RECRUITMENT_CANDIDATE_CREATED',
        message: 'Ana llegó a contratación en Caja.',
        createdAt: '2026-11-10T18:00:00.000Z',
        read: false,
      }];
      mind24NotifHasMore = false;
      mind24NotifRenderList(false);
      const body = document.getElementById('mind24-notif-body');
      return {
        hired: body.querySelectorAll('.tc-ws-novedades-item--hired, .tc-ws-novedades-item-trophy').length,
        item: body.querySelectorAll('.mind24-notif-item').length,
        mark: body.querySelectorAll('.mind24-notif-item-mark--candidate').length,
      };
    });
    check(admin.item === 1 && admin.mark === 1 && admin.hired === 0, 'la notificación administrativa conserva su presentación');
  }

  check(pageErrors.length === 0, 'la página no lanza errores');
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (failed) {
  console.error(`\n${failed} comprobaciones fallaron`);
  process.exit(1);
}
console.log('\nNovedad de contratación en orden\n');

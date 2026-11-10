/**
 * Filtros del directorio administrativo de candidatos.
 * node server/scripts/test-recruitment-candidate-directory-filters.mjs
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(root, 'server/public/index.html'), 'utf8');
const candidateSvc = fs.readFileSync(path.join(root, 'server/src/services/recruitmentCandidate.service.js'), 'utf8');

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-directory-filters-test';
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24';

const { buildCandidateListWhere, normalizeCandidateDirectoryFilters } = await import('../src/services/recruitmentCandidate.service.js');

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
  ];
  return candidates.find((item) => fs.existsSync(item)) || null;
}

console.log('\n=== Directorio — contrato de filtros ===\n');

check(indexHtml === publicHtml, 'index.html y server/public/index.html son idénticos');
check(!/select id="rec-cand-profile"/.test(indexHtml) && !/<select multiple/.test(indexHtml.match(/id="rec-pane-candidates"[\s\S]*?id="rec-cand-list-kicker"/)?.[0] || ''), 'la barra no usa select nativo ni select multiple');
check(!/Registrados por mí/.test(indexHtml), 'no se inventa Registrados por mí');
check(/registeredByMeAvailable: false/.test(candidateSvc), 'el servidor declara que Registrados por mí no está disponible');
check(/registeredByWorkforceEmployeeId/.test(candidateSvc) && !/isActive:\s*true[\s\S]{0,180}recruitmentCandidatesRegistered/.test(candidateSvc), 'el catálogo de reclutador usa el vínculo real e incluye inactivos');
check(/applications:\s*\{\s*some:\s*\{\s*organizationId\s*\}\s*\}/.test(candidateSvc), 'las vacantes del catálogo son las que tienen postulaciones, sin filtrar por estado');

const where = buildCandidateListWhere('org-1', {
  q: 'Ana',
  profiles: ['ventas', 'Administrativo'],
  sources: ['Facebook / Meta'],
  tagIds: ['tag-a', 'tag-b'],
  stageIds: ['stage-now'],
  vacancyIds: ['vac-active', 'vac-closed'],
  recruiterIds: ['emp-old', '__none__'],
});
const and = where.AND;
check(and[0].organizationId === 'org-1' && and.some((item) => item.archivedAt === null), 'el listado sigue limitado a la organización y a no archivados');
check(and.some((item) => item.OR && item.OR.some((part) => part.profile && part.profile.equals === 'Ventas') && item.OR.some((part) => part.profile && part.profile.equals === 'Administrativo')), 'dentro de Perfil la lógica es O');
check(and.some((item) => item.OR && item.OR.some((part) => part.source && part.source.equals === 'Facebook / Meta')), 'Fuente se combina con Y junto al resto');
check(and.some((item) => item.tagAssignments && item.tagAssignments.some.tagId.in.join('|') === 'tag-a|tag-b'), 'varias etiquetas significan cualquiera de ellas');
const stage = and.find((item) => item.applications && item.applications.some.stageId);
check(stage.applications.some.stageId.in[0] === 'stage-now' && stage.applications.some.organizationId === 'org-1' && !/stageEvents|fromStageId/.test(JSON.stringify(stage)), 'Etapa sigue siendo la etapa actual de la postulación');
const vacancy = and.find((item) => item.applications && item.applications.some.vacancyId);
check(vacancy.applications.some.vacancyId.in.join('|') === 'vac-active|vac-closed' && !vacancy.applications.some.status, 'Vacante acepta cualquiera de las seleccionadas y no descarta cubiertas o cerradas');
const recruiter = and.find((item) => item.OR && item.OR.some((part) => Object.prototype.hasOwnProperty.call(part, 'registeredByWorkforceEmployeeId')));
check(recruiter.OR.some((part) => part.registeredByWorkforceEmployeeId && part.registeredByWorkforceEmployeeId.in[0] === 'emp-old') && recruiter.OR.some((part) => part.registeredByWorkforceEmployeeId === null), 'Reclutador combina personas y sin registro atribuible');
const search = and.find((item) => item.OR && item.OR.some((part) => part.fullName));
const searchFields = search.OR.map((part) => Object.keys(part)[0]);
check(searchFields.join('|') === 'fullName|profile|phone|whatsapp|email|city|state', 'el buscador conserva nombre, contacto y ciudad');

const archived = buildCandidateListWhere('org-1', { archivedOnly: true, profile: 'Otro' });
check(archived.AND.some((item) => item.archivedAt && item.archivedAt.not === null) && !archived.AND.some((item) => item.archivedAt && item.archivedAt.equals === null), 'Archivados muestra exclusivamente archivados');
check(buildCandidateListWhere('org-1', { stageId: 'legacy-stage' }).AND.some((item) => item.applications && item.applications.some.stageId.in[0] === 'legacy-stage'), 'el parámetro stageId anterior sigue vigente');

let rejected = false;
try { normalizeCandidateDirectoryFilters({ profiles: ['No existe'] }); } catch (err) { rejected = err.code === 'VALIDATION_ERROR'; }
check(rejected, 'un perfil ajeno al catálogo se rechaza con 400');

const repeated = normalizeCandidateDirectoryFilters({
  profiles: ['Ventas', 'ventas', ' Ventas '],
  tagIds: ['tag-a', 'tag-a', ' tag-a '],
  recruiterIds: ['emp-1', 'emp-1'],
});
check(repeated.profiles.length === 1 && repeated.profiles[0] === 'Ventas' && repeated.tagIds.length === 1 && repeated.recruiterIds.length === 1, 'los valores repetidos se normalizan antes de consultar');

let tooMany = false;
try {
  normalizeCandidateDirectoryFilters({ tagIds: Array.from({ length: 41 }, (_item, index) => `tag-${index}`) });
} catch (err) {
  tooMany = err.code === 'VALIDATION_ERROR' && err.message === 'Selecciona menos filtros a la vez.';
}
check(tooMany, 'más de 40 valores en un filtro se rechaza');

let tooLong = false;
try { normalizeCandidateDirectoryFilters({ vacancyIds: ['v'.repeat(81)] }); } catch (err) {
  tooLong = err.code === 'VALIDATION_ERROR' && err.message === 'Filtro no válido.';
}
check(tooLong, 'un identificador de más de 80 caracteres se rechaza');

let longQuery = false;
try { buildCandidateListWhere('org-1', { q: 'a'.repeat(121) }); } catch (err) {
  longQuery = err.code === 'VALIDATION_ERROR' && err.message === 'La búsqueda es demasiado larga.';
}
check(longQuery, 'una búsqueda de más de 120 caracteres se rechaza');

const cursor = Buffer.from('2026-11-01T00:00:00.000Z|cand-1', 'utf8').toString('base64url');
const filteredWhere = buildCandidateListWhere('org-1', { profiles: ['Ventas'], tagIds: ['tag-a'], cursor: null });
const pagedWhere = buildCandidateListWhere('org-1', { profiles: ['Ventas'], tagIds: ['tag-a'], cursor });
const cursorClause = pagedWhere.AND[pagedWhere.AND.length - 1];
check(
  pagedWhere.AND.length === filteredWhere.AND.length + 1
  && JSON.stringify(pagedWhere.AND.slice(0, filteredWhere.AND.length)) === JSON.stringify(filteredWhere.AND)
  && cursorClause.OR.some((part) => part.id && part.id.lt === 'cand-1'),
  'el cursor conserva el mismo filtro y solo agrega la página',
);

let badCursor = false;
try { buildCandidateListWhere('org-1', { cursor: 'no-es-un-cursor' }); } catch (err) { badCursor = err.code === 'VALIDATION_ERROR'; }
check(badCursor, 'un cursor inválido se rechaza');

const catalogSrc = candidateSvc.slice(
  candidateSvc.indexOf('export async function listCandidateDirectoryFilterOptions'),
  candidateSvc.indexOf('export async function findPotentialDuplicateRecruitmentCandidates'),
);
check(!/archivedAt|candFilters/.test(catalogSrc) && /organizationId/.test(catalogSrc), 'reclutador y vacante se arman con toda la organización, incluidos los archivados');
const assertSrc = candidateSvc.slice(
  candidateSvc.indexOf('async function assertIdsInOrg'),
  candidateSvc.indexOf('export async function assertCandidateDirectoryFilterIds'),
);
check(/organizationId/.test(assertSrc) && /id:\s*\{\s*in:\s*ids\s*\}/.test(assertSrc), 'cada identificador se valida contra la organización');
check(/assertIdsInOrg\('recruitmentStage'/.test(candidateSvc) && /assertIdsInOrg\('workforceEmployee'/.test(candidateSvc) && /assertIdsInOrg\('recruitmentVacancy'/.test(candidateSvc) && /assertIdsInOrg\('recruitmentCandidateTag'/.test(candidateSvc), 'etapa, etiqueta, vacante y reclutador usan su propia tabla');
const listFrom = candidateSvc.indexOf('const directoryFilters = normalizeCandidateDirectoryFilters');
const listSrc = candidateSvc.slice(listFrom, candidateSvc.indexOf('let nextCursor = null', listFrom));
check(listSrc.includes('cursor: null') && listSrc.includes('directoryFilters') && listSrc.includes('prisma.recruitmentCandidate.count({ where })'), 'total usa el where filtrado, sin el cursor');
check(!/\$queryRaw|\$executeRaw/.test(candidateSvc), 'las consultas del directorio siguen parametrizadas');
check(/sessionStorage\.setItem\(key/.test(indexHtml) && !/localStorage\.setItem\([^)]*candFilters/.test(indexHtml), 'la persistencia es sessionStorage y termina al cerrar la pestaña');

console.log('\n=== Directorio — barra ===\n');

const executablePath = chromePath();
if (!executablePath) {
  check(false, 'Chrome o Edge local para la barra');
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

  const ui = await page.evaluate(async () => {
    window.__MIND24_USER = { organizationId: 'org-a', role: 'empresa_admin' };
    const st = recEnsureState();
    st.candTagCatalog = [
      { id: 'tag-good', name: 'Buen perfil' },
      { id: 'tag-xss', name: '<img src=x onerror=alert(1)>' },
      { id: 'tag-hired', name: 'Contratado' },
    ];
    st.candStageCatalog = [{ id: 'stage-1', name: 'Entrevista <script>alert(1)</script>' }];
    st.candRecruiterCatalog = [
      { id: 'emp-active', fullName: 'Eduardo <b>R</b>', isActive: true },
      { id: 'emp-old', fullName: 'Inés Histórica', isActive: false },
    ];
    st.candHasUnassignedRecruiter = true;
    st.candVacancyCatalog = [
      { id: 'vac-1', title: 'Cajera', status: 'ACTIVE' },
      { id: 'vac-2', title: 'Cajera', status: 'COVERED' },
      { id: 'vac-3', title: 'Cajera', status: 'CLOSED' },
    ];
    st.candDirectoryCatalogLoaded = true;
    st.candTagCatalogReady = true;
    st.candStageCatalogReady = true;
    st.candDirectoryCatalogReady = true;
    st.candTagCatalogFailed = false;
    st.candStageCatalogFailed = false;
    st.candDirectoryCatalogFailed = false;
    sessionStorage.clear();
    const view = document.getElementById('view-dash-recruitment');
    const pane = document.getElementById('rec-pane-candidates');
    if (view) view.classList.remove('hidden');
    if (pane) pane.classList.remove('hidden');
    recCandBindFilters();
    const clearAtStart = document.getElementById('rec-cand-clear-filters').disabled
      && document.getElementById('rec-cand-clear-filters').title === 'Limpiar filtros'
      && document.getElementById('rec-cand-archived').title === 'Ver archivados';
    const openAndPick = (id, values) => {
      recCandMsOpen(id);
      values.forEach((value) => {
        const box = document.querySelector('#rec-cand-ms-menu [data-rec-ms-value="' + CSS.escape(value) + '"]');
        box.checked = true;
        box.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    openAndPick('rec-cand-profile', ['Ventas', 'Administrativo']);
    document.getElementById('rec-cand-ms-apply').click();
    const profileSummary = document.querySelector('#rec-cand-profile .rec-cand-ms-value').textContent;
    recCandMsOpen('rec-cand-profile');
    const dropVentas = document.querySelector('#rec-cand-ms-menu [data-rec-ms-value="Ventas"]');
    dropVentas.checked = false;
    dropVentas.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('rec-cand-ms-cancel').click();
    const afterCancel = document.querySelector('#rec-cand-profile .rec-cand-ms-value').textContent === profileSummary;
    recCandMsOpen('rec-cand-profile');
    const dropAgain = document.querySelector('#rec-cand-ms-menu [data-rec-ms-value="Ventas"]');
    dropAgain.checked = false;
    dropAgain.dispatchEvent(new Event('change', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const afterOutsideDraft = document.querySelector('#rec-cand-profile .rec-cand-ms-value').textContent === profileSummary;
    recCandMsOpen('rec-cand-source');
    document.getElementById('rec-cand-ms-all').click();
    const allBox = document.getElementById('rec-cand-ms-all');
    const allComplete = allBox.checked && !allBox.indeterminate;
    const allCount = recEnsureState().candMsDraft.length;
    const one = document.querySelector('#rec-cand-ms-menu [data-rec-ms-value="Indeed"]');
    one.checked = false;
    one.dispatchEvent(new Event('change', { bubbles: true }));
    const afterOne = {
      draft: recEnsureState().candMsDraft.length,
      indeterminate: document.getElementById('rec-cand-ms-all').indeterminate,
    };
    document.getElementById('rec-cand-ms-cancel').click();
    recCandMsOpen('rec-cand-tag');
    const tagMenu = document.getElementById('rec-cand-ms-menu');
    const tagSafe = {
      nodes: tagMenu.querySelectorAll('script,img,b').length,
      text: tagMenu.textContent.includes('<img src=x onerror=alert(1)>') && tagMenu.textContent.includes('Contratado'),
    };
    document.getElementById('rec-cand-ms-cancel').click();
    recCandMsOpen('rec-cand-recruiter');
    const recruiterText = document.getElementById('rec-cand-ms-menu').textContent;
    const recruiterSafe = document.getElementById('rec-cand-ms-menu').querySelectorAll('b').length === 0;
    openAndPick('rec-cand-recruiter', ['emp-active']);
    document.getElementById('rec-cand-ms-apply').click();
    recCandMsOpen('rec-cand-recruiter');
    const recruiterAfter = document.getElementById('rec-cand-ms-menu').textContent;
    document.getElementById('rec-cand-ms-cancel').click();
    recCandMsOpen('rec-cand-vacancy');
    const vacancyHints = [...document.querySelectorAll('#rec-cand-ms-menu .rec-cand-ms-option-hint')].map((el) => el.textContent);
    const vacancyCount = document.querySelectorAll('#rec-cand-ms-menu [data-rec-ms-value]').length;
    document.getElementById('rec-cand-ms-cancel').click();
    const clearBefore = document.getElementById('rec-cand-clear-filters').disabled;
    const archiveBtn = document.getElementById('rec-cand-archived');
    const archivedOffBg = getComputedStyle(archiveBtn).backgroundColor;
    archiveBtn.click();
    const archivedOn = archiveBtn.getAttribute('aria-pressed') === 'true'
      && archiveBtn.getAttribute('aria-label') === 'Ocultar archivados'
      && archiveBtn.title === 'Ocultar archivados'
      && getComputedStyle(archiveBtn).backgroundColor !== archivedOffBg;
    recCandMsOpen('rec-cand-recruiter');
    const archivedRecruiter = document.getElementById('rec-cand-ms-menu').textContent;
    document.getElementById('rec-cand-ms-cancel').click();
    recCandMsOpen('rec-cand-vacancy');
    const archivedVacancyCount = document.querySelectorAll('#rec-cand-ms-menu [data-rec-ms-value]').length;
    document.getElementById('rec-cand-ms-cancel').click();
    recCandMsOpen('rec-cand-profile');
    const archivedProfile = document.getElementById('rec-cand-ms-menu').textContent.includes('Ventas');
    document.getElementById('rec-cand-ms-cancel').click();
    recCandMsOpen('rec-cand-tag');
    const archivedTag = document.getElementById('rec-cand-ms-menu').textContent.includes('Buen perfil');
    document.getElementById('rec-cand-ms-cancel').click();
    const query = recCandBuildListQuery(recEnsureState(), null);
    document.getElementById('rec-cand-profile').focus();
    document.getElementById('rec-cand-profile').click();
    const opened = !document.getElementById('rec-cand-ms-menu').classList.contains('hidden');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const escaped = document.getElementById('rec-cand-ms-menu').classList.contains('hidden') && document.activeElement.id === 'rec-cand-profile';
    document.getElementById('rec-cand-profile').click();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const outside = document.getElementById('rec-cand-ms-menu').classList.contains('hidden');
    const stored = sessionStorage.getItem(recCandFilterStorageKey('org-a'));
    window.__MIND24_USER = { organizationId: 'org-b', role: 'empresa_admin' };
    recCandBindFilters();
    const otherOrg = recCandBuildListQuery(recEnsureState(), null);
    window.__MIND24_USER = { organizationId: 'org-a', role: 'empresa_admin' };
    recCandBindFilters();
    const restored = recCandBuildListQuery(recEnsureState(), null) === query;
    recEnsureState().detailCandidateId = 'cand-1';
    recCandRenderList();
    openModal('modal-rec-candidate-detail');
    closeModal('modal-rec-candidate-detail');
    const afterDetail = recCandBuildListQuery(recEnsureState(), null) === query
      && document.querySelector('#rec-cand-profile .rec-cand-ms-value').textContent === profileSummary;
    document.getElementById('rec-cand-clear-filters').click();
    const cleared = recCandBuildListQuery(recEnsureState(), null).indexOf('profiles=') < 0
      && recCandBuildListQuery(recEnsureState(), null).indexOf('archivedOnly') < 0
      && document.getElementById('rec-cand-q').value === ''
      && document.getElementById('rec-cand-clear-filters').disabled
      && document.getElementById('rec-cand-archived').getAttribute('aria-pressed') === 'false'
      && !sessionStorage.getItem(recCandFilterStorageKey('org-a'));
    return {
      profileSummary,
      clearAtStart,
      afterCancel,
      afterOutsideDraft,
      allComplete,
      allCount,
      afterOne,
      tagSafe,
      recruiterText,
      recruiterAfter,
      recruiterSafe,
      vacancyHints,
      vacancyCount,
      archivedRecruiter,
      archivedVacancyCount,
      archivedProfile,
      archivedTag,
      clearBefore,
      archivedOn,
      query,
      opened,
      escaped,
      outside,
      stored: !!stored && stored.includes('org-a') === false,
      storedKey: stored,
      otherOrg,
      restored,
      afterDetail,
      cleared,
    };
  });

  check(ui.profileSummary === '2 seleccionados', 'Aplicar confirma la selección en el botón');
  check(ui.clearAtStart && ui.afterCancel && ui.afterOutsideDraft, 'Limpiar nace deshabilitado; Cancelar y clic fuera revierten lo no aplicado');
  check(ui.allComplete && ui.allCount === REC_SOURCE_COUNT(indexHtml) && ui.afterOne.draft === ui.allCount - 1 && ui.afterOne.indeterminate, 'Seleccionar todo queda completo y, al desmarcar una, indeterminado');
  check(ui.tagSafe.nodes === 0 && ui.tagSafe.text, 'etiquetas y texto peligroso se pintan como texto');
  check(ui.recruiterSafe && ui.recruiterText.includes('Sin reclutador') && ui.recruiterText.includes('Inés Histórica') && ui.recruiterText.includes('Inactivo') && !ui.recruiterText.includes('Registrados por mí'), 'reclutador muestra histórico, inactivo y sin registro, sin equivalencia de sesión');
  check(ui.recruiterAfter.includes('Eduardo') && ui.recruiterAfter.includes('Inés Histórica') && ui.vacancyCount === 3, 'elegir un reclutador no retira las demás opciones ni las vacantes sin resultados');
  check(ui.vacancyHints.join('|') === 'Activa|Cubierta|Cerrada', 'vacantes repetidas se distinguen por su estado');
  check(ui.archivedRecruiter.includes('Inés Histórica') && ui.archivedVacancyCount === 3 && ui.archivedProfile && ui.archivedTag, 'Archivados no recorta reclutadores, vacantes, perfiles ni etiquetas');
  check(ui.clearBefore === false && ui.archivedOn, 'Archivados activo se distingue y habilita Limpiar');
  check(ui.query.includes('profiles=Ventas') && ui.query.includes('profiles=Administrativo') && ui.query.includes('archivedOnly=true'), 'los filtros seleccionados viajan juntos en la consulta');
  check(ui.opened && ui.escaped && ui.outside, 'Escape devuelve el foco y un clic fuera cierra sin aplicar');
  check(ui.stored && ui.otherOrg.indexOf('profiles=') < 0 && ui.restored && ui.afterDetail, 'la persistencia es de la sesión, sobrevive al expediente y no cruza organizaciones');
  check(ui.cleared, 'Limpiar restablece buscador, filtros, archivados y el estado guardado');

  const overflow = {};
  for (const width of [1280, 900, 390]) {
    await page.setViewport({ width, height: 800 });
    overflow[width] = await page.evaluate((viewport) => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.querySelectorAll('body > *').forEach((el) => {
        if (el.id === 'view-dash-recruitment' || el.id === 'rec-cand-ms-menu') return;
        el.style.display = 'none';
      });
      const view = document.getElementById('view-dash-recruitment');
      const pane = document.getElementById('rec-pane-candidates');
      const vacancies = document.getElementById('rec-pane-vacancies');
      if (view) {
        view.classList.remove('hidden');
        view.style.display = 'flex';
      }
      if (vacancies) vacancies.classList.add('hidden');
      if (pane) pane.classList.remove('hidden');
      const bar = document.getElementById('rec-cand-filter-bar');
      bar.scrollIntoView({ block: 'center', behavior: 'instant' });
      const st = recEnsureState();
      const extra = [];
      for (let i = 0; i < 24; i += 1) extra.push({ id: 'emp-extra-' + i, fullName: 'Reclutador ' + i, isActive: true });
      st.candRecruiterCatalog = extra.concat([
        { id: 'emp-active', fullName: 'Eduardo <b>R</b>', isActive: true },
        { id: 'emp-old', fullName: 'Inés Histórica', isActive: false },
      ]);
      recCandMsOpen('rec-cand-recruiter');
      const menu = document.getElementById('rec-cand-ms-menu');
      const list = document.getElementById('rec-cand-ms-list');
      const rect = menu.getBoundingClientRect();
      const names = ['Perfil', 'Fuente', 'Etiqueta', 'Etapa', 'Reclutador', 'Vacante'];
      return {
        page: document.documentElement.scrollWidth - viewport,
        top: rect.top,
        left: rect.left,
        right: rect.right - viewport,
        bottom: rect.bottom - window.innerHeight,
        scroll: !!(list && list.scrollHeight > list.clientHeight + 2),
        actions: !!document.getElementById('rec-cand-archived') && !!document.getElementById('rec-cand-clear-filters'),
        names: names.every((name) => bar.textContent.includes(name)),
        tips: document.getElementById('rec-cand-clear-filters').title === 'Limpiar filtros'
          && document.getElementById('rec-cand-archived').title.length > 0,
      };
    }, width);
    const fit = overflow[width];
    check(fit.page <= 1 && fit.right <= 1 && fit.left >= -1 && fit.top >= -1 && fit.bottom <= 1 && fit.scroll && fit.actions && fit.names && fit.tips, width + ' px: sin scroll de página, menú completo y con scroll propio');
  }

  const stale = await page.evaluate(async () => {
    await Promise.all([
      recCandEnsureTagCatalog(),
      recCandEnsureStageCatalog(),
      recCandEnsureDirectoryCatalogs(),
    ]);
    const pending = [];
    window.apiJson = (url) => new Promise((resolve) => {
      pending.push({ url, resolve });
    });
    const st = recEnsureState();
    st.candFilters = recCandEmptyFilters();
    st.candFilters.q = 'primero';
    const first = recCandLoadList(false);
    for (let i = 0; i < 8 && !pending.some((item) => item.url.includes('q=primero')); i += 1) await Promise.resolve();
    st.candFilters.q = 'segundo';
    const second = recCandLoadList(false);
    for (let i = 0; i < 8 && !pending.some((item) => item.url.includes('q=segundo')); i += 1) await Promise.resolve();
    const late = pending.find((item) => item.url.includes('q=primero'));
    const early = pending.find((item) => item.url.includes('q=segundo'));
    if (!late || !early) return 'faltó ' + pending.map((item) => item.url).join(' || ');
    early.resolve({ candidates: [{ id: 'new', fullName: 'Resultado reciente', profile: 'Ventas' }], nextCursor: null, total: 1 });
    await second;
    late.resolve({ candidates: [{ id: 'old', fullName: 'Resultado viejo', profile: 'Ventas' }], nextCursor: null, total: 1 });
    await first;
    return document.getElementById('rec-cand-list').textContent;
  });
  check(stale.includes('Resultado reciente') && !stale.includes('Resultado viejo'), 'una respuesta anterior no pisa el resultado más reciente');

  const persisted = await page.evaluate(() => {
    window.__MIND24_USER = { organizationId: 'org-a', role: 'empresa_admin' };
    const st = recEnsureState();
    st.candTagCatalog = [{ id: 'tag-good', name: 'Buen perfil' }];
    st.candStageCatalog = [{ id: 'stage-1', name: 'Entrevista' }];
    st.candRecruiterCatalog = [{ id: 'emp-old', fullName: 'Inés Histórica', isActive: false }];
    st.candHasUnassignedRecruiter = true;
    st.candVacancyCatalog = [{ id: 'vac-1', title: 'Cajera', status: 'ACTIVE' }];
    st.candDirectoryCatalogLoaded = true;
    st.candTagCatalogReady = true;
    st.candStageCatalogReady = true;
    st.candDirectoryCatalogReady = true;
    st.candTagCatalogFailed = false;
    st.candStageCatalogFailed = false;
    st.candDirectoryCatalogFailed = false;
    sessionStorage.setItem(recCandFilterStorageKey('org-b'), JSON.stringify({
      q: 'secreto', profiles: ['Operaciones'], sources: [], tagIds: [], stageIds: [], recruiterIds: [], vacancyIds: [], archivedOnly: false,
    }));
    sessionStorage.setItem(recCandFilterStorageKey('org-a'), JSON.stringify({
      q: 'Ana',
      archivedOnly: false,
      profiles: ['Ventas', 'Inventada'],
      sources: ['Indeed'],
      tagIds: ['tag-good', 'tag-foreign'],
      stageIds: ['stage-1', 'stage-foreign'],
      recruiterIds: ['emp-old', 'emp-foreign', '__none__'],
      vacancyIds: ['vac-1', 'vac-foreign'],
    }));
    st.candFiltersOrgId = '';
    recCandBindFilters();
    const changed = recCandPruneFiltersToCatalogs();
    const filters = st.candFilters;
    return {
      changed,
      q: document.getElementById('rec-cand-q').value,
      profile: document.querySelector('#rec-cand-profile .rec-cand-ms-value').textContent,
      filters,
      stored: sessionStorage.getItem(recCandFilterStorageKey('org-a')),
      other: sessionStorage.getItem(recCandFilterStorageKey('org-b')),
    };
  });
  const kept = persisted.filters;
  check(persisted.changed && persisted.q === 'Ana' && persisted.profile === 'Ventas', 'al restaurar se repinta el buscador y se descarta el perfil inválido');
  check(kept.profiles.join('|') === 'Ventas' && kept.sources.join('|') === 'Indeed' && kept.tagIds.join('|') === 'tag-good' && kept.stageIds.join('|') === 'stage-1' && kept.recruiterIds.join('|') === 'emp-old|__none__' && kept.vacancyIds.join('|') === 'vac-1', 'se descartan identificadores que ya no pertenecen a los catálogos');
  check(persisted.stored.includes('tag-good') && !persisted.stored.includes('tag-foreign') && persisted.other.includes('secreto'), 'la clave guardada queda limpia y la de otra organización no se toca');

  const pages = await page.evaluate(async () => {
    const calls = [];
    window.apiJson = async (url) => {
      calls.push(url);
      if (url.includes('cursor=')) {
        return {
          candidates: [
            { id: 'a', fullName: 'A', profile: 'Ventas' },
            { id: 'c', fullName: 'C', profile: 'Ventas' },
          ],
          nextCursor: null,
          total: 3,
        };
      }
      return {
        candidates: [
          { id: 'a', fullName: 'A', profile: 'Ventas' },
          { id: 'b', fullName: 'B', profile: 'Ventas' },
        ],
        nextCursor: 'cursor-1',
        total: 3,
      };
    };
    const st = recEnsureState();
    st.candidatesNextCursor = 'cursor-viejo';
    st.candFilters = recCandEmptyFilters();
    st.candFilters.profiles = ['Ventas'];
    await recCandLoadList(false);
    const firstUrl = calls[0] || '';
    const kicker = document.getElementById('rec-cand-list-kicker').textContent;
    await recCandLoadList(true);
    const ids = st.candidates.map((row) => row.id);
    const callCount = calls.length;
    st.candidatesNextCursor = null;
    await recCandLoadList(true);
    return { firstUrl, kicker, ids, callCount, after: st.candidates.map((row) => row.id), calls: calls.length };
  });
  check(!pages.firstUrl.includes('cursor=') && pages.firstUrl.includes('profiles=Ventas'), 'cambiar el filtro reinicia la paginación');
  check(pages.kicker === 'Talento registrado · 3', 'Talento registrado muestra el total filtrado del servidor');
  check(pages.ids.join('|') === 'a|b|c' && pages.callCount === 2 && pages.calls === 2 && pages.after.join('|') === 'a|b|c', 'la página siguiente no duplica candidatos y no consulta sin cursor');
  check(pageErrors.length === 0, 'la página no lanza errores: ' + pageErrors.join(' | '));
  await browser.close();
  server.close();
}

function REC_SOURCE_COUNT(html) {
  const match = html.match(/REC_CAND_SOURCE_OPTS=\[(.*?)\]/);
  if (!match) return -1;
  return match[1].split(',').length;
}

if (failed) {
  console.error(`\n${failed} comprobaciones fallaron`);
  process.exit(1);
}
console.log('\nFiltros del directorio en orden\n');

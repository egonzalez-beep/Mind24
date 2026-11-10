/**
 * Recruitment 1D.1 — expediente candidato (listado, detalle, procesos).
 * node server/scripts/test-recruitment-candidates.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-candidates-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
const migrationSql = fs.readFileSync(
  path.join(rootDir, 'prisma/migrations/20261020200000_recruitment_candidate_resume/migration.sql'),
  'utf8',
);
const routes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const candidateSvc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentCandidate.service.js'), 'utf8');

const { prisma } = await import('../src/db/client.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/services/auth.service.js');
const { ensureOrganizationRecruitmentStages } = await import('../src/services/recruitmentStage.service.js');
const {
  findPotentialDuplicateRecruitmentCandidates,
  resolveCandidateListProcessPreview,
  buildLatestTerminalPreviewByCandidateId,
} = await import('../src/services/recruitmentCandidate.service.js');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function parseSetCookie(res) {
  const raw = res.headers.getSetCookie?.() || [];
  if (raw.length) return raw;
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

function cookieHeaderFromResponse(res, name) {
  for (const line of parseSetCookie(res)) {
    const part = line.split(';')[0];
    if (part.startsWith(`${name}=`)) return part;
  }
  return '';
}

async function jsonFetch(base, urlPath, { method = 'GET', body, cookie } = {}) {
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

const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');

console.log('\n=== Recruitment 1D.1 — estático candidatos ===\n');

check(/model RecruitmentCandidateResume/.test(schema), 'modelo Resume');
check(/@@unique\(\[candidateId\]\)|candidateId\s+String\s+@unique/.test(schema), 'unique CV por candidato');
check(/CREATE TABLE "RecruitmentCandidateResume"/.test(migrationSql), 'migración resume');
check(/buildApplicationSummariesByCandidateId/.test(candidateSvc), 'applicationSummary batch');
check(/nextCursor/.test(candidateSvc), 'paginación cursor');
check(/findPotentialDuplicateRecruitmentCandidates/.test(candidateSvc), 'helper duplicados');
check(/router\.get\('\/candidates'/.test(routes) && /req\.query\.q/.test(routes), 'GET list q');
check(/router\.post\('\/candidates\/check-duplicates'/.test(routes), 'POST check-duplicates');
check(/findPotentialDuplicateRecruitmentCandidates/.test(routes), 'check-duplicates usa helper');
check(!/status/.test(schema.match(/model RecruitmentCandidate \{[\s\S]*?\n\}/)?.[0] || ''), 'sin status en Candidate');
check(/recruitmentCandidateCatalog\.service/.test(candidateSvc), 'catálogo en candidate service');
check(/initialStageId/.test(fs.readFileSync(path.join(rootDir, 'src/services/recruitmentApplication.service.js'), 'utf8')), 'initialStageId application');
check(/profileSecondary/.test(schema), 'profileSecondary en schema');
check(/superRefine\(candidateContactRefine\)/.test(routes), 'contacto whatsapp o phone en POST');
const patchSchemaBlock = routes.split('const candidatePatchSchema')[1]?.split('router.get')[0] || '';
check(
  !patchSchemaBlock.includes('candidateContactRefine(data'),
  'PATCH no exige contacto en payload',
);

console.log('\n=== Recruitment CURP opcional — unit y frontend ===\n');

const {
  normalizeRecruitmentCandidateCurp,
  recruitmentCandidateCurpConflicts,
  recruitmentCandidateCurpForLookup,
  RECRUITMENT_CURP_INVALID_MESSAGE,
} = await import('../src/services/recruitmentCandidateCatalog.service.js');

function curpError(input) {
  try {
    normalizeRecruitmentCandidateCurp(input);
    return null;
  } catch (e) {
    return e;
  }
}
check(normalizeRecruitmentCandidateCurp(undefined) === null, 'sin CURP → null');
check(normalizeRecruitmentCandidateCurp(null) === null, 'CURP null → null');
check(normalizeRecruitmentCandidateCurp('') === null, 'CURP vacía → null');
check(normalizeRecruitmentCandidateCurp('   ') === null, 'CURP en blanco → null');
check(
  normalizeRecruitmentCandidateCurp('gose900101hqrtmn09') === 'GOSE900101HQRTMN09',
  'minúsculas → mayúsculas',
);
check(
  normalizeRecruitmentCandidateCurp('  gose900101hqrtmn09  ') === 'GOSE900101HQRTMN09',
  'espacios externos → valor limpio',
);
check(
  normalizeRecruitmentCandidateCurp('go se 900101 hqrtmn09') === 'GOSE900101HQRTMN09',
  'espacios internos → valor limpio',
);
check(
  normalizeRecruitmentCandidateCurp('GOÑE900101HQRTMN09') === 'GOÑE900101HQRTMN09',
  'CURP con Ñ',
);
check(
  normalizeRecruitmentCandidateCurp('garc850101mdfrrl08') === 'GARC850101MDFRRL08',
  'segunda CURP canónica',
);
const badFormat = curpError('GOSE901301HQRTMN09');
const badLen = curpError('GOSE900101HQRTMN0');
const badLong = curpError('GOSE900101HQRTMN099');
check(
  badFormat?.code === 'VALIDATION_ERROR' && badFormat.message === RECRUITMENT_CURP_INVALID_MESSAGE,
  'rechazo de formato inválido',
);
check(badLen?.message === 'Ingresa una CURP válida de 18 caracteres.', 'rechazo de longitud distinta de 18');
check(badLong?.message === RECRUITMENT_CURP_INVALID_MESSAGE, 'rechazo de longitud mayor a 18');
check(
  recruitmentCandidateCurpConflicts('GOSE900101HQRTMN09', [{ curp: 'gose 900101 hqrtmn09' }]) === true,
  'duplicado compara CURP normalizada',
);
check(
  recruitmentCandidateCurpConflicts('GOSE900101HQRTMN09', [{ curp: 'MORA900101MDFRRL08' }]) === false,
  'otra CURP no conflicto',
);
check(recruitmentCandidateCurpConflicts(null, [{ curp: 'GOSE900101HQRTMN09' }]) === false, 'sin CURP no conflicto');
check(recruitmentCandidateCurpForLookup('NOPE') === null, 'CURP inválida no llega a la consulta');
check(
  recruitmentCandidateCurpForLookup('  gose900101hqrtmn09 ') === 'GOSE900101HQRTMN09',
  'consulta usa CURP canónica',
);

const candModel = schema.match(/model RecruitmentCandidate \{[\s\S]*?\n\}/)?.[0] || '';
check(/curp\s+String\?/.test(candModel), 'schema curp opcional');
check(!/curp[\s\S]*@unique/.test(candModel), 'sin unique en curp');
const curpMig = fs.readFileSync(
  path.join(rootDir, 'prisma/migrations/20261103203000_recruitment_candidate_curp/migration.sql'),
  'utf8',
);
const curpMigSql = curpMig
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');
check(/ADD COLUMN "curp" TEXT/.test(curpMigSql), 'migración agrega curp');
check(!/NOT NULL|DEFAULT|UNIQUE|UPDATE /i.test(curpMigSql), 'migración sin null forzado, default, unique ni backfill');
const writeBlock = routes.split('const candidateWriteFields')[1]?.split('const candidateCreateSchema')[0] || '';
check(/curp:/.test(writeBlock) && !/organizationId/.test(writeBlock), 'DTO acepta curp y no organizationId');
check(/curpConflict: candidates\.curpConflict === true/.test(routes), 'check-duplicates expone curpConflict');
check(!/curp:\s*c\.curp/.test(routes), 'respuesta de duplicados no incluye CURP');
check(/assertRecruitmentCandidateInOrg\(body\.excludeCandidateId, u\.organizationId\)/.test(routes), 'excludeCandidateId se valida en la organización');
const dupStart = routes.indexOf("router.post('/candidates/check-duplicates'");
const dupRoute = routes.slice(dupStart, routes.indexOf("router.post('/candidates',", dupStart + 10));
check(dupStart > 0 && dupRoute.includes('assertEmpresaAdmin') && !/organizationId:\s*(req\.body|body\.organizationId)/.test(dupRoute), 'check usa organizationId de la sesión');
const mapStart = dupRoute.indexOf('candidates.map');
const dupMap = dupRoute.slice(mapStart, dupRoute.indexOf('})),', mapStart));
check(mapStart > 0 && !/\bcurp\b|organizationId|notes/.test(dupMap), 'mapa de duplicados sin CURP, notas ni organización');
const publicRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.public.routes.js'), 'utf8');
const publicDupStart = publicRoutes.indexOf("router.post('/recruitment/candidates/check-duplicates'");
const publicDup = publicRoutes.slice(publicDupStart, publicRoutes.indexOf('router.post(', publicDupStart + 20));
check(publicDupStart > 0 && !/excludeCandidateId/.test(publicDup), 'portal no acepta excludeCandidateId');
const qBlock = candidateSvc.slice(candidateSvc.indexOf('const qTrim'), candidateSvc.indexOf('if (filters.profiles.length)'));
check(!/\bcurp\b/.test(qBlock), 'búsqueda q no filtra por CURP');
const wfBlock = candidateSvc.slice(
  candidateSvc.indexOf('async function enrichWorkforceRegisteredCandidateRows'),
  candidateSvc.indexOf('export async function listCandidatesRegisteredByWorkforceEmployee'),
);
check(!/\bcurp\b/.test(wfBlock), 'listado colaborador no incluye CURP');

const publicHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'));
const rootHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'));
check(publicHtml.equals(rootHtml), 'index.html y server/public/index.html idénticos');

const datosBlock = indexHtml.slice(indexHtml.indexOf('Datos del candidato'), indexHtml.indexOf('Perfil del candidato'));
const curpInput = datosBlock.match(/<input[^>]*id="rec-cand-form-curp"[^>]*>/)?.[0] || '';
check(/id="rec-cand-form-curp"/.test(datosBlock), 'CURP en datos del candidato');
check(/Opcional/.test(datosBlock) && /Ej\. GOSE900101HQRTMN09/.test(curpInput), 'etiqueta opcional y placeholder');
check(/maxlength="18"/.test(curpInput), 'maxlength 18');
check(/oninput="recCandCurpFieldInput\(this\)"/.test(curpInput), 'normaliza al escribir');
check(/onpaste="recCandCurpFieldPaste\(event\)"/.test(curpInput), 'normaliza al pegar');
check(/onblur="recCandCurpFieldBlur\(this\)"/.test(curpInput), 'normaliza en blur');
check(!/text-transform/i.test(curpInput), 'el input no depende de text-transform');
const curpCss = indexHtml.match(/#rec-cand-form-curp\{[^}]*\}/)?.[0] || '';
check(curpCss && !/text-transform/i.test(curpCss), 'CSS del campo sin text-transform');
check(/@media\(max-width:520px\)[\s\S]*?\.rec-cand-form-grid-row,/.test(indexHtml), 'grid del formulario colapsa en móvil');
check(/recCandExpedienteCurpHtml\(c\)/.test(indexHtml), 'expediente usa el bloque de CURP');
check(/Ya existe un candidato con esta CURP\. Revisa el expediente antes de continuar\./.test(indexHtml), 'advertencia de CURP duplicada');
check(/recCandDupeCreateAnyway/.test(indexHtml), 'la advertencia no sustituye crear de todos modos');
check(/Guardar de todos modos/.test(indexHtml), 'edición ofrece guardar de todos modos');
check(/onclick="closeModal\('modal-rec-candidate-duplicates'\)"/.test(indexHtml), 'volver cierra solo la advertencia');
const showDupeFn = indexHtml.slice(indexHtml.indexOf('function recCandShowDupeModal'), indexHtml.indexOf('function recCandSelectDupe'));
check(/modal-rec-candidate-form/.test(showDupeFn), 'la advertencia conserva el formulario abierto');
const portfolioFn = indexHtml.match(/function recCandBuildPortfolioRowHtml[\s\S]*?\nfunction recCandBindFilters/)?.[0] || '';
check(!/\bcurp\b/i.test(portfolioFn), 'cartera sin columna CURP');
const submitFn = indexHtml.slice(
  indexHtml.indexOf('async function recCandSubmitForm'),
  indexHtml.indexOf('function recCandWorkforceClearPartialCvState'),
);
const editBranch = submitFn.split('if(id){')[1]?.split('const st=recEnsureState()')[0] || '';
check(/recCandEditCurpNeedsDuplicateCheck/.test(editBranch), 'edición revisa CURP solo si cambió');
check(/excludeCandidateId:id/.test(editBranch), 'edición envía el id del candidato abierto');
check(/recCandPatchExisting\(id, body\)/.test(editBranch), 'sin conflicto la edición hace PATCH');
check(!/recCandCreateAndOpen/.test(editBranch), 'la edición no crea otro candidato');
check(/check-duplicates/.test(submitFn) && /curp:body\.curp/.test(submitFn), 'alta revisa CURP una vez al guardar');
const proceedFn = indexHtml.slice(
  indexHtml.indexOf('async function recCandDupeCreateAnyway'),
  indexHtml.indexOf('async function recCandCreateAndOpen'),
);
const proceedEdit = proceedFn.split("if(intent==='edit')")[1]?.split('}else if(body)')[0] || '';
check(/recCandPatchExisting\(editId, body\)/.test(proceedEdit), 'aceptar en edición actualiza al mismo candidato');
check(!/recCandCreateAndOpen|recCandWorkforceCreateAndConfirm|method:'POST'/.test(proceedEdit), 'aceptar en edición no hace POST');
check(/candFormOriginalCurp/.test(indexHtml), 'edición recuerda el CURP original');
const inputFn = indexHtml.slice(
  indexHtml.indexOf('function recCandCurpFieldInput'),
  indexHtml.indexOf('function recCandCurpFieldPaste'),
);
check(!/check-duplicates/.test(inputFn), 'no consulta duplicados en cada tecla');

const curpSrc = indexHtml.slice(
  indexHtml.indexOf('var REC_CAND_CURP_RE='),
  indexHtml.indexOf('function recCandEditFromDetail'),
);
const curpCtx = {
  recCandExpCell(kind, label, inner) {
    return `CELL:${kind}:${label}:${inner}`;
  },
  tcEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch]);
  },
};
curpCtx.window = curpCtx;
vm.createContext(curpCtx);
vm.runInContext(
  `${curpSrc}
function fakeInput(value, start, end){
  const el={value:value||'', selectionStart:start==null?(value||'').length:start, selectionEnd:end==null?(start==null?(value||'').length:start):end};
  el.setSelectionRange=function(a,b){ this.selectionStart=a; this.selectionEnd=b; };
  return el;
}
this.__typed=fakeInput('gose900101hqrtmn09', 4, 4);
recCandCurpFieldInput(this.__typed);
this.__pasted=fakeInput('', 0, 0);
this.__pastePrevented=false;
recCandCurpFieldPaste({
  target:this.__pasted,
  preventDefault:function(){ this.__pastePrevented=true; }.bind(this),
  clipboardData:{ getData:function(){ return 'go se 900101 hqrtmn09'; } },
});
this.__blurred=fakeInput('gose900101hqrtmn09', 18, 18);
recCandCurpFieldBlur(this.__blurred);
this.__present=recCandExpedienteCurpHtml({ curp:'gose900101hqrtmn09' });
this.__absent=recCandExpedienteCurpHtml({ curp:null });
this.__blank=recCandExpedienteCurpHtml({ curp:'   ' });
this.__unsafe=recCandExpedienteCurpHtml({ curp:'<img src=x onerror=alert(1)>' });
this.__err=recCandCurpClientError('nope');
this.__okErr=recCandCurpClientError('');
this.__same=recCandEditCurpNeedsDuplicateCheck('gose900101hqrtmn09','GOSE900101HQRTMN09');
this.__changed=recCandEditCurpNeedsDuplicateCheck('mora900101mdfrrl08','GOSE900101HQRTMN09');
this.__cleared=recCandEditCurpNeedsDuplicateCheck('','GOSE900101HQRTMN09');
this.__blankCurp=recCandEditCurpNeedsDuplicateCheck('   ','GOSE900101HQRTMN09');
`,
  curpCtx,
);
check(curpCtx.__typed.value === 'GOSE900101HQRTMN09' && curpCtx.__typed.selectionStart === 4, 'escritura convierte el valor y conserva el cursor');
check(curpCtx.__pastePrevented === true && curpCtx.__pasted.value === 'GOSE900101HQRTMN09', 'pegado en minúsculas convierte el valor real');
check(curpCtx.__blurred.value === 'GOSE900101HQRTMN09', 'blur vuelve a normalizar');
check(curpCtx.__err === 'Ingresa una CURP válida de 18 caracteres.' && curpCtx.__okErr === '', 'validación de formulario');
check(/GOSE900101HQRTMN09/.test(curpCtx.__present) && /CELL:curp:CURP:/.test(curpCtx.__present), 'CURP visible en expediente');
check(curpCtx.__absent === '' && curpCtx.__blank === '', 'sin CURP no deja placeholder');
check(!/Sin datos|—/.test(curpCtx.__absent), 'ausente sin guion ni texto vacío');
check(curpCtx.__unsafe.includes('&lt;IMG') && !/<(img|IMG)/.test(curpCtx.__unsafe), 'expediente escapa el contenido');
check(/set\('rec-cand-form-curp',candidate\.curp\?String\(candidate\.curp\)\.replace/.test(indexHtml), 'edición precarga el CURP en mayúsculas');
check(curpCtx.__same === false, 'edición sin cambio de CURP no consulta');
check(curpCtx.__changed === true, 'edición con CURP distinta consulta');
check(curpCtx.__cleared === false && curpCtx.__blankCurp === false, 'eliminar CURP no consulta');

console.log('\n=== Recruitment 1F.1 — ficha premium candidato (estático) ===\n');

check(/rec-cand-detail-modal rec-detail-modal/.test(indexHtml), 'toolbar paridad rec-detail-modal');
check(/rec-cand-detail-arch-badge/.test(indexHtml), 'badge archivado en header');
check(/rec-cand-pipeline-hero/.test(indexHtml), 'hero proceso actual');
check(/recCandPickPrimaryApplication/.test(indexHtml), 'regla proceso principal');
check(/recCandBuildStageRailHtml/.test(indexHtml), 'stage rail');
check(/vacancyStagesCache/.test(indexHtml), 'cache stages por vacante');
check(/rec-cand-pipeline-empty/.test(indexHtml), 'sin proceso activo');
check(/rec-cand-expediente/.test(indexHtml) && !/id="rec-cand-info-grid"/.test(indexHtml), 'expediente agrupado sin info-grid');
check(/recCandProfileSecondaryLabel/.test(indexHtml), 'helper perfil secundario');
check(/recCandGoToPipeline/.test(indexHtml), 'Ver en pipeline');
check(/recCandRenderAside/.test(indexHtml), 'render lateral otros procesos');
check(/Historial/.test(indexHtml), 'histórico procesos');
check(/recCandSummaryMetaLine/.test(indexHtml), 'applicationSummary compacto');
check(!/rec-cand-mini-kpis/.test(indexHtml), 'sin KPI cards protagonistas');
check(/rec-vac-detail-btn.*recCandOpenCv|recCandOpenCv\(\).*rec-vac-detail-btn/s.test(indexHtml.replace(/\s+/g,' ')), 'CV acciones icono');
check(/id="rec-cand-toolbar-add-vac"/.test(indexHtml), '+ Añadir a vacante icono toolbar');
check(/rec-cand-toolbar-menu/.test(indexHtml) && /id="rec-cand-archive-btn"/.test(indexHtml), 'archivar en menú toolbar');
check(!/rec-cand-detail-footer/.test(indexHtml), 'sin footer archivar');
const railFn = indexHtml.match(/function recCandBuildLabeledStageRailHtml[\s\S]*?function recCandFillHeroStageSelect/)?.[0] || '';
check(/ariaState=/.test(railFn) && /tcEsc\(ariaLabel\)/.test(railFn), 'rail aria-label por etapa');
check(/rec-cand-rail-label" title=/.test(railFn), 'rail label title tooltip');

console.log('\n=== Recruitment 1H.1 — cartera de talento (estático) ===\n');

const candPaneBlock = indexHtml.match(/id="rec-pane-candidates"[\s\S]*?id="rec-cand-list-kicker"/)?.[0] || '';
check(!/Cartera de talento/.test(candPaneBlock) && !/rec-cand-head-row/.test(candPaneBlock), 'sin título cartera en vista');
check(/rec-topbar-cand-tools/.test(indexHtml) && /\+ Nuevo candidato/.test(indexHtml), 'CTA nuevo candidato en topbar');
check(/archivedOnly/.test(indexHtml.match(/function recCandBuildListQuery[\s\S]*?^function /m)?.[0] || ''), 'query archivedOnly');
check(/archivedOnly/.test(routes) && /archivedAt:\s*\{\s*not:\s*null\s*\}/.test(candidateSvc), 'backend solo archivados');
check(/rec-cand-toolbar/.test(indexHtml) && /rec-cand-clear-filters/.test(indexHtml), 'toolbar y limpiar filtros');
check(/recCandClearFilters/.test(indexHtml) && /recCandHasActiveFilters/.test(indexHtml), 'limpiar filtros condicional');
check(/recCandPortfolioIconSvg/.test(indexHtml) && /recCandBuildPortfolioRowHtml/.test(indexHtml), 'filas premium con SVG');
check(/Talento registrado/.test(indexHtml) && /rec-cand-list-kicker/.test(indexHtml), 'contador único kicker');
const renderListFn = indexHtml.match(/function recCandRenderList[\s\S]*?^function /m)?.[0] || '';
check(/candListTotal/.test(renderListFn) && /Talento registrado/.test(renderListFn), 'contador del resultado filtrado');
check(/primaryActiveProcess/.test(indexHtml) && /recCandRowProcessHtml/.test(indexHtml), 'proceso activo en fila');
check(/Sin proceso activo/.test(indexHtml), 'sin proceso activo');
check(!/rec-cand-pill--active/.test(indexHtml.match(/function recCandRenderList[\s\S]*?^}/m)?.[0] || ''), 'sin pills En proceso/Contratado/Rechazado');
check(!/rec-cand-row-chevron/.test(indexHtml.match(/function recCandBuildPortfolioRowHtml[\s\S]*?^}/m)?.[0] || ''), 'sin chevron en fila');
check(/contextVacancyId/.test(routes), 'contextVacancyId en listado');
check(/buildPrimaryActivePreviewByCandidateId/.test(candidateSvc), 'preview proceso activo listado');
check(/buildLatestTerminalPreviewByCandidateId/.test(candidateSvc), 'preview terminal listado');
check(/resolveCandidateListProcessPreview/.test(candidateSvc), 'merge preview listado');
check(/stageId/.test(routes) && /applications:\s*\{\s*some:/.test(candidateSvc), 'filtro etapa backend');
check(/rec-cand-stage/.test(candPaneBlock) && /recCandEnsureStageCatalog/.test(indexHtml), 'filtro etapa UI');
check(/listPreviewKind/.test(indexHtml.match(/function recCandRowProcessHtml[\s\S]*?^function /m)?.[0] || ''), 'preview terminal en fila');
check(/rec-cand-process-dot--hired/.test(indexHtml) && /rec-cand-process-dot--rejected/.test(indexHtml), 'dots terminal');
const regByFn = indexHtml.match(/function recCandRegisteredByExpHtml[\s\S]*?^function /m)?.[0] || '';
check(/recCandExpIcon\('registrar'\)/.test(regByFn) === false, 'sin SVG duplicado en Registrado por valor');

console.log('\n=== Recruitment 1J — preview y filtro etapa (unit) ===\n');

check(
  resolveCandidateListProcessPreview(
    { listPreviewKind: 'active', stageName: 'Entrevista' },
    { listPreviewKind: 'hired', stageName: 'Contratado' },
  ).listPreviewKind === 'active',
  'resolve prioriza activo',
);
check(
  resolveCandidateListProcessPreview(null, { listPreviewKind: 'rejected', stageName: 'Rechazado' })
    ?.listPreviewKind === 'rejected',
  'resolve terminal sin activo',
);
check(resolveCandidateListProcessPreview(null, null) === null, 'resolve sin preview');

console.log('\n=== Recruitment 1I — formulario nuevo candidato premium (estático) ===\n');

check(/rec-cand-form-header/.test(indexHtml) && /Reclutamiento/.test(indexHtml.match(/modal-rec-candidate-form[\s\S]*?rec-cand-form-body/)?.[0] || ''), 'header reclutamiento');
check(/rec-cand-form-process-block/.test(indexHtml), 'bloque proceso destacado');
check(/Perfil del candidato/.test(indexHtml) && !/Clasificación/.test(indexHtml.match(/modal-rec-candidate-form[\s\S]*?<\/div>\s*<\/div>\s*<div id="modal-rec-candidate-add-vacancy"/)?.[0] || indexHtml), 'perfil del candidato sin clasificación');
check(/rec-cand-form-cv-panel/.test(indexHtml) && /recCandFormCvPicked/.test(indexHtml), 'CV en alta con drop zone');
check(/recCandUploadCvForCandidate/.test(indexHtml) && /candFormPendingCvFile/.test(indexHtml), 'CV pendiente al crear');
check(/Guardar candidato/.test(indexHtml), 'CTA guardar candidato');
check(/recCandFormIconSvg/.test(indexHtml), 'SVGs formulario');
check(!/Registra talento/.test(indexHtml.match(/modal-rec-candidate-form[\s\S]*?rec-cand-form-footer/)?.[0] || ''), 'sin subtítulo redundante');

console.log('\n=== Recruitment 1F.2 — cierre visual ficha (estático) ===\n');

check(/max-width:min\(1180px/.test(indexHtml), 'modal ancho desktop');
check(/rec-cand-detail-kicker/.test(indexHtml), 'header kicker ficha');
check(/rec-cand-detail-active-badge/.test(indexHtml), 'badge activo');
check(/recCandBuildLabeledStageRailHtml/.test(indexHtml), 'stage rail etiquetado');
check(/rec-cand-labeled-rail--dense/.test(indexHtml), 'rail denso muchas etapas');
check(/recCandChangePrimaryStage/.test(indexHtml), 'cambiar etapa desde ficha');
check(/rec-cand-body-grid/.test(indexHtml), 'layout dos columnas');
check(/Expediente ejecutivo/.test(indexHtml), 'expediente ejecutivo card');
check(/rec-cand-exp-icon/.test(indexHtml), 'iconos expediente');
check(/CV y documentos/.test(indexHtml), 'CV y documentos card');
check(/rec-cand-observations-card/.test(indexHtml) && /recCandLoadDetailNotes/.test(indexHtml), 'observaciones colaborativas');
check(/rec-cand-body-aside/.test(indexHtml), 'columna lateral');
check(/Otros procesos/.test(indexHtml), 'otros procesos lateral');
check(!/Actividad reciente/.test(indexHtml), 'sin activity feed');
check(!/rec-cand-module-tab|Experiencia.*Formación.*Historial/.test(indexHtml.replace(/\s+/g,' ')), 'sin tabs falsas');
check(/detailPrimaryApplication/.test(indexHtml), 'estado proceso principal');

console.log('\n=== Recruitment — navegación anterior/siguiente en expediente (estático) ===\n');

const navSnapFn = indexHtml.match(/function recCandBuildNavSnapshot[\s\S]*?^function /m)?.[0] || '';
const navKanbanFn = indexHtml.match(/function recCandNavBuildKanbanSnapshot[\s\S]*?^function /m)?.[0] || '';
check(/moduleTab==='candidates'/.test(navSnapFn) && /recCandNavBuildKanbanSnapshot/.test(navSnapFn), 'snapshot cartera y kanban');
check(/recCandNavBuildPortfolioSnapshot/.test(navSnapFn), 'snapshot reutiliza candidates filtrados');
check(/byStage\.get\(sid\)/.test(navKanbanFn), 'snapshot orden kanban por columnas');
const navLoadFn = indexHtml.match(/function recCandLoadDetailCandidate[\s\S]*?^function /m)?.[0] || '';
check(/recCandDetailFetchSeq/.test(navLoadFn) && /AbortController/.test(navLoadFn), 'secuencia y abort en carga');
check(/httpStatus===404/.test(navLoadFn) && /recCandNavRemoveMissingId/.test(navLoadFn), '404 retira id del snapshot');
check(/AbortError/.test(navLoadFn), 'ignora AbortError');
const navUiFn = indexHtml.match(/function recCandNavigateDetail[\s\S]*?^function /m)?.[0] || '';
check(/recCandDetailObsDirty/.test(navUiFn), 'bloqueo navegación con observación sin guardar');
const navUiUpdate = indexHtml.match(/function recCandNavUpdateUi[\s\S]*?^function /m)?.[0] || '';
const navPosFn = indexHtml.match(/function recCandNavComputePosition[\s\S]*?^function /m)?.[0] || '';
const navBtnFn = indexHtml.match(/function recCandNavComputeButtonDisabled[\s\S]*?^function /m)?.[0] || '';
check(/' de '\+total/.test(navPosFn) && /aria-disabled/.test(navUiUpdate), 'indicador N de total y aria-disabled');
check(/index<=0/.test(navBtnFn) && /index>=total-1/.test(navBtnFn), 'extremos deshabilitados');
check(/id="rec-cand-nav-prev"/.test(indexHtml) && /aria-label="Candidato anterior"/.test(indexHtml), 'botón anterior accesible');
check(/id="rec-cand-nav-next"/.test(indexHtml) && /aria-label="Candidato siguiente"/.test(indexHtml), 'botón siguiente accesible');
check(/recCandTryCloseDetailModal/.test(indexHtml) && /recCandOnDetailModalClosed/.test(indexHtml), 'cierre con dirty y cleanup');
const navCloseFn = indexHtml.match(/function recCandOnDetailModalClosed[\s\S]*?^function /m)?.[0] || '';
check(/recCandNavRestoreScroll/.test(navCloseFn) && /recCandNavRefreshPipelineIfDirty/.test(navCloseFn), 'scroll y refresh al cerrar');
check(/recCandMarkPipelineDirty/.test(indexHtml) && /candNavPipelineDirty/.test(indexHtml), 'marca dirty pipeline');
const openDetailFn = indexHtml.match(/async function recCandOpenDetail[\s\S]*?^async function /m)?.[0] || '';
check(/recCandBuildNavSnapshot/.test(openDetailFn) && /fromNav/.test(openDetailFn), 'snapshot al abrir, no al navegar');
check(!/recCandLoadList\(false\)[\s\S]{0,40}recCandFetchDetail/.test(navLoadFn), 'navegación no recarga listado completo');
check(/recCandRetryDetailLoad/.test(indexHtml) && /recCandSetDetailLoadErr/.test(indexHtml), 'error recuperable con Reintentar');
check(/REC_CAND_NAV_PURE_HELPERS_START/.test(indexHtml) && /REC_CAND_NAV_PURE_HELPERS_END/.test(indexHtml), 'helpers nav delimitados en index.html');

console.log('\n=== Recruitment 1D.1 — integración (DB) ===\n');

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP integration:', e.message);
}

async function cleanupOrg(orgId) {
  await prisma.recruitmentCandidateResume.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentApplicationStageEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentApplication.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentVacancyStage.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentVacancy.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentCandidate.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentStage.deleteMany({ where: { organizationId: orgId } });
}

if (dbOk) {
  for (const mig of [
    '20261020180000_recruitment_vacancy_stages',
    '20261020200000_recruitment_candidate_resume',
    '20261023120000_recruitment_candidate_profile_fields',
    '20261103203000_recruitment_candidate_curp',
  ]) {
    try {
      await prisma.$executeRawUnsafe(
        fs.readFileSync(path.join(rootDir, 'prisma/migrations', mig, 'migration.sql'), 'utf8'),
      );
    } catch {
      /* ya aplicada */
    }
  }

  const suffix = crypto.randomBytes(4).toString('hex');
  const orgA = await prisma.organization.create({
    data: { name: `Cand A ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const orgB = await prisma.organization.create({
    data: { name: `Cand B ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const pass = 'TestAdmin1!';
  const adminA = await prisma.user.create({
    data: {
      email: `cand-a-${suffix}@example.com`,
      passwordHash: await hashPassword(pass),
      fullName: 'Admin',
      role: 'empresa_admin',
      organizationId: orgA.id,
    },
  });

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { email: adminA.email, password: pass },
    });
    const cookie = cookieHeaderFromResponse(login.res, 'mind24.sid');

    const c1 = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie,
      body: {
        fullName: 'Juan Pérez',
        profile: 'Transporte',
        whatsapp: '5512345678',
        email: `juan-${suffix}@example.com`,
        source: 'Referido',
      },
    });
    check(c1.res.status === 201, 'crear candidato');
    const candidateId = c1.data.candidate?.id;

    const patch = await jsonFetch(base, `/api/org/recruitment/candidates/${candidateId}`, {
      method: 'PATCH',
      cookie,
      body: { city: 'CDMX', notes: '  nota  ' },
    });
    check(patch.res.status === 200 && patch.data.candidate?.city === 'CDMX', 'editar candidato');

    const patchCityOnly = await jsonFetch(base, `/api/org/recruitment/candidates/${candidateId}`, {
      method: 'PATCH',
      cookie,
      body: { city: 'Querétaro' },
    });
    check(
      patchCityOnly.res.status === 200 && patchCityOnly.data.candidate?.city === 'Querétaro',
      'PATCH parcial solo city sin contacto en body',
    );
    check(patchCityOnly.data.candidate?.whatsapp === '5512345678', 'PATCH parcial conserva whatsapp');

    const otroCreate = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie,
      body: {
        fullName: 'Otro Clean',
        profile: 'Otro',
        profileOther: 'Texto legacy perfil',
        whatsapp: '5511223344',
        source: 'Otro',
        sourceOther: 'FB Ads',
      },
    });
    const otroId = otroCreate.data.candidate?.id;
    check(otroCreate.data.candidate?.profileOther === 'Texto legacy perfil', 'Otro con profileOther');

    const canonPatch = await jsonFetch(base, `/api/org/recruitment/candidates/${otroId}`, {
      method: 'PATCH',
      cookie,
      body: { profile: 'Ventas', source: 'Indeed' },
    });
    check(canonPatch.res.status === 200, 'Otro a canónico PATCH');
    check(canonPatch.data.candidate?.profile === 'Ventas', 'profile canónico');
    check(canonPatch.data.candidate?.profileOther == null, 'profileOther limpiado');
    check(canonPatch.data.candidate?.source === 'Indeed', 'source canónico');
    check(canonPatch.data.candidate?.sourceOther == null, 'sourceOther limpiado');

    await ensureOrganizationRecruitmentStages(orgA.id);
    const vac1 = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie,
      body: { title: 'Vac 1', clientName: 'C', positionsTotal: 1 },
    });
    const vac2 = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie,
      body: { title: 'Vac 2', clientName: 'C', positionsTotal: 1 },
    });
    const vacId1 = vac1.data.vacancy?.id;
    const vacId2 = vac2.data.vacancy?.id;

    await jsonFetch(base, `/api/org/recruitment/vacancies/${vacId1}/applications`, {
      method: 'POST',
      cookie,
      body: { candidateId },
    });
    const stages = await prisma.recruitmentStage.findMany({ where: { organizationId: orgA.id } });
    const hired = stages.find((s) => s.key === 'HIRED');
    const rejected = stages.find((s) => s.key === 'REJECTED');

    await jsonFetch(base, `/api/org/recruitment/vacancies/${vacId2}/applications`, {
      method: 'POST',
      cookie,
      body: { candidateId },
    });
    const apps = await prisma.recruitmentApplication.findMany({
      where: { candidateId },
      orderBy: { createdAt: 'asc' },
    });
    if (apps[1]) {
      await jsonFetch(base, `/api/org/recruitment/applications/${apps[1].id}`, {
        method: 'PATCH',
        cookie,
        body: { stageId: hired.id },
      });
    }

    const list = await jsonFetch(base, '/api/org/recruitment/candidates?limit=10', { cookie });
    check(list.res.status === 200 && list.data.candidates?.length >= 1, 'list paginado');
    const row = list.data.candidates.find((c) => c.id === candidateId);
    check(row?.applicationSummary?.total === 2, 'applicationSummary total');
    check(row?.applicationSummary?.hired === 1, 'applicationSummary hired');
    check(row?.applicationSummary?.active === 1, 'applicationSummary active');
    check(row?.primaryActiveProcess?.listPreviewKind === 'active', 'list preview proceso activo');

    const hiredOnly = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie,
      body: {
        fullName: `Solo Contratado ${suffix}`,
        profile: 'Transporte',
        source: 'Referido',
        phone: '5599990001',
      },
    });
    const hiredOnlyId = hiredOnly.data.candidate?.id;
    const vacH = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie,
      body: { title: 'Vac H', clientName: 'C', positionsTotal: 1 },
    });
    await jsonFetch(base, `/api/org/recruitment/vacancies/${vacH.data.vacancy.id}/applications`, {
      method: 'POST',
      cookie,
      body: { candidateId: hiredOnlyId },
    });
    const appH = await prisma.recruitmentApplication.findFirst({
      where: { candidateId: hiredOnlyId },
    });
    await jsonFetch(base, `/api/org/recruitment/applications/${appH.id}`, {
      method: 'PATCH',
      cookie,
      body: { stageId: hired.id },
    });
    const listHired = await jsonFetch(base, '/api/org/recruitment/candidates?limit=50', { cookie });
    const rowH = listHired.data.candidates.find((c) => c.id === hiredOnlyId);
    check(rowH?.primaryActiveProcess?.listPreviewKind === 'hired', 'preview Contratado sin activo');
    check(rowH?.primaryActiveProcess?.stageKey === 'HIRED', 'preview terminal stageKey HIRED');

    const rejOnly = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie,
      body: {
        fullName: `Solo Rechazado ${suffix}`,
        profile: 'Transporte',
        source: 'Referido',
        phone: '5599990002',
      },
    });
    const rejOnlyId = rejOnly.data.candidate?.id;
    const vacR = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie,
      body: { title: 'Vac R', clientName: 'C', positionsTotal: 1 },
    });
    await jsonFetch(base, `/api/org/recruitment/vacancies/${vacR.data.vacancy.id}/applications`, {
      method: 'POST',
      cookie,
      body: { candidateId: rejOnlyId },
    });
    const appR = await prisma.recruitmentApplication.findFirst({
      where: { candidateId: rejOnlyId },
    });
    await jsonFetch(base, `/api/org/recruitment/applications/${appR.id}`, {
      method: 'PATCH',
      cookie,
      body: { stageId: rejected.id },
    });
    const listRej = await jsonFetch(base, '/api/org/recruitment/candidates?limit=50', { cookie });
    const rowR = listRej.data.candidates.find((c) => c.id === rejOnlyId);
    check(rowR?.primaryActiveProcess?.listPreviewKind === 'rejected', 'preview Rechazado sin activo');

    const noApp = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie,
      body: {
        fullName: `Sin Proceso ${suffix}`,
        profile: 'Transporte',
        source: 'Referido',
        phone: '5599990003',
      },
    });
    const noAppId = noApp.data.candidate?.id;
    const listBare = await jsonFetch(base, '/api/org/recruitment/candidates?limit=50', { cookie });
    const rowBare = listBare.data.candidates.find((c) => c.id === noAppId);
    check(rowBare?.primaryActiveProcess == null, 'sin preview sin applications');

    const termMap = await buildLatestTerminalPreviewByCandidateId(orgA.id, [hiredOnlyId, rejOnlyId]);
    check(termMap.get(hiredOnlyId)?.listPreviewKind === 'hired', 'terminal map HIRED');
    check(termMap.get(rejOnlyId)?.listPreviewKind === 'rejected', 'terminal map REJECTED');

    const byHiredStage = await jsonFetch(
      base,
      `/api/org/recruitment/candidates?stageId=${encodeURIComponent(hired.id)}&limit=50`,
      { cookie },
    );
    check(
      byHiredStage.data.candidates.some((c) => c.id === hiredOnlyId),
      'filtro stageId HIRED',
    );
    check(
      !byHiredStage.data.candidates.some((c) => c.id === noAppId),
      'filtro stageId excluye sin app en etapa',
    );

    const search = await jsonFetch(
      base,
      '/api/org/recruitment/candidates?q=' + encodeURIComponent('juan'),
      { cookie },
    );
    check(search.data.candidates.some((c) => c.id === candidateId), 'búsqueda q');

    const byProfile = await jsonFetch(
      base,
      '/api/org/recruitment/candidates?profile=Transporte',
      { cookie },
    );
    check(byProfile.data.candidates.some((c) => c.id === candidateId), 'filtro profile');

    const bySource = await jsonFetch(
      base,
      '/api/org/recruitment/candidates?source=Referido',
      { cookie },
    );
    check(bySource.data.candidates.some((c) => c.id === candidateId), 'filtro source');

    const detail = await jsonFetch(base, `/api/org/recruitment/candidates/${candidateId}`, {
      cookie,
    });
    check(detail.data.candidate?.applications?.length === 2, 'detalle múltiples applications');
    check(detail.data.candidate?.applications[0]?.vacancy?.title, 'detalle vacancy embed');
    check(detail.data.candidate?.applications[0]?.stage?.key, 'detalle stage embed');

    await jsonFetch(base, `/api/org/recruitment/candidates/${candidateId}`, {
      method: 'PATCH',
      cookie,
      body: { archived: true },
    });
    const archivedHidden = await jsonFetch(base, '/api/org/recruitment/candidates', { cookie });
    check(!archivedHidden.data.candidates.some((c) => c.id === candidateId), 'archivado oculto en list');

    const archivedDetail = await jsonFetch(
      base,
      `/api/org/recruitment/candidates/${candidateId}`,
      { cookie },
    );
    check(
      archivedDetail.data.candidate?.applications?.length === 2,
      'archivado conserva historial',
    );

    const dups = await findPotentialDuplicateRecruitmentCandidates(orgA.id, {
      email: `juan-${suffix}@example.com`,
      phone: '5512345678',
    });
    check(dups.some((d) => d.id === candidateId), 'helper duplicados detecta email');

    const adminB = await prisma.user.create({
      data: {
        email: `cand-b-${suffix}@example.com`,
        passwordHash: await hashPassword(pass),
        fullName: 'B',
        role: 'empresa_admin',
        organizationId: orgB.id,
      },
    });
    const loginB = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { email: adminB.email, password: pass },
    });
    const cookieB = cookieHeaderFromResponse(loginB.res, 'mind24.sid');

    let phoneSeq = 0;
    const nextPhone = () => {
      phoneSeq += 1;
      return `557700${String(phoneSeq).padStart(4, '0')}`;
    };
    const postCand = (extra) =>
      jsonFetch(base, '/api/org/recruitment/candidates', {
        method: 'POST',
        cookie,
        body: {
          fullName: 'Ana López',
          profile: 'Ventas',
          whatsapp: nextPhone(),
          ...extra,
        },
      });

    const withoutCurp = await postCand({});
    check(withoutCurp.res.status === 201 && withoutCurp.data.candidate?.curp == null, 'registro sin CURP');
    const validCurp = await postCand({ curp: 'gose900101hqrtmn09' });
    check(
      validCurp.res.status === 201 && validCurp.data.candidate?.curp === 'GOSE900101HQRTMN09',
      'registro con CURP válida en mayúsculas',
    );
    const curpId = validCurp.data.candidate?.id;
    const spacedCurp = await postCand({ curp: '  go se 900101 hqrtmn09  ' });
    check(spacedCurp.data.candidate?.curp === 'GOSE900101HQRTMN09', 'persistencia limpia espacios');
    const emptyCurp = await postCand({ curp: '   ' });
    check(emptyCurp.res.status === 201 && emptyCurp.data.candidate?.curp == null, 'CURP vacía persiste null');
    const invalidCurp = await postCand({ curp: 'GOSE901301HQRTMN09' });
    check(
      invalidCurp.res.status === 400 &&
        invalidCurp.data?.message === 'Ingresa una CURP válida de 18 caracteres.',
      'API rechaza formato inválido',
    );
    const shortCurp = await postCand({ curp: 'GOSE900101HQRTMN0' });
    check(shortCurp.res.status === 400, 'API rechaza longitud distinta de 18');
    const added = await jsonFetch(base, `/api/org/recruitment/candidates/${withoutCurp.data.candidate.id}`, {
      method: 'PATCH',
      cookie,
      body: { curp: 'mora900101mdfrrl08' },
    });
    check(added.res.status === 200 && added.data.candidate?.curp === 'MORA900101MDFRRL08', 'edición agrega CURP');
    const changed = await jsonFetch(base, `/api/org/recruitment/candidates/${withoutCurp.data.candidate.id}`, {
      method: 'PATCH',
      cookie,
      body: { curp: 'GOSE900101HQRTMN09' },
    });
    check(changed.data.candidate?.curp === 'GOSE900101HQRTMN09', 'edición modifica CURP');
    const cleared = await jsonFetch(base, `/api/org/recruitment/candidates/${withoutCurp.data.candidate.id}`, {
      method: 'PATCH',
      cookie,
      body: { curp: '' },
    });
    check(cleared.res.status === 200 && cleared.data.candidate?.curp == null, 'edición elimina CURP');
    await prisma.recruitmentCandidate.update({
      where: { id: curpId },
      data: { curp: 'gose900101hqrtmn09' },
    });
    const serialized = await jsonFetch(base, `/api/org/recruitment/candidates/${curpId}`, { cookie });
    check(serialized.data.candidate?.curp === 'GOSE900101HQRTMN09', 'serialización administrativa en mayúsculas');
    const sameOrgDup = await jsonFetch(base, '/api/org/recruitment/candidates/check-duplicates', {
      method: 'POST',
      cookie,
      body: { curp: 'gose900101hqrtmn09' },
    });
    check(sameOrgDup.data?.curpConflict === true, 'advertencia de CURP en la misma organización');
    check(
      sameOrgDup.data?.candidates?.some((c) => c.id === curpId) &&
        sameOrgDup.data.candidates.every((c) => {
          const keys = Object.keys(c);
          return !keys.includes('curp') && !keys.includes('organizationId') && !keys.includes('notes');
        }),
      'duplicado misma org sin CURP ni datos de más',
    );
    const soloCurp = await postCand({ curp: 'garc850101mdfrrl08' });
    const soloId = soloCurp.data.candidate?.id;
    check(soloCurp.data.candidate?.curp === 'GARC850101MDFRRL08', 'CURP propia persistida en mayúsculas');
    const selfDup = await jsonFetch(base, '/api/org/recruitment/candidates/check-duplicates', {
      method: 'POST',
      cookie,
      body: { curp: 'garc850101mdfrrl08', excludeCandidateId: soloId },
    });
    check(
      selfDup.data?.curpConflict === false &&
        !(selfDup.data?.candidates || []).some((c) => c.id === soloId),
      'el candidato no entra en conflicto consigo mismo',
    );
    const foreignExclude = await jsonFetch(base, '/api/org/recruitment/candidates/check-duplicates', {
      method: 'POST',
      cookie: cookieB,
      body: { curp: 'gose900101hqrtmn09', excludeCandidateId: curpId },
    });
    check(foreignExclude.res.status === 404, 'excludeCandidateId de otra organización se rechaza');
    const again = await postCand({ curp: 'GOSE900101HQRTMN09' });
    check(again.res.status === 201, 'CURP repetida no bloquea el guardado');
    const crossDup = await jsonFetch(base, '/api/org/recruitment/candidates/check-duplicates', {
      method: 'POST',
      cookie: cookieB,
      body: { curp: 'gose900101hqrtmn09' },
    });
    check(
      crossDup.data?.curpConflict === false &&
        !(crossDup.data?.candidates || []).some((c) => c.id === curpId),
      'duplicado no revela candidatos de otra organización',
    );
    const otherOrg = await jsonFetch(base, '/api/org/recruitment/candidates', {
      method: 'POST',
      cookie: cookieB,
      body: {
        fullName: 'Bruno Díaz',
        profile: 'Ventas',
        whatsapp: '5599001122',
        curp: 'gose900101hqrtmn09',
      },
    });
    check(
      otherOrg.res.status === 201 && otherOrg.data.candidate?.curp === 'GOSE900101HQRTMN09',
      'misma CURP permitida en otra organización',
    );

    const cross = await jsonFetch(base, `/api/org/recruitment/candidates/${candidateId}`, {
      cookie: cookieB,
    });
    check(cross.res.status === 404, 'multi-org detalle candidato');
  } finally {
    server.close();
    await cleanupOrg(orgA.id);
    await cleanupOrg(orgB.id);
    await prisma.user.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  }
}

console.log('\n=== Regresiones ===\n');

function runRegression(script) {
  const r = spawnSync(process.execPath, [path.join('scripts', script)], {
    cwd: rootDir,
    encoding: 'utf8',
    env: process.env,
  });
  if (r.status !== 0) {
    console.error((r.stdout || '') + (r.stderr || ''));
    check(false, script);
  } else {
    check(true, script);
  }
}

runRegression('test-recruitment-candidate-resume.mjs');
runRegression('test-recruitment-vacancy-stages.mjs');
runRegression('test-recruitment-candidate-nav.mjs');

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment candidates 1D.1 tests OK.\n');

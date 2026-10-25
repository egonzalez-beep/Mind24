/**
 * Recruitment 1B.4 — targetCoverageDate + documentos de vacante.
 * node server/scripts/test-recruitment-vacancy-documents.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'recruitment-doc-test-secret';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
const migrationSql = fs.readFileSync(
  path.join(rootDir, 'prisma/migrations/20261020140000_recruitment_vacancy_target_docs/migration.sql'),
  'utf8',
);
const recruitmentRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const docServiceSrc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentVacancyDocument.service.js'),
  'utf8',
);
const vacancySvc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentVacancy.service.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');

const {
  sniffRecruitmentVacancyDocumentExt,
  isAllowedRecruitmentVacancyDocumentFile,
  RECRUITMENT_VACANCY_DOCUMENT_MAX_BYTES,
} = await import('../src/services/recruitmentVacancyDocument.service.js');
const { parseTargetCoverageDate } = await import('../src/services/recruitmentVacancy.service.js');
const { prisma } = await import('../src/db/client.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/services/auth.service.js');

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

async function uploadFetch(base, urlPath, { cookie, fields, fileName, buffer, mime }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    fd.append(k, v);
  }
  fd.append('file', new Blob([buffer], { type: mime }), fileName);
  const res = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    body: fd,
    headers: cookie ? { Cookie: cookie } : {},
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

console.log('\n=== Recruitment 1B.4 — estático ===\n');

check(/targetCoverageDate/.test(schema), 'schema targetCoverageDate');
check(/model RecruitmentVacancyDocument/.test(schema), 'modelo RecruitmentVacancyDocument');
check(/enum RecruitmentVacancyDocumentCategory/.test(schema), 'enum categorías documento');
check(/targetCoverageDate/.test(migrationSql), 'migración targetCoverageDate');
check(/RecruitmentVacancyDocument/.test(migrationSql), 'migración tabla documentos');
check(/parseTargetCoverageDate/.test(vacancySvc), 'parseTargetCoverageDate en servicio vacante');
check(/recruitment-vacancies/.test(docServiceSrc), 'subdir recruitment-vacancies');
check(/\/vacancies\/:vacancyId\/documents/.test(recruitmentRoutes), 'GET/POST documents');
check(/\/vacancy-documents\/:documentId\/file/.test(recruitmentRoutes), 'GET file autenticado');
check(!/filePath/.test(docServiceSrc.match(/sanitizeRecruitmentVacancyDocumentForAdmin[\s\S]*?}/)?.[0] || ''), 'sin filePath al cliente');
check(/rec-form-target-coverage/.test(indexHtml), 'formulario fecha objetivo');
check(/rec-detail-target-coverage/.test(indexHtml), 'detalle fecha objetivo');
check(/rec-vac-docs-list/.test(indexHtml), 'UI archivos en detalle');
check(/Podrás agregar archivos después/.test(indexHtml), 'hint alta vacante');
check(/rec-modal-glass/.test(indexHtml), 'glass scoped recruitment');
check(!/rec-ws-pulse/.test(indexHtml.match(/id="rec-selected-panel"[\s\S]*?rec-pipeline-slot/)?.[0] || ''), 'workspace sin KPIs');
check(/rec-pipeline-header/.test(indexHtml) && /recUpdatePipelineHeader/.test(indexHtml), 'header pipeline compacto');

console.log('\n=== Recruitment 1B.4 — validación archivos ===\n');

const miniPdf = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'ascii');
check(sniffRecruitmentVacancyDocumentExt(miniPdf, null, 'x.pdf') === '.pdf', 'sniff PDF');
check(isAllowedRecruitmentVacancyDocumentFile('application/pdf', 'a.pdf'), 'MIME PDF permitido');
check(!sniffRecruitmentVacancyDocumentExt(Buffer.from('not a file'), 'application/pdf', 'bad.pdf'), 'rechazo contenido inválido');

const zipHead = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
check(
  sniffRecruitmentVacancyDocumentExt(
    zipHead,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc.docx',
  ) === '.docx',
  'docx ZIP permitido',
);

const parsed = parseTargetCoverageDate('2026-11-15');
check(parsed instanceof Date && parsed.getUTCFullYear() === 2026 && parsed.getUTCMonth() === 10, 'timezone UTC date');
check(parseTargetCoverageDate(null) === null, 'targetCoverageDate nullable');
check(parseTargetCoverageDate('') === null, 'targetCoverageDate vacío → null');

console.log('\n=== Recruitment 1B.4 — integración (DB) ===\n');

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP integration:', e.message);
}

async function cleanupOrg(orgIds) {
  await prisma.recruitmentVacancyDocument.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.recruitmentApplicationStageEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.recruitmentApplication.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.recruitmentVacancyAssignee.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.recruitmentVacancy.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.recruitmentCandidate.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.recruitmentStage.deleteMany({ where: { organizationId: { in: orgIds } } });
}

if (dbOk) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const orgA = await prisma.organization.create({
    data: { name: `Rec Doc A ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const orgB = await prisma.organization.create({
    data: { name: `Rec Doc B ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const adminPass = 'TestAdmin1!';
  const adminA = await prisma.user.create({
    data: {
      email: `rec-doc-a-${suffix}@example.com`,
      passwordHash: await hashPassword(adminPass),
      fullName: 'Admin Doc A',
      role: 'empresa_admin',
      organizationId: orgA.id,
    },
  });
  const adminB = await prisma.user.create({
    data: {
      email: `rec-doc-b-${suffix}@example.com`,
      passwordHash: await hashPassword(adminPass),
      fullName: 'Admin Doc B',
      role: 'empresa_admin',
      organizationId: orgB.id,
    },
  });

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const loginA = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { email: adminA.email, password: adminPass },
    });
    const cookieA = cookieHeaderFromResponse(loginA.res, 'mind24.sid');
    const loginB = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { email: adminB.email, password: adminPass },
    });
    const cookieB = cookieHeaderFromResponse(loginB.res, 'mind24.sid');

    const createVac = await jsonFetch(base, '/api/org/recruitment/vacancies', {
      method: 'POST',
      cookie: cookieA,
      body: {
        title: 'Vacante docs',
        clientName: 'Cliente',
        positionsTotal: 1,
        targetCoverageDate: '2026-11-15',
      },
    });
    check(createVac.res.status === 201, 'crear vacante con fecha objetivo');
    check(createVac.data.vacancy?.targetCoverageDate === '2026-11-15', 'serializa targetCoverageDate');
    const vacancyId = createVac.data.vacancy?.id;

    const clearDate = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}`, {
      method: 'PATCH',
      cookie: cookieA,
      body: { targetCoverageDate: null },
    });
    check(clearDate.data.vacancy?.targetCoverageDate == null, 'editar fecha objetivo a null');

    const listEmpty = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/documents`, {
      cookie: cookieA,
    });
    check(listEmpty.res.status === 200 && listEmpty.data.documents?.length === 0, 'listar documentos vacío');

    const upload = await uploadFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/documents`, {
      cookie: cookieA,
      fields: { displayName: 'Perfil prueba', category: 'PROFILE' },
      fileName: 'perfil.pdf',
      buffer: miniPdf,
      mime: 'application/pdf',
    });
    check(upload.res.status === 201 && upload.data.document?.id, 'subir PDF');
    check(!upload.data.document?.filePath, 'respuesta sin filePath');
    const docId = upload.data.document.id;

    const listOne = await jsonFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/documents`, {
      cookie: cookieA,
    });
    check(listOne.data.documents?.length === 1, 'listar un documento');

    const fileRes = await fetch(`${base}/api/org/recruitment/vacancy-documents/${docId}/file`, {
      headers: { Cookie: cookieA },
    });
    check(fileRes.status === 200, 'visualizar archivo autenticado');
    check(fileRes.headers.get('x-content-type-options') === 'nosniff', 'nosniff');
    check((fileRes.headers.get('cache-control') || '').includes('private'), 'cache private');

    const crossFile = await fetch(`${base}/api/org/recruitment/vacancy-documents/${docId}/file`, {
      headers: { Cookie: cookieB },
    });
    check(crossFile.status === 404, 'multi-org file bloqueado');

    const big = Buffer.alloc(RECRUITMENT_VACANCY_DOCUMENT_MAX_BYTES + 1, 0);
    big.write('%PDF', 0);
    const tooBig = await uploadFetch(base, `/api/org/recruitment/vacancies/${vacancyId}/documents`, {
      cookie: cookieA,
      fields: { displayName: 'Grande', category: 'OTHER' },
      fileName: 'big.pdf',
      buffer: big,
      mime: 'application/pdf',
    });
    check(tooBig.res.status === 400 || tooBig.res.status === 413, 'rechazo >10 MB');

    const del = await jsonFetch(base, `/api/org/recruitment/vacancy-documents/${docId}`, {
      method: 'DELETE',
      cookie: cookieA,
    });
    check(del.res.status === 200, 'eliminar documento');
  } finally {
    server.close();
    await cleanupOrg([orgA.id, orgB.id]);
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

runRegression('test-recruitment-backend.mjs');
runRegression('test-recruitment-vacancies-frontend.mjs');

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment vacancy documents tests OK.\n');

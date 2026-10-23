/**
 * Recruitment 1D.1 — CV privado del candidato.
 * node server/scripts/test-recruitment-candidate-resume.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-resume-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const routes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const resumeSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentCandidateResume.service.js'),
  'utf8',
);

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

const MIN_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrail\n%%EOF\n');

console.log('\n=== Recruitment 1D.1 — estático CV ===\n');

check(/\/candidates\/:candidateId\/resume/.test(routes), 'rutas resume');
check(/assertSafeRecruitmentCandidateResumePath/.test(resumeSvc), 'anti path traversal');
check(!/filePath/.test(resumeSvc.match(/sanitizeRecruitmentCandidateResumeForAdmin[\s\S]*?^\}/m)?.[0] || ''), 'metadata sin filePath');
check(/X-Content-Type-Options/.test(resumeSvc), 'nosniff en stream');

console.log('\n=== Recruitment 1D.1 — integración CV (DB) ===\n');

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP integration:', e.message);
}

async function cleanupOrg(orgId) {
  await prisma.recruitmentCandidateResume.deleteMany({ where: { organizationId: orgId } });
  await prisma.recruitmentCandidate.deleteMany({ where: { organizationId: orgId } });
}

if (dbOk) {
  try {
    await prisma.$executeRawUnsafe(
      fs.readFileSync(
        path.join(rootDir, 'prisma/migrations/20261020200000_recruitment_candidate_resume/migration.sql'),
        'utf8',
      ),
    );
  } catch {
    /* ya aplicada */
  }

  const suffix = crypto.randomBytes(4).toString('hex');
  const org = await prisma.organization.create({
    data: { name: `Resume ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const pass = 'TestAdmin1!';
  const admin = await prisma.user.create({
    data: {
      email: `resume-${suffix}@example.com`,
      passwordHash: await hashPassword(pass),
      fullName: 'Admin',
      role: 'empresa_admin',
      organizationId: org.id,
    },
  });
  const candidate = await prisma.recruitmentCandidate.create({
    data: {
      organizationId: org.id,
      fullName: 'CV Test',
      profile: 'Perfil',
      phone: '5599990001',
    },
  });

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await jsonFetch(base, '/api/auth/login', {
      method: 'POST',
      body: { email: admin.email, password: pass },
    });
    const cookie = cookieHeaderFromResponse(login.res, 'mind24.sid');

    const fd = new FormData();
    fd.append('file', new Blob([MIN_PDF], { type: 'application/pdf' }), 'cv-test.pdf');
    const up1 = await fetch(
      `${base}/api/org/recruitment/candidates/${candidate.id}/resume`,
      { method: 'POST', body: fd, credentials: 'include', headers: { Cookie: cookie } },
    );
    const up1Json = await up1.json();
    check(up1.status === 201 && up1Json.resume?.originalFileName, 'upload CV');
    check(!('filePath' in (up1Json.resume || {})), 'POST response sin filePath');

    const meta = await jsonFetch(
      base,
      `/api/org/recruitment/candidates/${candidate.id}/resume`,
      { cookie },
    );
    check(meta.data.resume?.mimeType === 'application/pdf', 'GET metadata');

    const fileRes = await fetch(
      `${base}/api/org/recruitment/candidates/${candidate.id}/resume/file`,
      { headers: { Cookie: cookie } },
    );
    check(fileRes.status === 200, 'stream file');
    check(fileRes.headers.get('x-content-type-options') === 'nosniff', 'header nosniff');
    check(fileRes.headers.get('cache-control')?.includes('private'), 'cache private');

    const fd2 = new FormData();
    fd2.append('file', new Blob([MIN_PDF], { type: 'application/pdf' }), 'cv-v2.pdf');
    const up2 = await fetch(
      `${base}/api/org/recruitment/candidates/${candidate.id}/resume`,
      { method: 'POST', body: fd2, credentials: 'include', headers: { Cookie: cookie } },
    );
    check(up2.status === 201, 'reemplazar CV');
    const count = await prisma.recruitmentCandidateResume.count({
      where: { candidateId: candidate.id },
    });
    check(count === 1, 'un solo registro CV');

    const bad = new FormData();
    bad.append('file', new Blob([Buffer.from('not-a-real-file')]), 'evil.exe');
    const badRes = await fetch(
      `${base}/api/org/recruitment/candidates/${candidate.id}/resume`,
      { method: 'POST', body: bad, credentials: 'include', headers: { Cookie: cookie } },
    );
    check(badRes.status === 400, 'formato inválido');

    const del = await jsonFetch(
      base,
      `/api/org/recruitment/candidates/${candidate.id}/resume`,
      { method: 'DELETE', cookie },
    );
    check(del.res.status === 200, 'delete CV');
  } finally {
    server.close();
    await cleanupOrg(org.id);
    await prisma.user.delete({ where: { id: admin.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
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

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment candidate resume 1D.1 tests OK.\n');

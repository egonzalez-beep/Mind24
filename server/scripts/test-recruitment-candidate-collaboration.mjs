/**
 * Recruitment — observaciones colaborativas + etiquetas.
 * node server/scripts/test-recruitment-candidate-collaboration.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-collab-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
const migrationSql = fs.readFileSync(
  path.join(rootDir, 'prisma/migrations/20261025143000_recruitment_candidate_notes_tags/migration.sql'),
  'utf8',
);
const routes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const noteSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentCandidateNote.service.js'),
  'utf8',
);
const tagSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentCandidateTag.service.js'),
  'utf8',
);
const candidateSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentCandidate.service.js'),
  'utf8',
);
const indexHtml = fs.readFileSync(path.join(rootDir, '../index.html'), 'utf8');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

console.log('\n=== Recruitment 1J — colaboración (estático) ===\n');

check(/model RecruitmentCandidateNote/.test(schema), 'modelo RecruitmentCandidateNote');
check(/model RecruitmentCandidateTag/.test(schema), 'modelo RecruitmentCandidateTag');
check(/model RecruitmentCandidateTagAssignment/.test(schema), 'modelo tag assignment');
check(/legacyImport/.test(schema) && /legacy_note_/.test(migrationSql), 'backfill notes legacy');
check(/softDeleteRecruitmentCandidateNote/.test(noteSvc), 'soft delete notas');
check(/editedAt/.test(noteSvc), 'editedAt en update');
check(/ensureLegacyCandidateNoteImported/.test(noteSvc), 'import legacy on read');
check(/authorWorkforceEmployeeId/.test(schema), 'schema authorWorkforceEmployeeId en nota');
check(/resolveRecruitmentCandidateNoteAuthorName/.test(noteSvc), 'resolver autor nota');
check(/authorWorkforceEmployee/.test(noteSvc), 'include autor workforce');
check(!/authorLabel = 'Sistema'/.test(noteSvc), 'sin etiqueta Sistema genérica');
check(/RECRUITMENT_CANDIDATE_TAG_COLOR_KEYS/.test(tagSvc), 'paleta colorKey');
check(/ensureDefaultRecruitmentCandidateTags/.test(tagSvc), 'catálogo inicial tags');
check(/buildTagPreviewsByCandidateId/.test(tagSvc), 'preview tags listado');
check(/tagAssignments/.test(candidateSvc) && /tagId/.test(candidateSvc), 'filtro tag en listado');
check(/\/candidate-tags/.test(routes), 'GET candidate-tags');
check(/\/candidates\/:candidateId\/notes/.test(routes), 'routes notas');
check(/\/candidates\/:candidateId\/tags/.test(routes), 'routes tags');
check(/rec-cand-observations-card/.test(indexHtml), 'UI card observaciones');
check(/recCandLoadDetailNotes/.test(indexHtml), 'carga observaciones');
check(/rec-cand-detail-tags/.test(indexHtml) && /rec-cand-tag--/.test(indexHtml), 'UI tags');
check(/id="rec-cand-tag"/.test(indexHtml), 'filtro etiqueta cartera');
check(/recCandRowTagsHtml/.test(indexHtml), 'tags en fila cartera');
check(!/Observaciones clave/.test(indexHtml.match(/rec-cand-body-main[\s\S]*?rec-cand-body-aside/)?.[0] || ''), 'sin observaciones legacy en main');
check(/recCandApiCandidateCreateBody/.test(indexHtml), 'alta con nota vía create body');
check(/rec-cand-form-notes-section/.test(indexHtml), 'notas solo en alta');
check(/\.omit\(\{\s*notes:\s*true\s*\}/.test(routes), 'PATCH omite notes legacy');
check(/createRecruitmentCandidateNote/.test(routes.match(/router\.post\('\/candidates'[\s\S]*?router\.get\('\/candidates\/:candidateId\/notes'/)?.[0] || ''), 'POST candidato crea note');
check(!/patch\.notes/.test(candidateSvc), 'update no escribe notes legacy');
check(!/notes:\s*trimOrNull\(prepared\.notes\)/.test(candidateSvc), 'create no escribe notes legacy');
const tagPickerFn = indexHtml.match(/function recCandOpenTagPicker[\s\S]*?^async function /m)?.[0] || '';
check(/rec-cand-tag-picker/.test(tagPickerFn) && !/window\.prompt/.test(tagPickerFn), 'picker tags sin prompt');
check(/recCandAssignTagFromPicker/.test(indexHtml), 'asignar tag desde picker');

console.log('\n=== Integración (DB) ===\n');

let dbOk = false;
try {
  const { prisma } = await import('../src/db/client.js');
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP integration:', e.message?.split('\n')[0] || e);
}

if (dbOk) {
  const { prisma } = await import('../src/db/client.js');
  const { createApp } = await import('../src/app.js');
  const { hashPassword } = await import('../src/services/auth.service.js');
  const { ensureDefaultRecruitmentCandidateTags } = await import(
    '../src/services/recruitmentCandidateTag.service.js',
  );

  const org = await prisma.organization.create({ data: { name: 'Collab Test Org' } });
  const passwordHash = await hashPassword('test-pass-123');
  const user = await prisma.user.create({
    data: {
      email: `rec-collab-${Date.now()}@test.local`,
      passwordHash,
      fullName: 'Collab Tester',
      role: 'EMPRESA_ADMIN',
      organizationId: org.id,
    },
  });
  const cand = await prisma.recruitmentCandidate.create({
    data: {
      organizationId: org.id,
      fullName: 'Tag Note Cand',
      profile: 'Ventas',
      phone: '5511111111',
      whatsapp: '5511111111',
      notes: 'Nota legacy integración',
    },
  });

  await ensureDefaultRecruitmentCandidateTags(org.id);
  const tags = await prisma.recruitmentCandidateTag.findMany({ where: { organizationId: org.id } });
  check(tags.length >= 10, 'seed tags por org');

  const app = createApp();
  const loginRes = await app.fetch('http://local/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: 'test-pass-123' }),
  });
  const cookie = loginRes.headers.get('set-cookie') || '';
  const hdr = { Cookie: cookie, 'Content-Type': 'application/json' };

  const notesList = await app.fetch(
    `http://local/api/org/recruitment/candidates/${cand.id}/notes`,
    { headers: hdr },
  );
  const notesJson = await notesList.json();
  check(notesList.status === 200 && notesJson.notes?.some((n) => n.legacyImport), 'legacy note en GET');

  const postNote = await app.fetch(
    `http://local/api/org/recruitment/candidates/${cand.id}/notes`,
    { method: 'POST', headers: hdr, body: JSON.stringify({ body: 'Segunda observación' }) },
  );
  const postJson = await postNote.json();
  check(postNote.status === 201 && postJson.note?.authorName, 'POST note con autor');

  const patchNote = await app.fetch(
    `http://local/api/org/recruitment/candidates/${cand.id}/notes/${postJson.note.id}`,
    { method: 'PATCH', headers: hdr, body: JSON.stringify({ body: 'Editada colab' }) },
  );
  const patchJson = await patchNote.json();
  check(patchNote.status === 200 && patchJson.note?.editedAt, 'PATCH editedAt');

  const tag = tags.find((t) => t.name === 'Sueldo alto') || tags[0];
  const assign = await app.fetch(
    `http://local/api/org/recruitment/candidates/${cand.id}/tags`,
    { method: 'POST', headers: hdr, body: JSON.stringify({ tagId: tag.id }) },
  );
  check(assign.status === 201, 'asignar tag');

  const assignDup = await app.fetch(
    `http://local/api/org/recruitment/candidates/${cand.id}/tags`,
    { method: 'POST', headers: hdr, body: JSON.stringify({ tagId: tag.id }) },
  );
  check(assignDup.status === 201, 'asignar tag duplicado idempotente');

  const listArchived = await app.fetch(
    `http://local/api/org/recruitment/candidates?archivedOnly=true&profile=Ventas&tagId=${tag.id}`,
    { headers: hdr },
  );
  check(listArchived.status === 200, 'list con tagId query');

  await prisma.organization.delete({ where: { id: org.id } });
}

console.log('\n=== Regresiones ===\n');
for (const script of [
  'test-recruitment-candidates.mjs',
  'test-recruitment-vacancies-frontend.mjs',
  'test-recruitment-kanban.mjs',
]) {
  const r = spawnSync('node', [path.join(rootDir, 'scripts', script)], {
    cwd: rootDir,
    encoding: 'utf8',
    env: process.env,
  });
  check(r.status === 0, script);
}

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment candidate collaboration tests OK.\n');

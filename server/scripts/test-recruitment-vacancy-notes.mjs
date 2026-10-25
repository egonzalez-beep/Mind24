/**
 * Recruitment — notas colaborativas de vacante (ficha técnica).
 * node server/scripts/test-recruitment-vacancy-notes.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
const migrationSql = fs.readFileSync(
  path.join(rootDir, 'prisma/migrations/20261025160000_recruitment_vacancy_notes/migration.sql'),
  'utf8',
);
const routes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const noteSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentVacancyNote.service.js'),
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

console.log('\n=== Recruitment — notas vacante (estático) ===\n');

check(/model RecruitmentVacancyNote/.test(schema), 'modelo RecruitmentVacancyNote');
check(/legacy_vac_note_/.test(migrationSql), 'backfill notes legacy vacante');
check(/ensureLegacyVacancyNoteImported/.test(noteSvc), 'import legacy on read');
check(/\/vacancies\/:vacancyId\/notes/.test(routes), 'routes notas vacante');
check(/rec-detail-notes-host/.test(indexHtml), 'host notas en ficha vacante');
check(/recVacLoadDetailNotes/.test(indexHtml), 'carga notas vacante');
check(/recVacSubmitNewNote/.test(indexHtml), 'añadir nota vacante');
check(!/id="rec-form-notes"/.test(indexHtml), 'sin textarea notas en form vacante');
check(/recOpenVacancyModal[\s\S]*?mode==='edit'[\s\S]*?subEl\.classList\.add\('hidden'\)/.test(indexHtml), 'sin subtítulo en editar vacante');

console.log(failed ? `\n${failed} fallo(s)\n` : '\nTodo OK\n');
process.exit(failed ? 1 : 0);

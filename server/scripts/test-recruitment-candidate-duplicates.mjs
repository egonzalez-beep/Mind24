/**
 * Prevención de candidatos duplicados — unitario sin PostgreSQL.
 * node server/scripts/test-recruitment-candidate-duplicates.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(rootDir, '..');
dotenv.config({ path: path.join(rootDir, '.env') });
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-dup-unit-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const {
  comparableRecruitmentContactPhone,
  normalizeRecruitmentCandidatePhoneDigits,
} = await import('../src/services/recruitmentCandidateCatalog.service.js');
const {
  assertNoStrongRecruitmentDuplicates,
  findPotentialDuplicateRecruitmentCandidates,
  serializeRecruitmentDuplicateMatch,
} = await import('../src/services/recruitmentCandidate.service.js');
const { workforceCandidateCreateSchema } = await import(
  '../src/services/workforceRecruitmentPortal.service.js'
);

/** Réplica mínima del contrato allowDuplicate del create (sin cargar rutas Express). */
const allowDuplicateField = z.union([z.literal(true), z.literal(false)]).optional();
const candidateCreateAllowSchema = z
  .object({
    fullName: z.string().min(1),
    profile: z.string().min(1),
    whatsapp: z.string().min(5),
    allowDuplicate: allowDuplicateField,
  })
  .passthrough();

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

console.log('\n=== Normalización canónica ===\n');

const expected = '4421234567';
const samples = [
  '4421234567',
  '442 123 4567',
  '+52 442 123 4567',
  '+52 1 442 123 4567',
  '(442) 123-4567',
];
for (const s of samples) {
  check(comparableRecruitmentContactPhone(s) === expected, `comparable(${JSON.stringify(s)}) → ${expected}`);
}
check(comparableRecruitmentContactPhone('') == null, 'vacío → null');
check(comparableRecruitmentContactPhone(null) == null, 'null → null');
check(comparableRecruitmentContactPhone('   ') == null, 'blancos → null');
check(comparableRecruitmentContactPhone('1234567') == null, '7 dígitos → null');
check(comparableRecruitmentContactPhone('12345678') == null, '8 dígitos → null');
check(comparableRecruitmentContactPhone('442123456') == null, '9 dígitos → null');
check(comparableRecruitmentContactPhone('4421234567 ext 99') === expected, 'extensión marcada ignorada');
check(comparableRecruitmentContactPhone('4421234567x12') === expected, 'sufijo xN ignorado');
check(comparableRecruitmentContactPhone('442123456799') == null, 'dígitos sobrantes sin marcador → null');
check(comparableRecruitmentContactPhone('0444421234567') === expected, 'trunk 0 → últimos 10');
check(
  normalizeRecruitmentCandidatePhoneDigits('+52 1 442 123 4567') === expected,
  'alias delega a comparable (sin lógica defectuosa)',
);
check(
  comparableRecruitmentContactPhone('5511223344') ===
    comparableRecruitmentContactPhone('+521 55 1122 3344'),
  'teléfono y WhatsApp misma función',
);

console.log('\n=== Serialización 409 / matches ===\n');

const serialized = serializeRecruitmentDuplicateMatch(
  {
    id: 'cand-1',
    fullName: '<b>Ana</b>',
    profile: 'Ventas',
    phone: '+52 442 123 4567',
    whatsapp: null,
    email: 'Ana.Test@Example.COM',
    curp: 'GOSE900101HQRTMN09',
    archivedAt: new Date('2024-01-02T00:00:00Z'),
    createdAt: new Date('2024-01-01T00:00:00Z'),
    registeredByWorkforceEmployee: { fullName: 'Colaborador X' },
  },
  { vacancyTitle: 'Operador', stageName: 'Nuevo', stageKey: 'NEW', listPreviewKind: 'active' },
);
check(serialized.id === 'cand-1', 'match expone id utilizable');
check(serialized.phoneMasked === '••• ••• 4567', 'teléfono enmascarado');
check(serialized.emailMasked === 'an•••@example.com', 'correo enmascarado');
check(serialized.archived === true, 'indicador archivado');
check(!Object.prototype.hasOwnProperty.call(serialized, 'curp'), 'sin CURP completa');
check(!Object.prototype.hasOwnProperty.call(serialized, 'phone'), 'sin teléfono en claro');
check(!Object.prototype.hasOwnProperty.call(serialized, 'email'), 'sin correo en claro');
check(serialized.registeredByName === 'Colaborador X', 'registrado por');
check(serialized.primaryProcess?.vacancyTitle === 'Operador', 'proceso principal');

try {
  assertNoStrongRecruitmentDuplicates([serialized]);
  check(false, 'assert lanza con matches');
} catch (e) {
  check(e.code === 'CANDIDATE_DUPLICATE' && Array.isArray(e.matches), 'assert → CANDIDATE_DUPLICATE');
}
try {
  assertNoStrongRecruitmentDuplicates([]);
  check(true, 'assert sin matches no lanza');
} catch {
  check(false, 'assert sin matches no lanza');
}

const errMw = fs.readFileSync(path.join(rootDir, 'src/middleware/error.middleware.js'), 'utf8');
check(/CANDIDATE_DUPLICATE:\s*409/.test(errMw), 'middleware mapea 409');
check(
  /if \(err\.code === 'CANDIDATE_DUPLICATE'\)/.test(errMw) &&
    /error: 'CANDIDATE_DUPLICATE'/.test(errMw),
  'solo CANDIDATE_DUPLICATE usa ese contrato',
);
check(/P2002[\s\S]*error: 'CONFLICT'/.test(errMw), 'otros conflictos P2002 intactos');

console.log('\n=== allowDuplicate estricto (Zod) ===\n');

const baseBody = {
  fullName: 'Ana López',
  profile: 'Ventas',
  whatsapp: '4421234567',
};
function allowParse(schema, extra) {
  try {
    return { ok: true, data: schema.parse({ ...baseBody, ...extra }) };
  } catch (e) {
    return { ok: false, error: e };
  }
}
check(allowParse(candidateCreateAllowSchema, {}).ok, 'create sin allowDuplicate parsea');
check(allowParse(candidateCreateAllowSchema, { allowDuplicate: true }).data.allowDuplicate === true, 'true literal OK');
check(allowParse(candidateCreateAllowSchema, { allowDuplicate: false }).ok, 'false literal parsea');
check(!allowParse(candidateCreateAllowSchema, { allowDuplicate: 'true' }).ok, 'string "true" rechazado');
check(!allowParse(candidateCreateAllowSchema, { allowDuplicate: 1 }).ok, '1 rechazado');
check(!allowParse(candidateCreateAllowSchema, { allowDuplicate: {} }).ok, 'objeto rechazado');
check(allowParse(workforceCandidateCreateSchema, { allowDuplicate: true }).ok, 'portal true OK');
check(!allowParse(workforceCandidateCreateSchema, { allowDuplicate: 'true' }).ok, 'portal string rechazado');

const createSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentCandidateCreate.service.js'),
  'utf8',
);
const candidateSvcSrc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentCandidate.service.js'),
  'utf8',
);
const updateFn = candidateSvcSrc.slice(
  candidateSvcSrc.indexOf('export async function updateRecruitmentCandidate'),
  candidateSvcSrc.indexOf('export async function updateRecruitmentCandidate') + 3500,
);
check(/allowDuplicate !== true/.test(createSvc), 'create solo autoriza === true');
check(!/patch\.allowDuplicate/.test(updateFn), 'update sin bypass allowDuplicate');
check(/excludeCandidateId: candidateId/.test(updateFn), 'PATCH excluye propio candidateId');

console.log('\n=== findPotential con doble Prisma (sin PG) ===\n');

const now = new Date('2025-06-01T12:00:00Z');
const rows = [
  {
    id: 'a1',
    organizationId: 'org-a',
    fullName: 'Ana Uno',
    profile: 'Ventas',
    phone: '442 123 4567',
    whatsapp: '442 123 4567',
    email: 'ana@example.com',
    curp: 'GOSE900101HQRTMN09',
    archivedAt: new Date('2025-01-01T00:00:00Z'),
    createdAt: now,
    updatedAt: now,
    registeredByWorkforceEmployee: { fullName: 'Reco' },
  },
  {
    id: 'a2',
    organizationId: 'org-a',
    fullName: 'Ana Dos',
    profile: 'Ventas',
    phone: '5511223344',
    whatsapp: '5511223344',
    email: 'otra@example.com',
    curp: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    registeredByWorkforceEmployee: null,
  },
  {
    id: 'a3',
    organizationId: 'org-a',
    fullName: 'Terminal',
    profile: 'Logística / Almacén',
    phone: '4439988776',
    whatsapp: '4439988776',
    email: 'term@example.com',
    curp: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    registeredByWorkforceEmployee: null,
  },
  {
    id: 'b1',
    organizationId: 'org-b',
    fullName: 'Bruno',
    profile: 'Ventas',
    phone: '4421234567',
    whatsapp: '4421234567',
    email: 'ana@example.com',
    curp: 'GOSE900101HQRTMN09',
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    registeredByWorkforceEmployee: null,
  },
];

function emailEquals(stored, wanted) {
  return String(stored || '').toLowerCase() === String(wanted || '').toLowerCase();
}

function createMockDb(store) {
  return {
    recruitmentCandidate: {
      async findMany({ where }) {
        let list = store.filter((r) => r.organizationId === where.organizationId);
        if (where.id?.not) list = list.filter((r) => r.id !== where.id.not);
        if (where.email?.equals) {
          list = list.filter((r) => emailEquals(r.email, where.email.equals));
        }
        if (where.curp?.equals) {
          list = list.filter(
            (r) =>
              String(r.curp || '')
                .replace(/\s+/g, '')
                .toUpperCase() ===
              String(where.curp.equals)
                .replace(/\s+/g, '')
                .toUpperCase(),
          );
        }
        return list.map((r) => ({ ...r }));
      },
    },
  };
}

const mockDb = createMockDb(rows);

const sameNameDiffContact = await findPotentialDuplicateRecruitmentCandidates(
  'org-a',
  { phone: '5599001122', email: 'nombre-distinto@example.com' },
  { db: mockDb, skipProcessPreview: true },
);
check(sameNameDiffContact.length === 0, '1 mismo nombre no aplica: contacto distinto sin alerta');

const archivedHit = await findPotentialDuplicateRecruitmentCandidates(
  'org-a',
  { whatsapp: '+52 442 123 4567' },
  { db: mockDb, skipProcessPreview: true },
);
check(
  archivedHit.some((m) => m.id === 'a1' && m.archived === true),
  '2 archivado detectado',
);

const terminalPhone = await findPotentialDuplicateRecruitmentCandidates(
  'org-a',
  { phone: '4439988776' },
  { db: mockDb, skipProcessPreview: true },
);
check(terminalPhone.some((m) => m.id === 'a3'), '3 terminal/contacto detectado (ficha incluida)');

const otherOrg = await findPotentialDuplicateRecruitmentCandidates(
  'org-a',
  { phone: '4421234567', email: 'ana@example.com', curp: 'gose900101hqrtmn09' },
  { db: mockDb, skipProcessPreview: true },
);
check(
  otherOrg.every((m) => m.id !== 'b1') && otherOrg.some((m) => m.id === 'a1'),
  '4 otra organización invisible',
);

const deduped = await findPotentialDuplicateRecruitmentCandidates(
  'org-a',
  { phone: '4421234567', email: 'ANA@example.com', curp: 'GOSE900101HQRTMN09' },
  { db: mockDb, skipProcessPreview: true },
);
check(deduped.filter((m) => m.id === 'a1').length === 1, 'dedupe por candidateId');

const selfExcluded = await findPotentialDuplicateRecruitmentCandidates(
  'org-a',
  { phone: '4421234567' },
  { excludeCandidateId: 'a1', db: mockDb, skipProcessPreview: true },
);
check(!selfExcluded.some((m) => m.id === 'a1'), '7 PATCH excluye el propio id');

const otherHit = await findPotentialDuplicateRecruitmentCandidates(
  'org-a',
  { phone: '5511223344' },
  { excludeCandidateId: 'a1', db: mockDb, skipProcessPreview: true },
);
check(otherHit.some((m) => m.id === 'a2'), '8 PATCH detecta otra ficha');

check(
  !Object.keys(serialized).includes('curp') &&
    archivedHit.every((m) => !Object.prototype.hasOwnProperty.call(m, 'curp')),
  'matches sin CURP',
);

console.log('\n=== allowDuplicate create gate (puro) ===\n');

function gateAllowDuplicate(allowDuplicate, matches) {
  if (allowDuplicate !== true) {
    assertNoStrongRecruitmentDuplicates(matches, { curpConflict: matches.curpConflict === true });
  }
}
try {
  gateAllowDuplicate(undefined, archivedHit);
  check(false, '5 ausente bloquea');
} catch (e) {
  check(e.code === 'CANDIDATE_DUPLICATE', '5 ausente bloquea');
}
try {
  gateAllowDuplicate(false, archivedHit);
  check(false, '5 false bloquea');
} catch (e) {
  check(e.code === 'CANDIDATE_DUPLICATE', '5 false bloquea');
}
try {
  gateAllowDuplicate('true', archivedHit);
  check(false, '5 string bloquea');
} catch (e) {
  check(e.code === 'CANDIDATE_DUPLICATE', '5 string bloquea');
}
try {
  gateAllowDuplicate(true, archivedHit);
  check(true, '6 true permite');
} catch {
  check(false, '6 true permite');
}

console.log('\n=== UI: usar existente / 409 / doble clic (HTML real) ===\n');

const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'));
check(publicHtml.equals(fs.readFileSync(path.join(repoRoot, 'index.html'))), 'HTML espejo idéntico');

const useFn = indexHtml.slice(
  indexHtml.indexOf('async function recCandDupeUseExisting'),
  indexHtml.indexOf('async function recCandDupeCreateAnyway'),
);
check(/recCandAssignToVacancy\(candidateId/.test(useFn), '10 usar existente → application con candidateId');
check(!/\/candidates['"]/.test(useFn), '9 usar existente no crea candidato');
check(/if\(vacId\)/.test(useFn) && /recCandOpenDetail|tcEmpQuickGoCandidates/.test(useFn), 'con/sin vacante abre expediente');

const showFromErr = indexHtml.slice(
  indexHtml.indexOf('function recCandShowDuplicateFromError'),
  indexHtml.indexOf('async function recCandSubmitForm'),
);
check(/e\.matches/.test(showFromErr) && /recCandShowDupeModal/.test(showFromErr), '11 409 abre modal con matches');
check(/candDupePendingBody=body/.test(showFromErr), '11 conserva captura pendiente');

check(/dataset\.recBusy==='1'\) return/.test(useFn), '12 doble clic usar existente bloqueado');
const proceedFn = indexHtml.slice(
  indexHtml.indexOf('async function recCandDupeCreateAnyway'),
  indexHtml.indexOf('async function recCandCreateAndOpen'),
);
check(/dataset\.recBusy==='1'\) return/.test(proceedFn), '12 doble clic persona distinta bloqueado');
check(/candDupeConfirmDistinct/.test(proceedFn), 'persona distinta exige confirmación');
check(/allowDuplicate=true/.test(proceedFn), 'envía allowDuplicate true');
check(/intent==='edit'/.test(proceedFn) && !/recCandPatchExisting/.test(proceedFn), 'edición sin bypass PATCH');

check(/tcEsc\(c\.fullName/.test(indexHtml), 'HTML escapado en matches');
check(/phoneMasked\|\|c\.phone/.test(indexHtml) || /phoneMasked/.test(indexHtml), 'UI usa máscaras');

const dupeSelect = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentCandidate.service.js'),
  'utf8',
);
const selectBlock = dupeSelect.slice(
  dupeSelect.indexOf('const DUPLICATE_MATCH_SELECT'),
  dupeSelect.indexOf('serializeRecruitmentDuplicateMatch'),
);
check(/phone:\s*true/.test(selectBlock) && /whatsapp:\s*true/.test(selectBlock), 'select incluye phone/whatsapp');
check(!/applications|notes|documents|resume|events/i.test(selectBlock), 'select sin apps/notas/docs/eventos');
check(!/profilePhotoPath/.test(selectBlock), 'relación registrada por mínima (sin foto)');
const scalarCols = (selectBlock.match(/^\s+\w+:\s*true/gm) || []).length;
check(scalarCols === 10, `carga ${scalarCols} columnas escalares (+ relación fullName)`);

const portalSvc = fs.readFileSync(
  path.join(rootDir, 'src/services/workforceRecruitmentPortal.service.js'),
  'utf8',
);
check(
  /organizationId,\s*workforceEmployeeId/.test(portalSvc) &&
    /registeredByWorkforceEmployeeId: workforceEmployeeId/.test(portalSvc),
  'portal org/colaborador de sesión',
);
check(
  /attachExistingCandidateToVacancyForWorkforcePortal[\s\S]*createRecruitmentApplication/.test(portalSvc) &&
    !/createRecruitmentCandidateAndNotify/.test(
      portalSvc.slice(portalSvc.indexOf('attachExistingCandidateToVacancyForWorkforcePortal')),
    ),
  'usar existente portal no crea candidato ni notificación de alta',
);

check(
  /Concurrencia: no hay candado org-wide/.test(createSvc),
  'riesgo de carrera documentado',
);

if (failed) {
  console.error(`\n✗ ${failed} fallo(s) en duplicados unitarios.\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment candidate duplicates (sin PG) OK.\n');

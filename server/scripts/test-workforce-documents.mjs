/**
 * Expediente de documentos — Gestión de equipo (admin V1).
 * node server/scripts/test-workforce-documents.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'workforce-docs-test-secret';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
const orgRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.org.routes.js'), 'utf8');
const uploadPaths = fs.readFileSync(path.join(rootDir, 'src/utils/uploadPaths.js'), 'utf8');
const appJs = fs.readFileSync(path.join(rootDir, 'src/app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');
const docSvc = fs.readFileSync(path.join(rootDir, 'src/services/workforceDocument.service.js'), 'utf8');

const {
  WORKFORCE_DOCUMENT_MAX_BYTES,
  WORKFORCE_DOCUMENT_SUBDIR,
  sniffWorkforceDocumentExt,
  isAllowedWorkforceDocumentFile,
  assertSafeWorkforceDocumentPath,
  sanitizeDocumentForAdmin,
  contentDispositionInlineHeader,
  documentServeContentType,
} = await import('../src/services/workforceDocument.service.js');
const { resolveWorkforceDocumentsDirAbs } = await import('../src/utils/uploadPaths.js');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

const png1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const pdfTiny = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\nxref\n0 1\ntrailer<<>>\n%%EOF\n');

console.log('\n=== Workforce documents — estático ===\n');

check(/model WorkforceDocument/.test(schema), 'modelo WorkforceDocument');
check(/WorkforceDocumentCategory/.test(schema), 'enum categorías');
check(/workforceDocuments/.test(schema), 'relaciones Organization/Employee/User');
check(/resolveWorkforceDocumentsDirAbs/.test(uploadPaths), 'subdir workforce-documents');
check(/workforce-documents/.test(appJs), 'mkdir workforce-documents al arranque');
check(/router\.get\('\/employees\/:id\/documents'/.test(orgRoutes), 'GET listado documentos');
check(/router\.post\([\s\S]*\/employees\/:id\/documents/.test(orgRoutes), 'POST documento');
check(/router\.get\('\/documents\/:documentId\/file'/.test(orgRoutes), 'GET file autenticado');
check(/router\.delete\('\/documents\/:documentId'/.test(orgRoutes), 'DELETE documento');
check(/WORKFORCE_DOCUMENT_MAX_BYTES/.test(orgRoutes), 'límite 10MB en ruta');
check(/contentDispositionInlineHeader/.test(docSvc) && /inline/.test(docSvc), 'inline para Ver');
check(/X-Content-Type-Options/.test(docSvc) && /nosniff/.test(docSvc), 'nosniff al servir');
check(/documentServeContentType/.test(docSvc), 'Content-Type acotado');
check(/Cache-Control/.test(docSvc) && /private/.test(docSvc), 'cache privado');
check(/ETag/.test(docSvc), 'ETag al servir');
check(
  /export async function deleteWorkforceDocument[\s\S]*?workforceDocument\.delete[\s\S]*?removeWorkforceDocumentFile/.test(
    docSvc,
  ),
  'DELETE: fila BD antes que archivo',
);
check(/PARTIAL_DELETE/.test(docSvc), 'fallo explícito si unlink tras BD');
check(!/filePath/.test(docSvc.match(/function sanitizeDocumentForAdmin[\s\S]*?^}/m)?.[0] || ''), 'JSON sin filePath');
check(/tcSvgFolder/.test(indexHtml) && /title="Documentos"/.test(indexHtml), 'botón carpeta directorio');
check(/tc-docs-backdrop/.test(indexHtml) && /tcOpenEmpDocs/.test(indexHtml), 'modal documentos');
check(/async function tcDocsDelete/.test(indexHtml) && /confirm\('¿Eliminar/.test(indexHtml), 'confirmación eliminar');

console.log('\n=== Workforce documents — unit ===\n');

check(WORKFORCE_DOCUMENT_MAX_BYTES === 10 * 1024 * 1024, 'límite 10MB');
check(sniffWorkforceDocumentExt(pdfTiny) === '.pdf', 'magic bytes PDF');
check(sniffWorkforceDocumentExt(png1x1) === '.png', 'magic bytes PNG');
check(sniffWorkforceDocumentExt(Buffer.from('hello', 'utf8')) == null, 'rechaza basura');
check(isAllowedWorkforceDocumentFile('application/pdf', 'x.pdf'), 'PDF permitido');
check(!isAllowedWorkforceDocumentFile('application/msword', 'x.doc'), 'DOCX no permitido');

const orgId = 'org_doc_test';
const empId = 'emp_doc_test';
const rel = `${WORKFORCE_DOCUMENT_SUBDIR}/${orgId}/${empId}/abc.pdf`;
check(assertSafeWorkforceDocumentPath(rel, orgId, empId) === rel, 'ruta segura válida');
try {
  assertSafeWorkforceDocumentPath(`${WORKFORCE_DOCUMENT_SUBDIR}/${orgId}/other/abc.pdf`, orgId, empId);
  check(false, 'rechaza path otra carpeta empleado');
} catch {
  check(true, 'rechaza path otra carpeta empleado');
}
try {
  assertSafeWorkforceDocumentPath('../etc/passwd', orgId, empId);
  check(false, 'rechaza traversal');
} catch {
  check(true, 'rechaza traversal');
}

check(resolveWorkforceDocumentsDirAbs().endsWith('workforce-documents'), 'directorio bajo uploads root');
check(!contentDispositionInlineHeader('Contrato\r\nX: y', '.pdf').includes('\r'), 'Content-Disposition sin CRLF');
check(contentDispositionInlineHeader('Nombre"evil', '.pdf').includes('inline'), 'Content-Disposition inline');
check(documentServeContentType({ mimeType: 'application/pdf', filePath: 'x/y/z.pdf' }) === 'application/pdf', 'MIME PDF');
check(documentServeContentType({ mimeType: 'image/png', filePath: 'x/y/z.png' }) === 'image/png', 'MIME PNG');

check(
  sanitizeDocumentForAdmin({
    id: 'd1',
    employeeId: empId,
    displayName: 'Contrato',
    category: 'CONTRATO',
    filePath: rel,
    originalFileName: 'c.pdf',
    mimeType: 'application/pdf',
    fileSize: 100,
    createdAt: new Date(),
  }).filePath === undefined,
  'sanitize omite filePath',
);

console.log('\n=== Workforce documents — integration (DB) ===\n');

try {
  const { prisma } = await import('../src/db/client.js');
  await prisma.$queryRaw`SELECT 1`;
  console.log('  SKIP integration: ejecutar en entorno con Postgres provisionado.');
} catch {
  console.log('  SKIP integration: sin Postgres local.');
}

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Workforce documents tests OK.\n');

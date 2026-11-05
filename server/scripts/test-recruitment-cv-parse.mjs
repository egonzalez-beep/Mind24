/**
 * Recruitment — CV inteligente V1 (parse precarga formulario)
 * node server/scripts/test-recruitment-cv-parse.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-cv-parse-test';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');
const routes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const parseSvcPath = path.join(rootDir, 'src/services/recruitmentCandidateResumeParse.service.js');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

const {
  parseRecruitmentResumeText,
  serializeParsedRecruitmentResumeForClient,
  classifyRecruitmentResumeFile,
  analyzeRecruitmentResumeUpload,
  suggestRecruitmentProfileFromText,
  extractTextFromResumeBuffer,
  extractRecruitmentResumeDocText,
  RECRUITMENT_RESUME_PARSE_MSG,
  RECRUITMENT_RESUME_PARSE_TEXT_CAP,
} = await import('../src/services/recruitmentCandidateResumeParse.service.js');

console.log('\n=== CV parse — estático / rutas ===\n');

check(/\/candidates\/resume\/parse/.test(routes), 'POST /candidates/resume/parse');
check(/analyzeRecruitmentResumeUpload/.test(routes), 'ruta usa servicio parse');
const parseRouteBlock =
  routes.match(/router\.post\(\s*\n\s*'\/candidates\/resume\/parse'[\s\S]*?\n\);/)?.[0] || '';
check(parseRouteBlock.length > 0 && !/createRecruitmentCandidate/.test(parseRouteBlock), 'parse no crea candidato');
check(/recCandCvExtractHandleFile/.test(indexHtml), 'la carga analiza el CV');
check(!/Extraer datos/.test(indexHtml), 'ya no hay un segundo paso Extraer datos');
check(/recCandFormApplyParsedFields/.test(indexHtml), 'UI precarga campos');
check(/Analizando el CV/.test(indexHtml), 'estado analizando');
check(/Datos encontrados en el CV/.test(indexHtml), 'confirmación discreta');
check(/La imagen se adjuntará al expediente/.test(indexHtml), 'la imagen informa sin parecer un fallo');
const formBody =
  indexHtml.match(/id="modal-rec-candidate-form"[\s\S]*?class="rec-cand-form-footer"/)?.[0] || '';
const sectionOrder = [
  'rec-cand-form-cv-section',
  'rec-cand-form-data-icon',
  'rec-cand-form-profile-icon',
  'rec-cand-form-process-block',
  'rec-cand-form-loc-icon',
  'rec-cand-form-notes-section',
];
let lastIdx = -1;
for (const token of sectionOrder) {
  const idx = formBody.indexOf(token);
  check(idx > lastIdx, `orden formulario: ${token}`);
  lastIdx = idx;
}
check(/rec-cand-form-cv-section--lead/.test(indexHtml), 'CV como bloque destacado');
check(/Arrastra aquí el CV del candidato/.test(indexHtml), 'copy principal del CV');
check(/También puedes seleccionarlo desde tu equipo/.test(indexHtml), 'copy secundario del CV');
const analyzeFnBlock =
  indexHtml.match(/function recCandCvExtractBegin[\s\S]*?^function recCandCvExtractRetry/m)?.[0] || '';
check(analyzeFnBlock.length > 0 && !/recCandCreateAndOpen/.test(analyzeFnBlock) && !/\/candidates'/.test(analyzeFnBlock), 'analizar no crea al candidato');
check(/\/candidates\/resume\/parse/.test(analyzeFnBlock), 'analizar usa endpoint parse');
check(/seq!==recCandCvExtractSeq/.test(analyzeFnBlock) && /AbortController/.test(analyzeFnBlock), 'secuencia y cancelación');
check(/err&&err\.name==='AbortError'/.test(analyzeFnBlock), 'abort no muestra un error falso');
check(/REC_CAND_CV_EXTRACT_MSG\.confirm/.test(analyzeFnBlock) && /REC_CAND_CV_EXTRACT_MSG\.kept/.test(analyzeFnBlock), 'confirmación antes de reemplazar sugeridos');
check(/candFormFieldsTouched/.test(indexHtml), 'tracking campos manuales');
check(/rec-cand-form-field--suggested/.test(indexHtml) && /Sugerido/.test(indexHtml), 'marca Sugerido');
check(/if\(window\.__recCandCvExtractBound\) return/.test(indexHtml), 'no duplica listeners');
check(/recCandCvExtractOnKeyDown/.test(indexHtml) && /recCandCvExtractOnDrop/.test(indexHtml), 'teclado, drop y drag');
check(/id==='modal-rec-candidate-form'&&typeof recCandCvExtractOnModalClose/.test(indexHtml), 'cerrar el modal aborta el análisis');
check(/max-width:720px/.test(indexHtml) && /rec-vac-extract-pick\{width:100%/.test(indexHtml), 'el botón queda a ancho completo en móvil');
check(/prefers-reduced-motion:reduce/.test(indexHtml), 'respeta reduced motion');
const suggestedIds = indexHtml.match(/REC_CAND_CV_EXTRACT_FIELDS=\{[\s\S]*?\}/)?.[0] || '';
check(suggestedIds.includes('fullName') && suggestedIds.includes('profile') && !suggestedIds.includes('curp') && !suggestedIds.includes('locality') && !suggestedIds.includes('neighborhood') && !suggestedIds.includes('notes'), 'Sugerido solo en campos que salen del CV');

console.log('\n=== CV parse — extracción estructurada ===\n');

const sampleCv = `
María López Hernández
Ventas y atención comercial
WhatsApp: +52 55 1234 5678
Tel: 55 8765 4321
Email: maria.lopez@example.com
Ciudad: Guadalajara, Jalisco
`;

const parsed = parseRecruitmentResumeText(sampleCv);
check(parsed.fullName === 'María López Hernández', 'nombre completo');
check(parsed.email === 'maria.lopez@example.com', 'email');
check(parsed.whatsapp != null, 'whatsapp');
check(parsed.phone != null, 'teléfono secundario');
check(parsed.city != null, 'ciudad');
check(suggestRecruitmentProfileFromText(sampleCv) === 'Ventas', 'perfil sugerido Ventas');

const clientFields = serializeParsedRecruitmentResumeForClient(parsed);
check(clientFields.fullName && clientFields.email, 'payload cliente sin campos vacíos extra');

const partial = parseRecruitmentResumeText('Documento sin contacto claro.');
check(!partial.email && !partial.fullName, 'documento sin datos reconocibles');

console.log('\n=== CV parse — formatos ===\n');

check(classifyRecruitmentResumeFile('.pdf') === 'parseable', 'PDF parseable');
check(classifyRecruitmentResumeFile('.docx') === 'parseable', 'DOCX parseable');
check(classifyRecruitmentResumeFile('.jpg') === 'image', 'JPG sin parsing');

const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const imageResult = await analyzeRecruitmentResumeUpload({
  buffer: pngBuf,
  mimetype: 'image/png',
  originalName: 'scan.png',
});
check(imageResult.ok === false && imageResult.code === 'NOT_PARSEABLE', 'imagen → NOT_PARSEABLE');

console.log('\n=== CV parse — privacidad en servicio ===\n');

const svcSrc = fs.readFileSync(parseSvcPath, 'utf8');
check(!/console\.log\(/.test(svcSrc), 'sin console.log en parse service');
check(/extraction_failed/.test(svcSrc), 'log de fallo sin PII');

console.log('\n=== CV parse — casos A–J ===\n');

function expectFields(label, text, expected) {
  const parsed = parseRecruitmentResumeText(text);
  Object.keys(expected).forEach((key) => {
    check(parsed[key] === expected[key], `${label} ${key}: ${parsed[key] ?? 'vacío'}`);
  });
  return parsed;
}

expectFields('A etiquetado', `Nombre: Ana Lopez Garcia
Correo: ana.lopez@example.com
Telefono: 442 111 2233
Ciudad: Queretaro
Estado: Queretaro
Perfil: Auxiliar de almacen
Experiencia: 2 anos en inventario`, {
  fullName: 'Ana Lopez Garcia',
  email: 'ana.lopez@example.com',
  whatsapp: null,
  phone: '442 111 2233',
  city: 'Queretaro',
  state: 'Querétaro',
  suggestedProfile: 'Logística / Almacén',
});

expectFields('B dos columnas', `Contacto
ana.lopez@example.com
442 111 2233
Queretaro
Experiencia
Universidad Tecnologica
Auxiliar de almacen
Ana Lopez Garcia`, {
  fullName: null,
  email: 'ana.lopez@example.com',
  whatsapp: '442 111 2233',
  phone: null,
  city: null,
  state: null,
  suggestedProfile: null,
});

expectFields('C contacto y fotografia', `Ana Lopez Garcia
ana.lopez@example.com
442 111 2233
Queretaro, Queretaro
Fotografia adjunta sin texto`, {
  fullName: 'Ana Lopez Garcia',
  email: 'ana.lopez@example.com',
  whatsapp: '442 111 2233',
  phone: null,
  city: 'Queretaro',
  state: 'Querétaro',
  suggestedProfile: null,
});

expectFields('D curriculum', `Currículum Vitae
Ana Lopez Garcia
ana.lopez@example.com
442 111 2233
Queretaro`, {
  fullName: 'Ana Lopez Garcia',
  email: 'ana.lopez@example.com',
  whatsapp: '442 111 2233',
  phone: null,
  city: null,
  state: null,
  suggestedProfile: null,
});

expectFields('E universidad y empresa', `Universidad Tecnologica de Queretaro
Empresa Logistica del Bajio
Ana Lopez Garcia
ana.lopez@example.com
442 111 2233`, {
  fullName: 'Ana Lopez Garcia',
  email: 'ana.lopez@example.com',
  whatsapp: '442 111 2233',
  phone: null,
  city: null,
  state: null,
  suggestedProfile: 'Logística / Almacén',
});

expectFields('F sin correo', `Nombre: Ana Lopez Garcia
Ciudad: Queretaro
Telefono: 442 111 2233
Experiencia en inventario de almacen`, {
  fullName: 'Ana Lopez Garcia',
  email: null,
  whatsapp: null,
  phone: '442 111 2233',
  city: 'Queretaro',
  state: null,
  suggestedProfile: 'Logística / Almacén',
});

expectFields('G dos telefonos', `Nombre: Ana Lopez Garcia
WhatsApp: 442 111 2233
Telefono: 442 444 5566
ana.lopez@example.com`, {
  fullName: 'Ana Lopez Garcia',
  whatsapp: '442 111 2233',
  phone: '442 444 5566',
  email: 'ana.lopez@example.com',
});

expectFields('G inverso', `Nombre: Ana Lopez Garcia
Telefono: 442 444 5566
WhatsApp: 442 111 2233`, {
  whatsapp: '442 111 2233',
  phone: '442 444 5566',
});

expectFields('H referencias', `Nombre: Ana Lopez Garcia
WhatsApp: 442 111 2233
ana.lopez@example.com
Referencias personales
Carlos Ruiz 442 999 8877
Maria Soto 442 888 7766
carlos.ruiz@example.com`, {
  fullName: 'Ana Lopez Garcia',
  whatsapp: '442 111 2233',
  phone: null,
  email: 'ana.lopez@example.com',
});

expectFields('I narrativo', 'Profesional con experiencia coordinando equipos de almacen y control de inventarios en el Bajio. Busca una posicion operativa.', {
  fullName: null,
  email: null,
  whatsapp: null,
  phone: null,
  city: null,
  state: null,
  suggestedProfile: 'Logística / Almacén',
});

expectFields('telefono unico', 'Nombre: Ana Lopez Garcia\n442 111 2233', {
  whatsapp: '442 111 2233',
  phone: null,
});

expectFields('mismo numero', 'WhatsApp: 442 111 2233\nTel: (442) 111-2233', {
  whatsapp: '442 111 2233',
  phone: null,
});

expectFields('celular', 'Celular: 442 111 2233', {
  whatsapp: '442 111 2233',
  phone: null,
});

expectFields('correo de referencia', 'Referencias personales\ncarlos.ruiz@example.com', {
  email: null,
  fullName: null,
});

check(suggestRecruitmentProfileFromText('Otro perfil sin palabras del catalogo') !== 'Otro', 'Otro no se sugiere');
check(suggestRecruitmentProfileFromText('Texto sin oficios reconocibles') == null, 'el perfil puede quedar vacío');

console.log('\n=== CV parse — archivos K–R ===\n');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    data.copy(local, 30 + name.length);
    locals.push(local);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function escapePdfText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdf(lines) {
  const commands = ['BT', '/F1 12 Tf'];
  lines.forEach((line, index) => {
    commands.push(`1 0 0 1 48 ${720 - index * 16} Tm (${escapePdfText(line)}) Tj`);
  });
  commands.push('ET');
  const content = commands.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body));
    body += obj;
  }
  const xrefAt = Buffer.byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  body += `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body);
}

const pdfText = await extractTextFromResumeBuffer(buildPdf(['Nombre: Ana Lopez Garcia', 'Correo: ana.lopez@example.com']), '.pdf');
check(!pdfText.includes('-- 1 of'), 'el PDF no inserta el marcador de página');
check(!pdfText.toLowerCase().includes('gettable'), 'el texto del CV no sale de una tabla');
const pdfParsed = await analyzeRecruitmentResumeUpload({
  buffer: buildPdf(['Nombre: Ana Lopez Garcia', 'Correo: ana.lopez@example.com', 'Telefono: 442 111 2233']),
  mimetype: 'application/pdf',
  originalName: 'ana.pdf',
});
check(pdfParsed.ok === true && pdfParsed.fields.fullName === 'Ana Lopez Garcia' && pdfParsed.fields.phone === '442 111 2233' && !pdfParsed.fields.whatsapp, 'PDF de una columna');

const scanned = await analyzeRecruitmentResumeUpload({
  buffer: buildPdf([]),
  mimetype: 'application/pdf',
  originalName: 'escaneado.pdf',
});
check(scanned.ok === false && scanned.code === 'NO_DATA', 'J PDF sin capa de texto no rellena el formulario');

const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const documentXml = '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Nombre: Ana Lopez Garcia</w:t></w:r></w:p><w:p><w:r><w:t>Correo: ana.lopez@example.com</w:t></w:r></w:p></w:body></w:document>';
const typesXml = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const validDocx = await analyzeRecruitmentResumeUpload({
  buffer: zipStore([
    { name: '[Content_Types].xml', data: typesXml },
    { name: 'word/document.xml', data: documentXml },
  ]),
  mimetype: docxMime,
  originalName: 'ana.docx',
});
check(validDocx.ok === true && validDocx.fields.fullName === 'Ana Lopez Garcia' && validDocx.fields.email === 'ana.lopez@example.com', 'L DOCX valido');

const renamedZip = await analyzeRecruitmentResumeUpload({
  buffer: zipStore([{ name: 'readme.txt', data: 'Nombre: Ana Lopez Garcia' }]),
  mimetype: docxMime,
  originalName: 'falso.docx',
});
check(renamedZip.ok === false && renamedZip.code === 'FORMAT' && !JSON.stringify(renamedZip).includes('Ana Lopez'), 'K ZIP renombrado');

const macroDocx = await analyzeRecruitmentResumeUpload({
  buffer: zipStore([
    { name: '[Content_Types].xml', data: typesXml.replace('wordprocessingml', 'macroEnabled wordprocessingml') },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/vbaProject.bin', data: 'macro' },
  ]),
  mimetype: docxMime,
  originalName: 'macros.docx',
});
check(macroDocx.ok === false && macroDocx.code === 'FORMAT', 'M DOCX con macro');

const beforeTemps = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('rec-cv-')));
const badDoc = await analyzeRecruitmentResumeUpload({
  buffer: Buffer.from('NO-OLE-SECRETO'),
  mimetype: 'application/msword',
  originalName: 'falso.doc',
});
const afterTemps = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('rec-cv-') && !beforeTemps.has(name));
check(badDoc.ok === false && badDoc.code === 'FORMAT' && !JSON.stringify(badDoc).includes('SECRETO'), 'N DOC sin firma OLE');
check(afterTemps.length === 0, 'el DOC invalido no deja temporal');

let slowPath = '';
let releaseSlowReader;
const slowReaderFinished = new Promise((resolve) => {
  releaseSlowReader = resolve;
});
let slowMessage = '';
let unhandledAfterTimeout = 0;
const onUnhandled = () => {
  unhandledAfterTimeout += 1;
};
process.on('unhandledRejection', onUnhandled);
try {
  await extractRecruitmentResumeDocText(Buffer.from('abc'), {
    timeoutMs: 25,
    extractImpl(filePath) {
      slowPath = filePath;
      return slowReaderFinished.then(() => 'NO_DEBE_VOLVER');
    },
  });
} catch (err) {
  slowMessage = err.message;
}
check(slowMessage === RECRUITMENT_RESUME_PARSE_MSG.fail, 'O el tiempo de espera devuelve un error controlado');
check(slowPath.includes(`${path.sep}rec-cv-`) && fs.existsSync(slowPath), 'el temporal sigue mientras el lector no termina');
releaseSlowReader();
await slowReaderFinished;
await new Promise((resolve) => setTimeout(resolve, 40));
check(!fs.existsSync(slowPath), 'al terminar el lector se elimina el temporal');
check(unhandledAfterTimeout === 0, 'no hay unhandled rejection');
process.removeListener('unhandledRejection', onUnhandled);

const filler = 'dato '.repeat(5000);
check(filler.length > RECRUITMENT_RESUME_PARSE_TEXT_CAP, 'el fixture supera el tope de texto');
const longDocument = documentXml.replace(
  '</w:t>',
  ` ${filler} Nombre: Zzz NoDebeEntrar</w:t>`,
);
const capped = await analyzeRecruitmentResumeUpload({
  buffer: zipStore([
    { name: '[Content_Types].xml', data: typesXml },
    { name: 'word/document.xml', data: longDocument },
  ]),
  mimetype: docxMime,
  originalName: 'largo.docx',
});
check((!capped.ok || capped.fields?.fullName !== 'Zzz NoDebeEntrar') && !JSON.stringify(capped).includes('Zzz NoDebeEntrar'), 'el texto posterior al límite no se analiza');
check(/recCandCvExtractOnModalClose/.test(indexHtml) && /recCandCvExtractSeq\+=1/.test(indexHtml), 'P cerrar el modal invalida la respuesta');
check(/const seq=recCandCvExtractBegin\(\)/.test(indexHtml), 'Q otro archivo invalida el análisis anterior');

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const imageUpload = await analyzeRecruitmentResumeUpload({
  buffer: jpeg,
  mimetype: 'image/jpeg',
  originalName: 'foto.jpg',
});
check(imageUpload.ok === false && imageUpload.code === 'NOT_PARSEABLE', 'R imagen valida sin OCR');

const parseRoute = routes.slice(routes.indexOf("'/candidates/resume/parse'"), routes.indexOf("'/candidates/:candidateId/resume'"));
check(parseRoute.includes('recruitmentCandidateResumeParseLimiter'), 'el parse admin tiene límite propio');
check(parseRoute.includes('assertEmpresaAdmin(req.session.userId)'), 'autorización antes de usar el resultado');
check(!parseRoute.includes('createRecruitmentCandidate') && !parseRoute.includes('prisma.'), 'el análisis no escribe en Prisma');
check(!parseRoute.includes('req.body.organizationId'), 'el admin no acepta organizationId del cliente');
const portalRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.public.routes.js'), 'utf8');
const portalParse = portalRoutes.slice(portalRoutes.indexOf("'/recruitment/candidates/resume/parse'"), portalRoutes.indexOf("'/recruitment/my-candidates'"));
check(portalParse.includes('recruitmentPortalResumeParseLimiter') && !portalParse.includes('timeclockCheckInLimiter'), 'el portal tiene límite propio y no usa el del checador');
check(portalParse.includes('requireTimeclockSession') && !portalParse.includes('req.body'), 'el portal no lee organizationId ni candidateId del cuerpo');
check(/resume-parse:user:/.test(fs.readFileSync(path.join(rootDir, 'src/middleware/rateLimit.middleware.js'), 'utf8')), 'la clave del límite sale de la sesión');
check(!parseSvcSrc().includes('getTable') && /parser\.getText\(\)/.test(fs.readFileSync(parseSvcPath, 'utf8')), 'el CV no usa getTable');

function sliceFn(html, signature, nextSignature) {
  const start = html.indexOf(signature);
  const end = html.indexOf(nextSignature, start + signature.length);
  if (start < 0 || end < 0) throw new Error(`No se encontró ${signature}`);
  return html.slice(start, end);
}

const helperStart = indexHtml.indexOf('// REC_CAND_CV_FILE_PURE_HELPERS_START');
const helperEnd = indexHtml.indexOf('// REC_CAND_CV_FILE_PURE_HELPERS_END');
const helperSandbox = { Object };
vm.runInNewContext(indexHtml.slice(helperStart, helperEnd), helperSandbox, { filename: 'index.html#REC_CAND_CV_FILE_PURE_HELPERS' });
const firstFile = { name: 'primero.pdf' };
const secondFile = { name: 'segundo.pdf' };
const imageFile = { name: '<img src=x onerror=alert(1)>.png' };
check(helperSandbox.recCandCvResolvePendingFile(firstFile, secondFile, 'cancelled') === firstFile, 'cancelar el reemplazo conserva el primer archivo');
check(helperSandbox.recCandCvResolvePendingFile(firstFile, secondFile, 'committed') === secondFile, 'aceptar el reemplazo deja solo el segundo archivo');
check(helperSandbox.recCandCvResolvePendingFile(firstFile, secondFile, 'failed') === firstFile, 'un segundo análisis fallido conserva el archivo válido');
check(helperSandbox.recCandCvResolvePendingFile(null, firstFile, 'failed') === firstFile, 'el primer archivo se conserva si su análisis falla');
check(helperSandbox.recCandCvResolvePendingFile(firstFile, null, 'invalid') === firstFile, 'un archivo inválido no sustituye al pendiente');
check(helperSandbox.recCandCvResolvePendingFile(firstFile, imageFile, 'image') === imageFile, 'una imagen queda pendiente de adjuntar');
check(helperSandbox.recCandCvPendingAfterModalClose(firstFile, null) === null, 'cerrar el modal limpia el archivo pendiente');
check(helperSandbox.recCandCvPendingAfterModalClose(firstFile, 'cand-1') === firstFile, 'el reintento de CV del portal conserva el archivo ya creado');

const manualId = 'rec-cand-form-name';
const emailId = 'rec-cand-form-email';
const phoneId = 'rec-cand-form-phone';
const profileId = 'rec-cand-form-profile';
const manualState = {
  current: { [manualId]: 'Nombre escrito', [profileId]: 'Ventas', 'rec-cand-form-curp': 'CURP1', 'rec-cand-form-locality': 'Centro', 'rec-cand-form-neighborhood': 'Roma', 'rec-cand-form-notes': 'Nota', 'rec-cand-form-source': 'Referido', 'rec-cand-form-vacancy': 'vac-1' },
  fromCv: {},
  touched: { [manualId]: true },
  profileDefault: 'Ventas',
};
const afterFirst = helperSandbox.recCandCvApplySuggestions(manualState, {
  fullName: '<img src=x onerror=alert(1)>',
  email: 'ana@example.com',
  phone: '442 000 0000',
  profile: 'Logística / Almacén',
  curp: 'XXXX',
  locality: 'Otra',
  neighborhood: 'Otra',
  notes: '<script>alert(1)</script>',
  source: 'Portal',
  vacancyId: 'vac-2',
});
check(afterFirst.current[manualId] === 'Nombre escrito' && !afterFirst.marks[manualId], 'un campo manual no se sobrescribe');
check(afterFirst.current[emailId] === 'ana@example.com' && afterFirst.marks[emailId] === true, 'un campo vacío sí recibe la sugerencia');
check(afterFirst.current[profileId] === 'Logística / Almacén' && afterFirst.marks[profileId] === true, 'el perfil predeterminado se puede sugerir');
check(afterFirst.current['rec-cand-form-curp'] === 'CURP1' && afterFirst.marks['rec-cand-form-curp'] == null, 'CURP no recibe marca');
check(afterFirst.marks['rec-cand-form-locality'] == null && afterFirst.marks['rec-cand-form-neighborhood'] == null && afterFirst.marks['rec-cand-form-notes'] == null && afterFirst.marks['rec-cand-form-source'] == null && afterFirst.marks['rec-cand-form-vacancy'] == null, 'localidad, colonia, notas, origen y vacante no reciben marca');
const edited = {
  current: Object.assign({}, afterFirst.current, { [emailId]: 'editado@example.com' }),
  fromCv: Object.assign({}, afterFirst.fromCv),
  touched: { [emailId]: true },
  profileDefault: 'Ventas',
};
delete edited.fromCv[emailId];
const afterEdit = helperSandbox.recCandCvApplySuggestions(edited, { email: 'nuevo@example.com', phone: '442 111 1111' });
check(afterEdit.current[emailId] === 'editado@example.com' && !afterEdit.marks[emailId], 'un campo sugerido y editado queda protegido');
check(afterEdit.current[phoneId] === '442 111 1111' && afterEdit.fromCv[emailId] == null, 'el reemplazo no borra la protección del campo editado');
const missingSecond = helperSandbox.recCandCvApplySuggestions(afterFirst, { phone: '442 222 2222' });
check(missingSecond.current[emailId] === 'ana@example.com' && missingSecond.fromCv[emailId] === 'ana@example.com' && missingSecond.marks[emailId] == null, 'si el segundo CV no trae un campo, no lo borra');
check(Object.keys(afterFirst.marks).every((id) => ['rec-cand-form-name', 'rec-cand-form-whatsapp', 'rec-cand-form-phone', 'rec-cand-form-email', 'rec-cand-form-city', 'rec-cand-form-state', 'rec-cand-form-profile'].includes(id)), 'Sugerido solo existe en los siete campos');

const msgStart = indexHtml.indexOf('const REC_CAND_CV_EXTRACT_MSG=');
const msgEnd = indexHtml.indexOf('// REC_CAND_CV_FILE_PURE_HELPERS_START');
const safeFn = sliceFn(indexHtml, 'function recCandCvExtractSafeMessage', 'function recCandCvExtractClientError');
const messageSandbox = {};
vm.runInNewContext(`${indexHtml.slice(msgStart, msgEnd)}\n${safeFn}`, messageSandbox, { filename: 'index.html#recCandCvExtractSafeMessage' });
const failMsg = 'No pudimos extraer los datos automáticamente. Puedes continuar el registro manualmente.';
check(messageSandbox.recCandCvExtractSafeMessage('<img src=x onerror=alert(1)>') === failMsg, 'un mensaje HTML del backend no se reutiliza');
check(messageSandbox.recCandCvExtractSafeMessage('TypeError: x\n    at parse (service.js:10:5)') === failMsg, 'un stack no se muestra');
check(messageSandbox.recCandCvExtractSafeMessage('Demasiados análisis de CV. Espera unos minutos.') === 'Demasiados análisis de CV. Espera unos minutos.', 'el aviso de límite sí se conserva');

const showFn = sliceFn(indexHtml, 'function recCandCvExtractShowFile', 'function recCandCvExtractShowStatus');
const fileEl = { textContent: '', children: [] };
const statusEl = { textContent: '' };
const rootEl = { classList: { remove() {}, add() {}, toggle() {} }, setAttribute(name, value) { this.attrs[name] = value; }, attrs: {} };
const uiSandbox = {
  document: {
    getElementById(id) {
      if (id === 'rec-cand-cv-extract-file') return fileEl;
      if (id === 'rec-cand-cv-extract-status') return statusEl;
      if (id === 'rec-cand-cv-extract') return rootEl;
      return null;
    },
  },
  recCandCvExtractSetState(name) { rootEl.state = name; },
  recCandFormSetCvErr() {},
  recCandFormSetCvParseMsg() {},
};
vm.runInNewContext(`${showFn}\nrecCandCvExtractShowFile(hostileName);`, Object.assign(uiSandbox, { hostileName: '<img src=x onerror=alert(1)>.pdf' }), { filename: 'index.html#showFile' });
check(fileEl.textContent === '<img src=x onerror=alert(1)>.pdf' && fileEl.children.length === 0 && !showFn.includes('innerHTML'), 'el nombre del archivo queda como texto');
const hostileSuggested = '<img src=x onerror=alert(1)>';
check(afterFirst.current[manualId] !== hostileSuggested && afterFirst.current[emailId].indexOf('<') === -1, 'el valor manual no absorbe el HTML sugerido');
const suggested = helperSandbox.recCandCvApplySuggestions({ current: { [profileId]: 'Ventas' }, fromCv: {}, touched: {}, profileDefault: 'Ventas' }, { fullName: hostileSuggested, email: 'ana&<b>@example.com' });
check(suggested.current[manualId] === hostileSuggested && suggested.current[emailId] === 'ana&<b>@example.com', 'el valor sugerido se conserva como texto');
const applyFn = sliceFn(indexHtml, 'function recCandFormApplyParsedFields', 'let recCandCvExtractSeq');
check(applyFn.includes('el.value=merged.current[id]') && !applyFn.includes('innerHTML'), 'los campos se llenan con value');
const uiBlock = indexHtml.slice(indexHtml.indexOf('function recCandCvExtractShowFile'), indexHtml.indexOf('function recCandFormResetModalScroll'));
check(!uiBlock.includes('innerHTML'), 'el ciclo del CV no inserta HTML');
check(!/setAttribute\(\s*['"]title['"]/.test(uiBlock) && !/setAttribute\(\s*['"]aria-label['"]/.test(uiBlock) && !/\.dataset\./.test(uiBlock), 'title, aria-label y data-* no reciben el contenido del CV');
const setStateFn = sliceFn(indexHtml, 'function recCandCvExtractSetState', 'function recCandCvExtractSetOver');
check(setStateFn.includes("setAttribute('aria-busy', name==='is-busy' ? 'true' : 'false')"), 'aria-busy solo usa un valor fijo');

const handleFn = sliceFn(indexHtml, 'async function recCandCvExtractHandleFile', 'function recCandCvExtractRetry');
const removeFn = sliceFn(indexHtml, 'function recCandCvExtractRemove', 'function recCandFormCvValidate');
const closeFn = sliceFn(indexHtml, 'function recCandCvExtractOnModalClose', 'function recCandCvExtractOnDragEnter');
const createFn = sliceFn(indexHtml, 'async function recCandCreateAndOpen', 'async function recCandOpenAddVacancyModal');
const retryFn = sliceFn(indexHtml, 'function recCandCvExtractRetry', 'function recCandCvExtractBindOnce');
check(removeFn.includes('candFormPendingCvFile=null'), 'Quitar archivo elimina el archivo pendiente');
check(closeFn.includes('recCandCvPendingAfterModalClose') && closeFn.includes('recCandFormClearPrefillMarks') && closeFn.includes('recCandCvExtractSeq+=1'), 'cerrar invalida la respuesta y limpia las marcas');
check(handleFn.includes("recCandCvExtractCommitPending(previous, file, 'cancelled')") && handleFn.indexOf('recCandFormApplyParsedFields') > handleFn.indexOf("'cancelled'"), 'cancelar no aplica el segundo CV');
check(handleFn.includes("recCandCvExtractCommitPending(previous, file, 'failed')") && handleFn.indexOf("'failed'") < handleFn.indexOf('recCandFormApplyParsedFields'), 'un error no aplica campos nuevos');
check(handleFn.includes('resume/parse') && !handleFn.includes('recCandUploadCvForCandidate') && !handleFn.includes("apiJson('/api/org/recruitment/candidates'"), 'analizar no crea al candidato ni adjunta el archivo');
check(handleFn.includes("err.name==='AbortError'") && handleFn.includes('return;'), 'AbortError no se muestra como error');
check(retryFn.includes('recCandCvExtractHandleFile') && !retryFn.includes('recCandCreateAndOpen') && !retryFn.includes('recCandUploadCvForCandidate'), 'reintentar el análisis no crea ni adjunta');
const postAt = createFn.indexOf("apiJson('/api/org/recruitment/candidates'");
const clearAt = createFn.indexOf('candFormPendingCvFile=null');
const uploadAt = createFn.indexOf('recCandUploadCvForCandidate');
check(postAt > 0 && clearAt > postAt && uploadAt > clearAt && createFn.split('recCandUploadCvForCandidate').length === 2, 'el archivo se anula solo después de crear y se sube una vez');
const openFn = sliceFn(indexHtml, 'function recCandOpenForm', 'var REC_CAND_CURP_RE');
check(openFn.includes('recCandCvExtractOnModalClose') && openFn.includes('candFormPendingCvFile=null') && openFn.includes('recCandFormResetFieldTouch') && openFn.includes('recCandFormClearPrefillMarks'), 'reabrir el formulario empieza sin archivo ni marcas');

const orgRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/org.routes.js'), 'utf8');
const authAt = orgRoutes.indexOf("router.use(requireAuth, requireRole('empresa_admin'), requireEmpresaPortal)");
const mountAt = orgRoutes.indexOf("router.use('/recruitment', orgRecruitmentRoutes)");
check(authAt >= 0 && authAt < mountAt, 'admin: sesión y rol antes del router de reclutamiento');
const adminLimitAt = parseRoute.indexOf('recruitmentCandidateResumeParseLimiter');
const adminMulterAt = parseRoute.indexOf('recruitmentCandidateResumeParseUpload.single');
const adminAnalyzeAt = parseRoute.indexOf('analyzeRecruitmentResumeUpload');
check(adminLimitAt >= 0 && adminLimitAt < adminMulterAt && adminMulterAt < adminAnalyzeAt, 'admin: el límite corre antes de multer y del análisis');
const createRoute = routes.slice(routes.indexOf("router.post('/candidates'"), routes.indexOf("'/candidates/resume/parse'"));
check(!createRoute.includes('recruitmentCandidateResumeParseLimiter') && !createRoute.includes('recruitmentCandidateResumeParseUpload'), 'el límite del análisis no envuelve la creación');
const sessionAt = portalParse.indexOf('requireTimeclockSession');
const originAt = portalParse.indexOf('requireTimeclockMutationOrigin');
const portalLimitAt = portalParse.indexOf('recruitmentPortalResumeParseLimiter');
const portalMulterAt = portalParse.indexOf('workforceCandidateResumeParseUpload.single');
const portalAnalyzeAt = portalParse.indexOf('analyzeRecruitmentResumeUpload');
check(sessionAt >= 0 && sessionAt < originAt && originAt < portalLimitAt && portalLimitAt < portalMulterAt && portalMulterAt < portalAnalyzeAt, 'portal: sesión, origen, límite, multer y análisis');
const rateLimitSrc = fs.readFileSync(path.join(rootDir, 'src/middleware/rateLimit.middleware.js'), 'utf8');
const adminKey = rateLimitSrc.slice(rateLimitSrc.indexOf('export const recruitmentCandidateResumeParseLimiter'), rateLimitSrc.indexOf('export const recruitmentPortalResumeParseLimiter'));
const portalKey = rateLimitSrc.slice(rateLimitSrc.indexOf('export const recruitmentPortalResumeParseLimiter'), rateLimitSrc.indexOf('export const recruitmentVacancyExtractLimiter'));
check(adminKey.includes('req.session') && adminKey.includes('resume-parse:user:') && !adminKey.includes('req.body') && !adminKey.includes('req.query'), 'la clave admin sale de la sesión');
check(portalKey.includes('req.timeclockEmployee') && portalKey.includes('resume-parse:portal:') && !portalKey.includes('req.body') && !portalKey.includes('req.query'), 'la clave del portal no la elige el cliente');
check(adminKey.includes('resume-parse:user:') && portalKey.includes('resume-parse:portal:') && !adminKey.includes('resume-parse:portal:'), 'admin y portal no comparten contador');
const errorMw = fs.readFileSync(path.join(rootDir, 'src/middleware/error.middleware.js'), 'utf8');
check(errorMw.includes("payload.message = 'Error interno del servidor'") && errorMw.includes('console.error') && !/json\(\s*\{[^}]*err\.stack/.test(errorMw), 'un 500 no envía el stack al cliente');

function parseSvcSrc() {
  return fs.readFileSync(parseSvcPath, 'utf8');
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

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Recruitment CV parse V1 tests OK.\n');

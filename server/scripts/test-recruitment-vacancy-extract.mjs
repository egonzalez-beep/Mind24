/**
 * Precarga de vacante desde archivo. No crea la vacante.
 * node server/scripts/test-recruitment-vacancy-extract.mjs
 */
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

process.env.SESSION_SECRET ||= 'rec-vacancy-extract-test';
process.env.DATABASE_URL ||= 'postgresql://127.0.0.1:5432/mind24_timeclock_test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(rootDir, '..', 'index.html');
const publicIndexPath = path.join(rootDir, 'public', 'index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf8');
const publicHtml = fs.readFileSync(publicIndexPath, 'utf8');
const routes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const serviceSrc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentVacancyExtract.service.js'), 'utf8');
const resumeParseSrc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentCandidateResumeParse.service.js'),
  'utf8',
);

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
  RECRUITMENT_VACANCY_EXTRACT_MAX_BYTES,
  RECRUITMENT_VACANCY_EXTRACT_TEXT_CAP,
  RECRUITMENT_VACANCY_EXTRACT_MSG,
  analyzeRecruitmentVacancyFile,
  assertSafeRecruitmentVacancyDocx,
  buildRecruitmentVacancyExtractResponse,
  classifyRecruitmentVacancyExtractFile,
  extractRecruitmentVacancyDocText,
  parseRecruitmentVacancyText,
  raceWithRecruitmentVacancyExtractTimeout,
  recruitmentVacancyExtractUploadFailure,
} = await import('../src/services/recruitmentVacancyExtract.service.js');

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
    const method = file.method || 0;
    const uncompressed = file.uncompressedSize ?? data.length;
    const local = Buffer.alloc(30 + name.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    data.copy(local, 30 + name.length);
    locals.push(local);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(uncompressed, 24);
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

function buildPdf(text) {
  const safe = String(text).replace(/[()\\]/g, '');
  const content = `BT /F1 18 Tf 40 120 Td (${safe}) Tj ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 240] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
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
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += xref;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body);
}

const SAMPLE = [
  'Puesto: Supervisor de almacén',
  'Cliente: Bodega Norte',
  'Ubicación: Monterrey',
  'Número de vacantes: 3',
  'Fecha de apertura: 2026-11-03',
  'Fecha de cobertura: 2026-12-01',
  'Requisitos',
  'Experiencia en inventario y montacargas.',
  'Sueldo: 18000 mensuales',
].join('\n');

console.log('\n=== Extracción estructurada ===\n');

const parsed = parseRecruitmentVacancyText(SAMPLE);
check(parsed.title?.value === 'Supervisor de almacén' && parsed.title.confidence === 'high', 'título etiquetado');
check(parsed.clientName?.value === 'Bodega Norte' && parsed.clientName.confidence === 'high', 'cliente etiquetado');
check(parsed.location?.value === 'Monterrey' && parsed.location.confidence === 'high', 'ubicación etiquetada');
check(parsed.positionsTotal?.value === 3 && parsed.positionsTotal.confidence === 'high', 'posiciones etiquetadas');
check(parsed.openedAt?.value === '2026-11-03', 'fecha de apertura explícita');
check(parsed.targetCoverageDate?.value === '2026-12-01', 'fecha de cobertura explícita');
check(/montacargas/.test(parsed.jobDescription?.value || ''), 'requisitos dentro de la descripción');
check(/18000 mensuales/.test(parsed.jobDescription?.value || ''), 'sueldo del documento queda en la descripción');
check(parsed.salary == null && parsed.modality == null && parsed.status == null, 'no inventa campos fuera del formulario');

const vague = parseRecruitmentVacancyText('No especificado\nN/A\npor definir');
check(!vague.title && !vague.clientName && !vague.location && !vague.jobDescription, 'no rellena con no especificado');

const medium = parseRecruitmentVacancyText(
  'Auxiliar de nómina\nApoyo en cálculo semanal, incidencias y recibos de los colaboradores del centro.',
);
check(medium.title?.confidence === 'medium', 'título de la primera línea solo con confianza media');
check(medium.clientName == null && medium.location == null, 'no inventa cliente ni ubicación');

const ambiguous = parseRecruitmentVacancyText('Puesto: Analista de datos\nFecha de apertura: 03/11/2026\nNúmero de vacantes: 0');
check(ambiguous.openedAt == null, 'no interpreta una fecha numérica ambigua');
check(ambiguous.positionsTotal == null, 'no propone cero posiciones');

const coverage = parseRecruitmentVacancyText(
  'Puesto: Chofer de reparto\nFecha de apertura: 2026-12-15\nFecha de cobertura: 2026-12-01',
);
check(coverage.openedAt?.value === '2026-12-15', 'la apertura explícita se conserva');
check(coverage.targetCoverageDate == null, 'no aplica cobertura anterior a la apertura');

const htmlSuggestion = parseRecruitmentVacancyText('Puesto: Supervisor <script>alert(1)</script> de turno');
check(htmlSuggestion.title?.value === 'Supervisor de turno' && !/</.test(htmlSuggestion.title.value), 'la sugerencia queda en texto plano');

const built = buildRecruitmentVacancyExtractResponse('vacante.txt', {
  ...parsed,
  salary: { value: 18000, confidence: 'high' },
  notes: { value: 'secreto', confidence: 'high' },
  title: { value: 'Supervisor de almacén', confidence: 'low' },
});
check(built.ok === true && built.suggestions.title == null, 'confianza baja no se precarga');
check(built.suggestions.salary == null && built.suggestions.notes == null, 'campos desconocidos se descartan');
check(!('organizationId' in built), 'la respuesta no incluye organizationId');

let emptyFailed = false;
try {
  buildRecruitmentVacancyExtractResponse('vacio.txt', {});
} catch (err) {
  emptyFailed = err.message === RECRUITMENT_VACANCY_EXTRACT_MSG.empty;
}
check(emptyFailed, 'sin evidencia devuelve el mensaje de información insuficiente');

console.log('\n=== Archivo, firma y temporales ===\n');

check(RECRUITMENT_VACANCY_EXTRACT_MAX_BYTES === 10 * 1024 * 1024, 'límite de 10 MB');

async function rejects(buffer, name, message, mimetype = '') {
  try {
    await analyzeRecruitmentVacancyFile({ buffer, originalName: name, mimetype });
    return false;
  } catch (err) {
    return err.message === message && !String(err.message).includes('SECRETO');
  }
}

check(
  await rejects(Buffer.from('<html>SECRETO_HTML</html>'), 'vacante.html', RECRUITMENT_VACANCY_EXTRACT_MSG.format),
  'rechaza HTML',
);
check(
  await rejects(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'vacante.svg', RECRUITMENT_VACANCY_EXTRACT_MSG.format),
  'rechaza SVG',
);
check(
  await rejects(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), 'vacante.exe', RECRUITMENT_VACANCY_EXTRACT_MSG.format),
  'rechaza ejecutable',
);
check(
  await rejects(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), 'foto.png', RECRUITMENT_VACANCY_EXTRACT_MSG.format),
  'rechaza PNG porque no hay OCR',
);
check(
  await rejects(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('SECRETO')]), 'foto.jpg', RECRUITMENT_VACANCY_EXTRACT_MSG.format),
  'rechaza JPEG',
);
check(
  await rejects(Buffer.from('PK\x03\x04SECRETO'), 'paquete.zip', RECRUITMENT_VACANCY_EXTRACT_MSG.format),
  'rechaza ZIP',
);
check(
  await rejects(Buffer.from('PK\x03\x04sin-word'), 'falso.docx', RECRUITMENT_VACANCY_EXTRACT_MSG.format),
  'rechaza ZIP renombrado a DOCX',
);
check(
  await rejects(Buffer.from('MZ-no-es-pdf'), 'falso.pdf', RECRUITMENT_VACANCY_EXTRACT_MSG.format),
  'rechaza PDF cuya firma no es PDF',
);
check(
  await rejects(Buffer.alloc(0), 'vacio.txt', RECRUITMENT_VACANCY_EXTRACT_MSG.empty),
  'rechaza archivo vacío',
);
check(
  await rejects(Buffer.alloc(RECRUITMENT_VACANCY_EXTRACT_MAX_BYTES + 1, 0x61), 'grande.txt', RECRUITMENT_VACANCY_EXTRACT_MSG.size),
  'rechaza archivo mayor a 10 MB',
);

const txt = await analyzeRecruitmentVacancyFile({
  buffer: Buffer.from(SAMPLE, 'utf8'),
  originalName: 'vacante <script>.txt',
});
check(txt.suggestions.title.value === 'Supervisor de almacén', 'TXT precarga el título');
check(!txt.fileName.includes('<') && !txt.fileName.includes('>'), 'el nombre del archivo se sanitiza');
check(txt.suggestions.jobDescription.value.length < 20_000, 'la descripción va limitada');

const docx = zipStore([
  {
    name: '[Content_Types].xml',
    data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  },
  {
    name: 'word/document.xml',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Puesto: Analista de nomina</w:t></w:r></w:p><w:p><w:r><w:t>Cliente: Oficina Central</w:t></w:r></w:p><w:p><w:r><w:t>Requisitos</w:t></w:r></w:p><w:p><w:r><w:t>Conocimiento de calculo de nomina y prestaciones.</w:t></w:r></w:p></w:body></w:document>',
  },
]);
const docxResult = await analyzeRecruitmentVacancyFile({ buffer: docx, originalName: 'vacante.docx' });
check(docxResult.suggestions.title?.value === 'Analista de nomina', 'DOCX reutiliza el extractor de texto');
check(docxResult.suggestions.clientName?.value === 'Oficina Central', 'DOCX lee el cliente');

const pdf = buildPdf('Puesto: Recepcionista');
let pdfTitle = null;
let pdfMessage = '';
try {
  const pdfResult = await analyzeRecruitmentVacancyFile({ buffer: pdf, originalName: 'vacante.pdf' });
  pdfTitle = pdfResult.suggestions.title?.value || null;
} catch (err) {
  pdfMessage = err.message;
}
check(pdfTitle === 'Recepcionista', 'PDF usa el lector existente y precarga el título');
check(!pdfMessage.includes('%PDF') && !pdfMessage.includes('Recepcionista'), 'el error de PDF no devuelve el contenido');

const beforeTemps = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('rec-vac-')));
const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const olePad = Buffer.alloc(64);
ole.copy(olePad);
olePad.write('SECRETO_DOC_NO_LOG', 16);
let docMessage = '';
try {
  await analyzeRecruitmentVacancyFile({ buffer: olePad, originalName: 'danado.doc', mimetype: 'application/msword' });
} catch (err) {
  docMessage = err.message;
}
const afterTemps = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('rec-vac-') && !beforeTemps.has(name));
check(docMessage === RECRUITMENT_VACANCY_EXTRACT_MSG.fail, 'DOC dañado devuelve error recuperable');
check(!docMessage.includes('SECRETO_DOC_NO_LOG') && !docMessage.includes('rec-cv-'), 'el error no filtra contenido ni ruta temporal');
check(afterTemps.length === 0, 'el temporal del DOC se elimina al fallar');
check(classifyRecruitmentVacancyExtractFile(Buffer.from('%PDF-1.4\n'), 'ok.pdf') === 'pdf', 'la firma PDF se reconoce');

console.log('\n=== Endpoint sin escritura ===\n');

const extractRoute = routes.slice(routes.indexOf("'/vacancies/extract'"), routes.indexOf("router.get('/metrics'"));
check(extractRoute.includes('assertEmpresaAdmin(req.session.userId)'), 'autorización administrativa por sesión');
check(!extractRoute.includes('createRecruitmentVacancy'), 'el endpoint de extracción no crea la vacante');
check(!extractRoute.includes('prisma.'), 'la ruta no escribe en Prisma');
check(!extractRoute.includes('req.body') && !extractRoute.includes('organizationId'), 'no acepta organizationId ni cuerpo de ruta');
check(extractRoute.includes('recruitmentVacancyExtractLimiter'), 'tiene límite de frecuencia');
check(extractRoute.includes('recruitmentVacancyExtractUploadFailure'), 'el límite de tamaño se responde en la ruta');
check(serviceSrc.includes("err.code === 'LIMIT_FILE_SIZE'"), 'Multer por tamaño no cae en un 500');
check(
  recruitmentVacancyExtractUploadFailure({ code: 'LIMIT_FILE_SIZE' }).status === 400 &&
    recruitmentVacancyExtractUploadFailure({ code: 'LIMIT_FILE_COUNT' }).body.message === RECRUITMENT_VACANCY_EXTRACT_MSG.format,
  'varios archivos no se informan como archivo grande',
);
check(!serviceSrc.includes('prisma') && !serviceSrc.includes('recruitmentVacancy.create'), 'el servicio no importa Prisma');
check(serviceSrc.includes('extractTextFromResumeBuffer'), 'reutiliza el extractor de CV');
check(resumeParseSrc.includes("tmpPath") && resumeParseSrc.includes('unlink'), 'el extractor de DOC limpia su temporal');
check(/router\.post\('\/vacancies'/.test(routes) && routes.includes('createRecruitmentVacancy'), 'la creación final sigue en POST /vacancies');

console.log('\n=== Formulario ===\n');

const modal = indexHtml.match(/id="modal-rec-vacancy"[\s\S]*?id="modal-rec-vacancy-detail"/)?.[0] || '';
const ui = indexHtml.match(/function recVacExtractFieldIds[\s\S]*?async function recOpenVacancyModal/)?.[0] || '';
check(/Arrastra aquí el archivo de tu vacante/.test(modal), 'texto principal de la zona');
check(/También puedes seleccionarlo desde tu equipo/.test(modal), 'texto secundario');
check(/Seleccionar archivo/.test(modal) && /Crear vacante manualmente/.test(modal), 'botón de archivo y captura manual');
check(/PDF, Word o TXT · máx\. 10 MB/.test(modal), 'formatos y límite visibles');
check(/aria-label="Arrastra aquí el archivo de tu vacante/.test(modal), 'aria-label de la zona');
check(/id="rec-vac-extract-drop"[\s\S]*tabindex="0"/.test(modal), 'la zona es enfocable');
check(/recVacExtractOnDragEnter/.test(ui) && /recVacExtractOnDragLeave/.test(ui) && /recVacExtractOnDrop/.test(ui), 'drag enter, leave y drop');
check(/recVacExtractOnFileInput/.test(ui) && /recVacExtractOnKeyDown/.test(ui), 'selección manual y teclado');
check(/Analizando el archivo/.test(ui), 'estado de análisis');
check(/prefers-reduced-motion:reduce/.test(indexHtml) && /recVacExtractScan/.test(indexHtml), 'animación ligera y reduced motion');
check(/AbortController/.test(ui) && /seq!==recVacExtractSeq/.test(ui), 'cancelación y respuesta anterior ignorada');
check(/if\(window\.__recVacExtractBound\) return/.test(ui), 'abrir el modal no duplica listeners');
check(/removeEventListener\('dragover', recVacExtractPreventBrowserOpen\)/.test(ui) && /removeEventListener\('drop', recVacExtractPreventBrowserOpen\)/.test(ui), 'el guard de drop se retira al cerrar');
check(/recVacExtractDisarmPageDropGuard/.test(ui) && /recVacExtractAbort=null/.test(ui), 'cerrar aborta y limpia el controlador');
check(!/createObjectURL/.test(ui) && !/setInterval\(/.test(ui) && !/setTimeout\(/.test(ui), 'la extracción no deja URLs ni timers');
check(/targetCoverageDate\)<String\(opened\)/.test(ui), 'el formulario no aplica cobertura anterior');
check(/El formulario ya tiene información/.test(ui) && /REC_VAC_EXTRACT_MSG\.kept/.test(ui), 'confirmación antes de reemplazar');
check(/force:true/.test(ui) && /dryRun:true/.test(ui), 'cancelar no aplica los datos');
check(!/rec-form-status/.test(ui) && !/rec-form-responsible/.test(ui), 'no sugiere estatus ni responsable');
check(/Información extraída\. Revisa los datos antes de crear la vacante/.test(indexHtml), 'confirmación de revisión');
check(/rec-vac-form-field--suggested/.test(indexHtml) && /Sugerido/.test(indexHtml), 'marca de dato sugerido con texto');
check(/recVacExtractClearSuggested/.test(ui) && /recVacExtractOnModalClose/.test(indexHtml), 'la marca se quita al editar o cerrar');
check(/apiJson\('\/api\/org\/recruitment\/vacancies\/extract'/.test(ui), 'el análisis usa el endpoint de extracción');
const submitFn = indexHtml.match(/async function recSubmitVacancy[\s\S]*?\n\}/)?.[0] || '';
check(submitFn.includes("apiJson('/api/org/recruitment/vacancies'") && !submitFn.includes('/extract'), 'el botón crear sigue el flujo normal');
check(/id==='modal-rec-vacancy'&&typeof recVacExtractOnModalClose/.test(indexHtml), 'cerrar el modal no deja una carga activa');
check(/max-width:720px/.test(indexHtml) && /rec-vac-extract-drop\{flex-wrap:wrap/.test(indexHtml), 'la zona se ajusta en móvil');
check(indexHtml === publicHtml, 'index.html y server/public/index.html son idénticos');
check(!/openai|tesseract|anthropic/i.test(serviceSrc), 'no agrega un proveedor externo de OCR o IA');

console.log('\n=== Office, abuso, tiempo y límite ===\n');

const documentXml =
  '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Puesto: Auxiliar contable</w:t></w:r></w:p></w:body></w:document>';
const typesXml =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
check(
  await rejects(zipStore([{ name: 'readme.txt', data: 'word/document.xml [Content_Types].xml' }]), 'falso.docx', RECRUITMENT_VACANCY_EXTRACT_MSG.format),
  'DOCX sin estructura Office',
);
check(
  await rejects(zipStore([{ name: 'word/document.xml', data: documentXml }]), 'parcial.docx', RECRUITMENT_VACANCY_EXTRACT_MSG.format),
  'DOCX sin Content_Types',
);
check(
  await rejects(
    zipStore([
      { name: '[Content_Types].xml', data: typesXml.replace('wordprocessingml', 'macroEnabled wordprocessingml') },
      { name: 'word/document.xml', data: documentXml },
    ]),
    'macros.docx',
    RECRUITMENT_VACANCY_EXTRACT_MSG.format,
  ),
  'rechaza macros de Office',
);
check(
  await rejects(
    zipStore([
      { name: '[Content_Types].xml', data: typesXml },
      { name: 'word/document.xml', data: documentXml },
      { name: 'word/vbaProject.bin', data: 'macro' },
    ]),
    'vba.docx',
    RECRUITMENT_VACANCY_EXTRACT_MSG.format,
  ),
  'rechaza vbaProject.bin',
);
check(await rejects(zipStore([{ name: '[Content_Types].xml', data: typesXml }, { name: 'word/document.xml', data: documentXml }]), 'activo.docm', RECRUITMENT_VACANCY_EXTRACT_MSG.format), 'rechaza DOCM');
check(
  await rejects(Buffer.from('%PDF-1.4\n%texto'), 'vacante.pdf', RECRUITMENT_VACANCY_EXTRACT_MSG.format, 'text/html'),
  'un PDF cuyo MIME es HTML no se acepta',
);
check(
  await rejects(Buffer.from('Puesto: Analista de nomina y prestaciones del area.'), 'notas.txt', RECRUITMENT_VACANCY_EXTRACT_MSG.format, 'application/pdf'),
  'un TXT cuyo MIME es PDF no se acepta',
);
check(
  await rejects(Buffer.from([0x00, 0x41, 0x42, 0x43]), 'binario.txt', RECRUITMENT_VACANCY_EXTRACT_MSG.format, 'text/plain'),
  'rechaza binario renombrado a TXT',
);
const bomb = zlib.deflateRawSync(Buffer.alloc(1024 * 1024, 0x61));
let bombRejected = false;
try {
  assertSafeRecruitmentVacancyDocx(zipStore([
    { name: '[Content_Types].xml', data: typesXml },
    { name: 'word/document.xml', data: bomb, method: 8, uncompressedSize: 100 },
  ]));
} catch (err) {
  bombRejected = err.message === RECRUITMENT_VACANCY_EXTRACT_MSG.format;
}
check(bombRejected, 'rechaza DOCX cuyo tamaño descomprimido no coincide');
check(
  await rejects(
    zipStore([
      { name: '[Content_Types].xml', data: typesXml, uncompressedSize: 9 * 1024 * 1024 },
      { name: 'word/document.xml', data: documentXml },
    ]),
    'grande.docx',
    RECRUITMENT_VACANCY_EXTRACT_MSG.format,
  ),
  'rechaza una entrada declarada por encima del tope',
);
check(
  await rejects(zipStore([{ name: '../word/document.xml', data: documentXml }, { name: '[Content_Types].xml', data: typesXml }]), 'ruta.docx', RECRUITMENT_VACANCY_EXTRACT_MSG.format),
  'rechaza una ruta interna con salto de directorio',
);

const filler = `${'linea de relleno del documento '.repeat(30)}\n`.repeat(400);
const capped = await analyzeRecruitmentVacancyFile({
  buffer: Buffer.from(`${filler}Puesto: TituloQueNoDebeEntrarPorElCorte`, 'utf8'),
  originalName: 'largo.txt',
  mimetype: 'text/plain',
});
check(!JSON.stringify(capped).includes('TituloQueNoDebeEntrarPorElCorte'), 'el texto posterior al límite no se analiza');
check((capped.suggestions.jobDescription?.value.length || 0) <= 8000, 'la descripción sugerida queda limitada');
check(filler.length > RECRUITMENT_VACANCY_EXTRACT_TEXT_CAP, 'el archivo de prueba supera el tope de texto');

let timeoutContinued = false;
let timeoutMessage = '';
try {
  await raceWithRecruitmentVacancyExtractTimeout(new Promise((resolve) => {
    setTimeout(() => {
      timeoutContinued = true;
      resolve('TARDE_SECRETO');
    }, 40);
  }), 15);
} catch (err) {
  timeoutMessage = err.message;
}
await new Promise((resolve) => setTimeout(resolve, 70));
check(timeoutMessage === RECRUITMENT_VACANCY_EXTRACT_MSG.fail && timeoutContinued, 'el tiempo de espera responde y no cancela el lector');

let slowPath = '';
let releaseSlowReader;
const slowReaderFinished = new Promise((resolve) => {
  releaseSlowReader = resolve;
});
let slowMessage = '';
let slowReturned = null;
let unhandledAfterTimeout = 0;
const onUnhandled = () => {
  unhandledAfterTimeout += 1;
};
process.on('unhandledRejection', onUnhandled);
try {
  slowReturned = await extractRecruitmentVacancyDocText(Buffer.from('abc'), {
    timeoutMs: 25,
    extractImpl(filePath) {
      slowPath = filePath;
      return slowReaderFinished.then(() => 'NO_DEBE_VOLVER');
    },
  });
} catch (err) {
  slowMessage = err.message;
}
check(slowMessage === RECRUITMENT_VACANCY_EXTRACT_MSG.fail, 'el DOC que se pasa de tiempo devuelve error controlado');
check(slowReturned == null && slowMessage !== 'NO_DEBE_VOLVER', 'la respuesta de timeout no incluye el texto tardío');
check(slowPath.includes(`${path.sep}rec-vac-`) && !slowPath.includes('abc') && fs.existsSync(slowPath), 'el temporal sigue mientras el lector no termina');
releaseSlowReader();
await slowReaderFinished;
await new Promise((resolve) => setTimeout(resolve, 30));
check(!fs.existsSync(slowPath), 'al terminar el lector se elimina el temporal');
check(unhandledAfterTimeout === 0 && slowMessage === RECRUITMENT_VACANCY_EXTRACT_MSG.fail, 'no hay unhandled rejection y la respuesta ya emitida no cambia');
process.removeListener('unhandledRejection', onUnhandled);

let releasedLate;
const lateReader = new Promise((resolve) => {
  releasedLate = resolve;
});
let latePath = '';
let lateMessage = '';
try {
  await extractRecruitmentVacancyDocText(Buffer.from('abc'), {
    timeoutMs: 20,
    extractImpl(filePath) {
      latePath = filePath;
      return lateReader.then(() => 'NO_DEBE_VOLVER');
    },
  });
} catch (err) {
  lateMessage = err.message;
}
await fs.promises.unlink(latePath);
releasedLate();
await lateReader;
await new Promise((resolve) => setTimeout(resolve, 20));
check(lateMessage === RECRUITMENT_VACANCY_EXTRACT_MSG.fail && !fs.existsSync(latePath), 'ENOENT en la limpieza tardía no cambia el error');

let okPath = '';
const docText = await extractRecruitmentVacancyDocText(Buffer.from('abc'), {
  extractImpl(filePath) {
    okPath = filePath;
    return 'Puesto: Recepcionista de almacen';
  },
});
check(docText.includes('Recepcionista') && okPath && !fs.existsSync(okPath), 'el temporal DOC se elimina al terminar');

let badPath = '';
let badMessage = '';
try {
  await extractRecruitmentVacancyDocText(Buffer.from('abc'), {
    extractImpl(filePath) {
      badPath = filePath;
      throw new Error('SECRETO_PARSER');
    },
  });
} catch (err) {
  badMessage = err.message;
}
check(badMessage === 'SECRETO_PARSER' && badPath && !fs.existsSync(badPath), 'el error del lector se conserva y el temporal se elimina');

const limiterSrc = fs.readFileSync(path.join(rootDir, 'src/middleware/rateLimit.middleware.js'), 'utf8');
const limiterBlock = limiterSrc.slice(limiterSrc.indexOf('recruitmentVacancyExtractLimiter'), limiterSrc.indexOf('timeclockHeartbeatLimiter'));
check(limiterBlock.includes('req.session') && !/req\.body|req\.query|req\.headers/.test(limiterBlock), 'la clave del límite sale de la sesión');
check(!routes.slice(routes.indexOf("router.get('/metrics'")).includes('recruitmentVacancyExtractLimiter'), 'el límite no cubre el resto de vacantes');
check(!routes.includes('recruitmentVacancyExtractLimiter') || routes.indexOf('recruitmentVacancyExtractLimiter') < routes.indexOf('resume/parse') || !routes.slice(routes.indexOf("'/candidates/") ).includes('recruitmentVacancyExtractLimiter'), 'el límite no envuelve el análisis de CV');

const { default: express } = await import('express');
const { default: multer } = await import('multer');
const { recruitmentVacancyExtractLimiter } = await import('../src/middleware/rateLimit.middleware.js');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function requestOnce(server, { method = 'POST', url = '/', user = '', body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: url,
      method,
      headers: { ...headers, 'x-test-user': user },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch { json = null; }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    if (body) req.end(body);
    else req.end();
  });
}

const limitApp = express();
limitApp.use((req, _res, next) => {
  req.session = { userId: req.headers['x-test-user'] || '' };
  next();
});
limitApp.post('/extract', recruitmentVacancyExtractLimiter, (_req, res) => res.json({ ok: true }));
limitApp.post('/vacancies', (_req, res) => res.json({ created: true }));
const limitServer = await listen(limitApp);
let limited = null;
for (let i = 0; i < 21; i += 1) {
  limited = await requestOnce(limitServer, { url: '/extract', user: 'admin-org-a' });
}
const otherOrg = await requestOnce(limitServer, { url: '/extract', user: 'admin-org-b' });
const manual = await requestOnce(limitServer, { url: '/vacancies', user: 'admin-org-a' });
limitServer.close();
check(limited.status === 429 && limited.json?.error === 'RATE_LIMIT', 'el análisis 21 responde 429');
check(otherOrg.status === 200, 'otra sesión no comparte el contador');
check(manual.status === 200 && manual.json?.created === true, 'crear vacante manual no usa este límite');

function multipart(parts) {
  const boundary = '----mind24bound';
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${part.name}"\r\nContent-Type: text/plain\r\n\r\n`));
    chunks.push(part.body);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}
const uploadApp = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: RECRUITMENT_VACANCY_EXTRACT_MAX_BYTES, files: 1 } });
uploadApp.post('/extract', (req, res) => {
  upload.single('file')(req, res, (err) => {
    const mapped = recruitmentVacancyExtractUploadFailure(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    return res.json({ ok: true });
  });
});
const uploadServer = await listen(uploadApp);
const tooBig = await requestOnce(uploadServer, {
  url: '/extract',
  body: multipart([{ name: 'grande.txt', body: Buffer.alloc(RECRUITMENT_VACANCY_EXTRACT_MAX_BYTES + 1, 0x61) }]).body,
  headers: { 'Content-Type': 'multipart/form-data; boundary=----mind24bound' },
});
const twoFiles = multipart([
  { name: 'uno.txt', body: Buffer.from('Puesto: Uno') },
  { name: 'dos.txt', body: Buffer.from('Puesto: Dos') },
]);
const many = await requestOnce(uploadServer, {
  url: '/extract',
  body: twoFiles.body,
  headers: { 'Content-Type': `multipart/form-data; boundary=${twoFiles.boundary}` },
});
uploadServer.close();
check(tooBig.status === 400 && tooBig.json?.message === RECRUITMENT_VACANCY_EXTRACT_MSG.size, 'Multer responde 400 si el archivo supera 10 MB');
check(many.status === 400 && many.json?.message === RECRUITMENT_VACANCY_EXTRACT_MSG.format && many.status !== 500, 'más de un archivo no produce un 500');

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ extracción de vacante\n');

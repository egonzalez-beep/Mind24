import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { z } from 'zod';
import { extractTextFromResumeBuffer } from './recruitmentCandidateResumeParse.service.js';

/** Alineado con documentos de vacante y CV. Sin OCR: las imágenes no se aceptan. */
export const RECRUITMENT_VACANCY_EXTRACT_MAX_BYTES = 10 * 1024 * 1024;
export const RECRUITMENT_VACANCY_EXTRACT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt'];
export const RECRUITMENT_VACANCY_EXTRACT_TEXT_CAP = 20_000;
export const RECRUITMENT_VACANCY_EXTRACT_TIMEOUT_MS = 15_000;

export const RECRUITMENT_VACANCY_EXTRACT_MSG = {
  format: 'Este formato de archivo no es compatible.',
  size: 'El archivo supera el tamaño permitido.',
  empty: 'No encontramos suficiente información para completar la vacante. Puedes continuar manualmente.',
  fail: 'No pudimos analizar el archivo. Intenta nuevamente o captura la vacante manualmente.',
};

const JD_CAP = 8_000;
const TITLE_CAP = 300;
const SHORT_CAP = 300;

const SUGGESTION_KEYS = [
  'title',
  'clientName',
  'location',
  'positionsTotal',
  'openedAt',
  'targetCoverageDate',
  'jobDescription',
];

const confidenceSchema = z.enum(['high', 'medium']);
const shortSuggestionSchema = z
  .object({ value: z.string().min(1).max(120), confidence: confidenceSchema })
  .strict();
const titleSuggestionSchema = z
  .object({ value: z.string().min(1).max(TITLE_CAP), confidence: confidenceSchema })
  .strict();
const dateSuggestionSchema = z
  .object({ value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), confidence: confidenceSchema })
  .strict();
const positionsSuggestionSchema = z
  .object({ value: z.number().int().min(1).max(9999), confidence: confidenceSchema })
  .strict();
const descriptionSuggestionSchema = z
  .object({ value: z.string().min(1).max(JD_CAP), confidence: confidenceSchema })
  .strict();

const responseSchema = z
  .object({
    ok: z.literal(true),
    fileName: z.string().min(1).max(120),
    suggestions: z
      .object({
        title: titleSuggestionSchema.optional(),
        clientName: shortSuggestionSchema.optional(),
        location: shortSuggestionSchema.optional(),
        positionsTotal: positionsSuggestionSchema.optional(),
        openedAt: dateSuggestionSchema.optional(),
        targetCoverageDate: dateSuggestionSchema.optional(),
        jobDescription: descriptionSuggestionSchema.optional(),
      })
      .strict(),
  })
  .strict();

const DOCX_MAX_ENTRIES = 40;
const DOCX_MAX_ENTRY_UNCOMPRESSED = 8 * 1024 * 1024;
const DOCX_MAX_TOTAL_UNCOMPRESSED = 20 * 1024 * 1024;
const GENERIC_MIME = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/binary']);
const MIME_BY_KIND = {
  pdf: ['application/pdf'],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/x-zip-compressed',
  ],
  doc: ['application/msword'],
  txt: ['text/plain', 'text/txt', 'application/text'],
};

const LABELED_FIELDS = [
  ['title', ['puesto', 'titulo', 'titulo de la vacante', 'nombre del puesto', 'vacante solicitada', 'posicion', 'perfil solicitado', 'cargo']],
  ['clientName', ['cliente', 'empresa', 'empresa contratante', 'compania', 'razon social']],
  ['location', ['ubicacion', 'lugar de trabajo', 'centro de trabajo', 'domicilio', 'ciudad', 'sede']],
  ['positionsTotal', ['numero de posiciones', 'numero de vacantes', 'numero de plazas', 'posiciones', 'vacantes', 'plazas']],
  ['openedAt', ['fecha de apertura', 'fecha de inicio', 'apertura']],
  ['targetCoverageDate', ['fecha limite de cobertura', 'fecha objetivo de cobertura', 'fecha de cobertura', 'fecha objetivo', 'fecha limite', 'cobertura']],
];

const TABLE_FIELDS = LABELED_FIELDS.flatMap(([key, labels]) => labels.map((label) => [label, key]));
const LABOR_HEADERS = [
  ['horario', 'Horario'],
  ['sueldo', 'Sueldo'],
  ['salario', 'Sueldo'],
  ['prestaciones', 'Prestaciones'],
];
const HEADER_INDEX = new Map([...TABLE_FIELDS, ...LABOR_HEADERS.map(([label, name]) => [label, name])]);

const SECTION_DEFS = [
  ['descripcion de la vacante', 'Descripción de la vacante'],
  ['descripcion del puesto', 'Descripción del puesto'],
  ['descripcion de puesto', 'Descripción de puesto'],
  ['descripcion', 'Descripción'],
  ['perfil del puesto', 'Perfil del puesto'],
  ['perfil solicitado', 'Perfil solicitado'],
  ['funciones principales', 'Funciones principales'],
  ['funciones', 'Funciones'],
  ['responsabilidades', 'Responsabilidades'],
  ['requisitos', 'Requisitos'],
  ['escolaridad', 'Escolaridad'],
  ['experiencia', 'Experiencia'],
  ['conocimientos', 'Conocimientos'],
  ['disponibilidad', 'Disponibilidad'],
  ['actividades', 'Actividades'],
  ['habilidades', 'Habilidades'],
  ['prestaciones', 'Prestaciones'],
  ['horario', 'Horario'],
  ['sueldo', 'Sueldo'],
  ['salario', 'Sueldo'],
  ['condiciones y oferta', 'Condiciones y oferta'],
  ['modalidad', 'Modalidad'],
  ['tipo de contrato', 'Tipo de contrato'],
  ['tipo de empleo', 'Tipo de empleo'],
  ['tipo de contratacion', 'Tipo de contratación'],
  ['informacion adicional', 'Información adicional'],
];

const GENERIC_TITLES = new Set([
  'vacante',
  'vacante de prueba',
  'oferta laboral',
  'oferta de empleo',
  'descripcion de puesto',
  'descripcion de la vacante',
  'descripcion del puesto',
  'job description',
  'solicitud de personal',
  'perfil de puesto',
  'perfil del puesto',
  'requisicion de personal',
  'prueba de extraccion',
]);

const NON_TITLE_PREFIXES = [
  'fecha limite de cobertura',
  'fecha objetivo de cobertura',
  'fecha de cobertura',
  'fecha de apertura',
  'fecha de inicio',
  'fecha objetivo',
  'fecha limite',
  'numero de posiciones',
  'numero de vacantes',
  'numero de plazas',
  'lugar de trabajo',
  'centro de trabajo',
  'razon social',
  'empresa contratante',
  'cliente',
  'empresa',
  'compania',
  'ubicacion',
  'domicilio',
  'ciudad',
  'sede',
  'posiciones',
  'vacantes',
  'plazas',
  'apertura',
  'cobertura',
];

const KNOWN_LINE_PHRASES = [
  ...new Set([
    ...HEADER_INDEX.keys(),
    ...SECTION_DEFS.map(([key]) => key),
    ...GENERIC_TITLES,
    'prueba de extraccion',
  ]),
].sort((a, b) => b.length - a.length);

const BLANK_RE =
  /^(?:n\/?a|s\/n|ninguno|ninguna|no\s+especificado|no\s+especifica|no\s+disponible|por\s+definir|pendiente|sin\s+especificar|-+|—+|n\/d)$/i;

const MONTHS = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function extractError(message) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  return err;
}

function fold(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function plainText(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isBlankToken(value) {
  const s = String(value || '').trim();
  return !s || BLANK_RE.test(s);
}

function clip(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Deja de esperar al lector a los 15 s y responde un error controlado.
 * No cancela pdf-parse, mammoth ni word-extractor: ese trabajo puede seguir
 * en segundo plano hasta que termine. El resultado tardío se descarta.
 */
export function raceWithRecruitmentVacancyExtractTimeout(promise, ms = RECRUITMENT_VACANCY_EXTRACT_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.fail)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function isDeclaredRecruitmentVacancyExtractFile(originalName = '') {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  return RECRUITMENT_VACANCY_EXTRACT_EXTENSIONS.includes(ext);
}

export function sanitizeRecruitmentVacancyExtractFileName(originalName = '') {
  const base = path
    .basename(String(originalName || 'vacante'))
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>"']/g, '')
    .trim();
  return (base || 'vacante').slice(0, 120);
}

function isRejectedSignature(buffer) {
  if (!buffer || buffer.length < 2) return false;
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) return true;
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return true;
  }
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return true;
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return true;
  }
  if (buffer.length >= 6) {
    const gif = buffer.toString('ascii', 0, 6);
    if (gif === 'GIF87a' || gif === 'GIF89a') return true;
  }
  const head = buffer.subarray(0, Math.min(buffer.length, 500)).toString('utf8').trim().toLowerCase();
  if (
    head.startsWith('<!doctype') ||
    head.startsWith('<html') ||
    head.startsWith('<svg') ||
    head.startsWith('<?xml') ||
    head.startsWith('<script')
  ) {
    return true;
  }
  return false;
}

function mimeAgrees(kind, mimetype) {
  const mime = String(mimetype || '').split(';')[0].trim().toLowerCase();
  if (
    mime.startsWith('image/') ||
    mime === 'text/html' ||
    mime === 'application/xhtml+xml' ||
    mime === 'image/svg+xml' ||
    mime === 'text/xml' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    mime === 'text/javascript' ||
    mime === 'application/x-msdownload' ||
    mime === 'application/x-dosexec' ||
    mime === 'application/vnd.ms-word.document.macroenabled.12'
  ) {
    return false;
  }
  if (GENERIC_MIME.has(mime)) return true;
  return (MIME_BY_KIND[kind] || []).includes(mime);
}

function isSafeZipName(name) {
  if (!name || name.length > 180) return false;
  if (name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false;
  const parts = name.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..');
}

function findZipEocd(buffer) {
  const min = Math.max(0, buffer.length - (22 + 65535));
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function readZipCentralDirectory(buffer) {
  const eocd = findZipEocd(buffer);
  if (eocd < 0 || eocd + 22 > buffer.length) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
  const entries = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
  }
  if (!entries || entries > DOCX_MAX_ENTRIES) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
  if (cdOffset + cdSize > buffer.length) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
  const out = [];
  let cursor = cdOffset;
  for (let n = 0; n < entries; n += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const flags = buffer.readUInt16LE(cursor + 8);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > buffer.length) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
    const name = buffer.toString('utf8', nameStart, nameEnd);
    out.push({ name, method, flags, compressedSize, uncompressedSize, localOffset });
    cursor = nameEnd + extraLen + commentLen;
  }
  if (cursor > cdOffset + cdSize) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
  return out;
}

function readZipLocalData(buffer, entry) {
  const start = entry.localOffset;
  if (start + 30 > buffer.length || buffer.readUInt32LE(start) !== 0x04034b50) {
    throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
  }
  const nameLen = buffer.readUInt16LE(start + 26);
  const extraLen = buffer.readUInt16LE(start + 28);
  const dataStart = start + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
  const localName = buffer.toString('utf8', start + 30, start + 30 + nameLen);
  if (!isSafeZipName(localName)) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
  return buffer.subarray(dataStart, dataEnd);
}

/** Inspecciona el paquete en memoria. No lo extrae al disco ni ejecuta macros. */
export function assertSafeRecruitmentVacancyDocx(buffer) {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
  }
  const entries = readZipCentralDirectory(buffer);
  let total = 0;
  const names = new Set();
  const inflated = new Map();
  for (const entry of entries) {
    if (!isSafeZipName(entry.name) || entry.flags & 0x1 || (entry.method !== 0 && entry.method !== 8)) {
      throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
    }
    if (
      entry.compressedSize === 0xffffffff ||
      entry.uncompressedSize === 0xffffffff ||
      entry.uncompressedSize > DOCX_MAX_ENTRY_UNCOMPRESSED ||
      entry.compressedSize > buffer.length
    ) {
      throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
    }
    const ratio = entry.compressedSize > 0 ? entry.uncompressedSize / entry.compressedSize : entry.uncompressedSize;
    if (entry.uncompressedSize > 256 * 1024 && ratio > 100) {
      throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
    }
    total += entry.uncompressedSize;
    if (total > DOCX_MAX_TOTAL_UNCOMPRESSED) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
    const data = readZipLocalData(buffer, entry);
    let plain;
    if (entry.method === 0) {
      if (data.length !== entry.uncompressedSize) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
      plain = data;
    } else {
      try {
        plain = zlib.inflateRawSync(data, { maxOutputLength: DOCX_MAX_ENTRY_UNCOMPRESSED });
      } catch {
        throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
      }
      if (plain.length > entry.uncompressedSize + 64) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
    }
    names.add(entry.name);
    inflated.set(entry.name, plain);
  }
  if (!names.has('[Content_Types].xml') || !names.has('word/document.xml')) {
    throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
  }
  for (const name of names) {
    if (name.toLowerCase().endsWith('vbaproject.bin')) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
  }
  const types = inflated.get('[Content_Types].xml').toString('utf8');
  if (/macroenabled/i.test(types) || !/word\/document\.xml/i.test(types) || !/wordprocessingml/i.test(types)) {
    throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
  }
  if (!inflated.get('word/document.xml')?.length) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
}

function isOleCompoundFile(buffer) {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1
  );
}

export function classifyRecruitmentVacancyExtractFile(buffer, originalName = '', mimetype = '') {
  if (!buffer || !buffer.length) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.empty);
  if (buffer.length > RECRUITMENT_VACANCY_EXTRACT_MAX_BYTES) {
    throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.size);
  }
  const ext = path.extname(String(originalName || '')).toLowerCase();
  if (!RECRUITMENT_VACANCY_EXTRACT_EXTENSIONS.includes(ext) || ext === '.docm') {
    throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
  }
  if (isRejectedSignature(buffer)) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);

  let kind = '';
  if (ext === '.pdf') {
    if (!buffer.subarray(0, 5).toString('ascii').startsWith('%PDF')) {
      throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
    }
    kind = 'pdf';
  } else if (ext === '.docx') {
    assertSafeRecruitmentVacancyDocx(buffer);
    kind = 'docx';
  } else if (ext === '.doc') {
    if (!isOleCompoundFile(buffer)) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
    kind = 'doc';
  } else if (ext === '.txt') {
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
    if (buffer.subarray(0, 5).toString('ascii').startsWith('%PDF')) {
      throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
    }
    const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
    for (const byte of sample) {
      if (byte === 9 || byte === 10 || byte === 13) continue;
      if (byte < 32) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
    }
    kind = 'txt';
  }
  if (!kind || !mimeAgrees(kind, mimetype)) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.format);
  return kind;
}

export function recruitmentVacancyExtractUploadFailure(err) {
  if (!err) return null;
  if (err.code === 'LIMIT_FILE_SIZE') {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: RECRUITMENT_VACANCY_EXTRACT_MSG.size } };
  }
  return { status: 400, body: { error: 'VALIDATION_ERROR', message: RECRUITMENT_VACANCY_EXTRACT_MSG.format } };
}

function isoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseExplicitDate(raw) {
  const s = String(raw || '').trim();
  let match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return isoDate(match[1], match[2], match[3]);
  match = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    if (day <= 12 && month <= 12) return null;
    return isoDate(match[3], month, day);
  }
  match = s.match(/^(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+de\s+(\d{4})$/);
  if (match) {
    const month = MONTHS[fold(match[2])];
    if (!month) return null;
    return isoDate(match[3], month, match[1]);
  }
  return null;
}

function normLine(value) {
  return fold(String(value || ''))
    .replace(/[\u0000-\u001F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[:\-–]+$/g, '')
    .trim();
}

function cleanCell(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(value) {
  return cleanCell(value).split(/\s+/).filter(Boolean).length;
}

function isPageMarker(value) {
  return /^--\s*\d+\s+of\s+\d+\s*--$/i.test(cleanCell(value));
}

function isPageChrome(value) {
  const norm = normLine(value);
  return /^documento de prueba\s*-\s*pagina\s+\d+$/.test(norm) || /^pagina\s+\d+(\s+de\s+\d+)?$/.test(norm);
}

function isPruebaHeading(value) {
  return normLine(value) === 'prueba de extraccion';
}

function isConfidentiality(value) {
  return /confidencial/.test(normLine(value));
}

function isGenericTitle(value) {
  return GENERIC_TITLES.has(normLine(value));
}

function startsWithNonTitleLabel(value) {
  const norm = normLine(value);
  return NON_TITLE_PREFIXES.some((prefix) => norm === prefix || norm.startsWith(`${prefix} `));
}

function isAmbiguousNumericDate(raw) {
  const match = cleanCell(raw).match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (!match) return false;
  return Number(match[1]) <= 12 && Number(match[2]) <= 12;
}

function parsePositions(value) {
  const text = cleanCell(value);
  if (!text || isBlankToken(text)) return null;
  if (/^\d{1,4}$/.test(text)) {
    const n = Number(text);
    return n >= 1 && n <= 9999 ? n : null;
  }
  const labeled = text.match(/^(\d{1,4})\s+(?:posiciones|vacantes|plazas)\b\.?$/i);
  if (!labeled) return null;
  const n = Number(labeled[1]);
  return n >= 1 && n <= 9999 ? n : null;
}

function lookupHeader(value) {
  return HEADER_INDEX.get(normLine(value)) || null;
}

function flattenedHeaders(value) {
  let rest = normLine(value);
  if (!rest) return null;
  const found = [];
  while (rest) {
    const hit = KNOWN_LINE_PHRASES.find((phrase) => HEADER_INDEX.has(phrase) && (rest === phrase || rest.startsWith(`${phrase} `)));
    if (!hit) return null;
    found.push(hit);
    rest = rest.slice(hit.length).trim();
  }
  return found.length >= 2 ? found : null;
}

function matchLabeledValue(line) {
  const raw = cleanCell(line);
  const sep = raw.search(/[:\-–]/);
  if (sep <= 0) return null;
  const label = normLine(raw.slice(0, sep));
  const value = cleanCell(raw.slice(sep + 1));
  if (!label || !value || value.length > 300) return null;
  for (const [key, labels] of LABELED_FIELDS) {
    if (labels.includes(label)) return { key, value };
  }
  return null;
}

function matchLabelOnly(line) {
  const norm = normLine(line);
  for (const [key, labels] of LABELED_FIELDS) {
    if (labels.includes(norm)) return key;
  }
  return null;
}

function matchSection(line) {
  if (flattenedHeaders(line)) return null;
  const raw = cleanCell(line);
  const norm = normLine(line);
  for (const [key, name] of SECTION_DEFS) {
    if (norm !== key && !norm.startsWith(`${key} `)) continue;
    const rest = norm.slice(key.length).trim();
    if (!rest) return { name, inline: '' };
    if (HEADER_INDEX.has(rest) || flattenedHeaders(rest)) return null;
    const inline = raw.split(/\s+/).slice(key.split(' ').length).join(' ').replace(/^[:\-–]\s*/, '');
    return { name, inline: cleanCell(inline) };
  }
  return null;
}

function isRejectedTitle(line) {
  const value = cleanCell(line);
  const norm = normLine(value);
  if (!norm || isBlankToken(value) || isGenericTitle(value) || isPageMarker(value) || isPageChrome(value)) return true;
  if (isPruebaHeading(value) || isConfidentiality(value) || startsWithNonTitleLabel(value)) return true;
  if (HEADER_INDEX.has(norm) || parseExplicitDate(value) || isAmbiguousNumericDate(value)) return true;
  if (/^\d+$/.test(norm) || value.includes('@') || /[_0-9]/.test(value)) return true;
  if (/^(documento ficticio|documento de prueba|este documento|este archivo)\b/.test(norm)) return true;
  if (wordCount(value) > 8 || value.length > 80) return true;
  return false;
}

function isPlausibleTitle(line) {
  const value = cleanCell(line);
  if (isRejectedTitle(value)) return false;
  if (value.length < 8 || !/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(value)) return false;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return true;
  return words.length === 1 && /^[A-Za-zÁÉÍÓÚáéíóúÑñ]+$/.test(words[0]);
}

function valueFitsLabel(key, value) {
  if (isBlankToken(value) || isPageMarker(value) || matchLabelOnly(value) || flattenedHeaders(value)) return false;
  if (key === 'positionsTotal') return parsePositions(value) != null;
  if (key === 'openedAt' || key === 'targetCoverageDate') return Boolean(parseExplicitDate(value) || isAmbiguousNumericDate(value));
  if (key === 'title') return cleanCell(value).length >= 2 && cleanCell(value).length <= 120 && !isGenericTitle(value);
  const text = cleanCell(value);
  return text.length >= 2 && text.length <= 120 && wordCount(text) <= 12;
}

function loosePositions(lines) {
  for (const line of lines.slice(0, 30)) {
    const n = parsePositions(line);
    if (n && !/^\d+$/.test(cleanCell(line))) return n;
  }
  return null;
}

function mergeSplitHeadings(lines) {
  const merged = [];
  for (let i = 0; i < lines.length; i += 1) {
    const next = lines[i + 1];
    const combined = next ? normLine(`${lines[i]} ${next}`) : '';
    const first = normLine(lines[i]);
    if (
      next &&
      KNOWN_LINE_PHRASES.includes(combined) &&
      combined.length > first.length &&
      wordCount(next) <= 4 &&
      !/[.;:]$/.test(cleanCell(next))
    ) {
      merged.push(cleanCell(`${lines[i]} ${next}`));
      i += 1;
      continue;
    }
    merged.push(lines[i]);
  }
  return merged;
}

function emptyCapture() {
  return { fields: {}, dates: {} };
}

function putField(bucket, key, value, confidence) {
  if (bucket.fields[key] || bucket.dates[key] || isBlankToken(value)) return false;
  if (key === 'title') {
    const title = clip(cleanCell(value), TITLE_CAP);
    if (title.length < 2 || title.length > 120 || isGenericTitle(title)) return false;
    bucket.fields.title = { value: title, confidence };
    return true;
  }
  if (key === 'clientName' || key === 'location') {
    const short = clip(cleanCell(value), SHORT_CAP);
    if (short.length < 2 || short.length > 120) return false;
    bucket.fields[key] = { value: short, confidence };
    return true;
  }
  if (key === 'positionsTotal') {
    const n = parsePositions(value);
    if (!n) return false;
    bucket.fields.positionsTotal = { value: n, confidence };
    return true;
  }
  if (key === 'openedAt' || key === 'targetCoverageDate') {
    bucket.dates[key] = { raw: cleanCell(value), confidence };
    return true;
  }
  return false;
}

function interpretTables(tables) {
  const bucket = emptyCapture();
  const labor = [];
  const list = Array.isArray(tables) ? tables : [];
  const laborNames = new Set(LABOR_HEADERS.map(([, name]) => name));
  for (const table of list) {
    if (!Array.isArray(table) || table.some((row) => !Array.isArray(row))) continue;
    const rows = table.map((row) => row.map((cell) => cleanCell(cell)));
    let ambiguous = false;
    const local = emptyCapture();
    const localLabor = [];
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];
      const mapped = row.map((cell) => lookupHeader(cell));
      const recognized = mapped.filter(Boolean);
      if (!recognized.length) continue;
      if (new Set(recognized).size !== recognized.length) {
        ambiguous = true;
        break;
      }
      const next = rows[r + 1];
      if (!next) continue;
      if (next.some((cell) => lookupHeader(cell))) continue;
      if (next.length !== row.length) {
        ambiguous = true;
        break;
      }
      row.forEach((cell, index) => {
        const token = lookupHeader(cell);
        const value = next[index];
        if (!token || !value) return;
        if (laborNames.has(token)) {
          localLabor.push({ name: token, lines: [value] });
          return;
        }
        putField(local, token, value, 'high');
      });
      r += 1;
    }
    if (ambiguous) continue;
    for (const [key, item] of Object.entries(local.fields)) {
      if (!bucket.fields[key]) bucket.fields[key] = item;
      else if (String(bucket.fields[key].value) !== String(item.value)) delete bucket.fields[key];
    }
    for (const [key, item] of Object.entries(local.dates)) {
      if (!bucket.dates[key]) bucket.dates[key] = item;
      else if (normLine(bucket.dates[key].raw) !== normLine(item.raw)) delete bucket.dates[key];
    }
    labor.push(...localLabor);
  }
  return { ...bucket, labor };
}

function resolveDate(textItem, tableItem) {
  const sources = [textItem, tableItem].filter(Boolean);
  if (!sources.length) return { status: 'absent' };
  const parsed = sources.map((item) => ({ ...item, iso: parseExplicitDate(item.raw) }));
  const isos = [...new Set(parsed.map((item) => item.iso).filter(Boolean))];
  if (isos.length > 1) return { status: 'conflict' };
  if (isos.length === 1) {
    const winner = parsed.find((item) => item.iso === isos[0]);
    return { status: 'ok', iso: isos[0], confidence: winner.confidence || 'high' };
  }
  if (parsed.some((item) => isAmbiguousNumericDate(item.raw))) return { status: 'ambiguous' };
  return { status: 'absent' };
}

function mergeField(textItem, tableItem) {
  if (!textItem && !tableItem) return null;
  if (textItem && !tableItem) return textItem;
  if (!textItem && tableItem) return tableItem;
  if (String(textItem.value) === String(tableItem.value) || normLine(textItem.value) === normLine(tableItem.value)) {
    return { value: tableItem.value || textItem.value, confidence: 'high' };
  }
  if (textItem.confidence === 'high' && tableItem.confidence === 'high') return null;
  return tableItem.confidence === 'high' ? tableItem : textItem;
}

export function parseRecruitmentVacancyText(raw, options = {}) {
  const text = plainText(raw).slice(0, RECRUITMENT_VACANCY_EXTRACT_TEXT_CAP);
  const lines = mergeSplitHeadings(
    text
      .split('\n')
      .map((line) => line.replace(/^#+\s*/, '').replace(/\t+/g, ' ').trim())
      .filter(Boolean)
      .filter((line) => !isPageMarker(line)),
  );
  const fromTable = interpretTables(options.tables);
  if (
    text.length < 3 &&
    !Object.keys(fromTable.fields).length &&
    !Object.keys(fromTable.dates).length &&
    !fromTable.labor.length
  ) {
    return {};
  }
  const fromText = emptyCapture();
  const consumed = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    if (consumed.has(i) || isPruebaHeading(lines[i])) continue;
    const labeled = matchLabeledValue(lines[i]);
    if (labeled) {
      if (!(labeled.key === 'title' && cleanCell(labeled.value).length > 120)) {
        putField(fromText, labeled.key, labeled.value, 'high');
      }
      consumed.add(i);
      continue;
    }
    const key = matchLabelOnly(lines[i]);
    const next = lines[i + 1];
    if (!key || !next || matchLabelOnly(next) || matchLabeledValue(next) || !valueFitsLabel(key, next)) continue;
    if (putField(fromText, key, next, 'high')) {
      consumed.add(i);
      consumed.add(i + 1);
      i += 1;
    }
  }

  if (!fromText.fields.title) {
    for (let i = 0; i < lines.length; i += 1) {
      if (consumed.has(i) || !isPlausibleTitle(lines[i])) continue;
      fromText.fields.title = { value: clip(lines[i], TITLE_CAP), confidence: 'medium' };
      consumed.add(i);
      break;
    }
  }
  if (!fromText.fields.positionsTotal) {
    const n = loosePositions(lines.filter((_, index) => !consumed.has(index)));
    if (n) fromText.fields.positionsTotal = { value: n, confidence: 'medium' };
  }

  const suggestions = {};
  for (const key of ['title', 'clientName', 'location', 'positionsTotal']) {
    const merged = mergeField(fromText.fields[key], fromTable.fields[key]);
    if (merged) suggestions[key] = merged;
  }
  const opened = resolveDate(fromText.dates.openedAt, fromTable.dates.openedAt);
  const coverage = resolveDate(fromText.dates.targetCoverageDate, fromTable.dates.targetCoverageDate);
  const datePairBroken =
    opened.status !== 'absent' && coverage.status !== 'absent' && (opened.status !== 'ok' || coverage.status !== 'ok');
  if (!datePairBroken) {
    if (opened.status === 'ok') suggestions.openedAt = { value: opened.iso, confidence: opened.confidence };
    if (coverage.status === 'ok') {
      suggestions.targetCoverageDate = { value: coverage.iso, confidence: coverage.confidence };
    }
    if (
      suggestions.openedAt &&
      suggestions.targetCoverageDate &&
      suggestions.targetCoverageDate.value < suggestions.openedAt.value
    ) {
      delete suggestions.targetCoverageDate;
    }
  }

  const sections = [];
  const leftover = [];
  let current = null;
  let stop = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (consumed.has(i)) continue;
    const line = lines[i];
    if (isPruebaHeading(line)) {
      stop = true;
      current = null;
      continue;
    }
    if (stop || isPageChrome(line) || isConfidentiality(line)) continue;
    if (flattenedHeaders(line)) {
      current = null;
      continue;
    }
    const section = matchSection(line);
    if (section) {
      current = { name: section.name, lines: [] };
      sections.push(current);
      if (section.inline && !isBlankToken(section.inline)) current.lines.push(section.inline);
      continue;
    }
    if (current) current.lines.push(line);
    else leftover.push(line);
  }
  for (const block of fromTable.labor) {
    const body = block.lines.join(' ');
    if (sections.some((section) => section.name === block.name && normLine(section.lines.join(' ')) === normLine(body))) continue;
    sections.push(block);
  }

  const assignedLines = new Set(
    [suggestions.title?.value, suggestions.clientName?.value, suggestions.location?.value, suggestions.positionsTotal?.value]
      .filter((value) => value != null)
      .map((value) => normLine(value)),
  );
  const parts = [];
  for (const section of sections) {
    const bodyLines = [];
    for (const line of section.lines.map((item) => cleanCell(item)).filter(Boolean)) {
      if (isPageMarker(line) || isPageChrome(line) || assignedLines.has(normLine(line))) continue;
      if (bodyLines.length && normLine(bodyLines[bodyLines.length - 1]) === normLine(line)) continue;
      bodyLines.push(line);
    }
    if (!bodyLines.length) {
      if (section.name === 'Requisitos' || section.name === 'Responsabilidades') parts.push(section.name);
      continue;
    }
    parts.push(`${section.name}\n${bodyLines.join('\n')}`);
  }
  let jd = parts.join('\n\n').trim();
  let confidence = 'high';
  if (!jd) {
    const restLines = [];
    for (const line of leftover) {
      if (isPageMarker(line) || isPageChrome(line) || isGenericTitle(line) || assignedLines.has(normLine(line))) continue;
      if (restLines.length && normLine(restLines[restLines.length - 1]) === normLine(line)) continue;
      restLines.push(cleanCell(line));
    }
    const rest = restLines.join('\n').trim();
    if (rest.length >= 40 && !isBlankToken(rest)) {
      jd = rest;
      confidence = 'medium';
    }
  }
  if (jd) {
    jd = jd.replace(/[<>]/g, '').replace(/\n{3,}/g, '\n\n').slice(0, JD_CAP).trim();
    if (jd && !isBlankToken(jd)) suggestions.jobDescription = { value: jd, confidence };
  }
  return suggestions;
}

function suggestionText(value, max) {
  const clean = plainText(value).replace(/[<>]/g, '').slice(0, max).trim();
  if (!clean || isBlankToken(clean) || /[<>]/.test(clean)) return '';
  return clean;
}

export function buildRecruitmentVacancyExtractResponse(fileName, suggestions) {
  const clean = {};
  const source = suggestions && typeof suggestions === 'object' ? suggestions : {};
  for (const key of SUGGESTION_KEYS) {
    const item = source[key];
    if (!item || (item.confidence !== 'high' && item.confidence !== 'medium')) continue;
    if (item.value == null || item.value === '') continue;
    if (key === 'positionsTotal') {
      const n = Number(item.value);
      if (!Number.isInteger(n) || n < 1 || n > 9999) continue;
      clean.positionsTotal = { value: n, confidence: item.confidence };
      continue;
    }
    if (key === 'openedAt' || key === 'targetCoverageDate') {
      const iso = parseExplicitDate(item.value) || (typeof item.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.value) ? item.value : null);
      if (!iso) continue;
      clean[key] = { value: iso, confidence: item.confidence };
      continue;
    }
    const max = key === 'jobDescription' ? JD_CAP : key === 'title' ? TITLE_CAP : 120;
    const value = suggestionText(item.value, max);
    if (!value) continue;
    clean[key] = { value, confidence: item.confidence };
  }
  if (
    clean.openedAt &&
    clean.targetCoverageDate &&
    clean.targetCoverageDate.value < clean.openedAt.value
  ) {
    delete clean.targetCoverageDate;
  }
  if (!Object.keys(clean).length) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.empty);
  try {
    return responseSchema.parse({
      ok: true,
      fileName: sanitizeRecruitmentVacancyExtractFileName(fileName),
      suggestions: clean,
    });
  } catch {
    throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.fail);
  }
}

function assertVacancyTempPath(tmpPath) {
  const root = path.resolve(os.tmpdir());
  const resolved = path.resolve(tmpPath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolved.startsWith(rootWithSep) || path.basename(resolved) !== path.basename(tmpPath)) {
    throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.fail);
  }
  return resolved;
}

/** ENOENT means the file is already gone. Other unlink failures must not replace the reader's result. */
async function removeRecruitmentVacancyTempFile(tmpPath) {
  let safe;
  try {
    safe = assertVacancyTempPath(tmpPath);
  } catch {
    return;
  }
  try {
    await fs.promises.unlink(safe);
  } catch (err) {
    if (!err || err.code === 'ENOENT') return;
  }
}

/**
 * The DOC reader owns its temp file. Timeout stops waiting and discards the late
 * result; cleanup runs again when that reader settles, after the file is no longer locked.
 */
export async function extractRecruitmentVacancyDocText(buffer, options = {}) {
  const timeoutMs = options.timeoutMs ?? RECRUITMENT_VACANCY_EXTRACT_TIMEOUT_MS;
  const tmpPath = assertVacancyTempPath(path.join(os.tmpdir(), `rec-vac-${crypto.randomUUID()}.doc`));
  await fs.promises.writeFile(tmpPath, buffer);
  const reader = Promise.resolve().then(() => {
    if (options.extractImpl) return options.extractImpl(tmpPath);
    return (async () => {
      const { default: WordExtractor } = await import('word-extractor');
      const doc = await new WordExtractor().extract(tmpPath);
      return [doc.getHeaders(), doc.getBody()].filter(Boolean).join('\n').trim();
    })();
  });
  const owned = reader.finally(() => removeRecruitmentVacancyTempFile(tmpPath));
  owned.catch(() => {});
  return raceWithRecruitmentVacancyExtractTimeout(owned, timeoutMs);
}

export function joinRecruitmentVacancyPdfPages(textResult) {
  const pages = Array.isArray(textResult?.pages) ? textResult.pages : [];
  if (!pages.length) return String(textResult?.text || '');
  return pages
    .map((page) => String(page?.text || '').replace(/[ \t]+$/gm, '').trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * One PDFParse per file. getText and getTable share it. destroy runs in finally.
 * pageJoiner stays empty so pdf-parse does not insert "-- n of m --"; pages are joined here.
 */
export async function extractRecruitmentVacancyPdfSource(buffer, options = {}) {
  const parser =
    options.parser ||
    (await (async () => {
      const { PDFParse } = await import('pdf-parse');
      return new PDFParse({ data: buffer });
    })());
  try {
    const textResult = await parser.getText({ pageJoiner: '' });
    const text = joinRecruitmentVacancyPdfPages(textResult);
    let tables = [];
    try {
      const tableResult = await parser.getTable();
      for (const page of tableResult?.pages || []) {
        if (Array.isArray(page?.tables)) tables.push(...page.tables);
      }
    } catch {
      tables = [];
    }
    return { text, tables };
  } finally {
    await Promise.resolve(parser.destroy()).catch(() => {});
  }
}

export async function readRecruitmentVacancyPdfSource(buffer, options = {}) {
  const pending = extractRecruitmentVacancyPdfSource(buffer, options);
  pending.catch(() => {});
  return raceWithRecruitmentVacancyExtractTimeout(
    pending,
    options.timeoutMs ?? RECRUITMENT_VACANCY_EXTRACT_TIMEOUT_MS,
  );
}

async function readVacancyFileSource(kind, buffer) {
  try {
    if (kind === 'txt') {
      return {
        text: plainText(buffer.toString('utf8').replace(/^\uFEFF/, '')).slice(0, RECRUITMENT_VACANCY_EXTRACT_TEXT_CAP),
        tables: [],
      };
    }
    if (kind === 'pdf') {
      const source = await readRecruitmentVacancyPdfSource(buffer);
      return {
        text: plainText(source.text).slice(0, RECRUITMENT_VACANCY_EXTRACT_TEXT_CAP),
        tables: source.tables,
      };
    }
    const text =
      kind === 'doc'
        ? await extractRecruitmentVacancyDocText(buffer)
        : await raceWithRecruitmentVacancyExtractTimeout(extractTextFromResumeBuffer(buffer, '.docx'));
    return { text: plainText(text).slice(0, RECRUITMENT_VACANCY_EXTRACT_TEXT_CAP), tables: [] };
  } catch (err) {
    if (err && err.message === RECRUITMENT_VACANCY_EXTRACT_MSG.fail) throw err;
    throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.fail);
  }
}

/**
 * Analiza un archivo en memoria y devuelve sugerencias del formulario de vacante.
 * No escribe en Prisma, no crea la vacante y no conserva el archivo.
 */
export async function analyzeRecruitmentVacancyFile({ buffer, originalName, mimetype = '' }) {
  const kind = classifyRecruitmentVacancyExtractFile(buffer, originalName, mimetype);
  const source = await readVacancyFileSource(kind, buffer);
  const suggestions = parseRecruitmentVacancyText(source.text, { tables: source.tables });
  return buildRecruitmentVacancyExtractResponse(originalName, suggestions);
}

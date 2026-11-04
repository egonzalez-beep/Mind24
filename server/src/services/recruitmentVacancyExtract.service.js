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

const FIELD_RES = [
  ['title', /^(?:t[ií]tulo(?:\s+de\s+la\s+vacante)?|puesto|cargo|posici[oó]n)\s*[:\-–]\s*(.+)$/i],
  ['clientName', /^(?:cliente|empresa(?:\s+contratante)?|compa[nñ][ií]a|raz[oó]n social)\s*[:\-–]\s*(.+)$/i],
  ['location', /^(?:ubicaci[oó]n|lugar(?:\s+de\s+trabajo)?|ciudad|sede)\s*[:\-–]\s*(.+)$/i],
  [
    'positionsTotal',
    /^(?:n[uú]mero\s+de\s+(?:posiciones|vacantes|plazas)|posiciones|vacantes|plazas)\s*[:\-–]\s*(\d{1,4})\b/i,
  ],
  ['openedAt', /^(?:fecha\s+de\s+(?:apertura|inicio))\s*[:\-–]\s*(.+)$/i],
  [
    'targetCoverageDate',
    /^(?:fecha\s+(?:objetivo|l[ií]mite)(?:\s+de\s+cobertura)?|fecha\s+de\s+cobertura)\s*[:\-–]\s*(.+)$/i,
  ],
];

const SECTION_RE =
  /^(descripci[oó]n(?:\s+del\s+puesto)?|perfil(?:\s+del\s+puesto)?|requisitos|responsabilidades|funciones|actividades|habilidades|escolaridad|experiencia|prestaciones|horario|sueldo|salario|modalidad|tipo\s+de\s+(?:contrato|empleo|contrataci[oó]n)|informaci[oó]n\s+adicional)\s*[:\-–]?\s*(.*)$/i;

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

function matchField(line) {
  for (const [key, re] of FIELD_RES) {
    const match = line.match(re);
    if (match) return { key, value: String(match[1] || '').trim() };
  }
  return null;
}

function matchSection(line) {
  const match = line.match(SECTION_RE);
  if (!match) return null;
  const name = match[1].trim();
  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    inline: String(match[2] || '').trim(),
  };
}

function isPlausibleTitle(line) {
  const value = clip(line, TITLE_CAP);
  if (value.length < 8 || value.length > 90) return false;
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(value)) return false;
  if (isBlankToken(value) || value.includes('@') || /[_0-9]/.test(value)) return false;
  if (parseExplicitDate(value)) return false;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return true;
  return words.length === 1 && /^[A-Za-zÁÉÍÓÚáéíóúÑñ]+$/.test(words[0]);
}

function loosePositions(lines) {
  for (const line of lines.slice(0, 30)) {
    const match = line.match(/^(\d{1,4})\s+(?:vacantes|posiciones|plazas)\b\.?$/i);
    if (!match) continue;
    const n = Number(match[1]);
    if (n >= 1 && n <= 9999) return n;
  }
  return null;
}

export function parseRecruitmentVacancyText(raw) {
  const text = plainText(raw).slice(0, RECRUITMENT_VACANCY_EXTRACT_TEXT_CAP);
  if (text.length < 3) return {};
  const lines = text
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter(Boolean);
  const suggestions = {};
  const sections = [];
  const leftover = [];
  let current = null;

  function assign(key, value) {
    value = plainText(value).replace(/[<>]/g, '');
    if (suggestions[key] || isBlankToken(value)) return;
    if (key === 'title') {
      const title = clip(value, TITLE_CAP);
      if (title.length < 2 || title.length > 120) return;
      suggestions.title = { value: title, confidence: 'high' };
      return;
    }
    if (key === 'clientName' || key === 'location') {
      const short = clip(value, SHORT_CAP);
      if (short.length < 2 || short.length > 120) return;
      suggestions[key] = { value: short, confidence: 'high' };
      return;
    }
    if (key === 'positionsTotal') {
      const n = Number(String(value).match(/\d{1,4}/)?.[0]);
      if (!Number.isInteger(n) || n < 1 || n > 9999) return;
      suggestions.positionsTotal = { value: n, confidence: 'high' };
      return;
    }
    if (key === 'openedAt' || key === 'targetCoverageDate') {
      const iso = parseExplicitDate(value);
      if (!iso) return;
      suggestions[key] = { value: iso, confidence: 'high' };
    }
  }

  for (const line of lines) {
    const field = matchField(line);
    if (field) {
      current = null;
      if (field.key === 'title' && clip(field.value, 400).length > 120) {
        leftover.push(line);
      } else {
        assign(field.key, field.value);
      }
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

  if (!suggestions.title && leftover.length && isPlausibleTitle(leftover[0])) {
    suggestions.title = { value: clip(leftover.shift(), TITLE_CAP), confidence: 'medium' };
  }

  if (!suggestions.positionsTotal) {
    const n = loosePositions(lines);
    if (n) suggestions.positionsTotal = { value: n, confidence: 'medium' };
  }

  const parts = [];
  for (const section of sections) {
    const body = section.lines.join('\n').trim();
    if (!body || isBlankToken(body)) continue;
    parts.push(`${section.name}\n${body}`);
  }
  let jd = parts.join('\n\n').trim();
  let confidence = 'high';
  if (!jd) {
    const rest = leftover.join('\n').trim();
    if (rest.length >= 40 && !isBlankToken(rest)) {
      jd = rest;
      confidence = 'medium';
    }
  }
  if (jd) {
    jd = plainText(jd).replace(/[<>]/g, '').slice(0, JD_CAP).trim();
    if (jd && !isBlankToken(jd)) suggestions.jobDescription = { value: jd, confidence };
  }
  if (
    suggestions.openedAt &&
    suggestions.targetCoverageDate &&
    suggestions.targetCoverageDate.value < suggestions.openedAt.value
  ) {
    delete suggestions.targetCoverageDate;
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

async function readVacancyFileText(kind, buffer) {
  try {
    if (kind === 'txt') {
      return plainText(buffer.toString('utf8').replace(/^\uFEFF/, '')).slice(0, RECRUITMENT_VACANCY_EXTRACT_TEXT_CAP);
    }
    const text =
      kind === 'doc'
        ? await extractRecruitmentVacancyDocText(buffer)
        : await raceWithRecruitmentVacancyExtractTimeout(
            extractTextFromResumeBuffer(buffer, kind === 'pdf' ? '.pdf' : '.docx'),
          );
    return plainText(text).slice(0, RECRUITMENT_VACANCY_EXTRACT_TEXT_CAP);
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
  const text = await readVacancyFileText(kind, buffer);
  if (!text || text.length < 3) throw extractError(RECRUITMENT_VACANCY_EXTRACT_MSG.empty);
  const suggestions = parseRecruitmentVacancyText(text);
  return buildRecruitmentVacancyExtractResponse(originalName, suggestions);
}

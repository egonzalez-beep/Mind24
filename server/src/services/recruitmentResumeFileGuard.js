import zlib from 'zlib';

/** Defensas de archivo para el análisis de CV. No importa el extractor de vacantes. */
export const RECRUITMENT_RESUME_PARSE_MSG = {
  format: 'Formato no admitido para análisis. Use PDF, DOC o DOCX.',
  size: 'El CV supera el límite de 10 MB.',
  fail: 'No pudimos extraer los datos automáticamente. Puedes continuar el registro manualmente.',
};

export const RECRUITMENT_RESUME_PARSE_TEXT_CAP = 20_000;
export const RECRUITMENT_RESUME_PARSE_TIMEOUT_MS = 15_000;

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
};

export function recruitmentResumeParseError(message) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  return err;
}

export function raceWithRecruitmentResumeParseTimeout(promise, ms = RECRUITMENT_RESUME_PARSE_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.fail)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
  if (eocd < 0 || eocd + 22 > buffer.length) throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
  const entries = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
  }
  if (!entries || entries > DOCX_MAX_ENTRIES) throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
  if (cdOffset + cdSize > buffer.length) throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
  const out = [];
  let cursor = cdOffset;
  for (let n = 0; n < entries; n += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
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
    if (nameEnd > buffer.length) throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
    const name = buffer.toString('utf8', nameStart, nameEnd);
    out.push({ name, method, flags, compressedSize, uncompressedSize, localOffset });
    cursor = nameEnd + extraLen + commentLen;
  }
  if (cursor > cdOffset + cdSize) throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
  return out;
}

function readZipLocalData(buffer, entry) {
  const start = entry.localOffset;
  if (start + 30 > buffer.length || buffer.readUInt32LE(start) !== 0x04034b50) {
    throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
  }
  const nameLen = buffer.readUInt16LE(start + 26);
  const extraLen = buffer.readUInt16LE(start + 28);
  const dataStart = start + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
  const localName = buffer.toString('utf8', start + 30, start + 30 + nameLen);
  if (!isSafeZipName(localName)) throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
  return buffer.subarray(dataStart, dataEnd);
}

/** Inspecciona el paquete en memoria. No lo extrae al disco ni ejecuta macros. */
export function assertSafeRecruitmentResumeDocx(buffer) {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
  }
  const entries = readZipCentralDirectory(buffer);
  let total = 0;
  const names = new Set();
  const inflated = new Map();
  for (const entry of entries) {
    if (!isSafeZipName(entry.name) || entry.flags & 0x1 || (entry.method !== 0 && entry.method !== 8)) {
      throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
    }
    if (
      entry.compressedSize === 0xffffffff ||
      entry.uncompressedSize === 0xffffffff ||
      entry.uncompressedSize > DOCX_MAX_ENTRY_UNCOMPRESSED ||
      entry.compressedSize > buffer.length
    ) {
      throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
    }
    const ratio = entry.compressedSize > 0 ? entry.uncompressedSize / entry.compressedSize : entry.uncompressedSize;
    if (entry.uncompressedSize > 256 * 1024 && ratio > 100) {
      throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
    }
    total += entry.uncompressedSize;
    if (total > DOCX_MAX_TOTAL_UNCOMPRESSED) throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
    const data = readZipLocalData(buffer, entry);
    let plain;
    if (entry.method === 0) {
      if (data.length !== entry.uncompressedSize) throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
      plain = data;
    } else {
      try {
        plain = zlib.inflateRawSync(data, { maxOutputLength: DOCX_MAX_ENTRY_UNCOMPRESSED });
      } catch {
        throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
      }
      if (plain.length > entry.uncompressedSize + 64) throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
    }
    names.add(entry.name);
    inflated.set(entry.name, plain);
  }
  if (!names.has('[Content_Types].xml') || !names.has('word/document.xml')) {
    throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
  }
  for (const name of names) {
    if (name.toLowerCase().endsWith('vbaproject.bin')) {
      throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
    }
  }
  const types = inflated.get('[Content_Types].xml').toString('utf8');
  if (/macroenabled/i.test(types) || !/word\/document\.xml/i.test(types) || !/wordprocessingml/i.test(types)) {
    throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
  }
  if (!inflated.get('word/document.xml')?.length) throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
}

export function isOleCompoundResume(buffer) {
  return (
    buffer &&
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

export function assertRecruitmentResumeFileSignature(ext, buffer, mimetype = '') {
  if (ext === '.pdf') {
    if (!buffer || buffer.length < 5 || !buffer.subarray(0, 5).toString('ascii').startsWith('%PDF')) {
      throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
    }
    if (!mimeAgrees('pdf', mimetype)) throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
    return;
  }
  if (ext === '.docx') {
    if (String(ext) === '.docm') throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
    assertSafeRecruitmentResumeDocx(buffer);
    if (!mimeAgrees('docx', mimetype)) throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
    return;
  }
  if (ext === '.doc') {
    if (!isOleCompoundResume(buffer)) throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
    if (!mimeAgrees('doc', mimetype)) throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.format);
  }
}

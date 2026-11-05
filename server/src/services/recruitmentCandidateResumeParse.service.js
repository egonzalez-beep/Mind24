import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
  RECRUITMENT_CANDIDATE_PROFILE_OPTIONS,
  normalizeRecruitmentCandidateFullName,
} from './recruitmentCandidateCatalog.service.js';
import {
  normalizeRecruitmentCandidateEmail,
  normalizeRecruitmentCandidatePhoneDigits,
} from './recruitmentCandidate.service.js';
import {
  RECRUITMENT_CANDIDATE_RESUME_MAX_BYTES,
  sniffRecruitmentCandidateResumeExt,
} from './recruitmentCandidateResume.service.js';
import {
  RECRUITMENT_RESUME_PARSE_MSG,
  RECRUITMENT_RESUME_PARSE_TEXT_CAP,
  RECRUITMENT_RESUME_PARSE_TIMEOUT_MS,
  assertRecruitmentResumeFileSignature,
  raceWithRecruitmentResumeParseTimeout,
  recruitmentResumeParseError,
} from './recruitmentResumeFileGuard.js';

export {
  RECRUITMENT_RESUME_PARSE_MSG,
  RECRUITMENT_RESUME_PARSE_TEXT_CAP,
  RECRUITMENT_RESUME_PARSE_TIMEOUT_MS,
};

export const PARSEABLE_RESUME_EXT = new Set(['.pdf', '.doc', '.docx']);
export const IMAGE_RESUME_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const EMAIL_RE =
  /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;

const PHONE_CANDIDATE_RE =
  /(?:\+?\d{1,3}[\s.\-]?)?(?:\(?\d{2,4}\)?[\s.\-]?)?\d{3,4}[\s.\-]?\d{2,4}(?:[\s.\-]?\d{2,4})?/g;

const NAME_LABEL_RE =
  /^(?:nombre completo|nombre del candidato|nombre|candidato|candidate|name)\s*[:\-]\s*(.+)$/i;

const CITY_LABEL_RE =
  /^(?:ciudad|city|ubicaci[oó]n|location|residencia|domicilio)\s*[:\-]\s*(.+)$/i;
const STATE_LABEL_RE = /^(?:estado|state|provincia)\s*[:\-]\s*(.+)$/i;
const WHATSAPP_LABEL_RE = /^(?:whatsapp|wa)\s*[:\-]\s*(.+)$/i;
const MOBILE_LABEL_RE = /^(?:celular|m[oó]vil|tel[eé]fono\s+m[oó]vil)\s*[:\-]\s*(.+)$/i;
const PHONE_LABEL_RE = /^(?:tel[eé]fono(?:\s+fijo)?|tel)\s*[:\-]\s*(.+)$/i;
const EMAIL_LABEL_RE = /^(?:correo electr[oó]nico|correo|e-mail|email)\s*[:\-]\s*(.+)$/i;

const SECTION_BREAKS = [
  'referencias personales',
  'referencias laborales',
  'contactos de referencia',
  'referencias',
  'experiencia laboral',
  'experiencia profesional',
  'experiencia',
  'educacion',
  'formacion academica',
  'formacion',
  'historial laboral',
  'empleos',
];

const NAME_EXACT = new Set([
  'curriculum vitae',
  'curriculum',
  'cv',
  'hoja de vida',
  'resumen profesional',
  'perfil profesional',
  'datos personales',
  'informacion personal',
  'contacto',
  'contact',
  'datos de contacto',
]);

const NAME_REJECT_WORD =
  /\b(universidad|instituto|escuela|colegio|empresa|compania|experiencia|educacion|formacion|referencias|logistica|servicios|industrial|corporativo|grupo)\b/;

const MX_STATES = [
  'Aguascalientes',
  'Baja California',
  'Baja California Sur',
  'Campeche',
  'Chiapas',
  'Chihuahua',
  'Ciudad de México',
  'Coahuila',
  'Colima',
  'Durango',
  'Estado de México',
  'Guanajuato',
  'Guerrero',
  'Hidalgo',
  'Jalisco',
  'Michoacán',
  'Morelos',
  'Nayarit',
  'Nuevo León',
  'Oaxaca',
  'Puebla',
  'Querétaro',
  'Quintana Roo',
  'San Luis Potosí',
  'Sinaloa',
  'Sonora',
  'Tabasco',
  'Tamaulipas',
  'Tlaxcala',
  'Veracruz',
  'Yucatán',
  'Zacatecas',
];

const MX_STATE_ALIASES = new Map([
  ['cdmx', 'Ciudad de México'],
  ['ciudad de mexico', 'Ciudad de México'],
  ['df', 'Ciudad de México'],
  ['edo mex', 'Estado de México'],
  ['edomex', 'Estado de México'],
  ['estado de mexico', 'Estado de México'],
  ['nl', 'Nuevo León'],
  ['nuevo leon', 'Nuevo León'],
  ['qro', 'Querétaro'],
  ['queretaro', 'Querétaro'],
]);

const PROFILE_KEYWORDS = {
  Ventas: ['ventas', 'vendedor', 'comercial', 'sales', 'retail'],
  'Atención a clientes': ['atención a clientes', 'atencion a clientes', 'customer service', 'call center'],
  Administrativo: ['administrativo', 'administración', 'office assistant', 'asistente administr'],
  'Contabilidad / Finanzas': ['contabilidad', 'contador', 'finanzas', 'finance', 'accounting'],
  'Recursos Humanos': ['recursos humanos', 'human resources', 'rh', 'talento humano'],
  'Logística / Almacén': ['logística', 'logistica', 'almacén', 'almacen', 'warehouse', 'inventario'],
  Mantenimiento: ['mantenimiento', 'maintenance', 'técnico de mantenimiento'],
  'Producción / Operativo': ['producción', 'produccion', 'operativo', 'operador', 'manufacturing'],
  Calidad: ['calidad', 'quality', 'qa', 'qc'],
  Seguridad: ['seguridad', 'vigilancia', 'security'],
  Transporte: ['transporte', 'chofer', 'conductor', 'driver', 'logistics driver'],
  Tecnología: ['tecnología', 'tecnologia', 'software', 'developer', 'programador', 'it ', 'sistemas'],
};

export function resumeExtFromOriginalName(originalName = '') {
  const base = String(originalName).trim().toLowerCase();
  const idx = base.lastIndexOf('.');
  if (idx <= 0) return '';
  return base.slice(idx);
}

export function classifyRecruitmentResumeFile(ext) {
  const e = ext === '.jpeg' ? '.jpg' : ext;
  if (PARSEABLE_RESUME_EXT.has(e)) return 'parseable';
  if (IMAGE_RESUME_EXT.has(e)) return 'image';
  return 'other';
}

function softNormalizeFullName(fullName) {
  const raw = String(fullName ?? '').trim().replace(/\s+/g, ' ');
  if (raw.length < 2 || raw.length > 120) return null;
  try {
    return normalizeRecruitmentCandidateFullName(raw);
  } catch {
    return null;
  }
}

function formatPhoneForForm(digits) {
  if (!digits) return null;
  if (digits.length === 10) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  if (digits.length === 12 && digits.startsWith('52')) {
    const local = digits.slice(2);
    return `+52 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }
  if (digits.length >= 7 && digits.length <= 15) return digits;
  return null;
}

function foldLine(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isSectionBreak(line) {
  const fold = foldLine(line).replace(/[:\-–—]+$/, '').trim();
  return SECTION_BREAKS.includes(fold);
}

function contactBlock(text) {
  const kept = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (isSectionBreak(line.trim())) break;
    kept.push(line);
  }
  return kept.join('\n');
}

function isOrganizationLine(value) {
  return NAME_REJECT_WORD.test(foldLine(value));
}

function isInstitutionEmailLine(line) {
  return /^(contacto laboral|correo laboral|email laboral|correo de la empresa|referencia)\b/.test(foldLine(line));
}

function phonesInFragment(text) {
  const seen = new Set();
  const out = [];
  const matches = String(text || '').match(PHONE_CANDIDATE_RE) || [];
  for (const raw of matches) {
    const digits = normalizeRecruitmentCandidatePhoneDigits(raw);
    if (!digits || seen.has(digits)) continue;
    if (digits.length < 10 && !String(raw).includes('+')) continue;
    seen.add(digits);
    const formatted = formatPhoneForForm(digits);
    if (formatted) out.push(formatted);
  }
  return out;
}

function samePhone(left, right) {
  if (!left || !right) return false;
  return normalizeRecruitmentCandidatePhoneDigits(left) === normalizeRecruitmentCandidatePhoneDigits(right);
}

function extractContactChannels(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let whatsapp = null;
  let phone = null;
  let mobile = null;
  const consumed = new Set();

  lines.forEach((line, index) => {
    const whatsappLabel = line.match(WHATSAPP_LABEL_RE);
    const mobileLabel = !whatsappLabel && line.match(MOBILE_LABEL_RE);
    const phoneLabel = !whatsappLabel && !mobileLabel && line.match(PHONE_LABEL_RE);
    const label = whatsappLabel || mobileLabel || phoneLabel;
    if (!label) return;
    const found = phonesInFragment(label[1])[0];
    if (!found) return;
    consumed.add(index);
    if (whatsappLabel && !whatsapp) whatsapp = found;
    else if (mobileLabel && !mobile) mobile = found;
    else if (phoneLabel && !phone) phone = found;
  });

  if (!whatsapp && mobile) whatsapp = mobile;
  else if (mobile && !phone && !samePhone(whatsapp, mobile)) phone = mobile;

  if (samePhone(whatsapp, phone)) phone = null;

  if (!whatsapp || !phone) {
    for (let index = 0; index < lines.length; index += 1) {
      if (consumed.has(index) || isOrganizationLine(lines[index]) || isInstitutionEmailLine(lines[index])) continue;
      for (const found of phonesInFragment(lines[index])) {
        if (!whatsapp) {
          whatsapp = found;
          continue;
        }
        if (!phone && !samePhone(whatsapp, found)) phone = found;
      }
      if (whatsapp && phone) break;
    }
  }

  return { whatsapp: whatsapp || null, phone: phone || null };
}

function extractEmailFromText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (isInstitutionEmailLine(line)) continue;
    const label = line.match(EMAIL_LABEL_RE);
    if (!label) continue;
    const found = label[1].match(EMAIL_RE);
    if (found && found.length) return normalizeRecruitmentCandidateEmail(found[0]);
  }
  for (const line of lines) {
    if (isInstitutionEmailLine(line)) continue;
    const found = line.match(EMAIL_RE);
    if (found && found.length) return normalizeRecruitmentCandidateEmail(found[0]);
  }
  return null;
}

function acceptablePersonLine(line) {
  const fold = foldLine(line);
  if (!fold || NAME_EXACT.has(fold) || isOrganizationLine(line)) return false;
  if (line.length < 4 || line.length > 80) return false;
  if (/@|https?:|www\./i.test(line) || /\d/.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length < 2 || words.length > 6) return false;
  if (!words.every((word) => /^[\p{L}.'’-]+$/u.test(word))) return false;
  const titled = words.filter((word) => /^[\p{Lu}]/u.test(word)).length;
  return titled >= 2;
}

function extractNameFromText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const label = line.match(NAME_LABEL_RE);
    if (!label || !acceptablePersonLine(label[1].trim())) continue;
    const name = softNormalizeFullName(label[1]);
    if (name) return name;
  }

  for (const line of lines) {
    if (!acceptablePersonLine(line)) continue;
    const name = softNormalizeFullName(line);
    if (name) return name;
  }
  return null;
}

function normalizeStateToken(token) {
  const folded = foldLine(token);
  if (!folded) return null;
  if (MX_STATE_ALIASES.has(folded)) return MX_STATE_ALIASES.get(folded);
  for (const state of MX_STATES) {
    if (foldLine(state) === folded) return state;
  }
  return null;
}

function splitCityStateValue(raw) {
  const value = String(raw || '').split(/[|·]/)[0].trim();
  if (!value || isOrganizationLine(value)) return { city: null, state: null };
  const comma = value.match(/^([^,]{2,60}),\s*([^,]{2,40})$/);
  if (comma && !isOrganizationLine(comma[1])) {
    const state = normalizeStateToken(comma[2]);
    if (state) return { city: comma[1].trim().slice(0, 120), state };
  }
  if (value.length < 2 || value.length > 80) return { city: null, state: null };
  return { city: value.slice(0, 120), state: null };
}

function extractCityStateFromText(text) {
  let city = null;
  let state = null;
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const cityLabel = line.match(CITY_LABEL_RE);
    if (cityLabel && (!city || !state)) {
      const parsed = splitCityStateValue(cityLabel[1]);
      if (!city && parsed.city) city = parsed.city;
      if (!state && parsed.state) state = parsed.state;
    }
    const stateLabel = line.match(STATE_LABEL_RE);
    if (stateLabel && !state) {
      state = normalizeStateToken(stateLabel[1].split(/[,|]/)[0].trim());
    }
  }

  for (const line of lines) {
    if (city && state) break;
    if (CITY_LABEL_RE.test(line) || STATE_LABEL_RE.test(line) || /@|\d{6,}/.test(line)) continue;
    const pair = line.match(/^([^,]{2,60}),\s*([^,]{2,40})$/);
    if (!pair || isOrganizationLine(pair[1])) continue;
    const pairState = normalizeStateToken(pair[2]);
    if (!pairState) continue;
    if (!city) city = pair[1].trim().slice(0, 120);
    if (!state) state = pairState;
  }

  return { city, state };
}

/** Clasificación por palabras del catálogo. Puede quedar vacía. Nunca sugiere "Otro" ni copia el título de una vacante. */
export function suggestRecruitmentProfileFromText(text, catalog = RECRUITMENT_CANDIDATE_PROFILE_OPTIONS) {
  const lower = String(text || '').toLowerCase();
  if (!lower.trim()) return null;

  let best = null;
  let bestScore = 0;
  for (const profile of catalog) {
    if (profile === 'Otro') continue;
    const keys = PROFILE_KEYWORDS[profile] || [profile.toLowerCase()];
    let score = 0;
    for (const kw of keys) {
      if (lower.includes(kw)) score += kw.length >= 8 ? 3 : 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = profile;
    }
  }
  return bestScore >= 3 ? best : null;
}

/** Extracción estructurada (B) a partir de texto plano (A). */
export function parseRecruitmentResumeText(text) {
  const normalized = String(text || '')
    .replace(/\u0000/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (normalized.length < 8) {
    return {
      fullName: null,
      whatsapp: null,
      phone: null,
      email: null,
      city: null,
      state: null,
      suggestedProfile: null,
    };
  }

  const contact = contactBlock(normalized).slice(0, RECRUITMENT_RESUME_PARSE_TEXT_CAP);
  const channels = extractContactChannels(contact);
  const { city, state } = extractCityStateFromText(contact);

  return {
    fullName: extractNameFromText(contact),
    whatsapp: channels.whatsapp,
    phone: channels.phone,
    email: extractEmailFromText(contact),
    city,
    state,
    suggestedProfile: suggestRecruitmentProfileFromText(normalized),
  };
}

export function serializeParsedRecruitmentResumeForClient(parsed) {
  const fields = {};
  if (parsed.fullName) fields.fullName = parsed.fullName;
  if (parsed.whatsapp) fields.whatsapp = parsed.whatsapp;
  if (parsed.phone) fields.phone = parsed.phone;
  if (parsed.email) fields.email = parsed.email;
  if (parsed.city) fields.city = parsed.city;
  if (parsed.state) fields.state = parsed.state;
  if (parsed.suggestedProfile) fields.profile = parsed.suggestedProfile;
  return fields;
}

export function joinRecruitmentResumePdfPages(textResult) {
  const pages = Array.isArray(textResult?.pages) ? textResult.pages : [];
  const joined = pages.length
    ? pages
        .map((page) => String(page?.text || '').replace(/[ \t]+$/gm, '').trim())
        .filter(Boolean)
        .join('\n\n')
    : String(textResult?.text || '');
  return joined
    .split(/\r?\n/)
    .filter((line) => !/^--\s*\d+\s+of\s+\d+\s*--$/.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function assertResumeTempPath(tmpPath) {
  const root = path.resolve(os.tmpdir());
  const resolved = path.resolve(tmpPath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolved.startsWith(rootWithSep) || path.basename(resolved) !== path.basename(String(tmpPath))) {
    throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.fail);
  }
  if (!/^rec-cv-[0-9a-f-]{36}\.doc$/i.test(path.basename(resolved))) {
    throw recruitmentResumeParseError(RECRUITMENT_RESUME_PARSE_MSG.fail);
  }
  return resolved;
}

async function removeRecruitmentResumeTempFile(tmpPath) {
  let safe;
  try {
    safe = assertResumeTempPath(tmpPath);
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
 * El lector DOC es dueño del temporal. Si el tiempo se agota, la respuesta ya salió
 * y la limpieza corre cuando el lector suelta el archivo. ENOENT es limpieza válida.
 */
export async function extractRecruitmentResumeDocText(buffer, options = {}) {
  const timeoutMs = options.timeoutMs ?? RECRUITMENT_RESUME_PARSE_TIMEOUT_MS;
  const tmpPath = assertResumeTempPath(path.join(os.tmpdir(), `rec-cv-${crypto.randomUUID()}.doc`));
  await fs.promises.writeFile(tmpPath, buffer);
  const reader = Promise.resolve().then(() => {
    if (options.extractImpl) return options.extractImpl(tmpPath);
    return (async () => {
      const { default: WordExtractor } = await import('word-extractor');
      const doc = await new WordExtractor().extract(tmpPath);
      return [doc.getHeaders(), doc.getBody()].filter(Boolean).join('\n').trim();
    })();
  });
  const owned = reader.finally(() => removeRecruitmentResumeTempFile(tmpPath));
  owned.catch(() => {});
  return raceWithRecruitmentResumeParseTimeout(owned, timeoutMs);
}

export async function extractTextFromResumeBuffer(buffer, ext) {
  const normalizedExt = ext === '.jpeg' ? '.jpg' : ext;
  if (normalizedExt === '.pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return joinRecruitmentResumePdfPages(result);
    } finally {
      await Promise.resolve(parser.destroy()).catch(() => {});
    }
  }
  if (normalizedExt === '.docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return String(result?.value || '').trim();
  }
  if (normalizedExt === '.doc') {
    return extractRecruitmentResumeDocText(buffer);
  }
  return '';
}

export function recruitmentResumeParseUploadFailure(err) {
  if (!err) return null;
  if (err.code === 'LIMIT_FILE_SIZE') {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: RECRUITMENT_RESUME_PARSE_MSG.size } };
  }
  return { status: 400, body: { error: 'VALIDATION_ERROR', message: RECRUITMENT_RESUME_PARSE_MSG.format } };
}

function recruitmentResumeFormatResult() {
  return { ok: false, code: 'FORMAT', message: RECRUITMENT_RESUME_PARSE_MSG.format };
}

export async function analyzeRecruitmentResumeUpload({
  buffer,
  mimetype,
  originalName,
  timeoutMs,
  docExtractImpl,
} = {}) {
  if (!buffer?.length) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Selecciona un CV para analizar.';
    throw err;
  }
  if (buffer.length > RECRUITMENT_CANDIDATE_RESUME_MAX_BYTES) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = RECRUITMENT_RESUME_PARSE_MSG.size;
    throw err;
  }

  const ext =
    sniffRecruitmentCandidateResumeExt(buffer, mimetype, originalName) ||
    resumeExtFromOriginalName(originalName);
  const kind = classifyRecruitmentResumeFile(ext);
  if (kind === 'image') {
    return { ok: false, code: 'NOT_PARSEABLE', message: 'IMAGE' };
  }
  if (kind !== 'parseable' || ext === '.docm') return recruitmentResumeFormatResult();

  try {
    assertRecruitmentResumeFileSignature(ext, buffer, mimetype);
  } catch (error) {
    if (error?.message === RECRUITMENT_RESUME_PARSE_MSG.format) return recruitmentResumeFormatResult();
    return {
      ok: false,
      code: 'EXTRACTION_FAILED',
      message: RECRUITMENT_RESUME_PARSE_MSG.fail,
    };
  }

  let text = '';
  try {
    const pending =
      ext === '.doc'
        ? extractRecruitmentResumeDocText(buffer, { timeoutMs, extractImpl: docExtractImpl })
        : extractTextFromResumeBuffer(buffer, ext);
    pending.catch(() => {});
    text = await raceWithRecruitmentResumeParseTimeout(
      pending,
      timeoutMs ?? RECRUITMENT_RESUME_PARSE_TIMEOUT_MS,
    );
  } catch (error) {
    if (error?.message !== RECRUITMENT_RESUME_PARSE_MSG.fail) {
      console.error('[recruitment-cv-parse] extraction_failed', {
        ext,
        byteLength: buffer.length,
        message: String(error?.message || '').replace(/[\r\n]/g, ' ').slice(0, 180),
      });
    }
    return {
      ok: false,
      code: 'EXTRACTION_FAILED',
      message: RECRUITMENT_RESUME_PARSE_MSG.fail,
    };
  }

  const parsed = parseRecruitmentResumeText(String(text || '').slice(0, RECRUITMENT_RESUME_PARSE_TEXT_CAP));
  const fields = serializeParsedRecruitmentResumeForClient(parsed);
  if (!Object.keys(fields).length) {
    return {
      ok: false,
      code: 'NO_DATA',
      message: RECRUITMENT_RESUME_PARSE_MSG.fail,
    };
  }

  return { ok: true, fields };
}

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

export const PARSEABLE_RESUME_EXT = new Set(['.pdf', '.doc', '.docx']);
export const IMAGE_RESUME_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const EMAIL_RE =
  /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;

const PHONE_CANDIDATE_RE =
  /(?:\+?\d{1,3}[\s.\-]?)?(?:\(?\d{2,4}\)?[\s.\-]?)?\d{3,4}[\s.\-]?\d{2,4}(?:[\s.\-]?\d{2,4})?/g;

const NAME_LABEL_RE = /^(?:nombre|name|candidate|candidato)\s*[:\-]\s*(.+)$/i;

const CITY_LABEL_RE = /^(?:ciudad|city|ubicaci[oó]n|location)\s*[:\-]\s*(.+)$/i;
const STATE_LABEL_RE = /^(?:estado|state|provincia)\s*[:\-]\s*(.+)$/i;

const SKIP_NAME_LINE_RE =
  /^(curriculum|curriculum vitae|resume|cv|hoja de vida|datos personales|contacto|contact)$/i;

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

function extractPhonesFromText(text) {
  const seen = new Set();
  const out = [];
  const matches = text.match(PHONE_CANDIDATE_RE) || [];
  for (const raw of matches) {
    const digits = normalizeRecruitmentCandidatePhoneDigits(raw);
    if (!digits || seen.has(digits)) continue;
    if (digits.length < 10 && !raw.includes('+')) continue;
    seen.add(digits);
    const formatted = formatPhoneForForm(digits);
    if (formatted) out.push(formatted);
    if (out.length >= 2) break;
  }
  return out;
}

function extractEmailFromText(text) {
  const m = text.match(EMAIL_RE);
  if (!m || !m.length) return null;
  return normalizeRecruitmentCandidateEmail(m[0]);
}

function extractNameFromText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 40)) {
    const label = line.match(NAME_LABEL_RE);
    if (label) {
      const n = softNormalizeFullName(label[1]);
      if (n) return n;
    }
  }

  for (const line of lines.slice(0, 12)) {
    if (line.length < 4 || line.length > 80) continue;
    if (SKIP_NAME_LINE_RE.test(line)) continue;
    if (/@|https?:|www\./i.test(line)) continue;
    if (/\d{5,}/.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 6) continue;
    if (!words.every((w) => /^[\p{L}.'\-]+$/u.test(w))) continue;
    const titled = words.filter((w) => /^[\p{Lu}]/u.test(w)).length;
    if (titled < 2) continue;
    const n = softNormalizeFullName(line);
    if (n) return n;
  }
  return null;
}

function normalizeStateToken(token) {
  const t = String(token ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (!t) return null;
  if (MX_STATE_ALIASES.has(t)) return MX_STATE_ALIASES.get(t);
  for (const st of MX_STATES) {
    if (st.toLowerCase() === t) return st;
  }
  for (const st of MX_STATES) {
    if (st.toLowerCase().includes(t) || t.includes(st.toLowerCase())) return st;
  }
  return null;
}

function extractCityStateFromText(text) {
  let city = null;
  let state = null;
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  for (const line of lines.slice(0, 60)) {
    const cityLabel = line.match(CITY_LABEL_RE);
    if (cityLabel && !city) {
      const part = cityLabel[1].split(/[,|·]/)[0].trim();
      if (part.length >= 2 && part.length <= 80) city = part;
    }
    const stateLabel = line.match(STATE_LABEL_RE);
    if (stateLabel && !state) {
      state = normalizeStateToken(stateLabel[1].split(/[,|]/)[0].trim());
    }
  }

  for (const line of lines.slice(0, 40)) {
    if (city && state) break;
    const comma = line.match(/^([^,]{2,60}),\s*([^,]{2,40})$/);
    if (comma) {
      if (!city) city = comma[1].trim();
      if (!state) state = normalizeStateToken(comma[2].trim());
    }
  }

  if (!state) {
    const lower = text.toLowerCase();
    for (const [alias, canonical] of MX_STATE_ALIASES) {
      if (lower.includes(alias)) {
        state = canonical;
        break;
      }
    }
  }
  if (!state) {
    for (const st of MX_STATES) {
      if (text.includes(st)) {
        state = st;
        break;
      }
    }
  }

  if (city) city = city.slice(0, 120);
  return { city, state };
}

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

  const phones = extractPhonesFromText(normalized);
  const { city, state } = extractCityStateFromText(normalized);

  return {
    fullName: extractNameFromText(normalized),
    whatsapp: phones[0] || null,
    phone: phones[1] || null,
    email: extractEmailFromText(normalized),
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

export async function extractTextFromResumeBuffer(buffer, ext) {
  const normalizedExt = ext === '.jpeg' ? '.jpg' : ext;
  if (normalizedExt === '.pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return String(result?.text || '').trim();
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  if (normalizedExt === '.docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return String(result?.value || '').trim();
  }
  if (normalizedExt === '.doc') {
    const { default: WordExtractor } = await import('word-extractor');
    const tmpPath = path.join(os.tmpdir(), `rec-cv-${crypto.randomUUID()}.doc`);
    await fs.promises.writeFile(tmpPath, buffer);
    try {
      const doc = await new WordExtractor().extract(tmpPath);
      return [doc.getHeaders(), doc.getBody()].filter(Boolean).join('\n').trim();
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  }
  return '';
}

export async function analyzeRecruitmentResumeUpload({ buffer, mimetype, originalName }) {
  if (!buffer?.length) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Selecciona un CV para analizar.';
    throw err;
  }
  if (buffer.length > RECRUITMENT_CANDIDATE_RESUME_MAX_BYTES) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'El CV supera el límite de 10 MB.';
    throw err;
  }

  const ext =
    sniffRecruitmentCandidateResumeExt(buffer, mimetype, originalName) ||
    resumeExtFromOriginalName(originalName);
  const kind = classifyRecruitmentResumeFile(ext);
  if (kind === 'image') {
    return { ok: false, code: 'NOT_PARSEABLE', message: 'IMAGE' };
  }
  if (kind !== 'parseable') {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Formato no admitido para análisis. Use PDF, DOC o DOCX.';
    throw err;
  }

  let text = '';
  try {
    text = await extractTextFromResumeBuffer(buffer, ext);
  } catch (e) {
    console.error('[recruitment-cv-parse] extraction_failed', {
      ext,
      byteLength: buffer.length,
      message: e?.message,
    });
    return {
      ok: false,
      code: 'EXTRACTION_FAILED',
      message: 'No pudimos extraer los datos automáticamente. Puedes continuar el registro manualmente.',
    };
  }

  const parsed = parseRecruitmentResumeText(text);
  const fields = serializeParsedRecruitmentResumeForClient(parsed);
  if (!Object.keys(fields).length) {
    return {
      ok: false,
      code: 'NO_DATA',
      message: 'No pudimos extraer los datos automáticamente. Puedes continuar el registro manualmente.',
    };
  }

  return { ok: true, fields };
}

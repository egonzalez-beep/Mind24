import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { resolveUploadsRootAbs, resolveRecruitmentVacancyDocumentsDirAbs } from '../utils/uploadPaths.js';
import { assertRecruitmentVacancyInOrg } from './recruitmentVacancy.service.js';
import {
  sniffWorkforceDocumentExt,
  sanitizeDocumentDisplayName,
  sanitizeOriginalFileName,
  contentDispositionInlineHeader,
} from './workforceDocument.service.js';

export const RECRUITMENT_VACANCY_DOCUMENT_SUBDIR = 'recruitment-vacancies';
export const RECRUITMENT_VACANCY_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const RECRUITMENT_VACANCY_DOCUMENT_CATEGORIES = [
  'PROFILE',
  'ROUTES',
  'FORM',
  'COMMERCIAL_PROPOSAL',
  'CLIENT_DOCUMENT',
  'OTHER',
];

const IMAGE_PDF_MIME = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

const OFFICE_MIME = new Map([
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
]);

const ALL_DECLARED_MIME = new Map([...IMAGE_PDF_MIME, ...OFFICE_MIME]);

export function recruitmentVacancyDocumentExtForMime(mimetype, originalName = '') {
  const mime = String(mimetype || '').toLowerCase();
  if (ALL_DECLARED_MIME.has(mime)) return ALL_DECLARED_MIME.get(mime);
  const ext = path.extname(originalName || '').toLowerCase();
  if (['.jpg', '.jpeg'].includes(ext)) return '.jpg';
  if (['.png', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  return null;
}

export function isAllowedRecruitmentVacancyDocumentFile(mimetype, originalName = '') {
  return recruitmentVacancyDocumentExtForMime(mimetype, originalName) != null;
}

function isZipOfficeBuffer(buffer) {
  return buffer && buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/** Magic bytes PDF/imagen; Office por extensión + MIME + ZIP para OOXML. */
export function sniffRecruitmentVacancyDocumentExt(buffer, mimetype, originalName = '') {
  const sniffed = sniffWorkforceDocumentExt(buffer);
  if (sniffed) return sniffed;

  const ext = path.extname(originalName || '').toLowerCase();
  const mime = String(mimetype || '').toLowerCase();
  const mimeExt = OFFICE_MIME.get(mime);
  if (!mimeExt || mimeExt !== ext) return null;

  if (ext === '.docx' || ext === '.xlsx') {
    return isZipOfficeBuffer(buffer) ? ext : null;
  }
  if (ext === '.doc' || ext === '.xls') {
    return ext;
  }
  return null;
}

export function assertSafeRecruitmentVacancyDocumentPath(relativePath, organizationId, vacancyId) {
  if (!relativePath || typeof relativePath !== 'string') {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = `${RECRUITMENT_VACANCY_DOCUMENT_SUBDIR}/${organizationId}/${vacancyId}/`;
  if (!normalized.startsWith(prefix) || normalized.includes('..')) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Ruta de documento inválida.';
    throw err;
  }
  return normalized;
}

export function resolveRecruitmentVacancyDocumentAbs(relativePath, organizationId, vacancyId) {
  const safeRel = assertSafeRecruitmentVacancyDocumentPath(relativePath, organizationId, vacancyId);
  const uploadsRoot = resolveUploadsRootAbs();
  const abs = path.resolve(uploadsRoot, safeRel);
  const rootWithSep = uploadsRoot.endsWith(path.sep) ? uploadsRoot : uploadsRoot + path.sep;
  if (!abs.startsWith(rootWithSep)) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  return abs;
}

export async function removeRecruitmentVacancyDocumentFile(relativePath, organizationId, vacancyId) {
  if (!relativePath) return;
  try {
    const abs = resolveRecruitmentVacancyDocumentAbs(relativePath, organizationId, vacancyId);
    await fs.promises.unlink(abs);
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
}

export function sanitizeRecruitmentVacancyDocumentForAdmin(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    vacancyId: doc.vacancyId,
    displayName: doc.displayName,
    category: doc.category,
    originalFileName: doc.originalFileName,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
    createdAt: doc.createdAt,
  };
}

function mimeTypeForStoredExt(ext) {
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg') return 'image/jpeg';
  if (ext === '.doc') return 'application/msword';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.xls') return 'application/vnd.ms-excel';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/octet-stream';
}

export function recruitmentVacancyDocumentServeContentType(doc) {
  const stored = String(doc.mimeType || '').toLowerCase();
  if (ALL_DECLARED_MIME.has(stored)) return stored;
  const ext = path.extname(doc.filePath || '').toLowerCase();
  return mimeTypeForStoredExt(ext);
}

export async function listRecruitmentVacancyDocuments(organizationId, vacancyId) {
  await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  const rows = await prisma.recruitmentVacancyDocument.findMany({
    where: { organizationId, vacancyId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(sanitizeRecruitmentVacancyDocumentForAdmin);
}

export async function assertRecruitmentVacancyDocumentInOrg(documentId, organizationId) {
  const doc = await prisma.recruitmentVacancyDocument.findFirst({
    where: { id: documentId, organizationId },
  });
  if (!doc) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Documento no encontrado.';
    throw err;
  }
  return doc;
}

export async function createRecruitmentVacancyDocument({
  organizationId,
  vacancyId,
  uploadedByUserId,
  displayName,
  category,
  buffer,
  mimetype,
  originalName,
}) {
  await assertRecruitmentVacancyInOrg(vacancyId, organizationId);

  const name = sanitizeDocumentDisplayName(displayName);
  if (!name) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Indica un nombre para el documento.';
    throw err;
  }

  if (!buffer || buffer.length > RECRUITMENT_VACANCY_DOCUMENT_MAX_BYTES) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'El documento supera el límite de 10 MB.';
    throw err;
  }

  const ext = sniffRecruitmentVacancyDocumentExt(buffer, mimetype, originalName);
  if (!ext) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message =
      'Formato no permitido. Use PDF, JPG, PNG, WEBP, DOC, DOCX, XLS o XLSX.';
    throw err;
  }
  const mimeExt = recruitmentVacancyDocumentExtForMime(mimetype, originalName);
  if (mimeExt && mimeExt !== ext) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'El contenido del archivo no coincide con su tipo declarado.';
    throw err;
  }

  const vacDir = path.join(resolveRecruitmentVacancyDocumentsDirAbs(), organizationId, vacancyId);
  await fs.promises.mkdir(vacDir, { recursive: true });
  const fileName = `${crypto.randomUUID()}${ext}`;
  const relativePath = `${RECRUITMENT_VACANCY_DOCUMENT_SUBDIR}/${organizationId}/${vacancyId}/${fileName}`;
  const abs = resolveRecruitmentVacancyDocumentAbs(relativePath, organizationId, vacancyId);
  await fs.promises.writeFile(abs, buffer);

  const mimeType = mimeTypeForStoredExt(ext);

  let created;
  try {
    created = await prisma.recruitmentVacancyDocument.create({
      data: {
        organizationId,
        vacancyId,
        uploadedByUserId,
        displayName: name,
        category,
        filePath: relativePath,
        originalFileName: sanitizeOriginalFileName(originalName),
        mimeType,
        fileSize: buffer.length,
      },
    });
  } catch (e) {
    await fs.promises.unlink(abs).catch(() => {});
    throw e;
  }

  return sanitizeRecruitmentVacancyDocumentForAdmin(created);
}

export async function deleteRecruitmentVacancyDocument(organizationId, documentId) {
  const doc = await assertRecruitmentVacancyDocumentInOrg(documentId, organizationId);
  assertSafeRecruitmentVacancyDocumentPath(doc.filePath, organizationId, doc.vacancyId);

  await prisma.recruitmentVacancyDocument.delete({ where: { id: doc.id } });

  try {
    await removeRecruitmentVacancyDocumentFile(doc.filePath, organizationId, doc.vacancyId);
  } catch (e) {
    if (e?.code === 'ENOENT') return;
    console.error('[recruitment-vacancy-document] DB row deleted but file cleanup failed', {
      documentId: doc.id,
      organizationId,
      vacancyId: doc.vacancyId,
      message: e?.message,
    });
    const err = new Error(
      'El documento se eliminó del expediente, pero no se pudo borrar el archivo en almacenamiento.',
    );
    err.code = 'PARTIAL_DELETE';
    throw err;
  }
}

export async function streamRecruitmentVacancyDocumentFile(req, res, doc, organizationId) {
  assertSafeRecruitmentVacancyDocumentPath(doc.filePath, organizationId, doc.vacancyId);
  const abs = resolveRecruitmentVacancyDocumentAbs(doc.filePath, organizationId, doc.vacancyId);
  const stat = await fs.promises.stat(abs);
  const ext = path.extname(doc.filePath).toLowerCase();
  const etag = `"${doc.id}-${doc.createdAt.getTime()}"`;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader('Content-Type', recruitmentVacancyDocumentServeContentType(doc));
  res.setHeader('Cache-Control', 'private, max-age=3600, must-revalidate');
  res.setHeader('ETag', etag);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', contentDispositionInlineHeader(doc.displayName, ext));
  fs.createReadStream(abs).pipe(res);
}

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../db/client.js';
import {
  resolveRecruitmentCandidateResumesDirAbs,
  resolveUploadsRootAbs,
} from '../utils/uploadPaths.js';
import { assertRecruitmentCandidateInOrg } from './recruitmentCandidate.service.js';
import {
  sniffRecruitmentVacancyDocumentExt,
  recruitmentVacancyDocumentExtForMime,
} from './recruitmentVacancyDocument.service.js';
import {
  sanitizeOriginalFileName,
  contentDispositionInlineHeader,
} from './workforceDocument.service.js';

export const RECRUITMENT_CANDIDATE_RESUME_SUBDIR = 'recruitment-candidates';
export const RECRUITMENT_CANDIDATE_RESUME_MAX_BYTES = 10 * 1024 * 1024;

const RESUME_ALLOWED_EXT = new Set(['.pdf', '.jpg', '.png', '.webp', '.doc', '.docx']);

function mimeTypeForStoredExt(ext) {
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg') return 'image/jpeg';
  if (ext === '.doc') return 'application/msword';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

export function sniffRecruitmentCandidateResumeExt(buffer, mimetype, originalName = '') {
  const ext = sniffRecruitmentVacancyDocumentExt(buffer, mimetype, originalName);
  if (!ext || !RESUME_ALLOWED_EXT.has(ext)) return null;
  return ext;
}

export function isAllowedRecruitmentCandidateResumeFile(mimetype, originalName = '') {
  const ext = recruitmentVacancyDocumentExtForMime(mimetype, originalName);
  return ext != null && RESUME_ALLOWED_EXT.has(ext);
}

export function assertSafeRecruitmentCandidateResumePath(relativePath, organizationId, candidateId) {
  if (!relativePath || typeof relativePath !== 'string') {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = `${RECRUITMENT_CANDIDATE_RESUME_SUBDIR}/${organizationId}/${candidateId}/`;
  if (!normalized.startsWith(prefix) || normalized.includes('..')) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Ruta de CV inválida.';
    throw err;
  }
  return normalized;
}

export function resolveRecruitmentCandidateResumeAbs(relativePath, organizationId, candidateId) {
  const safeRel = assertSafeRecruitmentCandidateResumePath(relativePath, organizationId, candidateId);
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

async function removeResumeFile(relativePath, organizationId, candidateId) {
  if (!relativePath) return;
  try {
    const abs = resolveRecruitmentCandidateResumeAbs(relativePath, organizationId, candidateId);
    await fs.promises.unlink(abs);
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
}

export function sanitizeRecruitmentCandidateResumeForAdmin(row) {
  if (!row) return null;
  return {
    id: row.id,
    candidateId: row.candidateId,
    originalFileName: row.originalFileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getRecruitmentCandidateResume(organizationId, candidateId) {
  await assertRecruitmentCandidateInOrg(candidateId, organizationId);
  const row = await prisma.recruitmentCandidateResume.findFirst({
    where: { organizationId, candidateId },
  });
  return sanitizeRecruitmentCandidateResumeForAdmin(row);
}

export async function uploadRecruitmentCandidateResume({
  organizationId,
  candidateId,
  uploadedByUserId,
  buffer,
  mimetype,
  originalName,
}) {
  await assertRecruitmentCandidateInOrg(candidateId, organizationId);

  if (!buffer || buffer.length > RECRUITMENT_CANDIDATE_RESUME_MAX_BYTES) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'El CV supera el límite de 10 MB.';
    throw err;
  }

  const ext = sniffRecruitmentCandidateResumeExt(buffer, mimetype, originalName);
  if (!ext) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Formato no permitido. Use PDF, DOC, DOCX, JPG, PNG o WEBP.';
    throw err;
  }
  const mimeExt = recruitmentVacancyDocumentExtForMime(mimetype, originalName);
  if (mimeExt && RESUME_ALLOWED_EXT.has(mimeExt) && mimeExt !== ext) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'El contenido del archivo no coincide con su tipo declarado.';
    throw err;
  }

  const candDir = path.join(resolveRecruitmentCandidateResumesDirAbs(), organizationId, candidateId);
  await fs.promises.mkdir(candDir, { recursive: true });
  const fileName = `${crypto.randomUUID()}${ext}`;
  const relativePath = `${RECRUITMENT_CANDIDATE_RESUME_SUBDIR}/${organizationId}/${candidateId}/${fileName}`;
  const abs = resolveRecruitmentCandidateResumeAbs(relativePath, organizationId, candidateId);
  await fs.promises.writeFile(abs, buffer);

  const mimeType = mimeTypeForStoredExt(ext);
  const safeOriginal = sanitizeOriginalFileName(originalName);

  let previousPath = null;
  try {
    const saved = await prisma.$transaction(async (tx) => {
      const existing = await tx.recruitmentCandidateResume.findUnique({
        where: { candidateId },
      });
      if (existing && existing.organizationId !== organizationId) {
        const err = new Error('NOT_FOUND');
        err.code = 'NOT_FOUND';
        throw err;
      }
      previousPath = existing?.filePath ?? null;

      const row = await tx.recruitmentCandidateResume.upsert({
        where: { candidateId },
        create: {
          organizationId,
          candidateId,
          uploadedByUserId,
          filePath: relativePath,
          originalFileName: safeOriginal,
          mimeType,
          fileSize: buffer.length,
        },
        update: {
          uploadedByUserId,
          filePath: relativePath,
          originalFileName: safeOriginal,
          mimeType,
          fileSize: buffer.length,
        },
      });
      return row;
    });
    if (previousPath && previousPath !== relativePath) {
      await removeResumeFile(previousPath, organizationId, candidateId);
    }
    return sanitizeRecruitmentCandidateResumeForAdmin(saved);
  } catch (e) {
    await fs.promises.unlink(abs).catch(() => {});
    throw e;
  }
}

export async function deleteRecruitmentCandidateResume(organizationId, candidateId) {
  await assertRecruitmentCandidateInOrg(candidateId, organizationId);
  const row = await prisma.recruitmentCandidateResume.findFirst({
    where: { organizationId, candidateId },
  });
  if (!row) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'CV no encontrado.';
    throw err;
  }
  assertSafeRecruitmentCandidateResumePath(row.filePath, organizationId, candidateId);
  await prisma.recruitmentCandidateResume.delete({ where: { id: row.id } });
  try {
    await removeResumeFile(row.filePath, organizationId, candidateId);
  } catch (e) {
    if (e?.code === 'ENOENT') return;
    console.error('[recruitment-candidate-resume] DB row deleted but file cleanup failed', {
      candidateId,
      organizationId,
      message: e?.message,
    });
    const err = new Error('El CV se eliminó del expediente, pero no se pudo borrar el archivo.');
    err.code = 'PARTIAL_DELETE';
    throw err;
  }
}

export function recruitmentCandidateResumeServeContentType(doc) {
  const stored = String(doc.mimeType || '').toLowerCase();
  const ext = path.extname(doc.filePath || '').toLowerCase();
  if (stored && stored !== 'application/octet-stream') return stored;
  return mimeTypeForStoredExt(ext);
}

export async function streamRecruitmentCandidateResumeFile(req, res, doc, organizationId, candidateId) {
  assertSafeRecruitmentCandidateResumePath(doc.filePath, organizationId, candidateId);
  const abs = resolveRecruitmentCandidateResumeAbs(doc.filePath, organizationId, candidateId);
  const stat = await fs.promises.stat(abs);
  const ext = path.extname(doc.filePath).toLowerCase();
  const etag = `"${doc.id}-${doc.updatedAt.getTime()}"`;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader('Content-Type', recruitmentCandidateResumeServeContentType(doc));
  res.setHeader('Cache-Control', 'private, max-age=3600, must-revalidate');
  res.setHeader('ETag', etag);
  res.setHeader('Content-Length', stat.size);
  res.setHeader(
    'Content-Disposition',
    contentDispositionInlineHeader(doc.originalFileName, ext),
  );
  fs.createReadStream(abs).pipe(res);
}

export async function assertRecruitmentCandidateResumeInOrg(organizationId, candidateId) {
  await assertRecruitmentCandidateInOrg(candidateId, organizationId);
  const row = await prisma.recruitmentCandidateResume.findFirst({
    where: { organizationId, candidateId },
  });
  if (!row) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'CV no encontrado.';
    throw err;
  }
  return row;
}

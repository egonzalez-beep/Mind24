import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { resolveUploadsRootAbs, resolveWorkforceDocumentsDirAbs } from '../utils/uploadPaths.js';
import { assertWorkforceEmployeeInOrg } from './workforceEmployee.service.js';
import { sniffWorkforceAvatarExt } from './workforceAvatar.service.js';

export const WORKFORCE_DOCUMENT_SUBDIR = 'workforce-documents';
export const WORKFORCE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const WORKFORCE_DOCUMENT_CATEGORIES = [
  'CONTRATO',
  'IDENTIFICACION',
  'COMPROBANTE',
  'PRESTACIONES',
  'COTIZACION',
  'OTRO',
];

const ALLOWED_MIME = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

export function workforceDocumentExtForMime(mimetype, originalName = '') {
  const mime = String(mimetype || '').toLowerCase();
  if (ALLOWED_MIME.has(mime)) return ALLOWED_MIME.get(mime);
  const ext = path.extname(originalName || '').toLowerCase();
  if (['.jpg', '.jpeg'].includes(ext)) return '.jpg';
  if (ext === '.png') return '.png';
  if (ext === '.webp') return '.webp';
  if (ext === '.pdf') return '.pdf';
  return null;
}

export function isAllowedWorkforceDocumentFile(mimetype, originalName = '') {
  return workforceDocumentExtForMime(mimetype, originalName) != null;
}

/** Magic-byte sniff — PDF + imágenes (misma lógica que avatars para imágenes). */
export function sniffWorkforceDocumentExt(buffer) {
  if (!buffer || buffer.length < 5) return null;
  const head = buffer.toString('ascii', 0, Math.min(5, buffer.length));
  if (head.startsWith('%PDF')) return '.pdf';
  return sniffWorkforceAvatarExt(buffer);
}

export function sanitizeDocumentDisplayName(raw) {
  const s = String(raw || '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
  if (!s || s.length < 1) return null;
  return s.slice(0, 200);
}

export function sanitizeOriginalFileName(raw) {
  const base = path.basename(String(raw || 'documento').replace(/[\x00-\x1f\x7f]/g, ''));
  return base.slice(0, 255) || 'documento';
}

export function assertSafeWorkforceDocumentPath(relativePath, organizationId, employeeId) {
  if (!relativePath || typeof relativePath !== 'string') {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = `${WORKFORCE_DOCUMENT_SUBDIR}/${organizationId}/${employeeId}/`;
  if (!normalized.startsWith(prefix) || normalized.includes('..')) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Ruta de documento inválida.';
    throw err;
  }
  return normalized;
}

export function resolveWorkforceDocumentAbs(relativePath, organizationId, employeeId) {
  const safeRel = assertSafeWorkforceDocumentPath(relativePath, organizationId, employeeId);
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

export async function removeWorkforceDocumentFile(relativePath, organizationId, employeeId) {
  if (!relativePath) return;
  try {
    const abs = resolveWorkforceDocumentAbs(relativePath, organizationId, employeeId);
    await fs.promises.unlink(abs);
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
}

export function sanitizeDocumentForAdmin(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    employeeId: doc.employeeId,
    displayName: doc.displayName,
    category: doc.category,
    originalFileName: doc.originalFileName,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
    createdAt: doc.createdAt,
  };
}

export async function listWorkforceDocumentsForEmployee(organizationId, employeeId) {
  await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const rows = await prisma.workforceDocument.findMany({
    where: { organizationId, employeeId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(sanitizeDocumentForAdmin);
}

export async function assertWorkforceDocumentInOrg(documentId, organizationId) {
  const doc = await prisma.workforceDocument.findFirst({
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

export async function createWorkforceDocument({
  organizationId,
  employeeId,
  uploadedByUserId,
  displayName,
  category,
  buffer,
  mimetype,
  originalName,
}) {
  await assertWorkforceEmployeeInOrg(employeeId, organizationId);

  const name = sanitizeDocumentDisplayName(displayName);
  if (!name) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Indica un nombre para el documento.';
    throw err;
  }

  if (!buffer || buffer.length > WORKFORCE_DOCUMENT_MAX_BYTES) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'El documento supera el límite de 10 MB.';
    throw err;
  }

  const ext = sniffWorkforceDocumentExt(buffer);
  if (!ext) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Formato no permitido. Use PDF, JPG, PNG o WEBP.';
    throw err;
  }
  const mimeExt = workforceDocumentExtForMime(mimetype, originalName);
  if (mimeExt && mimeExt !== ext) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'El contenido del archivo no coincide con su tipo declarado.';
    throw err;
  }

  const empDir = path.join(resolveWorkforceDocumentsDirAbs(), organizationId, employeeId);
  await fs.promises.mkdir(empDir, { recursive: true });
  const fileName = `${crypto.randomUUID()}${ext}`;
  const relativePath = `${WORKFORCE_DOCUMENT_SUBDIR}/${organizationId}/${employeeId}/${fileName}`;
  const abs = resolveWorkforceDocumentAbs(relativePath, organizationId, employeeId);
  await fs.promises.writeFile(abs, buffer);

  const mimeType =
    ext === '.pdf'
      ? 'application/pdf'
      : ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/jpeg';

  let created;
  try {
    created = await prisma.workforceDocument.create({
      data: {
        organizationId,
        employeeId,
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

  return sanitizeDocumentForAdmin(created);
}

/**
 * DELETE V1: primero BD, luego disco.
 * - Si falla el delete en BD → el archivo no se toca (sin registro roto).
 * - Si falla el unlink tras borrar la fila → registro ya no existe; se registra error y se responde 500
 *   (posible archivo huérfano en disco, sin fila fantasma en UI).
 */
export async function deleteWorkforceDocument(organizationId, documentId) {
  const doc = await assertWorkforceDocumentInOrg(documentId, organizationId);
  assertSafeWorkforceDocumentPath(doc.filePath, organizationId, doc.employeeId);

  await prisma.workforceDocument.delete({ where: { id: doc.id } });

  try {
    await removeWorkforceDocumentFile(doc.filePath, organizationId, doc.employeeId);
  } catch (e) {
    if (e?.code === 'ENOENT') {
      return;
    }
    console.error('[workforce-document] DB row deleted but file cleanup failed', {
      documentId: doc.id,
      organizationId,
      employeeId: doc.employeeId,
      message: e?.message,
    });
    const err = new Error(
      'El documento se eliminó del expediente, pero no se pudo borrar el archivo en almacenamiento.',
    );
    err.code = 'PARTIAL_DELETE';
    throw err;
  }
}

export function documentContentDispositionFilename(displayName, ext) {
  const safe = String(displayName || 'documento')
    .replace(/[\x00-\x1f\x7f\r\n"\\]/g, '')
    .replace(/[^\w\s\u00C0-\u024F.-]/g, '')
    .trim()
    .slice(0, 120);
  const suffix = ext && safe.toLowerCase().endsWith(ext) ? '' : ext || '';
  return `${safe || 'documento'}${suffix}`;
}

/** Content-Disposition inline con filename ASCII seguro (sin CRLF ni comillas). */
export function contentDispositionInlineHeader(displayName, ext) {
  const filename = documentContentDispositionFilename(displayName, ext);
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '');
  return `inline; filename="${ascii}"`;
}

export function documentServeContentType(doc) {
  const stored = String(doc.mimeType || '').toLowerCase();
  if (ALLOWED_MIME.has(stored)) return stored;
  const ext = path.extname(doc.filePath || '').toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

export async function streamWorkforceDocumentFile(req, res, doc, organizationId) {
  assertSafeWorkforceDocumentPath(doc.filePath, organizationId, doc.employeeId);
  const abs = resolveWorkforceDocumentAbs(doc.filePath, organizationId, doc.employeeId);
  const stat = await fs.promises.stat(abs);
  const ext = path.extname(doc.filePath).toLowerCase();
  const etag = `"${doc.id}-${doc.createdAt.getTime()}"`;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader('Content-Type', documentServeContentType(doc));
  res.setHeader('Cache-Control', 'private, max-age=3600, must-revalidate');
  res.setHeader('ETag', etag);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', contentDispositionInlineHeader(doc.displayName, ext));
  fs.createReadStream(abs).pipe(res);
}

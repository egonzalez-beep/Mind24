import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { prisma } from '../db/client.js';
import { resolveUploadsRootAbs, resolveWorkforceAvatarsDirAbs } from '../utils/uploadPaths.js';
import { assertWorkforceEmployeeInOrg } from './workforceEmployee.service.js';
import { workforceProfilePhotoEtag, workforceProfilePhotoVersion } from '../utils/workforcePhotoVersion.js';

export const WORKFORCE_AVATAR_MAX_BYTES = 3 * 1024 * 1024;
export const WORKFORCE_AVATAR_SUBDIR = 'workforce-avatars';

const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

export function workforceAvatarExtForMime(mimetype, originalName = '') {
  const mime = String(mimetype || '').toLowerCase();
  if (ALLOWED.has(mime)) return ALLOWED.get(mime);
  const ext = path.extname(originalName || '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    return ext === '.jpeg' ? '.jpg' : ext;
  }
  return null;
}

export function isAllowedWorkforceAvatarFile(mimetype, originalName = '') {
  return workforceAvatarExtForMime(mimetype, originalName) != null;
}

/** Una sola imagen, sin campos de texto. La validación de bytes sigue en el servicio. */
export function createWorkforceAvatarUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: WORKFORCE_AVATAR_MAX_BYTES, files: 1, fields: 0 },
    fileFilter: (_req, file, cb) => {
      const allowed = isAllowedWorkforceAvatarFile(file.mimetype, file.originalname);
      cb(allowed ? null : new Error('INVALID_AVATAR_FILE'), allowed);
    },
  });
}

const workforcePhotoQueues = new Map();

function enqueueWorkforcePhoto(employeeId, task) {
  const previous = workforcePhotoQueues.get(employeeId) || Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  const tracked = run.finally(() => {
    if (workforcePhotoQueues.get(employeeId) === tracked) workforcePhotoQueues.delete(employeeId);
  });
  workforcePhotoQueues.set(employeeId, tracked);
  return tracked;
}

export function workforcePhotoQueueSize() {
  return workforcePhotoQueues.size;
}

/** Serializa operaciones de foto del mismo colaborador dentro de este proceso. */
export function withWorkforcePhotoLock(employeeId, task) {
  return enqueueWorkforcePhoto(employeeId, task);
}

let workforceAvatarPersistHook = null;

/** Solo pruebas: se ejecuta después de escribir el archivo y antes de actualizar la base. */
export function setWorkforceAvatarPersistHookForTests(fn) {
  workforceAvatarPersistHook = typeof fn === 'function' ? fn : null;
}

export function publicProfilePhotoDto(emp) {
  const hasProfilePhoto = !!emp?.profilePhotoPath;
  return {
    hasProfilePhoto,
    profilePhotoVersion: hasProfilePhoto ? workforceProfilePhotoVersion(emp.profilePhotoPath) : null,
    photoUrl: hasProfilePhoto ? '/api/timeclock/public/photo' : null,
  };
}

function logAvatarCleanup(organizationId, relativePath) {
  console.error('[workforce-avatar] cleanup-pending', {
    organizationId,
    relativePath,
  });
}

/**
 * Escribe el archivo nuevo y confirma la ruta solo si previousPath sigue vigente.
 * Si la confirmación falla, borra únicamente el archivo nuevo.
 * Si borrar el archivo anterior falla después de confirmar, lo registra y no revierte.
 */
export async function placeWorkforceAvatarFile({
  organizationId,
  previousPath,
  buffer,
  ext,
  commit,
  removePrevious,
}) {
  const orgDir = path.join(resolveWorkforceAvatarsDirAbs(), organizationId);
  await fs.promises.mkdir(orgDir, { recursive: true });
  const relativePath = `${WORKFORCE_AVATAR_SUBDIR}/${organizationId}/${crypto.randomUUID()}${ext}`;
  const abs = resolveWorkforceProfilePhotoAbs(relativePath, organizationId);
  await fs.promises.writeFile(abs, buffer);

  let persisted = false;
  try {
    if (workforceAvatarPersistHook) await workforceAvatarPersistHook();
    persisted = await commit(relativePath, previousPath);
    if (!persisted) {
      const err = new Error('CONFLICT');
      err.code = 'CONFLICT';
      err.message = 'La fotografía cambió mientras se guardaba. Intenta de nuevo.';
      throw err;
    }
  } catch (e) {
    if (!persisted) await fs.promises.unlink(abs).catch(() => {});
    throw e;
  }

  if (previousPath && previousPath !== relativePath) {
    try {
      await removePrevious(previousPath);
    } catch (e) {
      if (e?.code !== 'ENOENT') logAvatarCleanup(organizationId, previousPath);
    }
  }
  return relativePath;
}

/** Magic-byte sniff — source of truth for stored extension (V1, no image decoder). */
export function sniffWorkforceAvatarExt(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return '.png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return '.jpg';
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return '.webp';
  }
  return null;
}

/** Relative path stored in DB must stay under workforce-avatars/{organizationId}/ */
export function assertSafeWorkforceProfilePhotoPath(relativePath, organizationId) {
  if (!relativePath || typeof relativePath !== 'string') {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = `${WORKFORCE_AVATAR_SUBDIR}/${organizationId}/`;
  if (!normalized.startsWith(prefix) || normalized.includes('..')) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Ruta de foto inválida.';
    throw err;
  }
  return normalized;
}

export function resolveWorkforceProfilePhotoAbs(relativePath, organizationId) {
  const safeRel = assertSafeWorkforceProfilePhotoPath(relativePath, organizationId);
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

export async function removeWorkforceProfilePhotoFile(relativePath, organizationId) {
  if (!relativePath) return;
  try {
    const abs = resolveWorkforceProfilePhotoAbs(relativePath, organizationId);
    await fs.promises.unlink(abs);
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
}

async function saveWorkforceEmployeeProfilePhotoNow({
  organizationId,
  employeeId,
  buffer,
  mimetype,
  originalName,
}) {
  const existing = await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const previousPath = existing.profilePhotoPath ?? null;

  if (!buffer || buffer.length > WORKFORCE_AVATAR_MAX_BYTES) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'La imagen supera el límite de 3 MB.';
    throw err;
  }

  const ext = sniffWorkforceAvatarExt(buffer);
  if (!ext) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Formato de imagen no permitido. Use JPG, PNG o WEBP.';
    throw err;
  }
  const mimeExt = workforceAvatarExtForMime(mimetype, originalName);
  if (mimeExt && mimeExt !== ext) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'El contenido del archivo no coincide con su tipo declarado.';
    throw err;
  }

  const relativePath = await placeWorkforceAvatarFile({
    organizationId,
    previousPath,
    buffer,
    ext,
    commit: async (nextPath, expectedPath) => {
      const result = await prisma.workforceEmployee.updateMany({
        where: { id: employeeId, organizationId, profilePhotoPath: expectedPath },
        data: { profilePhotoPath: nextPath },
      });
      return result.count === 1;
    },
    removePrevious: (prev) => removeWorkforceProfilePhotoFile(prev, organizationId),
  });
  return prisma.workforceEmployee.findFirst({
    where: { id: employeeId, organizationId, profilePhotoPath: relativePath },
  });
}

export function saveWorkforceEmployeeProfilePhoto(args) {
  return enqueueWorkforcePhoto(args.employeeId, () => saveWorkforceEmployeeProfilePhotoNow(args));
}

async function clearWorkforceEmployeeProfilePhotoNow(organizationId, employeeId) {
  const existing = await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const prev = existing.profilePhotoPath ?? null;
  if (!prev) return existing;
  const result = await prisma.workforceEmployee.updateMany({
    where: { id: employeeId, organizationId, profilePhotoPath: prev },
    data: { profilePhotoPath: null },
  });
  if (result.count === 1) {
    try {
      await removeWorkforceProfilePhotoFile(prev, organizationId);
    } catch (e) {
      if (e?.code !== 'ENOENT') logAvatarCleanup(organizationId, prev);
    }
  }
  return prisma.workforceEmployee.findFirst({
    where: { id: employeeId, organizationId },
  });
}

export function clearWorkforceEmployeeProfilePhoto(organizationId, employeeId) {
  return enqueueWorkforcePhoto(employeeId, () => clearWorkforceEmployeeProfilePhotoNow(organizationId, employeeId));
}

export function profilePhotoContentType(relativePath) {
  const ext = path.extname(relativePath || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

/** Sirve foto con cache privado + ETag (admin o sesión pública del mismo colaborador). */
export async function streamWorkforceProfilePhoto(req, res, emp, organizationId) {
  if (!emp.profilePhotoPath) {
    res.status(404).json({ error: 'Sin foto de perfil.' });
    return;
  }
  const abs = resolveWorkforceProfilePhotoAbs(emp.profilePhotoPath, organizationId);
  const stat = await fs.promises.stat(abs);
  const etag = workforceProfilePhotoEtag(emp.profilePhotoPath);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader('Content-Type', profilePhotoContentType(emp.profilePhotoPath));
  res.setHeader('Cache-Control', 'private, max-age=3600, must-revalidate');
  res.setHeader('ETag', etag);
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(abs).pipe(res);
}

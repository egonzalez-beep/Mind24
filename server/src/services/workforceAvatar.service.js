import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { resolveUploadsRootAbs, resolveWorkforceAvatarsDirAbs } from '../utils/uploadPaths.js';
import { assertWorkforceEmployeeInOrg } from './workforceEmployee.service.js';

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

export async function saveWorkforceEmployeeProfilePhoto({
  organizationId,
  employeeId,
  buffer,
  mimetype,
  originalName,
}) {
  const existing = await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const previousPath = existing.profilePhotoPath;

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

  const orgDir = path.join(resolveWorkforceAvatarsDirAbs(), organizationId);
  await fs.promises.mkdir(orgDir, { recursive: true });
  const fileName = `${crypto.randomUUID()}${ext}`;
  const relativePath = `${WORKFORCE_AVATAR_SUBDIR}/${organizationId}/${fileName}`;
  const abs = resolveWorkforceProfilePhotoAbs(relativePath, organizationId);
  await fs.promises.writeFile(abs, buffer);

  let updated;
  try {
    updated = await prisma.workforceEmployee.update({
      where: { id: employeeId },
      data: { profilePhotoPath: relativePath },
    });
  } catch (e) {
    await fs.promises.unlink(abs).catch(() => {});
    throw e;
  }

  if (previousPath && previousPath !== relativePath) {
    await removeWorkforceProfilePhotoFile(previousPath, organizationId);
  }

  return updated;
}

export async function clearWorkforceEmployeeProfilePhoto(organizationId, employeeId) {
  const existing = await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const prev = existing.profilePhotoPath;
  const updated = await prisma.workforceEmployee.update({
    where: { id: employeeId },
    data: { profilePhotoPath: null },
  });
  if (prev) await removeWorkforceProfilePhotoFile(prev, organizationId);
  return updated;
}

export function profilePhotoContentType(relativePath) {
  const ext = path.extname(relativePath || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

import crypto from 'crypto';

/**
 * Versión opaca de la fotografía. Cambia solo cuando cambia profilePhotoPath
 * (alta, reemplazo o baja). No usa updatedAt ni revela la ruta.
 */
export function workforceProfilePhotoVersion(profilePhotoPath) {
  if (!profilePhotoPath || typeof profilePhotoPath !== 'string') return null;
  return crypto.createHash('sha256').update(profilePhotoPath, 'utf8').digest('hex').slice(0, 16);
}

export function workforceProfilePhotoEtag(profilePhotoPath) {
  const version = workforceProfilePhotoVersion(profilePhotoPath);
  if (!version) return null;
  return `"${version}"`;
}

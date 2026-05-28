import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Ruta por defecto del volumen persistente en Railway.
 * Montar el volumen en `/data` y usar `AUDIO_UPLOAD_DIR=/data/uploads`.
 */
export const RAILWAY_DEFAULT_UPLOAD_ROOT = '/data/uploads';

function devUploadsFallbackAbs() {
  return path.resolve(__dirname, '..', '..', 'public', 'uploads');
}

function appPackageRootAbs() {
  return path.resolve(__dirname, '..', '..');
}

function assertProductionUsesExternalVolume(absRoot) {
  if (env.NODE_ENV !== 'production') return;
  const appRoot = appPackageRootAbs();
  const rootWithSep = appRoot.endsWith(path.sep) ? appRoot : appRoot + path.sep;
  if (absRoot === appRoot || absRoot.startsWith(rootWithSep)) {
    throw new Error(
      `[uploads] En producción la ruta "${absRoot}" está dentro del código desplegado (${appRoot}). ` +
        `Configure AUDIO_UPLOAD_DIR con la ruta absoluta del volumen Railway (ej. ${RAILWAY_DEFAULT_UPLOAD_ROOT}).`,
    );
  }
}

/**
 * Raíz absoluta de archivos servidos bajo `/uploads/*`.
 * Producción: volumen persistente (AUDIO_UPLOAD_DIR o /data/uploads). Sin fallback efímero.
 */
export function resolveUploadsRootAbs() {
  const configured = (env.AUDIO_UPLOAD_DIR || '').trim();
  let abs;

  if (configured) {
    if (!path.isAbsolute(configured)) {
      if (env.NODE_ENV === 'production') {
        throw new Error(
          `[uploads] AUDIO_UPLOAD_DIR debe ser una ruta absoluta del volumen (recibido: "${configured}"). ` +
            `Ejemplo: ${RAILWAY_DEFAULT_UPLOAD_ROOT}`,
        );
      }
      abs = path.resolve(configured);
    } else {
      abs = path.normalize(configured);
    }
  } else if (env.NODE_ENV === 'production') {
    abs = RAILWAY_DEFAULT_UPLOAD_ROOT;
  } else {
    abs = devUploadsFallbackAbs();
  }

  assertProductionUsesExternalVolume(abs);
  return abs;
}

export function resolveAudiosDirAbs() {
  return path.join(resolveUploadsRootAbs(), 'audios');
}

/** Metadatos para logs y healthcheck. */
export function getUploadStorageMeta() {
  const uploadsRootAbs = resolveUploadsRootAbs();
  const audiosDirAbs = resolveAudiosDirAbs();
  const configured = (env.AUDIO_UPLOAD_DIR || '').trim();
  const source = configured
    ? 'AUDIO_UPLOAD_DIR'
    : env.NODE_ENV === 'production'
      ? 'railway_default_volume'
      : 'dev_public_uploads';
  return {
    uploadsRootAbs,
    audiosDirAbs,
    source,
    persistent: source !== 'dev_public_uploads',
  };
}

/**
 * Verifica que el directorio de audios sea un volumen persistente escribiendo un archivo
 * centinela con timestamp. Si ya existe (de un arranque anterior), el volumen sobrevivió.
 *
 * Retorna:
 *   { writable, likelySurvivesRestart, sentinelPath, previousTimestamp }
 */
export function checkVolumePersistence() {
  const audiosDirAbs = resolveAudiosDirAbs();
  const sentinelPath = path.join(audiosDirAbs, '.volume_check');

  let previousTimestamp = null;
  let likelySurvivesRestart = false;

  try {
    fs.mkdirSync(audiosDirAbs, { recursive: true });
  } catch (_) {
    return { writable: false, likelySurvivesRestart: false, sentinelPath, previousTimestamp: null };
  }

  // Si el centinela ya existe, el filesystem sobrevivió al menos un restart.
  try {
    const existing = JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
    previousTimestamp = existing.ts || null;
    const ageMs = previousTimestamp ? Date.now() - new Date(previousTimestamp).getTime() : 0;
    // Si el centinela tiene más de 60 s → sobrevivió al menos un reinicio real.
    likelySurvivesRestart = ageMs > 60_000;
  } catch (_) {
    // No existía aún (primer arranque en este filesystem).
  }

  // Escribe/actualiza el centinela con el timestamp actual.
  let writable = false;
  try {
    fs.writeFileSync(sentinelPath, JSON.stringify({ ts: new Date().toISOString() }), 'utf8');
    writable = true;
  } catch (_) {
    // No se pudo escribir — el filesystem no tiene permisos o está lleno.
  }

  return { writable, likelySurvivesRestart, sentinelPath, previousTimestamp };
}

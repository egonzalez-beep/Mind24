import fs from 'fs/promises';
import path from 'path';
import { resolveUploadsRootAbs } from './uploadPaths.js';

function safeUnlink(absPath) {
  return fs.unlink(absPath).catch((e) => {
    // Silent best-effort cleanup: ignore ENOENT and any other FS errors.
    if (e && e.code === 'ENOENT') return;
  });
}

/**
 * Deletes interview audio files on disk.
 * @param {{ bloque1?: string, bloque2?: string, bloque3?: string }|null} audios
 */
export async function deleteDigitalInterviewAudioFiles(audios) {
  if (!audios || typeof audios !== 'object') return;
  const uploadsRootAbs = resolveUploadsRootAbs();

  const values = [audios.bloque1, audios.bloque2, audios.bloque3]
    .map((v) => (v == null ? '' : String(v)))
    .filter(Boolean);

  const tasks = [];
  for (const urlPath of values) {
    // Expect public url like "/uploads/audios/xxx.webm"
    const normalized = urlPath.replace(/\\/g, '/');
    const idx = normalized.indexOf('/uploads/');
    if (idx < 0) continue;
    const relFromUploads = normalized.slice(idx + '/uploads/'.length).replace(/^\/+/, '');
    const abs = path.resolve(uploadsRootAbs, relFromUploads);

    // Safety: never unlink outside uploads root
    const rootWithSep = uploadsRootAbs.endsWith(path.sep)
      ? uploadsRootAbs
      : uploadsRootAbs + path.sep;
    if (!abs.startsWith(rootWithSep)) continue;

    tasks.push(safeUnlink(abs));
  }
  await Promise.all(tasks);
}


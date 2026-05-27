import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveUploadsRootAbs() {
  if (env.AUDIO_UPLOAD_DIR) return path.resolve(env.AUDIO_UPLOAD_DIR);
  return path.resolve(__dirname, '..', '..', 'public', 'uploads');
}

export function resolveAudiosDirAbs() {
  return path.join(resolveUploadsRootAbs(), 'audios');
}


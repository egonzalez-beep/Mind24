import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Ruta relativa al directorio `server/` — documentada para operaciones. */
export const MIND24_BRANDING_DIR = 'public/assets/branding';

/** Nombres de archivo soportados (prioridad: SVG, luego PNG). */
export const MIND24_LOGO_FILENAMES = ['mind24-logo.svg', 'mind24-logo.png'];

function brandingDirAbs() {
  return path.join(__dirname, '../../public/assets/branding');
}

/**
 * Resuelve logo oficial para incrustar en PDF (data URI).
 * @returns {{ dataUri: string, mime: string, filename: string } | null}
 */
export function resolveMind24LogoDataUri() {
  const dir = brandingDirAbs();
  for (const filename of MIND24_LOGO_FILENAMES) {
    const abs = path.join(dir, filename);
    if (!fs.existsSync(abs)) continue;
    const buf = fs.readFileSync(abs);
    const mime = filename.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    return {
      dataUri: `data:${mime};base64,${buf.toString('base64')}`,
      mime,
      filename,
    };
  }
  return null;
}

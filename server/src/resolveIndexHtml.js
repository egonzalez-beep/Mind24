import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resuelve index.html: monorepo (repo/index.html), bundle en server/public,
 * override FRONTEND_INDEX_PATH, o cwd (Railway con layout distinto).
 */
export function resolveIndexHtmlPath() {
  if (process.env.FRONTEND_INDEX_PATH) {
    const abs = path.resolve(process.env.FRONTEND_INDEX_PATH);
    if (fs.existsSync(abs)) return abs;
  }
  const monorepo = path.resolve(__dirname, '../../index.html');
  if (fs.existsSync(monorepo)) return monorepo;
  const bundled = path.join(__dirname, '../public/index.html');
  if (fs.existsSync(bundled)) return path.resolve(bundled);
  const cwdParent = path.resolve(process.cwd(), '..', 'index.html');
  if (fs.existsSync(cwdParent)) return cwdParent;
  const cwdHere = path.resolve(process.cwd(), 'index.html');
  if (fs.existsSync(cwdHere)) return cwdHere;
  throw new Error(
    'index.html no encontrado. Define FRONTEND_INDEX_PATH o ejecuta «node scripts/sync-index-html.mjs» con el repo completo y vuelve a desplegar.',
  );
}

/**
 * Copia ../index.html → public/index.html cuando el repo completo está presente
 * (desarrollo local o build Railway con contexto que incluye el padre).
 * Si no hay padre, se deja la copia ya versionada en public/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');
const parentIndex = path.resolve(serverDir, '..', 'index.html');
const dest = path.join(serverDir, 'public', 'index.html');

if (fs.existsSync(parentIndex)) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(parentIndex, dest);
  process.stdout.write('[sync-index-html] updated server/public/index.html from repo root\n');
} else if (!fs.existsSync(dest)) {
  process.stderr.write(
    '[sync-index-html] warn: no ../index.html and no public/index.html — add index or set FRONTEND_INDEX_PATH\n',
  );
  process.exitCode = 0;
}

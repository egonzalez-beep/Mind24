/**
 * Seed idempotente del catálogo (módulos + preguntas Cleaver/placeholders).
 * No borra usuarios ni asignaciones.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/db/client.js';
import { ensureEvaluationCatalog } from '../src/services/evaluationCatalog.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  await ensureEvaluationCatalog(prisma);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

import { ensureEvaluationCatalog } from '../src/services/evaluationCatalog.service.js';

/** Reset destructivo del motor dinámico + repoblado (solo dev / seed completo). */
export async function seedEvaluationEngine(prisma) {
  await prisma.candidateResponse.deleteMany();
  await prisma.questionOption.deleteMany();
  await prisma.question.deleteMany();
  await prisma.evaluationModule.deleteMany();
  return ensureEvaluationCatalog(prisma);
}

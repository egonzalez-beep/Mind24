-- Progreso por módulo y clave de módulo en intentos
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "completedModules" JSONB;
ALTER TABLE "AssessmentAttempt" ADD COLUMN IF NOT EXISTS "moduleKey" TEXT;

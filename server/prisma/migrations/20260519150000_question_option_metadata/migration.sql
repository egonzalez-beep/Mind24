-- Metadata por opción (dimensiones Cleaver DISC, etc.)
ALTER TABLE "QuestionOption" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

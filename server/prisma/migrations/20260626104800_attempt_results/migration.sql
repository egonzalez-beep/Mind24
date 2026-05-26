-- Add results JSON for storing module-specific payloads (e.g., digital interview audios)
ALTER TABLE "AssessmentAttempt" ADD COLUMN "results" JSONB;


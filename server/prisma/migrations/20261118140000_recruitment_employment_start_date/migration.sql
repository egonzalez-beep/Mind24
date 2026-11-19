-- Fecha de ingreso laboral (calendario). Nullable, sin default ni backfill.
ALTER TABLE "RecruitmentApplication" ADD COLUMN "employmentStartDate" DATE;

-- Cobertura confirmada de vacantes. Sin backfill: un contratado previo sin timestamp no cuenta como confirmado.
CREATE TYPE "RecruitmentVacancyCoverageSource" AS ENUM ('MANUAL', 'AUTOMATIC');

ALTER TABLE "RecruitmentVacancy" ADD COLUMN "coveredAt" TIMESTAMPTZ(6),
ADD COLUMN "coverageSource" "RecruitmentVacancyCoverageSource";

ALTER TABLE "RecruitmentApplication" ADD COLUMN "hiredStageEnteredAt" TIMESTAMPTZ(6);

CREATE INDEX "RecruitmentApplication_hiredStageEnteredAt_idx" ON "RecruitmentApplication"("hiredStageEnteredAt");

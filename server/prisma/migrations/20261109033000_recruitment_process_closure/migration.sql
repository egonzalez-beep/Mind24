-- Cierre de proceso y archivado automático. Sin backfill y sin valores por defecto:
-- los candidatos históricos quedan con estos campos en NULL y el barrido no los selecciona.

CREATE TYPE "RecruitmentApplicationClosureOutcome" AS ENUM ('REJECTED', 'DECLINED');

CREATE TYPE "RecruitmentApplicationClosureReason" AS ENUM (
  'ACCEPTED_OTHER_OFFER',
  'PAY_OR_CONDITIONS',
  'LOCATION_OR_TRANSPORT',
  'SCHEDULE',
  'PERSONAL',
  'NO_LONGER_INTERESTED',
  'NO_RESPONSE',
  'OTHER'
);

ALTER TABLE "RecruitmentApplication" ADD COLUMN "closedAt" TIMESTAMPTZ(6);
ALTER TABLE "RecruitmentApplication" ADD COLUMN "closureOutcome" "RecruitmentApplicationClosureOutcome";
ALTER TABLE "RecruitmentApplication" ADD COLUMN "closureReason" "RecruitmentApplicationClosureReason";
ALTER TABLE "RecruitmentApplication" ADD COLUMN "closureNote" VARCHAR(240);

ALTER TABLE "RecruitmentCandidate" ADD COLUMN "autoArchiveEligibleAt" TIMESTAMPTZ(6);

CREATE INDEX "RecruitmentCandidate_autoArchiveEligibleAt_idx" ON "RecruitmentCandidate"("autoArchiveEligibleAt");

ALTER TYPE "WorkforceRecruitmentNovedadEventType" ADD VALUE 'DECLINED';

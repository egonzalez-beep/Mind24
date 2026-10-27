-- AlterTable
ALTER TABLE "RecruitmentCandidate" ADD COLUMN "locality" TEXT;
ALTER TABLE "RecruitmentCandidate" ADD COLUMN "neighborhood" TEXT;

-- AlterTable
ALTER TABLE "RecruitmentApplication" ADD COLUMN "interviewScheduledAt" TIMESTAMPTZ(6);

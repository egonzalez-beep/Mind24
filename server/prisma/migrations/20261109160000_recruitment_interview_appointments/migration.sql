-- AlterEnum
ALTER TYPE "RecruitmentApplicationInterviewEventType" ADD VALUE 'SCHEDULED';
ALTER TYPE "RecruitmentApplicationInterviewEventType" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "RecruitmentApplicationInterviewEvent" ADD COLUMN "label" VARCHAR(80);
ALTER TABLE "RecruitmentApplicationInterviewEvent" ADD COLUMN "comment" VARCHAR(500);

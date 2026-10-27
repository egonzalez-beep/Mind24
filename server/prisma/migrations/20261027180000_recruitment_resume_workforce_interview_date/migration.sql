-- Workforce puede subir CV sin User admin (uploadedByWorkforceEmployeeId).
ALTER TABLE "RecruitmentCandidateResume" ALTER COLUMN "uploadedByUserId" DROP NOT NULL;
ALTER TABLE "RecruitmentCandidateResume" ADD COLUMN "uploadedByWorkforceEmployeeId" TEXT;

ALTER TABLE "RecruitmentCandidateResume" DROP CONSTRAINT IF EXISTS "RecruitmentCandidateResume_uploadedByUserId_fkey";
ALTER TABLE "RecruitmentCandidateResume" ADD CONSTRAINT "RecruitmentCandidateResume_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RecruitmentCandidateResume" ADD CONSTRAINT "RecruitmentCandidateResume_uploadedByWorkforceEmployeeId_fkey" FOREIGN KEY ("uploadedByWorkforceEmployeeId") REFERENCES "WorkforceEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Entrevista con fecha sin hora (no inventar hora en UI).
ALTER TABLE "RecruitmentApplication" ADD COLUMN "interviewTimeSpecified" BOOLEAN NOT NULL DEFAULT true;

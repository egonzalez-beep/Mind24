-- Aviso administrativo al crear un candidato de reclutamiento. Sin backfill.
ALTER TYPE "OrgNotificationType" ADD VALUE 'RECRUITMENT_CANDIDATE_CREATED';

ALTER TABLE "OrgNotification" ADD COLUMN "recruitmentCandidateId" TEXT,
ADD COLUMN "recruitmentVacancyId" TEXT,
ADD COLUMN "recruitmentStageId" TEXT;

ALTER TABLE "OrgNotification" ADD CONSTRAINT "OrgNotification_recruitmentCandidateId_fkey" FOREIGN KEY ("recruitmentCandidateId") REFERENCES "RecruitmentCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrgNotification" ADD CONSTRAINT "OrgNotification_recruitmentVacancyId_fkey" FOREIGN KEY ("recruitmentVacancyId") REFERENCES "RecruitmentVacancy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrgNotification" ADD CONSTRAINT "OrgNotification_recruitmentStageId_fkey" FOREIGN KEY ("recruitmentStageId") REFERENCES "RecruitmentStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

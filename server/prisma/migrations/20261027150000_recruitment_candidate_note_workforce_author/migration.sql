-- Autor colaborador Workforce en observaciones (distinto de authorUserId admin).
ALTER TABLE "RecruitmentCandidateNote" ADD COLUMN "authorWorkforceEmployeeId" TEXT;

CREATE INDEX "RecruitmentCandidateNote_authorWorkforceEmployeeId_idx"
  ON "RecruitmentCandidateNote"("authorWorkforceEmployeeId");

ALTER TABLE "RecruitmentCandidateNote" ADD CONSTRAINT "RecruitmentCandidateNote_authorWorkforceEmployeeId_fkey"
  FOREIGN KEY ("authorWorkforceEmployeeId") REFERENCES "WorkforceEmployee"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

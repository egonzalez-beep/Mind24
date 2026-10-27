-- Trazabilidad: colaborador Workforce que registró al candidato (distinto de Fuente).
ALTER TABLE "RecruitmentCandidate" ADD COLUMN "registeredByWorkforceEmployeeId" TEXT;

CREATE INDEX "RecruitmentCandidate_registeredByWorkforceEmployeeId_idx"
  ON "RecruitmentCandidate"("registeredByWorkforceEmployeeId");

ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_registeredByWorkforceEmployeeId_fkey"
  FOREIGN KEY ("registeredByWorkforceEmployeeId") REFERENCES "WorkforceEmployee"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

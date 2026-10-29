-- Novedades de reclutamiento para colaboradores (portal checador).
CREATE TYPE "WorkforceRecruitmentNovedadEventType" AS ENUM ('STAGE_CHANGED', 'HIRED', 'REJECTED');

CREATE TABLE "WorkforceRecruitmentNovedad" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recipientWorkforceEmployeeId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "eventType" "WorkforceRecruitmentNovedadEventType" NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(6),

    CONSTRAINT "WorkforceRecruitmentNovedad_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkforceRecruitmentNovedad_organizationId_dedupeKey_key"
  ON "WorkforceRecruitmentNovedad"("organizationId", "dedupeKey");

CREATE INDEX "WrNovedad_org_recipient_created"
  ON "WorkforceRecruitmentNovedad"("organizationId", "recipientWorkforceEmployeeId", "createdAt");

CREATE INDEX "WrNovedad_org_recipient_readAt"
  ON "WorkforceRecruitmentNovedad"("organizationId", "recipientWorkforceEmployeeId", "readAt");

ALTER TABLE "WorkforceRecruitmentNovedad" ADD CONSTRAINT "WorkforceRecruitmentNovedad_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkforceRecruitmentNovedad" ADD CONSTRAINT "WorkforceRecruitmentNovedad_recipientWorkforceEmployeeId_fkey"
  FOREIGN KEY ("recipientWorkforceEmployeeId") REFERENCES "WorkforceEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkforceRecruitmentNovedad" ADD CONSTRAINT "WorkforceRecruitmentNovedad_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "RecruitmentCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkforceRecruitmentNovedad" ADD CONSTRAINT "WorkforceRecruitmentNovedad_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "RecruitmentApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkforceRecruitmentNovedad" ADD CONSTRAINT "WorkforceRecruitmentNovedad_vacancyId_fkey"
  FOREIGN KEY ("vacancyId") REFERENCES "RecruitmentVacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkforceRecruitmentNovedad" ADD CONSTRAINT "WorkforceRecruitmentNovedad_fromStageId_fkey"
  FOREIGN KEY ("fromStageId") REFERENCES "RecruitmentStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkforceRecruitmentNovedad" ADD CONSTRAINT "WorkforceRecruitmentNovedad_toStageId_fkey"
  FOREIGN KEY ("toStageId") REFERENCES "RecruitmentStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

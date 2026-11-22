-- Baja laboral por contratación (1:1 con RecruitmentApplication). Aditivo, sin backfill.
ALTER TYPE "WorkforceRecruitmentNovedadEventType" ADD VALUE 'EMPLOYMENT_EXIT';

CREATE TABLE "RecruitmentApplicationEmploymentExit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "exitDate" DATE NOT NULL,
    "reason" VARCHAR(160) NOT NULL,
    "underWarranty" BOOLEAN NOT NULL,
    "registeredByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruitmentApplicationEmploymentExit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecruitmentApplicationEmploymentExit_applicationId_key" ON "RecruitmentApplicationEmploymentExit"("applicationId");

CREATE INDEX "RecruitmentApplicationEmploymentExit_organizationId_idx" ON "RecruitmentApplicationEmploymentExit"("organizationId");

ALTER TABLE "RecruitmentApplicationEmploymentExit" ADD CONSTRAINT "RecruitmentApplicationEmploymentExit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecruitmentApplicationEmploymentExit" ADD CONSTRAINT "RecruitmentApplicationEmploymentExit_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RecruitmentApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecruitmentApplicationEmploymentExit" ADD CONSTRAINT "RecruitmentApplicationEmploymentExit_registeredByUserId_fkey" FOREIGN KEY ("registeredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

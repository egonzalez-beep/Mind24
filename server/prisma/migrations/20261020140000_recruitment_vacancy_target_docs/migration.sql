-- AlterTable
ALTER TABLE "RecruitmentVacancy" ADD COLUMN "targetCoverageDate" DATE;

-- CreateEnum
CREATE TYPE "RecruitmentVacancyDocumentCategory" AS ENUM ('PROFILE', 'ROUTES', 'FORM', 'COMMERCIAL_PROPOSAL', 'CLIENT_DOCUMENT', 'OTHER');

-- CreateTable
CREATE TABLE "RecruitmentVacancyDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "category" "RecruitmentVacancyDocumentCategory" NOT NULL DEFAULT 'OTHER',
    "filePath" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruitmentVacancyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecruitmentVacancyDocument_organizationId_vacancyId_idx" ON "RecruitmentVacancyDocument"("organizationId", "vacancyId");

-- CreateIndex
CREATE INDEX "RecruitmentVacancyDocument_organizationId_idx" ON "RecruitmentVacancyDocument"("organizationId");

-- CreateIndex
CREATE INDEX "RecruitmentVacancyDocument_vacancyId_idx" ON "RecruitmentVacancyDocument"("vacancyId");

-- AddForeignKey
ALTER TABLE "RecruitmentVacancyDocument" ADD CONSTRAINT "RecruitmentVacancyDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentVacancyDocument" ADD CONSTRAINT "RecruitmentVacancyDocument_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "RecruitmentVacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentVacancyDocument" ADD CONSTRAINT "RecruitmentVacancyDocument_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

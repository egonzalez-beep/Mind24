-- CreateTable
CREATE TABLE "RecruitmentVacancyStage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentVacancyStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentVacancyStage_vacancyId_stageId_key" ON "RecruitmentVacancyStage"("vacancyId", "stageId");

-- CreateIndex
CREATE INDEX "RecruitmentVacancyStage_organizationId_idx" ON "RecruitmentVacancyStage"("organizationId");

-- CreateIndex
CREATE INDEX "RecruitmentVacancyStage_vacancyId_idx" ON "RecruitmentVacancyStage"("vacancyId");

-- CreateIndex
CREATE INDEX "RecruitmentVacancyStage_organizationId_vacancyId_idx" ON "RecruitmentVacancyStage"("organizationId", "vacancyId");

-- CreateIndex
CREATE INDEX "RecruitmentVacancyStage_stageId_idx" ON "RecruitmentVacancyStage"("stageId");

-- CreateIndex
CREATE INDEX "RecruitmentVacancyStage_vacancyId_isEnabled_idx" ON "RecruitmentVacancyStage"("vacancyId", "isEnabled");

-- CreateIndex
CREATE INDEX "RecruitmentVacancyStage_vacancyId_position_idx" ON "RecruitmentVacancyStage"("vacancyId", "position");

-- AddForeignKey
ALTER TABLE "RecruitmentVacancyStage" ADD CONSTRAINT "RecruitmentVacancyStage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentVacancyStage" ADD CONSTRAINT "RecruitmentVacancyStage_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "RecruitmentVacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentVacancyStage" ADD CONSTRAINT "RecruitmentVacancyStage_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "RecruitmentStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

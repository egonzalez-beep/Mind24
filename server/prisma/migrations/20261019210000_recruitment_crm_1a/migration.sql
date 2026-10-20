-- CreateEnum
CREATE TYPE "RecruitmentVacancyStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COVERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RecruitmentVacancyAssigneeRole" AS ENUM ('PRIMARY', 'SUPPORT');

-- CreateTable
CREATE TABLE "RecruitmentCandidate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT,
    "email" TEXT,
    "city" TEXT,
    "state" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentVacancy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "location" TEXT,
    "positionsTotal" INTEGER NOT NULL,
    "openedAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "RecruitmentVacancyStatus" NOT NULL DEFAULT 'ACTIVE',
    "jobDescription" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentVacancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentVacancyAssignee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" "RecruitmentVacancyAssigneeRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruitmentVacancyAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentStage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentApplication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "appliedAt" TIMESTAMPTZ(6) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentApplicationStageEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruitmentApplicationStageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecruitmentCandidate_organizationId_idx" ON "RecruitmentCandidate"("organizationId");

-- CreateIndex
CREATE INDEX "RecruitmentCandidate_organizationId_fullName_idx" ON "RecruitmentCandidate"("organizationId", "fullName");

-- CreateIndex
CREATE INDEX "RecruitmentCandidate_organizationId_email_idx" ON "RecruitmentCandidate"("organizationId", "email");

-- CreateIndex
CREATE INDEX "RecruitmentCandidate_organizationId_phone_idx" ON "RecruitmentCandidate"("organizationId", "phone");

-- CreateIndex
CREATE INDEX "RecruitmentCandidate_organizationId_archivedAt_idx" ON "RecruitmentCandidate"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "RecruitmentVacancy_organizationId_idx" ON "RecruitmentVacancy"("organizationId");

-- CreateIndex
CREATE INDEX "RecruitmentVacancy_organizationId_status_idx" ON "RecruitmentVacancy"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RecruitmentVacancy_organizationId_openedAt_idx" ON "RecruitmentVacancy"("organizationId", "openedAt");

-- CreateIndex
CREATE INDEX "RecruitmentVacancyAssignee_organizationId_idx" ON "RecruitmentVacancyAssignee"("organizationId");

-- CreateIndex
CREATE INDEX "RecruitmentVacancyAssignee_vacancyId_idx" ON "RecruitmentVacancyAssignee"("vacancyId");

-- CreateIndex
CREATE INDEX "RecruitmentVacancyAssignee_organizationId_vacancyId_idx" ON "RecruitmentVacancyAssignee"("organizationId", "vacancyId");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentVacancyAssignee_vacancyId_employeeId_key" ON "RecruitmentVacancyAssignee"("vacancyId", "employeeId");

-- CreateIndex
CREATE INDEX "RecruitmentStage_organizationId_position_idx" ON "RecruitmentStage"("organizationId", "position");

-- CreateIndex
CREATE INDEX "RecruitmentStage_organizationId_isActive_idx" ON "RecruitmentStage"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentStage_organizationId_key_key" ON "RecruitmentStage"("organizationId", "key");

-- CreateIndex
CREATE INDEX "RecruitmentApplication_organizationId_idx" ON "RecruitmentApplication"("organizationId");

-- CreateIndex
CREATE INDEX "RecruitmentApplication_organizationId_vacancyId_idx" ON "RecruitmentApplication"("organizationId", "vacancyId");

-- CreateIndex
CREATE INDEX "RecruitmentApplication_organizationId_stageId_idx" ON "RecruitmentApplication"("organizationId", "stageId");

-- CreateIndex
CREATE INDEX "RecruitmentApplication_vacancyId_stageId_position_idx" ON "RecruitmentApplication"("vacancyId", "stageId", "position");

-- CreateIndex
CREATE INDEX "RecruitmentApplication_organizationId_candidateId_idx" ON "RecruitmentApplication"("organizationId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentApplication_candidateId_vacancyId_key" ON "RecruitmentApplication"("candidateId", "vacancyId");

-- CreateIndex
CREATE INDEX "RecruitmentApplicationStageEvent_applicationId_createdAt_idx" ON "RecruitmentApplicationStageEvent"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "RecruitmentApplicationStageEvent_organizationId_idx" ON "RecruitmentApplicationStageEvent"("organizationId");

-- AddForeignKey
ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentVacancy" ADD CONSTRAINT "RecruitmentVacancy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentVacancyAssignee" ADD CONSTRAINT "RecruitmentVacancyAssignee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentVacancyAssignee" ADD CONSTRAINT "RecruitmentVacancyAssignee_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "RecruitmentVacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentVacancyAssignee" ADD CONSTRAINT "RecruitmentVacancyAssignee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "WorkforceEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentStage" ADD CONSTRAINT "RecruitmentStage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentApplication" ADD CONSTRAINT "RecruitmentApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentApplication" ADD CONSTRAINT "RecruitmentApplication_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "RecruitmentCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentApplication" ADD CONSTRAINT "RecruitmentApplication_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "RecruitmentVacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentApplication" ADD CONSTRAINT "RecruitmentApplication_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "RecruitmentStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentApplicationStageEvent" ADD CONSTRAINT "RecruitmentApplicationStageEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentApplicationStageEvent" ADD CONSTRAINT "RecruitmentApplicationStageEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RecruitmentApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentApplicationStageEvent" ADD CONSTRAINT "RecruitmentApplicationStageEvent_fromStageId_fkey" FOREIGN KEY ("fromStageId") REFERENCES "RecruitmentStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentApplicationStageEvent" ADD CONSTRAINT "RecruitmentApplicationStageEvent_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "RecruitmentStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentApplicationStageEvent" ADD CONSTRAINT "RecruitmentApplicationStageEvent_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

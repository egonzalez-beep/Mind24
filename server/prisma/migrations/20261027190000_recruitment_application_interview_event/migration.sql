-- CreateEnum
CREATE TYPE "RecruitmentApplicationInterviewEventType" AS ENUM ('ATTENDED', 'NO_SHOW', 'RESCHEDULED');

-- CreateTable
CREATE TABLE "RecruitmentApplicationInterviewEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "eventType" "RecruitmentApplicationInterviewEventType" NOT NULL,
    "scheduledAt" TIMESTAMPTZ(6) NOT NULL,
    "scheduledTimeSpecified" BOOLEAN NOT NULL DEFAULT true,
    "rescheduledToAt" TIMESTAMPTZ(6),
    "rescheduledToTimeSpecified" BOOLEAN,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruitmentApplicationInterviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecruitmentApplicationInterviewEvent_applicationId_createdAt_idx" ON "RecruitmentApplicationInterviewEvent"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "RecruitmentApplicationInterviewEvent_organizationId_idx" ON "RecruitmentApplicationInterviewEvent"("organizationId");

-- CreateIndex
CREATE INDEX "RecruitmentApplicationInterviewEvent_organizationId_applicationId_idx" ON "RecruitmentApplicationInterviewEvent"("organizationId", "applicationId");

-- AddForeignKey
ALTER TABLE "RecruitmentApplicationInterviewEvent" ADD CONSTRAINT "RecruitmentApplicationInterviewEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentApplicationInterviewEvent" ADD CONSTRAINT "RecruitmentApplicationInterviewEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RecruitmentApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentApplicationInterviewEvent" ADD CONSTRAINT "RecruitmentApplicationInterviewEvent_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "RecruitmentStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentApplicationInterviewEvent" ADD CONSTRAINT "RecruitmentApplicationInterviewEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

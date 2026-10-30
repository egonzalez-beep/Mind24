-- AlterEnum
ALTER TYPE "OrgNotificationType" ADD VALUE 'GOAL_PERIOD_REPORTED';

-- CreateEnum
CREATE TYPE "WorkforceWorkplaceInboxEventType" AS ENUM ('TASK_ASSIGNED', 'GOAL_ASSIGNED');

-- AlterTable
ALTER TABLE "OrgNotification" ADD COLUMN "goalId" TEXT,
ADD COLUMN "goalPeriodId" TEXT;

-- CreateTable
CREATE TABLE "WorkforceWorkplaceInbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recipientWorkforceEmployeeId" TEXT NOT NULL,
    "eventType" "WorkforceWorkplaceInboxEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkforceWorkplaceInbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkforceWorkplaceInbox_organizationId_dedupeKey_key" ON "WorkforceWorkplaceInbox"("organizationId", "dedupeKey");

CREATE INDEX "WwInbox_org_recipient_created" ON "WorkforceWorkplaceInbox"("organizationId", "recipientWorkforceEmployeeId", "createdAt");

CREATE INDEX "WwInbox_org_recipient_readAt" ON "WorkforceWorkplaceInbox"("organizationId", "recipientWorkforceEmployeeId", "readAt");

ALTER TABLE "WorkforceWorkplaceInbox" ADD CONSTRAINT "WorkforceWorkplaceInbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkforceWorkplaceInbox" ADD CONSTRAINT "WorkforceWorkplaceInbox_recipientWorkforceEmployeeId_fkey" FOREIGN KEY ("recipientWorkforceEmployeeId") REFERENCES "WorkforceEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrgNotification" ADD CONSTRAINT "OrgNotification_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "WorkforceGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrgNotification" ADD CONSTRAINT "OrgNotification_goalPeriodId_fkey" FOREIGN KEY ("goalPeriodId") REFERENCES "WorkforceGoalPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

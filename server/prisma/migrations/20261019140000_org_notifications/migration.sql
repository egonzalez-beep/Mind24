-- CreateEnum
CREATE TYPE "OrgNotificationType" AS ENUM ('SHIFT_CHECK_IN', 'SHIFT_CHECK_OUT', 'TASK_COMPLETED', 'TASK_OVERDUE', 'PLATFORM_ANNOUNCEMENT');

-- CreateTable
CREATE TABLE "OrgNotification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "OrgNotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "employeeId" TEXT,
    "taskId" TEXT,
    "remoteWorkSessionId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgNotificationRead" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgNotificationRead_pkey" PRIMARY KEY ("notificationId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgNotification_organizationId_dedupeKey_key" ON "OrgNotification"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "OrgNotification_organizationId_createdAt_idx" ON "OrgNotification"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OrgNotificationRead_userId_idx" ON "OrgNotificationRead"("userId");

-- AddForeignKey
ALTER TABLE "OrgNotification" ADD CONSTRAINT "OrgNotification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgNotification" ADD CONSTRAINT "OrgNotification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "WorkforceEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgNotification" ADD CONSTRAINT "OrgNotification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkforceTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgNotification" ADD CONSTRAINT "OrgNotification_remoteWorkSessionId_fkey" FOREIGN KEY ("remoteWorkSessionId") REFERENCES "RemoteWorkSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgNotificationRead" ADD CONSTRAINT "OrgNotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "OrgNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgNotificationRead" ADD CONSTRAINT "OrgNotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

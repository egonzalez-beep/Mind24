-- CreateEnum
CREATE TYPE "WorkforceTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "WorkforceTaskEventType" AS ENUM ('TASK_CREATED', 'TASK_STATUS_CHANGED', 'TASK_ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkforceTaskActorType" AS ENUM ('ADMIN', 'EMPLOYEE');

-- CreateTable
CREATE TABLE "WorkforceTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkforceTaskStatus" NOT NULL DEFAULT 'PENDING',
    "position" INTEGER NOT NULL,
    "dueAt" TIMESTAMPTZ(6),
    "createdByUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceTaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" "WorkforceTaskEventType" NOT NULL,
    "actorType" "WorkforceTaskActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorEmployeeId" TEXT,
    "fromStatus" "WorkforceTaskStatus",
    "toStatus" "WorkforceTaskStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkforceTaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkforceTask_organizationId_employeeId_idx" ON "WorkforceTask"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "WorkforceTask_employeeId_status_position_idx" ON "WorkforceTask"("employeeId", "status", "position");

-- CreateIndex
CREATE INDEX "WorkforceTask_employeeId_archivedAt_idx" ON "WorkforceTask"("employeeId", "archivedAt");

-- CreateIndex
CREATE INDEX "WorkforceTaskEvent_taskId_createdAt_idx" ON "WorkforceTaskEvent"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkforceTask" ADD CONSTRAINT "WorkforceTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkforceTask" ADD CONSTRAINT "WorkforceTask_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "WorkforceEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkforceTask" ADD CONSTRAINT "WorkforceTask_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkforceTaskEvent" ADD CONSTRAINT "WorkforceTaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkforceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkforceTaskEvent" ADD CONSTRAINT "WorkforceTaskEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkforceTaskEvent" ADD CONSTRAINT "WorkforceTaskEvent_actorEmployeeId_fkey" FOREIGN KEY ("actorEmployeeId") REFERENCES "WorkforceEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "RemoteWorkSessionStatus" AS ENUM ('open', 'completed', 'admin_closed');

-- CreateEnum
CREATE TYPE "WebSignal" AS ENUM ('connected', 'background', 'no_signal');

-- CreateEnum
CREATE TYPE "RemoteWorkEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'WEB_SIGNAL_CHANGED', 'TAB_BACKGROUND', 'TAB_VISIBLE', 'ADMIN_CLOSE', 'ADMIN_ADJUSTMENT');

-- CreateTable
CREATE TABLE "WorkforceEmployee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "employeeCode" TEXT,
    "position" TEXT,
    "department" TEXT,
    "timezone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "accessTokenHash" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemoteWorkSession" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "checkInAt" TIMESTAMPTZ(6) NOT NULL,
    "checkOutAt" TIMESTAMPTZ(6),
    "status" "RemoteWorkSessionStatus" NOT NULL DEFAULT 'open',
    "lastHeartbeatAt" TIMESTAMPTZ(6),
    "lastWebSignal" "WebSignal" NOT NULL DEFAULT 'no_signal',
    "lastVisibilityState" TEXT,
    "userAgent" TEXT,
    "clientMetadata" JSONB,
    "anomalyFlag" BOOLEAN NOT NULL DEFAULT false,
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMPTZ(6),
    "closeReason" TEXT,
    "adjustedByUserId" TEXT,
    "adjustedAt" TIMESTAMPTZ(6),
    "adjustmentReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemoteWorkSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemoteWorkEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "RemoteWorkEventType" NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "payload" JSONB,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemoteWorkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceEmployee_accessTokenHash_key" ON "WorkforceEmployee"("accessTokenHash");

-- CreateIndex
CREATE INDEX "WorkforceEmployee_organizationId_idx" ON "WorkforceEmployee"("organizationId");

-- CreateIndex
CREATE INDEX "WorkforceEmployee_organizationId_isActive_idx" ON "WorkforceEmployee"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "RemoteWorkSession_employeeId_checkInAt_idx" ON "RemoteWorkSession"("employeeId", "checkInAt");

-- CreateIndex
CREATE INDEX "RemoteWorkSession_employeeId_status_idx" ON "RemoteWorkSession"("employeeId", "status");

-- CreateIndex
CREATE INDEX "RemoteWorkEvent_sessionId_occurredAt_idx" ON "RemoteWorkEvent"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "RemoteWorkEvent_employeeId_occurredAt_idx" ON "RemoteWorkEvent"("employeeId", "occurredAt");

-- AddForeignKey
ALTER TABLE "WorkforceEmployee" ADD CONSTRAINT "WorkforceEmployee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteWorkSession" ADD CONSTRAINT "RemoteWorkSession_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "WorkforceEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteWorkSession" ADD CONSTRAINT "RemoteWorkSession_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteWorkSession" ADD CONSTRAINT "RemoteWorkSession_adjustedByUserId_fkey" FOREIGN KEY ("adjustedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteWorkEvent" ADD CONSTRAINT "RemoteWorkEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RemoteWorkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteWorkEvent" ADD CONSTRAINT "RemoteWorkEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "WorkforceEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteWorkEvent" ADD CONSTRAINT "RemoteWorkEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Máximo una jornada abierta por empleado (Prisma no modela índice parcial; SQL explícito).
CREATE UNIQUE INDEX "RemoteWorkSession_one_open_per_employee"
ON "RemoteWorkSession" ("employeeId")
WHERE "checkOutAt" IS NULL;

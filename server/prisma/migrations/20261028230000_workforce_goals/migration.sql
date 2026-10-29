-- Metas de colaboradores (definición + periodos).
CREATE TYPE "WorkforceGoalType" AS ENUM ('COMPLIANCE', 'QUANTITATIVE');
CREATE TYPE "WorkforceGoalPeriodicity" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "WorkforceGoalBinaryResult" AS ENUM ('MET', 'NOT_MET');

CREATE TABLE "WorkforceGoal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "goalType" "WorkforceGoalType" NOT NULL,
    "periodicity" "WorkforceGoalPeriodicity" NOT NULL,
    "targetValue" DOUBLE PRECISION,
    "unit" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceGoal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkforceGoalPeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(6) NOT NULL,
    "periodEnd" TIMESTAMPTZ(6) NOT NULL,
    "targetSnapshot" DOUBLE PRECISION NOT NULL,
    "achievedValue" DOUBLE PRECISION,
    "binaryResult" "WorkforceGoalBinaryResult",
    "completionPercent" DOUBLE PRECISION,
    "employeeComment" TEXT,
    "submittedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceGoalPeriod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkforceGoalPeriod_goalId_periodStart_key" ON "WorkforceGoalPeriod"("goalId", "periodStart");
CREATE INDEX "WorkforceGoal_organizationId_employeeId_idx" ON "WorkforceGoal"("organizationId", "employeeId");
CREATE INDEX "WorkforceGoal_employeeId_archivedAt_idx" ON "WorkforceGoal"("employeeId", "archivedAt");
CREATE INDEX "WorkforceGoal_organizationId_idx" ON "WorkforceGoal"("organizationId");
CREATE INDEX "WorkforceGoalPeriod_organizationId_employeeId_idx" ON "WorkforceGoalPeriod"("organizationId", "employeeId");
CREATE INDEX "WorkforceGoalPeriod_goalId_periodStart_idx" ON "WorkforceGoalPeriod"("goalId", "periodStart");
CREATE INDEX "WorkforceGoalPeriod_organizationId_goalId_idx" ON "WorkforceGoalPeriod"("organizationId", "goalId");

ALTER TABLE "WorkforceGoal" ADD CONSTRAINT "WorkforceGoal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkforceGoal" ADD CONSTRAINT "WorkforceGoal_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "WorkforceEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkforceGoal" ADD CONSTRAINT "WorkforceGoal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkforceGoalPeriod" ADD CONSTRAINT "WorkforceGoalPeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkforceGoalPeriod" ADD CONSTRAINT "WorkforceGoalPeriod_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "WorkforceGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkforceGoalPeriod" ADD CONSTRAINT "WorkforceGoalPeriod_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "WorkforceEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "KioskPunchType" AS ENUM ('CHECK_IN', 'MEAL_OUT', 'MEAL_IN', 'CHECK_OUT');

CREATE TABLE "KioskClock" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "publicKey" VARCHAR(32) NOT NULL,
    "timeZone" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KioskClock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KioskEmployee" (
    "id" TEXT NOT NULL,
    "clockId" TEXT NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "fullName" VARCHAR(160) NOT NULL,
    "pinHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KioskEmployee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KioskPunch" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "type" "KioskPunchType" NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL,
    "requestId" UUID NOT NULL,
    CONSTRAINT "KioskPunch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KioskClock_organizationId_key" ON "KioskClock"("organizationId");
CREATE UNIQUE INDEX "KioskClock_publicKey_key" ON "KioskClock"("publicKey");
CREATE UNIQUE INDEX "KioskEmployee_clockId_code_key" ON "KioskEmployee"("clockId", "code");
CREATE UNIQUE INDEX "KioskPunch_employeeId_ordinal_key" ON "KioskPunch"("employeeId", "ordinal");
CREATE UNIQUE INDEX "KioskPunch_employeeId_requestId_key" ON "KioskPunch"("employeeId", "requestId");

ALTER TABLE "KioskClock" ADD CONSTRAINT "KioskClock_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KioskEmployee" ADD CONSTRAINT "KioskEmployee_clockId_fkey" FOREIGN KEY ("clockId") REFERENCES "KioskClock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KioskPunch" ADD CONSTRAINT "KioskPunch_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "KioskEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

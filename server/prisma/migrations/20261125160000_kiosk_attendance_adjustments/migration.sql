ALTER TABLE "KioskPunch"
    ADD COLUMN "originalRecordedAt" TIMESTAMPTZ(6),
    ADD COLUMN "isManual" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "KioskPunch_employeeId_recordedAt_ordinal_idx" ON "KioskPunch"("employeeId", "recordedAt", "ordinal");

CREATE TYPE "KioskAttendanceAction" AS ENUM ('JUSTIFY', 'ADD_PUNCH', 'EDIT_PUNCH');

CREATE TABLE "KioskAttendanceAdjustment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "requestId" UUID NOT NULL,
    "action" "KioskAttendanceAction" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incident" VARCHAR(32),
    "changes" JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT "KioskAttendanceAdjustment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KioskAttendanceAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId")
        REFERENCES "KioskEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "KioskAttendanceAdjustment_employeeId_requestId_key" ON "KioskAttendanceAdjustment"("employeeId", "requestId");
CREATE INDEX "KioskAttendanceAdjustment_employeeId_date_createdAt_idx" ON "KioskAttendanceAdjustment"("employeeId", "date", "createdAt");

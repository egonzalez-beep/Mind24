CREATE TABLE "KioskEmployeeSchedule" (
    "employeeId" TEXT NOT NULL,
    "effectiveOn" DATE NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "toleranceMinutes" INTEGER NOT NULL,
    "weekdayMask" INTEGER NOT NULL,
    CONSTRAINT "KioskEmployeeSchedule_pkey" PRIMARY KEY ("employeeId", "effectiveOn"),
    CONSTRAINT "KioskEmployeeSchedule_minutes_check" CHECK (
        "startMinute" BETWEEN 0 AND 1439 AND "endMinute" BETWEEN 0 AND 1439
        AND ("endMinute" - "startMinute" + 1440) % 1440 BETWEEN 1 AND 960
        AND "toleranceMinutes" BETWEEN 0 AND 120
        AND "weekdayMask" BETWEEN 1 AND 127
    )
);

ALTER TABLE "KioskEmployeeSchedule"
    ADD CONSTRAINT "KioskEmployeeSchedule_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "KioskEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

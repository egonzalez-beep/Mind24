ALTER TABLE "WorkforceEmployee"
ADD COLUMN "personalStatusMessage" VARCHAR(80),
ADD COLUMN "personalStatusUpdatedAt" TIMESTAMPTZ(6);

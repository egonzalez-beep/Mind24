-- Bitácora opcional e inmutable por jornada (RemoteWorkSession)
ALTER TABLE "RemoteWorkSession" ADD COLUMN "workLogText" TEXT;
ALTER TABLE "RemoteWorkSession" ADD COLUMN "workLogSubmittedAt" TIMESTAMPTZ(6);

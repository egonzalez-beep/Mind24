-- CreateEnum
CREATE TYPE "SignalTelemetryStatus" AS ENUM ('no_data', 'partial', 'full');

-- AlterTable
ALTER TABLE "RemoteWorkSession" ADD COLUMN "signalDurationSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RemoteWorkSession" ADD COLUMN "signalTrackingStartedAt" TIMESTAMPTZ(6);
ALTER TABLE "RemoteWorkSession" ADD COLUMN "signalLastCreditedAt" TIMESTAMPTZ(6);
ALTER TABLE "RemoteWorkSession" ADD COLUMN "signalSampleCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RemoteWorkSession" ADD COLUMN "signalTelemetryStatus" "SignalTelemetryStatus" NOT NULL DEFAULT 'no_data';

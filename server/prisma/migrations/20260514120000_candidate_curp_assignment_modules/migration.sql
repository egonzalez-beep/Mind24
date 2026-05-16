-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN "curp" TEXT;

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN "selectedModules" JSONB;

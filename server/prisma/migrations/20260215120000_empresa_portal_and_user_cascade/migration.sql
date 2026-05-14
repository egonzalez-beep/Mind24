-- AlterTable
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "empresaPortalEnabled" BOOLEAN NOT NULL DEFAULT false;

-- DropForeignKey (User -> Organization) and recreate with ON DELETE CASCADE
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_organizationId_fkey";

ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

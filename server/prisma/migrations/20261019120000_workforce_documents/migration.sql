-- CreateEnum
CREATE TYPE "WorkforceDocumentCategory" AS ENUM ('CONTRATO', 'IDENTIFICACION', 'COMPROBANTE', 'PRESTACIONES', 'COTIZACION', 'OTRO');

-- CreateTable
CREATE TABLE "WorkforceDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "category" "WorkforceDocumentCategory" NOT NULL DEFAULT 'OTRO',
    "filePath" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkforceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkforceDocument_organizationId_employeeId_idx" ON "WorkforceDocument"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "WorkforceDocument_organizationId_idx" ON "WorkforceDocument"("organizationId");

-- AddForeignKey
ALTER TABLE "WorkforceDocument" ADD CONSTRAINT "WorkforceDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkforceDocument" ADD CONSTRAINT "WorkforceDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "WorkforceEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkforceDocument" ADD CONSTRAINT "WorkforceDocument_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El PIN anterior no se puede convertir. Conserva colaboradores y checadas.
BEGIN;
ALTER TABLE "KioskEmployee" DROP COLUMN "pinHash",
ADD COLUMN "punchKeyDigest" VARCHAR(64);
CREATE UNIQUE INDEX "KioskEmployee_clockId_punchKeyDigest_key" ON "KioskEmployee"("clockId", "punchKeyDigest");
COMMIT;

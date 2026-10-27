-- Jornada esperada diaria (minutos). NULL o 0 = sin control de asistencia.
ALTER TABLE "WorkforceEmployee" ADD COLUMN "expectedWorkMinutes" INTEGER;

-- Colaboradores existentes: conservar asistencia con jornada objetivo de 8 h.
UPDATE "WorkforceEmployee" SET "expectedWorkMinutes" = 480 WHERE "expectedWorkMinutes" IS NULL;

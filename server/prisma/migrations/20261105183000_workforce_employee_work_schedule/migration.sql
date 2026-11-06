-- Horario fijo del colaborador, en minutos locales de su timezone.
-- Los días laborales van en una máscara (bit 0 = lunes … bit 6 = domingo), no en filas repetidas.
-- Nullable y sin valor por defecto: los colaboradores existentes quedan sin horario.
-- No rellena filas existentes. Esta versión no crea historial de horarios anteriores.
ALTER TABLE "WorkforceEmployee" ADD COLUMN "workScheduleStartMinute" INTEGER,
ADD COLUMN "workScheduleEndMinute" INTEGER,
ADD COLUMN "workScheduleToleranceMinutes" INTEGER,
ADD COLUMN "workScheduleWeekdayMask" INTEGER,
ADD COLUMN "workScheduleAssignedAt" TIMESTAMPTZ(6);

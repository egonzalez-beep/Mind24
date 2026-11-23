-- Ancla del semáforo de vacantes activas sin candidatos en proceso:
-- momento en que la cola operativa quedó vacía (tras haber tenido postulaciones).
-- Aditivo UTF-8 sin BOM.

ALTER TABLE "RecruitmentVacancy"
  ADD COLUMN IF NOT EXISTS "activeQueueEmptiedAt" TIMESTAMPTZ(6);

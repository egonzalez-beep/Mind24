-- Espera de dos horas para la novedad de cambio de etapa.
-- Las filas existentes quedan con ambos campos en NULL y no entran al barrido.
ALTER TABLE "RecruitmentApplicationStageEvent" ADD COLUMN "novedadEligibleAt" TIMESTAMPTZ(6);
ALTER TABLE "RecruitmentApplicationStageEvent" ADD COLUMN "novedadNotifiedAt" TIMESTAMPTZ(6);
CREATE INDEX "RecruitmentApplicationStageEvent_novedadEligibleAt_idx" ON "RecruitmentApplicationStageEvent"("novedadEligibleAt");

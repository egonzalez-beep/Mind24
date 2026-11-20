-- Cartera "No asistió a entrevista": etapa org + vínculo vacante + origen de retorno.
-- Aditivo, sin backfill de postulaciones ni avisos retroactivos.
-- Posición antes de etapas terminales (no cambia la regla global de terminales al final).

ALTER TABLE "RecruitmentApplication" ADD COLUMN "interviewNoShowFromStageId" TEXT;
ALTER TABLE "RecruitmentApplication" ADD COLUMN "interviewNoShowEventId" TEXT;

ALTER TABLE "RecruitmentApplication" ADD CONSTRAINT "RecruitmentApplication_interviewNoShowFromStageId_fkey"
  FOREIGN KEY ("interviewNoShowFromStageId") REFERENCES "RecruitmentStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RecruitmentApplication" ADD CONSTRAINT "RecruitmentApplication_interviewNoShowEventId_fkey"
  FOREIGN KEY ("interviewNoShowEventId") REFERENCES "RecruitmentApplicationInterviewEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "RecruitmentStage" ("id", "organizationId", "key", "name", "position", "isTerminal", "isActive", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || o.id)::uuid::text,
  o.id,
  'INTERVIEW_NO_SHOW',
  'No asistió a entrevista',
  7500,
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "RecruitmentStage" s
  WHERE s."organizationId" = o.id AND s."key" = 'INTERVIEW_NO_SHOW'
);

INSERT INTO "RecruitmentVacancyStage" ("id", "organizationId", "vacancyId", "stageId", "position", "isEnabled", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || v.id || s.id)::uuid::text,
  v."organizationId",
  v.id,
  s.id,
  COALESCE(
    (
      SELECT MAX(vs."position")
      FROM "RecruitmentVacancyStage" vs
      INNER JOIN "RecruitmentStage" st ON st."id" = vs."stageId"
      WHERE vs."vacancyId" = v.id AND st."isTerminal" = false
    ),
    0
  ) + 500,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "RecruitmentVacancy" v
INNER JOIN "RecruitmentStage" s
  ON s."organizationId" = v."organizationId" AND s."key" = 'INTERVIEW_NO_SHOW'
WHERE NOT EXISTS (
  SELECT 1 FROM "RecruitmentVacancyStage" vs
  WHERE vs."vacancyId" = v.id AND vs."stageId" = s.id
);

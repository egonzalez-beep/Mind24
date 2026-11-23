-- Etapa activa "Aprobado" (APPROVED) entre Finalista y Contratado.
-- Fecha programada de ingreso (distinta de employmentStartDate).
-- Aviso Admin RECRUITMENT_SCHEDULED_HIRE + vínculo opcional a postulación.
-- Aditivo UTF-8 sin BOM. No mueve postulaciones existentes.
-- Posición por vacante: con Finalista habilitada → entre Finalista y la primera
-- terminal (preserva el orden relativo del resto); sin Finalista → antes de la
-- primera etapa terminal.

ALTER TYPE "OrgNotificationType" ADD VALUE 'RECRUITMENT_SCHEDULED_HIRE';

ALTER TABLE "RecruitmentApplication"
  ADD COLUMN "scheduledEmploymentStartDate" DATE;

ALTER TABLE "OrgNotification"
  ADD COLUMN "recruitmentApplicationId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'OrgNotification_recruitmentApplicationId_fkey'
  ) THEN
    ALTER TABLE "OrgNotification"
      ADD CONSTRAINT "OrgNotification_recruitmentApplicationId_fkey"
      FOREIGN KEY ("recruitmentApplicationId")
      REFERENCES "RecruitmentApplication"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "OrgNotification_recruitmentApplicationId_idx"
  ON "OrgNotification"("recruitmentApplicationId");

CREATE INDEX IF NOT EXISTS "RecruitmentApplication_org_scheduled_hire_idx"
  ON "RecruitmentApplication"("organizationId", "scheduledEmploymentStartDate");

INSERT INTO "RecruitmentStage" ("id", "organizationId", "key", "name", "position", "isTerminal", "isActive", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || o.id)::uuid::text,
  o.id,
  'APPROVED',
  'Aprobado',
  7600,
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "RecruitmentStage" s
  WHERE s."organizationId" = o.id AND s."key" = 'APPROVED'
);

-- Inserta Aprobado por vacante sin reordenar el resto.
INSERT INTO "RecruitmentVacancyStage" ("id", "organizationId", "vacancyId", "stageId", "position", "isEnabled", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || v.id || s.id)::uuid::text,
  v."organizationId",
  v.id,
  s.id,
  COALESCE(
    (
      -- Finalista habilitada: entre Finalista y la primera terminal.
      SELECT
        low_pos + GREATEST(1, ((high_pos - low_pos) / 2))
      FROM (
        SELECT
          CASE
            WHEN max_before IS NOT NULL AND max_before >= fin_pos AND max_before < term_pos
              THEN max_before
            ELSE fin_pos
          END AS low_pos,
          term_pos AS high_pos
        FROM (
          SELECT
            fin.pos AS fin_pos,
            term.pos AS term_pos,
            (
              SELECT MAX(vsx."position")
              FROM "RecruitmentVacancyStage" vsx
              WHERE vsx."vacancyId" = v.id
                AND vsx."position" < term.pos
            ) AS max_before
          FROM (
            SELECT vs."position" AS pos
            FROM "RecruitmentVacancyStage" vs
            INNER JOIN "RecruitmentStage" st ON st."id" = vs."stageId"
            WHERE vs."vacancyId" = v.id
              AND st."key" = 'FINALIST'
              AND vs."isEnabled" = true
            LIMIT 1
          ) fin
          INNER JOIN LATERAL (
            SELECT MIN(vs2."position") AS pos
            FROM "RecruitmentVacancyStage" vs2
            INNER JOIN "RecruitmentStage" st2 ON st2."id" = vs2."stageId"
            WHERE vs2."vacancyId" = v.id
              AND st2."isTerminal" = true
              AND vs2."position" > fin.pos
          ) term ON term.pos IS NOT NULL
        ) anchors
        WHERE term_pos > fin_pos
      ) slot
    ),
    (
      -- Sin Finalista habilitada (o sin terminal posterior): antes de la primera terminal.
      SELECT
        low_pos + GREATEST(1, ((high_pos - low_pos) / 2))
      FROM (
        SELECT
          COALESCE(
            (
              SELECT MAX(vsx."position")
              FROM "RecruitmentVacancyStage" vsx
              WHERE vsx."vacancyId" = v.id
                AND vsx."position" < term.pos
            ),
            term.pos - 600
          ) AS low_pos,
          term.pos AS high_pos
        FROM (
          SELECT MIN(vs2."position") AS pos
          FROM "RecruitmentVacancyStage" vs2
          INNER JOIN "RecruitmentStage" st2 ON st2."id" = vs2."stageId"
          WHERE vs2."vacancyId" = v.id
            AND st2."isTerminal" = true
        ) term
        WHERE term.pos IS NOT NULL
      ) slot
      WHERE high_pos > low_pos
    ),
    7600
  ),
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "RecruitmentVacancy" v
INNER JOIN "RecruitmentStage" s
  ON s."organizationId" = v."organizationId" AND s."key" = 'APPROVED'
WHERE NOT EXISTS (
  SELECT 1 FROM "RecruitmentVacancyStage" vs
  WHERE vs."vacancyId" = v.id AND vs."stageId" = s.id
);

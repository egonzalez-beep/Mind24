-- Etapa terminal "Baja" (EMPLOYMENT_EXIT), junto a Contratado.
-- Aditivo: catálogo + vacantes. Backfill solo de HIRED que ya tienen baja registrada.
-- Sin avisos nuevos ni eventos duplicados de historial de negocio.

INSERT INTO "RecruitmentStage" ("id", "organizationId", "key", "name", "position", "isTerminal", "isActive", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || o.id)::uuid::text,
  o.id,
  'EMPLOYMENT_EXIT',
  'Baja',
  8500,
  true,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "RecruitmentStage" s
  WHERE s."organizationId" = o.id AND s."key" = 'EMPLOYMENT_EXIT'
);

INSERT INTO "RecruitmentVacancyStage" ("id", "organizationId", "vacancyId", "stageId", "position", "isEnabled", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || v.id || s.id)::uuid::text,
  v."organizationId",
  v.id,
  s.id,
  COALESCE(
    (
      SELECT vs."position"
      FROM "RecruitmentVacancyStage" vs
      INNER JOIN "RecruitmentStage" st ON st."id" = vs."stageId"
      WHERE vs."vacancyId" = v.id AND st."key" = 'HIRED'
      LIMIT 1
    ),
    8000
  ) + 500,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "RecruitmentVacancy" v
INNER JOIN "RecruitmentStage" s
  ON s."organizationId" = v."organizationId" AND s."key" = 'EMPLOYMENT_EXIT'
WHERE NOT EXISTS (
  SELECT 1 FROM "RecruitmentVacancyStage" vs
  WHERE vs."vacancyId" = v.id AND vs."stageId" = s.id
);

-- Historial de transición HIRED → Baja (antes de actualizar stageId).
INSERT INTO "RecruitmentApplicationStageEvent" (
  "id",
  "organizationId",
  "applicationId",
  "fromStageId",
  "toStageId",
  "changedByUserId",
  "createdAt",
  "novedadEligibleAt",
  "novedadNotifiedAt"
)
SELECT
  md5(random()::text || clock_timestamp()::text || a.id || s_exit.id)::uuid::text,
  a."organizationId",
  a.id,
  a."stageId",
  s_exit.id,
  e."registeredByUserId",
  e."createdAt",
  NULL,
  NULL
FROM "RecruitmentApplication" a
INNER JOIN "RecruitmentApplicationEmploymentExit" e ON e."applicationId" = a.id
INNER JOIN "RecruitmentStage" s_hired
  ON s_hired.id = a."stageId" AND s_hired."key" = 'HIRED' AND s_hired."organizationId" = a."organizationId"
INNER JOIN "RecruitmentStage" s_exit
  ON s_exit."organizationId" = a."organizationId" AND s_exit."key" = 'EMPLOYMENT_EXIT'
WHERE NOT EXISTS (
  SELECT 1
  FROM "RecruitmentApplicationStageEvent" ev
  INNER JOIN "RecruitmentStage" st ON st.id = ev."toStageId"
  WHERE ev."applicationId" = a.id AND st."key" = 'EMPLOYMENT_EXIT'
);

UPDATE "RecruitmentApplication" a
SET
  "stageId" = s_exit.id,
  "hiredStageEnteredAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "RecruitmentApplicationEmploymentExit" e
INNER JOIN "RecruitmentStage" s_exit
  ON s_exit."organizationId" = e."organizationId" AND s_exit."key" = 'EMPLOYMENT_EXIT'
INNER JOIN "RecruitmentStage" s_hired
  ON s_hired."organizationId" = e."organizationId" AND s_hired."key" = 'HIRED'
WHERE a.id = e."applicationId"
  AND a."stageId" = s_hired.id;

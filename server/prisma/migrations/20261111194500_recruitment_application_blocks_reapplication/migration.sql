-- Reaplicación en la misma vacante: como máximo un proceso que bloquea (activo o HIRED).
-- Nombre estable compartido con el manejo de P2002 en el servicio.
--
-- Precondición: el unique absoluto garantiza cero pares duplicados.
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT "candidateId", "vacancyId"
    FROM "RecruitmentApplication"
    GROUP BY "candidateId", "vacancyId"
    HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'blocksReapplication migration aborted: % duplicate candidateId+vacancyId pairs',
      dup_count;
  END IF;
END $$;

ALTER TABLE "RecruitmentApplication"
  ADD COLUMN "blocksReapplication" BOOLEAN NOT NULL DEFAULT true;

-- Backfill conservador: solo Declined/Rejected liberan el slot.
UPDATE "RecruitmentApplication" AS a
SET "blocksReapplication" = false
FROM "RecruitmentStage" AS s
WHERE a."stageId" = s."id"
  AND (
    a."closureOutcome" = 'DECLINED'
    OR a."closureOutcome" = 'REJECTED'
    OR s."key" = 'REJECTED'
  );

CREATE UNIQUE INDEX "RecruitmentApplication_candidate_vacancy_blocks_reapplication_key"
  ON "RecruitmentApplication" ("candidateId", "vacancyId")
  WHERE "blocksReapplication" = true;

DROP INDEX IF EXISTS "RecruitmentApplication_candidateId_vacancyId_key";

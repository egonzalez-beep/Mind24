CREATE TABLE "RecruitmentVacancyNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "legacyImport" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "RecruitmentVacancyNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecruitmentVacancyNote_organizationId_vacancyId_idx" ON "RecruitmentVacancyNote"("organizationId", "vacancyId");
CREATE INDEX "RecruitmentVacancyNote_vacancyId_createdAt_idx" ON "RecruitmentVacancyNote"("vacancyId", "createdAt");
CREATE INDEX "RecruitmentVacancyNote_organizationId_vacancyId_deletedAt_idx" ON "RecruitmentVacancyNote"("organizationId", "vacancyId", "deletedAt");

ALTER TABLE "RecruitmentVacancyNote" ADD CONSTRAINT "RecruitmentVacancyNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentVacancyNote" ADD CONSTRAINT "RecruitmentVacancyNote_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "RecruitmentVacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentVacancyNote" ADD CONSTRAINT "RecruitmentVacancyNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "RecruitmentVacancyNote" (
    "id",
    "organizationId",
    "vacancyId",
    "authorUserId",
    "body",
    "legacyImport",
    "createdAt",
    "updatedAt"
)
SELECT
    'legacy_vac_note_' || v."id",
    v."organizationId",
    v."id",
    NULL,
    trim(v."notes"),
    true,
    COALESCE(v."updatedAt", v."createdAt"),
    COALESCE(v."updatedAt", v."createdAt")
FROM "RecruitmentVacancy" v
WHERE v."notes" IS NOT NULL
  AND length(trim(v."notes")) > 0
ON CONFLICT ("id") DO NOTHING;

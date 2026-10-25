-- Recruitment collaborative notes + candidate tags

CREATE TABLE "RecruitmentCandidateNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "legacyImport" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "RecruitmentCandidateNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecruitmentCandidateTag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colorKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentCandidateTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecruitmentCandidateTagAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruitmentCandidateTagAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecruitmentCandidateTag_organizationId_name_key" ON "RecruitmentCandidateTag"("organizationId", "name");
CREATE INDEX "RecruitmentCandidateTag_organizationId_isActive_idx" ON "RecruitmentCandidateTag"("organizationId", "isActive");

CREATE UNIQUE INDEX "RecruitmentCandidateTagAssignment_candidateId_tagId_key" ON "RecruitmentCandidateTagAssignment"("candidateId", "tagId");
CREATE INDEX "RecruitmentCandidateTagAssignment_organizationId_candidateId_idx" ON "RecruitmentCandidateTagAssignment"("organizationId", "candidateId");
CREATE INDEX "RecruitmentCandidateTagAssignment_organizationId_tagId_idx" ON "RecruitmentCandidateTagAssignment"("organizationId", "tagId");

CREATE INDEX "RecruitmentCandidateNote_organizationId_candidateId_idx" ON "RecruitmentCandidateNote"("organizationId", "candidateId");
CREATE INDEX "RecruitmentCandidateNote_candidateId_createdAt_idx" ON "RecruitmentCandidateNote"("candidateId", "createdAt");
CREATE INDEX "RecruitmentCandidateNote_organizationId_candidateId_deletedAt_idx" ON "RecruitmentCandidateNote"("organizationId", "candidateId", "deletedAt");

ALTER TABLE "RecruitmentCandidateNote" ADD CONSTRAINT "RecruitmentCandidateNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentCandidateNote" ADD CONSTRAINT "RecruitmentCandidateNote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "RecruitmentCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentCandidateNote" ADD CONSTRAINT "RecruitmentCandidateNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RecruitmentCandidateTag" ADD CONSTRAINT "RecruitmentCandidateTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecruitmentCandidateTagAssignment" ADD CONSTRAINT "RecruitmentCandidateTagAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentCandidateTagAssignment" ADD CONSTRAINT "RecruitmentCandidateTagAssignment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "RecruitmentCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentCandidateTagAssignment" ADD CONSTRAINT "RecruitmentCandidateTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "RecruitmentCandidateTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentCandidateTagAssignment" ADD CONSTRAINT "RecruitmentCandidateTagAssignment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill legacy candidate.notes into collaborative notes (author unknown)
INSERT INTO "RecruitmentCandidateNote" (
    "id",
    "organizationId",
    "candidateId",
    "authorUserId",
    "body",
    "legacyImport",
    "createdAt",
    "updatedAt"
)
SELECT
    'legacy_note_' || c."id",
    c."organizationId",
    c."id",
    NULL,
    trim(c."notes"),
    true,
    COALESCE(c."updatedAt", c."createdAt"),
    COALESCE(c."updatedAt", c."createdAt")
FROM "RecruitmentCandidate" c
WHERE c."notes" IS NOT NULL
  AND length(trim(c."notes")) > 0
ON CONFLICT ("id") DO NOTHING;

-- CreateTable
CREATE TABLE "RecruitmentCandidateResume" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentCandidateResume_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentCandidateResume_candidateId_key" ON "RecruitmentCandidateResume"("candidateId");

-- CreateIndex
CREATE INDEX "RecruitmentCandidateResume_organizationId_idx" ON "RecruitmentCandidateResume"("organizationId");

-- CreateIndex
CREATE INDEX "RecruitmentCandidateResume_organizationId_candidateId_idx" ON "RecruitmentCandidateResume"("organizationId", "candidateId");

-- CreateIndex
CREATE INDEX "RecruitmentCandidate_candidate_org_profile_idx" ON "RecruitmentCandidate"("organizationId", "profile");

-- CreateIndex
CREATE INDEX "RecruitmentCandidate_candidate_org_source_idx" ON "RecruitmentCandidate"("organizationId", "source");

-- CreateIndex
CREATE INDEX "RecruitmentCandidate_candidate_org_created_idx" ON "RecruitmentCandidate"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "RecruitmentCandidateResume" ADD CONSTRAINT "RecruitmentCandidateResume_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentCandidateResume" ADD CONSTRAINT "RecruitmentCandidateResume_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "RecruitmentCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentCandidateResume" ADD CONSTRAINT "RecruitmentCandidateResume_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

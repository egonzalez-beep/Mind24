-- Recruitment 1D.2.1: perfil secundario y textos complementarios Otro (canónico en profile/source).
ALTER TABLE "RecruitmentCandidate" ADD COLUMN "profileSecondary" TEXT;
ALTER TABLE "RecruitmentCandidate" ADD COLUMN "profileOther" TEXT;
ALTER TABLE "RecruitmentCandidate" ADD COLUMN "sourceOther" TEXT;

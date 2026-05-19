-- Motor dinámico de evaluaciones (QuestionType + relaciones)
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'CLEAVER_MATRIX', 'AUDIO_RECORDING', 'OPEN_TEXT');

CREATE TABLE "EvaluationModule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationModule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EvaluationModule_key_key" ON "EvaluationModule"("key");

CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "text" TEXT NOT NULL,
    "metadata" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Question_moduleId_sortOrder_idx" ON "Question"("moduleId", "sortOrder");

CREATE TABLE "QuestionOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuestionOption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuestionOption_questionId_sortOrder_idx" ON "QuestionOption"("questionId", "sortOrder");

CREATE TABLE "CandidateResponse" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedOptionId" TEXT,
    "moreOptionId" TEXT,
    "lessOptionId" TEXT,
    "textValue" TEXT,
    "audioUrl" TEXT,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CandidateResponse_attemptId_questionId_key" ON "CandidateResponse"("attemptId", "questionId");
CREATE INDEX "CandidateResponse_attemptId_idx" ON "CandidateResponse"("attemptId");

ALTER TABLE "Question" ADD CONSTRAINT "Question_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "EvaluationModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateResponse" ADD CONSTRAINT "CandidateResponse_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateResponse" ADD CONSTRAINT "CandidateResponse_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateResponse" ADD CONSTRAINT "CandidateResponse_selectedOptionId_fkey" FOREIGN KEY ("selectedOptionId") REFERENCES "QuestionOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CandidateResponse" ADD CONSTRAINT "CandidateResponse_moreOptionId_fkey" FOREIGN KEY ("moreOptionId") REFERENCES "QuestionOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CandidateResponse" ADD CONSTRAINT "CandidateResponse_lessOptionId_fkey" FOREIGN KEY ("lessOptionId") REFERENCES "QuestionOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

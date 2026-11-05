import { prisma } from '../db/client.js';
import { createRecruitmentCandidate } from './recruitmentCandidate.service.js';
import { createRecruitmentApplication } from './recruitmentApplication.service.js';
import { notifyRecruitmentCandidateCreated } from './orgNotification.service.js';
import { HIRED_STAGE_KEY, reconcileVacancyCoverage } from './recruitmentCoverage.service.js';

export async function createRecruitmentCandidateAndNotify({
  organizationId,
  payload,
  registeredByWorkforceEmployeeId = null,
  actorKind,
  actorLabel,
  vacancyId = null,
  stageId = null,
  changedByUserId = null,
  interviewScheduledAt = undefined,
  interviewTimeSpecified = undefined,
}) {
  const created = await prisma.$transaction(async (tx) => {
    const candidate = await createRecruitmentCandidate(organizationId, payload, {
      registeredByWorkforceEmployeeId,
      db: tx,
    });
    let application = null;
    let vacancyTitle = null;
    if (vacancyId) {
      const vacancy = await tx.recruitmentVacancy.findFirst({
        where: { id: vacancyId, organizationId },
        select: { title: true },
      });
      application = await createRecruitmentApplication({
        organizationId,
        vacancyId,
        candidateId: candidate.id,
        changedByUserId,
        initialStageId: stageId || undefined,
        interviewScheduledAt,
        interviewTimeSpecified,
        db: tx,
      });
      vacancyTitle = vacancy?.title || null;
    }
    await notifyRecruitmentCandidateCreated(tx, {
      organizationId,
      candidateId: candidate.id,
      candidateName: candidate.fullName,
      actorKind,
      actorLabel,
      vacancyId: application ? application.vacancyId : null,
      vacancyTitle,
      stageId: application?.stage?.id || null,
      stageName: application?.stage?.name || null,
    });
    return { candidate, application };
  });
  if (created.application?.stage?.key === HIRED_STAGE_KEY) {
    try {
      await reconcileVacancyCoverage(organizationId, created.application.vacancyId);
    } catch (err) {
      console.error('[recruitment-coverage]', err?.message || err);
    }
  }
  return created;
}

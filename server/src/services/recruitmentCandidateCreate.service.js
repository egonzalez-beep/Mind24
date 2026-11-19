import { prisma } from '../db/client.js';
import {
  assertNoStrongRecruitmentDuplicates,
  createRecruitmentCandidate,
  findPotentialDuplicateRecruitmentCandidates,
} from './recruitmentCandidate.service.js';
import { createRecruitmentApplication } from './recruitmentApplication.service.js';
import { notifyRecruitmentCandidateCreated } from './orgNotification.service.js';
import { HIRED_STAGE_KEY, reconcileVacancyCoverage } from './recruitmentCoverage.service.js';
import { prepareRecruitmentCandidateWritePayload } from './recruitmentCandidateCatalog.service.js';

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
  employmentStartDate = undefined,
  allowDuplicate = false,
}) {
  const prepared = prepareRecruitmentCandidateWritePayload(payload, { partial: false });
  if (allowDuplicate !== true) {
    const matches = await findPotentialDuplicateRecruitmentCandidates(organizationId, {
      email: prepared.email,
      phone: prepared.phone,
      whatsapp: prepared.whatsapp,
      curp: prepared.curp,
    });
    assertNoStrongRecruitmentDuplicates(matches, { curpConflict: matches.curpConflict === true });
  }

  // Concurrencia: no hay candado org-wide reutilizable (FOR UPDATE existe por candidato, no por org).
  // Riesgo residual: dos altas paralelas con el mismo contacto pueden colarse entre lecturas.
  // No se añade índice UNIQUE ni advisory lock en esta fase.
  const created = await prisma.$transaction(async (tx) => {
    // Relectura pragmática dentro de la tx (sin candado org-wide ni índice único).
    if (allowDuplicate !== true) {
      const again = await findPotentialDuplicateRecruitmentCandidates(organizationId, {
        email: prepared.email,
        phone: prepared.phone,
        whatsapp: prepared.whatsapp,
        curp: prepared.curp,
      });
      assertNoStrongRecruitmentDuplicates(again, { curpConflict: again.curpConflict === true });
    }
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
        employmentStartDate,
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

-- Una sola cita Programada por horario de la postulación.
CREATE UNIQUE INDEX "RecruitmentApplicationInterviewEvent_one_scheduled_slot"
ON "RecruitmentApplicationInterviewEvent" ("organizationId", "applicationId", "scheduledAt", "scheduledTimeSpecified")
WHERE "eventType" = 'SCHEDULED';

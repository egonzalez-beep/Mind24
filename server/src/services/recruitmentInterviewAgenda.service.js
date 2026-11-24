import { prisma } from '../db/client.js';
import { resolveOrganizationIanaTimezone } from './organizationTimezone.service.js';
import { localDateKey, localMidnightUtc } from './remoteWorkSessionHistory.service.js';
import { classifyRecruitmentApplication } from './recruitmentProcessClosure.service.js';
import { APPROVED_STAGE_KEY, INTERVIEW_NO_SHOW_STAGE_KEY } from './recruitmentStage.service.js';
import {
  buildApplicationInterviewRows,
  serializeRecruitmentApplicationInterviewEvent,
} from './recruitmentApplicationInterviewEvent.service.js';

const MONTH_PATTERN = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/;
const PAGE_SIZE = 30;
const calendarStatuses = ['SCHEDULED', 'ATTENDED', 'NO_SHOW', 'CANCELLED'];
const outsideSchedulingQueue = [APPROVED_STAGE_KEY, 'HIRED', 'REJECTED', 'EMPLOYMENT_EXIT', INTERVIEW_NO_SHOW_STAGE_KEY];

const stageSelect = { id: true, key: true, name: true };
const applicationSelect = {
  id: true,
  stageId: true,
  appliedAt: true,
  interviewScheduledAt: true,
  interviewTimeSpecified: true,
  closureOutcome: true,
  candidate: { select: { id: true, fullName: true, archivedAt: true } },
  vacancy: { select: { title: true, clientName: true } },
  stage: { select: stageSelect },
};

function applicationScope(organizationId) {
  return { organizationId, candidate: { organizationId }, vacancy: { organizationId } };
}

function agendaEntry(app) {
  return {
    applicationId: app.id,
    candidateId: app.candidate.id,
    candidateName: app.candidate.fullName,
    vacancyTitle: app.vacancy.title,
    clientName: app.vacancy.clientName,
    stageName: app.stage.name,
    appliedAt: app.appliedAt.toISOString(),
  };
}

function canManage(app) {
  return !app.candidate.archivedAt &&
    classifyRecruitmentApplication(app.stage.key, app.closureOutcome) === 'active';
}

export async function getRecruitmentInterviewAgenda({
  organizationId, month, now = new Date(), db = prisma, resolveTimeZone = resolveOrganizationIanaTimezone,
}) {
  const timeZone = await resolveTimeZone(organizationId);
  const today = localDateKey(now, timeZone);
  const selectedMonth = month || today.slice(0, 7);
  if (!MONTH_PATTERN.test(selectedMonth)) {
    const err = new Error('El mes debe tener formato AAAA-MM.');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const [year, monthNumber] = selectedMonth.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  const scheduledAt = {
    gte: localMidnightUtc(selectedMonth + '-01', timeZone),
    lt: localMidnightUtc(nextMonth, timeZone),
  };
  const scope = applicationScope(organizationId);
  const [events, legacy] = await db.$transaction([
    db.recruitmentApplicationInterviewEvent.findMany({
      where: { organizationId, scheduledAt, eventType: { in: calendarStatuses }, application: scope },
      include: { application: { select: applicationSelect }, stage: { select: stageSelect } },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    }),
    db.recruitmentApplication.findMany({
      where: { ...scope, interviewScheduledAt: scheduledAt },
      select: applicationSelect,
    }),
  ], { isolationLevel: 'RepeatableRead' });

  const entries = [];
  const byApplication = new Map();
  function add(app, interview) {
    const readonly = !canManage(app);
    if (readonly && interview.eventType === 'SCHEDULED') return;
    entries.push({
      ...agendaEntry(app),
      readonly,
      date: localDateKey(interview.scheduledAt, timeZone),
      interview,
    });
  }
  for (const event of events) {
    const interview = serializeRecruitmentApplicationInterviewEvent(event);
    if (interview.eventType === 'SCHEDULED') {
      if (!byApplication.has(event.applicationId)) byApplication.set(event.applicationId, []);
      byApplication.get(event.applicationId).push(interview);
    }
    add(event.application, interview);
  }
  for (const app of legacy) {
    const rows = buildApplicationInterviewRows(app, byApplication.get(app.id));
    const legacyRow = rows.find((row) => row.legacy);
    if (legacyRow) add(app, legacyRow);
  }
  entries.sort((a, b) => (
    a.date.localeCompare(b.date) ||
    Number(b.interview.scheduledTimeSpecified) - Number(a.interview.scheduledTimeSpecified) ||
    a.interview.scheduledAt.localeCompare(b.interview.scheduledAt)
  ));
  return { month: selectedMonth, today, timeZone, entries };
}

function parsePendingCursor(cursor) {
  if (!cursor) return null;
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const appliedAt = new Date(at);
    if (typeof id === 'string' && id && at === appliedAt.toISOString()) return { appliedAt, id };
  } catch (_) {
    // Un cursor inválido se rechaza igual que cualquier otro filtro inválido.
  }
  const err = new Error('El cursor de postulaciones sin cita no es válido.');
  err.code = 'VALIDATION_ERROR';
  throw err;
}

export async function listRecruitmentInterviewAgendaPending({ organizationId, cursor, db = prisma }) {
  const after = parsePendingCursor(cursor);
  const scope = applicationScope(organizationId);
  const rows = await db.recruitmentApplication.findMany({
    where: {
      ...scope,
      candidate: { ...scope.candidate, archivedAt: null },
      vacancy: { ...scope.vacancy, status: 'ACTIVE' },
      stage: { key: { notIn: outsideSchedulingQueue } },
      closureOutcome: null,
      interviewScheduledAt: null,
      interviewEvents: { none: { organizationId, eventType: 'SCHEDULED' } },
      ...(after ? {
        OR: [
          { appliedAt: { gt: after.appliedAt } },
          { appliedAt: after.appliedAt, id: { gt: after.id } },
        ],
      } : {}),
    },
    select: applicationSelect,
    orderBy: [{ appliedAt: 'asc' }, { id: 'asc' }],
    take: PAGE_SIZE + 1,
  });
  const entries = rows.slice(0, PAGE_SIZE).map(agendaEntry);
  const last = entries.at(-1);
  const nextCursor = rows.length > PAGE_SIZE
    ? Buffer.from(JSON.stringify([last.appliedAt, last.applicationId])).toString('base64url')
    : null;
  return { entries, nextCursor };
}

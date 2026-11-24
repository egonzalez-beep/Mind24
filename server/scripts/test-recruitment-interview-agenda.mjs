import assert from 'node:assert/strict';
import {
  getRecruitmentInterviewAgenda,
  listRecruitmentInterviewAgendaPending,
} from '../src/services/recruitmentInterviewAgenda.service.js';

const org = 'org-demo';
const zone = 'America/Tijuana';
const now = new Date('2026-12-01T02:00:00Z');
const appointed = new Date('2026-11-30T18:30:00Z');
const noHour = new Date('2026-11-30T08:00:00Z');
const makeApp = (id, overrides = {}) => ({
  id, appliedAt: new Date('2026-11-01T18:00:00Z'), stageId: 'client',
  stage: { id: 'client', key: 'CLIENT_INTERVIEW', name: 'Entrevista con cliente' },
  candidate: { id: 'candidate-' + id, fullName: 'Persona prueba', archivedAt: null },
  vacancy: { title: 'Almacenista', clientName: 'Planta de prueba' },
  interviewScheduledAt: null,
  ...overrides,
});
const regular = makeApp('regular', { interviewScheduledAt: appointed });
const legacy = makeApp('legacy', { interviewScheduledAt: noHour, interviewTimeSpecified: false });
const closed = makeApp('closed', { closureOutcome: 'DECLINED' });
const makeEvent = (id, application, eventType, scheduledAt = appointed) => ({
  id, application, applicationId: application.id, eventType, scheduledAt, createdAt: now,
  stage: application.stage, stageId: application.stageId,
});

const calendarDb = {
  recruitmentApplicationInterviewEvent: {
    async findMany({ where }) {
      assert.equal(where.organizationId, org);
      assert.equal(where.application.candidate.organizationId, org);
      assert.equal(where.application.vacancy.organizationId, org);
      assert.equal(where.scheduledAt.gte.toISOString(), '2026-11-01T07:00:00.000Z');
      assert.equal(where.scheduledAt.lt.toISOString(), '2026-12-01T08:00:00.000Z');
      assert(!where.eventType.in.includes('RESCHEDULED'));
      return [
        makeEvent('scheduled-1', regular, 'SCHEDULED'),
        makeEvent('scheduled-2', regular, 'SCHEDULED', new Date('2026-12-01T00:00:00Z')),
        makeEvent('attended', closed, 'ATTENDED'),
        makeEvent('no-show', regular, 'NO_SHOW'),
        makeEvent('cancelled', closed, 'CANCELLED'),
        makeEvent('old-closed-schedule', closed, 'SCHEDULED'),
      ];
    },
  },
  recruitmentApplication: {
    async findMany({ where }) {
      assert.equal(where.organizationId, org);
      assert(where.interviewScheduledAt);
      return [regular, legacy];
    },
  },
  $transaction: (queries) => Promise.all(queries),
};
const data = await getRecruitmentInterviewAgenda({
  organizationId: org, now, db: calendarDb, resolveTimeZone: async () => zone,
});
assert.equal(data.today, '2026-11-30');
assert.equal(data.month, '2026-11');
assert.equal(data.timeZone, zone);
assert(data.entries.every((row) => row.date === '2026-11-30'));
assert.equal(data.entries.filter((row) => row.interview.eventType === 'SCHEDULED').length, 3);
assert.equal(data.entries.filter((row) => row.applicationId === 'legacy')[0].interview.scheduledTimeSpecified, false);
assert.equal(data.entries.find((row) => row.interview.id === 'attended').readonly, true);
assert(!data.entries.some((row) => row.interview.id === 'old-closed-schedule'));
assert(data.entries.some((row) => row.interview.id === 'no-show'));
assert(data.entries.some((row) => row.interview.id === 'cancelled'));

const pages = Array.from({ length: 31 }, (_, i) => makeApp(String(i + 1).padStart(2, '0')));
pages[0].stage = { ...pages[0].stage, key: 'INTERVIEW_NO_SHOW', name: 'No asistió' };
const pendingDb = {
  recruitmentApplication: {
    async findMany({ where, orderBy, take }) {
      assert.equal(where.organizationId, org);
      assert.equal(where.candidate.archivedAt, null);
      assert.equal(where.closureOutcome, null);
      assert.equal(where.interviewScheduledAt, null);
      assert.deepEqual(where.interviewEvents.none, { organizationId: org, eventType: 'SCHEDULED' });
      assert.deepEqual(orderBy, [{ appliedAt: 'asc' }, { id: 'asc' }]);
      assert.equal(take, 31);
      if (!where.OR) return pages;
      assert.equal(where.OR[1].id.gt, '30');
      assert.equal(where.OR[1].appliedAt.toISOString(), pages[29].appliedAt.toISOString());
      return [pages[30]];
    },
  },
};
const firstPage = await listRecruitmentInterviewAgendaPending({ organizationId: org, db: pendingDb });
assert.equal(firstPage.entries.length, 30);
assert.equal(firstPage.entries[0].parked, true);
const nextPage = await listRecruitmentInterviewAgendaPending({
  organizationId: org, cursor: firstPage.nextCursor, db: pendingDb,
});
assert.deepEqual(nextPage.entries.map((row) => row.applicationId), ['31']);
assert.equal(nextPage.nextCursor, null);
await assert.rejects(listRecruitmentInterviewAgendaPending({
  organizationId: org, cursor: 'invalid', db: pendingDb,
}), { code: 'VALIDATION_ERROR' });
console.log('Agenda de entrevistas: zona horaria, citas múltiples y antiguas, resultados y paginación OK.');

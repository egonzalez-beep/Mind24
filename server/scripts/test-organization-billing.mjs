/** node server/scripts/test-organization-billing.mjs */
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://127.0.0.1:1/mind24_billing_test';
const { prisma } = await import('../src/db/client.js');
const { assertOrganizationHasAssignmentCredits, completeAssignmentAttempt } = await import(
  '../src/services/organizationBilling.service.js'
);
const { updateOrganization } = await import('../src/services/organization.service.js');

function fixture(credits, modules) {
  return {
    organization: { id: 'org', credits, blocked: false },
    assignment: { selectedModules: modules, completedModules: [], status: 'pending', creditDeducted: false },
    attempts: { first: 'in_progress', second: 'in_progress' },
  };
}

let state;
let failAssignmentUpdate = false;
let transactions = Promise.resolve();
prisma.$transaction = (run) => {
  const pending = transactions.then(async () => {
    const txState = structuredClone(state);
    const tx = {
      async $queryRaw(sql, id) {
        assert.equal(id, 'assignment');
        assert.match(sql.join(''), /FROM "Assignment".*FOR UPDATE/);
        return [txState.assignment];
      },
      assessmentAttempt: {
        async updateMany({ where, data }) {
          assert.equal(where.assignmentId, 'assignment');
          assert.equal(where.status, 'in_progress');
          if (txState.attempts[where.id] !== where.status) return { count: 0 };
          txState.attempts[where.id] = data.status;
          return { count: 1 };
        },
      },
      organization: {
        async findUnique() {
          return { ...txState.organization };
        },
        async updateMany({ where, data }) {
          assert.equal(where.id, 'org');
          if (txState.organization.credits < (where.credits?.gte ?? 0)) return { count: 0 };
          const credits = data.credits?.increment ?? -data.credits?.decrement;
          if (Number.isFinite(credits)) txState.organization.credits += credits;
          return { count: 1 };
        },
      },
      assignment: {
        async update({ data }) {
          if (failAssignmentUpdate) throw new Error('Fallo al guardar el cierre');
          Object.assign(txState.assignment, data);
        },
      },
    };
    const result = await run(tx);
    state = txState;
    return result;
  });
  transactions = pending.catch(() => {});
  return pending;
};

const submit = (attemptId, moduleKey) => completeAssignmentAttempt({
  assignmentId: 'assignment',
  attemptId,
  organizationId: 'org',
  moduleKey,
  attemptData: { submittedAt: new Date() },
});

state = fixture(4, ['honestidad', 'cleaver']);
assert.deepEqual(await submit('first', 'honestidad'), { allDone: false });
assert.equal(state.organization.credits, 4);
assert.equal(state.assignment.status, 'in_progress');
assert.equal(state.assignment.creditDeducted, false);
failAssignmentUpdate = true;
await assert.rejects(submit('second', 'cleaver'), /Fallo al guardar el cierre/);
assert.equal(state.organization.credits, 4);
assert.equal(state.attempts.second, 'in_progress');
assert.equal(state.assignment.creditDeducted, false);
failAssignmentUpdate = false;
assert.deepEqual(await submit('second', 'cleaver'), { allDone: true });
assert.equal(state.organization.credits, 3);
assert.equal(state.assignment.creditDeducted, true);
await assert.rejects(submit('second', 'cleaver'), { code: 'INVALID_STATE' });
assert.equal(state.organization.credits, 3);

state = fixture(1, ['honestidad', 'digital_interview']);
const partials = await Promise.all([
  submit('first', 'honestidad'),
  submit('second', 'digital_interview'),
  updateOrganization('org', { creditsDelta: 3 }),
]);
assert.deepEqual(partials.slice(0, 2), [{ allDone: false }, { allDone: true }]);
assert.deepEqual(state.assignment.completedModules, ['honestidad', 'digital_interview']);
assert.equal(state.organization.credits, 3);
await assert.rejects(updateOrganization('org', { creditsDelta: -4 }), { code: 'INSUFFICIENT_CREDITS' });
assert.equal(state.organization.credits, 3);

state = fixture(0, ['cleaver']);
await assert.rejects(prisma.$transaction((tx) => assertOrganizationHasAssignmentCredits(tx, 'org')), { code: 'NO_CREDITS' });
assert.deepEqual(await submit('first', 'cleaver'), { allDone: true });
assert.equal(state.organization.credits, 0);
assert.equal(state.attempts.first, 'submitted');
assert.equal(state.assignment.creditDeducted, false);

state = fixture(1, null);
assert.deepEqual(await submit('first', 'honestidad'), { allDone: true });
assert.equal(state.organization.credits, 0);

for (const creditDeducted of [false, true]) {
  state = fixture(4, ['cleaver']);
  Object.assign(state.assignment, {
    status: 'completed',
    completedModules: ['cleaver'],
    creditDeducted,
  });
  assert.deepEqual(await submit('first', 'cleaver'), { allDone: true });
  assert.equal(state.organization.credits, 4);
  assert.equal(state.assignment.status, 'completed');
  assert.equal(state.assignment.creditDeducted, creditDeducted);
}

console.log('Créditos OK con datos simulados: módulos parciales, cierre, rollback, reintentos, cobros históricos, recargas y saldo cero.');

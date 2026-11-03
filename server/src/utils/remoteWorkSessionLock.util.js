/**
 * Neutral row lock for an open RemoteWorkSession.
 * Parameterized SELECT … FOR UPDATE, then re-read inside the same transaction.
 * Must not import checkout, work-log, or serialization services.
 *
 * @param {{ $executeRaw: Function, remoteWorkSession: { findUnique: Function } }} tx
 * @param {string} sessionId
 */
export async function lockOpenSessionRow(tx, sessionId) {
  await tx.$executeRaw`
    SELECT 1 FROM "RemoteWorkSession"
    WHERE id = ${sessionId} AND "checkOutAt" IS NULL
    FOR UPDATE
  `;
  return tx.remoteWorkSession.findUnique({ where: { id: sessionId } });
}

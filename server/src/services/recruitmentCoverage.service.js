import { prisma } from '../db/client.js';

/** Clave de catálogo. El nombre visible puede cambiar; la cobertura no depende de él. */
export const HIRED_STAGE_KEY = 'HIRED';

export const HIRED_CONFIRMATION_MS = 24 * 60 * 60 * 1000;

/** Tras cumplir las 24 h, el barrido puede tardar hasta este intervalo si nadie dispara otra reconciliación. */
export const COVERAGE_SWEEP_INTERVAL_MS = 60_000;

export const REOPEN_BLOCKED_MESSAGE =
  'Esta vacante ya tiene cubiertas todas sus posiciones. Para reabrirla, aumenta el número de posiciones requeridas o libera una contratación.';

export const POSITIONS_BELOW_HIRED_MESSAGE =
  'No puedes reducir las posiciones por debajo de los candidatos que están en Contratado.';

/**
 * Duplicados de la misma persona en una vacante no deberían existir
 * (único candidateId + vacancyId). Si aparecen, cuentan una sola vez y
 * se conserva el hiredStageEnteredAt no nulo más antiguo para que un
 * duplicado posterior no reinicie el reloj.
 */
export function tallyVacancyHires(applications, now = new Date()) {
  const byCandidate = new Map();
  for (const app of applications || []) {
    const stageKey = app.stageKey || app.stage?.key || null;
    if (stageKey !== HIRED_STAGE_KEY) continue;
    const candidateId = app.candidateId;
    if (!candidateId) continue;
    const entered = parseEnteredAt(app.hiredStageEnteredAt);
    const fullName = app.fullName || app.candidate?.fullName || '';
    const prev = byCandidate.get(candidateId);
    if (!prev) {
      byCandidate.set(candidateId, { candidateId, fullName, hiredStageEnteredAt: entered });
      continue;
    }
    if (entered && (!prev.hiredStageEnteredAt || entered.getTime() < prev.hiredStageEnteredAt.getTime())) {
      prev.hiredStageEnteredAt = entered;
    }
    if (!prev.fullName && fullName) prev.fullName = fullName;
  }
  const hired = [...byCandidate.values()];
  hired.sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), 'es'));
  let confirmedCount = 0;
  for (const row of hired) {
    if (isHireConfirmedAt(row.hiredStageEnteredAt, now)) confirmedCount += 1;
  }
  return { currentCount: hired.length, confirmedCount, hired };
}

export function parseEnteredAt(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** true solo cuando el instante de entrada más 24 h UTC ya llegó. Un null histórico no confirma. */
export function isHireConfirmedAt(enteredAt, now = new Date()) {
  const entered = parseEnteredAt(enteredAt);
  if (!entered) return false;
  return now.getTime() - entered.getTime() >= HIRED_CONFIRMATION_MS;
}

export function pendingPositions(positionsTotal, confirmedCount) {
  const positions = Math.max(0, Number(positionsTotal) || 0);
  const confirmed = Math.max(0, Number(confirmedCount) || 0);
  return Math.max(positions - confirmed, 0);
}

export function officialCoveragePercent(positionsTotal, confirmedCount) {
  const positions = Math.max(1, Number(positionsTotal) || 1);
  const confirmed = Math.max(0, Number(confirmedCount) || 0);
  return Math.min(100, Math.round((confirmed / positions) * 100));
}

export function shouldAutoCover({ status, positionsTotal, confirmedCount }) {
  const positions = Number(positionsTotal) || 0;
  const confirmed = Number(confirmedCount) || 0;
  return status === 'ACTIVE' && positions >= 1 && confirmed >= positions;
}

/**
 * Misma etapa: conserva el timestamp. Entrar a HIRED abre una ventana nueva.
 * Salir la cierra. No acumula tramos separados.
 */
export function nextHiredStageEnteredAt({ fromKey, toKey, previousEnteredAt, now }) {
  if (fromKey === toKey) return previousEnteredAt ?? null;
  if (toKey === HIRED_STAGE_KEY && fromKey !== HIRED_STAGE_KEY) return now;
  if (fromKey === HIRED_STAGE_KEY && toKey !== HIRED_STAGE_KEY) return null;
  return previousEnteredAt ?? null;
}

/**
 * Metadatos de cobertura en un solo objeto. Cubierta → Activa limpia ambos campos.
 * Seguir en Cubierta no incluye esas claves, así el UPDATE no las reescribe.
 * Un null histórico en Contratado no recibe timestamp aquí.
 */
export function planVacancyCoverageUpdate({
  currentStatus,
  nextStatus,
  positionsTotal,
  currentHired,
  now,
}) {
  assertVacancyPositionsAndReopen({
    currentStatus,
    nextStatus,
    positionsTotal,
    currentHired,
  });
  if (nextStatus === 'COVERED' && currentStatus !== 'COVERED') {
    return { coveredAt: now, coverageSource: 'MANUAL' };
  }
  if (currentStatus === 'COVERED' && nextStatus === 'ACTIVE') {
    return { coveredAt: null, coverageSource: null };
  }
  return {};
}

export function automaticCoverageWrite(now) {
  return { status: 'COVERED', coveredAt: now, coverageSource: 'AUTOMATIC' };
}

export function shouldRecordStageEvent({ stageChanged, updatedCount }) {
  return stageChanged === true && updatedCount === 1;
}

export function assertVacancyPositionsAndReopen({
  currentStatus,
  nextStatus,
  positionsTotal,
  currentHired,
}) {
  if (!Number.isInteger(positionsTotal) || positionsTotal < 1) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'positionsTotal debe ser al menos 1.';
    throw err;
  }
  const hired = Math.max(0, Number(currentHired) || 0);
  if (positionsTotal < hired) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = POSITIONS_BELOW_HIRED_MESSAGE;
    throw err;
  }
  if (currentStatus === 'COVERED' && nextStatus === 'ACTIVE' && positionsTotal <= hired) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = REOPEN_BLOCKED_MESSAGE;
    throw err;
  }
}

export async function countDistinctHiredCandidates(organizationId, vacancyId, db = prisma) {
  const rows = await db.recruitmentApplication.findMany({
    where: { organizationId, vacancyId, stage: { key: HIRED_STAGE_KEY } },
    select: { candidateId: true },
  });
  return new Set(rows.map((row) => row.candidateId)).size;
}

export async function listCurrentHiresForVacancy(organizationId, vacancyId, now = new Date()) {
  const rows = await prisma.recruitmentApplication.findMany({
    where: { organizationId, vacancyId, stage: { key: HIRED_STAGE_KEY } },
    select: {
      candidateId: true,
      hiredStageEnteredAt: true,
      candidate: { select: { fullName: true } },
    },
  });
  const tally = tallyVacancyHires(
    rows.map((row) => ({
      candidateId: row.candidateId,
      hiredStageEnteredAt: row.hiredStageEnteredAt,
      fullName: row.candidate?.fullName || '',
      stageKey: HIRED_STAGE_KEY,
    })),
    now,
  );
  return tally.hired.map((row) => ({
    candidateId: row.candidateId,
    fullName: row.fullName,
    hiredStageEnteredAt: row.hiredStageEnteredAt ? row.hiredStageEnteredAt.toISOString() : null,
  }));
}

/**
 * Solo Activa → Cubierta, y solo si H24 >= P. updateMany condicionado hace que
 * una sola instancia gane. No reabre ni toca Cubierta, Pausa o Cerrada.
 */
export async function reconcileVacancyCoverage(organizationId, vacancyId, now = new Date()) {
  const vacancy = await prisma.recruitmentVacancy.findFirst({
    where: { id: vacancyId, organizationId },
    select: { id: true, status: true, positionsTotal: true },
  });
  if (!vacancy || vacancy.status !== 'ACTIVE') return { updated: 0 };
  const rows = await prisma.recruitmentApplication.findMany({
    where: { organizationId, vacancyId, stage: { key: HIRED_STAGE_KEY } },
    select: { candidateId: true, hiredStageEnteredAt: true },
  });
  const tally = tallyVacancyHires(
    rows.map((row) => ({ ...row, stageKey: HIRED_STAGE_KEY })),
    now,
  );
  if (!shouldAutoCover({
    status: vacancy.status,
    positionsTotal: vacancy.positionsTotal,
    confirmedCount: tally.confirmedCount,
  })) {
    return { updated: 0 };
  }
  const result = await prisma.recruitmentVacancy.updateMany({
    where: { id: vacancyId, organizationId, status: 'ACTIVE' },
    data: automaticCoverageWrite(now),
  });
  return { updated: result.count };
}

/**
 * Barrido de vacantes ya confirmadas. No escribe hiredStageEnteredAt y no lee
 * el historial de etapas: un Contratado con timestamp null sigue intacto.
 */
export async function reconcileDueVacancyCoverage(now = new Date()) {
  const cutoff = new Date(now.getTime() - HIRED_CONFIRMATION_MS);
  const rows = await prisma.recruitmentApplication.findMany({
    where: {
      hiredStageEnteredAt: { lte: cutoff },
      stage: { key: HIRED_STAGE_KEY },
      vacancy: { status: 'ACTIVE' },
    },
    select: {
      organizationId: true,
      vacancyId: true,
      candidateId: true,
      vacancy: { select: { positionsTotal: true } },
    },
  });
  const groups = new Map();
  for (const row of rows) {
    let group = groups.get(row.vacancyId);
    if (!group) {
      group = {
        organizationId: row.organizationId,
        positionsTotal: row.vacancy.positionsTotal,
        candidates: new Set(),
      };
      groups.set(row.vacancyId, group);
    }
    group.candidates.add(row.candidateId);
  }
  let updated = 0;
  for (const [vacancyId, group] of groups) {
    if (group.candidates.size < group.positionsTotal) continue;
    const result = await prisma.recruitmentVacancy.updateMany({
      where: { id: vacancyId, organizationId: group.organizationId, status: 'ACTIVE' },
      data: automaticCoverageWrite(now),
    });
    updated += result.count;
  }
  return { updated };
}

let coverageSweepTimer = null;
let coverageSweepRunning = false;

/** Una ejecución a la vez. El rechazo queda capturado y no deja la bandera tomada. */
export function runRecruitmentCoverageSweepTick(task = reconcileDueVacancyCoverage) {
  if (coverageSweepRunning) return Promise.resolve({ skipped: true });
  coverageSweepRunning = true;
  return Promise.resolve()
    .then(() => task())
    .catch((err) => {
      console.error('[recruitment-coverage]', err?.message || err);
      return { failed: true };
    })
    .finally(() => {
      coverageSweepRunning = false;
    });
}

export function startRecruitmentCoverageSweep() {
  if (coverageSweepTimer) return;
  const tick = () => {
    runRecruitmentCoverageSweepTick().catch(() => {});
  };
  tick();
  coverageSweepTimer = setInterval(tick, COVERAGE_SWEEP_INTERVAL_MS);
  if (typeof coverageSweepTimer.unref === 'function') coverageSweepTimer.unref();
}

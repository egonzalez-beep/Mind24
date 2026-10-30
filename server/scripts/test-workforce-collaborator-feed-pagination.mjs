/**
 * Paginación determinista del feed combinado (sin DB).
 * node server/scripts/test-workforce-collaborator-feed-pagination.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const feedSvc = fs.readFileSync(
  path.join(serverDir, 'src/services/workforceCollaboratorNovedadesFeed.service.js'),
  'utf8',
);

import {
  mergeCollaboratorFeedRows,
  paginateCollaboratorFeedMerged,
  decodeListCursor,
  encodeListCursor,
  compareCollaboratorFeedItems,
  recruitmentRowEligibleAfterCursor,
  workplaceRowEligibleAfterCursor,
  SOURCE_RECRUITMENT,
  SOURCE_WORKPLACE,
} from '../src/services/workforceCollaboratorNovedadesFeed.service.js';
import { buildGoalPeriodReportedMessage } from '../src/services/orgNotification.service.js';

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function recRow(id, createdAt) {
  return {
    id,
    createdAt,
    eventType: 'STAGE_CHANGED',
    message: `rec ${id}`,
    candidateId: 'c1',
    applicationId: 'a1',
    vacancyId: 'v1',
    fromStageId: null,
    toStageId: 's1',
    metadata: {},
    readAt: null,
  };
}

function wpRow(id, createdAt, eventType = 'TASK_ASSIGNED') {
  return {
    id,
    createdAt,
    eventType,
    message: `wp ${id}`,
    metadata: { taskId: id },
    readAt: null,
  };
}

function globalExpectedOrder(rec, wp) {
  return mergeCollaboratorFeedRows(rec, wp).map((i) => i.id);
}

function simulateOnePage(rec, wp, cursor, take) {
  const fetchTake = take + 1;
  const wrap = (r, source) => ({
    createdAt: r.createdAt,
    source,
    rawId: r.id,
  });
  const recSlice = rec
    .filter((r) => recruitmentRowEligibleAfterCursor(r, cursor))
    .sort((a, b) =>
      compareCollaboratorFeedItems(wrap(a, SOURCE_RECRUITMENT), wrap(b, SOURCE_RECRUITMENT)),
    )
    .slice(0, fetchTake);
  const wpSlice = wp
    .filter((r) => workplaceRowEligibleAfterCursor(r, cursor))
    .sort((a, b) =>
      compareCollaboratorFeedItems(wrap(a, SOURCE_WORKPLACE), wrap(b, SOURCE_WORKPLACE)),
    )
    .slice(0, fetchTake);
  const merged = mergeCollaboratorFeedRows(recSlice, wpSlice);
  return paginateCollaboratorFeedMerged(merged, take);
}

function simulateAllPages(rec, wp, take = 30) {
  const pages = [];
  let cursor = null;
  for (let guard = 0; guard < 50; guard += 1) {
    const { page, hasMore, nextCursor } = simulateOnePage(rec, wp, cursor, take);
    pages.push(page.map((p) => p.id));
    if (!hasMore) break;
    cursor = decodeListCursor(nextCursor);
    check(cursor != null, 'cursor decodable');
    if (!cursor) break;
  }
  return pages;
}

console.log('\n=== Feed listado — estático ===\n');

check(!/maxRounds/.test(feedSvc) && !/recLimit \+=/.test(feedSvc), 'sin rondas ni límites crecientes');
check(/take: fetchTake/.test(feedSvc) && /fetchTake = take \+ 1/.test(feedSvc), 'limit+1 por fuente');

console.log('\n=== Meta reportada — mensajes (unit) ===\n');

check(
  buildGoalPeriodReportedMessage('Ana', 'Ventas', 'COMPLIANCE', { binaryResult: 'MET' }).includes('cumplió'),
  'binaria MET',
);
check(
  buildGoalPeriodReportedMessage('Ana', 'Ventas', 'COMPLIANCE', { binaryResult: 'NOT_MET' }).includes('no cumplió'),
  'binaria NOT_MET',
);
check(
  buildGoalPeriodReportedMessage('Ana', 'Meta Q', 'QUANTITATIVE', {
    targetSnapshot: 5,
    achievedValue: 7,
    completionPercent: 140,
  }).includes('cumplió'),
  'cuantitativa 140% cumplió',
);
check(
  buildGoalPeriodReportedMessage('Ana', 'Meta Q', 'QUANTITATIVE', {
    targetSnapshot: 5,
    achievedValue: 3,
    completionPercent: 60,
  }).includes('parcialmente') && buildGoalPeriodReportedMessage('Ana', 'Meta Q', 'QUANTITATIVE', {
    targetSnapshot: 5,
    achievedValue: 3,
    completionPercent: 60,
  }).includes('60%'),
  'cuantitativa 60% parcial',
);
check(
  buildGoalPeriodReportedMessage('Ana', 'Meta Q', 'QUANTITATIVE', {
    targetSnapshot: 5,
    achievedValue: 0,
    completionPercent: 0,
  }).includes('parcialmente') &&
    !buildGoalPeriodReportedMessage('Ana', 'Meta Q', 'QUANTITATIVE', {
      targetSnapshot: 5,
      achievedValue: 0,
      completionPercent: 0,
    }).includes('no cumplió'),
  'cuantitativa 0% parcial (no NOT_MET)',
);

console.log('\n=== Paginación feed — escenarios (unit) ===\n');

const t0 = new Date('2026-06-01T10:00:00.000Z');
const t1 = new Date('2026-06-01T09:00:00.000Z');
const t2 = new Date('2026-06-01T08:00:00.000Z');

// A: fechas distintas alternadas
const recA = [recRow('r1', t0), recRow('r2', t2), recRow('r3', t0)];
const wpA = [wpRow('w1', t1), wpRow('w2', t0)];
const expectedA = globalExpectedOrder(recA, wpA);
const pagesA = simulateAllPages(recA, wpA, 2);
const flatA = pagesA.flat();
check(flatA.length === expectedA.length, 'A sin omitidos');
check(new Set(flatA).size === flatA.length, 'A sin duplicados');
check(flatA.join(',') === expectedA.join(','), 'A orden global');
check(pagesA.length >= 2, 'A múltiples páginas');

// B: mismo createdAt
const tSame = new Date('2026-07-01T12:00:00.000Z');
const recB = [recRow('r02', tSame), recRow('r01', tSame)];
const wpB = [wpRow('w02', tSame), wpRow('w01', tSame)];
const mergedB = mergeCollaboratorFeedRows(recB, wpB);
check(mergedB[0].source === SOURCE_RECRUITMENT && mergedB[1].source === SOURCE_RECRUITMENT, 'B recruitment antes');
check(mergedB[2].source === SOURCE_WORKPLACE, 'B workplace tras recruitment');
check(mergedB[0].rawId === 'r02' && mergedB[1].rawId === 'r01', 'B id DESC recruitment');

const pagesB = simulateAllPages(recB, wpB, 2);
const flatB = pagesB.flat();
check(flatB.length === 4, 'B cuatro ítems');
check(new Set(flatB).size === 4, 'B únicos');

// C: una fuente domina (>30)
const recC = Array.from({ length: 35 }, (_, i) =>
  recRow(`r${String(i).padStart(2, '0')}`, new Date(t0.getTime() - i * 1000)),
);
const wpC = [wpRow('w-only', t2)];
const expectedC = globalExpectedOrder(recC, wpC);
const pagesC = simulateAllPages(recC, wpC, 30);
const flatC = pagesC.flat();
check(flatC.length === expectedC.length, 'C 36 ítems totales');
check(new Set(flatC).size === flatC.length, 'C sin duplicados');
check(flatC.join(',') === expectedC.join(','), 'C orden domina recruitment');

const wpDom = Array.from({ length: 33 }, (_, i) =>
  wpRow(`w${i}`, new Date(t0.getTime() - i * 500)),
);
const recFew = [recRow('r-old', t2)];
const pagesD = simulateAllPages(recFew, wpDom, 30);
check(pagesD.flat().length === 34, 'C workplace domina 34 ítems');

// ≥3 páginas (take=2)
const recMany = Array.from({ length: 7 }, (_, i) =>
  recRow(`rm${i}`, new Date(t0.getTime() - i * 1000)),
);
const wpMany = Array.from({ length: 4 }, (_, i) =>
  wpRow(`wm${i}`, new Date(t1.getTime() - i * 1000)),
);
const expectedMany = globalExpectedOrder(recMany, wpMany);
const pagesMany = simulateAllPages(recMany, wpMany, 2);
check(pagesMany.length >= 3, 'tres o más páginas');
const flatMany = pagesMany.flat();
check(flatMany.length === expectedMany.length, 'multi-página sin omitidos');
check(new Set(flatMany).size === flatMany.length, 'multi-página sin duplicados');
check(flatMany.join(',') === expectedMany.join(','), 'multi-página orden global');
let walkCursor = null;
for (let step = 0; step < 30; step += 1) {
  const { hasMore, nextCursor } = simulateOnePage(recMany, wpMany, walkCursor, 2);
  if (!hasMore) {
    check(nextCursor === null, 'última página sin cursor falso');
    break;
  }
  walkCursor = decodeListCursor(nextCursor);
}

// D: inserción nueva entre páginas no rompe cursor hacia registros anteriores
const recD = [recRow('r-old', t2)];
const wpD = [wpRow('w-old', t2)];
const recAfterInsert = [recRow('r-new', t0), ...recD];
const pagesAfter = simulateAllPages(recAfterInsert, wpD, 1);
check(pagesAfter.flat().includes('recruitment:r-old'), 'D cursor previo sigue alcanzando ítems viejos');
check(pagesAfter.flat()[0] === 'recruitment:r-new', 'D ítem nuevo lidera feed');
const cursorEnc = encodeListCursor(t1, SOURCE_WORKPLACE, 'w1');
check(decodeListCursor(cursorEnc)?.id === 'w1', 'D cursor estable decode');

console.log('\n=== Cursor inválido ===\n');
check(decodeListCursor('not-valid!!!') === null, 'cursor basura → null');

if (failed) {
  console.error(`\n✗ ${failed} fallo(s).\n`);
  process.exit(1);
}
console.log('\n✓ Feed pagination + goal messages tests OK.\n');

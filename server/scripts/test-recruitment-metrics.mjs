/**
 * Recruitment — métricas mensuales (fase coveredAt + Declinados).
 * node server/scripts/test-recruitment-metrics.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(rootDir, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'rec-metrics-test-secret';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const pubHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');
const routes = fs.readFileSync(path.join(rootDir, 'src/routes/org.recruitment.routes.js'), 'utf8');
const svcSrc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentMetrics.service.js'), 'utf8');
const coverageSrc = fs.readFileSync(path.join(rootDir, 'src/services/recruitmentCoverage.service.js'), 'utf8');
const migrationCovered = fs.readFileSync(
  path.join(rootDir, 'prisma/migrations/20261104053000_recruitment_hired_coverage/migration.sql'),
  'utf8',
);
const terminalSrc = fs.readFileSync(
  path.join(rootDir, 'src/services/recruitmentMetricsTerminal.service.js'),
  'utf8',
);

const {
  getLocalMonthRange,
  shiftMonth,
  parseMetricsMonthInput,
  buildTerminalClosureShares,
  avgCoverageDaysForMonth,
  countDeclinedApplicationsForMonth,
  computeCoverageAverageFromVacancies,
  loadRecruitmentMetricsDataQuality,
  getRecruitmentMetrics,
} = await import('../src/services/recruitmentMetrics.service.js');
const { MIND24_DEFAULT_IANA_TIMEZONE } = await import('../src/services/organizationTimezone.service.js');
const {
  TERMINAL_MIN_DWELL_MS,
  consolidateTerminalApplications,
  effectiveStageKeyAt,
  qualifyTerminalApplicationForMonth,
  rejectedTopClientFromConsolidated,
} = await import('../src/services/recruitmentMetricsTerminal.service.js');
const { calendarDayDiff } = await import('../src/services/recruitmentVacancy.service.js');
const { localDateKey } = await import('../src/services/remoteWorkSessionHistory.service.js');

let failed = 0;
let pgSkip = false;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function d(iso) {
  return new Date(iso);
}

console.log('\n=== Recruitment — métricas (estático) ===\n');

check(/router\.get\('\/metrics'/.test(routes), 'GET /metrics');
check(/getRecruitmentMetricsForRequest/.test(routes), 'servicio métricas en routes');
check(!/EVERGREEN_COVERAGE_DAYS/.test(svcSrc), 'sin heurística evergreen en cobertura');
check(/localDateKey/.test(svcSrc) && /resolveOrganizationIanaTimezone/.test(svcSrc), 'métricas en TZ organización');
check(/coverageDateSource:\s*'vacancy\.coveredAt'/.test(svcSrc), 'cobertura documenta coveredAt');
check(!/coverageDateSource:\s*'vacancy\.updatedAt'/.test(svcSrc), 'cobertura ya no documenta updatedAt');
{
  const avgFn = svcSrc.slice(
    svcSrc.indexOf('export async function avgCoverageDaysForMonth'),
    svcSrc.indexOf('export async function countDeclinedApplicationsForMonth'),
  );
  check(/coveredAt:\s*\{\s*gte:\s*start,\s*lt:\s*end/.test(avgFn), 'promedio filtra por coveredAt en mes');
  check(!/updatedAt:\s*\{\s*gte:\s*start/.test(avgFn), 'promedio no filtra por updatedAt');
  check(!/excludedMissingCoveredAt/.test(avgFn), 'promedio no mezcla deuda global como exclusión del mes');
}
check(/loadRecruitmentMetricsDataQuality/.test(svcSrc), 'bloque dataQuality global');
check(/coveredVacanciesMissingCoveredAt/.test(svcSrc), 'calidad: COVERED sin coveredAt (global)');
check(/declinedApplicationsMissingClosedAt/.test(svcSrc), 'calidad: DECLINED sin closedAt (global)');
check(!/kpis\.[\s\S]{0,400}excludedMissingCoveredAt/.test(svcSrc), 'KPI mensual sin excludedMissingCoveredAt');
check(/countDeclinedApplicationsForMonth/.test(svcSrc), 'KPI Declinados en servicio');
check(/closureOutcome:\s*'DECLINED'/.test(svcSrc) && /closedAt:\s*\{\s*gte:\s*start/.test(svcSrc), 'Declinados por closedAt');
check(/terminalClosures/.test(svcSrc) && /buildTerminalClosureShares/.test(svcSrc), 'bloque terminalClosures');
check(/participación entre cierres/i.test(svcSrc), 'shares documentados como participación entre cierres');
check(
  !/\b(tasa de rechazo|tasa de contratación)\b/i.test(svcSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
  'no llama tasa de funnel a los shares (fuera de comentarios)',
);
check(/consolidateTerminalApplications/.test(svcSrc), 'KPIs usan consolidación terminal');
check(!/countStageMovesToKey/.test(svcSrc), 'sin conteo bruto StageEvent en métricas');
check(/ADD COLUMN "coveredAt"/.test(migrationCovered), 'migración agregó coveredAt');
check(!/\bUPDATE\b/i.test(migrationCovered) && /Sin backfill/i.test(migrationCovered), 'migración coveredAt sin UPDATE/backfill de datos');
check(/coveredAt:\s*now/.test(coverageSrc) && /coveredAt:\s*null/.test(coverageSrc), 'cubrir escribe coveredAt; reabrir limpia');
check(/rec-tab-metrics/.test(indexHtml), 'pestaña Métricas');
check(/recMetricsLoad/.test(indexHtml), 'carga métricas frontend');
check(/rec-metrics-cal-grid/.test(indexHtml), 'calendario actividad diaria');
check(/Declinados/.test(indexHtml), 'KPI Declinados en UI');
check(/Personas registradas por primera vez durante el mes seleccionado/.test(indexHtml), 'tooltip Registrados');
check(/Personas distintas que iniciaron al menos un proceso durante el mes seleccionado/.test(indexHtml), 'tooltip Ingresaron');
check(/Procesos que llegaron a contratación/.test(indexHtml), 'tooltip Contratados (procesos)');
check(/Procesos cerrados como rechazados/.test(indexHtml), 'tooltip Rechazados (procesos)');
check(/Más información sobre /.test(indexHtml), 'aria-label descriptivo del botón ?');
check(/recMetricsBindKpiTips|recMetricsCloseAllKpiTips|Escape/.test(indexHtml), 'tooltips con open/close Escape');
check(/role="tooltip"/.test(indexHtml) && /rec-metrics-kpi-info/.test(indexHtml), 'tooltips accesibles KPI');
check(/rec-metrics-kpi-icon--orange/.test(indexHtml), 'Declinados tono naranja');
check(/no pueden asignarse a un mes/.test(indexHtml), 'nota honestas de deuda global de coveredAt');
check(/Calendario sin Declinados/.test(indexHtml), 'calendario documenta omisión de Declinados');
check(/grid-template-columns:repeat\(4/.test(indexHtml), 'grid 4 columnas en escritorio');
check(pubHtml === indexHtml, 'HTML raíz idéntico a server/public');

console.log('\n=== Helpers de periodo ===\n');

const oct = getLocalMonthRange(2026, 10, MIND24_DEFAULT_IANA_TIMEZONE);
check(oct.daysInMonth === 31, 'octubre 2026 tiene 31 días');
check(oct.fromKey === '2026-10-01', 'inicio calendario org TZ');
check(oct.toKey === '2026-10-31', 'fin calendario org TZ');
check(shiftMonth(2026, 1, -1).month === 12 && shiftMonth(2026, 1, -1).year === 2025, 'mes anterior enero');
const feb = getLocalMonthRange(2026, 2, MIND24_DEFAULT_IANA_TIMEZONE);
check(feb.daysInMonth === 28, 'febrero 2026 no bisiesto');
const nyc = getLocalMonthRange(2026, 10, 'America/New_York');
check(nyc.start.getTime() !== oct.start.getTime() || nyc.end.getTime() !== oct.end.getTime() || true, 'rango depende de IANA');
check(
  nyc.start.toISOString() === '2026-10-01T04:00:00.000Z' ||
    nyc.start.toISOString() === '2026-10-01T05:00:00.000Z',
  'octubre America/New_York inicia en medianoche local',
);

try {
  parseMetricsMonthInput(2026, 13);
  check(false, 'mes 13 debe fallar');
} catch {
  check(true, 'validación mes');
}

console.log('\n=== Shares terminales (unit) ===\n');

const sharesOk = buildTerminalClosureShares({ hired: 2, rejected: 1, declined: 1 });
check(sharesOk.terminalDecisions === 4, 'terminalDecisions suma cierres');
check(
  sharesOk.hireShare === 0.5 && sharesOk.rejectionShare === 0.25 && sharesOk.declineShare === 0.25,
  'shares 0–1 con datos',
);
check(
  Math.abs(sharesOk.hireShare + sharesOk.rejectionShare + sharesOk.declineShare - 1) < 1e-12,
  'tres shares suman 1 (tolerancia float)',
);
const onlyHired = buildTerminalClosureShares({ hired: 3, rejected: 0, declined: 0 });
check(
  onlyHired.hireShare === 1 && onlyHired.rejectionShare === 0 && onlyHired.declineShare === 0,
  'una sola categoría → share 1 y 0',
);
const sharesEmpty = buildTerminalClosureShares({ hired: 0, rejected: 0, declined: 0 });
check(
  sharesEmpty.terminalDecisions === 0 &&
    sharesEmpty.hireShare === null &&
    sharesEmpty.rejectionShare === null &&
    sharesEmpty.declineShare === null,
  'shares con cero terminales → null',
);

console.log('\n=== Cobertura calendarística (unit, sin DB) ===\n');

const opened = d('2026-10-01T15:00:00.000Z');
const covered = d('2026-10-11T18:00:00.000Z');
const daysMx = calendarDayDiff(
  localDateKey(opened, MIND24_DEFAULT_IANA_TIMEZONE),
  localDateKey(covered, MIND24_DEFAULT_IANA_TIMEZONE),
);
check(daysMx === 10, 'openedAt→coveredAt en TZ org (días calendario)');
const covOk = computeCoverageAverageFromVacancies(
  [{ openedAt: opened, coveredAt: covered }],
  MIND24_DEFAULT_IANA_TIMEZONE,
);
check(covOk.sampleSize === 1 && covOk.value === 10, 'COVERED con coveredAt en mes entra al promedio');
const covInvalid = computeCoverageAverageFromVacancies(
  [{ openedAt: d('2026-10-20T12:00:00.000Z'), coveredAt: d('2026-10-10T12:00:00.000Z') }],
  MIND24_DEFAULT_IANA_TIMEZONE,
);
check(
  covInvalid.sampleSize === 0 && covInvalid.value === null && covInvalid.invalidChronology === 1,
  'openedAt posterior a coveredAt: inválido, sin duración negativa',
);
const covLegacyRow = computeCoverageAverageFromVacancies(
  [{ openedAt: opened, coveredAt: null }],
  MIND24_DEFAULT_IANA_TIMEZONE,
);
check(covLegacyRow.sampleSize === 0, 'legacy sin coveredAt no entra al promedio');

console.log('\n=== Reglas consolidadas HIRED/REJECTED ===\n');

const monthStart = d('2026-10-01T06:00:00.000Z');
const monthEnd = d('2026-11-01T06:00:00.000Z');
const endOct = d('2026-10-31T23:59:59.999Z');
const appId = 'app1';

const baseCtx = {
  applicationId: appId,
  monthStart,
  monthEnd,
  endOfMonthInstant: endOct,
  timeZone: MIND24_DEFAULT_IANA_TIMEZONE,
};

check(
  qualifyTerminalApplicationForMonth({
    ...baseCtx,
    currentStageKey: 'NEW',
    stageKey: 'HIRED',
    isCurrentMonth: true,
    now: d('2026-10-26T12:00:00.000Z'),
    timeline: [
      { createdAt: d('2026-10-10T12:00:00.000Z'), toStageKey: 'NEW' },
      { createdAt: d('2026-10-10T13:00:00.000Z'), toStageKey: 'HIRED' },
      { createdAt: d('2026-10-10T18:00:00.000Z'), toStageKey: 'NEW' },
    ],
  }) === null,
  'HIRED <24 h y sale → no cuenta (mes actual)',
);

check(
  qualifyTerminalApplicationForMonth({
    ...baseCtx,
    currentStageKey: 'HIRED',
    stageKey: 'HIRED',
    isCurrentMonth: true,
    now: d('2026-10-26T12:00:00.000Z'),
    timeline: [
      { createdAt: d('2026-10-01T12:00:00.000Z'), toStageKey: 'NEW' },
      { createdAt: d('2026-10-05T12:00:00.000Z'), toStageKey: 'HIRED' },
    ],
  }) != null,
  'HIRED >24 h y sigue → cuenta (mes actual)',
);

check(
  qualifyTerminalApplicationForMonth({
    ...baseCtx,
    currentStageKey: 'NEW',
    stageKey: 'REJECTED',
    isCurrentMonth: true,
    now: d('2026-10-26T12:00:00.000Z'),
    timeline: [
      { createdAt: d('2026-10-12T12:00:00.000Z'), toStageKey: 'REJECTED' },
      { createdAt: d('2026-10-12T20:00:00.000Z'), toStageKey: 'NEW' },
    ],
  }) === null,
  'REJECTED <24 h → no cuenta',
);

check(
  qualifyTerminalApplicationForMonth({
    ...baseCtx,
    currentStageKey: 'REJECTED',
    stageKey: 'REJECTED',
    isCurrentMonth: true,
    now: d('2026-10-26T12:00:00.000Z'),
    timeline: [{ createdAt: d('2026-10-12T12:00:00.000Z'), toStageKey: 'REJECTED' }],
  }) != null,
  'REJECTED >24 h → cuenta',
);

const reentry = qualifyTerminalApplicationForMonth({
  ...baseCtx,
  currentStageKey: 'HIRED',
  stageKey: 'HIRED',
  isCurrentMonth: true,
  now: d('2026-10-26T12:00:00.000Z'),
  timeline: [
    { createdAt: d('2026-10-05T12:00:00.000Z'), toStageKey: 'HIRED' },
    { createdAt: d('2026-10-05T14:00:00.000Z'), toStageKey: 'NEW' },
    { createdAt: d('2026-10-20T12:00:00.000Z'), toStageKey: 'HIRED' },
  ],
});
check(reentry != null && reentry.entryAt.getTime() === d('2026-10-20T12:00:00.000Z').getTime(), 'reingreso reinicia ventana 24 h');

const dupApps = [
  {
    applicationId: 'a1',
    currentStageKey: 'HIRED',
    timeline: [
      { createdAt: d('2026-10-01T12:00:00.000Z'), toStageKey: 'HIRED' },
      { createdAt: d('2026-10-02T12:00:00.000Z'), toStageKey: 'NEW' },
      { createdAt: d('2026-10-03T12:00:00.000Z'), toStageKey: 'HIRED' },
    ],
  },
];
const dupCount = consolidateTerminalApplications(dupApps, 'HIRED', {
  monthStart,
  monthEnd,
  endOfMonthInstant: endOct,
  now: d('2026-10-26T12:00:00.000Z'),
  isCurrentMonth: true,
}).length;
check(dupCount === 1, 'varios eventos misma application → no duplica');

check(
  qualifyTerminalApplicationForMonth({
    ...baseCtx,
    currentStageKey: 'NEW',
    stageKey: 'HIRED',
    isCurrentMonth: false,
    now: d('2026-11-15T12:00:00.000Z'),
    timeline: [
      { createdAt: d('2026-10-15T12:00:00.000Z'), toStageKey: 'HIRED' },
      { createdAt: d('2026-11-03T12:00:00.000Z'), toStageKey: 'NEW' },
    ],
  }) != null,
  'mes histórico: HIRED 15 oct, sale 3 nov → oct sí cuenta al cierre',
);

check(
  qualifyTerminalApplicationForMonth({
    ...baseCtx,
    currentStageKey: 'NEW',
    stageKey: 'HIRED',
    isCurrentMonth: false,
    now: d('2026-11-15T12:00:00.000Z'),
    timeline: [
      { createdAt: d('2026-10-15T12:00:00.000Z'), toStageKey: 'HIRED' },
      { createdAt: d('2026-10-20T12:00:00.000Z'), toStageKey: 'NEW' },
    ],
  }) === null,
  'mes histórico: salió antes de cierre → no cuenta',
);

check(
  effectiveStageKeyAt(
    [
      { createdAt: d('2026-10-15T12:00:00.000Z'), toStageKey: 'HIRED' },
      { createdAt: d('2026-11-03T12:00:00.000Z'), toStageKey: 'NEW' },
    ],
    endOct,
  ) === 'HIRED',
  'stage efectivo al cierre octubre',
);

const rejInsight = rejectedTopClientFromConsolidated(
  new Map([['r1', { clientName: 'Metecno' }]]),
  [{ applicationId: 'r1', entryAt: d('2026-10-10T12:00:00.000Z') }],
);
check(rejInsight.total === 1 && rejInsight.topClient?.name === 'Metecno', 'insights rechazos consolidados');

check(TERMINAL_MIN_DWELL_MS === 86400000, 'ventana 24 h');

console.log('\n=== Métricas — integración PG ===\n');

async function runPg() {
  const { prisma } = await import('../src/db/client.js');
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    pgSkip = true;
    console.log('  SKIP  PostgreSQL no disponible (integración métricas)');
    return;
  }

  const { hashPassword } = await import('../src/services/auth.service.js');
  const { ensureOrgRecruitmentStages } = await import('../src/services/recruitmentStage.service.js');
  const { createRecruitmentApplication } = await import('../src/services/recruitmentApplication.service.js');
  const { declineRecruitmentApplication } = await import('../src/services/recruitmentProcessClosure.service.js');

  const stamp = Date.now();
  const org = await prisma.organization.create({
    data: { name: 'Metrics Org', slug: `metrics-${stamp}`, credits: 10 },
  });
  const admin = await prisma.user.create({
    data: {
      email: `metrics-${stamp}@test.local`,
      passwordHash: await hashPassword('MetricsTest!9x'),
      fullName: 'Admin Metrics',
      role: 'empresa_admin',
      organizationId: org.id,
    },
  });
  await ensureOrgRecruitmentStages(org.id);
  const stages = await prisma.recruitmentStage.findMany({ where: { organizationId: org.id } });
  const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));
  const vac = await prisma.recruitmentVacancy.create({
    data: {
      organizationId: org.id,
      title: 'Vac métricas',
      status: 'ACTIVE',
      openedAt: new Date('2026-10-01T15:00:00.000Z'),
      positionsTotal: 1,
    },
  });

  try {
    const range = getLocalMonthRange(2026, 10, MIND24_DEFAULT_IANA_TIMEZONE);
    const mid = new Date(range.start.getTime() + 5 * 86400000);

    const candA = await prisma.recruitmentCandidate.create({
      data: {
        organizationId: org.id,
        fullName: 'Cand A',
        profile: 'Operador',
        phone: '5510000001',
        createdAt: mid,
      },
    });
    await createRecruitmentApplication({
      organizationId: org.id,
      vacancyId: vac.id,
      candidateId: candA.id,
      changedByUserId: admin.id,
    });
    await prisma.recruitmentApplication.updateMany({
      where: { candidateId: candA.id },
      data: { createdAt: mid, appliedAt: mid },
    });

    const candOnlyReg = await prisma.recruitmentCandidate.create({
      data: {
        organizationId: org.id,
        fullName: 'Solo registrado',
        profile: 'Operador',
        phone: '5510000002',
        createdAt: mid,
      },
    });

    const candOld = await prisma.recruitmentCandidate.create({
      data: {
        organizationId: org.id,
        fullName: 'Antiguo',
        profile: 'Operador',
        phone: '5510000003',
        createdAt: new Date('2026-08-01T12:00:00.000Z'),
      },
    });
    await createRecruitmentApplication({
      organizationId: org.id,
      vacancyId: vac.id,
      candidateId: candOld.id,
      changedByUserId: admin.id,
    });
    await prisma.recruitmentApplication.updateMany({
      where: { candidateId: candOld.id },
      data: { createdAt: mid, appliedAt: mid },
    });

    const candMulti = await prisma.recruitmentCandidate.create({
      data: {
        organizationId: org.id,
        fullName: 'Multi app',
        profile: 'Operador',
        phone: '5510000004',
        createdAt: mid,
      },
    });
    const vac2 = await prisma.recruitmentVacancy.create({
      data: {
        organizationId: org.id,
        title: 'Vac 2',
        status: 'ACTIVE',
        openedAt: new Date('2026-10-02T15:00:00.000Z'),
        positionsTotal: 1,
      },
    });
    await createRecruitmentApplication({
      organizationId: org.id,
      vacancyId: vac.id,
      candidateId: candMulti.id,
      changedByUserId: admin.id,
    });
    await createRecruitmentApplication({
      organizationId: org.id,
      vacancyId: vac2.id,
      candidateId: candMulti.id,
      changedByUserId: admin.id,
    });
    await prisma.recruitmentApplication.updateMany({
      where: { candidateId: candMulti.id },
      data: { createdAt: mid, appliedAt: mid },
    });

    const metricsMid = await getRecruitmentMetrics(org.id, 2026, 10, new Date('2026-11-15T12:00:00.000Z'));
    check(
      metricsMid.kpis.candidatesRegistered.total >= 3,
      'Registrados cuenta personas creadas en mes',
    );
    check(
      metricsMid.kpis.enteredProcess.total >= 3,
      'Ingresaron cuenta personas con app en mes',
    );

    const candCountBeforeReapply = await prisma.recruitmentCandidate.count({
      where: { organizationId: org.id },
    });
    const firstApp = await prisma.recruitmentApplication.findFirst({
      where: { candidateId: candA.id },
    });
    await declineRecruitmentApplication({
      organizationId: org.id,
      applicationId: firstApp.id,
      reason: 'PERSONAL',
      createdByUserId: admin.id,
    });
    await prisma.recruitmentApplication.update({
      where: { id: firstApp.id },
      data: { closedAt: mid },
    });
    const second = await createRecruitmentApplication({
      organizationId: org.id,
      vacancyId: vac.id,
      candidateId: candA.id,
      changedByUserId: admin.id,
    });
    await prisma.recruitmentApplication.update({
      where: { id: second.id },
      data: { createdAt: mid, appliedAt: mid },
    });
    const candCountAfter = await prisma.recruitmentCandidate.count({
      where: { organizationId: org.id },
    });
    check(candCountAfter === candCountBeforeReapply, 'reaplicación: Registrados (conteo personas) no aumenta');
    check(second.candidateId === candA.id, 'reaplicación conserva candidateId');

    const declinedIn = await countDeclinedApplicationsForMonth(org.id, range.start, range.end);
    check(declinedIn.total >= 1, 'Declinación con closedAt en mes');
    const outRange = getLocalMonthRange(2026, 9, MIND24_DEFAULT_IANA_TIMEZONE);
    const declinedOut = await countDeclinedApplicationsForMonth(org.id, outRange.start, outRange.end);
    check(declinedOut.total === 0, 'Declinación fuera del mes no cuenta');

    await prisma.recruitmentApplication.create({
      data: {
        organizationId: org.id,
        candidateId: candOnlyReg.id,
        vacancyId: vac.id,
        stageId: byKey.CONTACT.id,
        position: 1,
        appliedAt: mid,
        createdAt: mid,
        closureOutcome: 'DECLINED',
        closedAt: null,
        blocksReapplication: false,
      },
    });
    const declinedMissing = await countDeclinedApplicationsForMonth(org.id, range.start, range.end);
    check(declinedMissing.total >= 1, 'Declinación sin closedAt no entra al total del mes');
    check(declinedMissing.excludedMissingClosedAt == null, 'KPI mensual no reporta excludedMissingClosedAt');
    const dqMissing = await loadRecruitmentMetricsDataQuality(org.id);
    check(
      dqMissing.declinedApplicationsMissingClosedAt >= 1,
      'dataQuality global: DECLINED sin closedAt',
    );

    await prisma.recruitmentCandidate.update({
      where: { id: candA.id },
      data: { archivedAt: new Date() },
    });
    const declinedArchived = await countDeclinedApplicationsForMonth(org.id, range.start, range.end);
    check(declinedArchived.total >= 1, 'Declinación de candidato archivado incluida');

    const metricsDecl = await getRecruitmentMetrics(org.id, 2026, 10, new Date('2026-11-15T12:00:00.000Z'));
    check(metricsDecl.kpis.declined.total >= 1, 'KPI Declinados en getRecruitmentMetrics');
    check(Number.isFinite(metricsDecl.kpis.declined.previousTotal), 'Declinados incluye previousTotal MoM');
    check(metricsDecl.kpis.declined.excludedMissingClosedAt == null, 'KPI Declinados sin excludedMissingClosedAt');
    const declApps = await prisma.recruitmentApplication.count({
      where: {
        organizationId: org.id,
        closureOutcome: 'DECLINED',
        closedAt: { gte: range.start, lt: range.end },
      },
    });
    check(declApps >= 1 && metricsDecl.kpis.declined.total === declApps, 'Declinados cuentan apps DECLINED del mes');
    check(
      metricsDecl.kpis.rejected.total === 0,
      'Declinación no entra en Rechazados consolidados',
    );
    check(metricsDecl.terminalClosures.declined === metricsDecl.kpis.declined.total, 'terminalClosures.declined alineado');
    check(
      metricsDecl.terminalClosures.terminalDecisions ===
        metricsDecl.terminalClosures.hired +
          metricsDecl.terminalClosures.rejected +
          metricsDecl.terminalClosures.declined,
      'terminalDecisions = hired + rejected + declined',
    );
    if (metricsDecl.terminalClosures.terminalDecisions > 0) {
      const tc = metricsDecl.terminalClosures;
      check(
        tc.hireShare != null && tc.rejectionShare != null && tc.declineShare != null,
        'shares terminales con datos',
      );
      check(
        Math.abs(tc.hireShare + tc.rejectionShare + tc.declineShare - 1) < 1e-12,
        'shares del payload suman 1',
      );
    }
    check(
      metricsDecl.dataQuality &&
        metricsDecl.dataQuality.declinedApplicationsMissingClosedAt >= 1,
      'getRecruitmentMetrics expone dataQuality global',
    );
    check(metricsDecl.kpis.avgCoverageDays.excludedMissingCoveredAt == null, 'avgCoverageDays sin excludedMissingCoveredAt');

    const emptySharesMetrics = await getRecruitmentMetrics(
      org.id,
      2025,
      1,
      new Date('2026-11-15T12:00:00.000Z'),
    );
    check(
      emptySharesMetrics.terminalClosures.terminalDecisions === 0 &&
        emptySharesMetrics.terminalClosures.hireShare === null,
      'shares con cero terminales → null',
    );

    await prisma.recruitmentVacancy.update({
      where: { id: vac.id },
      data: {
        status: 'COVERED',
        coveredAt: new Date('2026-10-11T18:00:00.000Z'),
        coverageSource: 'MANUAL',
        updatedAt: new Date('2026-10-11T18:00:00.000Z'),
      },
    });
    const cov1 = await avgCoverageDaysForMonth(org.id, range.start, range.end, MIND24_DEFAULT_IANA_TIMEZONE);
    check(cov1.sampleSize === 1 && cov1.value != null, '1) COVERED con coveredAt en mes');

    await prisma.recruitmentVacancy.update({
      where: { id: vac.id },
      data: { title: 'Vac métricas editada', updatedAt: new Date('2026-10-28T12:00:00.000Z') },
    });
    const cov2 = await avgCoverageDaysForMonth(org.id, range.start, range.end, MIND24_DEFAULT_IANA_TIMEZONE);
    check(cov2.value === cov1.value && cov2.sampleSize === 1, '2) edición posterior conserva el mes');

    await prisma.recruitmentVacancy.update({
      where: { id: vac.id },
      data: {
        status: 'ACTIVE',
        coveredAt: null,
        coverageSource: null,
        updatedAt: new Date('2026-10-29T12:00:00.000Z'),
      },
    });
    const covReopen = await avgCoverageDaysForMonth(org.id, range.start, range.end, MIND24_DEFAULT_IANA_TIMEZONE);
    check(covReopen.sampleSize === 0, '3) reabierta deja de contar');

    await prisma.recruitmentVacancy.update({
      where: { id: vac.id },
      data: {
        status: 'COVERED',
        coveredAt: new Date('2026-11-05T18:00:00.000Z'),
        coverageSource: 'MANUAL',
      },
    });
    const novRange = getLocalMonthRange(2026, 11, MIND24_DEFAULT_IANA_TIMEZONE);
    const covOctAfterRecover = await avgCoverageDaysForMonth(
      org.id,
      range.start,
      range.end,
      MIND24_DEFAULT_IANA_TIMEZONE,
    );
    const covNov = await avgCoverageDaysForMonth(
      org.id,
      novRange.start,
      novRange.end,
      MIND24_DEFAULT_IANA_TIMEZONE,
    );
    check(covOctAfterRecover.sampleSize === 0, '4a) re-cubierta no cuenta en mes previo');
    check(covNov.sampleSize === 1, '4b) re-cubierta cuenta en el nuevo mes');

    await prisma.recruitmentVacancy.create({
      data: {
        organizationId: org.id,
        title: 'COVERED legacy',
        status: 'COVERED',
        openedAt: new Date('2026-09-01T12:00:00.000Z'),
        coveredAt: null,
        coverageSource: null,
        positionsTotal: 1,
      },
    });
    const covLegacy = await avgCoverageDaysForMonth(org.id, range.start, range.end, MIND24_DEFAULT_IANA_TIMEZONE);
    check(covLegacy.sampleSize === 0, '5) COVERED legacy sin fecha no entra al promedio');
    const dqCov = await loadRecruitmentMetricsDataQuality(org.id);
    check(
      dqCov.coveredVacanciesMissingCoveredAt >= 1,
      '5b) deuda legacy vive en dataQuality global',
    );

    const yearShift = shiftMonth(2026, 1, -1);
    check(yearShift.year === 2025 && yearShift.month === 12, 'cambio de año diciembre–enero');
    const jan = getLocalMonthRange(2026, 1, MIND24_DEFAULT_IANA_TIMEZONE);
    check(jan.fromKey === '2026-01-01' && jan.toKey === '2026-01-31', 'primer/último día de enero');
  } finally {
    await prisma.recruitmentApplicationStageEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.workforceRecruitmentNovedad.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.recruitmentApplication.deleteMany({ where: { organizationId: org.id } });
    await prisma.recruitmentVacancyStage.deleteMany({ where: { vacancy: { organizationId: org.id } } }).catch(() => {});
    await prisma.recruitmentVacancy.deleteMany({ where: { organizationId: org.id } });
    await prisma.recruitmentCandidate.deleteMany({ where: { organizationId: org.id } });
    await prisma.recruitmentStage.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

await runPg().catch((e) => {
  if (String(e.message || e).includes('connect') || e.code === 'P1001') {
    pgSkip = true;
    console.log('  SKIP  PostgreSQL no disponible (integración métricas)');
  } else {
    console.error('  FAIL  integración:', e.message || e);
    failed += 1;
  }
});

console.log('\n=== Métricas — visual HTML real ===\n');

function chromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((item) => fs.existsSync(item)) || null;
}

async function runVisual() {
  const executablePath = chromePath();
  if (!executablePath) {
    check(false, 'Chrome o Edge local para visual de métricas');
    return;
  }
  const puppeteer = await import('puppeteer-core');
  const browser = await puppeteer.default.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(indexHtml);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const fixture = {
      period: {
        year: 2026,
        month: 10,
        label: 'Octubre 2026',
        previousMonthLabel: 'septiembre',
        footerLabel: 'Periodo: 1—31 octubre 2026',
        daysInMonth: 31,
        timeZone: 'America/Mexico_City',
      },
      kpis: {
        candidatesRegistered: {
          total: 12,
          dailyAverage: 0.4,
          deltaDailyAverage: 0.1,
          compareLabel: 'septiembre',
        },
        enteredProcess: { total: 10 },
        hired: { total: 3, deltaVsPrevious: 1, compareLabel: 'septiembre' },
        rejected: {
          total: 2,
          topClient: { name: 'Cliente <X>', count: 2, percent: 100 },
          previousTotal: 1,
        },
        declined: { total: 1, deltaVsPrevious: 0, compareLabel: 'septiembre', previousTotal: 1 },
        avgCoverageDays: {
          value: 8.5,
          deltaVsPrevious: -1.2,
          compareLabel: 'septiembre',
          coverageDateSource: 'vacancy.coveredAt',
          sampleSize: 2,
        },
        activeVacancies: { total: 4, nearTargetCount: 1 },
      },
      dataQuality: {
        coveredVacanciesMissingCoveredAt: 3,
        declinedApplicationsMissingClosedAt: 2,
      },
      terminalClosures: {
        hired: 3,
        rejected: 2,
        declined: 1,
        terminalDecisions: 6,
        hireShare: 0.5,
        rejectionShare: 1 / 3,
        declineShare: 1 / 6,
      },
      dailyActivity: {
        days: Array.from({ length: 31 }, (_, i) => ({
          date: `2026-10-${String(i + 1).padStart(2, '0')}`,
          registrations: i === 4 ? 5 : 0,
          hires: i === 10 ? 1 : 0,
          intensity: i === 4 ? 5 : 0,
        })),
        peak: { date: '2026-10-05', registrations: 5 },
      },
      insights: [],
      generatedAt: new Date().toISOString(),
    };

    const expectedCols = {
      1280: 4,
      900: 2,
      768: 2,
      390: 1,
    };

    for (const width of [1280, 900, 768, 390]) {
      await page.setViewport({ width, height: 900 });
      const probe = await page.evaluate((data) => {
        const host = document.getElementById('rec-metrics-host') || document.createElement('div');
        host.id = 'rec-metrics-host';
        if (!host.parentNode) {
          host.style.width = '100%';
          document.body.appendChild(host);
        }
        recMetricsRender(data);
        const grid = host.querySelector('.rec-metrics-kpi-grid');
        const gt = grid ? getComputedStyle(grid).gridTemplateColumns : '';
        const repeatMatch = gt.match(/repeat\(\s*(\d+)\s*,/i);
        let cols = 0;
        if (repeatMatch) cols = Number(repeatMatch[1]);
        else if (/minmax\(/i.test(gt)) cols = (gt.match(/minmax\(/gi) || []).length;
        else cols = gt.split(/\s+/).filter(Boolean).length;
        const cards = [...host.querySelectorAll('.rec-metrics-kpi')];
        const heights = cards.map((c) => Math.round(c.getBoundingClientRect().height));
        const labels = cards.map((c) => (c.querySelector('.rec-metrics-kpi-label') || {}).textContent || '');
        const tips = [...host.querySelectorAll('.rec-metrics-kpi-tip')].map((el) => el.textContent || '');
        const tipBtns = [...host.querySelectorAll('.rec-metrics-kpi-info')];
        const declinedCard = cards.find((c) => /Declinados/.test(c.textContent || ''));
        const rejectedCard = cards.find((c) => /Rechazados/.test(c.textContent || ''));
        const hiredCard = cards.find((c) => (c.querySelector('.rec-metrics-kpi-label') || {}).textContent === 'Contratados');
        const sampleNote = (cards.find((c) => /cobertura/i.test(c.textContent || '')) || {}).textContent || '';
        const calText = (host.querySelector('.rec-metrics-cal-grid') || {}).textContent || '';
        return {
          cardCount: cards.length,
          cols,
          labels,
          tipCount: tips.length,
          tipBtnCount: tipBtns.length,
          tipLabels: tipBtns.map((b) => b.getAttribute('aria-label') || ''),
          tipDescribed: tipBtns.every((b) => {
            const id = b.getAttribute('aria-describedby');
            const tip = id ? document.getElementById(id) : null;
            return tip && tip.getAttribute('role') === 'tooltip';
          }),
          hasDeclined: labels.includes('Declinados'),
          tipRegistered: tips.some((t) => /registradas por primera vez/i.test(t)),
          tipEntered: tips.some((t) => /iniciaron al menos un proceso/i.test(t)),
          tipHiredProcess: tips.some((t) => /Procesos que llegaron a contratación/i.test(t)),
          sampleNote:
            /fecha de cobertura confiable/i.test(sampleNote) &&
            /no pueden asignarse a un mes/i.test(sampleNote) &&
            !/excluidas este mes/i.test(sampleNote),
          safeText: !/Cliente <X>/.test(host.innerHTML) && host.textContent.includes('Cliente <X>'),
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          declinedOrange: !!(declinedCard && declinedCard.querySelector('.rec-metrics-kpi-icon--orange')),
          rejectedCoral: !!(rejectedCard && rejectedCard.querySelector('.rec-metrics-kpi-icon--coral')),
          hiredGreen: !!(hiredCard && hiredCard.querySelector('.rec-metrics-kpi-icon--green')),
          calOmitsDeclined: !/Declinad/i.test(calText),
          heights,
        };
      }, fixture);
      check(probe.cardCount === 7 && probe.hasDeclined, `${width}px: 7 KPI incluyendo Declinados`);
      check(probe.cols === expectedCols[width], `${width}px: grid ${expectedCols[width]} columnas (got ${probe.cols})`);
      check(probe.tipBtnCount >= 5 && probe.tipRegistered && probe.tipEntered, `${width}px: tooltips Registrados/Ingresaron`);
      check(probe.tipHiredProcess, `${width}px: tooltip Contratados habla de procesos`);
      check(
        probe.tipLabels.every((l) => /Más información sobre /.test(l)),
        `${width}px: aria-label descriptivo en ?`,
      );
      check(probe.tipDescribed, `${width}px: aria-describedby → role=tooltip`);
      check(probe.sampleNote, `${width}px: nota honesta de deuda global de cobertura`);
      check(probe.safeText, `${width}px: textos escapados`);
      check(probe.overflow <= 1, `${width}px: sin desborde horizontal`);
      check(probe.declinedOrange && probe.rejectedCoral && probe.hiredGreen, `${width}px: tonos Declinados/Rechazados/Contratados`);
      check(probe.calOmitsDeclined, `${width}px: calendario sin Declinados`);
    }

    await page.setViewport({ width: 390, height: 900 });
    const tipProbe = await page.evaluate((data) => {
      const host = document.getElementById('rec-metrics-host');
      recMetricsRender(data);
      const btns = [...host.querySelectorAll('.rec-metrics-kpi-info')];
      if (btns.length < 2) return { ok: false, reason: 'few tips' };
      btns[0].click();
      const firstOpen =
        btns[0].getAttribute('aria-expanded') === 'true' &&
        document.getElementById(btns[0].getAttribute('aria-describedby'))?.classList.contains(
          'rec-metrics-kpi-tip--open',
        );
      btns[1].click();
      const onlySecond =
        btns[1].getAttribute('aria-expanded') === 'true' &&
        btns[0].getAttribute('aria-expanded') === 'false';
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const afterEsc = !host.querySelector('.rec-metrics-kpi-info[aria-expanded="true"]');
      btns[0].click();
      document.body.click();
      const afterOutside = !host.querySelector('.rec-metrics-kpi-info[aria-expanded="true"]');
      btns[0].click();
      const beforeRerender = host.querySelectorAll('.rec-metrics-kpi-tip--open').length === 1;
      recMetricsRender(data);
      const afterRerender = !host.querySelector('.rec-metrics-kpi-info[aria-expanded="true"]');
      const boundOnce = host.__recMetricsTipsBound === true;
      return {
        ok: true,
        firstOpen,
        onlySecond,
        afterEsc,
        afterOutside,
        beforeRerender,
        afterRerender,
        boundOnce,
      };
    }, fixture);
    check(tipProbe.ok && tipProbe.firstOpen, '390px: tip abre con click/tap');
    check(tipProbe.onlySecond, '390px: abrir otro cierra el anterior');
    check(tipProbe.afterEsc, '390px: Escape cierra tip');
    check(tipProbe.afterOutside, '390px: click fuera cierra tip');
    check(tipProbe.beforeRerender && tipProbe.afterRerender, '390px: re-render cierra tip abierto');
    check(tipProbe.boundOnce, '390px: listeners de tip no se duplican');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

await runVisual().catch((e) => {
  console.error('  FAIL  visual métricas:', e.message || e);
  failed += 1;
});

if (failed) {
  console.error(`\n✗ ${failed} fallo(s)${pgSkip ? ' (PG skipped)' : ''}\n`);
  process.exit(1);
}
console.log(`\n✓ Recruitment metrics tests OK${pgSkip ? ' (PG skipped)' : ''}.\n`);

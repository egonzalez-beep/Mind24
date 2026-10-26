/**
 * Auditoría puntual KPIs Métricas (sin cambiar producción).
 * node server/scripts/audit-recruitment-metrics-kpis.mjs
 * Opcional: AUDIT_YEAR=2026 AUDIT_MONTH=10 AUDIT_ORG_ID=...
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'audit-metrics';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL requerida para auditoría.');
  process.exit(1);
}

const AUDIT_YEAR = Number(process.env.AUDIT_YEAR || 2026);
const AUDIT_MONTH = Number(process.env.AUDIT_MONTH || 10);

const { prisma } = await import('../src/db/client.js');
const { resolveOrganizationIanaTimezone } = await import(
  '../src/services/organizationTimezone.service.js'
);
const { getLocalMonthRange, getRecruitmentMetrics } = await import(
  '../src/services/recruitmentMetrics.service.js'
);
const { endOfCalendarDayInTimeZone } = await import('../src/utils/workforceDueDate.js');

function msToHuman(ms) {
  if (ms == null) return '—';
  const h = ms / 3600000;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} días`;
}

async function pickOrganizationId() {
  if (process.env.AUDIT_ORG_ID) return process.env.AUDIT_ORG_ID;
  const { start, end } = getLocalMonthRange(
    AUDIT_YEAR,
    AUDIT_MONTH,
    'America/Mexico_City',
  );
  const grouped = await prisma.recruitmentApplicationStageEvent.groupBy({
    by: ['organizationId'],
    where: {
      createdAt: { gte: start, lt: end },
      toStage: { key: { in: ['HIRED', 'REJECTED'] } },
    },
    _count: { id: true },
  });
  grouped.sort((a, b) => b._count.id - a._count.id);
  if (grouped.length) return grouped[0].organizationId;
  const org = await prisma.organization.findFirst({
    where: { empresaPortalEnabled: true },
    select: { id: true, name: true },
  });
  return org?.id || null;
}

async function loadStageKeys(organizationId) {
  const stages = await prisma.recruitmentStage.findMany({
    where: { organizationId },
    select: { id: true, key: true, name: true },
  });
  const byId = new Map(stages.map((s) => [s.id, s]));
  return byId;
}

async function auditTerminalEvents(organizationId, stageKey, start, end, stageById) {
  const events = await prisma.recruitmentApplicationStageEvent.findMany({
    where: {
      organizationId,
      createdAt: { gte: start, lt: end },
      toStage: { key: stageKey },
    },
    include: {
      application: {
        include: {
          candidate: { select: { id: true, fullName: true } },
          vacancy: { select: { id: true, title: true, clientName: true } },
          stage: { select: { id: true, key: true, name: true } },
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const appIds = [...new Set(events.map((e) => e.applicationId))];
  const allEvents = appIds.length
    ? await prisma.recruitmentApplicationStageEvent.findMany({
        where: { organizationId, applicationId: { in: appIds } },
        include: { toStage: { select: { key: true, name: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    : [];
  const byApp = new Map();
  for (const ev of allEvents) {
    if (!byApp.has(ev.applicationId)) byApp.set(ev.applicationId, []);
    byApp.get(ev.applicationId).push(ev);
  }

  const rows = [];
  for (const ev of events) {
    const app = ev.application;
    const timeline = byApp.get(ev.applicationId) || [];
    const idx = timeline.findIndex((t) => t.id === ev.id);
    const next = idx >= 0 && idx < timeline.length - 1 ? timeline[idx + 1] : null;
    const leftTerminal = next != null && next.toStage?.key !== stageKey;
    const durationMs = next ? next.createdAt.getTime() - ev.createdAt.getTime() : null;
    const laterReentries = timeline
      .slice(idx + 1)
      .filter((t) => t.toStage?.key === stageKey).length;
    rows.push({
      eventId: ev.id,
      applicationId: ev.applicationId,
      candidateId: app.candidateId,
      candidateName: app.candidate?.fullName || '—',
      vacancyId: app.vacancyId,
      vacancyTitle: app.vacancy?.title || '—',
      clientName: app.vacancy?.clientName || '—',
      hiredAt: ev.createdAt.toISOString(),
      currentStageKey: app.stage?.key || '—',
      currentStageName: app.stage?.name || '—',
      leftTerminal,
      durationInTerminal: durationMs,
      durationHuman: msToHuman(durationMs),
      reentriesAfter: laterReentries,
    });
  }
  return { count: events.length, rows };
}

function ruleCCount(eventsInMonth, byApp, stageKey, minHours = 24) {
  let n = 0;
  for (const ev of eventsInMonth) {
    const timeline = byApp.get(ev.applicationId) || [];
    const idx = timeline.findIndex((t) => t.id === ev.id);
    const next = idx >= 0 && idx < timeline.length - 1 ? timeline[idx + 1] : null;
    const endMs = next ? next.createdAt.getTime() : Date.now();
    const dwell = endMs - ev.createdAt.getTime();
    if (dwell >= minHours * 3600000) n += 1;
  }
  return n;
}

function stageAtInstant(timeline, instant) {
  let last = null;
  for (const ev of timeline) {
    if (ev.createdAt.getTime() <= instant.getTime()) last = ev.toStage?.key;
    else break;
  }
  return last;
}

function ruleDCount(eventsInMonth, byApp, endOfMonth, stageKey) {
  let n = 0;
  const seen = new Set();
  for (const ev of eventsInMonth) {
    if (seen.has(ev.applicationId)) continue;
    seen.add(ev.applicationId);
    const timeline = byApp.get(ev.applicationId) || [];
    const atClose = stageAtInstant(timeline, endOfMonth);
    if (atClose === stageKey) n += 1;
  }
  return n;
}

async function simulateRules(organizationId, stageKey, start, end, endOfMonth) {
  const events = await prisma.recruitmentApplicationStageEvent.findMany({
    where: {
      organizationId,
      createdAt: { gte: start, lt: end },
      toStage: { key: stageKey },
    },
    select: { id: true, applicationId: true, createdAt: true },
  });
  const appIds = [...new Set(events.map((e) => e.applicationId))];
  const apps = appIds.length
    ? await prisma.recruitmentApplication.findMany({
        where: { id: { in: appIds } },
        include: { stage: { select: { key: true } } },
      })
    : [];
  const allEvents = appIds.length
    ? await prisma.recruitmentApplicationStageEvent.findMany({
        where: { organizationId, applicationId: { in: appIds } },
        include: { toStage: { select: { key: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    : [];
  const byApp = new Map();
  for (const ev of allEvents) {
    if (!byApp.has(ev.applicationId)) byApp.set(ev.applicationId, []);
    byApp.get(ev.applicationId).push(ev);
  }
  const appStage = new Map(apps.map((a) => [a.id, a.stage?.key]));

  const ruleA = events.length;
  const ruleB = events.filter((e) => appStage.get(e.applicationId) === stageKey).length;
  const ruleC = ruleCCount(
    events.map((e) => ({ ...e, id: e.id })),
    byApp,
    stageKey,
  );
  const ruleD = ruleDCount(
    events.map((e) => ({ ...e, id: e.id })),
    byApp,
    endOfMonth,
    stageKey,
  );

  return { A: ruleA, B: ruleB, C: ruleC, D: ruleD };
}

async function auditEnteredProcess(organizationId, start, end) {
  const apps = await prisma.recruitmentApplication.findMany({
    where: { organizationId, createdAt: { gte: start, lt: end } },
    select: {
      id: true,
      candidateId: true,
      vacancyId: true,
      createdAt: true,
      candidate: { select: { fullName: true } },
      vacancy: { select: { title: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const byCandidate = new Map();
  for (const a of apps) {
    if (!byCandidate.has(a.candidateId)) byCandidate.set(a.candidateId, []);
    byCandidate.get(a.candidateId).push(a);
  }
  const multi = [...byCandidate.entries()].filter(([, list]) => list.length > 1);
  return {
    applicationsCreated: apps.length,
    distinctCandidates: byCandidate.size,
    countApplicationsNotDistinct: apps.length,
    multiVacancyCandidates: multi.map(([cid, list]) => ({
      candidateId: cid,
      name: list[0].candidate?.fullName,
      applications: list.map((x) => ({
        applicationId: x.id,
        vacancyId: x.vacancyId,
        vacancyTitle: x.vacancy?.title,
        createdAt: x.createdAt.toISOString(),
      })),
    })),
  };
}

async function main() {
  const orgId = await pickOrganizationId();
  if (!orgId) {
    console.error('No se encontró organización para auditar.');
    process.exit(1);
  }
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
  const tz = await resolveOrganizationIanaTimezone(orgId);
  const { start, end, toKey } = getLocalMonthRange(AUDIT_YEAR, AUDIT_MONTH, tz);
  const endOfMonth = endOfCalendarDayInTimeZone(toKey, tz);
  const metrics = await getRecruitmentMetrics(orgId, AUDIT_YEAR, AUDIT_MONTH);

  console.log('\n=== Auditoría KPIs Métricas ===\n');
  console.log(`Organización: ${org?.name || orgId} (${orgId})`);
  console.log(`Periodo: ${AUDIT_YEAR}-${String(AUDIT_MONTH).padStart(2, '0')} (${tz})`);
  console.log(`Rango UTC: ${start.toISOString()} → ${end.toISOString()}`);
  console.log(`Dashboard reporta: Contratados=${metrics.kpis.hired.total}, Rechazados=${metrics.kpis.rejected.total}, En proceso=${metrics.kpis.enteredProcess.total}\n`);

  const hiredAudit = await auditTerminalEvents(orgId, 'HIRED', start, end);
  console.log('--- CONTRATADOS (eventos toStage=HIRED en mes) ---\n');
  console.log(`Total eventos (Regla A / KPI actual): ${hiredAudit.count}\n`);
  hiredAudit.rows.forEach((r, i) => {
    console.log(`#${i + 1} eventId=${r.eventId}`);
    console.log(`  applicationId=${r.applicationId} candidate=${r.candidateName} (${r.candidateId})`);
    console.log(`  vacancy=${r.vacancyTitle} (${r.vacancyId}) · ${r.clientName}`);
    console.log(`  entrada HIRED: ${r.hiredAt}`);
    console.log(`  stage actual: ${r.currentStageKey} (${r.currentStageName})`);
    console.log(`  salió de HIRED después: ${r.leftTerminal ? 'sí' : 'no (sigue o sin movimiento posterior)'}`);
    console.log(`  tiempo en HIRED hasta siguiente movimiento: ${r.durationHuman}`);
    console.log(`  reingresos a HIRED posteriores a este evento: ${r.reentriesAfter}`);
    console.log('');
  });

  const rejAudit = await auditTerminalEvents(orgId, 'REJECTED', start, end);
  console.log('--- RECHAZADOS (eventos toStage=REJECTED en mes) ---\n');
  console.log(`Total eventos (Regla A / KPI actual): ${rejAudit.count}\n`);
  rejAudit.rows.forEach((r, i) => {
    console.log(`#${i + 1} eventId=${r.eventId}`);
    console.log(`  applicationId=${r.applicationId} candidate=${r.candidateName} (${r.candidateId})`);
    console.log(`  vacancy=${r.vacancyTitle} (${r.vacancyId})`);
    console.log(`  entrada REJECTED: ${r.hiredAt}`);
    console.log(`  stage actual: ${r.currentStageKey} (${r.currentStageName})`);
    console.log(`  salió de REJECTED después: ${r.leftTerminal ? 'sí' : 'no'}`);
    console.log(`  tiempo en REJECTED: ${r.durationHuman}`);
    console.log(`  reingresos a REJECTED: ${r.reentriesAfter}`);
    console.log('');
  });

  const hiredSim = await simulateRules(orgId, 'HIRED', start, end, endOfMonth);
  const rejSim = await simulateRules(orgId, 'REJECTED', start, end, endOfMonth);
  console.log('--- SIMULACIÓN REGLAS (mismo mes, sin deploy) ---\n');
  console.log('| Regla | Contratados | Rechazados |');
  console.log('|-------|-------------|------------|');
  console.log(`| A — cada transición al terminal en el mes | ${hiredSim.A} | ${rejSim.A} |`);
  console.log(`| B — transición en mes y stage actual terminal | ${hiredSim.B} | ${rejSim.B} |`);
  console.log(`| C — permanencia ≥24h en terminal | ${hiredSim.C} | ${rejSim.C} |`);
  console.log(`| D — transición en mes y terminal al cierre del mes | ${hiredSim.D} | ${rejSim.D} |`);
  console.log('');

  const proc = await auditEnteredProcess(orgId, start, end);
  console.log('--- EN PROCESO (applications creadas en mes) ---\n');
  console.log(`Applications creadas: ${proc.applicationsCreated}`);
  console.log(`Candidatos distintos (KPI actual): ${proc.distinctCandidates}`);
  console.log(`Si contáramos applications (no distinct): ${proc.countApplicationsNotDistinct}`);
  console.log(`Candidatos en >1 vacante en el mismo mes: ${proc.multiVacancyCandidates.length}`);
  if (proc.multiVacancyCandidates.length) {
    proc.multiVacancyCandidates.forEach((m) => {
      console.log(`  · ${m.name} (${m.candidateId}): ${m.applications.length} postulaciones`);
    });
  }
  console.log('\nNota copy: el label «En proceso» puede leerse como snapshot activo; el KPI mide ingresos al pipeline en el mes (distinct candidateId).\n');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

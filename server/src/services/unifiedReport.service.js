import { prisma } from '../db/client.js';
import { renderHtmlToPdfBuffer } from './pdf.service.js';
import { assertEmpresaAdmin } from './candidate.service.js';
import { isPioneerAspenAdminEmail } from './aspenAdmin.service.js';
import { resolveModuleKey, moduleMetaForKey } from '../utils/moduleCatalog.js';
import { buildUnifiedReportHtml } from '../reports/unifiedReport.template.js';
import {
  buildModuleFragment,
  orderAttemptsBySelection,
} from '../reports/moduleFragments.js';
import {
  parseCandidateDisplay,
  shortEvalId,
  fmtDateMx,
  safeFilenamePart,
} from '../reports/reportUtils.js';

function readJsonStringArray(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => resolveModuleKey(String(s))).filter(Boolean);
}

function selectedModuleKeys(assignment) {
  const fromSelected = readJsonStringArray(assignment.selectedModules);
  if (fromSelected.length) return fromSelected;
  const fromCompleted = readJsonStringArray(assignment.completedModules);
  if (fromCompleted.length) return fromCompleted;
  const fromAttempts = (assignment.attempts || [])
    .filter((a) => a.status === 'submitted' && a.moduleKey)
    .map((a) => resolveModuleKey(a.moduleKey));
  return [...new Set(fromAttempts)];
}

export async function loadAssignmentForReport(assignmentId, organizationId) {
  const assignment = await prisma.assignment.findFirst({
    where: {
      id: assignmentId,
      candidate: { organizationId },
    },
    include: {
      candidate: {
        include: {
          user: { select: { fullName: true, email: true } },
          organization: { select: { name: true } },
        },
      },
      assessmentDefinition: { select: { name: true, key: true } },
      attempts: { orderBy: { submittedAt: 'desc' } },
    },
  });
  if (!assignment) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return assignment;
}

export async function buildUnifiedPdfForAssignment(adminUserId, assignmentId) {
  const admin = await assertEmpresaAdmin(adminUserId);
  const assignment = await loadAssignmentForReport(assignmentId, admin.organizationId);

  if (!isPioneerAspenAdminEmail(admin.email) && assignment.assignedByUserId !== admin.id) {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    err.message = 'No tienes acceso al reporte de esta evaluación.';
    throw err;
  }

  if (String(assignment.status) !== 'completed') {
    const err = new Error('ASSIGNMENT_REPORT_NOT_READY');
    err.code = 'ASSIGNMENT_REPORT_NOT_READY';
    err.message = 'La evaluación debe estar completada para generar el reporte consolidado.';
    throw err;
  }

  const moduleKeys = selectedModuleKeys(assignment);
  const orderedAttempts = orderAttemptsBySelection(assignment.attempts, moduleKeys);

  const fragments = [];
  const labels = [];
  for (const attempt of orderedAttempts) {
    const html = buildModuleFragment(attempt);
    if (!html) continue;
    fragments.push(html);
    labels.push(moduleMetaForKey(attempt.moduleKey).label);
  }

  if (!fragments.length) {
    const err = new Error('ASSIGNMENT_REPORT_NOT_READY');
    err.code = 'ASSIGNMENT_REPORT_NOT_READY';
    err.message = 'No hay resultados de módulos completados para consolidar en el reporte.';
    throw err;
  }

  const display = parseCandidateDisplay(assignment.candidate.user);
  const curp = assignment.candidate.curp
    ? String(assignment.candidate.curp).toUpperCase()
    : '—';

  const lastSubmitted = orderedAttempts.reduce((max, a) => {
    const t = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
    return t > max ? t : max;
  }, 0);
  const completedAt = fmtDateMx(
    lastSubmitted ? new Date(lastSubmitted).toISOString() : assignment.updatedAt,
  );

  const html = buildUnifiedReportHtml({
    organizationName: assignment.candidate.organization?.name || 'Organización',
    candidateName: display.name,
    puesto: display.puesto,
    curp,
    assessmentName:
      assignment.assessmentDefinition?.name ||
      assignment.assessmentDefinition?.key ||
      'Evaluación',
    evaluationId: shortEvalId(assignment.id),
    completedAt,
    moduleLabels: labels,
    moduleFragmentsHtml: fragments.join('\n'),
  });

  const pdfBuffer = await renderHtmlToPdfBuffer(html);
  const safeName = safeFilenamePart(display.name);

  return {
    buffer: pdfBuffer,
    filename: `Mind24_Reporte_${safeName}_${shortEvalId(assignment.id)}.pdf`,
    contentType: 'application/pdf',
  };
}

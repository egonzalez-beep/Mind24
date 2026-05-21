import { prisma } from '../db/client.js';
import { CLEAVER_DISC_KEYS } from '../data/cleaverDiscKey.js';
import { buildCleaverReportHtml } from '../reports/cleaverReport.template.js';
import { renderHtmlToPdfBuffer } from './pdf.service.js';
import { assertEmpresaAdmin } from './candidate.service.js';
import { isPioneerAspenAdminEmail } from './aspenAdmin.service.js';
function parseCandidateDisplay(user) {
  const raw = String(user?.fullName || 'Candidato').trim();
  const parts = raw.split('·').map((s) => s.trim());
  if (parts.length >= 2) {
    return { name: parts[0], puesto: parts.slice(1).join(' · ') };
  }
  return { name: raw, puesto: '—' };
}

function shortEvalId(id) {
  const s = String(id || '');
  return s.length > 10 ? s.slice(0, 8).toUpperCase() : s.toUpperCase();
}

function extractCleaverScores(attempt) {
  const raw = attempt?.scores;
  if (!raw || typeof raw !== 'object') return null;
  const inner = raw.scores && typeof raw.scores === 'object' ? raw.scores : raw;
  const most = inner.most || inner.Most;
  const least = inner.least || inner.Least;
  const total = inner.total || inner.Total;
  if (!most || !least || !total) return null;
  const pick = (obj) => {
    const out = {};
    for (const k of CLEAVER_DISC_KEYS) {
      out[k] = Number(obj[k]) || 0;
    }
    return out;
  };
  return { most: pick(most), least: pick(least), total: pick(total) };
}

export async function findCleaverAttemptForCandidate(candidateId, organizationId) {
  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, organizationId },
    include: {
      user: { select: { fullName: true, email: true } },
      assignments: {
        include: {
          assessmentDefinition: { select: { name: true } },
          attempts: {
            where: { moduleKey: { in: ['cleaver', 'disc'] }, status: 'submitted' },
            orderBy: { submittedAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!candidate) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }

  for (const assignment of candidate.assignments) {
    for (const attempt of assignment.attempts) {
      const scores = extractCleaverScores(attempt);
      if (scores) {
        return { candidate, assignment, attempt, scores };
      }
    }
  }

  const err = new Error('CLEAVER_REPORT_NOT_READY');
  err.code = 'CLEAVER_REPORT_NOT_READY';
  err.message = 'No hay un intento Cleaver completado con puntuación para este candidato.';
  throw err;
}

export async function buildCleaverPdfForCandidate(adminUserId, candidateId) {
  const admin = await assertEmpresaAdmin(adminUserId);
  const { candidate, assignment, attempt, scores } = await findCleaverAttemptForCandidate(
    candidateId,
    admin.organizationId,
  );

  if (!isPioneerAspenAdminEmail(admin.email) && assignment.assignedByUserId !== admin.id) {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    err.message = 'No tienes acceso al reporte de este candidato.';
    throw err;
  }

  const display = parseCandidateDisplay(candidate.user);
  const completedAt = attempt.submittedAt
    ? new Date(attempt.submittedAt).toLocaleString('es-MX', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';

  const html = buildCleaverReportHtml({
    candidateName: display.name,
    puesto: display.puesto,
    evaluationId: shortEvalId(assignment.id),
    completedAt,
    scores,
  });

  const pdfBuffer = await renderHtmlToPdfBuffer(html);
  const safeName = display.name.replace(/[^\w\s-áéíóúñÁÉÍÓÚÑ]/g, '').trim().replace(/\s+/g, '_') || 'candidato';

  return {
    buffer: pdfBuffer,
    filename: `Cleaver_${safeName}_${shortEvalId(assignment.id)}.pdf`,
    contentType: 'application/pdf',
  };
}

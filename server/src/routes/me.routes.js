import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { requireEmpresaPortal } from '../middleware/empresaPortal.middleware.js';
import { listMyAssignments, startAttempt, submitAttempt, getAttemptResult } from '../services/attempt.service.js';
import { getCandidateLobbyForUser } from '../services/candidateAuth.service.js';

const router = Router();

router.use(requireAuth, requireRole('candidato'), requireEmpresaPortal);

router.get('/lobby', async (req, res, next) => {
  try {
    const lobby = await getCandidateLobbyForUser(req.session.userId);
    res.json({
      user: {
        id: lobby.user.id,
        email: lobby.user.email,
        fullName: lobby.user.fullName,
        role: lobby.user.role,
      },
      lobby: {
        assignmentId: lobby.assignmentId,
        modules: lobby.modules,
        assignments: lobby.assignments,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/assignments', async (req, res, next) => {
  try {
    const rows = await listMyAssignments(req.session.userId);
    res.json({
      assignments: rows.map((a) => ({
        id: a.id,
        status: a.status,
        createdAt: a.createdAt,
        assessment: a.assessmentDefinition,
        lastAttempt: a.attempts[0]
          ? { id: a.attempts[0].id, status: a.attempts[0].status, startedAt: a.attempts[0].startedAt }
          : null,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/assignments/:assignmentId/start', async (req, res, next) => {
  try {
    const { moduleKey } = z
      .object({ moduleKey: z.string().min(1).max(64) })
      .parse(req.body ?? {});
    const out = await startAttempt(req.session.userId, req.params.assignmentId, { moduleKey });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

router.post('/attempts/:attemptId/submit', async (req, res, next) => {
  try {
    const { answers } = z
      .object({
        answers: z.record(z.string(), z.number().int().min(0)),
      })
      .parse(req.body);
    const scored = await submitAttempt(req.session.userId, req.params.attemptId, answers);
    res.json({ result: scored });
  } catch (e) {
    next(e);
  }
});

router.get('/attempts/:attemptId/result', async (req, res, next) => {
  try {
    const result = await getAttemptResult(req.session.userId, req.params.attemptId);
    res.json({ result });
  } catch (e) {
    next(e);
  }
});

export default router;

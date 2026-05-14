import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { listMyAssignments, startAttempt, submitAttempt, getAttemptResult } from '../services/attempt.service.js';

const router = Router();

router.use(requireAuth, requireRole('candidato'));

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
    const out = await startAttempt(req.session.userId, req.params.assignmentId);
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

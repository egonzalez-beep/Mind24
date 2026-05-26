import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { submitDigitalInterviewAudios } from '../services/digitalInterview.service.js';

const router = Router();

router.use(requireAuth, requireRole('candidato'));

router.post('/audio', async (req, res, next) => {
  try {
    const parsed = z
      .object({
        attemptId: z.string().min(1),
        audios: z.object({
          bloque1: z.string().min(32).max(10_000_000),
          bloque2: z.string().min(32).max(10_000_000),
          bloque3: z.string().min(32).max(10_000_000),
        }),
      })
      .parse(req.body);

    const out = await submitDigitalInterviewAudios(
      req.session.userId,
      parsed.attemptId,
      parsed.audios,
    );
    res.json(out);
  } catch (e) {
    next(e);
  }
});

export default router;


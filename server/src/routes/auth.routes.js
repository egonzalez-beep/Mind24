import { Router } from 'express';
import { z } from 'zod';
import { authenticateUser, toSessionPayload } from '../services/auth.service.js';
import { loginRateLimiter } from '../middleware/rateLimit.middleware.js';

const router = Router();

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

router.post('/login', loginRateLimiter, async (req, res, next) => {
  try {
    const { email, password } = z
      .object({
        email: z.string().email(),
        password: z.string().min(1).max(200),
      })
      .parse(req.body);
    const user = await authenticateUser(email, password);
    await regenerateSession(req);
    Object.assign(req.session, toSessionPayload(user));
    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        organizationId: user.organizationId,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('mind24.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Se requiere sesión.' });
  }
  res.json({
    user: {
      id: req.session.userId,
      email: req.session.email,
      fullName: req.session.fullName,
      role: req.session.role,
      organizationId: req.session.organizationId,
    },
  });
});

export default router;

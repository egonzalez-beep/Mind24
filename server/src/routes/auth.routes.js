import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { authenticateUser, toSessionPayload } from '../services/auth.service.js';
import {
  authenticateCandidateByAccess,
} from '../services/candidateAuth.service.js';
import { loginRateLimiter } from '../middleware/rateLimit.middleware.js';
import { isPioneerAspenAdminEmail } from '../services/aspenAdmin.service.js';

const router = Router();

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

/** Acceso candidato: correo + clave de evaluación (sin contraseña). */
router.post('/candidate-access', loginRateLimiter, async (req, res, next) => {
  try {
    const { email, accessCode, fullName } = z
      .object({
        email: z.string().email(),
        accessCode: z.string().min(1).max(32),
        fullName: z.string().min(1).max(200).optional(),
      })
      .parse(req.body);
    const out = await authenticateCandidateByAccess({ email, accessCode });
    await regenerateSession(req);
    Object.assign(req.session, toSessionPayload(out.user));
    res.json({
      user: {
        id: out.user.id,
        email: out.user.email,
        fullName: fullName?.trim() || out.user.fullName,
        role: out.user.role,
        organizationId: out.user.organizationId,
      },
      lobby: {
        assignmentId: out.assignmentId,
        accessCode: out.accessCode,
        modules: out.modules,
        assignments: out.assignments,
      },
    });
  } catch (e) {
    next(e);
  }
});

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
        adminCredits: user.adminCredits ?? 0,
        aspenPioneer: isPioneerAspenAdminEmail(user.email),
      },
    });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', (req, res, next) => {
  // Diagnóstico temporal: quién llama a logout (no altera la sesión).
  console.log('[auth/logout]', {
    referer: req.get('referer'),
    origin: req.get('origin'),
    path: req.originalUrl || req.url,
    hadSession: Boolean(req.session?.userId),
  });
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('mind24.sid');
    res.json({ ok: true });
  });
});

router.get('/me', async (req, res, next) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Se requiere sesión.' });
    }
    const u = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        organizationId: true,
        adminCredits: true,
      },
    });
    if (!u) {
      return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Sesión inválida.' });
    }
    res.json({
      user: { ...u, adminCredits: u.adminCredits ?? 0, aspenPioneer: isPioneerAspenAdminEmail(u.email) },
    });
  } catch (e) {
    next(e);
  }
});

export default router;

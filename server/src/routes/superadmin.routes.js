import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { loginRateLimiter } from '../middleware/rateLimit.middleware.js';
import { requireSuperAdmin } from '../middleware/superadmin.middleware.js';
import {
  verifySuperAdminCredentials,
  createCompanyWithAdmin,
  deleteOrganizationById,
  listAllSubmittedEvaluations,
} from '../services/superadmin.service.js';
import { listOrganizations, updateOrganization } from '../services/organization.service.js';
import { defaultDemoAssessmentConfig } from '../assessment/defaultDefinition.js';

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
    const ok = await verifySuperAdminCredentials(email, password);
    if (!ok) {
      const err = new Error('Credenciales inválidas');
      err.code = 'INVALID_CREDENTIALS';
      throw err;
    }
    await regenerateSession(req);
    req.session.superAdmin = true;
    req.session.superAdminEmail = email.trim().toLowerCase();
    res.json({ ok: true, superAdmin: { email: req.session.superAdminEmail } });
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
  if (!req.session?.superAdmin) {
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Sesión de administrador general requerida.' });
  }
  res.json({ superAdmin: true, email: req.session.superAdminEmail });
});

router.use(requireSuperAdmin);

router.get('/organizations', async (_req, res, next) => {
  try {
    const rows = await listOrganizations();
    res.json({ organizations: rows });
  } catch (e) {
    next(e);
  }
});

router.post('/organizations', async (req, res, next) => {
  try {
    const { orgName, slug, adminEmail, adminFullName, initialCredits } = z
      .object({
        orgName: z.string().min(2).max(200),
        slug: z.string().min(2).max(80).optional().nullable(),
        adminEmail: z.string().email(),
        adminFullName: z.string().min(2).max(200),
        initialCredits: z.number().int().min(0).max(10_000_000).optional(),
      })
      .parse(req.body);
    const out = await createCompanyWithAdmin({
      orgName,
      slug,
      adminEmail,
      adminFullName,
      initialCredits: initialCredits ?? 0,
    });
    res.status(201).json({
      organization: out.organization,
      admin: { id: out.admin.id, email: out.admin.email, fullName: out.admin.fullName },
      generatedPassword: out.plainPassword,
    });
  } catch (e) {
    next(e);
  }
});

router.patch('/organizations/:id', async (req, res, next) => {
  try {
    const { blocked, creditsDelta, name } = z
      .object({
        blocked: z.boolean().optional(),
        creditsDelta: z.number().int().optional(),
        name: z.string().min(2).max(200).optional(),
      })
      .parse(req.body);
    const org = await updateOrganization(req.params.id, { blocked, creditsDelta, name });
    res.json({ organization: org });
  } catch (e) {
    next(e);
  }
});

router.delete('/organizations/:id', async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    await deleteOrganizationById(id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/evaluations', async (_req, res, next) => {
  try {
    const rows = await listAllSubmittedEvaluations({ take: 400 });
    const evaluations = rows.map((a) => ({
      attemptId: a.id,
      submittedAt: a.submittedAt,
      scores: a.scores,
      interpretation: a.interpretation,
      assessment: a.assignment.assessmentDefinition,
      candidate: {
        email: a.assignment.candidate.user.email,
        fullName: a.assignment.candidate.user.fullName,
      },
      organization: a.assignment.candidate.organization,
    }));
    res.json({ evaluations });
  } catch (e) {
    next(e);
  }
});

router.get('/stats', async (_req, res, next) => {
  try {
    const [orgCount, attemptCount] = await Promise.all([
      prisma.organization.count(),
      prisma.assessmentAttempt.count({ where: { status: 'submitted' } }),
    ]);
    res.json({ organizations: orgCount, submittedAttempts: attemptCount });
  } catch (e) {
    next(e);
  }
});

router.post('/assessment-definitions', async (req, res, next) => {
  try {
    const { key, name, version, config } = z
      .object({
        key: z.string().min(2).max(80),
        name: z.string().min(2).max(200),
        version: z.number().int().min(1).max(999).optional(),
        config: z.any().optional(),
      })
      .parse(req.body);
    const def = await prisma.assessmentDefinition.create({
      data: {
        key,
        name,
        version: version ?? 1,
        organizationId: null,
        config: config ?? defaultDemoAssessmentConfig,
      },
    });
    res.status(201).json({ definition: def });
  } catch (e) {
    next(e);
  }
});

export default router;

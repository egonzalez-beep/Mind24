import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import {
  createOrganization,
  listOrganizations,
  updateOrganization,
} from '../services/organization.service.js';
import { prisma } from '../db/client.js';
import { defaultDemoAssessmentConfig } from '../assessment/defaultDefinition.js';

const router = Router();

router.use(requireAuth, requireRole('master_admin'));

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
    const { name, slug, credits } = z
      .object({
        name: z.string().min(2).max(200),
        slug: z.string().min(2).max(80).optional().nullable(),
        credits: z.number().int().min(0).max(1_000_000).optional(),
      })
      .parse(req.body);
    const org = await createOrganization({ name, slug, credits: credits ?? 0 });
    res.status(201).json({ organization: org });
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

/** Crear definición global (plataforma). MVP: payload mínimo validado por Zod superficialmente. */
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

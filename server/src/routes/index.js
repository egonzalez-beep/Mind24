import { Router } from 'express';
import { prisma } from '../db/client.js';
import authRoutes from './auth.routes.js';
import superadminRoutes from './superadmin.routes.js';
import orgRoutes from './org.routes.js';
import meRoutes from './me.routes.js';

const router = Router();

router.get('/health', async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'up' });
  } catch (e) {
    next(e);
  }
});

router.use('/auth', authRoutes);
router.use('/superadmin', superadminRoutes);
router.use('/org', orgRoutes);
router.use('/me', meRoutes);

export default router;

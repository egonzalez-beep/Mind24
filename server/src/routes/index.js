import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../db/client.js';
import { resolveUploadsRootAbs } from '../utils/uploadPaths.js';
import authRoutes from './auth.routes.js';
import superadminRoutes from './superadmin.routes.js';
import orgRoutes from './org.routes.js';
import meRoutes from './me.routes.js';
import reportsRoutes from './reports.routes.js';
import evaluationsRoutes from './evaluations.routes.js';

const router = Router();

router.get('/health', async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'up' });
  } catch (e) {
    next(e);
  }
});

router.get('/health/uploads', async (req, res, next) => {
  try {
    const uploadsRootAbs = resolveUploadsRootAbs();
    const audiosDirAbs = path.join(uploadsRootAbs, 'audios');
    await fs.mkdir(audiosDirAbs, { recursive: true });
    await fs.access(audiosDirAbs, fs.constants.R_OK | fs.constants.W_OK);

    const out = {
      ok: true,
      uploadsRoot: uploadsRootAbs,
      audiosDir: audiosDirAbs,
      writable: true,
    };

    const filePath = req.query?.filePath ? String(req.query.filePath) : '';
    if (filePath) {
      const normalized = filePath.replace(/\\/g, '/');
      if (!normalized.startsWith('/uploads/')) {
        const err = new Error('filePath debe iniciar con /uploads/');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
      const relFromUploads = normalized.slice('/uploads/'.length).replace(/^\/+/, '');
      const abs = path.resolve(uploadsRootAbs, relFromUploads);
      const rootWithSep = uploadsRootAbs.endsWith(path.sep)
        ? uploadsRootAbs
        : uploadsRootAbs + path.sep;
      if (!abs.startsWith(rootWithSep)) {
        const err = new Error('Ruta fuera del directorio de uploads.');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
      const st = await fs.stat(abs);
      out.fileCheck = {
        requested: filePath,
        exists: true,
        sizeBytes: st.size,
        modifiedAt: st.mtime.toISOString(),
      };
    }

    res.json(out);
  } catch (e) {
    next(e);
  }
});

router.use('/auth', authRoutes);
router.use('/superadmin', superadminRoutes);
router.use('/org', orgRoutes);
router.use('/me', meRoutes);
router.use('/reports', reportsRoutes);
router.use('/evaluations', evaluationsRoutes);

export default router;

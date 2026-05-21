import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { requireEmpresaPortal } from '../middleware/empresaPortal.middleware.js';
import { buildUnifiedPdfForAssignment } from '../services/unifiedReport.service.js';

const router = Router();

router.use(requireAuth, requireRole('empresa_admin'), requireEmpresaPortal);

/**
 * PDF consolidado por asignación (todos los módulos completados).
 */
router.get('/assignments/:assignmentId/pdf', async (req, res, next) => {
  try {
    const { buffer, filename, contentType } = await buildUnifiedPdfForAssignment(
      req.session.userId,
      req.params.assignmentId,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (e) {
    next(e);
  }
});

export default router;

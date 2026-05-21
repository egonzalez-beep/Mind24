import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { requireEmpresaPortal } from '../middleware/empresaPortal.middleware.js';
import { buildCleaverPdfForCandidate } from '../services/cleaverReport.service.js';

const router = Router();

router.use(requireAuth, requireRole('empresa_admin'), requireEmpresaPortal);

/**
 * PDF ejecutivo Cleaver (descarga directa).
 * :id = candidateId
 */
router.get('/candidate/:candidateId/pdf', async (req, res, next) => {
  try {
    const { buffer, filename, contentType } = await buildCleaverPdfForCandidate(
      req.session.userId,
      req.params.candidateId,
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

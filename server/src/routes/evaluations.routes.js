import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { submitDigitalInterviewAudios } from '../services/digitalInterview.service.js';
import { resolveAudiosDirAbs } from '../utils/uploadPaths.js';

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      const dir = resolveAudiosDirAbs();
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    // attemptId se envía como primer campo de texto en el FormData (antes de los blobs).
    const attemptId = String(req.body?.attemptId || 'attempt').replace(/[^a-zA-Z0-9_-]/g, '');
    const userId = String(req.session?.userId || 'cand').replace(/[^a-zA-Z0-9_-]/g, '');
    const ext = path.extname(file.originalname || '').toLowerCase() || '.webm';
    const safeExt = ext && ext.length <= 8 ? ext : '.webm';
    cb(null, `${Date.now()}-${userId}-${attemptId}-${file.fieldname}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB por bloque
    files: 3,
  },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith('audio/') ||
      /\.(webm|mp3|wav|m4a|ogg)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('INVALID_AUDIO_FILE'), ok);
  },
});

router.use(requireAuth, requireRole('candidato'));

router.post(
  '/audio',
  upload.fields([
    { name: 'bloque1', maxCount: 1 },
    { name: 'bloque2', maxCount: 1 },
    { name: 'bloque3', maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const attemptId = String(req.body?.attemptId || '').trim();
      if (!attemptId) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'attemptId es requerido.' });
      }

      const files = req.files || {};
      const b1 = files.bloque1?.[0];
      const b2 = files.bloque2?.[0];
      const b3 = files.bloque3?.[0];

      if (!b1 || !b2 || !b3) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Se requieren los 3 audios de bloques (bloque1, bloque2, bloque3).',
        });
      }

      // b1.path es la ruta absoluta completa que escribió multer en disco.
      // Verificamos que los archivos existan físicamente ANTES de registrarlos en la BD.
      const missingFiles = [b1, b2, b3]
        .map((f) => f.path)
        .filter((p) => !fs.existsSync(p));

      if (missingFiles.length > 0) {
        console.error('[evaluations/audio] Archivos NO encontrados en disco:', missingFiles);
        return res.status(500).json({
          error: 'STORAGE_ERROR',
          message:
            'Los archivos de audio no se guardaron correctamente en el servidor. ' +
            'Verifica que el volumen persistente esté montado en Railway.',
        });
      }

      // Log diagnóstico: rutas absolutas + tamaños (confirma que van al volumen correcto).
      console.log('[evaluations/audio] Archivos escritos correctamente en disco:', {
        bloque1: { path: b1.path, size: b1.size },
        bloque2: { path: b2.path, size: b2.size },
        bloque3: { path: b3.path, size: b3.size },
        attemptId,
      });

      // Construimos las URLs relativas para servir via express.static(/uploads).
      const audios = {
        bloque1: `/uploads/audios/${path.basename(b1.path)}`,
        bloque2: `/uploads/audios/${path.basename(b2.path)}`,
        bloque3: `/uploads/audios/${path.basename(b3.path)}`,
      };

      const out = await submitDigitalInterviewAudios(req.session.userId, attemptId, audios);
      res.json(out);
    } catch (e) {
      // Si multer o submitDigitalInterviewAudios fallan, limpiamos los archivos que hayan
      // quedado escritos parcialmente para no dejar basura en el volumen.
      const files = req.files || {};
      for (const field of ['bloque1', 'bloque2', 'bloque3']) {
        const f = files[field]?.[0];
        if (f?.path) {
          fs.unlink(f.path, () => {});
        }
      }
      next(e);
    }
  },
);

export default router;

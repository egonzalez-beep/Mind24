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
    fileSize: 10 * 1024 * 1024,
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
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'attemptId es requerido.';
      throw err;
    }

    const files = req.files || {};
    const b1 = files.bloque1?.[0];
    const b2 = files.bloque2?.[0];
    const b3 = files.bloque3?.[0];
    if (!b1 || !b2 || !b3) {
      const err = new Error('VALIDATION_ERROR');
      err.code = 'VALIDATION_ERROR';
      err.message = 'Se requieren los 3 audios de bloques.';
      throw err;
    }

    const audios = {
      bloque1: `/uploads/audios/${path.basename(b1.filename)}`,
      bloque2: `/uploads/audios/${path.basename(b2.filename)}`,
      bloque3: `/uploads/audios/${path.basename(b3.filename)}`,
    };

    const out = await submitDigitalInterviewAudios(req.session.userId, attemptId, audios);
    res.json(out);
  } catch (e) {
    next(e);
  }
},
);

export default router;


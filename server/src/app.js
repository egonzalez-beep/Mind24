import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import apiRoutes from './routes/index.js';
import { apiSoftLimiter } from './middleware/rateLimit.middleware.js';
import { createTimeclockSessionMiddleware } from './middleware/timeclockSession.middleware.js';
import timeclockPublicRoutes from './routes/timeclock.public.routes.js';
import { errorHandler } from './middleware/error.middleware.js';
import { resolveIndexHtmlPath } from './resolveIndexHtml.js';
import { getUploadStorageMeta, resolveUploadsRootAbs, checkVolumePersistence } from './utils/uploadPaths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlAbs = resolveIndexHtmlPath();
const uploadStorage = getUploadStorageMeta();
const uploadsRootAbs = uploadStorage.uploadsRootAbs;

const PgStore = pgSession(session);

export function createApp() {
  const app = express();
  /** Railway (y otros reverse proxies): debe ir antes de express-rate-limit y sesión. */
  app.set('trust proxy', 1);

  if (env.CLIENT_ORIGINS.length) {
    app.use(
      cors({
        origin: env.CLIENT_ORIGINS,
        credentials: true,
      }),
    );
  }

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '400kb' }));
  fs.mkdirSync(uploadStorage.audiosDirAbs, { recursive: true });
  fs.mkdirSync(path.join(uploadsRootAbs, 'workforce-avatars'), { recursive: true });
  fs.mkdirSync(path.join(uploadsRootAbs, 'workforce-documents'), { recursive: true });
  console.log(
    `[uploads] persistent=${uploadStorage.persistent} source=${uploadStorage.source} root=${uploadsRootAbs} audios=${uploadStorage.audiosDirAbs}`,
  );

  // Verificación de persistencia del volumen. En Railway, si el volumen no está montado,
  // el centinela no sobrevive entre deploys y el log advierte claramente.
  const volCheck = checkVolumePersistence();
  if (!volCheck.writable) {
    console.error(
      '[uploads] ⚠️  CRÍTICO: No se puede escribir en el directorio de audios:',
      uploadStorage.audiosDirAbs,
      '— Los archivos de entrevista digital NO se guardarán.',
    );
  } else if (!volCheck.likelySurvivesRestart) {
    console.warn(
      '[uploads] ⚠️  ADVERTENCIA DE VOLUMEN: El directorio de audios ES escribible pero NO hay evidencia de que sea un volumen persistente.',
      '\n  → Si estás en Railway, monta un volumen en /data (Railway Dashboard → Service → Volumes).',
      '\n  → Establece la variable de entorno AUDIO_UPLOAD_DIR=/data/uploads en el servicio.',
      '\n  → Sentinela escrito en:', volCheck.sentinelPath,
    );
  } else {
    console.log(
      `[uploads] ✅ Volumen persistente confirmado. Centinela previo: ${volCheck.previousTimestamp}. Ruta: ${uploadStorage.audiosDirAbs}`,
    );
  }
  app.use(
    '/uploads/audios',
    express.static(uploadStorage.audiosDirAbs, {
      setHeaders: (res, filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.webm') res.setHeader('Content-Type', 'audio/webm');
        if (ext === '.mp3') res.setHeader('Content-Type', 'audio/mpeg');
        if (ext === '.wav') res.setHeader('Content-Type', 'audio/wav');
        if (ext === '.m4a') res.setHeader('Content-Type', 'audio/mp4');
        if (ext === '.ogg') res.setHeader('Content-Type', 'audio/ogg');
      },
    }),
  );

  const adminSession = session({
    store: new PgStore({
      conString: env.DATABASE_URL,
      createTableIfMissing: false,
    }),
    name: 'mind24.sid',
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: env.TRUST_PROXY,
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
    },
  });

  const timeclockSession = createTimeclockSessionMiddleware();

  app.use('/api/timeclock/public', timeclockSession, timeclockPublicRoutes);

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/timeclock/public')) {
      return next();
    }
    return adminSession(req, res, next);
  });

  app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - t}ms`);
    });
    next();
  });

  app.use('/api', apiSoftLimiter, apiRoutes);

  app.get('/', (_req, res) => {
    res.sendFile(indexHtmlAbs);
  });

  // Alias "login" para soportar redirección post-logout sin 404.
  app.get('/login', (_req, res) => {
    res.sendFile(indexHtmlAbs);
  });

  // Checador remoto: SPA + token en fragmento (#TOKEN). Refresh directo debe servir el HTML.
  app.get('/checador', (_req, res) => {
    res.sendFile(indexHtmlAbs);
  });

  app.use(errorHandler);
  return app;
}

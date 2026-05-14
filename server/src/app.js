import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import apiRoutes from './routes/index.js';
import { apiSoftLimiter } from './middleware/rateLimit.middleware.js';
import { errorHandler } from './middleware/error.middleware.js';
import { resolveIndexHtmlPath } from './resolveIndexHtml.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlAbs = resolveIndexHtmlPath();

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

  app.use(
    session({
      store: new PgStore({
        conString: env.DATABASE_URL,
        createTableIfMissing: false,
      }),
      name: 'mind24.sid',
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      proxy: env.TRUST_PROXY,
      cookie: {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

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

  app.use(errorHandler);
  return app;
}

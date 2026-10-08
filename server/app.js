import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import brandingRoutes from './routes/branding.js';
import appsRoutes from './routes/apps.js';
import backupsRoutes from './routes/backups.js';
import mediaAssetsRoutes from './routes/mediaAssets.js';
import pluginsRoutes from './routes/plugins.js';
import usersRoutes from './routes/users.js';
import groupsRoutes from './routes/groups.js';
import logsRoutes from './routes/logs.js';
import { isPluginSystemEnabled } from './services/branding.js';
import { PLUGIN_ASSET_DIR } from './services/plugins.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Builds the Express app without listening or running startup jobs, so tests
// can create a fresh instance (with fresh rate limiter state) per test.
export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  }));
  app.use(cookieParser());

  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  if (allowedOrigins.length > 0) {
    app.use(cors({
      origin: allowedOrigins,
      credentials: true,
    }));
    console.log(`Frontdoor CORS allowlist loaded: ${allowedOrigins.join(', ')}`);
  }

  // Keep a slightly larger body limit because branding/image uploads are sent as data URLs.
  app.use(express.json({ limit: '5mb' }));
  // Express 5 leaves req.body undefined when no parser ran (e.g. a POST without a
  // JSON content type); keep the Express 4 contract so handlers can destructure it.
  app.use((req, res, next) => {
    if (req.body === undefined) req.body = {};
    next();
  });

  // Rate limits are tunable via env so ops can raise/lower them without a code change.
  // Defaults assume a shared-NAT corporate deployment (hundreds of users behind a
  // single public IP), where a low per-IP limit would lock everyone out on a burst.
  function parsePositiveInt(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  // Auth: SSO init + callback. Defaults: 5000 req / 15 min per IP.
  // Microsoft already rate-limits the upstream OAuth flow; this limiter's only job is cheap DoS mitigation.
  app.use('/api/auth/microsoft', rateLimit({
    windowMs: parsePositiveInt('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    limit: parsePositiveInt('AUTH_RATE_LIMIT_MAX', 5000),
    message: { error: 'Too many login attempts, try again later', code: 'too_many_login_attempts' },
    standardHeaders: true,
    legacyHeaders: false,
  }));

  // RBAC mutation endpoints (POST/PUT/DELETE on groups/users).
  // Defaults: 500 write ops / min per IP, reads always allowed.
  const rbacMutationLimiter = rateLimit({
    windowMs: parsePositiveInt('RBAC_RATE_LIMIT_WINDOW_MS', 60 * 1000),
    limit: parsePositiveInt('RBAC_RATE_LIMIT_MAX', 500),
    message: { error: 'Too many RBAC operations, try again later', code: 'too_many_requests' },
    skip: (req) => req.method === 'GET',
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/groups', rbacMutationLimiter);
  app.use('/api/users', rbacMutationLimiter);

  // General API rate limit. Defaults: 6000 req / min per IP (100 req/s).
  app.use('/api/', rateLimit({
    windowMs: parsePositiveInt('API_RATE_LIMIT_WINDOW_MS', 60 * 1000),
    limit: parsePositiveInt('API_RATE_LIMIT_MAX', 6000),
    standardHeaders: true,
    legacyHeaders: false,
  }));

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API routes
  app.use('/api/plugins/files', (req, res, next) => {
    if (!isPluginSystemEnabled()) {
      return res.status(404).end();
    }
    return express.static(PLUGIN_ASSET_DIR, { dotfiles: 'deny' })(req, res, next);
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/branding', brandingRoutes);
  app.use('/api/apps', appsRoutes);
  app.use('/api/backups', backupsRoutes);
  app.use('/api/media-assets', mediaAssetsRoutes);
  app.use('/api/plugins', pluginsRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/groups', groupsRoutes);
  app.use('/api/logs', logsRoutes);

  // Serve frontend (production)
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath, { dotfiles: 'deny' }));
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });

  app.use((error, req, res, next) => {
    if (error instanceof URIError || error?.name === 'URIError') {
      console.warn(`Frontdoor rejected malformed request path [${req.method} ${req.originalUrl}]: ${error.message}`);
      return res.status(400).end();
    }

    return next(error);
  });

  return app;
}

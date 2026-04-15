import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import authRoutes from './routes/auth.js';
import brandingRoutes from './routes/branding.js';
import appsRoutes from './routes/apps.js';
import usersRoutes from './routes/users.js';
import groupsRoutes from './routes/groups.js';
import logsRoutes from './routes/logs.js';
import { getStartupConfig, validateStartupEnv } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

const startupConfig = getStartupConfig();
const { missing, warnings, errors } = validateStartupEnv();

console.log('Frontdoor startup configuration:');
for (const [key, value] of Object.entries(startupConfig)) {
  console.log(`  ${key}=${value}`);
}

for (const warning of warnings) {
  console.warn(`Frontdoor startup warning: ${warning}`);
}

const startupErrors = [...missing.map((name) => `${name} is missing`), ...errors];
if (startupErrors.length > 0) {
  console.error(`Frontdoor startup error: ${startupErrors.join('; ')}`);
  process.exit(1);
}

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));
app.use(cookieParser());

// Keep a slightly larger body limit because branding/image uploads are sent as data URLs.
app.use(express.json({ limit: '5mb' }));

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
  max: parsePositiveInt('AUTH_RATE_LIMIT_MAX', 5000),
  message: { error: 'Too many login attempts, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
}));

// RBAC mutation endpoints (POST/PUT/DELETE on groups/users).
// Defaults: 500 write ops / min per IP, reads always allowed.
const rbacMutationLimiter = rateLimit({
  windowMs: parsePositiveInt('RBAC_RATE_LIMIT_WINDOW_MS', 60 * 1000),
  max: parsePositiveInt('RBAC_RATE_LIMIT_MAX', 500),
  message: { error: 'Too many RBAC operations, try again later' },
  skip: (req) => req.method === 'GET',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/groups', rbacMutationLimiter);
app.use('/api/users', rbacMutationLimiter);

// General API rate limit. Defaults: 6000 req / min per IP (100 req/s).
app.use('/api/', rateLimit({
  windowMs: parsePositiveInt('API_RATE_LIMIT_WINDOW_MS', 60 * 1000),
  max: parsePositiveInt('API_RATE_LIMIT_MAX', 6000),
  standardHeaders: true,
  legacyHeaders: false,
}));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/branding', brandingRoutes);
app.use('/api/apps', appsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/logs', logsRoutes);

// Serve frontend (production)
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath, { dotfiles: 'deny' }));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Frontdoor running on port ${PORT}`);
});

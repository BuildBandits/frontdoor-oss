import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import authRoutes from './routes/auth.js';
import appsRoutes from './routes/apps.js';
import usersRoutes from './routes/users.js';
import groupsRoutes from './routes/groups.js';
import logsRoutes from './routes/logs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

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
app.use(express.json({ limit: '1mb' }));
// Strict rate limit on auth endpoints (10 requests per 15 min)
app.use('/api/auth/microsoft', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, try again later' },
}));
// Rate limit on RBAC mutation endpoints (POST/PUT/DELETE only, 120 req / 1 min)
const rbacMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many RBAC operations, try again later' },
  skip: (req) => req.method === 'GET',
});
app.use('/api/groups', rbacMutationLimiter);
app.use('/api/users', rbacMutationLimiter);
// General API rate limit
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 100,
}));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
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

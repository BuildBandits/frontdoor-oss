import jwt from 'jsonwebtoken';
import db from '../db.js';

// JWT verification for API routes. Checks Bearer token first, then httpOnly cookie.
export const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies?.frontdoor_token) {
      token = req.cookies.frontdoor_token;
    }

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = db
      .prepare('SELECT id, email, display_name, role, avatar_color FROM users WHERE id = ? AND is_active = 1')
      .get(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(500).json({ error: 'Authentication error' });
  }
};

// Role-based authorization
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

export const ROLE_SUPERADMIN = 'superadmin';
export const ROLE_ADMIN = 'admin';
export const ROLE_ADMIN_READONLY = 'admin_readonly';
export const ROLE_USER = 'user';

export const ADMIN_VIEWER_ROLES = [ROLE_SUPERADMIN, ROLE_ADMIN, ROLE_ADMIN_READONLY];
export const ADMIN_EDITOR_ROLES = [ROLE_SUPERADMIN, ROLE_ADMIN];

export const isSuperAdmin = authorize(ROLE_SUPERADMIN);
export const isAdminViewer = authorize(...ADMIN_VIEWER_ROLES);
export const isAdminEditor = authorize(...ADMIN_EDITOR_ROLES);
export const isAdmin = isAdminEditor;

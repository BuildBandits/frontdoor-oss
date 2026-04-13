import express from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { ConfidentialClientApplication } from '@azure/msal-node';
import db from '../db.js';
import { DEFAULT_GROUP_ID } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { getRequiredEnv } from '../config.js';

const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const authScopes = ['User.Read', 'openid', 'profile', 'email'];

const router = express.Router();

// Microsoft SSO setup
const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
  },
};
const msalClient = process.env.AZURE_CLIENT_ID
  ? new ConfidentialClientApplication(msalConfig)
  : null;

// CSRF state store
const pendingAuthStates = new Map();

// Initiate SSO login
router.get('/microsoft', async (req, res) => {
  if (!msalClient) {
    return res.status(501).json({ error: 'Microsoft SSO not configured' });
  }

  try {
    const state = uuidv4();
    pendingAuthStates.set(state, Date.now());

    // Clean up old states (> 10 min)
    for (const [key, ts] of pendingAuthStates) {
      if (Date.now() - ts > 600000) pendingAuthStates.delete(key);
    }

    const authUrl = await msalClient.getAuthCodeUrl({
      scopes: authScopes,
      redirectUri: process.env.AZURE_REDIRECT_URI,
      state,
    });

    res.redirect(authUrl);
  } catch (error) {
    console.error('SSO initiation error:', error.message);
    const frontendUrl = process.env.FRONTEND_URL || '';
    res.redirect(`${frontendUrl}/login?error=sso_init_failed`);
  }
});

// SSO callback
router.get('/microsoft/callback', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || '';
  const baseDomain = process.env.BASE_DOMAIN || 'frontdoor.local';

  if (!msalClient) {
    return res.redirect(`${frontendUrl}/login?error=sso_not_configured`);
  }

  const { code, state, error: authError } = req.query;

  if (authError) {
    console.error('SSO auth error:', authError);
    return res.redirect(`${frontendUrl}/login?error=sso_denied`);
  }

  if (!state || !pendingAuthStates.has(state)) {
    return res.redirect(`${frontendUrl}/login?error=invalid_state`);
  }
  pendingAuthStates.delete(state);

  try {
    const perUserMsalClient = new ConfidentialClientApplication(msalConfig);

    const tokenResponse = await perUserMsalClient.acquireTokenByCode({
      code,
      scopes: authScopes,
      redirectUri: process.env.AZURE_REDIRECT_URI,
    });

    // Fetch user profile from Microsoft Graph
    const graphResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenResponse.accessToken}` },
    });

    if (!graphResponse.ok) {
      throw new Error(`Graph API error: ${graphResponse.status}`);
    }

    const profile = await graphResponse.json();
    const email = (profile.mail || profile.userPrincipalName).toLowerCase();
    const displayName = profile.displayName || email.split('@')[0];
    const microsoftId = profile.id;

    // Find or create user
    let user = db.prepare('SELECT * FROM users WHERE microsoft_id = ? AND is_active = 1').get(microsoftId);

    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
    }

    if (user) {
      // Existing user (either pre-registered or returning) — update profile
      const shouldPromote = adminEmails.includes(email.toLowerCase()) && user.role !== 'admin';
      db.prepare(
        `UPDATE users SET microsoft_id = ?, display_name = ?, last_login = datetime('now'), updated_at = datetime('now')${shouldPromote ? ", role = 'admin'" : ''} WHERE id = ?`
      ).run(microsoftId, displayName, user.id);
      if (shouldPromote) user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    } else {
      // Brand new user (not pre-registered) — create and add to default group
      const userId = uuidv4();
      const avatarColor = `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;

      const role = adminEmails.includes(email.toLowerCase()) ? 'admin' : 'user';
      db.prepare(`
        INSERT INTO users (id, email, display_name, microsoft_id, role, avatar_color, last_login)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(userId, email, displayName, microsoftId, role, avatarColor);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

      // Auto-add to "default" group only for brand new users (not pre-registered)
      db.prepare('INSERT OR IGNORE INTO user_group_members (user_id, group_id) VALUES (?, ?)').run(userId, DEFAULT_GROUP_ID);
    }

    // Generate JWT (role included so proxied apps can verify authorization)
    const jwtSecret = getRequiredEnv('JWT_SECRET', 'SSO callback');
    const token = jwt.sign(
      { userId: user.id, email: user.email, name: user.display_name, role: user.role },
      jwtSecret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Set httpOnly cookie on wildcard domain for subdomain proxy auth
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('frontdoor_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      domain: `.${baseDomain}`,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    const userData = encodeURIComponent(
      JSON.stringify({
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        avatarColor: user.avatar_color,
      })
    );

    // Token is already set as httpOnly cookie above — only pass user profile data in URL
    res.redirect(`${frontendUrl}/login?sso=ok&user=${userData}`);
  } catch (error) {
    console.error('SSO callback error:', error.message);
    res.redirect(`${frontendUrl}/login?error=sso_failed`);
  }
});

// Get current user
router.get('/me', authenticate, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      displayName: req.user.display_name,
      role: req.user.role,
      avatarColor: req.user.avatar_color,
    },
  });
});

// Logout — clear cookie
router.post('/logout', (req, res) => {
  const baseDomain = process.env.BASE_DOMAIN || 'frontdoor.local';
  res.clearCookie('frontdoor_token', { domain: `.${baseDomain}` });
  res.json({ message: 'Logged out' });
});

export default router;

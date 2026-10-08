import express from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { ConfidentialClientApplication } from '@azure/msal-node';
import db from '../db.js';
import { createPreferenceUpdate } from '../services/userPreferences.js';
import { DEFAULT_GROUP_ID } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { getAppTimeZone, getRequiredEnv, isDevLoginEnabled } from '../config.js';
import { discoverEntraGroupsForUser, getAuthScopes, isEntraGroupSyncEnabled, isEntraUserDeleted, refreshGroupCacheFromTenant, syncUserEntraGroups } from '../services/entraGroups.js';
import { ensureAvatarCached } from '../services/avatars.js';
import { verifySsoTokenChain } from '../services/verifySsoToken.js';
import { dispatchPluginEvent } from '../services/plugins.js';
import { logRbacAudit } from '../db.js';
import { isSupportedLanguage } from '../../shared/languages.js';
import { isSupportedColorScheme, normalizeOptionalColorScheme } from '../../shared/colorSchemes.js';
import { isSupportedTimeZone, normalizeOptionalTimeZone, resolveAppTimeZone } from '../../shared/timeZones.js';

const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const authScopes = getAuthScopes();

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

// CSRF state store — persisted in SQLite so the callback can validate the state
// even when it lands on a different replica than the one that emitted it. TTL is
// enforced at validation time (10 min) and old rows are swept opportunistically
// on each new state insert.
const AUTH_STATE_TTL_MINUTES = 10;
const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const insertAuthState = db.prepare('INSERT INTO auth_pending_states (state) VALUES (?)');
const cleanupAuthStates = db.prepare(
  `DELETE FROM auth_pending_states WHERE datetime(created_at) < datetime('now', '-${AUTH_STATE_TTL_MINUTES} minutes')`
);
const consumeAuthState = db.prepare(
  `DELETE FROM auth_pending_states
   WHERE state = ? AND datetime(created_at) > datetime('now', '-${AUTH_STATE_TTL_MINUTES} minutes')`
);

const parseStoredAppOrder = (value) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string' && id.trim()) : null;
  } catch {
    return null;
  }
};

const parseStoredStringArray = (value) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((item) => typeof item === 'string' && item.trim()))]
      : null;
  } catch {
    return null;
  }
};

const normalizePreferredLanguage = (value) => (
  isSupportedLanguage(value) ? value : null
);

const serializeCurrentUser = (user) => ({
  id: user.id,
  email: user.email,
  displayName: user.display_name,
  role: user.role,
  avatarColor: user.avatar_color,
  homeDesktopView: user.home_desktop_view
    ? (user.home_desktop_view === 'compact' ? 'compact' : 'cards')
    : null,
  preferredLanguage: normalizePreferredLanguage(user.preferred_language),
  preferredTimeZone: normalizeOptionalTimeZone(user.preferred_timezone),
  preferredColorScheme: normalizeOptionalColorScheme(user.preferred_color_scheme),
  appOrder: parseStoredAppOrder(user.app_order),
  appOrderUpdatedAt: user.app_order_updated_at || null,
  favoriteApps: parseStoredStringArray(user.favorite_apps),
  favoriteAppsUpdatedAt: user.favorite_apps_updated_at || null,
  homeTourSeenAt: user.home_tour_seen_at || null,
  lastActivityAt: user.last_activity_at || null,
  timeZone: resolveAppTimeZone(user.preferred_timezone, getAppTimeZone()),
});

// Initiate SSO login.
//
// Optional `?redirect=<app-slug>` query param: stored in a short-lived
// httpOnly cookie so it survives the Microsoft OAuth roundtrip without
// adding noise to the CSRF `state` param. The Login SPA already supports
// `?redirect=<slug>` to deep-link the user to that app subdomain after
// login completes — this just plumbs the value through.
//
// We don't pass `redirect` via Microsoft's `state` because state is also
// our CSRF nonce (UUID looked up in `auth_pending_states`); mixing concerns
// would force every consumer to parse the composite value. Instead we
// bind the cookie value to the state (`<slug>.<stateUuid>`) and verify
// the binding at callback time, which gives us cryptographic single-use
// semantics: any cookie left over from an aborted OAuth flow carries a
// stale state that won't match the next legitimate callback's `req.query.state`.
const SSO_REDIRECT_SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const SSO_REDIRECT_COOKIE = 'frontdoor_sso_redirect';
const SSO_REDIRECT_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/auth',
};

router.get('/microsoft', async (req, res) => {
  if (!msalClient) {
    return res.status(501).json({ error: 'Microsoft SSO not configured', code: 'sso_not_configured' });
  }

  try {
    const state = uuidv4();
    cleanupAuthStates.run();
    insertAuthState.run(state);

    // Cookie binding strategy:
    // - if a valid `?redirect=<slug>` was provided → write `<slug>.<state>` so
    //   only the matching callback (same `state` in query) can consume it.
    // - otherwise → CLEAR any leftover cookie from a previous aborted OAuth
    //   flow. Without this, a user who interrupted a flow (close tab, MFA
    //   timeout) and starts a new one without `?redirect=` would be silently
    //   redirected to the stale target.
    const requestedRedirect = req.query.redirect;
    if (typeof requestedRedirect === 'string' && SSO_REDIRECT_SLUG_RE.test(requestedRedirect)) {
      res.cookie(SSO_REDIRECT_COOKIE, `${requestedRedirect}.${state}`, {
        ...SSO_REDIRECT_COOKIE_OPTS,
        maxAge: 10 * 60 * 1000, // 10 min — covers OAuth roundtrip incl. MFA + buffer
      });
    } else {
      res.clearCookie(SSO_REDIRECT_COOKIE, SSO_REDIRECT_COOKIE_OPTS);
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

  if (!state || consumeAuthState.run(state).changes === 0) {
    return res.redirect(`${frontendUrl}/login?error=invalid_state`);
  }

  try {
    const perUserMsalClient = new ConfidentialClientApplication(msalConfig);

    const tokenResponse = await perUserMsalClient.acquireTokenByCode({
      code,
      scopes: authScopes,
      redirectUri: process.env.AZURE_REDIRECT_URI,
    });

    // The authority is tenant-specific; when the tenant is configured by ID, also
    // check the token's tenant so a misconfigured multi-tenant app cannot sign in outsiders.
    const expectedTenantId = String(process.env.AZURE_TENANT_ID || '').trim().toLowerCase();
    const tokenTenantId = String(tokenResponse.idTokenClaims?.tid || tokenResponse.tenantId || '').toLowerCase();
    if (TENANT_ID_RE.test(expectedTenantId) && tokenTenantId && tokenTenantId !== expectedTenantId) {
      console.warn('Login refused: token issued for another tenant');
      return res.redirect(`${frontendUrl}/login?error=sso_denied`);
    }

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
    let entraGroups = null;
    if (isEntraGroupSyncEnabled()) {
      try {
        const refresh = await refreshGroupCacheFromTenant();
        console.log(`Entra tenant group refresh [${microsoftId}]: ${refresh.discoveredGroups} groups`);
      } catch (error) {
        const hint = error.hint ? ` Hint: ${error.hint}` : '';
        console.warn(`Entra tenant group refresh skipped [${microsoftId}]: ${error.message}.${hint}`);
      }
      try {
        entraGroups = await discoverEntraGroupsForUser(microsoftId);
        console.log(`Entra group discovery [${microsoftId}]: ${entraGroups.length} groups`);
      } catch (error) {
        const hint = error.hint ? ` Hint: ${error.hint}` : '';
        console.warn(`Entra group sync skipped [${microsoftId}]: ${error.message}.${hint}`);
      }
    }

    // Find or create user
    let user = db.prepare('SELECT * FROM users WHERE microsoft_id = ? AND is_active = 1').get(microsoftId);
    let isNewUser = false;

    if (!user) {
      // Link by email only accounts that are not tied to another Microsoft identity
      // yet (pre-registered users), or whose previous identity no longer exists in Entra.
      const byEmail = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
      if (byEmail?.microsoft_id && byEmail.microsoft_id !== microsoftId && !(await isEntraUserDeleted(byEmail.microsoft_id))) {
        console.warn(`Login refused: account [${byEmail.id}] is linked to another Microsoft identity`);
        return res.redirect(`${frontendUrl}/login?error=account_conflict`);
      }
      user = byEmail;
    }

    // A deactivated account (by an admin, or because it was missing from Entra)
    // stays blocked until an admin reactivates it; creating a new one would clash
    // with its email and Microsoft ID.
    if (!user) {
      const disabled = db.prepare('SELECT id FROM users WHERE (microsoft_id = ? OR email = ?) AND is_active = 0').get(microsoftId, email);
      if (disabled) {
        console.warn(`Login refused for deactivated user [${disabled.id}]`);
        return res.redirect(`${frontendUrl}/login?error=account_disabled`);
      }
    }

    if (user) {
      // Existing user (either pre-registered or returning) — update profile
      const shouldPromote = adminEmails.includes(email.toLowerCase()) && user.role !== 'owner';
      db.prepare(
        `UPDATE users SET microsoft_id = ?, display_name = ?, entra_missing_since = NULL, last_login = datetime('now'), last_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      ).run(microsoftId, displayName, user.id);
      if (shouldPromote) {
        db.prepare(`UPDATE users SET role = 'owner', updated_at = datetime('now') WHERE id = ?`).run(user.id);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      }
    } else {
      // Brand new user (not pre-registered) — create and add to default group
      const userId = uuidv4();
      const avatarColor = `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;

      const role = adminEmails.includes(email.toLowerCase()) ? 'owner' : 'user';
      db.prepare(`
        INSERT INTO users (id, email, display_name, microsoft_id, role, avatar_color, last_login, last_activity_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(userId, email, displayName, microsoftId, role, avatarColor);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      isNewUser = true;

      // Auto-add to "default" group only for brand new users (not pre-registered)
      db.prepare('INSERT OR IGNORE INTO user_group_members (user_id, group_id) VALUES (?, ?)').run(userId, DEFAULT_GROUP_ID);
    }

    if (entraGroups) {
      const entraSync = syncUserEntraGroups(user.id, entraGroups);
      if (entraSync.discoveredGroups === 0) {
        console.log(`No Entra groups discovered [${user.id}]; nothing to import yet.`);
      } else {
        console.log(`Discovered ${entraSync.discoveredGroups} Entra groups [${user.id}]; memberships added=${entraSync.membershipsAdded}, removed=${entraSync.membershipsRemoved}.`);
      }
    }

    console.log(`User login via Microsoft [${user.id}]${isNewUser ? ' [new]' : ''}`);

    if (['owner', 'admin', 'admin_readonly'].includes(user.role)) {
      logRbacAudit(user.id, 'login', 'auth', user.id, { role: user.role });
    }

    await ensureAvatarCached(
      { id: user.id, email: user.email, microsoftId: user.microsoft_id },
      tokenResponse.accessToken
    );

    // Generate JWT (role included so proxied apps can verify authorization)
    const jwtSecret = getRequiredEnv('JWT_SECRET', 'SSO callback');
    const token = jwt.sign(
      { userId: user.id, email: user.email, name: user.display_name, role: user.role },
      jwtSecret,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
        issuer: process.env.JWT_ISSUER || 'frontdoor',
      }
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

    void dispatchPluginEvent('auth.login', {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.display_name,
      },
      auth: {
        microsoftId: user.microsoft_id,
        via: 'microsoft',
        isNewUser,
      },
    }, {
      actorId: user.id,
      source: 'auth.microsoft.callback',
    });

    // Token is in httpOnly cookie — no user data in the URL to avoid leaking PII via
    // browser history, server access logs, or Referer headers. The frontend will call
    // /api/auth/me to retrieve the user profile after the redirect.
    //
    // Recover the optional `redirect` slug from the short-lived cookie set by
    // /api/auth/microsoft (Microsoft doesn't propagate custom query params).
    // The cookie value is `<slug>.<stateUuid>`: we accept it only if the embedded
    // state matches the CSRF state we just consumed from `req.query.state`. This
    // gives single-use semantics — stale cookies from aborted flows can't redirect
    // a later, unrelated login. Re-validate slug regex as defense-in-depth.
    const redirectCookie = req.cookies?.[SSO_REDIRECT_COOKIE];
    res.clearCookie(SSO_REDIRECT_COOKIE, SSO_REDIRECT_COOKIE_OPTS);
    let redirectParam = '';
    if (typeof redirectCookie === 'string') {
      const dot = redirectCookie.lastIndexOf('.');
      if (dot > 0) {
        const cookieSlug = redirectCookie.slice(0, dot);
        const cookieState = redirectCookie.slice(dot + 1);
        if (cookieState === state && SSO_REDIRECT_SLUG_RE.test(cookieSlug)) {
          redirectParam = `&redirect=${encodeURIComponent(cookieSlug)}`;
        }
      }
    }
    res.redirect(`${frontendUrl}/login?sso=ok${redirectParam}`);
  } catch (error) {
    console.error('SSO callback error:', error.message);
    res.redirect(`${frontendUrl}/login?error=sso_failed`);
  }
});

// Get current user
router.get('/me', authenticate, (req, res) => {
  res.json({
    user: serializeCurrentUser(req.user),
  });
});

// Record a real Home visit separately from login time.
router.post('/home-activity', authenticate, (req, res) => {
  db.prepare(`
    UPDATE users
    SET last_activity_at = datetime('now')
    WHERE id = ?
      AND (last_activity_at IS NULL OR last_activity_at < datetime('now', '-30 minutes'))
  `).run(req.user.id);

  res.json({ ok: true });
});

router.put('/me/preferences', authenticate, (req, res) => {
  const changes = createPreferenceUpdate();

  if (Object.prototype.hasOwnProperty.call(req.body, 'homeDesktopView')) {
    const { homeDesktopView } = req.body;
    if (homeDesktopView !== null && !['cards', 'compact'].includes(homeDesktopView)) {
      return res.status(400).json({ error: 'homeDesktopView must be cards, compact, or null', code: 'invalid_home_view' });
    }
    changes.set('home_desktop_view', homeDesktopView);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'preferredLanguage')) {
    const { preferredLanguage } = req.body;
    if (preferredLanguage !== null && !isSupportedLanguage(preferredLanguage)) {
      return res.status(400).json({ error: 'preferredLanguage must be a supported language or null', code: 'invalid_language' });
    }
    changes.set('preferred_language', preferredLanguage);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'preferredTimeZone')) {
    const { preferredTimeZone } = req.body;
    if (preferredTimeZone !== null && !isSupportedTimeZone(preferredTimeZone)) {
      return res.status(400).json({ error: 'preferredTimeZone must be a supported time zone or null', code: 'invalid_time_zone' });
    }
    changes.set('preferred_timezone', normalizeOptionalTimeZone(preferredTimeZone));
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'preferredColorScheme')) {
    const { preferredColorScheme } = req.body;
    if (preferredColorScheme !== null && !isSupportedColorScheme(preferredColorScheme)) {
      return res.status(400).json({ error: 'preferredColorScheme must be light, dark, auto, or null', code: 'invalid_color_scheme' });
    }
    changes.set('preferred_color_scheme', preferredColorScheme);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'appOrder')) {
    const { appOrder } = req.body;
    if (appOrder !== null && !Array.isArray(appOrder)) {
      return res.status(400).json({ error: 'appOrder must be an array or null', code: 'invalid_app_order' });
    }
    if (Array.isArray(appOrder)) {
      const normalized = appOrder.filter((id) => typeof id === 'string' && id.trim());
      if (normalized.length > 0) {
        changes.set('app_order', JSON.stringify(normalized), { touch: 'app_order_updated_at' });
      } else {
        changes.set('app_order', null, { touch: 'app_order_updated_at' });
      }
    } else {
      changes.set('app_order', null, { touch: 'app_order_updated_at' });
    }
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'favoriteApps')) {
    const { favoriteApps } = req.body;
    const isLocalStorageMigration = req.body.favoriteAppsMigrationFromLocalStorage === true;
    if (favoriteApps !== null && !Array.isArray(favoriteApps)) {
      return res.status(400).json({ error: 'favoriteApps must be an array or null', code: 'invalid_favorite_apps' });
    }
    if (Array.isArray(favoriteApps)) {
      const normalized = [...new Set(favoriteApps.filter((id) => typeof id === 'string' && id.trim()))];
      if (isLocalStorageMigration && normalized.length > 0) {
        console.info(`[favorites-migration] user=${req.user.id} count=${normalized.length}`);
      }
      changes.set('favorite_apps', JSON.stringify(normalized), { touch: 'favorite_apps_updated_at' });
    } else {
      changes.set('favorite_apps', null, { touch: 'favorite_apps_updated_at' });
    }
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'homeTourSeenAt')) {
    const { homeTourSeenAt } = req.body;
    if (homeTourSeenAt !== null && typeof homeTourSeenAt !== 'string') {
      return res.status(400).json({ error: 'homeTourSeenAt must be a string or null', code: 'invalid_home_tour_seen_at' });
    }
    changes.set('home_tour_seen_at', homeTourSeenAt || null);
  }

  if (changes.size === 0) {
    return res.status(400).json({ error: 'No preference updates provided', code: 'no_preference_updates' });
  }

  changes.apply(db, req.user.id);

  const user = db.prepare('SELECT id, email, display_name, role, avatar_color, home_desktop_view, preferred_language, preferred_timezone, preferred_color_scheme, app_order, app_order_updated_at, favorite_apps, favorite_apps_updated_at, home_tour_seen_at, last_activity_at FROM users WHERE id = ?').get(req.user.id);

  res.json({
    user: serializeCurrentUser(user),
  });
});

// Logout — clear cookie
router.post('/logout', (req, res) => {
  const baseDomain = process.env.BASE_DOMAIN || 'frontdoor.local';
  res.clearCookie('frontdoor_token', { domain: `.${baseDomain}` });
  res.json({ ok: true });
});

// SSO token introspection — RFC 7662-inspired endpoint for satellite apps in
// `mode=redirect` that DON'T share JWT_SECRET with the frontdoor (pattern A.3).
//
// The satellite POSTs a token (just received via /api/apps/:slug/sso-redirect)
// together with the slug it expects the token to be addressed to. The frontdoor
// validates signature, expiration, issuer, audience, user activation and app
// activation, then returns a minimal user payload. Unlike /auth/me this does
// NOT require a session cookie and only accepts SSO short-lived tokens (claim
// `sub`), not long-lived cookie session tokens (claim `userId`).
//
// Single source of truth for what counts as a valid token-for-app pair: do not
// duplicate this chain in satellites by decoding without verifying.
const ssoTokenIntrospectionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  message: { error: 'too_many_requests', code: 'too_many_requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Dev login status — tells the frontend whether the dev login button should be shown.
router.get('/dev-status', (_req, res) => {
  res.json({ devLogin: isDevLoginEnabled() });
});

// Dev login — creates (or reuses) a local dev user and issues a JWT cookie.
// Only available when DEV_LOGIN=true and NODE_ENV !== 'production'.
router.post('/dev-login', (req, res) => {
  if (!isDevLoginEnabled()) {
    return res.status(404).json({ error: 'Dev login is not enabled', code: 'dev_login_disabled' });
  }

  const role = ['owner', 'admin', 'admin_readonly', 'user'].includes(req.body?.role)
    ? req.body.role
    : 'owner';

  const devEmail = `dev-${role}@frontdoor.local`;
  const devDisplayName = `Dev ${role.charAt(0).toUpperCase() + role.slice(1)}`;

  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(devEmail);

  if (!user) {
    const userId = uuidv4();
    const avatarColor = '#6366f1';
    db.prepare(`
      INSERT INTO users (id, email, display_name, role, avatar_color, is_active, last_login, last_activity_at)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).run(userId, devEmail, devDisplayName, role, avatarColor);

    // Add to default group
    db.prepare('INSERT OR IGNORE INTO user_group_members (user_id, group_id) VALUES (?, ?)').run(userId, DEFAULT_GROUP_ID);

    user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  } else {
    // Update role if it changed and refresh last_login
    db.prepare(`UPDATE users SET role = ?, display_name = ?, last_login = datetime('now'), last_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(role, devDisplayName, user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }

  const jwtSecret = process.env.JWT_SECRET;
  const token = jwt.sign(
    { userId: user.id, email: user.email, name: user.display_name, role: user.role },
    jwtSecret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d', issuer: process.env.JWT_ISSUER || 'frontdoor' }
  );

  const baseDomain = process.env.BASE_DOMAIN || 'frontdoor.local';
  res.cookie('frontdoor_token', token, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    domain: baseDomain === 'localhost' ? undefined : `.${baseDomain}`,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  void dispatchPluginEvent('auth.devLogin', {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.display_name,
    },
    auth: {
      via: 'dev-login',
    },
  }, {
    actorId: user.id,
    source: 'auth.dev-login',
  });

  console.log(`User login via dev login [${user.id}] (${role})`);
  res.json({ user: serializeCurrentUser(user) });
});

router.post('/verify-sso-token', ssoTokenIntrospectionLimiter, (req, res) => {
  const jwtSecret = getRequiredEnv('JWT_SECRET', 'SSO token introspection');
  const expectedIssuer = process.env.JWT_ISSUER || 'frontdoor';
  const { token, expected_aud: expectedAud } = req.body || {};
  const { status, body } = verifySsoTokenChain({
    token,
    expectedAud,
    jwtSecret,
    expectedIssuer,
    dbHandle: db,
  });
  res.status(status).json(body);
});

export default router;

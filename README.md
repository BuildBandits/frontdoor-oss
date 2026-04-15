# Frontdoor

Open-source authentication gateway and app catalog. Authenticates users via Microsoft SSO and provides a single entry point to access all your internal applications, with RBAC-based visibility control.

## Architecture

```
                          frontdoor.example.com
                          +-----------------------------+
                          |         FRONTDOOR            |
  User ---- SSO ------>  |  Login + App Catalog          |
                          |  (Express + React + SQLite)  |
                          +----------+------------------+
                                     |
          +--------------------------+-------------------------+
          |                          |                         |
          v                          v                         v
  app1.example.com          app2.example.com          app3.example.com
  +-------------------+    +-------------------+    +-------------------+
  |   Your App 1      |    |   Your App 2      |    |   Your App 3      |
  |  (redirect target)|    |  (redirect target)|    |  (redirect target)|
  +-------------------+    +-------------------+    +-------------------+
```

Each app in the catalog is accessible via its target URL. The gateway handles authentication and provides SSO redirect, shared-cookie, or plain link modes.

## Stack

| Component | Technology |
|-----------|------------|
| Backend | Node.js 22 + Express |
| Frontend | React 18 + Vite + Tailwind CSS |
| Database | SQLite (better-sqlite3) |
| Auth | Microsoft SSO (@azure/msal-node) + JWT |
| State | Zustand |
| Deploy | Docker multi-stage |

## Features

- Microsoft SSO authentication
- App catalog with search, tags, favorites
- Group-by-tag view
- RBAC: groups, per-group app visibility
- RBAC discovery from Microsoft Entra groups at login, with admin import/force-sync flows
- Admin panel: manage apps, users, groups
- Access logs with analytics
- Audit trail for RBAC changes
- App icons support emojis, pasted images, and pasted SVG assets with disk cache
- SSO redirect mode (JWT forwarding to target apps)
- Shared-cookie mode (wildcard domain cookie)
- Plain link mode (simple external redirect)
- Bulk app upsert API (for CI/automation)
- Demo apps are optional and can be restored from the admin panel or with `npm run db:seed`
- Home hero text, company logo, and app visibility badges can be customized from the **Personalizza** admin page

## Quick Start (Node.js)

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example.node .env
# Edit .env with your Azure AD credentials

# 3. Start in dev mode (Vite + Express in parallel)
npm run dev
```

Frontend: http://localhost:5173 | API: http://localhost:3001

## Quick Start (Docker)

```bash
# 1. Configure environment
cp .env.example.docker .env
# Edit .env with your Azure AD credentials

# 2. Build and run
docker compose up --build
```

App: http://localhost:3001

> **Dev vs Docker**: In dev mode, Vite serves the frontend on port 5173 and proxies API calls to Express on 3001. In Docker, Express serves both the built frontend and API on port 3001. The two `.env.example.*` files are pre-configured for each mode.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Express server port | `3001` |
| `DATABASE_PATH` | SQLite file path | `./frontdoor.db` |
| `AVATAR_CACHE_DIR` | Disk cache for user avatars and metadata | `./data/avatar-cache` |
| `APP_ICON_CACHE_DIR` | Disk cache for uploaded app icons and pasted SVG assets | `./data/app-icon-cache` |
| `BRANDING_ASSET_DIR` | Disk storage for the optional company logo | `./data/branding` |
| `AVATAR_CACHE_TTL_DAYS` | Refresh interval for cached Microsoft 365 / Gravatar avatars | `14` |
| `AVATAR_CACHE_MISS_TTL_DAYS` | Retry interval when no avatar was found | `30` |
| `BASE_DOMAIN` | Base domain (no protocol) | `frontdoor.local` |
| `FRONTEND_URL` | Frontend URL with protocol (see `.env.example.*`) | - |
| `AZURE_CLIENT_ID` | Azure AD App Registration Client ID | - |
| `AZURE_CLIENT_SECRET` | Azure AD Client Secret | - |
| `AZURE_TENANT_ID` | Azure AD Tenant ID | - |
| `AZURE_REDIRECT_URI` | SSO callback redirect URI | - |
| `JWT_SECRET` | JWT signing secret | - |
| `ENTRA_GROUP_SYNC` | Discover Entra group memberships at login and enable admin import/force-sync flows | `false` |
| `JWT_EXPIRES_IN` | JWT token duration | `7d` |
| `ADMIN_EMAILS` | Comma-separated admin emails (auto-promoted) | - |
| `ADMIN_API_KEY` | API key for bulk endpoints | - |

#### Production checklist

For a real deployment, set at least:

- `BASE_DOMAIN`
- `FRONTEND_URL`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TENANT_ID`
- `AZURE_REDIRECT_URI`
- `JWT_SECRET`
- `ENTRA_GROUP_SYNC` if you want Entra group sync enabled
Recommended but optional:

- `ADMIN_EMAILS`
- `ADMIN_API_KEY`
- `JWT_EXPIRES_IN`

If one of the required values is missing or malformed, the container now fails fast at startup with a clear log entry instead of surfacing a runtime auth error later.

#### Avatar cache

Frontdoor keeps user avatars on disk inside `AVATAR_CACHE_DIR`. In Docker the recommended target is the shared `/data` volume so cached images survive container restarts.

- Microsoft 365 photos are fetched from Microsoft Graph when users sign in, and can also be prewarmed with the dedicated utility.
- If Microsoft does not expose a photo, Frontdoor falls back to Gravatar and then to the text avatar.
- Cached avatars are refreshed only after the TTL expires, so the UI does not hit Graph on every page load.

To prewarm the avatar cache for existing users, run:

```bash
npm run avatars:prewarm
```

If you want the utility to fetch Microsoft 365 photos for existing users, grant the app the Microsoft Graph application permission `ProfilePhoto.Read.All` and admin consent.

#### Home branding

The home hero text, optional company logo, and app badge visibility are managed from the **Personalizza** page in the admin panel.

- The text fields update the hero copy shown on the home page.
- The logo is uploaded to `BRANDING_ASSET_DIR` and served back from the app.
- If no logo is configured, the home page keeps the current text-only layout.
- The `Mostra badge ext / SSO sulle app` option controls whether app cards show mode badges.

#### App icons

App icons can be entered as:

- emoji or simple text in the icon field
- pasted images copied from your computer or browser
- pasted SVG markup

Uploaded or pasted icon assets are stored on disk inside `APP_ICON_CACHE_DIR` and served by Frontdoor with a long-lived cache. The public URL is versioned by `updated_at`, so browsers refresh the icon only after an admin saves a change.

When you create a new app in the admin panel, you can choose one or more Frontdoor groups to grant visibility immediately. If you do not select any group, the app is created without permissions.

#### Startup logs

On boot, the server prints a redacted config summary such as:

```text
Frontdoor startup configuration:
  NODE_ENV=production
  PORT=3001
  DATABASE_PATH=/data/frontdoor.db
  BRANDING_ASSET_DIR=/data/branding
  BASE_DOMAIN=cerbero.cc
  FRONTEND_URL=https://frontdoor.cerbero.cc
  AZURE_CLIENT_ID=[set]
  AZURE_CLIENT_SECRET=[set]
  AZURE_TENANT_ID=[set]
  AZURE_REDIRECT_URI=https://frontdoor.cerbero.cc/api/auth/microsoft/callback
  JWT_SECRET=[set]
  ADMIN_EMAILS=1 configured
  ENTRA_GROUP_SYNC=true
```

Warnings are emitted for defaults or weak-but-valid settings, for example:

- `BASE_DOMAIN is not set, defaulting to frontdoor.local`
- `JWT_SECRET is shorter than 32 characters; use a longer random secret in production`
If `ENTRA_GROUP_SYNC=true`, Frontdoor discovers the signed-in user's Microsoft Entra group memberships at login, stores them in a discovery cache, and lets admins import only the groups they actually want to use in Frontdoor. In most tenants the standard login scopes are enough for discovery; the admin Force Sync flow uses an app-only Microsoft Graph token, so your app registration must also have the Graph application permissions required to read other users' memberships in your directory.

Important: discovery and import are separate steps. If you delete imported Entra groups from Frontdoor's local database, they will not be recreated automatically as active RBAC groups on the next login. They must first be rediscovered by a successful login or Force Sync, then imported again from the Entra import modal.

### Azure Entra ID (formerly Azure AD) Setup

Frontdoor uses Microsoft Entra ID for SSO authentication via the OAuth 2.0 Authorization Code flow with MSAL.

#### Step 1: Create an App Registration

1. Go to [Azure Portal](https://portal.azure.com) > **Microsoft Entra ID** > **App registrations** > **New registration**
2. **Name:** `Frontdoor` (or any name you prefer)
3. **Supported account types:** Choose based on your needs:
   - *Single tenant* — only users from your organization (most common)
   - *Multitenant* — users from any Azure AD organization
4. **Redirect URI:** Select **Web** and enter:
   - Production: `https://your-domain.com/api/auth/microsoft/callback`
   - Local dev: `http://frontdoor.local:3001/api/auth/microsoft/callback`
5. Click **Register**

#### Step 2: Note the identifiers

From the **Overview** page of your new app registration, copy:
- **Application (client) ID** → `AZURE_CLIENT_ID`
- **Directory (tenant) ID** → `AZURE_TENANT_ID`

#### Step 3: Create a Client Secret

1. Go to **Certificates & secrets** > **Client secrets** > **New client secret**
2. Add a description (e.g., "Frontdoor production") and set expiration
3. Copy the **Value** immediately (it won't be shown again) → `AZURE_CLIENT_SECRET`

#### Step 4: Configure API Permissions

1. Go to **API permissions** > **Add a permission** > **Microsoft Graph** > **Delegated permissions**
2. Add these permissions:
   - `openid` — Sign users in
   - `profile` — Read user profile (display name)
   - `email` — Read user email address
   - `User.Read` — Read signed-in user's basic profile
3. Click **Grant admin consent** (if you're a tenant admin) — otherwise ask your admin

If you want to use **Sincronizza gruppi**, also add the Microsoft Graph **application permission** that allows the app to read other users' group memberships in your tenant, at minimum `User.Read.All`, and grant admin consent. The app uses an app-only token for that action.

#### Step 5: Set environment variables

```bash
AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_SECRET=your-client-secret-value
AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_REDIRECT_URI=https://your-domain.com/api/auth/microsoft/callback
```

#### Security Notes

- The OAuth flow uses PKCE and state parameters for CSRF protection
- Tokens from Microsoft are validated by the MSAL library (signature verification against Azure's public keys)
- The JWT token issued by Frontdoor is stored only in an httpOnly cookie (not accessible to JavaScript)
- User profile data passed to the frontend does not include the token
- The client secret should be rotated periodically and never committed to source control

## API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | No | Health check |
| GET | `/api/auth/microsoft` | No | Initiate SSO flow |
| GET | `/api/auth/microsoft/callback` | No | SSO callback |
| GET | `/api/auth/me` | Bearer | Current user profile |
| POST | `/api/auth/logout` | No | Logout (clear cookie) |
| GET | `/api/branding` | Bearer | Read home branding settings |
| PUT | `/api/branding` | Admin | Update home branding settings |
| GET | `/api/branding/logo` | No | Serve optional company logo |
| GET | `/api/apps` | Bearer | List active apps (RBAC filtered) |
| GET | `/api/apps/all` | Admin | List all apps (including inactive) |
| GET | `/api/apps/:id/icon` | Bearer | Serve a custom app icon asset |
| POST | `/api/apps` | Admin | Create app |
| POST | `/api/apps/restore-defaults` | Admin | Restore the default demo apps |
| PUT | `/api/apps/:id` | Admin | Update app |
| DELETE | `/api/apps/:id` | Admin | Delete app |
| POST | `/api/apps/bulk` | API Key | Bulk upsert apps |
| GET | `/api/users` | Admin | List users |
| PUT | `/api/users/:id/role` | Admin | Change user role |
| PUT | `/api/users/:id/active` | Admin | Activate/deactivate user |
| DELETE | `/api/users/:id` | Admin | Delete user |
| GET | `/api/groups` | Admin | List groups |
| GET | `/api/groups/entra/candidates` | Admin | List discovered Entra groups available for import |
| POST | `/api/groups/entra/import` | Admin | Import selected discovered Entra groups |
| POST | `/api/groups/entra/force-sync` | Admin | Force sync Entra memberships for all linked users |
| POST | `/api/groups/bulk-delete` | Admin | Delete multiple groups at once |
| POST | `/api/groups` | Admin | Create group |
| PUT | `/api/groups/:id` | Admin | Update group |
| DELETE | `/api/groups/:id` | Admin | Delete group |
| POST | `/api/groups/:id/members` | Admin | Add members |
| DELETE | `/api/groups/:id/members/:userId` | Admin | Remove member |
| POST | `/api/groups/:id/apps` | Admin | Assign apps |
| DELETE | `/api/groups/:id/apps/:appId` | Admin | Remove app |
| GET | `/api/logs` | Admin | Access logs (paginated) |
| GET | `/api/logs/top-apps` | Admin | Top apps analytics |
| GET | `/api/logs/rbac-audit` | Admin | RBAC audit logs |

## Database

SQLite with 9 tables:

| Table | Description |
|-------|-------------|
| `users` | Users (auto-created on first SSO login), admin/user roles |
| `apps` | App catalog (slug, target_url, icon, icon_file_name, description, tags) |
| `access_logs` | Proxy access logs (user, app, IP, timestamp) |
| `user_groups` | User groups for RBAC, including imported Entra groups |
| `user_group_members` | Group membership |
| `app_permissions` | Per-group app visibility |
| `entra_group_cache` | Discovered Entra groups available for admin import |
| `entra_user_group_memberships` | Cached Entra memberships per user |
| `rbac_audit_logs` | Audit trail for RBAC mutations |

On first startup with an empty DB, example apps are seeded automatically.

## License

MIT

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
- Admin panel: manage apps, users, groups
- Access logs with analytics
- Audit trail for RBAC changes
- SSO redirect mode (JWT forwarding to target apps)
- Shared-cookie mode (wildcard domain cookie)
- Plain link mode (simple external redirect)
- Bulk app upsert API (for CI/automation)
- Pre-register users by email before first login

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Azure AD credentials and domain settings

# 3. (Optional) Add to /etc/hosts for local subdomain testing:
# 127.0.0.1 frontdoor.local demo.frontdoor.local dashboard.frontdoor.local

# 4. Start in dev mode (Vite + Express in parallel)
npm run dev

# 5. Manual database seed (optional, server auto-seeds on first run)
npm run db:seed
```

## Docker

```bash
# Build and run locally
docker compose up --build

# Or standalone
docker build -t frontdoor .
docker run -p 3001:3001 --env-file .env frontdoor
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Express server port | `3001` |
| `DATABASE_PATH` | SQLite file path | `./frontdoor.db` |
| `BASE_DOMAIN` | Base domain (no protocol) | `frontdoor.local` |
| `FRONTEND_URL` | Frontend URL with protocol | `http://frontdoor.local:5173` |
| `AZURE_CLIENT_ID` | Azure AD App Registration Client ID | - |
| `AZURE_CLIENT_SECRET` | Azure AD Client Secret | - |
| `AZURE_TENANT_ID` | Azure AD Tenant ID | - |
| `AZURE_REDIRECT_URI` | SSO callback redirect URI | - |
| `JWT_SECRET` | JWT signing secret | - |
| `JWT_EXPIRES_IN` | JWT token duration | `7d` |
| `ADMIN_EMAILS` | Comma-separated admin emails (auto-promoted) | - |
| `ADMIN_API_KEY` | API key for bulk endpoints | - |

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
| GET | `/api/apps` | Bearer | List active apps (RBAC filtered) |
| GET | `/api/apps/all` | Admin | List all apps (including inactive) |
| POST | `/api/apps` | Admin | Create app |
| PUT | `/api/apps/:id` | Admin | Update app |
| DELETE | `/api/apps/:id` | Admin | Delete app |
| POST | `/api/apps/bulk` | API Key | Bulk upsert apps |
| GET | `/api/users` | Admin | List users |
| POST | `/api/users` | Admin | Pre-register user |
| PUT | `/api/users/:id/role` | Admin | Change user role |
| PUT | `/api/users/:id/active` | Admin | Activate/deactivate user |
| DELETE | `/api/users/:id` | Admin | Delete user |
| GET | `/api/groups` | Admin | List groups |
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

SQLite with 7 tables:

| Table | Description |
|-------|-------------|
| `users` | Users (auto-created on first SSO login), admin/user roles |
| `apps` | App catalog (slug, target_url, icon, description, tags) |
| `access_logs` | Proxy access logs (user, app, IP, timestamp) |
| `user_groups` | User groups for RBAC |
| `user_group_members` | Group membership |
| `app_permissions` | Per-group app visibility |
| `rbac_audit_logs` | Audit trail for RBAC mutations |

On first startup with an empty DB, example apps are seeded automatically.

## License

MIT

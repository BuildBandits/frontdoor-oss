# Changelog

All notable changes to this project will be documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [1.0.0] — 2026-04-11

### Added
- Authentication gateway with Microsoft SSO (@azure/msal-node)
- App catalog with search, tags, favorites, group-by-tag view
- RBAC system: user groups with per-group app visibility
- Three app modes: redirect (SSO JWT), shared-cookie (wildcard domain), redirect-plain (external link)
- Admin panel: manage apps, users, groups
- User pre-registration by email (before first SSO login)
- Access logs with pagination and analytics (top apps, unique users)
- RBAC audit trail logging
- Bulk app upsert API (for CI/automation, API key auth)
- Auto-seed example apps on first startup
- Docker multi-stage build
- Rate limiting on auth and API endpoints
- Security hardening: helmet, CSP, httpOnly cookies, SSRF protection, parameterized SQL
- RBAC unit tests (node:test + node:sqlite)

---

## Roadmap

- [ ] Support for additional SSO providers (Google, SAML)
- [ ] App health check monitoring
- [ ] User self-service profile page
- [ ] Dark mode
- [ ] i18n support

# oss-frontdoor — Project Instructions

## Changelog
- **REQUIRED**: update `CHANGELOG.md` on every significant change (new features, fixes, breaking changes)
- Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- Sections: Added, Changed, Deprecated, Removed, Fixed, Security
- Roadmap is at the bottom of CHANGELOG.md, not in README

## Stack
- Backend: Node.js 26 LTS + Express 5 + SQLite (better-sqlite3)
- Frontend: React 19 + React Router 8 + Vite 8 + Tailwind CSS 4 + Zustand 5
- Auth: Microsoft SSO (@azure/msal-node) + JWT (cookie httpOnly)
- Deploy: Docker multi-stage
- Runtime: Docker image on Node.js 26 LTS (`NODE_IMAGE` in `Dockerfile`, exact patch tag); running from source supports Node.js 24 (until its end of life, April 2028) and 26 (`engines`), and CI tests both

## Releases
- **Before every release or Docker build**, check the latest Node.js security releases (https://nodejs.org/dist/index.json, `security: true`) for every supported line. If a newer patch exists, update `NODE_IMAGE` in `Dockerfile` (exact `node:X.Y.Z-bookworm-slim` tag, verified on Docker Hub), the `engines` minimums in `package.json` and `package-lock.json`, and mention it in the CHANGELOG `Security` section before tagging.

## Conventions
- Commit messages in English, concise
- Never commit real credentials (.env.example with placeholders only)
- User HTML always sanitized with DOMPurify (frontend)
- SQL queries always parameterized (never string concatenation)
- Logs: never PII (emails, names) in console.log/error

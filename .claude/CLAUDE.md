# oss-frontdoor — Project Instructions

## Changelog
- **REQUIRED**: update `CHANGELOG.md` on every significant change (new features, fixes, breaking changes)
- Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- Sections: Added, Changed, Deprecated, Removed, Fixed, Security
- Roadmap is at the bottom of CHANGELOG.md, not in README

## Stack
- Backend: Node.js 24 + Express + SQLite (better-sqlite3)
- Frontend: React 18 + Vite + Tailwind CSS + Zustand
- Auth: Microsoft SSO (@azure/msal-node) + JWT (cookie httpOnly)
- Deploy: Docker multi-stage

## Conventions
- Commit messages in English, concise
- Never commit real credentials (.env.example with placeholders only)
- User HTML always sanitized with DOMPurify (frontend)
- SQL queries always parameterized (never string concatenation)
- Logs: never PII (emails, names) in console.log/error

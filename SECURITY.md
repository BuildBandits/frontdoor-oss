# Security Policy

Frontdoor sits in front of internal applications and handles authentication. We take security reports seriously.

## Supported versions

| Version | Supported |
|---------|-----------|
| `1.x` (current `main`) | Yes |
| Older releases | No — please upgrade |

We currently support only the latest minor release on `main`. There are no LTS branches.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Send a private report to:

Use GitHub's private vulnerability reporting: on the repository page open **Security → Report a vulnerability**. If that option is not available, contact a maintainer directly through GitHub and ask for a private channel.

Include in your report:

- A description of the issue and the impact you observed.
- Steps to reproduce, or a minimal proof of concept.
- The affected version or commit SHA.
- Your assessment of severity, if you have one.

If you prefer encrypted communication, request a PGP key in your first message.

## What to expect

| Stage | Target |
|-------|--------|
| Acknowledgement of report | within **72 hours** |
| Initial severity assessment | within **7 days** |
| Fix for critical issues | within **30 days** of confirmation |
| Coordinated public disclosure | after a fix is released, or by mutual agreement |

We will keep you informed throughout the process. If we determine the report is not a security issue, we will explain why and, if relevant, redirect it to the regular issue tracker.

## Disclosure

We follow coordinated disclosure. Once a fix is released, we publish a brief advisory describing the issue, affected versions, and the fix. Reporters are credited unless they prefer to remain anonymous.

## Scope

In scope:

- The Frontdoor server (`server/`) and frontend (`src/`).
- Default Docker image and deployment configuration.
- Authentication, authorization, RBAC, and audit-log handling.
- HTML sanitization paths and input validation.

Out of scope:

- Issues that require physical access to the server.
- Self-XSS that requires the victim to paste attacker-controlled content into devtools.
- Vulnerabilities in third-party dependencies that are already publicly tracked and pending an upstream fix — we still want to know, but they will be handled as regular dependency updates.
- Findings limited to the development environment (e.g. dev-only npm dependencies flagged by `npm audit` with no production exposure).

## Security audit log

Substantial security work on Frontdoor — formal audits, large hardening passes, post-incident reviews — is recorded in the [`security/`](security/) folder as a dated markdown file (`security-audit-YYYYMMDD.md` or `security-incident-YYYYMMDD-<slug>.md`). Each file should capture, at minimum:

- Date, scope, and trigger of the work (scheduled audit, pre-release pass, response to a report).
- Findings with severity, current status (fixed / mitigated / accepted / open), and the commit SHAs that resolve them.
- What was verified empirically vs. what was reasoned statically.
- Open items left to follow-up, so the next audit has a clear starting point.

Small, day-to-day security fixes do not need a dedicated file — a clear commit message under `Security` in `CHANGELOG.md` is enough. The `security/` folder is for work whose scope spans multiple files or commits and is worth being able to point to as a single artifact.

## Safe-harbor

Good-faith security research aligned with this policy will not be pursued legally. Please:

- Avoid degrading service for other users.
- Avoid accessing, modifying, or exfiltrating data that is not your own.
- Give us reasonable time to fix the issue before public disclosure.

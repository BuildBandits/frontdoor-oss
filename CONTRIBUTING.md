# Contributing to Frontdoor

Thanks for your interest in contributing. This document covers the basics: how to get set up, how to propose a change, and the rules every contribution must follow.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

The full quick-start (Node and Docker paths) lives in the [README](README.md#quick-start-nodejs). In short:

```bash
npm install
cp .env.example.node .env   # fill in Azure AD credentials, or use DEV_LOGIN mode
npm run dev
```

For local work without Azure SSO, set `DEV_LOGIN=true` in `.env`.

## Branch and PR workflow

1. Fork the repository and create a topic branch off `main` (e.g. `feat/group-import-filter`, `fix/audit-pagination`).
2. Make focused commits. One logical change per PR keeps review tractable.
3. Open a pull request against `main`. Fill in the PR template — including the **DCO sign-off** check.
4. A maintainer will review. Address feedback by pushing new commits to the same branch (no force-push during review).
5. Once approved, a maintainer merges. Squash is the default merge strategy.

## Developer Certificate of Origin (DCO)

This project uses the [Developer Certificate of Origin](https://developercertificate.org/). Every commit must carry a `Signed-off-by` trailer asserting that you have the right to contribute the code under the project license.

Sign your commits with `-s`:

```bash
git commit -s -m "fix: handle empty group on RBAC resolve"
```

This appends a trailer to the commit message:

```text
Signed-off-by: Your Name <you@example.com>
```

The name and email must match your real identity and be reachable. PRs containing commits without a valid sign-off will be asked to amend before merge.

Forgot the flag? Re-sign existing commits with:

```bash
git rebase --signoff main
```

## Commit messages

- Written in English, concise, imperative mood (`fix: …`, `feat: …`, `refactor: …`).
- One short subject line. Body only if the *why* is non-obvious.
- Reference issues by number when applicable.

## Changelog

Every PR that introduces a user-visible change **must** update `CHANGELOG.md` under `[Unreleased]`, in the appropriate section (`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`). Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Internal refactors with no behavior change do not need a changelog entry.

## Code conventions

- **HTML rendered from user input** must go through DOMPurify on the frontend. No exceptions.
- **SQL queries** must be parameterized. Never concatenate strings into SQL.
- **Logs** must not contain PII (emails, names, tokens). Redact before `console.log`.
- **Secrets** never get committed. Use `.env.example.*` placeholders only.

## Testing

Run the same checks as CI before opening a PR:

```bash
npm run lint
npm test
npm run check:i18n
npm run build
```

`npm run lint` must report no errors; warnings are allowed but avoid adding new ones.

If you add a new endpoint or RBAC path, add coverage. Integration tests that touch SQLite are preferred over mocks for anything that crosses the persistence layer.

## Reporting bugs and requesting features

- **Bugs**: open an issue using the *Bug report* template.
- **Feature ideas**: open a *Feature request* issue or start a thread in Discussions.
- **Security vulnerabilities**: do **not** open a public issue. See [SECURITY.md](SECURITY.md).

## Questions

For general questions or design discussion, use GitHub Discussions on the repository.

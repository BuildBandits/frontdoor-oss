# Frontdoor

**Your apps, all in one place.**

Frontdoor is a self-hosted, open-source homepage for the internal tools your team uses every day. Sign in once with Microsoft SSO, see exactly the apps you are authorized to use, and launch them in one click — no juggling bookmarks, no "which subdomain was it?", no stale sessions. Admins manage who sees what through groups and per-group visibility, and can tailor the homepage's look and branding from the UI.

Built for IT teams who got tired of intranet wikis full of half-broken links.

![Frontdoor home page](docs/screenshot-home.png)

**Documentation:** [frontdoor.buildbandits.com/docs](https://frontdoor.buildbandits.com/docs/) ([italiano](https://frontdoor.buildbandits.com/it/docs/)). [FEATURES.md](FEATURES.md) is the full capability map.

## Quick start

### Local demo with Docker (no Microsoft Entra)

```bash
docker compose -f docker-compose.demo.yml up --build
```

Open http://localhost:3001 and use the **Dev Login** panel to sign in as `owner`, `admin`, `admin_readonly` or `user`. Dev Login lets anyone pick any role, so never expose the demo to a network. Remove it with `docker compose -f docker-compose.demo.yml down -v`.

### From source with Node.js 24

```bash
npm install
cp .env.example.node .env   # DEV_LOGIN=true is already set: no Entra registration needed
npm run dev
```

Frontend: http://localhost:5173 | API: http://localhost:3001

### Deploy with Docker

```bash
cp .env.example.docker .env   # fill in your Microsoft Entra and domain settings
docker compose up -d --build
```

Prebuilt images are published to GitHub Container Registry for every release: `ghcr.io/buildbandits/frontdoor-oss:latest`, `:X.Y.Z` and `:X.Y`, plus `:dev` from `main`.

See [Install with Docker](https://frontdoor.buildbandits.com/docs/operators/docker/) and [Microsoft Entra setup](https://frontdoor.buildbandits.com/docs/operators/entra/) for a real deployment.

## Stack

Node.js 24 LTS and Express 5 on the backend, React 19 with React Router, Vite and Tailwind CSS 4 on the frontend, SQLite through better-sqlite3, Microsoft SSO with `@azure/msal-node` plus JWT sessions, and a multi-stage Docker image based on `node:24-bookworm-slim`.

## Documentation

| Topic | Page |
|-------|------|
| Installation | [Docker](https://frontdoor.buildbandits.com/docs/operators/docker/), [Node.js and the local demo](https://frontdoor.buildbandits.com/docs/operators/nodejs/) |
| Configuration and environment variables | [Configuration reference](https://frontdoor.buildbandits.com/docs/operators/configuration/) |
| Microsoft Entra | [Microsoft Entra setup](https://frontdoor.buildbandits.com/docs/operators/entra/) |
| Upgrades | [Upgrade and rollback](https://frontdoor.buildbandits.com/docs/operators/upgrade/) |
| Security | [Security notes](https://frontdoor.buildbandits.com/docs/operators/security/) |
| API | [API reference](https://frontdoor.buildbandits.com/docs/integrators/api/) |
| Satellite apps | [Authentication for satellite apps](https://frontdoor.buildbandits.com/docs/integrators/satellite-auth/) |
| Plugins | [Plugins](https://frontdoor.buildbandits.com/docs/integrators/plugins/) (locked off in current releases) |
| Admin guide | [Apps](https://frontdoor.buildbandits.com/docs/admins/apps/), [groups](https://frontdoor.buildbandits.com/docs/admins/groups/), [users](https://frontdoor.buildbandits.com/docs/admins/users/), [customization](https://frontdoor.buildbandits.com/docs/admins/customization/), [logs](https://frontdoor.buildbandits.com/docs/admins/logs/), [backup](https://frontdoor.buildbandits.com/docs/admins/backup/) |

The documentation sources live in [BuildBandits/frontdoor.buildbandits.com](https://github.com/BuildBandits/frontdoor.buildbandits.com). See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, the checks to run, the pull-request workflow and the **DCO sign-off** requirement. Project governance is in [GOVERNANCE.md](GOVERNANCE.md), and all participants are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Do not open a public GitHub issue for security findings.

## License and trademark

MIT — see [LICENSE](LICENSE). The license covers the source code; it does not grant rights to use the **Frontdoor™** name, logo or brand identity. See [TRADEMARK.md](TRADEMARK.md).

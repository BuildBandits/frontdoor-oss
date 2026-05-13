# Governance

FrontDoor is an open-source project maintained by its original authors. This document describes who decides what, how decisions are made, and how the project is released.

## Maintainers

FrontDoor is co-maintained by its two original authors. Up-to-date names and GitHub handles are listed in [MAINTAINERS.md](MAINTAINERS.md).

A maintainer's responsibilities:

- Review and merge pull requests.
- Triage issues and Discussions.
- Cut releases and tag them.
- Steward the project's direction and roadmap.
- Enforce the [Code of Conduct](CODE_OF_CONDUCT.md).

## Decision process

| Change type | Required approvals |
|-------------|-------------------|
| Documentation, small fixes, internal refactors | 1 maintainer |
| New feature, new endpoint, dependency change | 1 maintainer |
| Architectural change, breaking change, license/governance change | **Both maintainers** |

When maintainers disagree, the discussion moves to a public issue or Discussion thread. A decision is taken explicitly and recorded in the relevant PR or issue.

## Proposing changes

1. **Small change or bug fix** — open a PR directly. Reference the issue if one exists.
2. **Larger feature** — open an issue or Discussion first. Outline the problem, the proposal, and alternatives considered. Once a maintainer signs off on the direction, send the PR.
3. **Roadmap-level idea** — open a Discussion under the *Ideas* category. Maintainers periodically promote selected ideas to actual issues or milestones.

Contribution mechanics (DCO, branching, PR template) are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Releases

- Versioning follows [Semantic Versioning](https://semver.org/).
- Releases are cut from `main` and tagged (`vX.Y.Z`). Tags are GPG-signed once the project's permanent repository home is set up.
- Each release is paired with an entry in [CHANGELOG.md](CHANGELOG.md) (Keep a Changelog format).
- There is no fixed release cadence. Releases are cut when meaningful work has accumulated and the `main` branch is stable.

## Commercial use

FrontDoor is MIT-licensed (see [LICENSE](LICENSE)). The license places no restriction on commercial use of the source code.

In addition:

- Organizations are free to self-host FrontDoor without contacting the maintainers.
- The maintainers may offer paid support, installation, hosting, and custom integrations to third parties. These offerings are operated under a separate commercial entity and are not a condition for using the project.
- Use of the **FrontDoor™** name and brand is governed separately by [TRADEMARK.md](TRADEMARK.md). The MIT license does not grant trademark rights.

## Adding or removing maintainers

A new maintainer is added by unanimous agreement of the existing maintainers, typically after a sustained track record of substantial contributions. The change is recorded by updating [MAINTAINERS.md](MAINTAINERS.md) in a PR.

A maintainer may step down at any time. Inactive maintainers (no review or commit activity for 12 months) may be moved to emeritus status by the remaining active maintainers.

## Conflicts of interest

Maintainers disclose any commercial or organizational relationship that materially affects a decision under review. When in doubt, defer to the other maintainer.

## Changes to this document

Changes to `GOVERNANCE.md`, the licensing model, or the trademark policy require approval from **both** maintainers and a clear PR description explaining the motivation.

# Lessons

User corrections and the rule that prevents each recurring. Re-read at session start.

<!-- Format: date — what went wrong — why — rule ("before Y, check Z") -->

2026-11-11 — Planned ADR 0007 for retiring `ADMIN_API_KEY`, a decision that belongs to
the maintainers — ADRs are still being introduced to them (ADR 0001 is in #172, not on
`main`), so a further maintainer-level ADR front-loads process they have not adopted —
rule: before proposing an ADR for a decision outside the author's own feature, check
that `docs/adr/0001-*` is on `main`; if not, record the decision as an open question
in the roadmap instead.

2026-11-11 — A local OAuth check reused the callback port 8765 from an earlier
check; in the browser that origin belonged to another project's PWA, whose
service worker received the authorization code — a port with no listening
process can still be answered by a service worker registered for that origin —
rule: before using a loopback redirect URI in a browser check, pick a port that
`lsof` shows free AND that was never used for another local site (none in
`docs/**/reviews`, none in other projects' dev configs); record the port in the
review note.

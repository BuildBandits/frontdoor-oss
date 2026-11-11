# Review round 1 — replies to lombax85

Drafts. Posted only after the author approves the text. Each one is a reply in
the thread of the comment it answers.

## #167 — Scope naming

> Thanks, agreed. Since nothing has reached production yet, we went with the
> second option and made it a choice the user actually gets
> (ADR 0006, proposed in #172 as 3ca44d4):
>
> - `frontdoor.read` is now strictly read-only;
> - `set_favorite_app`, `set_color_scheme` and `set_language` need a new
>   `frontdoor.preferences` scope;
> - on the consent page that scope is a checkbox, ticked by default. Many
>   clients request every scope in `scopes_supported`, so a split the user
>   could not act on would stay theoretical. Unticking it connects the
>   assistant read-only, and the three tools are then not even listed.
>
> The token response states the granted scopes, refresh cannot widen them, and
> reconnecting the same assistant replaces the earlier choice. `/assistants`
> shows each connection as "read only" or "can change your preferences".
> Spec §4 rule 15 and the tool table are updated, as are the consent wording
> and `docs/mcp.md`.
>
> Code in f0b5dda, tests in `test/mcpScopes.test.js`. The browser and `curl`
> check is in `docs/design/mcp/reviews/2026-11-11-e2e-scopes.md`.

## #167 — Result completeness

> Good catch, fixed rather than deferred (ca49053). `search_my_apps`,
> `list_apps` and `list_groups` now return `total` and `hasMore`. While more
> items exist, they also return a `nextCursor` to pass back with the same
> arguments.
>
> - The cursor is an opaque offset bound to the tool and its filters. Reused
>   with other arguments or malformed, it is a tool error, never a silent
>   restart from the first page. A cursor past the end, because items were
>   removed meanwhile, is an empty last page.
> - Ordering is now total (a slug/id tie-breaker after the existing order), so
>   offsets are deterministic.
> - The descriptions tell the assistant to follow `nextCursor` before calling a
>   list complete, and the "every app in the catalogue" wording is gone.
>
> Tests use 205+ items: the default and maximum limits of all three tools, a
> filter across pages, and cursors crossed between queries and tools. The fail-closed
> projection test caught the new envelope fields; they are now declared as
> `PAGING_FIELDS` in the mediation layer. Spec §7 updated in #172 (b8a894d).

## #172 — Future of the API-key bulk endpoints

> Agreed on the direction, and agreed that nothing should be removed in #167.
>
> One refinement: I don't think MCP can be the whole replacement. MCP fits the
> *interactive* catalogue work an admin does. Phase 2 applies writes only after
> a person confirms on a Frontdoor page (ADR 0005), so it cannot serve
> unattended server-to-server sync, as you note. That case would need a
> credential of its own, such as per-integration, revocable, scoped tokens on
> the regular API.
>
> I recorded this as an open question rather than a decision (e775013).
> `03-roadmap.md` now has a section listing what the endpoints do today and the
> gaps you listed. It also sets out the order you suggested: decision, then the
> replacement workflows, then a migration guide, then removal of the routes,
> the guard and `ADMIN_API_KEY` in a documented breaking release. The "Never via
> MCP" line in the phase 2 spec now points to it, and the CHANGELOG roadmap has
> an entry. Once the ADR practice from this PR is adopted, it can become a
> proper decision record.

# 04 Community and moderation: design

Design by the Opus architect. One correction: the proposed `visibility_alignment` migration for `merge_context` is not needed. The merge source must be on a published site and the ancestor lives on the same site and baseline, so the ancestor classification cannot reach an unpublished site.

## Decisions

- All reads go through RPCs. `anon` and `authenticated` have no table privileges on `comments`, `supports`, `reports`, `moderation_events`, `rate_limits`, or `rate_windows`; RLS is on with no policies.
- Author alias is read live from `profiles` (a pinned alias could be reused and sign someone else's comment).
- Withdrawing support deletes the row; support is current state, not history.
- Fixed one-hour rate windows via `date_bin`, one upserted row per bucket. A burst of up to 2x at a bucket edge is accepted.
- The support count lives in a separate summary RPC, so `publicPublicationSchema` stays strict and unchanged.
- Comments are not exported in v1 (FT-15 does not include them). If Spec 05 adds them, they must pass through `src/lib/format` formula neutralization.
- Comments reuse the enum `publication_moderation_state`.

## Schema

- Enums: `report_reason` (spam, harassment, misinformation, privacy, other), `report_state` (open, actioned, dismissed), `moderation_target_kind` (publication, comment), `moderation_action` (hide, restore, dismiss).
- `plain_text_ok(text)`: trimmed with JavaScript `trim` parity and no C0/C1 control characters except newline, no bidi override characters. Routes normalize CRLF to LF.
- `comments`: `publication_id` and `revision_id` with composite FK to `publications (id, revision_id)`; optional `feature_id` with composite FK `(revision_id, feature_id)` to `revision_features`; body 1 to 1000; `moderation_state`; `retracted_at`; `unique (id, publication_id)`. Trigger: only `moderation_state` and `retracted_at` (null to value, once) may change; delete and truncate raise `55000`.
- `supports`: primary key `(publication_id, user_id)`.
- `reports`: target kind with publication id and optional comment id; reporter; reason; note (1 to 500); state; resolution columns; partial unique indexes for one open report per reporter and target; only `open` to `actioned` or `dismissed`, resolution columns only; no delete.
- `moderation_events`: append-only (`55000` on update, delete, truncate); `reason` visible to the content author on hide and restore, `private_note` visible only to moderators.
- Trigger: `site_id` of reports and events must equal the site of the publication's revision.
- `rate_limits(action, max_count, window_seconds)`: comment 10/3600, report 10/3600, support 60/3600. `rate_windows(actor_id, action, window_start, count)`.

## Rate limit function

`rate_limit_consume(actor, action, now)` is internal: one `INSERT ... ON CONFLICT DO UPDATE ... WHERE count < max` statement; no returned row means `FT429` with the seconds to the next bucket in `detail`. It runs after validation, replay, and deduplication, so replays, duplicate reports, and no-op supports never consume. Public RPCs pass the server `now()`; no client-controlled clock exists. pgTAP calls the function as `postgres` with a fixed `p_now` for boundary cases.

## RPCs (all SECURITY DEFINER, empty search_path)

Mutation order: auth and input, advisory lock on the key, replay, row locks (publication then comment), visibility and permission, deduplication, rate limit, write, ledger.

- Participant: `create_comment`, `retract_comment`, `set_support(publication, bool)`, `create_report`, `my_support_state`, `list_my_moderation_notices`.
- Public (anon and authenticated): `list_public_comments` (keyset cursor `(created_at, id)`, limit 1 to 50, alias, anchor label), `get_public_community_summary` (`supportCount`, `commentCount`).
- Moderator: `list_open_reports(site)`, `get_moderation_target(kind, id)` (moderators read hidden content directly; no snapshot copies), `moderate_target(kind, id, hide|restore, reason, private_note, report_id, key, hash)`, `resolve_report(report, dismissed|actioned, note, event_id, key, hash)`.
- Authorization: moderator of the site derived from the target, never from a client-supplied site. A non-moderator, a moderator of another site, or a missing target all raise `P0002` (404). Authorization is checked before any row lock is taken.
- `moderate_target` on a publication takes `FOR NO KEY UPDATE` on the publication, which conflicts with the `FOR SHARE` of fork, merge, and comments; after the other transaction commits, its `WHERE` is re-evaluated and sees `hidden`. On a comment: publication `FOR SHARE`, then comment `FOR NO KEY UPDATE`.
- Same state requested: `FT409 moderation_state_unchanged`. Report of another target: `FT422 report_mismatch`. Resolved report: `FT409 report_already_resolved`.
- Idempotency ledger (`mutation_requests`): `create_comment`, `create_report`, `moderate_target`, `resolve_report`. Naturally idempotent: `set_support`, `retract_comment`.

## HTTP

All responses are `no-store`. PUT and DELETE without a body use a new `readMutationOrigin` guard (origin only).

| Route | Success | Errors |
|---|---|---|
| `GET /api/v1/publications/:id/comments?cursor=&limit=` | 200 | 400 `invalid_cursor`, 404 |
| `POST /api/v1/publications/:id/comments` | 201 | 401, 404, 409, 422 `invalid_comment` / `invalid_anchor`, 429 |
| `DELETE /api/v1/comments/:id` | 200 | 401, 404 |
| `GET /api/v1/publications/:id/support` | 200 `{count, supported}` | 404 |
| `PUT` / `DELETE /api/v1/publications/:id/support` | 200 | 401, 404, 429 |
| `POST /api/v1/reports` | 201 new, 200 duplicate | 401, 404, 409, 422, 429 |
| `GET /api/v1/moderation/reports?site=` | 200 | 401, 404 |
| `GET /api/v1/moderation/targets/:kind/:id` | 200 | 401, 404 |
| `POST /api/v1/moderation/actions` | 201 | 401, 404, 409, 422 |
| `POST /api/v1/reports/:id/resolve` | 200 | 401, 404, 409, 422 |

429 carries `Retry-After` and `details.retryAfterSeconds`. The cursor is base64url of `createdAt|id` and is treated as opaque text so microseconds survive.

## UI

- `src/features/community/` adds a community section to the publication page: summary, support toggle, paginated comment list with anchor labels, comment form, report controls; server actions follow the fork pattern.
- `/[locale]/moderation`: assigned sites, open reports with preview and link, hide and restore with required reason; states loading, empty, signed out, insufficient permission, recoverable error.
- `src/proxy.ts` calls `updateSession` when the publication gate lets a request through, so signed-in users keep their session on public pages.

## Hidden-content effects

Already filtering `moderation_state = 'visible'`: `get_public_publication`, `public_publication_exists` (also feeds the Proxy gate and `get_branch_head.sourceVisible`), `resolve_snapshot_ref` (so compare and analysis), `fork_publication`, `merge_context` (so preview and commit). New RPCs filter the same way. pgTAP proves, after hiding: each returns null or `P0002`; forked and merged revisions stay intact; comments, summary, support, and reports of that publication answer 404; `get_moderation_target` still works; restoring reverses everything.

## Risks

- Reporter anonymity: the reported author never sees reports; moderators see the reporter alias to detect campaigns.
- Moderation reason is visible to the author; `private_note` is not.
- 404 covers both "not visible" and "no permission", so ids cannot be enumerated.
- Retracted comment bodies are retained for audit; a retention policy belongs to the operator runbook.
- Account deletion is blocked by `ON DELETE RESTRICT` on authors (same limitation as publications; see ADR 0002).

## Migrations and provisioning

`20261124010000_rate_limits`, `20261124020000_community_tables`, `20261124030000_community_rpcs`, `20261124040000_moderation_rpcs`. Moderator test account: `FTC_MODERATOR_EMAIL` and `FTC_MODERATOR_PASSWORD`, role `moderator` on the pilot site; `configure-local-env.mjs` adds missing keys without touching existing ones.

## Tests

pgTAP `012_community_schema`, `013_rate_limits`, `014_comments_supports`, `015_reports_moderation`, `016_hidden_effects`; fast-check properties for support (seed 20260514); Vitest for Zod and the error mapper; Playwright for the full story, axe, 360 px, and 12 parallel comment POSTs producing exactly 10 created and 2 rate-limited.

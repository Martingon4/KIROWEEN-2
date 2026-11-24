# ADR 0005: Community and moderation

- **Status:** Accepted for Spec 04 (FT-09, FT-10)
- **Date:** 2026-11-22 (Spec 04 closure)

## Context

Participants comment on a published revision, support it, and report content. Moderators of a site hide and restore content with a stated reason, and every action must leave an audit trail. Public identity is a public alias only. Support counts inform people; they never approve or change state (product principle 4). The publication model is in ADR 0002, and the fork rules are in ADR 0003.

## Decision

1. **RPC-only access.** `comments`, `supports`, `reports`, `moderation_events`, `rate_limits`, and `rate_windows` have RLS on and no table grants for `anon` or `authenticated`. Every read and write goes through `SECURITY DEFINER` functions with an empty `search_path` and fully qualified names.
2. **Live alias.** Comments and reports show the author's alias as it is in `profiles` at read time. A pinned alias could be reused after a change and would then appear to sign someone else's comment. Alias rules are hardened: `profile_alias_ok` accepts only NFC text, Latin-1 letters, and no reserved words. A unique index on `lower(normalize(alias, NFKC))` blocks lookalike aliases.
3. **Support is current state.** One row per account and publication. Withdrawing deletes the row, so no history is kept. The count comes from a separate summary RPC and is shown as context only.
4. **Fixed-window rate limits in the database.** `rate_limits` holds the limits and is revisable as data. `rate_windows` holds one row per account, action, and one-hour bucket (`date_bin`). A single `INSERT ... ON CONFLICT DO UPDATE ... WHERE count < max` decides the request. If no row comes back, the request is rejected with 429 and the seconds to the next bucket. The database uses the server `now()`, so no client clock is trusted. Rate consumption runs after validation, replay checks, and duplicate checks. Replays, duplicate reports, and no-op support changes never consume a counter.
5. **Authorization before locks.** The moderated site is derived from the target inside the database. A client-supplied site is never trusted. A non-moderator, a moderator of another site, and a missing target all return `P0002` (HTTP 404), so object ids cannot be enumerated. Authorization is checked before any row lock is taken.
6. **Hide and restore through publication state.** Comments reuse the enum `publication_moderation_state`. Hiding or restoring a publication takes `FOR NO KEY UPDATE` on the publication row. Fork, merge, comment, support, and report paths take `FOR SHARE` on that row. A waiting writer resumes after the moderation transaction commits and re-checks visibility, so it sees `hidden`. Hiding or restoring a comment takes `FOR SHARE` on the publication, then `FOR NO KEY UPDATE` on the comment. This keeps publication before comment in the lock order.
7. **Append-only audit with two text fields.** `moderation_events` rejects update, delete, and truncate with SQLSTATE `55000`. Each hide or restore stores a required public `reason` (1 to 500 characters), which the content author can see, and an optional `private_note`, which only moderators of that site can see. A report is resolved as `actioned` with a link to its event, or as `dismissed` with a note. Reports are never deleted.
8. **Hidden-content effects.** Once a publication is hidden, the Proxy gate returns 404, and the public page, public API, compare, analysis, fork, merge, comments, support, and reports stop working for it. Forks and merged revisions that already exist keep their content and show the source as unavailable. Restoring the publication reverses all of these effects.
9. **Proxy gate and session refresh.** The Proxy gate (ADR 0002) runs `public_publication_exists` before the page renders. Proxy also refreshes the Supabase session on public pages, but only when a session cookie exists, with a 2 s timeout. A signed-in user keeps the session on public pages, and anonymous visitors pay no extra call.
10. **Plain-text rule.** Titles, comments, reasons, and notes are stored, validated, and rendered as plain text. `plain_text_ok` rejects control characters other than newline, bidi override characters, and invisible or zero-width characters. Routes normalize CRLF to LF. The UI never renders HTML or markdown. Comments are not exported in v1. If Spec 05 adds comment exports, they must pass through the formula neutralization in `src/lib/format`.

## Consequences

- Moderators control visibility, and every change is recorded. Hiding is reversible, so no content is destroyed.
- Writers that race with a moderation action may fail or get 404, but they never write to a hidden publication.
- Reports cannot be deleted, so the audit trail stays complete. Reporters never see other reports. Moderators see the reporter alias to detect campaigns.
- Retracted comment bodies stay in the database for audit. A retention policy is not yet defined.
- Account deletion is blocked by `ON DELETE RESTRICT` on authors, the same limit as publications (ADR 0002, limitation c).

### Operator procedure

No runbook exists yet, so the procedure is recorded here.

- **Remove content from public view.** A moderator of the site opens `/es/moderation` or `/en/moderation` and hides the publication or comment with a required public reason. The same action is available through `POST /api/v1/moderation/actions`. Hidden items appear in the hidden list in the panel, where a moderator restores them with a reason. Open reports are resolved from the panel. A report whose target is already hidden can only be dismissed.
- **Assign the moderator role.** An operator with the service role calls `assign_site_role(site, user, 'moderator')`. This is the only role-assignment function used for Spec 04. Local test accounts get the role from `npm run provision:local`.

## Known limitations

These limitations are open and are listed so that readers do not assume the behavior is complete.

- **(a) Paging.** The hidden-content list and the report queue show at most 50 items. There is no paging.
- **(b) Hidden-target reports.** A report whose target is already hidden can be dismissed in the panel, but it cannot be closed as `actioned`.
- **(c) Audit history.** The panel does not show the audit history. The data is available through `GET /api/v1/moderation/targets/:kind/:id`.
- **(d) Alias script.** Aliases accept Latin-1 letters only. This blocks homoglyph impersonation and also excludes names written in other scripts.
- **(e) Account deletion.** Blocked by `ON DELETE RESTRICT` on authors, as in ADR 0002.
- **(f) Rate-limit windows.** Fixed one-hour windows allow up to 2x the limit in a burst at a bucket edge.
- **(g) Lock notes.** ADR 0003 asks moderation to lock the site row with `FOR NO KEY UPDATE`. The Spec 04 implementation locks the publication row instead, as described in decision 6. The lock order stays publication before site and before comment.

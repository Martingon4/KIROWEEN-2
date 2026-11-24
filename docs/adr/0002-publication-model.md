# ADR 0002: Publication model

- **Status:** Accepted for task 5 (FT-06)
- **Date:** 2026-11-22

## Context

Fork the City must keep provenance. A proposal never rewrites its source or a published historical revision. Community members need a stable public link to one saved revision. The public page must work without an account and must not expose private account or branch data.

## Decision

1. **Explicit and immutable.** A user publishes one saved revision by an explicit action. A database trigger rejects `UPDATE` on a publication except for `moderation_state`. It also rejects `DELETE` and `TRUNCATE`.
2. **Snapshot of the public text.** A publication stores the label, summary, and author alias as they were at publish time. Later profile or branch changes do not alter them.
3. **Independent of branch soft-delete.** A publication does not depend on the soft-delete state of its branch.
4. **Empty revisions are rejected.** A revision with no features returns 422 `empty_revision`.
5. **Public reads only through RPCs.** The anonymous client reads publications only through `SECURITY DEFINER` functions. It does not read the tables directly, and `auth.users` is never exposed.
6. **Composite foreign key.** The publication references `(revision_id, branch_id)`, so it cannot point to a revision from another branch.
7. **Lock on the branch.** The publish transaction takes a `FOR SHARE` lock on the branch row. This serializes publish with `save_revision` and branch soft-delete. Do not weaken it to `FOR KEY SHARE`.
8. **Idempotency ledger.** A reused `Idempotency-Key` with different data returns 409 `idempotency_conflict`. The database raises `FT001` for this case, and the route maps it to 409, as it does for branch creation and saves.
9. **Real 404 through the Proxy gate.** `src/lib/supabase/publication-gate.ts` calls `public_publication_exists` with a 1.5 s timeout. Missing, invalid, and hidden IDs are rewritten to the prerendered `/[locale]/publication-unavailable` route, so the response status is 404. If the database check fails, the gate fails open.

## Consequences

- A published link keeps showing the same snapshot after later private saves.
- Public pages show the label, summary, author alias, and interventions that were stored at publish time.
- Publish is retry-safe: a repeated request with the same key returns the original result.
- The gate adds one database call to each publication request. It is bounded by the 1.5 s timeout.
- Account deletion is blocked for accounts that published (see limitation c).

## Known limitations from review

These limitations are open. Each one is listed here so the reader does not assume the behavior is correct.

- **(a) Another site's publication.** The page calls `notFound()` for a visible publication that belongs to a different site. The gate does not check the site. Only the pilot site exists today. The response is a streamed 200 with `noindex`.
- **(b) Hidden during the request.** A publication hidden between the gate check and the page read gets a streamed 200 with `noindex`. The window is milliseconds.
- **(c) Account deletion.** `published_by` references `auth.users` with `on delete restrict`, and the trigger makes it immutable. Deleting an account that has published fails. A future account-deletion flow needs a migration that makes the column nullable with `on delete set null`. The trigger must then allow only that change.

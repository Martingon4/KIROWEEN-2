# ADR 0003: Fork from a published revision

- **Status:** Accepted for Spec 02 (FT-03, R1 "baseline or visible public revision")
- **Date:** 2026-11-22

## Context

R1 of Spec 02 requires a participant to create a private branch from a compatible baseline or from a visible public revision. Task 2 implemented only the baseline. The closure review of task 6 found the gap. A fork must keep provenance: the new branch records where it came from, and the source publication and its revision stay unchanged.

## Decision

1. **Explicit fork from a visible publication.** A participant forks one publication by an explicit action from its public page. The publication must be visible (not hidden by moderation) and must belong to a published site.
2. **Exact snapshot copy without revalidation.** The fork copies the publication's revision snapshot as it was saved. The database does not revalidate it against the current rules. Rules may have tightened since the source was saved, and the copy must still match the source.
3. **Feature IDs are kept.** The copied features keep their IDs, so the fork can be compared with its source later.
4. **Source revision is the primary parent.** The first revision of the new branch has the source revision as its parent and the message `Forked from publication`.
5. **Provenance on the branch.** The branch stores `source_publication_id` and `source_revision_id`. A composite foreign key ties the pair to the same publication. The branch has no `UPDATE` grant on these columns, so provenance cannot change after creation.
6. **Shared idempotency namespace.** `fork_publication` uses the same idempotency ledger as `create_branch`. A reused key with different data returns `idempotency_conflict`.
7. **Lock order.** The fork takes `FOR SHARE` on the publication and then on the site. Moderation must take `FOR NO KEY UPDATE` on the publication row it changes (as implemented in Spec 04 `moderate_target`), never `FOR UPDATE` on the site; the original wording named the site, which Spec 04 supersedes. Publication comes before site in every transaction that locks both.
8. **Publication outlives branch soft-delete.** Soft-deleting a fork does not change or hide the source publication.
9. **Minimal head exposure.** `get_branch_head` returns only `sourcePublicationId` and `sourceVisible`. It never returns the parent revision message or author.
10. **Contract.** `POST /api/v1/branches` accepts a strict union: `{siteId, title}` for a baseline branch, or `{sourcePublicationId, title}` for a fork. Fork errors are 404 `publication_not_found`, 409 `idempotency_conflict`, and 422 `invalid_branch`.

## Consequences

- A fork is a new private branch. Its copy stays private and hypothetical, and the public source is never edited.
- The fork's history starts at the source revision. Later saves in the fork do not change the source publication.
- A fork can contain rules that the current validator would reject. The copy is accepted as the exact source, so it is not a fresh validation of the snapshot.
- `TRUNCATE` on `publications` fails with SQLSTATE `0A000` before the immutability trigger runs, because the foreign key from branches fires first. `TRUNCATE ... CASCADE` still reaches the trigger and fails with `55000`. The pgTAP suite checks both paths, including a `has_trigger` assertion.
- Future moderation code must follow the lock order above, or it can deadlock with a fork.

## Accepted risk

The forker learns the source revision UUID. The UUID is opaque and blocked by RLS for the forker, and it is needed for provenance. Spec 03 must compute ancestors or other revision relations inside `SECURITY DEFINER` functions with an empty `search_path`. It must not expose revision tables or parent chains to the browser.

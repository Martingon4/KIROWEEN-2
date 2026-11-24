# 02 Editor and immutable versions: tasks

- [x] **1. Create immutable revision schema** — FT-03, FT-05, FT-06
  - Add revisions, snapshot features, publications, idempotency ledger, immutable protections, constraints, indexes, and grants.
  - Check: clean reset and pgTAP schema/permission tests.

- [x] **2. Create branches atomically** — FT-03
  - Add the authenticated transaction function and `POST /api/v1/branches`.
  - Verify owner visibility, source preservation, idempotent repeat, mismatched replay, and another-user denial.
  - Check: pgTAP, route contract tests, and browser flow.
  - Evidence: later change in migration `20261122120000_fork_review_fixes.sql`: `create_branch` now requires a published site and raises `P0002` `site_not_found` otherwise. Covered by the Node 24 check run recorded in task 6.

- [x] **3. Add editor operation model** — FT-04
  - Implement typed add/update/delete operations, client-side undo/redo, form fallback, and account/site/branch-scoped recovery.
  - Check: property tests and keyboard/browser tests.
  - Evidence: fast-check properties in `tests/unit/editor-state.test.ts` and `tests/unit/canonical.test.ts` (seed 20260514) passed with no counterexample. `npx playwright test tests/e2e/editor.spec.ts` passed 16 of 16 (8 scenarios on chromium and mobile-360).

- [x] **4. Save expected-head revisions** — FT-04, FT-05
  - Revalidate complete snapshots and materialize one atomic revision.
  - Check: stale-head race, same-key replay, changed-payload conflict, rollback, and 200-feature limits.
  - Evidence: `supabase/tests/004_save_revision.test.sql` (29 pgTAP tests) and `supabase/tests/005_save_revision_hardening.test.sql` cover the save path; the independent review fixes are in migration `20261122070000_save_revision_hardening.sql`. Full sequence `npx -p node@24 -c 'npm run check:ci'` on Node v24.22.3: lint, typecheck, unit 75 tests in 12 files, build, pgTAP 74 tests in 5 files, and Playwright 34 tests passed. A skip-link E2E test was added after that run, and the full sequence has not been rerun since. Superseded: see task 5 evidence.

- [x] **5. Publish a fixed historical revision** — FT-06
  - Add confirmation, transaction, public projection, and stable URL.
  - Check: later private save does not change historical publication output.
  - Later alignment: migration `20261122110000_fork_publication.sql` makes the public read RPCs require a published site, so publication reads follow the same site rule as `create_branch`.
  - Evidence: migrations `20261122080000_publications.sql`, `20261122090000_publication_exists.sql`, and `20261122100000_publish_revision_review_fixes.sql`; pgTAP `supabase/tests/006_publications.test.sql` (31 tests) and `007_publication_exists.test.sql` (14 tests); `tests/e2e/publication.spec.ts` (11 scenarios on chromium and mobile-360, 22 passed). The scenarios cover: publish disabled with pending changes or an empty branch; a later private save leaves the public page on the old snapshot; anonymous view without email, branch id, or revision message; idempotent replay and 409 `already_published` / `idempotency_conflict`; a random or invalid id returns a real HTTP 404; a publication hidden by moderation; axe and 360 px. Full sequence `npx --yes -p node@24 -c 'npm run check:ci'` on Node v24.22.3: lint, typecheck, unit 113 tests in 14 files, build, pgTAP 119 tests in 7 files, and Playwright 58 tests passed. One CSS rule (`.publication-page h1 { max-width: 24ch }`) was added after that run. See `docs/progress.md`.

- [x] **6. Close the Spec with evidence** — FT-16–FT-18
  - Run complete checks, browser review at 360 px, security review, and update progress/evidence.
  - Evidence: `npx --yes -p node@24 -c 'npm run check:ci'` on Node v24.22.3 exited 0: lint, typecheck, unit 126 tests in 15 files, build, pgTAP 213 tests in 8 files, and Playwright 74 tests (chromium and mobile-360). The 360 px coverage is the mobile-360 Playwright project. Two independent reviewer-opus reviews covered this increment. The fork review found no blockers or majors and 8 findings, all fixed in migration `20261122120000_fork_review_fixes.sql`. See `docs/progress.md`.
  - Note: fork-from-publication, the "visible public revision" source named in R1 of `requirements.md` (FT-03), was implemented within this Spec. The closure review of task 6 found that the branch-creation path accepted only the baseline, so the gap was closed here. Changes: migration `20261122110000_fork_publication.sql`, the review fixes in `20261122120000_fork_review_fixes.sql`, the `POST /api/v1/branches` union contract, the public fork form, and `tests/e2e/fork.spec.ts`. Decision record: `docs/adr/0003-fork-from-publication.md`.

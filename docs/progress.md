# Development progress

## Current position

- Active Spec: `05-dossiers` (FT-13 to FT-15). Tasks 1 to 6 are done. Task 7 stays open until the Node 24 `check:ci` totals and the dossier captures are recorded.
- Completed Specs: `01-foundation-place`, `02-editor-versions`, `03-analysis-compare-merge`, and `04-community-moderation`.
- Spec 01 task 8 is marked complete in Kiro (2026-11-22 12:09). Its hook firing is not yet evidenced: no `PostTaskExec` execution is recorded in the Kiro logs. See the hook note under Evidence and automation.
- Spec `03-analysis-compare-merge` covers FT-07, FT-08, FT-11, and FT-12. Spec `04-community-moderation` covers FT-09 and FT-10 and is closed with all seven tasks marked in `.kiro/specs/04-community-moderation/tasks.md`.
- Next Spec: `06` (FT-16 to FT-18: release, video, Devpost). It is not created yet.
- Submission deadline: December 4, 2026, 14:00 PST.
- Last update: 2026-11-22, Spec 04 closure.
- Local Supabase stack: running

## Delivered behavior

### Foundation and place catalog

- Spanish `/es` and English `/en` routes with correct document language.
- Plaza de la Constitución reference boundary from a retained OSM/Nominatim source capture.
- Separately labelled hypothetical shade and market fixtures.
- Server-rendered textual alternative plus a lazily loaded MapLibre WebGL enhancement.
- Controlled `?map=fallback` path proves that the geometry and list remain usable without the interactive map.
- `GET /api/v1/sites` and `GET /api/v1/sites/:slug` use allowlisted public schemas and stable errors.

### Database and authentication

- Supabase local stack with PostgreSQL 17 and PostGIS in `extensions`.
- Public site tables use RLS and expose an explicit `list_public_sites()` projection.
- Profiles, site roles, and private branches use RLS; another participant cannot discover a private branch.
- Operator role assignment is available only through a `SECURITY DEFINER` function granted to `service_role`.
- Local credentials are generated into mode-0600 `.env.local`, which is ignored by Git; two confirmed test users are provisioned without storing passwords in versioned files.
- Spanish and English sign-in routes validate inputs, return to a same-origin path, and avoid exposing account details in errors.

### Immutable version foundation

- Branch creation atomically writes a branch, initial immutable revision, head pointer, and idempotency result.
- Reusing a key with the same canonical payload returns the original IDs; different data returns a conflict.
- Revisions and revision features reject update/delete.
- Geometry supports Point, simple LineString, and Polygon without holes; a database trigger rejects features outside the pilot boundary.
- Authenticated `POST /api/v1/branches` validates origin, body size, JSON, schema, session, and idempotency key.
- The private branch dashboard and keyboard-operable form create and list owner-only branches.

### Editor and expected-head saves

- Form-based editor at `/es|en/branches/<branchId>` (`src/features/editor/branch-editor.tsx`) adds, edits, and deletes four types: `shade_tree` (Point), `shade_canopy` (Polygon), `temporary_market` (Polygon), and `proposed_crossing` (LineString).
- `parking_conversion` is rejected in v1 with `kind_not_supported` because no verifiable inventory exists for it.
- Coordinates are entered as text, `longitude, latitude`, one position per line. Polygons close automatically.
- An SVG preview draws points, lines, and polygons. Local undo and redo keep up to 100 steps.
- Unsaved drafts are stored in localStorage under a key scoped to account, site, and branch. Reloading offers recovery. Sign out deletes the drafts for that account. Leaving with unsaved changes shows a warning, and `beforeunload` guards the tab.
- `GET /api/v1/branches/:branchId` returns the owner's current head as GeoJSON. Other users receive 404.
- `POST /api/v1/branches/:branchId/revisions` requires an `Idempotency-Key` header and a body of `{expectedHeadId, message, features}`. A successful save returns 201 with `{data:{branchId,revisionId,parentRevisionId,featureCount}}`.
- Stable errors: 401 `authentication_required`, 404 `branch_not_found`, 409 `stale_head` (with `details.currentHeadId`), 409 `idempotency_conflict`, 422 with a validation `code` (for example `invalid_geometry`, `invalid_feature_properties`, `feature_outside_site`, `too_many_vertices`, `too_many_features`, `duplicate_feature_id`, `kind_not_supported`) and `details.featureIndex`, 413, and 400.
- Migration `20261122060000_save_revision.sql` adds the `SECURITY DEFINER` function `save_revision` and `get_branch_head`. It also changes `create_branch` to raise SQLSTATE `FT001` for a reused key with different data, instead of `23505`.
- Migration `20261122070000_save_revision_hardening.sql` applies the corrections from an independent review. A null snap-to-grid value or a changed geometry type now returns 422. Vertices are counted before rounding. `label` and `timeSlot` must already be trimmed. `get_branch_head` filters by owner explicitly and no longer relies only on RLS.
- Application error codes: `FT001` reused idempotency key, `FT409` stale head, `FT422` feature validation.
- Canonical coordinates use six decimal places. The server computes a SHA-256 hash of the canonical payload, with sorted keys and features sorted by lowercase id.
- Property tests (fast-check, seed 20260514) in `tests/unit/editor-state.test.ts` and `tests/unit/canonical.test.ts` checked that undo reverses each execute, redo reproduces the final state, and canonicalization is independent of input order and idempotent. No counterexample was found.
- Browser captures `docs/kiro-evidence/editor-1440.png` and `editor-390.png` show no horizontal overflow at 1440 px or 390 px (0 px measured).
- Review findings: the independent review reported two medium issues (a null snap-to-grid value caused a 500 response, and `get_branch_head` depended only on RLS) and several low ones. All were fixed in `20261122070000`.
- A defect in the first unpublished draft of the migration (`pg_catalog.unnest` over several arrays failed) was fixed before publication.

### Publication of a fixed revision (FT-06)

- `POST /api/v1/revisions/:id/publish` publishes one saved revision. It requires an `Idempotency-Key` header and returns 201 on success.
- Error responses: 401 `authentication_required`; 404 when the revision is not found; 409 `already_published` (the response includes the existing publication ID); 409 `idempotency_conflict`; 409 `profile_required`; 422 `empty_revision` or `invalid_publication`.
- `GET /api/v1/publications/:id` returns a public projection. It omits the account ID, email, branch ID, parent revision, and revision message. The response sends `Cache-Control: no-store`.
- Public page `/{es,en}/publications/:id` shows an immutability notice, a hypothetical notice, a schematic preview, the intervention list, and a language switch.
- Proxy gate (`src/lib/supabase/publication-gate.ts`) calls the RPC `public_publication_exists` with a 1.5 s timeout. Missing, invalid, and hidden IDs are rewritten to the prerendered route `/[locale]/publication-unavailable`, so the response status is a real 404. If the database check fails, the gate fails open and the request goes to the page.
- The tester agent found a soft 404: a missing publication returned HTTP 200 with a not-found page. The gate addresses it. E2E checks the 404 status for random and invalid IDs. Known limits that still return a streamed 200 are listed in ADR 0002.
- Why a gate: with Cache Components, Next.js sends the prerendered shell first, so a `notFound()` inside `<Suspense>` keeps status 200 (installed docs: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`, section "Status codes"). The same docs recommend checking in Proxy before streaming starts.
- Editor publish form: the public name is prefilled with the branch title, the summary is required, a consent checkbox is required, and the button is disabled while the branch has pending changes or is empty. The branch's publications list shows a "Hidden by moderation" state.
- Evidence captures: `docs/kiro-evidence/publish-form-1440.png`, `publication-1440.png`, and `publication-390.png`. 0 px horizontal overflow was measured at 1440 px and 390 px. The branch title in the captures includes a random test suffix (`f8bde1d2`) from the E2E helper.

### Fork from a published revision (FT-03, R1 public-revision source)

- Requirement: R1 of Spec 02 says a participant may branch from a compatible baseline or a visible public revision. Task 2 implemented only the baseline. The closure review of task 6 found the gap, and it was closed within this Spec.
- Contract: `POST /api/v1/branches` accepts a strict union. Baseline: `{siteId, title}`. Fork: `{sourcePublicationId, title}`. Fork errors: 404 `publication_not_found`, 409 `idempotency_conflict`, 422 `invalid_branch`.
- Migration `20261122110000_fork_publication.sql`: adds `branches.source_publication_id`; adds the `fork_publication` RPC, which uses the same idempotency namespace as `create_branch`, takes `FOR SHARE` on the publication and the site, copies the source snapshot exactly without revalidation, and sets the source revision as the parent of the first revision with the message `Forked from publication`. `get_branch_head` gains `sourcePublicationId` and `sourceVisible`. The public read RPCs require a published site.
- Migration `20261122120000_fork_review_fixes.sql` (fork review fixes):
  - Composite foreign keys: `publications(id, revision_id)` and `branches(source_publication_id, source_revision_id)`.
  - `FOR SHARE` on the publication and the site, with a documented lock order: publication, then site. Moderation must use `FOR NO KEY UPDATE` on `sites`.
  - `create_branch` requires a published site. Otherwise it raises `P0002` `site_not_found`.
  - A `js_trim` helper gives JavaScript `String.trim()` parity for `label` and `timeSlot`. Before this fix, `btrim` removed only ASCII whitespace, so a direct RPC caller could save tab or NBSP labels that later broke Zod parsing and the fork editor.
  - Index `branches_source_publication_idx`.
  - Fork action error context: `?error=invalid_title` for invalid titles. `P0002` redirects to `/[locale]/publication-unavailable`.
  - `branchPayloadFingerprint` is reused in the fork action.
  - `GET /api/v1/branches/[branchId]` returns a controlled 500 on a malformed head, using `safeParse`.
- pgTAP finding: `TRUNCATE` on `publications` now fails with `0A000`, because the branches foreign key fires first. Coverage is kept through `TRUNCATE CASCADE`, which returns `55000`, and a `has_trigger` assertion.
- Public UI: the publication page has a fork form, "Bifurcar esta propuesta". The title is prefilled, and the form works without JavaScript. An anonymous submitter is redirected to sign-in with `returnTo`. Success opens the editor.
- Provenance UI: the editor shows a provenance line with a link to the source publication. When the source is hidden, it shows "…ya no está disponible".
- Tests: pgTAP `supabase/tests/008_fork_publication.test.sql` (92 tests) and `006_publications.test.sql` (updated to 33 tests); unit branch-schema tests; `tests/e2e/fork.spec.ts` (8 scenarios on chromium and mobile-360, 16 tests).
- Decision record: `docs/adr/0003-fork-from-publication.md`.

### Agents and models (fork, Spec 02 task 6)

- Architect (`architect`, claude-opus-5.5): designed the fork and six corrections, including the shared idempotency namespace and the `POST /api/v1/branches` union.
- Implementer (main session agent): role requested Claude Sonnet 5.5. The session ran as Claude Opus 5.5 and Kimi K3 in parts. Both are recorded here. The Sonnet model ID was not confirmed.
- Tester (`tester` profile, model `auto`, standing in for GPT-5.6 Luna; the model ID is not confirmed in Kiro): wrote pgTAP `008`, the unit tests, and the E2E tests. Found the constraint-introspection break.
- Reviewer (`reviewer-opus`, claude-opus-5.5): two independent reviews. The fork review found no blockers or majors and 8 findings, all fixed.
- Docs writer (`docs-writer`, claude-haiku-5.5 configured in the profile; the runtime model was not confirmed): wrote these docs.
- Model names are the configured profile values, except where a session model was reported. Kiro does not confirm the runtime model for each sub-agent call.

### Agents and models (FT-06)

- Architect (`architect`, claude-opus-5.5): designed the publication rules.
- Implementer and integrator (main session agent): wrote the migrations, routes, and UI. The role requested Claude Sonnet 5.5. The session ran as Claude Opus 5.5 for part of this work.
- Tester (`tester` profile, model `auto`): stands in for GPT-5.6 Luna. The GPT-5.6 Luna model ID is not confirmed in Kiro. The tester wrote pgTAP `006` and `007`, the unit tests, and the E2E tests, and found the soft 404 defect.
- Reviewer (`reviewer-opus`, claude-opus-5.5): no blockers, 8 findings. Fixed: the lock comment and the null-detail `unique_violation` path (migration `20261122100000`), a 1.5 s Proxy timeout, `missing_profile` mapped to 409 `profile_required`, and the hidden-by-moderation state in the editor. Documented as limits in ADR 0002: the site check on the page, the gate-to-page race window, and `published_by` blocking account deletion.
- Docs writer (`docs-writer`, claude-haiku-5.5): wrote these docs.
- Model names are the configured profile values. Kiro does not confirm the runtime model for each sub-agent call.

### Analysis, costs, compare and merge (Spec 03, FT-07, FT-08, FT-11, FT-12)

- Solar scenarios (FT-11): `scripts/generate-solar-scenarios.mjs` writes `data/sites/zocalo-puebla/solar-scenarios.json` using `suncalc` 1.9.0, pinned as an exact devDependency. `npm run check:solar` reports "solar scenarios match". The scenarios are `equinox-1000` (azimuth 1.94519 rad, elevation 0.804819 rad) and `equinox-1600` (azimuth 4.440486 rad, elevation 0.654517 rad) on 2027-03-20 in America/Mexico_City. `equinox-1900` is excluded because the sun is below 10°. An independent NOAA implementation agrees within 0.5°. The dataset checksum is in `manifest.json`.
- Spatial indicators (FT-11): `analysis_compute` and the public wrapper `get_snapshot_analysis` return shade, occupancy per time slot, crossing length, and remaining surface, with engine version and inputs. A probe on a known canopy gave 326.05 m² (2.87%). The pilot has no pedestrian-area layer, so the reference surface is the boundary fallback, and parking is `null` because no inventory exists.
- Costs (FT-12): `data/catalogs/zocalo-puebla-v1.json` is a fully illustrative evaluation price list dated 2026-11-22, owned by "Equipo del piloto Fork the City". Prices are pinned by `effective_from`, rounded half-up per line, and unpriced concepts make the result partial. The file is not a supplier quote. See `docs/data-sources.md`.
- Compare (FT-07): `compare_revisions` and `GET /api/v1/compare?left=&right=&scenario=`. The `/[locale]/compare` page shows an indicators table, an SVG change map with a pattern legend (not color alone), and a changes table. Both tables sit in keyboard-focusable scroll regions.
- Merge (FT-08): `POST /api/v1/branches/:id/merge/preview` and `/merge/commit`. The merge page resolves conflicts from the keyboard with keep, remove, or redraw. The entry point is the publication page, and the editor shows merge provenance.
- Performance (FT-07, R3): `scripts/perf-compare.mjs` ran on the production build on the Node 26 host with 200 features per side and 100 modified. Cold start was 1265 ms. Over 40 requests after 5 warm-up requests: p50 73 ms, p95 170 ms, max 198 ms. The target p95 of 1500 ms or less was met. Payload was 51,118 bytes.
- Captures: `docs/kiro-evidence/compare-1440.png`, `compare-390.png`, `merge-conflict-1440.png`, and `merge-resolved-1440.png`. Each shows 0 px horizontal overflow. These captures predate the CSS rule for `.publication-page > section`. The final `check:ci` run covers that rule.
- Demo: proposal A adds shade, proposal B adds temporary market stalls over the same surface, the spatial conflict is shown, and the merge resolves it with both parents kept. The E2E suite covers the demo with a redraw resolution and with a remove resolution.
- Tests: pgTAP `009_analysis`, `010_compare` (113 tests), and `011_merge` (292 tests). Unit tests `solar`, `analysis-props` (seed 20260514), `compare-schema` (24), and `merge-schema` (31). E2E `compare.spec.ts` (14 of 14) and `merge.spec.ts` (12 of 12).
- Defects found by the tester agent and fixed:
  - The catalog price CHECK accepted a half-null price pair (`20261123030000`).
  - `resolve_snapshot_ref` accepted trailing characters (`20261123030000`).
  - An axe `scrollable-region-focusable` violation on the compare tables, fixed with `role="region"`, `tabIndex={0}`, and `aria-labelledby`.
  - A merge resolution without `conflictId` raised SQLSTATE 22023 (`20261123060000`).
  - A test fragility: `010` compared global `mutation_requests` counts. It now compares before and after.
- Review: `reviewer-opus` found no blockers, 2 major and 6 minor or nit findings. All were fixed in migration `20261123070000` and the UI. The fixes cover iterative resolution rounds for overlaps that a redraw introduces, the blocking rule, no private ancestor IDs in operations, the stale-head check before domain checks, exact EWKB equality, the 200-feature message, and a bounding-box prefilter with a 512 KiB preview cap.
- Known limitations: see ADR 0004, section "Limitations".

### Agents and models (Spec 03)

- Architect (`architect`, claude-opus-5.5): wrote the design.
- Implementer (main session agent): the role requested Claude Sonnet 5.5. The session ran as Kimi K3 and Claude Opus 5.5 in parts. The Sonnet model ID was not confirmed.
- Tester (`tester` profile, model `auto`, standing in for GPT-5.6 Luna; the model ID is not confirmed in Kiro): two tester runs were cancelled and relaunched as smaller tasks.
- Reviewer (`reviewer-opus`, claude-opus-5.5): merge review.
- Docs writer (`docs-writer`, claude-haiku-5.5): wrote these docs.
- Profile models are the configured values. Kiro does not confirm the runtime model for each sub-agent call.

### Community and moderation (Spec 04, FT-09, FT-10)

- Schema (migrations `20261124010000_rate_limits`, `20261124020000_community_tables`): tables `comments`, `supports`, `reports`, `moderation_events`, `rate_limits`, and `rate_windows`. RLS is on for each table, and `anon` and `authenticated` have no table grants.
- Plain text (`plain_text_ok`): comments are 1 to 1,000 characters after trimming, moderation reasons are 1 to 500, and report notes are optional and at most 500. Control characters other than newline, bidi overrides, and invisible or zero-width characters are rejected. Routes normalize CRLF to LF. The UI renders text only.
- Comments: flat list per publication, no replies. Optional anchor to one feature of the published revision, checked in the database. Pages of 20 by default and 50 at most, with a keyset cursor on `(created_at, id)`. Authors can retract their own comments. The `mine` flag lets an author identify their own comments without any account id. Account ids and emails are never returned.
- Support: at most one per account and publication. Withdrawing deletes the row. Repeating support or withdrawal leaves the count unchanged. Visitors see the count. Only the account sees its own state. The count never triggers a state change.
- Reports: reasons `spam`, `harassment`, `misinformation`, `privacy`, and `other`, with an optional note of up to 500 characters. One open report per account and target. A duplicate returns the existing report. Reporters never see other reports.
- Rate limits (migration `20261124010000_rate_limits`): 10 comments per hour, 10 reports per hour, and 60 support changes per hour, per account. Limits live in data (`rate_limits`). Counters are atomic upserts per one-hour bucket, use the server clock, and are checked after validation and replay checks. A rejected request returns 429 with `Retry-After` and makes no change. A replay or a duplicate report does not consume a counter. Window length is capped at 86,400 seconds, and old windows are purged.
- Idempotency: `create_comment`, `create_report`, `moderate_target`, and `resolve_report` use the shared ledger. Replays return the original result, and a different payload returns 409. `set_support` and `retract_comment` are naturally idempotent.
- Migrations: `20261124030000_community_rpcs` (comment, support, and report RPCs and public reads), `20261124040000_moderation_rpcs` (report queue, target read, moderate, and resolve), `20261124050000_moderation_hidden_list` (`list_hidden_content`), `20261124060000_comments_mine_flag`, and `20261124070000_community_review_fixes`.
- Routes: ten routes under `/api/v1`: comments list and create, comment retraction, support read and set, report create, moderation report queue, moderation target read, moderation actions, and report resolve. Errors use stable codes, `no-store` caching, and the `readMutationOrigin` check for PUT and DELETE.
- UI: community section on the publication page (support toggle, comments with anchor labels, comment form, report controls, and author notices). Moderation panel at `/es/moderation` and `/en/moderation`, with the report queue, hide and restore forms, and the hidden list. Both work with the keyboard at 360 px. Status is never shown by color alone.
- Moderation: a moderator of the site hides or restores a publication or comment with a required public reason and an optional private note. Each action appends to `moderation_events`, which rejects update, delete, and truncate. A non-moderator, or a moderator of another site, gets 404 with no effect.
- Hidden publications: the public page returns 404 through the Proxy gate, and the public API, compare, analysis, fork, merge, comments, support, and reports stop working for it. Existing forks and merged revisions keep their content and show the source as unavailable. Restoring reverses these effects.
- Review fixes (`reviewer-opus`: 10 findings, 3 major). Fixed in `20261124070000_community_review_fixes.sql` and in app code:
  - Major: editable profile aliases could impersonate authors or moderators. Fixed with the `profile_alias_ok` constraint (NFC, Latin-1 letters only, reserved words) and a unique index on `lower(normalize(alias, NFKC))`.
  - Major: the author of a hidden publication could not read the public reason. Fixed with `list_my_hidden_publications`, shown in the editor list.
  - Major: concurrent reports with different idempotency keys could end in a 500. Fixed with an advisory lock per reporter and target.
  - Other fixes in the same change: `resolve_report` now rejects events older than the report; invisible characters are rejected by `plain_text_ok`; `__proto__` query parameters could crash the page and are now handled with `Object.hasOwn` and a clamped `wait`; the Proxy session refresh runs only when a session cookie exists, with a 2 s timeout; `moderation_events` gained indexes; the rate-limit purge and window cap were added.
- Found during testing, fixed: a prototype-key lookup in `mapCommunityError` (fixed with `Object.hasOwn`), and pgTAP assertions that counted global rows and failed once E2E rows were committed (the assertions now compare relative counts).
- Added during implementation: `list_hidden_content`, so moderators can find and restore hidden content, and the `mine` flag on comments.
- Tests: pgTAP `012_community_schema`, `013_rate_limits`, `014_comments_supports`, `015_reports_moderation` (4 users by 8 functions, all denied with `P0002` with no change), and `016_hidden_effects`. Unit `tests/unit/community-schema.test.ts`. E2E `tests/e2e/community.spec.ts`: 15 passed and 1 skipped by design (the rate-limit test runs on chromium only), covering the API matrix, the parallel-comment limit (12 requests give exactly 10 created and 2 rate-limited), axe, keyboard, 360 px, and plain-text rendering of `<img onerror>`.
- Captures: `docs/kiro-evidence/community-1440.png`, `community-390.png`, and `moderation-1440.png`, each with 0 px horizontal overflow. The moderation capture shows leftover reports from earlier local E2E runs. It does not contain real user data.
- Known limitations (details in `docs/adr/0005-community-and-moderation.md`): the hidden list and report queue show at most 50 items without paging; a report whose target is already hidden can only be dismissed; the panel does not show the audit history (the API has it); aliases accept Latin-1 letters only; account deletion is blocked by `ON DELETE RESTRICT` on authors.
- Known gaps in the evidence:
  - Spec 04 R7 property tests: `scripts/generate-support-properties.mjs` (fast-check, seed 20260514, 40 random sequences plus 2 regression sequences, 3 accounts per sequence) writes `supabase/tests/018_support_properties.test.sql`, 243 assertions run against the real `set_support` function: a repeated support leaves the count unchanged, a withdrawal returns it to its previous value, and after any interleaving the count equals the number of accounts currently supporting. `npm run check:support` (part of `npm run check`) fails if the committed file drifts from the generator. No counterexample was found. The two-account story of R7 is scenario 1 of `tests/e2e/community.spec.ts` (two accounts comment, support twice counts once, withdraw, report, moderator hides and restores, public effects verified).
  - R7 also asks for an E2E story with two accounts, support counted once, withdrawal, a report, and a moderator hide and restore. The closure evidence lists the API matrix and UI checks, not that story as one scenario.
- Migration note: ADR 0003 asks moderation to lock the site row. The Spec 04 moderation migration locks the publication row (`FOR NO KEY UPDATE`), as the Spec 04 design requires. ADR 0005 records this difference.

### Agents and models (Spec 04)

- Architect (`architect`, claude-opus-5.5): wrote the design.
- Implementer (main session agent): the role requested Claude Sonnet 5.5. The session ran as Claude Opus 5.5 and Auto. The Sonnet model ID was not confirmed.
- Tester (`tester` profile, model `auto`, standing in for GPT-5.6 Luna; the model ID is not confirmed in Kiro): 4 focused runs.
- Reviewer (`reviewer-opus`, claude-opus-5.5): review of the community increment, 10 findings, 3 major.
- Docs writer (`docs-writer`, claude-haiku-5.5): wrote these docs.
- Profile models are the configured values. Kiro does not confirm the runtime model for each sub-agent call.

### Dossiers, tracking, and exports (Spec 05, FT-13 to FT-15)

- Migrations `20261125010000` to `20261125060000`:
  - `010_dossier_tables`: enums, tables, constraints, triggers, RLS, and no grants. pgTAP `019_dossier_schema.test.sql`.
  - `020_dossier_rpcs`: promotion, responsible name, milestones, evidence, transitions with the full requirement matrix, and `revert_last_status_change`.
  - `030_dossier_reads`: public dossier, managed dossier, publication lookup, list, and existence check.
  - `040_dossier_fixes`: `add_evidence` validates the URL in a fixed order.
  - `050_dossier_evidence_trigger_definer`: the deferred evidence trigger is `SECURITY DEFINER` with an empty `search_path`. The E2E run found the defect, because the pgTAP suite runs as a superuser and did not.
  - `060_dossier_responsible_withdrawal`: after review, a coordinator can withdraw the public responsible name when the dossier is closed or its publication is hidden. pgTAP `024_dossier_responsible_withdrawal.test.sql`.
- Exports: `GET /api/v1/dossiers/{id}/export?format=html|geojson|csv|json`, generated from `get_public_dossier`. Responses use `no-store` and `nosniff`. CSV has a BOM and CRLF, and neutralizes formula cells. HTML uses a CSP with a hash for its only inline style, and its inline SVG uses presentation attributes.
- Review (`reviewer-opus`) findings fixed: responsible withdrawal in closed or hidden states, CSP and SVG style, uniform 404 codes, a 1 KiB body limit on evidence verification, and export 404 outside the pilot site.
- Tests: unit 462 passed, pgTAP 2835 passed in 24 files, and E2E `tests/e2e/dossier.spec.ts` 20 passed on chromium and mobile-360. These results were observed and reported by the main session. The docs agent did not rerun them.
- Not yet recorded: the Node 24 `check:ci` totals and the dossier captures. No dossier capture exists in `docs/kiro-evidence/` yet.
- Decisions and known limitations: `docs/adr/0006-dossiers.md`.
- Agents and models (Spec 05): tester, `tester` profile with model `auto`, standing in for GPT-5.6 Luna (model ID not confirmed in Kiro). Reviewer, `reviewer-opus` (claude-opus-5.5). The design was written by the architect agent, described in `design.md` as the Opus architect. Other roles are not recorded here.

## Actual validation results

| Command | Observed result |
|---|---|
| `npm run test:unit` (Spec 05 increment) | 462 tests passed. Observed and reported by the main session; not rerun by the docs agent. |
| `npm run test:db` (Spec 05 increment) | 2835 pgTAP tests passed in 24 files. Observed and reported by the main session; not rerun by the docs agent. |
| `npx playwright test tests/e2e/dossier.spec.ts` (Spec 05 increment) | 20 tests passed on chromium and mobile-360. Observed and reported by the main session; not rerun by the docs agent. |
| `npx --yes -p node@24 -c 'npm run check:ci'` (Spec 05 closure) | Exit 0 after a clean `supabase db reset` and `npm run provision:local`: unit 462, pgTAP 2835 in 24 files, Playwright 135. |
| `npx --yes -p node@24 -c 'npm run check:ci'` (Spec 04 closure) | Exit 0 on Node v24.22.3, after a clean `supabase db reset` and `npm run provision:local`. Covers lint, typecheck, unit (276 tests in 20 files), `check:solar`, build, pgTAP (1957 tests in 18 files), and Playwright (115 tests on chromium and mobile-360). One community rate-limit test runs only on chromium, by design. No edits were made after this run except the captures. |
| `npx --yes -p node@24 -c 'npm run check:ci'` (Spec 01 task 8, 2026-11-22) | Exit 0 on Node v24.22.3 in 2 min 56 s, run after a clean `supabase db reset` and `npm run provision:local`. `test:unit` 206 tests in 19 files, `check:solar` passed, build compiled, `test:db` 852 pgTAP tests in 11 files, `test:e2e` 100 of 100 on chromium and mobile-360. The first attempt in this task failed 1 of 100: `fork.spec.ts` "un nombre en blanco…" on mobile-360 compared the coordinator's whole branch list before and after, and a parallel worker in `merge.spec.ts` created "Propuesta B" as the same coordinator in between. The test now counts branches whose `source_publication_id` is that test's own publication. No application code changed. |
| `npx --yes -p node@24 -c 'npm run smoke:clean'` (Spec 01 task 8) | Exit 0 on Node v24.22.3 in 1 min 19 s: clean copy, `npm ci`, lint, types, 206 unit tests, and build without `.env.local`. |
| Hook command run by hand (`npm run lint && npm run typecheck && npm run test:unit`) | Exit 0 in 29 s, 206 unit tests, on the Node 26 host. This is not a hook trigger. |
| `npx --yes -p node@24 -c 'npm run check:ci'` (Spec 03 closure) | Exit 0 on Node v24.22.3, run after a clean `supabase db reset` and `npm run provision:local`. Covers `lint`, `typecheck`, `test:unit` (206 tests in 19 files), `check:solar` ("solar scenarios match"), `build`, `test:db` (pgTAP, 852 tests in 11 files), and `test:e2e` (Playwright, 100 tests on chromium and mobile-360). Includes the `.publication-page > section` CSS rule. |
| Compare performance, `scripts/perf-compare.mjs` | Node 26 host, production build. p95 170 ms over 40 requests (target 1500 ms). Cold start 1265 ms, reported separately. Not repeated on Node 24. |
| `npm audit --omit=dev` | 0 vulnerabilities (recorded before the editor work; not rerun) |
| `npx --yes -p node@24 -c 'npm run check:ci'` | Current run (Spec 02 closure, with fork): exit 0 on Node v24.22.3. Lint, typecheck, unit (126 tests in 15 files), build, pgTAP (213 tests in 8 files), and Playwright (74 tests on chromium and mobile-360) passed. Superseded run: lint, typecheck, unit (113 tests in 14 files), build, pgTAP (119 tests in 7 files), and Playwright (58 tests) passed. Earlier notes for that run follow. One CSS rule (`.publication-page h1 { max-width: 24ch }`) was added after this run. The `docs/kiro-evidence` publication captures predate that rule. After it, `npm run lint` passed and `npx playwright test tests/e2e/publication.spec.ts` (Node 26 host) passed 22 of 22; the full Node 24 sequence was not rerun |
| `npx playwright test tests/e2e/editor.spec.ts` | 16 passed (8 editor scenarios on chromium and mobile-360) |
| `npx -p node@24 -c 'npm run smoke:clean'` | Superseded by the Spec 01 task 8 run above. Passed on the foundation state: clean copy, `npm ci`, lint, types, unit tests, and build without `.env.local` |

Earlier Node 26 host runs of lint, typecheck, and build are superseded by the Node v24.22.3 results above.

## Dependency and runtime decisions

- Target runtime is Node 24 (`.nvmrc`, `engines`). The host remains Node 26, so npm prints the expected `EBADENGINE` warning during host-side installs.
- A temporary Node `v24.22.3` executed the full checks successfully.
- Vitest 5 required Node types 22 or 24+, so `@types/node` was upgraded from 20 to 24 instead of bypassing peer checks.
- ESLint 10 passes lint but is outside the peer ranges of Next's current React/import/accessibility plugins. The project therefore keeps peer-valid ESLint `9.39.5`; npm marks that major deprecated. Upgrade when those plugins publish ESLint 10 ranges.
- MapLibre 6's worker did not resolve under Turbopack. The pinned package worker is copied to `public/maplibre-gl-worker.mjs`; browser tests confirm it loads.

## Evidence and automation

- Desktop and mobile captures: `docs/kiro-evidence/catalog-1440.png` and `catalog-390.png`.
- GitHub Actions workflow: `.github/workflows/ci.yml`. Node 24, `npm ci`, Playwright Chromium, local Supabase start, `configure:local`, `provision:local`, `check:ci`, and Supabase stop in an `always()` step. Read-only `contents` permission. It has never run remotely because nothing was pushed.
- Kiro hook: `.kiro/hooks/check-after-task.json`. One `PostTaskExec` hook with a 300 s timeout that runs lint, typecheck, and unit tests after a Spec task. No real trigger has been observed yet; running its command by hand does not count.
- Clean-copy smoke: `npm run smoke:clean` (`scripts/smoke-clean-clone.mjs`).

## Next actions

1. Spec 01 task 8: local checks are done (`check:ci` and `smoke:clean` on Node 24). Still pending: the first real `PostTaskExec` firing of `.kiro/hooks/check-after-task.json`. The hook now also appends timestamps to `.kiro/hooks/run.log`, which git ignores, so the next firing leaves evidence there. A remote GitHub Actions run after a push is also pending.
2. Spec 05 closure: `check:ci` on Node 24 is recorded above. Still pending: dossier captures at 1440 px and 390 px, planned for Spec 06 polish.
3. Spec 06: FT-16 to FT-18 (release, video, Devpost). Not yet created. Finish before December 4, 2026, 14:00 PST.
4. Spec 04 has no open gaps beyond the documented limitations (paging of the hidden list, closing a report on already-hidden content, audit history in the panel).
5. Repeat the compare timing on the Node 24 host, so the performance evidence matches the target runtime.

## Remaining external blockers

- No PMTiles regional extract or redistributable pedestrian/inventory layer has been accepted.
- The pilot metric projection EPSG:32614 is `pending-validation` in `data/sites/zocalo-puebla/manifest.json`.
- No parking inventory exists, so parking impact is not computed.
- No hosted Supabase, Vercel, SMTP, or Devpost destination has been configured.
- Remote GitHub Actions has not run because no push was performed.

## Hook observation note (2026-11-22)
- Task 8 of Spec 01 is marked `[x]` in `.kiro/specs/01-foundation-place/tasks.md` (file modified 12:09:10). Kiro's log shows the hook registered at 11:47:21 and the task moving to `in_progress` at 11:47:28.
- The log has no entry for a `completed` task update or for a hook run after that. Either the completion was written outside the Spec UI or Kiro does not log a successful hook. The requirement "record one observed hook result" is therefore not demonstrated yet.
- To close it with evidence: set a throwaway Spec task to completed from the Spec UI and copy the hook output Kiro shows, or add a `Stop` or `PostTaskExec` hook that appends a timestamp to a log file and show that file.
- Update (Spec 04 closure): the hook was edited to also append timestamps to `.kiro/hooks/run.log`, which git ignores. The next real firing should leave a timestamp there. No firing is recorded yet, so the requirement is still open.
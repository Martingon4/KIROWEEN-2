# Kiro development evidence

## Verificación local de los cambios con el editor 3D

En una copia con Supabase recién reiniciado, `CI=1 npm run check:ci` terminó con código 0 en Node v24.22.3. Pasaron 507 pruebas unitarias y 2851 pgTAP. De los 180 casos de Playwright en escritorio y a 360 px, 174 aprobaron al primer intento, 3 tras reintento y 3 se omitieron. La omisión móvil del límite de uso es intencional y los otros dos casos requieren el modelo opcional de relieve. [Comandos y resultados por corrida](progress.md#validación-aislada-de-los-cambios-locales).

Con los tiempos de espera ajustados, se repitieron los casos de carga de MapLibre y accesibilidad de fusión dos veces por tamaño. Pasaron los ocho casos con tres trabajadores y sin reintentos.

## Capturas de entrega

Playwright recorrió un caso hipotético con cuentas de demostración en el entorno local aislado. Detectó un solapamiento de 174,67 m² entre la cubierta y el mercado, guardó la fusión tras redibujar el mercado, bloqueó el cierre del expediente sin evidencia nueva y comprobó la respuesta del exportador HTML. Las 14 capturas registraron 0 px de desbordamiento horizontal.

| Vista | 1440 px | 390 px |
|---|---|---|
| Ramas | [Escritorio](kiro-evidence/delivery-branches-1440.png) | [Móvil](kiro-evidence/delivery-branches-390.png) |
| Editor | [Escritorio](kiro-evidence/delivery-editor-1440.png) | [Móvil](kiro-evidence/delivery-editor-390.png) |
| Comparación | [Escritorio](kiro-evidence/delivery-compare-1440.png) | [Móvil](kiro-evidence/delivery-compare-390.png) |
| Fusión | [Escritorio](kiro-evidence/delivery-merge-1440.png) | [Móvil](kiro-evidence/delivery-merge-390.png) |
| Expediente | [Escritorio](kiro-evidence/delivery-dossier-1440.png) | [Móvil](kiro-evidence/delivery-dossier-390.png) |
| Gestión y bloqueo del cierre | [Escritorio](kiro-evidence/delivery-dossier-manage-1440.png) | [Móvil](kiro-evidence/delivery-dossier-manage-390.png) |
| Moderación | [Escritorio](kiro-evidence/delivery-moderation-1440.png) | [Móvil](kiro-evidence/delivery-moderation-390.png) |

| Requirement | Kiro artifact or capability                      | Result and path                                                                                                                                 |
| ----------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| FT-01       | Master-plan analysis and Requirements-First Spec | Pilot source selected with explicit partial coverage in `docs/validation.md`; requirements in `.kiro/specs/01-foundation-place/requirements.md` |
| FT-16       | UI/UX skill search and design review             | Rejected unrelated first output; accepted accessibility-first civic direction in `design-system/fork-the-city/`                                 |
| FT-17       | Tool execution and package validation            | Measured toolchain and dependency conflict resolution recorded in `docs/validation.md` and `docs/progress.md`                                   |
| FT-18       | Steering                                         | Product, technology, and structure context stored in `.kiro/steering/`                                                                          |
| FT-18       | Spec                                             | Requirements, design, and tasks stored in `.kiro/specs/01-foundation-place/`                                                                    |

Only observed tool use appears here. Future rows will add the actual hook output, property-based counterexample or pass, browser evidence, and release checks when they occur.

## Implemented evidence

| Requirement | Evidence | Observed result |
|---|---|---|
| FT-01 | `tests/e2e/catalog.spec.ts` | MapLibre WebGL enhancement and controlled fallback both passed on desktop and 360 px. |
| FT-02 | `supabase/tests/002_auth_visibility.test.sql` | Owner sees one private branch; another participant sees zero. |
| FT-02 | Browser sign-in test | Confirmed local participant returned to the initiating locale route; generic invalid-credential error passed. |
| FT-03 | `supabase/tests/003_immutable_branches.test.sql` | Atomic branch and first revision, idempotent replay, changed-payload conflict, and cross-account hiding passed. |
| FT-03 | Browser branch tests | Authenticated API and keyboard-operable form created owner-only branches. |
| FT-05 | Immutable triggers in migration `20261122050000` | Attempted revision update failed with `immutable_revision`. |
| FT-17 | Node 24 `npm run check:ci` and `npm run smoke:clean` (Spec 01 task 8) | Both exit 0 on Node v24.22.3. `check:ci` ran after a clean DB reset: 206 unit, 852 pgTAP, 100 of 100 Playwright. A first attempt failed 1 Playwright test because of a parallel-worker race in `tests/e2e/fork.spec.ts`; the test was scoped to its own publication and the rerun passed. Remote GitHub Actions (`.github/workflows/ci.yml`) has not run because nothing was pushed. |
| FT-18 | `.kiro/hooks/check-after-task.json` | Valid configuration: one `PostTaskExec` hook, 300 s timeout. Its command exits 0 in 29 s when run by hand. Kiro logged `hooks.reload.loaded {"read":1,"registered":1}` at 2026-11-22 11:47:21, so the hook was registered, and it recorded task 8 going `queued → in_progress` at 11:47:28. The task was marked `[x]` by 12:09, but the Kiro agent log contains no `completed` task update and no hook execution entry, so a real hook output has not been captured. |
| FT-04 | `tests/unit/editor-state.test.ts` and `tests/unit/canonical.test.ts` (fast-check, seed 20260514) | Undo reverses each execute, redo reproduces the final state, and canonicalization is order-independent and idempotent. No counterexample found. |
| FT-04 | `tests/e2e/editor.spec.ts` | `npx playwright test tests/e2e/editor.spec.ts`: 16 passed (8 scenarios on chromium and mobile-360). Captures `docs/kiro-evidence/editor-1440.png` and `editor-390.png` show 0 px horizontal overflow at 1440 px and 390 px. |
| FT-05 | `supabase/tests/004_save_revision.test.sql` (29 tests) and `supabase/tests/005_save_revision_hardening.test.sql` | Included in the 74 pgTAP tests in 5 files that passed on Node v24.22.3. Covers expected-head saves, same-key replay, changed-payload conflict, and the review fixes in migration `20261122070000`. |
| FT-06 | Spec task 5 in `.kiro/specs/02-editor-versions/tasks.md` | Marked complete with evidence. Migrations `20261122080000`, `20261122090000`, and `20261122100000` add publications, the existence check, and the review fixes. |
| FT-06 | `supabase/tests/006_publications.test.sql` (31 tests) and `supabase/tests/007_publication_exists.test.sql` (14 tests) | Included in the 119 pgTAP tests in 7 files that passed on Node v24.22.3 with `npx --yes -p node@24 -c 'npm run check:ci'`. |
| FT-06 | `tests/e2e/publication.spec.ts` | 11 scenarios on chromium and mobile-360: 22 passed. Covers publish gating, a later private save leaving the public snapshot unchanged, anonymous view without private fields, idempotent replay, 409 responses, real HTTP 404 for random and invalid IDs, the moderation-hidden state, axe, and 360 px. |
| FT-06 | Reviewer and tester sub-agents (see Multi-agent workflow) | Reviewer found no blockers and 8 findings. Tester found the soft 404 defect that the Proxy gate addresses. |
| FT-06 | Captures `docs/kiro-evidence/publish-form-1440.png`, `publication-1440.png`, and `publication-390.png` | 0 px horizontal overflow measured at 1440 px and 390 px. The branch title in the captures has a random test suffix (`f8bde1d2`) from the E2E helper. |
| FT-03 (fork) | `supabase/tests/008_fork_publication.test.sql` (92 tests) and updated `supabase/tests/006_publications.test.sql` (33 tests) | Included in the 213 pgTAP tests in 8 files that passed on Node v24.22.3 with `npx --yes -p node@24 -c 'npm run check:ci'`. Covers fork provenance, the composite foreign key, the shared idempotency namespace, and the `TRUNCATE` behavior. |
| FT-03 (fork) | Unit branch-schema tests | Included in the 126 unit tests in 15 files that passed on Node v24.22.3. |
| FT-03 (fork) | `tests/e2e/fork.spec.ts` | 8 scenarios on chromium and mobile-360 (16 tests). Included in the 74 Playwright tests that passed on Node v24.22.3. |
| FT-03 (fork) | Reviewer sub-agents (see Multi-agent workflow) | Fork review: no blockers or majors, 8 findings, all fixed in migration `20261122120000`. Two independent `reviewer-opus` reviews covered this increment. |
| FT-03 (fork) | Node 24 `npm run check:ci` | Exit 0: lint, typecheck, unit, build, pgTAP, and Playwright passed on Node v24.22.3. |
| FT-11 | `scripts/generate-solar-scenarios.mjs` with `--check`, `tests/unit/solar.test.ts`, `tests/unit/analysis-props.test.ts` (fast-check, seed 20260514), pgTAP `009_analysis.test.sql` | Solar output checked against an independent NOAA implementation within 0.5°. `npm run check:solar` reports "solar scenarios match". A probe on a known canopy gave 326.05 m² (2.87%). Property checks for shadow vector, azimuth convention, and shadow ≤ reference surface. |
| FT-12 | `tests/unit/analysis-props.test.ts` (fast-check, seed 20260514), pgTAP `009_analysis.test.sql` (budget and v2-partial tests) | Property checks for low ≤ high and total equal to the sum of rounded lines. pgTAP covers pinning, partial results, and currency mismatch. Review fixes in `20261123030000`. |
| FT-07 | pgTAP `010_compare.test.sql` (113 tests), `tests/unit/compare-schema.test.ts` (24 tests), `tests/e2e/compare.spec.ts` (14 of 14) | Visibility matrix, incompatible inputs, self-comparison zero delta, chromium and mobile-360 with axe. The tester found an axe `scrollable-region-focusable` violation, fixed in the UI. |
| FT-07 | `scripts/perf-compare.mjs` (Node 26 host, production build) | 200 features per side, 100 modified. Cold start 1265 ms. Over 40 requests after 5 warm-up: p50 73 ms, p95 170 ms, max 198 ms (target ≤ 1500 ms). Payload 51,118 bytes. Not repeated on Node 24. |
| FT-08 | pgTAP `011_merge.test.sql` (292 tests), `tests/unit/merge-schema.test.ts` (31 tests), `tests/e2e/merge.spec.ts` (12 of 12) | Merge matrix (same change, disjoint, edit/edit, edit/delete, spatial across UUIDs, hidden source, stale head, already merged, replay). Demo with redraw and with remove, API matrix, keyboard, axe, and 360 px. The tester found a merge resolution without `conflictId` that raised 22023, fixed in `20261123060000`. |
| FT-08 | Reviewer sub-agent (`reviewer-opus`) | No blockers, 2 major and 6 minor or nit findings. All fixed in `20261123070000` and the UI (see `docs/progress.md`). |
| FT-16 to FT-18 (Spec 03) | Captures `docs/kiro-evidence/compare-1440.png`, `compare-390.png`, `merge-conflict-1440.png`, `merge-resolved-1440.png` | 0 px horizontal overflow at each captured width. The captures predate the CSS rule for `.publication-page > section`; the final `check:ci` run covers that rule. |
| FT-17 (Spec 03) | `npx --yes -p node@24 -c 'npm run check:ci'` after clean `supabase db reset` and `npm run provision:local` | Exit 0 on Node v24.22.3: lint, typecheck, unit (206 tests in 19 files), `check:solar`, build, pgTAP (852 tests in 11 files), Playwright (100 tests on chromium and mobile-360). |
| FT-09 (Spec 04) | Spec `.kiro/specs/04-community-moderation/` (requirements, design, and tasks 1 to 7 marked with evidence) | All seven tasks are marked complete in `tasks.md`, each with the evidence listed there. |
| FT-09 (Spec 04) | pgTAP `012_community_schema`, `014_comments_supports`, and `013_rate_limits` | Covers anchors, idempotency, one support per account, keyset pagination with microseconds, the `mine` flag, atomic rate-limit consumption, bucket boundaries, `FT429` with retry seconds, and no consumption on rejection or replay. Included in the 1957 pgTAP tests in 17 files that passed on Node v24.22.3. |
| FT-10 (Spec 04) | pgTAP `015_reports_moderation` and `016_hidden_effects` | Four users by eight functions: all denied with `P0002`, and nothing changed. After hiding, every public, compare, analysis, fork, merge, comment, support, and report path goes dark. Forks and merged revisions stay intact, and restoring reverses the effects. Included in the 1957 pgTAP tests. |
| FT-09, FT-10 (Spec 04) | Unit `tests/unit/community-schema.test.ts` and E2E `tests/e2e/community.spec.ts` | Included in the 276 unit tests in 20 files and the 115 Playwright tests of the Node v24.22.3 `check:ci` run (exit 0). The E2E file has 15 passed and 1 skipped by design (the rate-limit test runs on chromium only). The API matrix includes 12 parallel comment requests that give exactly 10 created and 2 rate-limited. |
| FT-09, FT-10 (Spec 04) | Review (`reviewer-opus`) | 10 findings, 3 major, all fixed in migration `20261124070000_community_review_fixes.sql` and in app code. |
| FT-10 (Spec 04) | Captures `docs/kiro-evidence/community-1440.png`, `community-390.png`, `moderation-1440.png` | 0 px horizontal overflow at each captured width. The moderation capture shows reports left by earlier local E2E runs, not real user data. |
| FT-09, FT-10 (Spec 04) | Node 24 `npm run check:ci` | Exit 0 on Node v24.22.3, after a clean `supabase db reset` and `npm run provision:local`: lint, typecheck, unit, `check:solar`, build, pgTAP, and Playwright passed. |
| FT-09, FT-10 (Spec 04) | Fast-check properties (R7) | `scripts/generate-support-properties.mjs`, seed 20260514, generates `supabase/tests/018_support_properties.test.sql` (243 assertions against `set_support`; 40 random plus 2 regression sequences). It passed with no counterexample; `npm run check:support` guards against drift. The R7 two-account story is scenario 1 of `tests/e2e/community.spec.ts`. |

## Multi-agent workflow

Agent definitions live in `.kiro/agents/`. Each phase of the editor and revision-save work used the agent listed below.

| Phase | Agent | Model | Output |
|---|---|---|---|
| Design of `save_revision` | `architect` | claude-opus-5.5 | Transaction and expected-head design for migration `20261122060000` |
| Tests | `tester` | `auto` | `supabase/tests/004_save_revision.test.sql` (29 tests), unit tests, `tests/e2e/editor.spec.ts` |
| Independent review | `reviewer-opus` | claude-opus-5.5 | Two medium findings (null snap-to-grid caused a 500 response; `get_branch_head` relied only on RLS) and several low findings, all fixed in migration `20261122070000` |
| Implementation and integration | Main session agent | Claude Opus 5.5 (session model; Claude Sonnet 5.5 had no confirmed ID) | Migrations, API routes, pure editor modules, editor UI, review fixes, and diff integration |
| Documentation | `docs-writer` | claude-haiku-5.5 configured in the profile; the runtime model was not confirmed | README, `docs/`, and Spec task status |
| FT-06 design | `architect` | claude-opus-5.5 | Publication rules: explicit immutable publication, RPC-only public reads, composite FK, branch lock, idempotency ledger, and Proxy gate (ADR 0002) |
| FT-06 tests | `tester` profile | `auto`, standing in for GPT-5.6 Luna (model ID not confirmed in Kiro) | pgTAP `006_publications.test.sql` and `007_publication_exists.test.sql`, unit tests, `tests/e2e/publication.spec.ts`; found the soft 404 defect |
| FT-06 review | `reviewer-opus` | claude-opus-5.5 | No blockers, 8 findings |
| FT-06 implementation | Main session agent | Claude Sonnet 5.5 requested; the session ran as Claude Opus 5.5 for part of this work | Migrations, API routes, public page, gate, and editor publish form |
| FT-06 documentation | `docs-writer` | claude-haiku-5.5 configured in the profile; the runtime model was not confirmed | Spec task 5 evidence, progress, ADR 0002, this file, and README |
| Fork design | `architect` | claude-opus-5.5 | Fork-from-publication design with six corrections, including the shared idempotency namespace and the `POST /api/v1/branches` union (ADR 0003) |
| Fork tests | `tester` profile | `auto`, standing in for GPT-5.6 Luna (model ID not confirmed in Kiro) | pgTAP `008_fork_publication.test.sql`, the updated `006`, unit branch-schema tests, and `tests/e2e/fork.spec.ts`. Found the constraint-introspection break |
| Fork review | `reviewer-opus` | claude-opus-5.5 | Two independent reviews. The fork review found no blockers or majors and 8 findings, all fixed in migration `20261122120000` |
| Fork implementation | Main session agent | Role requested Claude Sonnet 5.5. The session ran as Claude Opus 5.5 and Kimi K3 in parts; the Sonnet model ID was not confirmed | Migrations `20261122110000` and `20261122120000`, the fork API contract, the public fork form, the provenance line, and the review fixes |
| Fork documentation | `docs-writer` | claude-haiku-5.5 configured in the profile; the runtime model was not confirmed | Spec 02 task evidence, progress, ADR 0003, this file, and README |
| Spec 03 design | `architect` | claude-opus-5.5 | Design of solar scenarios, analysis, costs, compare, and merge (`.kiro/specs/03-analysis-compare-merge/design.md`) |
| Spec 03 tests | `tester` profile | `auto`, standing in for GPT-5.6 Luna (model ID not confirmed in Kiro) | pgTAP `009` to `011`, unit and property tests, `compare.spec.ts`, `merge.spec.ts`. Two runs were cancelled and relaunched as smaller tasks. Found the defects listed in `docs/progress.md` |
| Spec 03 review | `reviewer-opus` | claude-opus-5.5 | Merge review: no blockers, 2 major and 6 minor or nit findings, all fixed |
| Spec 03 implementation | Main session agent | Role requested Claude Sonnet 5.5. The session ran as Kimi K3 and Claude Opus 5.5 in parts; the Sonnet model ID was not confirmed | Migrations `20261123010000` to `20261123070000`, the compare and merge API routes, the compare and merge pages, and the demo scenario update |
| Spec 03 documentation | `docs-writer` | claude-haiku-5.5 configured in the profile; the runtime model was not confirmed | `docs/progress.md`, this file, ADR 0004, `docs/data-sources.md`, and README |
| Spec 04 design | `architect` | claude-opus-5.5 | Design of community and moderation: RPC-only reads, live alias, support as current state, database rate limits, hide and restore, and the audit log (`.kiro/specs/04-community-moderation/design.md`) |
| Spec 04 tests | `tester` profile | `auto`, standing in for GPT-5.6 Luna (model ID not confirmed in Kiro) | pgTAP `012` to `016`, unit and E2E tests. Four focused runs. Found the prototype-key lookup in `mapCommunityError` |
| Spec 04 review | `reviewer-opus` | claude-opus-5.5 | Community review: 10 findings, 3 major, all fixed in `20261124070000` and the app code |
| Spec 04 implementation | Main session agent | Role requested Claude Sonnet 5.5. The session ran as Claude Opus 5.5 and Auto; the Sonnet model ID was not confirmed | Migrations `20261124010000` to `20261124070000`, the ten API routes, the community and moderation UI, and the review fixes |
| Spec 04 documentation | `docs-writer` | claude-haiku-5.5 configured in the profile; the runtime model was not confirmed | `docs/progress.md`, this file, ADR 0005, and README |

The model IDs for GPT-5.6 Luna and Claude Sonnet 5.5 do not appear in the local Kiro records, so the tester phase uses `auto`. Kiro documents the profile `model` field but does not state that a sub-agent always runs with it, so profile models are recorded as configured, not as confirmed.

## Spec 05 dossiers (FT-13 to FT-15)

Only observed results appear here. Captures for dossier pages do not exist yet, so none are listed.

| Requirement | Evidence | Observed result |
|---|---|---|
| FT-13, FT-14 | `supabase/tests/019_dossier_schema.test.sql` and `supabase/tests/024_dossier_responsible_withdrawal.test.sql` | Included in the 2835 pgTAP tests in 24 files reported by the main session. The docs agent did not rerun them. |
| FT-13, FT-14 | Migrations `20261125010000` to `20261125060000` | Tables, RPCs, reads, the `SECURITY DEFINER` evidence trigger (`050`, found by E2E), and responsible withdrawal (`060`, after review). |
| FT-15 | `tests/unit/dossier-export.test.ts` and `tests/unit/geo-export.test.ts` | Included in the 462 unit tests reported by the main session. |
| FT-13 to FT-15 | `tests/e2e/dossier.spec.ts` | 20 tests passed on chromium and mobile-360, as reported by the main session. |
| FT-15 | Export route `src/app/api/v1/dossiers/[dossierId]/export/route.ts` | Sends `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and for HTML a CSP with the hash of the inline style. |
| FT-17 (Spec 05) | Node 24 `npm run check:ci` | Exit 0 on Node 24 after a clean reset: unit 462, pgTAP 2835 in 24 files, Playwright 135. |
| FT-13 to FT-15 | Captures in `docs/kiro-evidence/` | Pending. No dossier capture exists yet. |

Decisions and limitations: `docs/adr/0006-dossiers.md`.

### Agents and models (Spec 05)

| Phase | Agent | Model | Output |
|---|---|---|---|
| Design | `architect` | Opus, as stated in `.kiro/specs/05-dossiers/design.md` | Tables, write and read RPCs, exports, and the test plan |
| Tests | `tester` profile | `auto`, standing in for GPT-5.6 Luna (model ID not confirmed in Kiro) | pgTAP, unit, and `tests/e2e/dossier.spec.ts`. Found the trigger defect that pgTAP missed |
| Review | `reviewer-opus` | claude-opus-5.5 | Findings on responsible withdrawal, CSP and SVG style, uniform 404 codes, the 1 KiB verification limit, and export 404 outside the pilot site. All fixed |
| Implementation | Main session agent | Not recorded for this spec | Migrations `20261125010000` to `20261125060000` and the app code |

Profile models are the configured values. Kiro does not confirm the runtime model for each sub-agent call.

# 03 Analysis, compare and merge: design

Scope: FT-07, FT-08, FT-11, FT-12 per requirements.md. Design by the Opus architect, with two corrections against the current code: `get_public_publication` already filters by `sites.published` (migration 20261122110000), and `resolve_snapshot_ref` reuses that same rule.

## 1. Solar scenarios

- Versioned source: `data/sites/<slug>/solar-scenarios.json`, generated and committed. Fields: `{generator:"suncalc@<exact>", siteId, latitude, longitude (boundary centroid, 6 dp), scenarios:[{slug, localDatetime, timezone, instantUtc, azimuthRad, elevationRad}], excluded:[{slug, localDatetime, reason:"elevation_below_10deg"}]}`. Its sha256 lives in `manifest.json`.
- `scripts/generate-solar-scenarios.mjs` runs at build/CI time, never at runtime. A `--check` mode recomputes and fails if the JSON or checksum differs. `suncalc` is a devDependency pinned to an exact version.
- Convention: SunCalc measures azimuth from the south towards the west. We store `azimuthRad = mod(az + π, 2π)`, i.e. clockwise from north.
- Known-answer test (`tests/unit/solar.test.ts`): a fixed instant in Puebla against a NOAA reference value, 0.5° tolerance; the value's source is recorded in the fixture.
- Pilot scenarios (America/Mexico_City, UTC−6 all year in 2027): `equinox-1000` (2027-03-20T10:00) and `equinox-1600` (2027-03-20T16:00). `equinox-1900` appears in `excluded` (sun below the 10° minimum).
- Database load: generated SQL block `supabase/seeds/solar.sql`, added to `sql_paths`.
- Table `analysis_scenarios(id uuid pk, site_id fk, slug, local_datetime timestamp, timezone, instant_utc timestamptz, azimuth_rad numeric(9,6), elevation_rad numeric(9,6) check (elevation_rad >= radians(10)), generator, dataset_checksum, is_default, unique(site_id, slug))`.
- The table is immutable by trigger. A change ships under a new slug.

## 2. Spatial indicators (FT-11)

- One internal `analysis_compute(p_revision_id uuid null, p_baseline_id uuid, p_scenario_id uuid) returns jsonb`; no grants.
- One public wrapper `get_snapshot_analysis(p_ref text, p_scenario_slug text)`: a single visibility checkpoint, reused by `compare_revisions`.
- All math in `st_transform(geom, sites.metric_srid)`.
- Reference surface: `coalesce(pedestrian_area, boundary)`; the result carries `referenceSurface: "pedestrian_area" | "boundary_fallback"` (the pilot seed leaves `pedestrian_area` null).
- Shade: `d = H / tan(elevation)`; `dx = -d·sin(azimuth)`, `dy = -d·cos(azimuth)`. Tree: `st_translate(st_buffer(pt, canopyDiameterM/2, 'quad_segs=8'), dx, dy)` with `H = heightM`. Canopy: translated polygon. `st_union`, clip with `st_intersection` against the reference; return `shadeM2` and `shadePct` under one denominator. Label "modeled shade of the inventoried elements" while `sites.completeness = 'partial'`.
- Occupancy per `timeSlot`: `st_union` of `temporary_market` polygons; `areaM2`, `stallCount`, `fitByArea = Σ floor(area_i / moduleM2)` (preliminary), `remainingM2`, `crossingLengthM`. `affectedParking` is `null` with `reason: "no_parking_inventory"`.
- Every result carries `engineVersion` (`analysis_engine_version()` = `'ft-analysis@1'`) and `inputs: {baselineId, baselineVersion, scenarioSlug, datasetChecksum, catalogVersionId}`.
- v1 computes on each read, no cache. Inputs are immutable, so `revision_metrics` can be added later if p95 exceeds 1.5 s.

## 3. Costs (FT-12)

- Tables:
  - `catalog_versions(id, site_id, currency, version, effective_from timestamptz, source, price_date, is_illustrative, assumption_owner, checksum)`.
  - `catalog_items(catalog_version_id, code, kind intervention_kind, unit enum('u','m','m2','jornada'), quantity_formula text, price_low_cents bigint, price_high_cents bigint, is_assumption, assumption_owner, assumption_date, check (price_low_cents <= price_high_cents))`. Null prices mean an unpriced concept.
- Source: `data/catalogs/<site>-v<n>.json` with checksum, loaded by seed. Both tables append-only by trigger. An insert trigger requires `effective_from >= now()`, so versions cannot be backdated.
- Pinning by revision: the catalog with the latest `effective_from <= revisions.created_at`. Save, fork, and publish stay untouched; historical values never change.
- Line items from the baseline delta (the pilot baseline has no features, so everything is "add"): tree `u` = 1; canopy `m2` = area; market `jornada` = stallCount; crossing `m2` = length · widthM. Quantities numeric, 2 dp.
- Rounding: `round(qty · price_cents)` on numeric, half-up, per line and per extreme; totals sum rounded lines. All computed in the DB; integer cents returned.
- Unpriced/missing concepts become lines with `status: "unpriced"`, listed in `unknownConcepts`; the result carries `partial: true` and never counts them as zero.
- Currency mismatch between catalog and site → `currency_mismatch`, no totals.
- Budget label: `"fully_illustrative" | "partially_illustrative" | "sourced"`, with assumption owner and date per line.

## 4. Compare (FT-07)

- `compare_revisions(p_left text, p_right text, p_scenario_slug text null) returns jsonb`, SECURITY DEFINER, granted to `anon` and `authenticated`.
- References: `publication:<uuid>` (visible, published site), `baseline:<uuid>` (of a published site), `revision:<uuid>` (only when `auth.uid()` owns the branch and it is not deleted). Foreign revision ids are never accepted; an invisible ref returns 404 `snapshot_not_found` identically on both sides.
- The baseline acts as a synthetic empty snapshot plus its reference surface.
- Response: `{siteId, baselineId, scenario, engineVersion, left:{ref, catalogVersionId, analysis, cost}, right:{…}, counts:{equal, added, removed, modified}, features:[{id, class, kindChanged, propertiesChanged, geometryChanged, changedKeys, left, right}], metricDeltas, catalogCompatible, costDelta|null}`.
- Equality: `jsonb =` for properties, `st_equals` for geometry. Different catalogs → `costDelta` null, each side keeps its totals.
- Errors: different site or baseline → 422 `incompatible_snapshots`; malformed ref → 400.
- `Cache-Control: no-store`, since moderation can hide one side.

## 5. Merge (FT-08)

### Ancestor

- Recursive CTE over `parent_revision_id` per side (`cycle id set is_cycle`), limit 256 per side.
- The first node of the source chain that also appears in the target chain is the ancestor; linear chains make it unique.
- No shared node and both chains reaching the same baseline → the synthetic empty baseline ancestor.
- Limit exhausted → 422 `ancestor_limit_exceeded`, no baseline fallback.

### Preview

- `merge_preview(p_branch_id, p_source_publication_id) returns jsonb`, STABLE, owner only.
- Response: `{ancestor:{kind:"baseline"|"own_revision"|"publication"|"private_revision", id?}, operations:[{featureId, origin:"target"|"source"|"both"|"ancestor", action}], conflicts:[…], blocking:[…], featureCount}`. The ancestor carries an id only when own (revision id) or public (publication id).
- Conflicts: `{id:"element:<fid>", type:"edit_edit"|"edit_delete", target, source, ancestor}` and `{id:"spatial:<minFid>:<maxFid>", type:"exclusive_overlap", featureIds, timeSlot, intersectionM2, thresholdM2}`.
- Exclusive zones v1: `shade_canopy` (permanent footprint) against any `temporary_market`; `temporary_market` against `temporary_market` with the same `timeSlot`; `shade_canopy` against `shade_canopy`.
- Threshold: new column `sites.merge_overlap_threshold_m2 numeric not null default 1.0`. Absolute m² because a fraction changes with element scale.
- An overlap blocks when one side is `target` and the other `source`, or either is `resolved`. Pre-existing overlaps within one side are `warnings`.

### Commit

- `merge_commit(p_branch_id, p_source_publication_id, p_expected_head_id, p_message, p_resolutions jsonb, p_idempotency_key, p_payload_hash)`.
- Resolutions: `{conflictId, action:"keep_target"|"keep_source"|"remove"|"redraw", featureId?, feature?}`. Element conflicts accept keep_target, keep_source, and remove; spatial conflicts accept remove (with `featureId` of the pair) and redraw (a complete `feature` of the pair, revalidated). As implemented in migrations 050000 and 070000.

Steps, in order:

1. Session and argument shape (≤512 KiB, ≤400 resolutions).
2. Advisory lock `actor:merge_commit:key`; its own namespace so a merge key never collides with save.
3. Replay; different hash → FT001 → 409.
4. `publications ⨝ sites FOR SHARE` (visible, published) → else 404 `publication_not_found`.
5. `branches FOR UPDATE` (owner, not deleted) → else 404.
6. Head equals expected → else FT409 → 409.
7. Same site and baseline → else 422 `merge_incompatible`.
8. Source already an ancestor of the head → 422 `nothing_to_merge`; any head-chain revision already has that `merge_parent_revision_id` → 422 `already_merged`.
9. Ancestor, three-way classification, spatial check.
10. Every conflict has exactly one valid resolution; missing → 422 `unresolved_conflicts` with ids; extra or mismatched → 422 `invalid_resolution`.
11. Redrawn features pass `normalize_feature_input(jsonb, int)`, extracted from `save_revision` (which is recreated to call it).
12. Final spatial check and ≤ 200 features → else 422 `too_many_features`.
13. Insert revision with `parent = head`, `merge_parent_revision_id = source revision`; feature rows copied exactly (no re-trim); the containment trigger maps 23514 → 422 `feature_outside_site`.
14. Insert `revision_merge_decisions`, advance head, write `mutation_requests (operation = 'merge_commit')`.

Decisions live apart so `revisions` stays narrow and the private ancestor id stays hidden: `revision_merge_decisions(revision_id pk fk, source_publication_id, source_revision_id, ancestor_revision_id null, ancestor_kind, engine_version, decisions jsonb, created_at)`, immutable. As implemented, `authenticated` has column-level select on every column except `source_revision_id` and `ancestor_revision_id`, behind an owner-only RLS policy, so `get_branch_head` can report merge provenance.

Lock order: publication → site → branch. `save_revision` and `publish_revision` only lock the branch, so no cycle.

## 6. Migrations

- `20261123010000_analysis_catalog.sql`: `analysis_scenarios`, `catalog_*`, threshold column, `analysis_engine_version`, `analysis_compute`, `get_snapshot_analysis`, `compare_revisions`, internal `resolve_snapshot_ref` (no grants).
- `20261123020000_merge.sql`: `normalize_feature_input` + recreated `save_revision`, `revision_merge_decisions`, `merge_preview`, `merge_commit`, partial index `revisions(merge_parent_revision_id) where merge_parent_revision_id is not null`.
- Grants: revoke all, then per function (compare/analysis to anon + authenticated; merge to authenticated). RLS enabled with no policies on the new tables.
- Indexes: the existing GiST suffices. The combined set lives in a materialized CTE (≤400 rows): `&&` prefilter in 4326, area in the metric SRID (~40k bbox comparisons worst case).

## 7. Property tests

- fast-check pure in `tests/unit/` (SEED 20260514): rounding/totals (low ≤ high, total = sum of rounded lines), azimuth convention, shadow vector.
- fast-check against the local DB in `tests/db-props/` inside `test:db`, numRuns 25–50, recorded seed: self-comparison zero delta; disjoint changes preserve both edit sets; shadow ≤ reference surface; merge replay adds no revisions; comparing never changes snapshots.
- Counterexamples saved to `tests/fixtures/regressions/` and replayed in pgTAP.
- pgTAP (`009_analysis`, `010_compare`, `011_merge`): known-answer spatial fixtures, permissions, revocations, visibility matrix, stale head, hidden source, idempotency race.

## 8. Risks and edge cases

- Cycles: impossible by FK + immutability + earlier parent; `CYCLE` and the 256 limit regardless.
- Source hidden between preview and commit → 404 without effects. Hidden after commit: the derivative stays; public reads show `mergeSource: {state: "unavailable"}` with no id.
- Containment: same baseline means same boundary; the trigger covers the rest.
- 200-feature limit reported in preview as `blocking`; a `remove` resolution can bring it down.
- Trim parity: copies are exact; redraws go through `js_trim`.
- Re-merge after rejecting a change: without `already_merged`, the primary-parent ancestor would reintroduce the rejected change.
- Fixture note: `data/sites/zocalo-puebla/scenario.geojson` uses `heightMeters` and lacks `moduleM2`; it must be adapted to the current property contract before the E2E demo.
- Pilot SRID EPSG:32614 is `pending-validation` in the manifest; record the validation and the 10° elevation threshold in an ADR.
- Performance fixture: 25 revisions × 200 features for the p95 comparison target.

# ADR 0004: Analysis, comparison and three-way merge

- **Status:** Accepted for Spec 03 (FT-07, FT-08, FT-11, FT-12)
- **Date:** 2026-11-22 (Spec 03 closure)

## Context

Spec 03 adds three things to the proposal flow: spatial indicators (shade, occupancy, crossing length), a cost range from a price list, and comparison and merge of two public or private revisions of the same site. The demo story is fixed by the plan: proposal A adds shade, proposal B adds temporary market stalls over part of the same surface, and a third participant merges both with a resolved spatial conflict and keeps both parents.

The main constraints are provenance (a published revision never changes), the distinction between observed data and hypothetical scenarios, and deterministic results that a reviewer can recompute.

## Decision

### 1. Solar positions are precomputed and the scenarios are immutable

- `scripts/generate-solar-scenarios.mjs` computes solar positions with `suncalc` 1.9.0, pinned as an exact devDependency, at build time. The runtime never computes the sun.
- The output is `data/sites/zocalo-puebla/solar-scenarios.json`. Its SHA-256 is in `manifest.json`. `npm run check:solar` recomputes the file and fails on any difference.
- Azimuth is stored clockwise from north (`mod(az + π, 2π)`). SunCalc measures from south toward west, so the conversion is explicit.
- Pilot scenarios use America/Mexico_City on 2027-03-20:
  - `equinox-1000` at 10:00 (azimuth 1.94519 rad, elevation 0.804819 rad).
  - `equinox-1600` at 16:00 (azimuth 4.440486 rad, elevation 0.654517 rad).
  - `equinox-1900` is excluded because the sun is below 10° elevation. Exclusions carry a reason.
- The known-answer test in `tests/unit/solar.test.ts` compares against an independent NOAA implementation with a 0.5° tolerance. The two values agree within that tolerance.
- The table `analysis_scenarios` is immutable by trigger. A change to a scenario ships under a new slug.

### 2. Shade model with one denominator

- Shadow displacement is `d = H / tan(elevation)`, with `dx = -d·sin(azimuth)` and `dy = -d·cos(azimuth)`.
- A tree is a canopy disc of catalog diameter at catalog height, translated by that vector. A canopy is its polygon, translated.
- Shadows are unioned, then clipped to the reference surface. The result reports m² and percent with the same reference denominator.
- The method assumes flat ground and ignores buildings. The result is labeled "modeled shade of the inventoried elements" while the site is marked partial.

### 3. Metric SRID and reference surface

- All area and length math runs in the site's metric SRID, EPSG:32614 for the pilot. The manifest still marks this projection `pending-validation`.
- The reference surface is `coalesce(pedestrian_area, boundary)`. The pilot has no pedestrian-area layer, so every result reports `referenceSurface: "boundary_fallback"`.
- `fitByArea` is preliminary and is labeled as such.
- Parking is absent, so `affectedParking` is `null` with reason `no_parking_inventory`.

### 4. Costs: pinned by effective date, rounded per line

- A catalog version applies to a revision when `effective_from <= revision.created_at`. The latest such version wins. Saved, forked, and published revisions keep their values.
- Catalog versions are append-only. An insert trigger rejects a past `effective_from` unless the seed sets a bootstrap setting, so a version cannot be backdated.
- Amounts are integer cents. Each line rounds `quantity × unit price` half-up, separately for the low and high price. Totals sum the rounded lines.
- A concept without a price becomes an `unpriced` line and is listed in `unknownConcepts`. The result is `partial`. An unknown concept is never counted as zero.
- A currency mismatch between catalog and site returns no totals.
- The pilot catalog is fully illustrative (see `docs/data-sources.md`). Every output carries that label.

### 5. Comparison uses one visibility checkpoint

- `resolve_snapshot_ref` is the only parser of snapshot references. It is internal and has no grant to `anon` or `authenticated`.
- Accepted references are `publication:<uuid>` (visible publication on a published site), `baseline:<uuid>` (baseline of a published site), and `revision:<uuid>` (a revision on the caller's own, non-deleted branch).
- `compare_revisions` and `get_snapshot_analysis` are the public entry points. Both call the same resolver, so a hidden reference and a missing one give the same `snapshot_not_found` (404).
- Different sites or different baselines return `incompatible_snapshots` (422).
- Different catalog versions disable the cost delta. Each side keeps its own totals.
- The API `GET /api/v1/compare` sends `Cache-Control: no-store`, because moderation can hide one side.

### 6. Three-way merge rules

- The ancestor is the first revision on the source's primary-parent chain that also appears on the target's chain. The chain walk is limited to 256 steps per side. If the limit is reached, the merge returns `ancestor_limit_exceeded` and does not fall back to the baseline.
- If the two chains share no revision but reach the same baseline, the ancestor is the empty baseline.
- Each feature is classified by comparing target, source, and ancestor:
  - One side changed: keep that change.
  - Both sides made the same change: keep it once.
  - Both sides changed differently, or one side edited while the other deleted: conflict.
- Geometry is never adjusted automatically. The owner resolves each conflict with `keep_target`, `keep_source`, `remove`, or `redraw`. A `redraw` carries a complete new feature that passes the same validation as a save.

### 7. Exclusive zones and the blocking rule

- Spatial conflicts run on the combined feature set, including features with different UUIDs.
- Exclusive pairs in v1:
  - `shade_canopy` against `temporary_market`.
  - `temporary_market` against `temporary_market` in the same `timeSlot`.
  - `shade_canopy` against `shade_canopy`.
- Shade alone never conflicts. Only occupation zones do.
- An overlap counts when its intersection area exceeds `sites.merge_overlap_threshold_m2`, which defaults to 1.0 m². The threshold is absolute because a fraction would change with feature size.
- An overlap blocks the merge when one feature comes from the target and the other from the source, or when either feature is `resolved`.
- Overlaps between two features that already coexist on one side are warnings. They do not block.

### 8. Resolution happens in rounds

- A redraw can create a new overlap with a feature that was not in conflict before. The preview lists such overlaps and lets the owner resolve them in a later round.
- Each commit recomputes the classification and the spatial check on the server. Resolution IDs must match the current conflict IDs exactly.

### 9. Commit steps and lock order

- `merge_commit` runs these steps in one transaction:
  1. Check session and argument size (512 KiB, 400 resolutions).
  2. Take an advisory lock in a merge namespace, separate from save.
  3. Replay the same key and payload hash, or return a conflict for a different hash.
  4. Lock the source publication and site (`FOR SHARE`). Hidden or missing sources return `publication_not_found`.
  5. Lock the branch (`FOR UPDATE`) and check owner and deletion state.
  6. Check the expected head. A stale head returns 409 `stale_head` before any domain check.
  7. Check the same site and baseline (`merge_incompatible`).
  8. Refuse a source that is already an ancestor of the head (`nothing_to_merge`), and refuse a source that a head-chain revision already merged (`already_merged`).
  9. Classify features, run the spatial check, and check resolutions (`unresolved_conflicts`, `invalid_resolution`).
  10. Validate each redraw with `normalize_feature_input`, which is extracted from the save path.
  11. Repeat the spatial check on the final set and enforce the 200-feature limit (`too_many_features`).
  12. Insert the revision with the head as parent and the source revision as `merge_parent_revision_id`. Feature rows are copied exactly.
  13. Insert the decision record, advance the head, and write the mutation ledger entry.
- Lock order is publication, then site, then branch. `save_revision` and `publish_revision` lock only the branch, so they cannot form a cycle with merge.
- The preview uses a bounding-box prefilter before exact geometry work, and returns at most 512 KiB of preview data.

### 10. Decision record and grants

- Merge decisions live in `revision_merge_decisions`, separate from `revisions`. This keeps the private ancestor ID out of ordinary revision reads.
- The table is immutable: update, delete, and truncate are rejected.
- Row-level security is enabled. `anon` and `authenticated` have all table privileges revoked. `authenticated` gets `select` on these columns only: `revision_merge_decisions(revision_id, source_publication_id, ancestor_kind, engine_version, decisions, created_at)`. The ancestor and source revision IDs are not granted.
- A select policy limits reads to the owner of a non-deleted branch.
- Grants per function (from the migrations):
  - `compare_revisions`, `get_snapshot_analysis`: `anon`, `authenticated`.
  - `merge_preview`, `merge_commit`, `get_branch_head`: `authenticated`.
  - `resolve_snapshot_ref`, `analysis_compute`, `cost_compute`: no grant to `anon` or `authenticated`.

## Consequences

- A comparison or merge never changes a snapshot. Its result can be recomputed from the same revision IDs and scenario.
- Analysis results carry the engine version and inputs, so a reviewer can see which data produced a number.
- Results are computed on each read. Inputs are immutable, so a cache can be added later if the p95 target fails. The measured p95 does not require one (see Limitations).
- A merge with a hidden source keeps the changes it already materialized. The UI reports that the source is no longer available. The derivative can be moderated as independent content.
- Repeating the same merge request does not add a revision.

## Deviations from the design

- `normalize_feature_input` repeats the checks of `save_revision` instead of replacing them with a shared call. This leaves the save path, which was already tested, unchanged. pgTAP checks that both paths reject the same inputs.
- The design (section 5 of `.kiro/specs/03-analysis-compare-merge/design.md`) describes a redraw as `keep_*` plus a feature. The implementation uses a separate action named `redraw`. The implementation is the current contract.

## Limitations

- **Ancestor search** follows primary parents only. This is the v1 rule in the plan.
- **Re-merging the same source** is refused with `already_merged`.
- **Shared validation** is duplicated (see deviations). Extracting it is a later refactor.
- **Reference surface** is the boundary fallback, because no pedestrian-area layer exists for the pilot.
- **Parking** is not inventoried, so `affectedParking` is `null`.
- **Projection** EPSG:32614 is still `pending-validation` in the manifest.
- **Elevation threshold** is 10°. Below it, scenarios are excluded.
- **Performance** was measured on the Node 26 host, not on Node 24. The check run on Node 24 passed, but the timing run was not repeated there.

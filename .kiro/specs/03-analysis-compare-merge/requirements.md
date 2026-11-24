# 03 Analysis, compare and merge: requirements

## Scope

This specification covers FT-07, FT-08, FT-11, and FT-12. FT-02 and FT-16 remain cross-cutting requirements. It depends on Spec 02: branches, immutable revisions, publications, and forks exist.

The demo story is fixed by the plan: proposal A adds shade, proposal B adds temporary market stalls over part of the same surface, and a third participant merges them with a resolved spatial conflict, keeping both parents.

### R1 — Spatial analysis (FT-11)

**When** a visible revision is read, **the system shall** compute spatial indicators with inspectable formulas and inputs.

- Modeled shade: precomputed solar position for curated site scenarios (IANA timezone date/time, UTC instant, latitude, longitude); azimuth clockwise from north and elevation in radians; shadow displacement `H / tan(elevation)` opposite the sun (`-d·sin(azimuth)`, `-d·cos(azimuth)`); tree as canopy disc at catalog height, canopy as translated polygon; union shadows, clip to the reference pedestrian surface, and report m² and percent under one denominator.
- Scenarios are limited to solar elevation of at least 10°; out-of-range cases carry an explanation. At least two curated moments capture variation.
- The method assumes flat ground and ignores buildings; partial inventory is labeled "modeled shade of the inventoried elements" with incomplete coverage highlighted.
- Occupancy: polygons unioned per time slot to avoid double counting; reference area, proposed stall count, affected parking spots when inventory exists, crossing length, and remaining surface in scope. Fit-by-area is labeled preliminary.
- Every result records engine version, input data version, and scenario. Incomplete values and sample data are visibly marked.

### R2 — Costs (FT-12)

**When** a visible revision is compared against its baseline, **the system shall** compute a cost range from a price list pinned by revision.

- Line items derive from the delta against the baseline (add, modify, or remove when a concept exists); each keeps unit (`u`, `m`, `m²`, `jornada`), quantity, formula, catalog code, unit price range, and price date.
- Line amount equals quantity times the lower and upper unit price; totals sum the rounded lines under a published rounding rule; money uses `numeric` or integer cents per the contract.
- A concept without a price makes the result partial; unknown concepts are listed, never treated as zero. Currencies are never mixed.
- Illustrative prices are labeled "evaluation assumption" with date and owner of the assumption; a fully illustrative budget is labeled as such on screen and in exports.
- Comparing revisions with different catalog versions requires an explicit common context or disables the price delta; historical values remain readable.

### R3 — Compare two revisions (FT-07)

**When** a visitor selects two visible revisions of the same site (baseline or revision on each side), **the system shall** show added, removed, and modified features with their costs, quantities, coverage, and provenance, on a map and in a table.

- Join by feature ID and classify equal, added, removed, or modified; a modification flags property and/or geometry changes.
- Counts per class and metric deltas are shown; the UI never confuses "exists on the site" with "present in a proposal".
- The comparison of a revision with itself has a zero delta; comparing never changes snapshots.
- Incompatible inputs (different site or baseline, different catalog versions) are reported as such or resolved with an explicit common context.
- The table works with keyboard and screen reader and does not depend on the map; the legend distinguishes existing, added, removed, and conflict with icon or pattern besides color.
- Performance target: comparison completes in ≤ 1.5 s at p95 over at least 30 representative requests in the test environment, excluding cold start, reported separately.

### R4 — Merge a public revision into an own branch (FT-08)

**When** the owner of a private branch previews a visible public revision of the same site with a common ancestor, **the system shall** integrate compatible changes, surface conflicts, and let the owner resolve them before one atomic server-validated commit.

- Three-way merge requires the same site and the same baseline. The nearest common ancestor follows the primary-parent chain with deterministic order and a traversal limit; without an admissible ancestor the merge reports incompatibility. No arbitrary history traversal or source reclassification by date.
- Element rules: one side changed → keep that change; both made the same change → keep it once; both changed differently → require resolution; edit against delete is also a conflict.
- Spatial conflicts run on the combined set even across different feature UUIDs: exclusive occupation zones for one time slot (intersection area above the site threshold, both elements identified). Projected shade alone does not conflict. The demo case is a canopy with documented exclusive zone and stalls in the same slot over that zone.
- Resolutions are keep one, remove one, or move/redraw and revalidate; geometry is never auto-adjusted.
- The commit recomputes comparison and rules server-side with the exact IDs, checks permissions and the source publication's visibility inside the transaction, verifies the expected head, applies resolutions, and writes one atomic revision with both parents and a decision summary, preserving authors. Missing resolutions or a stale head abort without side effects.
- Merging a source that is later hidden does not delete already materialized changes; the UI shows the reference became unavailable and the derivative can be moderated as independent content.
- Repeating the same merge request does not add revisions.

### R5 — Evidence and property tests

**When** this spec is delivered, **the system shall** keep green: property tests with recorded seeds for self-comparison zero delta, disjoint changes preserving both edit sets, shadow union never exceeding the pedestrian area, budget lower ≤ upper with totals matching rounded lines, and merge repetition never adding revisions; known-answer spatial fixtures; and the full E2E merge demo (A shade, B stalls, conflict, resolution, both parents).

# Data sources and provenance

## Plaza de la Constitución boundary

- **Source:** OpenStreetMap via Nominatim search API
- **Object:** way `528509571`
- **Retrieved:** 2026-11-22 UTC
- **Source URL:** `https://nominatim.openstreetmap.org/search?format=jsonv2&q=Z%C3%B3calo%20de%20Puebla%2C%20Puebla%2C%20Mexico&limit=5&polygon_geojson=1`
- **License:** Open Database License 1.0 (ODbL), attribution to OpenStreetMap contributors
- **Raw capture:** `data/sites/zocalo-puebla/sources/osm-nominatim-search.json`
- **SHA-256:** `1c2ab5800578895d7a4be092704de1e9bcf9c9e1032b17ca1d34daac10bfa1e7`
- **Use:** Establish the pilot square boundary and location only.
- **Completeness:** Partial. It does not prove pedestrian surface, trees, parking, protected areas, temporary commerce, accessibility conditions, or current interventions.

See [OpenStreetMap copyright and license](https://www.openstreetmap.org/copyright) and [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/).

## Demonstration scenario

`data/sites/zocalo-puebla/scenario.geojson` is authored for this project. Its shade and market features are hypothetical fixtures used to demonstrate comparison and conflict handling. They are not observations or municipal proposals.

## Rejected or pending sources

No PMTiles extract or inventory layer has been accepted yet. Any future source must document retrieval date, license, attribution, geographic extent, projection, completeness, and checksum before entering the reference baseline.

## Solar scenarios (computed, not observed)

- **Object:** `data/sites/zocalo-puebla/solar-scenarios.json`
- **Generator:** `scripts/generate-solar-scenarios.mjs` with `suncalc` 1.9.0, pinned as an exact devDependency. Regenerate with `npm run generate:solar`. Verify with `npm run check:solar`, which fails on any difference.
- **Type:** Computed sun positions. They are model inputs, not observations.
- **Scenarios:** `equinox-1000` and `equinox-1600`, both on 2027-03-20 in America/Mexico_City. Azimuth is stored clockwise from north, and elevation in radians.
- **Excluded:** `equinox-1900`, because the sun is below the 10° elevation minimum.
- **Validation:** An independent NOAA implementation agrees within 0.5° (`tests/unit/solar.test.ts`).
- **Checksum (SHA-256):** `77c5a5b43fab4c22554dd7b187e401e0cc69974b764090c27d22a58da182d1fd`, recorded in `manifest.json` under `checksum.solarScenarios`.
- **Limits:** Assumes flat ground and ignores buildings. The `suncalc` license is not yet listed in `THIRD_PARTY_NOTICES.md`.

## Illustrative cost catalog (evaluation assumption)

- **Object:** `data/catalogs/zocalo-puebla-v1.json`, loaded by the seed.
- **Status:** Fully illustrative evaluation prices. This is not a supplier quote, a municipal price list, or a market survey.
- **Price date:** 2026-11-22.
- **Owner of the assumption:** "Equipo del piloto Fork the City".
- **Currency:** MXN, matching the site currency in `manifest.json`.
- **Checksum (SHA-256):** `debf6ae1aa5503d06cec1ff47dfb936e07b1ebf0c9e523e20207fd7bf6a3e5ce`. The checksum block in `manifest.json` does not list this file yet.
- **Use:** Cost ranges in compare results. The budget is labeled as fully illustrative, and each line keeps its unit, quantity, catalog code, and price date.
- **Pinning:** A revision uses the latest catalog version whose `effective_from` is at or before the revision's creation time. Catalog versions cannot be backdated.

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

## Entorno cartográfico del Zócalo

- **Archivo:** `data/sites/zocalo-puebla/osm-context.geojson`. Recorte de la [API de OpenStreetMap](https://api.openstreetmap.org/api/0.6/map?bbox=-98.19935,19.04275,-98.19685,19.04455), recuperado el 26 de noviembre de 2026 a las 00:47 UTC.
- **Selección:** 9 tramos de calle, 49 tramos marcados como vías peatonales o escalones, 6 geometrías de cruce y 41 contornos de edificios representados como vías cerradas. Se conservan los identificadores de OSM, los nombres disponibles y la geometría en EPSG:4326. Licencia ODbL 1.0, atribución a OpenStreetMap contributors.
- **SHA-256:** respuesta de origen `90ff8f98a901bf2192e6b23f7fe5a62008ca73bbb40fd00967886a64c62b7a7a`. GeoJSON derivado `cadd3fbc6a2d9ae5077e9d15b228f708f8962ad24d6ab2aa11b29458b36bbed9`.
- **Cobertura parcial.** Capa de referencia para ubicar propuestas. Los cruces que evalúa la fusión son intervenciones hipotéticas dibujadas por el usuario, con el ancho introducido en el editor. El recorte carece de un inventario verificado de anchos y condiciones de accesibilidad.
- **Visor 3D del terreno.** Al activar la capa, el navegador consulta vías y edificios por zona aproximada. El recorte incluido se usa en el Zócalo cuando la respuesta en línea falta o queda vacía. La posición se aproxima con el centro del croquis y el norte arriba, y las alturas provienen de etiquetas disponibles o de una estimación. El guardado y el cálculo solar usan los objetos propuestos del croquis. [Consulta de zonas en Overpass](https://dev.overpass-api.de/overpass-doc/en/full_data/bbox.html), [licencia y atribución de OpenStreetMap](https://www.openstreetmap.org/copyright).

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

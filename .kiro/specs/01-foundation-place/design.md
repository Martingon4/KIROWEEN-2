# 01 Foundation and pilot place: design

## Decisions

1. **Runtime:** Next.js 16.4.6 App Router with React 19.3, TypeScript 5.9 strict, Tailwind 4.3, npm, and a Node 24 target. The current machine is Node 26, so Node-24 parity remains a recorded validation item.
2. **Rendering:** catalog and place facts are Server Components. MapLibre will be isolated in a small Client Component later; the first slice renders an accessible SVG schematic and a textual feature list from local GeoJSON.
3. **Internationalization:** locale is a route segment. `/` redirects to `/es`; messages live in `src/messages`. Spanish is the default and English has the same information architecture.
4. **Data:** the OSM Nominatim response is retained unchanged under `data/sites/zocalo-puebla/sources/`. A derived baseline GeoJSON holds only the selected square geometry plus source metadata. Hypothetical demo interventions live in a separate scenario GeoJSON.
5. **Database:** Supabase/PostGIS is initialized in the repository, but the first UI can run without Docker. PostGIS is installed in `extensions`; public projections and RLS precede authenticated writes.
6. **Visual direction:** civic field notebook rather than generic SaaS dashboard. Navy ink, blue action color, off-white paper, map grid/linework, Atkinson Hyperlegible, square geometry, one composed place view. Pink/cursive output from the first automated design query was rejected as unrelated to civic planning and retained only as an experiment record.

## Data flow

```text
immutable source capture
        ↓ derive + validate
baseline.geojson ──→ site catalog adapter ──→ Server Component / public API
scenario.geojson ──→ explicit hypothetical layer ─┘
                                             ↓ later
                                    MapLibre Client Component
```

## Public site shape

```ts
type PublicSite = {
  slug: string;
  name: { es: string; en: string };
  locality: string;
  timezone: string;
  currency: "MXN";
  source: { label: string; url: string; license: string; retrievedAt: string };
  completeness: "partial" | "reviewed";
  baseline: GeoJSON.FeatureCollection;
  scenario: GeoJSON.FeatureCollection;
};
```

Only this explicit projection reaches public UI. No Auth or private branch fields are part of the type.

## Initial routes

- `/` redirects to `/es`.
- `/[locale]` shows the pilot catalog and the baseline/scenario distinction.
- `/api/v1/sites` returns the public catalog through a stable envelope (first API task).

The detailed place route, authentication, and database-backed reads follow after the foundation slice.

## Error contract

```json
{
  "code": "site_not_found",
  "message": "No encontramos ese lugar.",
  "requestId": "..."
}
```

Public messages are localized by code. SQL diagnostics, secrets, cookies, and private identifiers never enter the response.

## Accessibility

- Skip link, semantic landmarks, ordered headings, visible focus, and 44 px controls.
- The SVG is supplemental and has a concise accessible name; the adjacent list carries the detailed information.
- Reference versus proposal uses labels, stroke patterns, and text as well as color.
- Motion is limited to direct interaction and disabled under `prefers-reduced-motion`.

## Verification

- Unit tests validate locale parsing, public projection, source/scenario labels, and GeoJSON coordinate bounds.
- Component tests verify headings and non-color status text.
- Build verifies route types and Server/Client boundaries.
- Playwright later checks 360 px, keyboard order, basemap failure, and both locales.
- pgTAP later verifies PostGIS schema, public read projection, RLS, and private draft isolation.

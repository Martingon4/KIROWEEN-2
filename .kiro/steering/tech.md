---
inclusion: always
---

# Fork the City: technology and quality rules

## Runtime and framework

- Node.js 24 LTS is the target runtime. `.nvmrc` and `package.json#engines` must keep that major explicit. The current development machine has Node 26; record the mismatch until validation runs on Node 24.
- Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS 4, npm with committed `package-lock.json`.
- Read the relevant installed guide under `node_modules/next/dist/docs/` before using a Next.js API. Dynamic `params` and `searchParams` are promises in this version.
- Server Components are the default. Add `"use client"` only at the smallest boundary requiring state, events, or browser APIs such as MapLibre.
- API handlers live under `src/app/api/v1/**/route.ts` and use Web Request/Response APIs.

## Data and geospatial rules

- Supabase PostgreSQL with PostGIS installed in the `extensions` schema, never `public`.
- GeoJSON input is finite 2D WGS84 (`EPSG:4326`). Editing supports Point, simple LineString, and simple Polygon without holes in v1.
- Server/database code validates site containment, topology, type-specific properties, permissions, expected branch head, and idempotency.
- Immutable revisions use complete snapshots. Changes to schema happen only through reviewed migrations.
- Real source data and demonstration fixtures remain in separate files with source, license, capture date, completeness, and checksum.

## Security and privacy

- Enable RLS on every exposed table. Public reads use restricted projections or explicit RPCs; never expose `auth.users`.
- Keep service-role keys and provisioning credentials out of browser code, logs, and version control.
- Validate environment variables with Zod at their trust boundary.
- Treat titles and comments as plain text. Protect CSV exports from formula injection. External links require HTTPS and `noopener noreferrer`.
- Complex writes are transactional. A `SECURITY DEFINER` function uses an empty `search_path`, fully qualified object names, and explicitly revoked/granted execution.

## UI and accessibility

- Meet WCAG 2.2 AA for the critical flow as a target, not a certification claim.
- Keep visible focus, semantic labels, 44×44 px touch targets, keyboard map controls, a skip link, no color-only status, and `prefers-reduced-motion` support.
- The visual system uses high-contrast navy/blue and Atkinson Hyperlegible, with map-derived linework and restrained motion. Avoid decorative gradients, generic card grids, and map-only information.

## Required checks

Expose and keep green: `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:db`, `npm run test:e2e`, `npm run build`, `npm run check`, and `npm run check:ci`. Record actual commands and results in `docs/progress.md`; do not claim a check ran when it did not.

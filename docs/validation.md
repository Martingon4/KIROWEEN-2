# Phase 0 validation

**Measured at:** 2026-11-22 UTC  
**Repository:** `/home/martin/KIROWEEN-2`  
**Scope:** local validation only; no deployment, external account creation, or remote data mutation occurred.

## Confirmed

| Item             | Observed result                                                          | Evidence                                                                                    |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Git root         | Existing independent repository on `main`, tracking `origin/main`        | `git status --short --branch`                                                               |
| Remote           | `https://github.com/Martingon4/KIROWEEN-2.git`                           | `git remote -v`                                                                             |
| Starting history | One commit, `2a0e48d Initial commit`                                     | `git log --oneline`                                                                         |
| OS               | Linux x86_64, kernel `7.2.4-practica-so`                                 | `uname -a`                                                                                  |
| Node             | `v26.13.0` installed; project target is Node 24                          | `node --version`                                                                            |
| npm              | `11.20.0`                                                                | `npm --version`                                                                             |
| Git              | `2.47.3`                                                                 | `git --version`                                                                             |
| Docker           | CLI and daemon `26.1.5+dfsg1` available                                  | `docker --version`, `docker info`                                                           |
| Supabase CLI     | `3.2.0`, now pinned as a dev dependency                                  | `npx supabase --version`, `package.json`                                                    |
| Browser          | Google Chrome `157.0.8103.50`                                            | `google-chrome --version`                                                                   |
| Media            | FFmpeg `7.1.5`                                                           | `ffmpeg -version`                                                                           |
| Registry access  | npm package metadata and package installation succeeded                  | `npm view`, `npm install`                                                                   |
| Next.js          | `16.4.6`; package requires Node `>=20.9.0`                               | npm metadata and installed package                                                          |
| Vercel Node      | Official docs list Node 26 (default), 24, and 22; project will pin 24    | [Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) |
| PostGIS guidance | Supabase documents installing PostGIS in a dedicated `extensions` schema | [Supabase PostGIS](https://supabase.com/docs/guides/database/extensions/postgis)            |

## Contest validation

- Search indexing for the official Devpost page states that the submission period is **October 30–December 4, 2026**, with the deadline **December 4 at 2:00 PM Pacific Time**. The repository's first commit and the copied plan are within that stated window.
- The official rules page exposed the **Best Frankenstein** category prize and the evaluation-period end stated in the plan. Direct page retrieval later returned HTTP 403, so the exact submission fields and category definition must be rechecked in a normal browser before release.
- Only new project work should be submitted. This repository started with a README and MIT license; the implementation begins in this phase.

Source: [Kiroween Devpost](https://kiroween.devpost.com/). Search result content was paraphrased for licensing compliance.

## Pilot data feasibility

A Nominatim query resolved **Plaza de la Constitución, Centro Histórico de Puebla** to OpenStreetMap way `528509571` with Polygon geometry and bounding box `[-98.1988758, 19.0430895, -98.1973016, 19.0442743]`.

- Source capture: `data/sites/zocalo-puebla/sources/osm-nominatim-search.json`
- Capture checksum (SHA-256): `1c2ab5800578895d7a4be092704de1e9bcf9c9e1032b17ca1d34daac10bfa1e7`
- License reported by the service: ODbL 1.0, OpenStreetMap contributors.
- Coverage: partial. The capture establishes the square boundary only. It does not establish trees, pedestrian inventory, parking spaces, protected zones, or current market use.
- Decision: retain the Zócalo as the pilot hypothesis. Use only the sourced boundary as reference data. Keep all demonstration interventions in a separately labeled hypothetical scenario.

## Design validation

The first automated design-system query returned a pink wedding-like palette and cursive typography. It did not fit a civic geospatial tool, so it was rejected and retained under `design-system/rejected-first-pass/` as decision evidence. The accepted direction uses high-contrast navy, blue, off-white, Atkinson Hyperlegible, visible focus, low motion, and map-derived linework.

## Completed after the initial probe

1. **Node parity:** a temporary Node `v24.22.3` ran `npm run check:ci` successfully. The host remains Node 26, while the repository and CI stay pinned to Node 24.
2. **Supabase services:** the local PostgreSQL 17 stack started, all migrations applied from a clean reset, PostGIS loaded in `extensions`, local Mailpit became available, and pgTAP passed.
3. **Authentication:** two generated local test accounts were confirmed and exercised through the browser. Their randomly generated passwords remain only in Git-ignored `.env.local` with mode 0600.
4. **Map fallback and WebGL:** Playwright exercised both the MapLibre WebGL view and a forced startup failure while preserving the schematic and list.
5. **Clean-copy setup:** `npm ci`, local checks, and a production build passed from a temporary clean copy without `.env.local`. Rerun for Spec 01 task 8 on Node v24.22.3: exit 0 in 1 min 19 s.
6. **Local CI sequence:** `npx --yes -p node@24 -c 'npm run check:ci'` exited 0 after a clean `supabase db reset` and `npm run provision:local` (Spec 01 task 8; counts in `docs/progress.md`).

## Pending or blocked

1. **PMTiles:** no regional extract, glyph, sprite, HTTP Range, CORS, cache, or redistribution check has run. The local GeoJSON MapLibre style and schematic remain the current baseline.
2. **Open-data coverage:** the pedestrian reference area and baseline inventories need a defensible source or documented team measurement.
3. **Hosted accounts:** no hosted Supabase, Vercel, SMTP, or Devpost credentials were requested or tested. Local Supabase accounts are isolated fixtures only.
4. **Deployment:** no preview or production resource exists; the repository remains local/remote-source only.
5. **ESLint transition:** ESLint 10 is current but violates peer ranges in the React/import/accessibility plugins bundled by `eslint-config-next@16.4.6`. Peer-valid ESLint 9.39.5 remains pinned despite npm's deprecation warning.
6. **Remote CI:** `.github/workflows/ci.yml` has never run on GitHub because nothing was pushed.
7. **Kiro hook trigger:** `.kiro/hooks/check-after-task.json` (`PostTaskExec`) has not been observed firing. Its command passes when run by hand, which does not count as a trigger.
8. **Local network exposure:** Supabase CLI reports that development services bind to all local interfaces and use shared development defaults. They must not be treated as production services or exposed to an untrusted network.

## Dependency and prior-work register

- Existing repository content before this phase: README and MIT license only.
- The implementation scaffold comes from `create-next-app` and keeps its generated `AGENTS.md` guidance.
- Source/data licenses are tracked in `THIRD_PARTY_NOTICES.md` and `docs/data-sources.md`.
- Global Kiro skills guide work but are not copied into the product runtime.
- No secret values are stored in the repository.

# 01 Foundation and pilot place: requirements

## Scope

This specification covers FT-01, the public-reading foundation of FT-02, and the local/CI foundation of FT-17. FT-16 and FT-18 apply throughout.

## Requirements

### R1 — Pilot catalog (FT-01)

**When** a visitor opens the application, **the system shall** list the configured pilot place with its name, study scope, source date, source license, completeness status, and a direct link.

Acceptance criteria:

- Plaza de la Constitución (Zócalo de Puebla) appears from versioned local data.
- Reference geometry names OpenStreetMap contributors and ODbL 1.0.
- Hypothetical interventions are visually and textually distinct from reference geometry.
- The place can be opened directly at `/es/lugares/zocalo-puebla` and `/en/places/zocalo-puebla` once the detail route lands.

### R2 — Resilient place view (FT-01)

**If** the remote or tiled basemap is unavailable, **the system shall** still display local study geometry, a feature list, source details, a failure message, and a retry path without blocking navigation.

Acceptance criteria:

- The initial slice uses a deterministic local schematic that needs no tile server.
- The same place facts are available in text outside the graphic.
- A later MapLibre enhancement must preserve keyboard navigation and the non-map alternative.

### R3 — Public access boundary (FT-02 foundation)

**When** a visitor reads the pilot catalog or baseline, **the system shall** return only published reference fields and no user account, email, private branch, or administrative metadata.

Acceptance criteria:

- Public fixture and API schemas have an explicit allowlist.
- Direct access to missing or private resources eventually returns 404 where existence would leak information.
- Authentication implementation is deferred to a database-backed task in this Spec.

### R4 — Reproducible local environment (FT-17)

**When** a contributor starts from a clean clone, **the repository shall** document and expose deterministic commands for dependency installation, local services, migrations, seed, development, build, and checks.

Acceptance criteria:

- Node major, package manager lockfile, Next.js, Supabase CLI, and test tools are versioned.
- `.env.example` has names and safe placeholders only.
- `npm run check` runs local checks that do not require a live database.
- `npm run check:ci` includes infrastructure-dependent checks when implemented.

### R5 — Accessible bilingual foundation (FT-16)

**When** a visitor uses Spanish or English, a 360 px viewport, keyboard-only navigation, reduced-motion settings, or a screen reader, **the system shall** preserve the critical place-reading flow.

Acceptance criteria:

- The app starts in Spanish and provides an English switch.
- A skip link is first in keyboard order and focus is visible.
- Status differences do not rely on color alone.
- There is no horizontal page overflow at 360 px.

### R6 — Kiro evidence (FT-18)

**When** a task is completed, **the repository shall** link the requirement, decision, changed paths, commands, and observed result.

Acceptance criteria:

- `.kiro/steering/` and `.kiro/specs/01-foundation-place/` are versioned.
- `docs/validation.md`, `docs/progress.md`, and `docs/kiro-evidence.md` distinguish measured, pending, and blocked work.

---
inclusion: always
---

# Fork the City: repository structure

- `src/app/[locale]/`: Spanish and English route UI. Keep route files thin.
- `src/app/api/v1/`: versioned HTTP contracts and stable error envelopes.
- `src/features/places/`: place catalog, map/fallback presentation, and source labels.
- `src/features/editor/`: drawing, forms, pending changes, undo/redo, and local draft recovery.
- `src/features/versions/`: branches, immutable revisions, publication, and history.
- `src/features/compare/`: diff, three-way merge preview, conflict resolution, and metrics.
- `src/features/community/`: comments, support, reports, and moderation.
- `src/features/tracking/`: dossiers, milestones, status events, evidence, and exports.
- `src/lib/schemas/`: Zod contracts shared only where server/client boundaries permit.
- `src/lib/auth/` and `src/lib/supabase/`: session and database adapters. Browser code must not import server-only modules.
- `src/lib/geo/`: pure canonicalization, validation, diff, shadow, and spatial helpers. Do not import UI.
- `src/lib/format/`: locale-safe dates, currency, units, and safe exports.
- `src/messages/{es,en}.json`: all user-facing localized copy.
- `supabase/migrations/`: append-only schema changes. `supabase/tests/`: pgTAP and permission tests. `supabase/seed.sql`: identified local/demo data only.
- `data/sites/<slug>/`: source manifests, redistributable source captures, baseline GeoJSON, and separately labeled scenarios.
- `tests/unit/`, `tests/e2e/`, `tests/fixtures/`: deterministic tests and fixtures.
- `.kiro/specs/<name>/`: requirements, design, and executable tasks for one feature block.
- `docs/`: validation, progress, evidence, sources, release, runbook, and ADRs.

## Boundaries

Routes may import features and libs. Features may import pure libs. Pure domain/geo modules never import React or Next.js. Server-only modules stay behind explicit server boundaries. Client modules receive the smallest serializable data shape. Keep source captures immutable; create a new version instead of editing them in place.

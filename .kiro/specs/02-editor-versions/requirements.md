# 02 Editor and immutable versions: requirements

## Scope

This specification covers FT-03 through FT-06. FT-02, FT-16, FT-17, and FT-18 remain cross-cutting requirements.

### R1 — Create a private branch (FT-03)

**When** an authenticated participant names an alternative and selects a compatible baseline or visible public revision, **the system shall** create a private branch and its first immutable revision atomically while preserving the exact source.

- The source remains unchanged.
- The first revision records the site, baseline, owner, parent source when present, and complete feature snapshot.
- Repeating the same idempotency key and payload returns the original result; changing the payload returns 409.
- Another participant receives 404 for the private branch.

### R2 — Edit supported interventions (FT-04)

**When** a branch owner adds, changes, or removes an intervention, **the system shall** validate finite 2D WGS84 geometry, topology, site containment, limits, and type-specific properties on the server and in the database.

- V1 supports Point, simple LineString, and simple Polygon without holes.
- Invalid changes do not replace local pending edits.
- The editor has coordinate and property forms as an alternative to pointer drawing.
- Local undo, redo, and draft recovery are scoped by account, site, and branch.

### R3 — Save an immutable revision (FT-05)

**When** the owner saves against the expected branch head, **the system shall** materialize one complete immutable snapshot and atomically advance the head.

- A stale expected head returns 409 without side effects.
- A repeated request does not duplicate revisions.
- Published and historical snapshots cannot be updated or deleted through exposed roles.

### R4 — Publish explicitly (FT-06)

**When** the owner confirms a revision summary, **the system shall** create a fixed public identifier and snapshot of the public label without making later private changes visible.

- Historical publication URLs continue to resolve after later revisions.
- The UI states which data becomes public.
- Hidden or private sources do not leak identifiers, authors, or messages through public history.

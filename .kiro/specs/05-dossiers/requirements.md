# 05 Dossiers, tracking, and exports: requirements

## Scope

This specification covers FT-13, FT-14, and FT-15. FT-02, FT-16, FT-17, and FT-18 remain cross-cutting. It depends on Spec 02 (publications), Spec 03 (analysis and costs), and applies the visibility rules of Spec 04 (a hidden publication hides its dossier and its downloads).

Roles come from `site_roles`. The `coordinator` role of a site promotes dossiers and records tracking events. Anyone may read a dossier whose publication is visible. Support counts are shown as context and never change a state.

### R1 — Promote a publication to a dossier (FT-13)

**When** a coordinator of the publication's site explicitly promotes a visible publication, **the system shall** create exactly one dossier for that publication, linked to that exact published revision.

- One dossier per publication; promoting again returns the existing dossier (same idempotency semantics as other mutations).
- Fields at promotion: decision note (plain text, 1 to 1,000), optional public responsible name, authorization flag for that name, optional target date.
- The responsible name is shown publicly only when the coordinator records that the person authorized it; otherwise the dossier shows "responsible not published". No neighbor contact data is stored.
- A non-coordinator, a coordinator of another site, a hidden publication, and a missing one all receive 404 with no effect.
- Initial state is `en_revision`. The dossier freezes the revision snapshot; later private edits never change it.

### R2 — Milestones (FT-13)

**When** a coordinator adds or updates a milestone, **the system shall** store it with a title, a target date, and a status (`pendiente`, `cumplido`, `cancelado`).

- Titles are plain text, 1 to 100 characters; target dates are calendar dates; at most 20 milestones per dossier.
- Every milestone change is recorded as a dossier event; milestones are never deleted, only cancelled.

### R3 — Status transitions with evidence (FT-14)

**When** a coordinator changes the dossier status, **the system shall** validate the transition in the database and append a dossier event with previous state, new state, actor, time, note, and an evidence reference when required.

- States: `en_revision`, `planeado`, `en_ejecucion`, `ejecutado`, `descartado`. Allowed: `en_revision → planeado → en_ejecucion → ejecutado`; `descartado` from the first three with a reason.
- To plan: a published responsible (name or team, authorized) and at least one milestone.
- To start execution: a progress note and at least one evidence item or verifiable reference.
- To mark executed: an observation of what was built, how it differs from the proposed revision, and at least one evidence item that a reviewer can consult.
- Evidence items: HTTPS URL validated syntactically only (the server never fetches it), title, date, description, and who recorded it. A flag `verified_by_team` is set by the coordinator and shows who verified it. Links open with `noopener noreferrer` and show their domain.
- An error recorded by mistake is corrected with an additional event, never by editing history; events are append-only.
- A transition not allowed, repeated with a stale expected state, or missing a requirement fails without side effects and with a stable error code.

### R4 — Public dossier page (FT-13)

**When** a visitor opens a dossier, **the system shall** show the objective text, the frozen proposal, the comparison against the baseline with cost range and assumptions, milestones, status, the public responsible when authorized, the support count as context, the evidence list, and the timeline of events.

- Reference data, hypothetical scenario, and evidence are labeled distinctly; an execution claim without evidence is impossible by construction.
- A hidden publication hides the dossier page, its API, and its downloads (404).
- Spanish and English, keyboard operable, 360 px, no color-only status.

### R5 — Exports (FT-15)

**When** a visitor or user requests an export of a visible dossier, **the system shall** return the file with the same access rules as the app.

- Formats: printable HTML dossier (no PDF server), GeoJSON of the interventions (RFC 7946, WGS84, properties flagged hypothetical), CSV of cost concepts (UTF-8, spreadsheet-compatible), JSON of assumptions (scenario, engine version, catalog, rounding, currency, sources).
- CSV neutralizes formula injection for every text cell (leading `=`, `+`, `-`, `@`, tab, carriage return, and similar after trimming) and escapes quotes, commas, and newlines.
- Every export states source, currency, rounding rule, scenario, illustrative labeling, and generation time; a fully illustrative budget is labeled as such.
- Exports contain no emails, account ids, private notes, report data, or hidden content; comments are not included in v1.
- Responses are `no-store`; filenames are derived from fixed slugs and ids, never from user text.

### R6 — Evidence and tests

**When** this spec is delivered, **the system shall** keep green: pgTAP for permissions by role and site, uniqueness, transition rules with every missing requirement, append-only events, hidden-content effects, and idempotency; unit tests for CSV neutralization and GeoJSON validity (RFC 7946 shape, coordinate order, finite numbers); and an E2E story: a user without the role cannot promote, a coordinator promotes, assigns a milestone, plans, tries to close without evidence and is blocked, records evidence and closes; downloads work and match the page; hiding the publication removes page and files.

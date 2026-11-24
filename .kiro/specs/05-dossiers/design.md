# 05 Dossiers, tracking, and exports: design

Design by the Opus architect, with one scope change: the only correction is reverting the last status change (`revert_last_status_change`); withdrawing an evidence item is not supported in v1 and is a documented limitation. Corrections are additional events, never edits.

## Tables (RPC-only, RLS on, no grants, like Spec 04)

- Enums: `dossier_status` (en_revision, planeado, en_ejecucion, ejecutado, descartado), `milestone_status` (pendiente, cumplido, cancelado), `dossier_event_kind` (promoted, status_change, milestone_added, milestone_updated, evidence_added, evidence_verified, responsible_changed, correction).
- `dossiers`: one per publication (`unique (publication_id)`); composite FKs `(publication_id, revision_id)` to publications and `(revision_id, site_id)` to revisions fix the frozen revision and the site; `scenario_slug` fixed at promotion; `decision_note` 1 to 1000 plain text; `responsible_name` 1 to 100 plain text without `@`, with `responsible_authorized = (responsible_name is not null)` so an unauthorized name is never stored; `target_date date`; `last_event_seq`. A trigger lets only status, responsible fields, `updated_at`, and `last_event_seq` change, requires `last_event_seq` to advance by one with an existing event, and requires a matching event when the status changes.
- `dossier_milestones`: `position` 1 to 20 (`unique (dossier_id, position)`), title 1 to 100, `target_date`, status; trigger: `pendiente` to `cumplido` or `cancelado`, `cumplido` back to `pendiente`, `cancelado` is terminal; never deleted.
- `evidence_items`: `position` 1 to 50, HTTPS URL up to 2048 characters (syntactic check, no userinfo, host with a dot), generated `host`, title, description, `evidence_date`, recorder, `verified_by_team` with verifier and time (all or none). The server never fetches the URL.
- `dossier_events`: append-only, `seq` per dossier up to 500, kind, previous and new state, optional milestone, evidence, and corrected event (composite FKs to the same dossier), note, observation, difference, actor. A `status_change` needs an allowed transition and a note; moving to `ejecutado` also needs observation and difference; a `correction` names the corrected event and has a note.
- `dossier_event_evidence`: links the evidence a transition cites. A deferred constraint trigger requires at least one link for every move to `en_ejecucion` or `ejecutado`, so closing without evidence is impossible by construction.

## Write RPCs (SECURITY DEFINER, empty search_path, coordinator of the site derived from the target)

Common order: validation, advisory lock on the key, replay, permission check, then locks (publication `FOR SHARE`, site, dossier `FOR UPDATE`), visibility (`FT409 publication_hidden` for a coordinator when the publication is hidden), closed-state check (`FT409 dossier_closed`), event append with `seq = last_event_seq + 1`. A stranger, a coordinator of another site, and a missing target all get `P0002`.

`promote_dossier`, `set_dossier_responsible`, `add_milestone`, `update_milestone` (expected status), `add_evidence`, `set_evidence_verified`, `transition_dossier`, `revert_last_status_change`. No rate limit: the role is assigned by the operator, writes are audited, and caps (20 milestones, 50 evidence items, 500 events) bound growth.

Transition matrix, evaluated in order, each failure rolling back everything: `stale_state` (409), `transition_not_allowed`, then for `planeado` a note, a published responsible, and one non-cancelled milestone; for `en_ejecucion` a note and cited evidence; for `ejecutado` observation, difference, and cited evidence that was not already cited when execution started; for `descartado` a reason; any evidence id of another dossier is `invalid_evidence_reference`.

## Read RPCs

`public_dossier_exists`, `get_public_dossier` (null unless the publication is visible and the site published; composes the public projection, `get_snapshot_analysis`, `compare_revisions` against the baseline, milestones, evidence with live aliases, events, and the support count as context), `get_publication_dossier` (id and `canManage`), `get_managed_dossier` (coordinators only, answers for a hidden publication without the frozen proposal), `list_public_dossiers` (keyset).

## Exports

`GET /api/v1/dossiers/:id/export?format=html|geojson|csv|json`, generated from `get_public_dossier` so access rules match the page. `no-store`, `nosniff`, filenames `<siteSlug>-<id8>.<ext>`.

- CSV: RFC 4180, UTF-8 with BOM, CRLF, text cells quoted, a leading `'` for cells that start with `= + - @`, tab, carriage return, newline, or their full-width forms after trimming; numeric cells are a separate type written as plain decimals.
- GeoJSON: FeatureCollection, `[lon, lat]`, no `crs`, properties flagged `hypothetical`, metadata member with source and scenario.
- JSON assumptions: schema version, scenario, engine, catalog, currency, rounding, budget label, unknown concepts.
- HTML: standalone, no scripts, everything escaped, print CSS, strict CSP.

## HTTP and UI

Routes: `POST /publications/:id/dossier`, `GET /dossiers/:id`, `POST /dossiers/:id/events`, `POST /dossiers/:id/corrections`, `PUT /dossiers/:id/responsible`, `POST /dossiers/:id/milestones`, `POST /milestones/:id`, `POST /dossiers/:id/evidence`, `PUT /evidence/:id/verification`, export. Stable codes per matrix failure. Pages: public `/[locale]/dossiers/[id]`, coordinator `/[locale]/dossiers/[id]/manage`, list `/[locale]/dossiers`, a promote control on the publication page. The Proxy gate answers a real 404 for missing or hidden dossiers.

## Tests

pgTAP for permissions by role and site, uniqueness, every matrix failure, append-only events, the deferred evidence constraint, hidden effects, idempotency; unit and fast-check for CSV neutralization, GeoJSON validity, `escapeHtml`, and a pure model of the state machine; E2E story from R6.

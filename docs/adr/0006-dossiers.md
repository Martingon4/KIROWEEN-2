# ADR 0006: Dossiers, tracking, and exports

- **Status:** Accepted for Spec 05 (FT-13, FT-14, FT-15). Node 24 `check:ci` passed after a clean reset. Visual captures are pending (Spec 06).
- **Date:** 2026-11-25 (Spec 05 migration date)

## Context

A coordinator of a site promotes a visible published proposal into a dossier, then records milestones, status changes, and evidence until the proposal is planned, started, executed, or discarded. Visitors read the dossier and download it in four formats. The rules come from product principles 1 to 4 (provenance, fact versus scenario, trade-offs, and human decisions) and from ADR 0002 (publication model), ADR 0004 (analysis), and ADR 0005 (visibility and moderation). Support counts never change a status. The server never fetches evidence URLs.

## Decision

1. **Evidence is cited per transition.** A status change that needs evidence links the evidence items it relies on in `dossier_event_evidence`. A deferred constraint trigger requires at least one link for every move to `en_ejecucion` or `ejecutado`, so an execution claim without evidence cannot be stored. The trigger is `SECURITY DEFINER` with an empty `search_path` and fully qualified names (migration `20261125050000_dossier_evidence_trigger_definer.sql`). The first version did not run with definer rights. The pgTAP suite runs as a superuser, so it did not detect the failure. The E2E run found it.
2. **Execution must cite new evidence to close.** Moving to `ejecutado` requires at least one evidence item that was not already cited when execution started. Evidence used only to start execution does not prove the result.
3. **One correction: revert the last status change.** `revert_last_status_change` appends a `correction` event that names the status event it reverses. Events are append-only, so the history keeps both the mistake and the correction. Withdrawing an evidence item is not supported in v1.
4. **Exports are built from the public read.** Every export is generated from `get_public_dossier`, so an export contains the same data and follows the same access rules as the page. A hidden publication or a missing dossier returns 404 with no file.
5. **CSV is spreadsheet-safe.** Files are UTF-8 with a BOM and CRLF line endings. Text cells are quoted and escaped. A cell whose trimmed value starts with `=`, `+`, `-`, `@`, a tab, a carriage return, or their full-width forms is prefixed with `'`. Numeric cells are written as plain decimals.
6. **HTML uses a hash-based CSP and presentation attributes.** The HTML export is standalone and has no scripts. Its only allowed source is its inline style block, allowed by `style-src 'sha256-…'`, computed from that block. The export sets `default-src 'none'`, `img-src data:`, `base-uri 'none'`, `form-action 'none'`, and `frame-ancestors 'none'`. Inline SVG uses presentation attributes (`fill`, `stroke`) instead of `style` attributes, because a `style-src` hash does not cover style attributes. This removes the need for `'unsafe-inline'`.
7. **The Proxy gate answers 404.** Missing and hidden dossiers, and their downloads, return a real HTTP 404 from the gate, as publications do (ADR 0002).
8. **Responsible names can be withdrawn after closure or hiding.** A coordinator may remove the public responsible name even when the dossier is closed or its publication is hidden. Removing a name must not depend on the dossier state.
9. **Exports are safe to download.** Responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Filenames are `<siteSlug>-<first 8 characters of dossier id>.<ext>`, built from fixed slugs and ids, never from user text.
10. **Stable error codes.** Missing, hidden, and unauthorized dossiers return the same 404 code, so object ids cannot be enumerated. Failed transitions return a stable code and change nothing.

## Consequences

- A closed dossier always has an evidence link, enforced by the database and not by the UI.
- Evidence and events accumulate. Caps bound growth: 20 milestones, 50 evidence items, and 500 events per dossier.
- Exports can be trusted to match the page, because they share one read function.
- The CSP and SVG rules add restrictions to the export markup. Any future style change must keep the hash in sync with the generator.

## Known limitations

These limitations are open. They are listed so readers do not assume the behavior is complete.

- **(a) No evidence withdrawal.** An evidence item cannot be removed after it is recorded. Withdrawal is not supported in v1.
- **(b) Single-step correction.** `revert_last_status_change` reverts only the most recent status change. Earlier mistakes stay in the history and are not corrected.
- **(c) Target date.** `targetDate` checks only the calendar-date format.
- **(d) Unavailable dossier page.** The page shown for an unavailable dossier reuses the publication unavailable page.
- **(e) BOM in CSV.** The UTF-8 BOM is written for spreadsheet compatibility. Some parsers that do not strip a BOM read it as a character at the start of the first header cell.
- **(f) Promoting a hidden publication.** Promoting a publication that is hidden returns 404 through the gate. It does not return `FT409 publication_hidden`, which the design listed.
- **(g) Validation order.** `invalid_evidence_reference` is checked before the other evidence rules, so a request with a bad reference may report that error first.
- **(h) Two request-error codes.** `invalid_dossier_request` and `invalid_request` are distinct codes for similar cases. Clients must handle both.
- **(i) List paging.** The dossier list uses keyset paging on `updated_at`. If rows change while a client pages, an item can appear twice or be skipped.
- **(j) Evidence checks use the event budget.** Verifying an evidence item writes an event, so it counts against the 500-event cap.
- **(k) Stale refresh on the manage page.** A late refresh that follows an action can reset form fields the user is editing on the manage page. The E2E run on mobile 360 px observed this. The mitigation is in the test, not in the component.
- **(l) Evidence URLs are not checked.** Only the syntax of an HTTPS URL is validated. A reachable or correct link is not confirmed by the server.

## Review findings fixed

The independent review (`reviewer-opus`) found the following problems, all fixed in Spec 05:

- Withdrawing the responsible name was blocked in closed or hidden states. Fixed in migration `20261125060000_dossier_responsible_withdrawal.sql`.
- The CSP and SVG style rules blocked the export styling. Fixed with the hash-based CSP and presentation attributes.
- Missing, hidden, and unauthorized dossiers returned different codes. They now return one uniform 404 code.
- The evidence verification request body is limited to 1 KiB.
- Export requests for dossiers outside the pilot site return 404.

# 04 Community and moderation: requirements

## Scope

This specification covers FT-09 and FT-10. FT-02, FT-16, and FT-17 remain cross-cutting. It depends on Spec 02 (publications) and Spec 03 (compare and merge read the visibility rule).

Roles come from `site_roles` (`moderator` per site). Users are shown only by public alias. Comments are plain text everywhere they are stored, rendered, and exported.

### R1 — Comment on a published revision (FT-09)

**When** an authenticated participant writes a comment on a visible publication, **the system shall** store it as plain text anchored to that publication, optionally anchored to one feature of the published revision.

- Text is 1 to 1,000 characters after trimming; control characters other than newline are rejected; the UI never renders HTML or markdown.
- An anchor must be a feature id that exists in the publication's revision; the check runs in the database.
- Replies are out of scope for v1: threads are a flat list per publication. The discussion stays attached to the original published revision, never to later private edits.
- A repeated request with the same idempotency key and payload returns the original comment; a different payload returns 409.
- Public reads list visible comments with alias, date, text, and anchor label, 20 per page by default and 50 at most, newest last, with a cursor. Account ids and emails are never returned.
- An author can retract their own comment; retraction hides it from public reads and keeps an audit fact.

### R2 — Support a published revision (FT-09)

**When** an authenticated participant supports a visible publication, **the system shall** record at most one support per account and publication, and let them withdraw it.

- The counter is the number of platform accounts currently supporting; it appears only as context and never triggers a state change anywhere.
- Support and withdraw are idempotent: repeating either leaves the count unchanged and returns the current state.
- Visitors see the count; only the account itself sees whether it supports.

### R3 — Report content (FT-10)

**When** an authenticated participant reports a visible publication or comment, **the system shall** store a private report for the moderators of that site.

- Reasons come from a closed list (`spam`, `harassment`, `misinformation`, `privacy`, `other`) plus an optional plain-text note of up to 500 characters.
- One open report per account and target; a duplicate returns the existing report.
- Reporters never see other reports; moderators see them only for sites they moderate.

### R4 — Persistent rate limits (FT-10)

**When** an account exceeds a persistent per-action window limit, **the system shall** reject the action with 429 and a `Retry-After` header, without side effects.

- Initial limits per account: 10 comments per hour, 10 reports per hour, plus 60 supports or withdrawals per hour. Limits are revisable data, checked inside the transaction through atomic counters.
- A rejected request does not consume a counter.

### R5 — Moderate with reason and audit (FT-10)

**When** a moderator of the site hides or restores a publication or comment with a reason, **the system shall** change its visibility atomically and append a moderation event.

- Reason is required, plain text, 1 to 500 characters. Actor, target, action, reason, and time are stored in append-only `moderation_events`, readable only by moderators of that site.
- Hiding a publication blocks public reads (page, API, compare, analysis), exports, fork, and new merges of that publication; already materialized merged or forked content is kept and shows the source as unavailable.
- Hiding a comment removes it from public reads and counts; restoring reverses it. The comment author sees "hidden by moderation" with the public reason.
- Resolving a report links it to the moderation event or records `dismissed` with a note; reports stay for audit.
- A non-moderator, or a moderator of another site, gets 404 and no effect.

### R6 — Moderation panel and community UI

**When** a visitor, participant, or moderator uses the community features, **the system shall** provide plain-language Spanish and English screens.

- The publication page shows the support count, a support toggle for signed-in users, a comment list with anchors and a form, and a report control on the publication and on each comment.
- A moderation panel lists open reports for assigned sites with a link to the object, reason, state, and history, plus hide/restore with a required reason. States: loading, empty, signed out, insufficient permission, and recoverable error.
- Everything works with keyboard and screen readers at 360 px; status is never conveyed by color alone.

### R7 — Evidence and property tests

**When** this spec is delivered, **the system shall** keep green: pgTAP for permissions, RLS, idempotency, rate-limit atomicity, uniqueness of support, anchor validation, hidden-content effects on public reads, compare, fork, and merge, and append-only audit; fast-check properties (seed recorded) for "repeated support counts once" and "withdraw after support returns the count to its previous value"; and an E2E story: two accounts comment, support twice counts once, withdraw, report, moderator hides and restores, public effects verified.

# 02 Editor and immutable versions: design

## Transaction boundaries

Database `SECURITY DEFINER` functions own branch creation, revision saves, and publication. Each function uses an empty `search_path`, fully qualified names, `auth.uid()`, explicit grants, expected-head checks, and an idempotency ledger. API handlers validate size, origin, JSON, session, and Zod contracts before calling them.

## Snapshot model

- `branches` points to an active baseline, optional source revision, and current private head.
- `revisions` is append-only and records primary/merge parents, author, message, site, baseline, and creation time.
- `revision_features` stores a complete snapshot keyed by revision and stable feature UUID.
- `publications` gives a revision a fixed public UUID, label, summary, and moderation state.
- `mutation_requests` binds actor, operation, idempotency key, canonical payload hash, and response.

## Initial delivery sequence

1. Add tables and an atomic baseline-branch creation function.
2. Expose `POST /api/v1/branches` with same-origin and authenticated-session checks.
3. Add a private branches page and branch-creation form.
4. Add revision snapshot validation and expected-head save.
5. Add explicit publication and historical public routes.
6. Add the editor client boundary, local operation history, and draft recovery.

## Error mapping

- malformed JSON: 400
- unauthenticated: 401
- visible but forbidden: 403
- absent or private: 404
- stale head or idempotency mismatch: 409
- oversized body: 413
- domain validation: 422
- server fault: 500 with generic message and request ID

Database error detail is logged only in local diagnostics and never returned to clients.
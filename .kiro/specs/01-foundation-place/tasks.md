# 01 Foundation and pilot place: tasks

- [x] **1. Validate repository and toolchain** — FT-17, FT-18
  - Inspect Git root, remote, existing files, OS, Node, npm, Docker, Chrome, FFmpeg, package access, and Supabase CLI.
  - Record measured results and discrepancies in `docs/validation.md`.
  - Check: `git status --short --branch`, version commands, `npm view`.

- [x] **2. Establish project context and Spec** — FT-01, FT-02, FT-16–FT-18
  - Add product, technology, and structure steering.
  - Add requirements, design, and tasks for `01-foundation-place`.
  - Persist a project design system; retain the rejected first automated direction as evidence.
  - Check: required files exist and IDs remain traceable.

- [x] **3. Build the local pilot catalog slice** — FT-01, FT-16, FT-17
  - Derive a versioned baseline from the captured OSM response.
  - Add separately labeled hypothetical scenario fixtures.
  - Implement `/es` and `/en` catalog views with accessible schematic fallback and source details.
  - Add unit/component tests.
  - Check: `npm run check`, `npm run build`.

- [x] **4. Initialize Supabase/PostGIS foundation** — FT-01, FT-02, FT-17
  - Add local Supabase configuration, append-only initial migration, seed, public projection, and RLS.
  - Keep PostGIS in `extensions`; keep source capture and fixture data distinct.
  - Add pgTAP tests for anonymous public read and private-row denial.
  - Check: `npx supabase start`, `npx supabase db reset`, `npm run test:db`.

- [x] **5. Expose versioned public place API** — FT-01, FT-02
  - Implement `GET /api/v1/sites` and `GET /api/v1/sites/:slug` with allowlisted responses and stable errors.
  - Add request IDs and no-store behavior for moderation-sensitive reads.
  - Check: unit contract tests and HTTP smoke test.

- [x] **6. Add authenticated session foundation** — FT-02, FT-17
  - Configure Supabase SSR clients and same-origin return paths.
  - Add local test-account provisioning outside public routes.
  - Verify visitor, owner, other participant, and cross-site coordinator visibility.
  - Check: database permission tests and Playwright session flow.

- [x] **7. Add real MapLibre enhancement and fallback test** — FT-01, FT-16
  - Lazy-load one map canvas with keyboard handling and navigation controls.
  - Preserve the schematic and feature list when tiles/WebGL fail.
  - Check: Chromium WebGL flow plus controlled network failure.

- [x  ] **8. Establish CI, hook, and clean-clone smoke** — FT-17, FT-18
  - Added CI workflow, Kiro `PostTaskExec` hook, and a clean-copy smoke command.
  - Verified so far: `npx --yes -p node@24 -c 'npm run smoke:clean'` passed on Node v24.22.3 (clean copy, `npm ci`, lint, types, unit tests, build without `.env.local`); `.kiro/hooks/check-after-task.json` is valid (one `PostTaskExec` hook, 300 s timeout) and its command (`npm run lint && npm run typecheck && npm run test:unit`) exits 0 in about 20 s (206 unit tests); the full `check:ci` passed on Node 24 after a clean database reset (see `docs/progress.md`). Running the command by hand is not a hook trigger.
  - Still open: one real `PostTaskExec` firing, which Kiro produces only when a Spec task is set to completed from the Spec UI. Remote GitHub Actions has not run because nothing was pushed.
  - Add GitHub Actions, Kiro task-completion check hook, and reproducible smoke script.
  - Record one observed hook result without publishing or changing source data.
  - Check: `npm run check:ci` from a clean local state.

# Fork the City

Fork the City turns a documented public place into a versioned, reviewable proposal. The first pilot uses Plaza de la Constitución (Zócalo de Puebla) to compare hypothetical shade and temporary-market alternatives without confusing either one with observed reality.

## Current slice

The current slice provides:

- Spanish and English public catalog routes.
- A local schematic that works without map tiles or WebGL.
- Immutable source capture, derived baseline, and separately labelled demonstration scenario.
- Visible source, license, capture date, and coverage limitations.
- Keyboard focus, skip navigation, reduced-motion handling, and a textual map alternative.
- Owner-only private branches created from the baseline.
- A form-based editor for shade trees, shade canopies, temporary markets, and proposed crossings, with undo and redo and local draft recovery.
- Saving an editor draft as an immutable revision, guarded by an expected-head check and an idempotency key.
- Publishing a saved revision as an immutable public link with a public name, summary, and consent.
- Forking a visible published proposal into your own private branch, with a link back to the source.

- Comparing two visible revisions of the same site, with modeled shade, occupancy, a cost range, and a list of changes.
- Merging a published proposal into your own branch, with explicit conflict resolution and both parents kept.

- Comments, support, reports, and a moderation panel for site moderators (see "Comments, support, and reports" below).

- Promoting a visible proposal to a dossier, with milestones, status changes backed by evidence, and four downloadable exports (see "Dossiers and exports" below).

La [Spec 06](.kiro/specs/06-delivery/tasks.md) reúne el guion, el texto de Devpost y los pasos de publicación. El [registro de comprobaciones](docs/progress.md) identifica qué versión se probó y los resultados de cada etapa.

## Publish a revision

Sign in, open a private branch, and save your draft as a revision. Open the publish form, check the prefilled public name and summary, tick the consent box, and publish. The form stays disabled while the branch has pending changes or no features. Open the public link to see the published snapshot, which is marked as immutable and hypothetical. Later saves in the same branch create new revisions and never change a published one.

## Fork a published proposal

Open a published proposal's public page and use the form "Bifurcar esta propuesta" (Fork this proposal). The title is prefilled, and the form works without JavaScript. If you are not signed in, you go to sign-in and return to the page afterwards.

The fork copies the exact snapshot of the source revision into a new private branch. The copy is yours alone. It stays hypothetical, and the source publication is not changed. Forking does not re-check the copy against the current rules, because the rules may have changed since the source was saved. After the fork, you land in the editor. The editor shows a provenance line with a link to the source publication. If the source is hidden, the line says that the source is no longer available ("…ya no está disponible" in Spanish).

## Compare two proposals

Open `/en/compare` or `/es/compare`. The page compares two visible revisions of the same site. Each side can be:

- a published proposal: `publication:<id>`
- the baseline of the site: `baseline:<id>`
- one of your own saved revisions: `revision:<id>`. Other people's revisions are never accepted.

The same comparison is available as an API call with an optional solar scenario slug:

```
GET /api/v1/compare?left=publication:<id>&right=publication:<id>&scenario=equinox-1600
```

The result lists added, removed, and modified features, the modeled shade and occupancy of each side, and the cost range of each side. A proposal compared with itself shows no changes. Two sides from different sites or different baselines are reported as incompatible. Costs use an illustrative price list, and the screen labels them that way. The table is the primary view. The map uses patterns as well as color for each change.

## Merge a proposal into your branch

1. Sign in and open one of your private branches.
2. Open a published proposal for the same site from its public page, and start the merge from that page.
3. The preview lists the changes from both sides and any conflicts. A conflict is either the same element changed differently on each side, or two features that claim the same space in the same time slot.
4. Resolve each conflict: keep your version, keep the other proposal's version, remove the element, or redraw it with new coordinates. Geometry is never moved automatically.
5. Commit. The server checks that your branch head has not changed since the preview. If it has changed, nothing is written and you need to preview again. A successful commit creates one new revision on your branch with both parents. Merging the same source revision again is refused.

Analysis rules and limits are in `docs/adr/0004-analysis-and-merge.md`.

## Dossiers and exports

A coordinator of a site turns a visible published proposal into a dossier. The public dossier page shows the frozen proposal, its comparison with the baseline and cost range, the milestones, the status, the responsible name when it is authorized, the evidence, and a timeline of events. It lives at `/es/dossiers/<id>` or `/en/dossiers/<id>`. The coordinator works from `/es/dossiers/<id>/manage` or `/en/dossiers/<id>/manage`.

Coordinator flow:

1. **Promote.** Open a visible publication and promote it with a decision note (1 to 1,000 characters). You can also add a responsible name and a target date. The name is public only when you tick the authorization box. Otherwise the page says the responsible is not published. The dossier starts as `en_revision` and keeps the exact revision that was published.
2. **Add milestones.** Each milestone has a title (1 to 100 characters), a target date, and a status: `pendiente`, `cumplido`, or `cancelado`. Up to 20 milestones per dossier. Milestones are cancelled, never deleted.
3. **Plan.** Moving to `planeado` requires a responsible name that is authorized for publication and at least one milestone that is not cancelled.
4. **Start execution.** Moving to `en_ejecucion` requires a progress note and at least one evidence item.
5. **Close.** Moving to `ejecutado` requires an observation of what was built, how it differs from the proposed revision, and at least one evidence item that was not already cited when execution started. Without that evidence, the database refuses the change.
6. **Discard.** Moving to `descartado` is allowed from the first three states and needs a reason.

Evidence items are HTTPS links with a title, a date, and a description. The server checks only the link syntax and never opens the link. The coordinator can mark an item as verified by the team, and the page then shows who verified it. A responsible name can be removed at any time, including after the dossier closes or the publication is hidden.

Mistakes are corrected by reverting the last status change, which adds a correction event. The history is append-only. In v1, only the last status change can be reverted, and an evidence item cannot be withdrawn. See `docs/adr/0006-dossiers.md`.

A hidden publication hides its dossier page, its API, and its downloads, which return 404.

Each dossier has four downloads. All of them come from the same data as the public page:

| Format | Request | Contents |
|---|---|---|
| Printable HTML | `GET /api/v1/dossiers/{id}/export?format=html` | Standalone page with print styles and no scripts |
| GeoJSON | `GET /api/v1/dossiers/{id}/export?format=geojson` | Interventions as an RFC 7946 FeatureCollection in WGS84, each flagged as hypothetical |
| CSV | `GET /api/v1/dossiers/{id}/export?format=csv` | Cost concepts in UTF-8 with a BOM and CRLF line endings, with formula injection neutralized |
| JSON | `GET /api/v1/dossiers/{id}/export?format=json` | Assumptions: scenario, engine, catalog, currency, rounding, and sources |

Every export states its source, currency, rounding rule, scenario, and generation time. A fully illustrative budget is labeled as such. Exports never contain emails, account ids, private notes, reports, or comments. Responses use `no-store`, and file names come from the site slug and the dossier id.

## Comments, support, and reports

On a published proposal's public page, signed-in users can:

- Support the proposal. Each account can support a proposal once and can withdraw that support. The count is context only. It does not approve or change anything.
- Comment in plain text, from 1 to 1,000 characters. A comment can be anchored to one feature of the published revision. Comments form a flat list, 20 per page, and show public aliases only. You can retract your own comment.
- Report the proposal or a comment with one reason (spam, harassment, misinformation, privacy, or other) and an optional note of up to 500 characters. Each account can have one open report per item.

Each account can make up to 10 comments and 10 reports per hour, and up to 60 support changes per hour. Over the limit, the API returns 429 with a `Retry-After` header.

Moderators use the panel at `/es/moderation` or `/en/moderation`. It lists open reports for the sites they moderate, with a link to the reported item, its reason, and its state. A moderator hides or restores a publication or comment with a required public reason and an optional private note. A hidden proposal returns 404 on its public page. Its compare, analysis, fork, merge, comment, support, and report features also stop working. Forks and merged revisions that already exist keep their content and show the source as unavailable. Every moderation action is recorded in an audit log that only moderators of that site can read. Comments are not part of exports in v1.

The moderator test account uses `FTC_MODERATOR_EMAIL` and `FTC_MODERATOR_PASSWORD` in `.env.local`. `npm run provision:local` creates the account and assigns the moderator role for the pilot site. `npm run configure:local` appends missing keys to an existing `.env.local` and leaves existing credentials unchanged.

## Requirements

- Node.js 24 LTS (`.nvmrc` and `package.json#engines`)
- npm 11 or later
- Docker for the local Supabase stack
- Google Chrome for browser checks

## Arranque local

```bash
nvm use
npm ci
DO_NOT_TRACK=1 npx supabase start
npm run configure:local
npm run build && npm run start -- --port 3100
```

Abre [la aplicación local](http://127.0.0.1:3100/es). La versión en inglés está en `/en`. Después de un `supabase db reset` local, ejecuta `npm run provision:local` para restablecer las cuentas de prueba. Sigue el [handoff](docs/HANDOFF.md) para la validación de entrega.

## Diseñar a partir de una foto

En `/es/terrain` y `/en/terrain`, el simulador sugiere un contorno a partir del color del suelo visible. Confirma el contorno o redibújalo sobre la foto. Puedes marcar dos extremos y un ancho para reservar un paso, y añadir medidas conocidas en los ajustes. La propuesta A parte de un módulo comunitario cerrado con puerta, ventanas y cubierta; la B plantea un pabellón público abierto. Ambas añaden acceso y equipamiento cuando cabe. Los módulos se ofrecen en tres tamaños y la app comprueba sus huellas, las colisiones y el paso al editar el contorno o la escala. La primera propuesta viable se muestra al abrir la simulación.

El cálculo busca espacio construible, elige un módulo del catálogo que quepa y distribuye componentes complementarios sin ocupar el paso. Si la foto muestra una línea verde bajo el cielo, dibuja árboles de fondo como contexto aproximado, separados de la propuesta. El suelo usa colores muestreados del área visible incluso cuando falta el modelo opcional de profundidad. El contorno, el arbolado y la escala sin medidas son aproximados. Una foto no identifica con fiabilidad obstáculos, pendientes, permisos, estructura portante ni distancias ocultas; la persona debe revisar el resultado. Es una propuesta conceptual hipotética, no un plano ejecutable. El diseño se guarda en el navegador.

### Relieve desde una foto

Después de `npm ci`, ejecuta `npm run setup:terrain-depth` antes de compilar si quieres habilitar el relieve en `/es/terrain` y `/en/terrain`. El comando prepara alrededor de 42 MB de pesos y WebAssembly en `public/terrain-model/`. Incluye esa carpeta en el entorno que sirva la aplicación. La foto se analiza en el navegador y los diseños guardados conservan la malla, con escala aproximada salvo donde se indiquen medidas.

Las vistas laterales muestran el relieve inferido de la cara visible. La foto por sí sola no permite recuperar las partes ocultas.

## Checks

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run check:solar   # fails if the committed solar scenarios or their checksum differ
npm run build
npm run check
```

To regenerate the solar scenarios after a change to the generator or site coordinates, run `npm run generate:solar`, then review and commit the JSON and the checksum in `manifest.json`.

Database and browser checks require their infrastructure:

```bash
npx supabase start
npm run configure:local
npx supabase db reset
npm run provision:local
npm run test:db
npx playwright install chromium
npm run test:e2e
npm run check:ci
```

`supabase db reset` is for the local development stack only. No script in this repository resets a remote database.

## Data and scenarios

The baseline boundary comes from OpenStreetMap way `528509571`, captured through Nominatim on 2026-11-22. It is partial and does not establish a tree, parking, accessibility, or pedestrian inventory. The shade canopy and market zone are project-authored hypothetical fixtures for demonstrating future comparison and conflict handling.

Read `docs/data-sources.md` and `THIRD_PARTY_NOTICES.md` before redistributing data. The raw capture is retained under `data/sites/zocalo-puebla/sources/` with its checksum.

## Project documentation

- Master plan: `FORK-THE-CITY-PLAN-KIRO.md`
- Phase-0 validation: `docs/validation.md`
- Current progress: `docs/progress.md`
- Architecture decisions: `docs/adr/` (dossiers and exports: `docs/adr/0006-dossiers.md`)
- Revision API (`GET /api/v1/branches/:branchId` and `POST /api/v1/branches/:branchId/revisions`): see the "Editor and expected-head saves" section in `docs/progress.md`
- Kiro evidence: `docs/kiro-evidence.md`
- Completed foundation Spec: `.kiro/specs/01-foundation-place/`
- Analysis, comparison, and merge rules: `docs/adr/0004-analysis-and-merge.md`
- Community, moderation, and the operator procedure for moderators: `docs/adr/0005-community-and-moderation.md`
- Completed Specs: `.kiro/specs/01-foundation-place/`, `.kiro/specs/02-editor-versions/`, `.kiro/specs/03-analysis-compare-merge/`, and `.kiro/specs/04-community-moderation/`
- Spec 05 (dossiers and exports): `.kiro/specs/05-dossiers/`. Tasks 1 to 6 are done. Task 7 is open until the Node 24 `check:ci` run and the dossier captures are recorded.

## Security

Never commit service-role keys, passwords, evaluation credentials, or provisioning secrets. Public browser code may use only the Supabase publishable key. All exposed database tables must use RLS, and complex writes will be implemented as transactional database functions with explicit grants.

## License

Application code is licensed under MIT. Source data and dependencies keep their own licenses; see `THIRD_PARTY_NOTICES.md`.

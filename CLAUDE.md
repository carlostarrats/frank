# Frank — Claude Code Context

## What This Is
A local-first collaboration layer. Point it at any URL — localhost, staging, production — or drop a PDF, image, or canvas, and Frank wraps it with commenting, async review, live multiplayer canvas collaboration, feedback curation, AI routing, and a complete data trail of how the thing was built.

PolyForm Shield 1.0.0 license (source-available; prohibits competing products — see `LICENSE` + `THIRD-PARTY-LICENSES.md`). Mac-first. Browser-based (no native app).

Latest tagged release: `v3.0` (canvas live share + async share for URL/PDF/image).
Current branch: `dev-v3.1` (post-v3.0 cleanup / no named milestone).

## v3.0 scope, and what's NOT on the roadmap

**Live share is a canvas-only user-facing feature.** Canvas projects get full live collaboration (shape edits, drops, moves, comments all propagate to open viewers over SSE). Image, PDF, and URL projects pick up the shared transport infrastructure incidentally but surface static share + commenting as their UX — same as v2.

**URL live share was explored and deprioritized.** Screen-sharing (Google Meet, Zoom, Tuple) handles the real-time URL review case; v2's static share covers async. URL live would fight the architecture (cross-origin observability, auth leakage through proxy, reviewer network-context divergence) for use cases already covered by better tools. Not on the roadmap.

**Phase 4b (PDF.js rendering migration) was dropped.** It was scoped as enabling PDF live sync. With PDF live sync not a feature, Phase 4b's justification collapsed. Browser-native PDF rendering is adequate for static PDF share.

**No named post-v3.0 milestone.** `dev-v3.x` branches hold fragile-list cleanup from the Phase 6 handler audit, bug fixes from real v3.0 usage, or sit idle. Forcing a milestone when none is warranted is worse than shipping slowly.

Direction doc: [`docs/frank-v3-direction.md`](docs/frank-v3-direction.md).

---

## Architecture — Non-Negotiable Decisions

### Browser-Based
- **No Tauri, no native app.** Frank runs as a Node.js daemon + browser UI at `localhost:42068`.
- The daemon serves the UI, handles file I/O, proxies content, and communicates via WebSocket.

### Content Wrapping
- Frank loads any URL in a **controlled iframe** with a transparent commenting overlay on top.
- For sites that block iframe embedding (X-Frame-Options, CSP), the daemon **proxies** the content, stripping only iframe-restrictive headers.
- The iframe content is the real running page — Frank does not modify or re-render it.

### Daemon as Sole File Writer
- The daemon is the sole file writer — the UI never touches the filesystem.
- All file I/O goes through the daemon via WebSocket.
- Projects stored in `~/.frank/projects/{id}/` as JSON files.
- Uploaded source files live at `~/.frank/projects/{id}/source/`.
- Canvas image drops + comment attachments live at `~/.frank/projects/{id}/assets/`, content-addressed by sha256.

### Self-Hosted Cloud
- Sharing talks to a backend **the user hosts**. There is no Anthropic-run cloud.
- The backend contract is documented in [`CLOUD_API.md`](CLOUD_API.md). v3 adds live-share endpoints on top of v2's static-share shape: `/api/health`, `GET+POST+DELETE /api/share`, `POST /api/comment`, `POST /api/share/:id/state`, `GET /api/share/:id/stream`, `GET /api/share/:id/author-stream`, `POST /api/share/:id/ping`.
- `frank-cloud/` is the **reference implementation** — Vercel serverless functions + Vercel Blob (durable share payloads) + Upstash Redis (live presence, pubsub, session tracking, rolling 60s diff buffer). Full deployment walkthrough including required Vercel Marketplace integrations and the Deployment Protection gotcha: [`frank-cloud/DEPLOYMENT.md`](frank-cloud/DEPLOYMENT.md).
- Any host that serves the contract works — Cloudflare Workers, Deno Deploy, self-hosted Node, etc. The Settings modal (home header → cog icon) has a "Use Vercel" tab with a one-click **Deploy to Vercel** button (`vercel.com/new/clone?...` with `root-directory=frank-cloud` + `FRANK_API_KEY` env prompt) and a "Use your own" tab for alternative backends.
- Required env vars on the backend: `FRANK_API_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` (Vercel Marketplace naming) OR `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (direct Upstash naming — `lib/redis.ts` reads either), `BLOB_READ_WRITE_TOKEN`.
- Handler runtime split: `api/health.ts` and `api/tick.ts` run on Vercel's **edge** runtime (Fetch-API, no Blob deps). All blob-touching handlers run on Vercel's **nodejs** runtime with classic `(req: VercelRequest, res: VercelResponse)` signatures — edge rejects `@vercel/blob` at build time because of its transitive Node-only deps. `DEPLOYMENT.md` covers why.
- The CLI equivalent is `frank connect <url> --key <key>`, which writes URL + key to `~/.frank/config.json` (mode 0600, secret-aware write). The Settings modal hits the same daemon handlers (`set-cloud-config`, `test-cloud-connection`).
- `saveCloudConfig()` also writes `cloudConfiguredAt` (ISO timestamp). It flows back through `get/set-cloud-config` so the Settings UI can show a green "Already configured on <date>" hint at the top of both tabs when a config is on file.
- Cloud is optional — everything except sharing works offline. Until it's configured, the Share button warns that cloud isn't set up.
- For canvas sharing, the daemon bundles the canvas state + every referenced asset as inline data URLs into the share payload, so the cloud viewer can render without round-tripping back to the daemon.
- For live share, the daemon opens a long-lived SSE connection to `/api/share/:id/author-stream` per active live share and POSTs state updates to `/api/share/:id/state` with monotonic revisions. Viewers open `/api/share/:id/stream` and receive either a full state (cold open, or 30s stale) or a diff replay from the 60s rolling buffer. All three per-project-type controllers (canvas/image/pdf) share the transport; only canvas surfaces live as a user-facing feature.

### Plain JS Frontend
- **No build step.** The `ui-v2/` directory is served directly by the daemon's HTTP server.
- **No framework.** Plain DOM — innerHTML for static renders, event listeners for interaction.
- Plain JS ES modules — no TypeScript, no bundler, no transpilation.
- Plain CSS with custom properties — no Tailwind, no CSS-in-JS.
- **Konva** is loaded via `<script>` tag in `index.html` (unpkg CDN) and accessed as `window.Konva`. It powers the canvas view.
- **jsPDF + svg2pdf** and **pdfmake** are loaded on demand (jsPDF/svg2pdf from CDN on first use; pdfmake is a daemon-side dep) — only pay the cost when the user actually exports.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Browser UI | Plain JS ES modules (no framework, no build step) |
| Canvas | [Konva](https://konvajs.org/) 9, loaded via `<script>` tag |
| Daemon | Node.js + TypeScript — HTTP server (42068) + WebSocket (42069) |
| AI | `@anthropic-ai/sdk`, streaming via `messages.stream()` |
| Content wrapping | iframe + transparent overlay + content proxy |
| Cloud sharing | Vercel serverless functions + Blob storage (self-hosted) |
| Project storage | JSON files in `~/.frank/projects/` |
| Comment anchoring | CSS selector + DOM path + visual coordinates (URL/PDF/image); shape ID + last-known world position (canvas) |
| Canvas export | Raster PNG (Konva) · Vector SVG (in-house Konva→SVG translator) · Vector PDF (jsPDF + svg2pdf.js) |
| Report export | Markdown (hand-written) · PDF (pdfmake w/ Roboto) |

---

## Project Structure

```
frank/
├── ui-v2/                    # Browser UI (plain JS, no build step)
│   ├── index.html            # Entry point; Konva <script> tag
│   ├── app.js                # App shell: view router, state, toast on create failure
│   ├── frank-logo.svg
│   ├── core/
│   │   ├── sync.js           # WebSocket client; reconnect toasts on disconnect/recover
│   │   └── project.js        # In-memory project state manager
│   ├── views/
│   │   ├── home.js           # Project list — tabs (Recent/Archived/Deleted), create, rename, archive, trash, search/sort/filter, Settings + Help buttons
│   │   ├── viewer.js         # Content viewer — iframe + overlay + comment pins + popover + AI panel + error card on proxy fail
│   │   ├── canvas.js         # Konva canvas view — tools, comments, snapshots, share, export, shortcuts, undo (button + Cmd+Z), copy/paste/duplicate, timeline
│   │   └── timeline.js       # Chronological view + unified Export dropdown (JSON/MD/PDF) + Show-folder button
│   ├── canvas/
│   │   ├── stage.js          # Konva Stage + Layer setup, pan (space+drag), zoom
│   │   ├── tools.js          # Tool modes: select, rect, text, sticky, freehand, arrow, elbow, shapes, paths
│   │   ├── transformer.js    # Selection + Konva.Transformer handles; Delete/Cmd+G/Cmd+Shift+G keybinds
│   │   ├── serialize.js      # Save/load via Konva JSON; rebinds connectors + rehydrates images
│   │   ├── shapes.js         # Shape factories (shared by tools + templates)
│   │   ├── paths.js          # SVG path data for Path-based shapes
│   │   ├── connectors.js     # Follow-shape arrow/elbow connectors (dragmove index)
│   │   ├── endpoint-edit.js  # Connector endpoint handles (re-attach on drag)
│   │   ├── anchors.js        # Rotation-aware shape anchors + nearest-snap target
│   │   ├── templates.js      # Kanban/Mindmap/Flowchart/Calendar inserts + group/ungroup
│   │   ├── properties.js     # Right-side inspector (fill, stroke, alignment, dissolve group)
│   │   ├── comments.js       # Shape-anchored comments: pins + dragmove follow + orphan treatment
│   │   ├── image.js          # Drop images → upload asset → Konva.Image; rehydrate on load
│   │   ├── shortcuts.js      # V/R/T/P/N/A, Esc, Cmd+Z/Shift+Z, Cmd+D, Cmd+C/Cmd+V (copy/paste shapes)
│   │   ├── cursors.js        # SVG data-URL cursors for every tool + COMMENT_CURSOR (shared with viewer)
│   │   ├── history.js        # In-memory undo/redo ring buffer
│   │   ├── svg-export.js     # Konva content layer → standalone SVG string
│   │   └── export.js         # PNG/SVG/PDF/JSON download helpers (PDF routes SVG→svg2pdf)
│   ├── overlay/
│   │   ├── overlay.js        # Click handling, comment mode toggle, custom COMMENT_CURSOR on same-origin iframes
│   │   ├── element-detect.js # Smart element detection (bubble to meaningful)
│   │   ├── anchoring.js      # Triple-anchor: CSS selector + DOM path + coords; free-pin anchor for empty-space clicks
│   │   ├── pins.js           # Viewer-side pin rendering — numbered colored markers + shared popover (parity with canvas)
│   │   ├── highlight.js      # Element highlight rendering
│   │   └── snapshot.js       # DOM snapshot capture for sharing
│   ├── components/
│   │   ├── toolbar.js        # Top toolbar (viewer) + exported SVG icons (commentPlus/camera/link/download/timeline/undo) shared with canvas
│   │   ├── curation.js       # Feedback curation panel — inline edit, approve/dismiss toggles, pin-number color badge, focus-pulse, Copy-for-AI (batch), Delete (batch)
│   │   ├── comments.js       # Comment input (used by overlay callback)
│   │   ├── share-popover.js  # Share link management (viewer + canvas)
│   │   ├── ai-routing.js     # Clipboard AI routing (non-Claude fallback)
│   │   ├── ai-panel.js       # In-app Claude conversation, streaming
│   │   ├── url-input.js      # URL paste + file picker + drag-drop (PDF / image)
│   │   ├── help-panel.js     # Getting-started modal (5 feature cards, focus trap)
│   │   ├── settings-panel.js # Settings modal — tabbed Cloud backend config (Vercel / custom), Deploy-to-Vercel CTA, "Why would I want a new deployment?" help, configured-at green hint, scrollable body with pinned header + Test connection
│   │   ├── toast.js          # info/warn/error notifications (top-right, stackable, info shows checkmark)
│   │   └── error-card.js     # Inline error block (message + suggestion + retry)
│   └── styles/
│       ├── tokens.css        # Design tokens, resets, :focus-visible rule
│       ├── app.css           # Home, toolbar, cards, help modal, toasts, error cards
│       ├── ui.css            # Button/input primitives
│       ├── overlay.css       # Overlay + highlight styles
│       ├── comments.css      # Comment input styles
│       ├── curation.css      # Curation panel styles
│       ├── timeline.css      # Timeline view + canvas badge + thumbnail
│       ├── canvas.css        # Canvas topbar, drawer, inspector, curation host, comment popovers, export menu
│       └── ai-panel.css      # AI panel chrome
├── daemon/                   # Node.js daemon (TypeScript, strict)
│   ├── vitest.config.ts
│   ├── package.json          # deps: @anthropic-ai/sdk, ws, pdfmake, tslib
│   ├── src/cli.ts            # frank start / stop / connect / status / export / uninstall
│   ├── src/server.ts         # HTTP + WebSocket server, all message handlers
│   ├── src/protocol.ts       # Shared types and constants
│   ├── src/projects.ts       # Project CRUD + rename/archive/trash/restore/purge + createProjectFromFile
│   ├── src/assets.ts         # Content-addressed (sha256) asset storage per project
│   ├── src/proxy.ts          # Content proxy for iframe-restricted URLs
│   ├── src/cloud.ts          # Cloud client (share upload, comment fetch) + secret-aware config I/O
│   ├── src/snapshots.ts      # DOM snapshot + canvas snapshot storage (thumbnail PNG for canvas)
│   ├── src/curation.ts       # Curation log (approve, dismiss, remix, batch)
│   ├── src/ai-chain.ts       # AI instruction chain logging
│   ├── src/export.ts         # Structured JSON export
│   ├── src/report.ts         # Project report — Markdown + PDF (pdfmake, Roboto)
│   ├── src/inject.ts         # CLAUDE.md injection/removal
│   ├── src/canvas.ts         # Canvas state I/O (one JSON blob per project)
│   ├── src/ai-conversations.ts  # Per-project AI conversation storage (size + msg count caps)
│   ├── src/ai-providers/claude.ts  # Claude API client, context builder with token budget
│   └── src/*.test.ts         # Vitest tests (135 across 12 files)
├── frank-cloud/              # Reference cloud backend — Vercel + Blob (users host their own)
│   ├── api/                  # Serverless functions (share, comment, health)
│   ├── public/viewer/        # Share viewer page (iframe OR canvas render via Konva CDN)
│   ├── vercel.json           # Routes, headers, security
│   └── README.md             # Deploy guide with security checklist
├── CLAUDE.md
├── CLOUD_API.md              # Cloud API contract — required reading if porting to another host
├── PROGRESS.md
└── README.md
```

---

## Key Rules

- **URL-first or canvas-first**: the input is a URL, file (PDF/image), or a blank canvas — not a JSON schema
- **Daemon is sole file writer**: UI never touches the filesystem
- **All data local by default**: nothing leaves the machine unless user hits Share (or uses the AI panel, which calls Claude directly with the user's own key)
- **Self-hosted cloud**: users deploy their own sharing backend (Vercel reference in `frank-cloud/` or any host implementing `CLOUD_API.md`)
- **Setup is required for sharing**: Share button warns until cloud is configured via Settings modal or `frank connect`
- **No build step**: `ui-v2/` must be servable as-is
- **Smart element detection**: clicks bubble up to meaningful elements, not raw DOM nodes
- **Triple-anchor comments** for DOM targets; **shape-anchor comments** for canvas shapes (pin follows on drag; orphaned pins survive at last-known position)
- **Vector exports**: PDF and SVG go through the Konva→SVG translator → svg2pdf for PDF. Raster is only for PNG. "A PDF needs to be vector."
- **Security first**: sensitive content detection before sharing, input validation, upload allowlists + size caps, secret-aware config writes (0600 for API keys)
- **No silent failures**: user-facing errors surface as a toast or an inline error card with a retry/action path

---

## Coding Conventions

- Plain JavaScript ES modules in the frontend (no TypeScript)
- Plain DOM — innerHTML for static renders, event listeners for interaction
- Functions returning HTML strings for rendering
- CSS custom properties for all design tokens
- All file I/O goes through the daemon via WebSocket
- Daemon TypeScript follows strict mode, atomic writes for all file operations
- User-facing keyboard actions get `:focus-visible` rings; non-trivial focusables gain `role`/`tabindex`/`aria-label`

---

## Views

| View | What it shows |
|---|---|
| **Home** | Project list + URL/file entry. **Tabs** (Recent / Archived / Deleted) replace the old collapsible sections. Search / sort / type-filter chips below the tab. Cards support **inline rename (F2), archive, soft-delete (30-day trash), restore, permanent delete**. Keyboard: ↑/↓ between cards, Enter to open, Delete to trash, F2 to rename. Header has a **Settings** cog (cloud backend config) and **Help** button. |
| **Viewer** | Content in iframe (URL/proxy/PDF/image) + commenting overlay + curation sidebar + AI panel sidebar. **Numbered colored pins** render on the overlay for each comment; click → same draggable Close/Edit/Delete popover used by canvas; feedback-row click → pin pulses. Empty-space clicks drop free pins. Proxy failures render an inline **error card with Retry**. |
| **Canvas** | Konva-backed sketching: select, rectangle, circle, ellipse, triangle, diamond, hexagon, star, cloud, speech, document, cylinder, parallelogram, arrow, elbow, pen, text, sticky. Pan (space+drag), zoom (wheel). **Shape- and pin-anchored comments** (SVG icon, speech-bubble-plus cursor), **snapshots** (camera icon, thumbnail saved, toast), **share** (link icon, bundled assets), **export dropdown** (PNG / SVG / PDF / JSON), **undo** (button + Cmd+Z, clears selection so no orphan transformer handles), **timeline** (shared event with viewer), **Cmd+C / Cmd+V / Cmd+D** copy/paste/duplicate shapes, **V/R/T/P/N/A/Esc** tool shortcuts, **drag-and-drop images** → content-addressed asset. State persists to `~/.frank/projects/{id}/canvas-state.json`. |
| **Timeline** | Chronological view of comments + snapshots + curations + AI instructions. Canvas snapshots show a Canvas badge + inline thumbnail. **Show folder** (reveal in Finder/Explorer) + unified **Export** dropdown (JSON / Markdown / PDF). Close (X) returns to canvas or viewer depending on the project. |

## Commenting — unified across viewer and canvas

As of v2.04 the two surfaces share one commenting UX end-to-end. Anything
that touches pins, popovers, curation, or feedback-to-AI should stay
unified on both sides.

- **Pin rendering** — canvas uses Konva circles on `uiLayer`; viewer uses
  absolutely-positioned HTML buttons on `.overlay`. Both use the same
  `PIN_PALETTE` (10 hues cycled by comment index) and the same visual
  grammar (circle + number, subtle shadow). Stale canvas pins go dashed/grey.
- **Popover** — uses the `.canvas-comment-popover` CSS class in both
  surfaces. Draggable by its header, clamped inside the viewport on open.
  Buttons: Close / Edit / Delete. Edit dispatches `frank:edit-comment` →
  feedback panel opens, scrolls to the row, enters inline edit mode.
- **Comment-mode cursor** — `COMMENT_CURSOR` (speech-bubble + plus SVG) is
  exported from `canvas/cursors.js` and applied in both the canvas stage and
  (on same-origin iframes) the viewer iframe body.
- **Free-pin on empty click** — both surfaces support it. Canvas emits
  `{ type: 'pin', x, y }` in world coords; viewer emits the same shape with
  x/y as percentages of the iframe viewport.
- **Feedback panel** — same `renderCuration` component mounted in both
  sidebars. Click a row to focus it (subtle tint + accented border) and
  trigger a continuous pulse on the matching pin. Click again to clear.
  Status toggles (approve/dismiss) are two-way: clicking the active
  status resets to pending via the `reset` curation action.
- **Data flow** — the daemon broadcasts `project-loaded` after every
  curate/delete/remix action; `app.js` handles the broadcast and calls
  `projectManager.setFromLoaded()`, which re-renders both the feedback
  panel and the pins. Before v2.04 the broadcast was ignored, which is
  why status changes appeared to do nothing.

Surface-specific features (canvas has undo/export/inspector/shapes; viewer
has URL proxy/AI panel/multi-page tracking) are intentional — they reflect
different tools, not visual drift.

## AI panel

- Persistent Claude conversation docked as a second right-side sidebar in the viewer. Toggle via the "AI" button in the toolbar.
- Claude API key lives in `~/.frank/config.json` under `aiProviders.claude.apiKey`. The daemon enforces `0600` permissions on every write and never logs the key.
- Conversations persist at `~/.frank/projects/{id}/ai-conversations/{conversationId}.json`. Size-first caps: soft warn at 2 MB / 100 messages (banner), hard cap at 5 MB / 200 messages (forces a new conversation with `continuedFrom` linking back).
- `buildContext()` in `ai-providers/claude.ts` assembles each turn's prompt within a per-section token budget (preamble 500 / canvas 3000 / comments 2000 / snapshots 1000 / remainder for history). Logs per-section char counts without content.
- Streaming responses flow daemon → WebSocket → UI: `ai-stream-started` → `ai-stream-delta` × N → `ai-stream-ended` (or `ai-stream-error`).
- Clipboard-based AI routing (`ai-routing.js`) still works as a fallback for users of non-Claude providers — the "Copy as prompt" button on curated comments is unchanged.

---

## Data shape

### Project lifecycle flags (`ProjectV2`)
- `archived?: string` — ISO timestamp when archived. Absence = active.
- `trashed?: string` — ISO timestamp when soft-deleted. Auto-purged after 30 days at daemon startup (`purgeExpiredTrash`).

### Comment anchor variants
- `type: 'element'` — DOM target (viewer). Carries `cssSelector`, `domPath`, visual coords **as percentages of the iframe viewport** (not pixels).
- `type: 'pin'` — Free-floating pin. On viewer, coords are percentages + optional `pageNumber` (PDF). On canvas, coords are absolute world coords.
- `type: 'shape'` — Canvas shape target. Carries `shapeId`, world coords, and `shapeLastKnown: { x, y }` that updates on every `dragmove` so deleted-shape pins survive at their final position.

### Curation actions
- `approve` / `dismiss` / `remix` / `batch` — apply a status.
- `reset` (added v2.04) — sets status back to `pending`. Used by the toggle-style buttons in the feedback panel so clicking the active status undoes it.

### Snapshot variants
- DOM snapshot: `snapshot.html` + optional screenshot. Used by URL/PDF/image projects.
- Canvas snapshot (`canvasState: true` marker on meta): writes `canvas-state.json` (serialized Konva) + optional `thumbnail.png` (0.5× stage PNG) inside the snapshot dir.

### Share payload (canvas)
`{ canvasState: string, assets: Record<url, dataUrl>, preview: string }` — fully self-contained; cloud viewer needs nothing but Konva from CDN to render.

---

## Error surfaces

Every failure path uses one of two components:
- `toast.js` — transient: info auto-dismisses 4s, warn 6s, error persists until dismissed. Info toasts show a green ✓ icon. Actions supported (e.g. "Retry now").
- `error-card.js` — inline: replaces failed content (viewer proxy failure, future upload-heavy surfaces).

Wired: viewer proxy failure (error card), canvas save double-failure (toast + retry), canvas export failure (toast), project-creation failure (toast), WebSocket disconnect (persistent error toast) + reconnect (info toast), snapshot saved/failed (toast on both canvas and viewer), cloud settings test/save status (inline + toast).

---

## Testing

The daemon has a Vitest test suite (**182 passing across 21 files**, plus an opt-in cloud integration harness with 9 more tests). Unit tests use temp directories — never touch real `~/.frank/`.

```bash
cd daemon
npm test           # run all unit tests once
npm run test:watch # watch mode

# Opt-in integration harness — exercises the real backend contract.
# Skipped on a plain `npm test` run. See frank-cloud/INTEGRATION_TESTING.md.
FRANK_CLOUD_BASE_URL=http://localhost:3000 \
  FRANK_CLOUD_API_KEY=<key> \
  npm test -- cloud-integration
```

Test files live alongside source: `src/*.test.ts`. Each test file mocks `./protocol.js` to redirect `PROJECTS_DIR` to a temp directory. The `inject.test.ts` file additionally mocks `os.homedir()` using `vi.hoisted()`.

**Covered modules:** `projects.ts`, `assets.ts`, `snapshots.ts`, `curation.ts`, `ai-chain.ts`, `export.ts`, `report.ts`, `proxy.ts`, `cloud.ts`, `inject.ts`, `canvas.ts`, `ai-conversations.ts`, `revision-store.ts`, `live-share.ts` (transport + per-project-type controllers for canvas/image/pdf).

After changing any daemon module, run `npm test` to verify nothing broke. For changes that touch the daemon ↔ cloud contract, run the integration harness too — see the "Shipping a phase" section below.

---

## Shipping a phase

A phase isn't complete when `daemon/npm test` passes. It's complete when the end-to-end flow it enables works against a real deployment — `vercel dev` locally or a Vercel preview — with the cloud integration harness green.

For any phase that touches the daemon ↔ cloud contract:

1. **Daemon unit tests pass** — `cd daemon && npm test`.
2. **Cloud integration harness passes** — `FRANK_CLOUD_BASE_URL=<url> FRANK_CLOUD_API_KEY=<key> npm test -- cloud-integration` (see [`frank-cloud/INTEGRATION_TESTING.md`](frank-cloud/INTEGRATION_TESTING.md)).
3. **Manual smoke of the phase's user-visible flow in a browser.**

Steps 1 and 2 are table stakes; step 3 catches UI-layer bugs neither set of tests can see. Skipping any of the three invalidates the "phase complete" claim.

This rule was written after the v3.0 smoke test surfaced five categorical cloud bugs that had survived Phases 1–5 because only step 1 was enforced. The rule exists because the failure mode is real and recent.

> **Enforcement is currently advisory.** Stronger patterns (a `npm run preflight` script, a pre-merge git hook, a required checkbox in the plan template) are v3.x follow-ups — see the "Out of scope" section of [`docs/superpowers/plans/2026-04-20-v3-phase6-cloud-stabilization.md`](docs/superpowers/plans/2026-04-20-v3-phase6-cloud-stabilization.md).

---

## After changing UI code

After any change to files in `ui-v2/`:
1. Just refresh the browser at `localhost:42068` — no build step needed.

After any change to files in `daemon/src/`:
1. `cd daemon && npm run build`
2. Run `npm test` to verify tests pass
3. Restart the daemon: kill the existing process, run `frank start`. Node does not hot-reload; a running daemon executes what it loaded at startup, not the rebuilt `dist/`.

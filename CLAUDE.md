# Frank — Claude Code Context

## What This Is
A local-first collaboration layer. Point it at any URL — localhost, staging, production — or drop a PDF, image, or canvas, and Frank wraps it with commenting, async review, live multiplayer canvas collaboration, feedback curation, AI routing, and a complete data trail of how the thing was built.

PolyForm Shield 1.0.0 license (source-available; prohibits competing products — see `LICENSE` + `THIRD-PARTY-LICENSES.md`). Mac-first. Browser-based (no native app).

Latest tagged release: `v3.0`. Current branch: `dev-v3.13`. Per-version shipping log lives in `PROGRESS.md` and `git log` — not here.

## Scope

**Live share is canvas-only as a user-facing feature.** Image, PDF, and URL projects share the transport infrastructure but surface as static share + commenting.

**URL share auto-deploys to the user's own Vercel.** Frank points at a local project directory, builds a preview with safe-dummy env, injects a same-origin comment overlay, and the reviewer interacts with the running app. Snapshot-only async share was too lossy for interactive apps (hovers, modals, client state don't survive a static dump). Design: [`docs/url-share-auto-deploy-design.md`](docs/url-share-auto-deploy-design.md). Guard patterns: [`docs/share-guards.md`](docs/share-guards.md).

**Phase 4b (PDF.js rendering migration) was dropped** — its only justification was PDF live sync, which isn't a feature.

Direction doc: [`docs/frank-v3-direction.md`](docs/frank-v3-direction.md).

---

## Architecture — Non-Negotiable Decisions

### Browser-Based, Daemon-Driven
- Node.js daemon at `localhost:42068` (HTTP) + `:42069` (WebSocket) serves the UI, handles file I/O, proxies content. **No Tauri, no native app.**
- **Daemon is sole file writer.** UI never touches the filesystem; all I/O goes through WebSocket.
- Projects in `~/.frank/projects/{id}/` — JSON files + `source/` (uploads) + `assets/` (canvas image drops + comment attachments, content-addressed by sha256).

### Content Wrapping
- Frank loads any URL in a controlled iframe with a transparent commenting overlay on top.
- For sites that block embedding (X-Frame-Options, CSP) the daemon proxies the content, stripping only iframe-restrictive headers.
- The iframe content is the real running page — Frank never modifies or re-renders it.

### Self-Hosted Cloud
- Sharing talks to a backend **the user hosts**. There is no Anthropic-run cloud.
- Contract documented in [`CLOUD_API.md`](CLOUD_API.md): `/api/health`, `GET+POST+DELETE /api/share`, `POST /api/comment`, `POST /api/share/:id/state`, `GET /api/share/:id/stream`, `GET /api/share/:id/author-stream`, `POST /api/share/:id/ping`.
- `frank-cloud/` is the **reference implementation** — Vercel functions + Vercel Blob (durable share payloads) + Upstash Redis (live presence, pubsub, rolling 60s diff buffer). Deploy guide: [`frank-cloud/DEPLOYMENT.md`](frank-cloud/DEPLOYMENT.md).
- Required env: `FRANK_API_KEY`, `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Vercel Marketplace) OR `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (direct Upstash; `lib/redis.ts` reads either), `BLOB_READ_WRITE_TOKEN`.
- Runtime split: `api/health.ts` and `api/tick.ts` run on Vercel **edge** (Fetch-API, no Blob deps). All blob-touching handlers run on **nodejs** with classic `(req, res)` signatures — edge rejects `@vercel/blob` at build time.
- Configure via Settings modal (cog in home header) or `frank connect <url> --key <key>` (writes `~/.frank/config.json`, mode 0600). `cloudConfiguredAt` ISO timestamp drives the Settings "Already configured on <date>" hint.
- **Cloud is optional** — everything except sharing works offline. Until configured, Share warns.
- Canvas share payload is self-contained: canvas state + every referenced asset as inline data URLs. Cloud viewer renders with Konva from CDN alone.
- Live share opens a long-lived SSE connection to `/api/share/:id/author-stream` per active live share, POSTs state with monotonic revisions to `/api/share/:id/state`. Viewers open `/api/share/:id/stream` and get either a full state (cold open or 30s stale) or diff replay from the 60s buffer. All three per-project-type controllers (canvas/image/pdf) share the transport; only canvas surfaces it as a user-facing feature.

### URL Share Auto-Deploy
- URL shares are **NOT static snapshots** — Frank deploys a real preview to the user's own Vercel; reviewer interacts with the running app.
- Pipeline (`daemon/src/share/`): envelope check → preflight build + 30s smoke tail → encoder registry generates safe-dummy env → overlay injected into root layout on a COPY → Vercel Deployments API upload + poll → frank-cloud share record → revoke contract.
- **Allowlist bundler is P0** (`share/bundler.ts`). Hardcoded positive list: framework source dirs, `package.json`, one lockfile, `public/`, known configs, middleware/proxy/instrumentation, exactly `.env.share`. Everything else refused — including explicit user request to ship `.env.local`. No flag overrides this.
- **Refuse-to-guess.** If a detected SDK has no registry encoder and no `.env.share` coverage, Share is refused with an actionable message. No silent dummies. Overclaiming is a trust failure.
- **User's working tree is never modified.** Overlay injection happens on a COPY in `~/.frank/share-builds/<shareId>/`. Each Share click picks up a fresh copy.
- **Overlay is bundled into each deployment**, not loaded cross-origin. `frank-overlay.js` ships into `public/` (or `static/` for SvelteKit) — same-origin, attaches a shadow-DOM pill, connects to frank-cloud via SSE for comments. Frank-cloud offline → overlay still renders, shows "comments unavailable" banner.
- **Vercel token is account-scoped** (Vercel PATs aren't permission-scoped — disclosed in Settings UI and design doc §6.1). SSO+password auto-disabled on the per-share Vercel project.
- **Revoke is two-step.** Cloud flag flips synchronously (link 404s within ms), Vercel DELETE fires after with a retry queue (`share/revoke-queue.ts` + `share/revoke-worker.ts`, 1m/5m/30m/1h/6h/24h backoff, drained on daemon startup + re-armed on enqueue).
- For paste-ready encoder outputs per SDK, read the `project_frank_calibration_sweep` memory — don't reverse-engineer from tests.
- Static-HTML projects supported (no framework needed — denylist bundler, skip preflight, inject overlay at root).

### Plain JS Frontend
- **No build step.** `ui-v2/` is served as-is by the daemon's HTTP server.
- **No framework.** Plain DOM — innerHTML for static renders, event listeners for interaction. Plain CSS with custom properties — no Tailwind, no CSS-in-JS.
- **Konva** loaded via `<script>` tag in `index.html` (unpkg CDN), accessed as `window.Konva`. Powers the canvas view.
- **jsPDF + svg2pdf** and **pdfmake** load on demand (jsPDF/svg2pdf from CDN on first use; pdfmake is a daemon dep).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Browser UI | Plain JS ES modules (no framework, no build step) |
| Canvas | [Konva](https://konvajs.org/) 9 via `<script>` tag |
| Daemon | Node.js + TypeScript — HTTP (42068) + WebSocket (42069) |
| AI | BYO — MCP server (stdio, `frank mcp`), clipboard "Copy as prompt", JSON / MD / PDF export. **No in-app AI chat.** |
| Content wrapping | iframe + transparent overlay + content proxy |
| Cloud sharing | Vercel functions + Vercel Blob + Upstash Redis (self-hosted) |
| Project storage | JSON files in `~/.frank/projects/` |
| Comment anchoring | CSS selector + DOM path + visual coords (URL/PDF/image); shape ID + last-known position (canvas) |
| Canvas export | Raster PNG (Konva) · Vector SVG (Konva→SVG translator) · Vector PDF (jsPDF + svg2pdf.js) |
| Report export | Markdown + PDF (pdfmake w/ Roboto) |
| Bundle export | Zip (JSZip) — JSON + reports + snapshots + source + assets |
| URL share auto-deploy | `daemon/src/share/` — envelope + allowlist bundler + preflight + SDK encoders + overlay injection + Vercel API. `semver` for encoder version checks. |

---

## Project Structure

Per-file annotations are intentionally omitted — read the actual files. Names are descriptive.

```
frank/
├── ui-v2/                  # Browser UI — served as-is, no build
│   ├── index.html          # Entry; Konva <script> tag
│   ├── app.js              # App shell + view router
│   ├── core/               # sync.js (WS client), project.js (in-memory state)
│   ├── views/              # home, viewer, canvas, timeline
│   ├── canvas/             # Konva: stage, tools, transformer, serialize, shapes, paths,
│   │                       # connectors, endpoint-edit, anchors, templates, properties,
│   │                       # comments, image, shortcuts, cursors, history, svg-export, export
│   ├── overlay/            # iframe overlay: overlay, element-detect, anchoring, pins, highlight, snapshot
│   ├── components/         # toolbar, curation, intent-button, comments, comment-composer (shared),
│   │                       # share-popover, ai-routing, url-input, help-panel, settings-panel,
│   │                       # share-envelope-panel, toast, error-card, confirm
│   └── styles/             # tokens, app, ui, overlay, comments, curation, timeline, canvas, share-envelope
├── daemon/                 # Node.js + TypeScript daemon (strict)
│   ├── src/cli.ts          # frank start / stop / connect / status / export / mcp / share / uninstall
│   ├── src/server.ts       # HTTP + WS server, all message handlers
│   ├── src/protocol.ts     # Shared types + constants
│   ├── src/projects.ts     # CRUD + rename/archive/trash/restore/purge + setProjectIntent
│   ├── src/{assets,proxy,cloud,snapshots,curation,ai-chain,export,report,bundle}.ts
│   ├── src/{canvas,canvas-writes,live-share,inject}.ts
│   ├── src/mcp/            # MCP server (stdio): server.ts, bridge.ts, tools.ts (15 tools)
│   ├── src/share/          # URL share auto-deploy pipeline (see Architecture § URL Share Auto-Deploy)
│   ├── src/*.test.ts       # Vitest tests; opt-in cloud-integration harness skipped by default
│   └── frank-audit.mjs     # CLI + MCP end-to-end harness; `node frank-audit.mjs` after CLI/MCP changes
├── frank-cloud/            # Reference cloud backend (Vercel + Blob + Redis)
├── docs/                   # frank-v3-direction.md, url-share-auto-deploy-design.md, share-guards.md
├── CLOUD_API.md            # Cloud API contract — required reading if porting to another host
├── PROGRESS.md             # Per-version shipping log
└── README.md
```

---

## Key Rules

- **URL-first or canvas-first.** Input is a URL, file (PDF/image), or blank canvas — not a JSON schema.
- **Daemon is sole file writer.** UI never touches the filesystem.
- **All data local by default.** Nothing leaves the machine unless the user hits Share. Frank does not call any AI service itself; AI routing is clipboard + export + MCP only.
- **Self-hosted cloud.** Share button warns until cloud is configured.
- **No build step.** `ui-v2/` must be servable as-is.
- **Triple-anchor comments** for DOM targets; **shape-anchor comments** for canvas (pin follows on drag; orphaned pins survive at last-known position).
- **Vector exports.** PDF and SVG go through Konva→SVG → svg2pdf for PDF. Raster only for PNG. *A PDF needs to be vector.*
- **Security first.** Sensitive content detection before sharing, input validation, upload allowlists + size caps, secret-aware config writes (0600 for API keys).
- **No silent failures.** Every user-facing error surfaces as a toast or inline error card with retry/action path.
- **URL share never modifies the user's working tree.** Overlay injection is on a COPY. Bundler is a hardcoded allowlist — no flag ships `.env.local` or a private key.
- **Refuse-to-guess beats silent dummy.** Unknown SDK with no `.env.share` coverage → Share refuses.

---

## Coding Conventions

- Plain JS ES modules in the frontend (no TypeScript).
- Plain DOM — innerHTML for static renders, event listeners for interaction. Functions returning HTML strings for rendering.
- CSS custom properties for all design tokens.
- Daemon TypeScript: strict mode, atomic writes for all file operations.
- Keyboard actions get `:focus-visible` rings; non-trivial focusables get `role` / `tabindex` / `aria-label`.
- **One design system.** One button system (`.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-destructive` + `.btn-sm`); one input system (`.input` + `textarea.input`); checkboxes use `.ui-checkbox`. Radii via `var(--radius-round)` / `var(--radius-sm)` — no hardcoded `border-radius`.
- **Use `confirm.js`** (Frank-styled confirm dialog) instead of `window.confirm()`. Sharp corners, focus-trapped, Escape/overlay-click resolve false.

---

## Views

| View | What it shows |
|---|---|
| **Home** | Project list + URL/file entry. Tabs (Recent / Archived / Deleted). Search/sort/type-filter chips. Inline rename (F2), archive, soft-delete (30-day trash), restore, permanent delete. Cards surface red pulsing **LIVE · N** pill (active live sessions) + muted **Shared** chip (active share record). Keyboard: ↑/↓, Enter, Delete, F2. Header: Settings cog + Help. |
| **Viewer** | iframe (URL/proxy/PDF/image) + commenting overlay + curation sidebar. Click-anywhere commenting: crosshair cursor, every click drops a free pin (no element detection). Numbered colored pins; click → draggable Close/Edit/Delete popover; feedback-row click → pin pulses. X in feedback drawer top-right closes it + exits comment mode (toolbar comment button toggles too). Proxy failures → inline error card with Retry. |
| **Canvas** | Konva sketching: select, rect, circle, ellipse, triangle, diamond, hexagon, star, cloud, speech, document, cylinder, parallelogram, arrow, elbow, pen, text, sticky. Pan (space+drag), zoom (wheel). Intent pill, shape-anchored comments, **Bookmark moment** (camera — captures state + thumbnail), Share, Download (bundle zip), Export (PNG/SVG/PDF/JSON), undo (button + Cmd+Z), timeline. Cmd+C/V/D for shapes; V/R/T/P/N/A/Esc tool shortcuts. Drag-and-drop images → content-addressed asset. State at `~/.frank/projects/{id}/canvas-state.json`. |
| **Timeline** | Chronological view of comments + bookmarks + curations + AI instructions. Canvas bookmarks show Canvas badge + thumbnail. Show folder + Export (JSON/MD/PDF). |

---

## Commenting — unified across canvas, viewer, and reviewer overlay

Every commenting surface uses the same UX: a reviewer on a Vercel-deployed share sees the same composer as the user inside Frank. **Changes to commenting UX must land in all three places.**

- **Shared composer** (`ui-v2/components/comment-composer.js`) — 260px floating `.canvas-comment-input` at the click point, `⋮⋮` drag-grip + textarea + Cancel/Post. Cmd/Ctrl+Enter submits; Escape cancels; drag clamps so 40px stays visible. Used by canvas (`canvas/comments.js`) and viewer (`overlay/overlay.js`). Reviewer overlay (`daemon/src/share/overlay-source.ts`) ships a visual twin in its shadow DOM since the shadow root can't reach Frank's stylesheet.
- **Cursor** — `COMMENT_CURSOR` from `ui-v2/canvas/cursors.js` is plain `'crosshair'`. Canvas stage container, viewer `.overlay.comment-mode`, and reviewer `.intercept` layer all use it.
- **Click-anywhere pinning** — every click drops a free pin (no element detection, no hover dashed outline, no selection rectangle). Canvas emits `{ type: 'pin', x, y }` in world coords (or `{ type: 'shape', shapeId, ... }` if the click hits an existing shape — shapes are first-class on canvas). Viewer + reviewer emit pins with x/y as viewport percentages.
- **Pin rendering** — canvas uses Konva circles on `uiLayer`; viewer uses absolutely-positioned HTML buttons; reviewer uses shadow-DOM buttons. All three share `PIN_PALETTE` (10 hues, cycled by index). Stale canvas pins (deleted shape) go dashed/grey.
- **Read popover** — `.canvas-comment-popover` on canvas + viewer; draggable, viewport-clamped. Edit dispatches `frank:edit-comment` → feedback panel scrolls + enters inline edit. Reviewer uses `.read-popover` in shadow DOM with Close only (reviewers don't edit/delete).
- **Feedback drawer** — `renderCuration` mounts in viewer sidebar + canvas curation host. Status toggles are two-way (clicking active status → `reset` → pending).
- **Data flow** — daemon broadcasts `project-loaded` after every curate/delete/remix; `app.js` calls `projectManager.setFromLoaded()` (re-renders feedback + pins). `syncCloudComments` pulls reviewer comments from both `project.activeShare.id` AND every record in `share-records.json` (URL auto-deploy shares write there) and runs once on `load-project` so the author sees fresh state without waiting for the 30s tick.

Surface-specific features (canvas undo/export/inspector/shapes; viewer URL proxy / multi-page) are intentional — different tools, not visual drift.

---

## AI routing (BYO tool — no in-app chat)

Frank does not bundle an in-app AI chat. That would lock users into one provider and force API-key management inside Frank. Three handoff paths instead:

- **MCP server** (`daemon/src/mcp/`) — AI connects directly to Frank. User adds a config snippet (Settings → MCP Setup) that spawns `frank mcp` as a subprocess; stdio↔WebSocket bridge (`bridge.ts`) forwards calls to the running daemon. **15 tools** — reads (list_projects, load_project, get_intent, get_comments, get_canvas_state, list_snapshots, get_timeline, export_bundle), canvas writes (add_shape, add_text, add_path, add_connector, insert_template, add_comment), create_share. Canvas writes broadcast `canvas-state-changed` so open browser tabs re-render live.
- **Clipboard** (`ai-routing.js`) — "Copy as prompt" puts a structured prompt on the clipboard (including project intent if set). Paste anywhere.
- **Export** (`daemon/src/export.ts` + `report.ts` + `bundle.ts`) — hand off the entire project at once.

`daemon/src/ai-chain.ts` logs every Copy-as-prompt action so exports include the decision trail.

**Intentionally NOT exposed as MCP tools:** revoke share, live-share start/resume/pause, delete project, curation actions. These are humans' calls.

**MCP projectId discipline:** `activeProjectId` on the daemon tracks the browser's current view. MCP tools always pass an explicit `projectId` so an AI writing to project B never clobbers what the user is looking at in project A.

---

## Data shape

### `ProjectV2` lifecycle + metadata
- `archived?` / `trashed?` — ISO timestamps. Trashed projects auto-purge after 30 days at startup (`purgeExpiredTrash`).
- `intent?` — free-text project brief, ≤ 2000 chars (trimmed; empty deletes the field). Renders as amber "Add Intent" / green "Intent set" pill in viewer + canvas. Prepended to Copy-for-AI prompts; included in JSON/MD/PDF exports under "Project brief".
- `sourceDir?` — absolute path to local project directory for URL share auto-deploy.

### Comment anchor variants
- `type: 'element'` — DOM target (viewer): `cssSelector`, `domPath`, visual coords as **percentages of the iframe viewport**.
- `type: 'pin'` — Free-floating: viewer uses percentages + optional `pageNumber` (PDF); canvas uses absolute world coords.
- `type: 'shape'` — Canvas shape: `shapeId`, world coords, `shapeLastKnown: { x, y }` updated on every `dragmove` so deleted-shape pins survive at their final position.

### Curation actions
`approve` / `dismiss` / `remix` / `batch` / `reset` (sets back to pending — used by toggle-style buttons).

### Snapshot variants
- DOM snapshot: `snapshot.html` + optional screenshot (URL/PDF/image projects).
- Canvas "Bookmark moment" (`canvasState: true` on meta): `canvas-state.json` + optional `thumbnail.png` (0.5× stage PNG). User-facing terminology distinguishes capture-a-point-in-time from the Download bundle; on-disk layout matches the v2 "snapshot" concept.

### Download bundle (`daemon/src/bundle.ts` via JSZip)
`project.json` + `report.md` + `report.pdf` + `canvas-state.json` (canvas) + `snapshots/` + `source/` + `assets/`.

### Share payload (canvas)
`{ canvasState: string, assets: Record<url, dataUrl>, preview: string }` — fully self-contained; cloud viewer needs only Konva from CDN.

---

## Error surfaces

- `toast.js` — transient: info auto-dismisses 4s (green ✓), warn 6s, error persists. Actions supported (e.g. "Retry now").
- `error-card.js` — inline: replaces failed content (viewer proxy failure, future upload-heavy surfaces).

Wired: viewer proxy failure (error card), canvas save double-failure (toast + retry), canvas export failure, project-creation failure, WebSocket disconnect/reconnect, snapshot save, cloud settings test/save.

---

## Testing

```bash
cd daemon
npm test           # unit tests
npm run test:watch # watch mode

# Opt-in cloud integration harness — skipped on plain `npm test`.
FRANK_CLOUD_BASE_URL=http://localhost:3000 \
  FRANK_CLOUD_API_KEY=<key> \
  npm test -- cloud-integration
```

- Tests live alongside source: `daemon/src/*.test.ts`. Each mocks `./protocol.js` to redirect `PROJECTS_DIR` to a temp dir; `inject.test.ts` also mocks `os.homedir()` via `vi.hoisted()`. **Unit tests never touch real `~/.frank/`.**
- Integration harness setup: [`frank-cloud/INTEGRATION_TESTING.md`](frank-cloud/INTEGRATION_TESTING.md).
- For CLI + MCP changes: `node daemon/frank-audit.mjs` (end-to-end harness — spawns `frank mcp` over stdio, runs assertions across every subcommand and tool).

---

## Shipping a phase

A phase isn't complete when `daemon/npm test` passes. It's complete when the end-to-end flow works against a real deployment.

For any phase that touches the daemon ↔ cloud contract:
1. **Daemon unit tests pass** — `cd daemon && npm test`.
2. **Cloud integration harness passes** — see [`frank-cloud/INTEGRATION_TESTING.md`](frank-cloud/INTEGRATION_TESTING.md).
3. **Manual smoke of the user-visible flow in a browser.**

Steps 1+2 are table stakes; step 3 catches UI-layer bugs neither set of tests can see. Skipping any of the three invalidates the "phase complete" claim.

This rule exists because v3.0's smoke test surfaced five categorical cloud bugs that survived Phases 1–5 — only step 1 was being enforced. Stronger enforcement (preflight script, pre-merge hook, plan checkbox) is v3.x follow-up.

---

## After changing code

- **`ui-v2/`** — refresh the browser at `localhost:42068`. No build step.
- **`daemon/src/`** — `cd daemon && npm run build && npm test`, then restart the daemon (kill, then `frank start`). Node does not hot-reload — a running daemon executes what it loaded at startup, not the rebuilt `dist/`.

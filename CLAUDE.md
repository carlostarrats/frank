# Frank — Claude Code Context

## What This Is
A local-first collaboration layer. Point it at any URL — localhost, staging, production — or drop a PDF, image, or canvas, and Frank wraps it with commenting, async review, live multiplayer canvas collaboration, feedback curation, AI routing, and a complete data trail of how the thing was built.

PolyForm Shield 1.0.0 license (source-available; prohibits competing products — see `LICENSE` + `THIRD-PARTY-LICENSES.md`). Mac-first. Browser-based (no native app).

Latest tagged release: `v3.0` (canvas live share + async share for URL/PDF/image).
Current branch: `dev-v3.7` (post-v3.0 shipping: intent field, bundle-first download, MCP server, **URL share auto-deploy**).

## Scope — what ships and what's NOT on the roadmap

**Live share is a canvas-only user-facing feature.** Canvas projects get full live collaboration (shape edits, drops, moves, comments all propagate to open viewers over SSE). Image, PDF, and URL projects pick up the shared transport infrastructure incidentally but surface static share + commenting as their UX.

**URL share auto-deploy was reopened and shipped as v3.3+ work.** Prior direction doc had URL live share deprioritized in favor of screen-share tools — that call was revisited when the snapshot-only async path turned out to be too lossy for interactive apps (hovers, modals, client state don't survive a static HTML dump). The new approach: point Frank at a local project directory, Frank auto-deploys a preview to the user's own Vercel account with safe-dummy env, injects a same-origin comment overlay, reviewer interacts with the real running app. Full design: [`docs/url-share-auto-deploy-design.md`](docs/url-share-auto-deploy-design.md). Guard patterns: [`docs/share-guards.md`](docs/share-guards.md).

**Phase 4b (PDF.js rendering migration) was dropped.** It was scoped as enabling PDF live sync. With PDF live sync not a feature, Phase 4b's justification collapsed. Browser-native PDF rendering is adequate for static PDF share.

**Post-v3.0 additions (shipped on the dev branch):**
- **Project brief / Intent** — free-text `intent` field on `ProjectV2` (≤ 2000 chars). Amber "Add Intent" / green "Intent set" pill in viewer + canvas toolbars. Prepended to Copy-for-AI prompts and included in JSON / MD / PDF exports.
- **Bundle-first Download** — one zip (`daemon/src/bundle.ts` via JSZip) containing project.json + report.md + report.pdf + canvas-state.json + snapshots/ + source/ + assets/. Renamed canvas "Snapshot" → "**Bookmark moment**" so its intent doesn't blur with Download.
- **MCP server** (`daemon/src/mcp/`) — Frank exposes 15 tools over Model Context Protocol (stdio transport). Tools cover reads (list_projects, load_project, get_intent, get_comments, get_canvas_state, list_snapshots, get_timeline, export_bundle) + canvas writes (add_shape, add_text, add_path, add_connector, insert_template placeholder, add_comment) + create_share. AI connects directly to a running daemon via `frank mcp` subprocess. Setup in Settings → MCP Setup tab.
- **URL share auto-deploy** (`daemon/src/share/`) — envelope detection (framework / structural / refuse-to-guess) + allowlist bundler + pre-flight build + 30s smoke tail + per-SDK encoder registry (Supabase / Clerk / Stripe / Sentry / Auth0 / PostHog) + layout-aware overlay injection + Vercel Deployments API client + revoke contract. UI: Settings → **Share Preview** tab. `semver` added as a daemon dep for encoder version checks.
- **Live-share polish** — Resume after daemon restart (in-memory controller recreated on resume), optimistic spinner on pause/resume, custom expiry dropdown (1d / 1w / 1mo / 1y / custom), state broadcast across all panel clients (fixes cross-browser live-share visibility).
- **UI polish** — clickable LIVE badge opens share modal; image wheel-zoom with toolbar pill; home card menu clamps inside viewport.

Direction doc: [`docs/frank-v3-direction.md`](docs/frank-v3-direction.md).
URL share auto-deploy design doc: [`docs/url-share-auto-deploy-design.md`](docs/url-share-auto-deploy-design.md) (rev 4, post-calibration).

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

### URL Share Auto-Deploy
- URL shares are **NOT static snapshots** — Frank auto-deploys a real preview to the user's own Vercel account. Reviewer hits the preview URL and interacts with the running app.
- Flow: envelope check (§1 of design doc) → pre-flight build + 30s smoke tail (§2) → encoder registry generates safe-dummy env (§3) → overlay injection into root layout on a COPY of the source (§4) → Vercel Deployments API upload + poll (§6) → frank-cloud share record (§7) → revoke contract (§8).
- **Allowlist bundler is P0** (`daemon/src/share/bundler.ts`). Hardcoded positive list of what ships to Vercel: framework source dirs, `package.json`, one lockfile, `public/`, known configs, middleware/proxy/instrumentation, exactly `.env.share`. Everything else refused — including explicit user request to ship `.env.local`. Prevents secret leaks to public preview URLs.
- **Refuse-to-guess** (§1.4): if a detected SDK has no registry encoder and no `.env.share` coverage, Share is refused with an actionable message. No silent dummies.
- **User's working tree is never modified.** Overlay injection happens on a copy of the source in a working dir under `~/.frank/share-builds/<shareId>/`. Each Share click picks up a fresh copy; the user's repo stays untouched.
- **Overlay is bundled into each deployment**, not loaded cross-origin from frank-cloud. `frank-overlay.js` ships into the deployed app's `public/` (or `static/` for SvelteKit) — same-origin script that attaches a shadow-DOM pill and connects to frank-cloud via SSE for comments. If frank-cloud is offline, the overlay still renders and shows a "comments unavailable" banner.
- **Vercel token is account-scoped.** Vercel's PATs aren't permission-scoped; honest disclosure in the Settings UI and the design doc §6.1.
- **Revoke is two-step.** Cloud flag flips synchronously (share link 404s within ms), Vercel DELETE fires after. V1 does one sync attempt; retry queue is v1-hardening follow-up.
- **Calibration sweep memory (`project_frank_calibration_sweep`)** has paste-ready encoder outputs for every SDK that ships in v1. Don't reverse-engineer from tests — read the memo.

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
| AI | BYO — MCP server (stdio, `frank mcp`) for direct connection, clipboard "Copy as prompt" for one-off handoffs, JSON / MD / PDF export for whole-project handoffs. No in-app AI chat. |
| Content wrapping | iframe + transparent overlay + content proxy |
| Cloud sharing | Vercel serverless functions + Blob storage + Upstash Redis (self-hosted) |
| Project storage | JSON files in `~/.frank/projects/` |
| Comment anchoring | CSS selector + DOM path + visual coordinates (URL/PDF/image); shape ID + last-known world position (canvas) |
| Canvas export | Raster PNG (Konva) · Vector SVG (in-house Konva→SVG translator) · Vector PDF (jsPDF + svg2pdf.js) |
| Report export | Markdown (hand-written) · PDF (pdfmake w/ Roboto) |
| Bundle export | One zip (JSZip) with JSON + reports + snapshots + source + assets |
| URL share auto-deploy | `daemon/src/share/` — envelope + allowlist bundler + pre-flight build + per-SDK dummy-env encoders + overlay injection + Vercel Deployments API client. `semver` (^7.7.4) for encoder version checks. |

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
│   │   ├── viewer.js         # Content viewer — iframe + overlay + comment pins + popover + error card on proxy fail
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
│   │   ├── curation.js       # Feedback curation panel — inline edit, approve/dismiss toggles, pin-number color badge, focus-pulse, approved-gated "Copy for AI" (batch + per-row), Delete (batch)
│   │   ├── intent-button.js  # Amber "Add Intent" / green "Intent set" pill + modal (project brief textarea, ≤ 2000 chars)
│   │   ├── comments.js       # Comment input (used by overlay callback)
│   │   ├── share-popover.js  # Share link management (viewer + canvas) — optimistic pause/resume spinner, custom expiry dropdown
│   │   ├── ai-routing.js     # Clipboard AI routing (non-Claude fallback)
│   │   ├── url-input.js      # URL paste + file picker + drag-drop (PDF / image)
│   │   ├── help-panel.js     # Getting-started modal (5 feature cards, focus trap)
│   │   ├── settings-panel.js # Settings modal — top-level tabs: "Cloud Backend" (Vercel / custom, Deploy-to-Vercel CTA, configured-at hint) + "MCP Setup" (config snippet + per-client paths + security notes) + "Share Preview" (URL share auto-deploy diagnostics — path input, envelope check, preflight, Vercel token config, create + revoke). Takes `initialTopTab` param.
│   │   ├── share-envelope-panel.js  # Reusable display + interactive harness for the Share Preview tab. Renders envelope result, bundle summary, preflight verdict, share-create progress + revoke.
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
│       ├── share-envelope.css # Share Preview styling — verdict pills (green/yellow/red), failure list, SDK badges, route probe list, log pre
├── daemon/                   # Node.js daemon (TypeScript, strict)
│   ├── vitest.config.ts
│   ├── package.json          # deps: ws, pdfmake, tslib, jszip, @modelcontextprotocol/sdk, semver (URL share encoder version checks). @anthropic-ai/sdk is legacy dead code, slated for removal.
│   ├── src/cli.ts            # frank start / stop / connect / status / export / mcp / uninstall
│   ├── src/server.ts         # HTTP + WebSocket server, all message handlers (incl. set-project-intent, export-bundle, mcp-add-*, mcp-create-share, canvas-state-changed broadcast)
│   ├── src/protocol.ts       # Shared types and constants (incl. ProjectV2.intent, bundle + MCP message types)
│   ├── src/projects.ts       # Project CRUD + rename/archive/trash/restore/purge + createProjectFromFile + setProjectIntent
│   ├── src/assets.ts         # Content-addressed (sha256) asset storage per project
│   ├── src/proxy.ts          # Content proxy for iframe-restricted URLs
│   ├── src/cloud.ts          # Cloud client (share upload, comment fetch) + secret-aware config I/O
│   ├── src/snapshots.ts      # Canvas "Bookmark moment" + DOM snapshot storage (thumbnail PNG for canvas)
│   ├── src/curation.ts       # Curation log (approve, dismiss, remix, batch, reset)
│   ├── src/ai-chain.ts       # AI instruction chain logging
│   ├── src/export.ts         # Structured JSON export (includes intent)
│   ├── src/report.ts         # Project report — Markdown + PDF (pdfmake, Roboto); intent appears under "Project brief"
│   ├── src/bundle.ts         # Bundle-first Download (JSZip: project.json + reports + snapshots + source + assets)
│   ├── src/canvas-writes.ts  # Programmatic canvas writes — addShape/addText/addPath/addConnector used by MCP
│   ├── src/canvas.ts         # Canvas state I/O (one JSON blob per project)
│   ├── src/live-share.ts     # Live-share transport + per-project-type controllers (canvas/image/pdf)
│   ├── src/inject.ts         # CLAUDE.md injection/removal
│   ├── src/mcp/              # MCP server (stdio transport)
│   │   ├── server.ts         # runMcpServer() — @modelcontextprotocol/sdk StdioServerTransport
│   │   ├── bridge.ts         # DaemonBridge — WebSocket client bridging stdio tools ↔ running daemon
│   │   └── tools.ts          # 15 tool definitions + handlers (reads, canvas writes, create_share)
│   ├── src/ai-conversations.ts  # Per-project AI conversation storage (legacy, UI-unreachable, slated for removal)
│   ├── src/ai-providers/claude.ts  # Claude API client (legacy, UI-unreachable, slated for removal)
│   ├── src/share/            # URL share auto-deploy pipeline — v3.3+
│   │   ├── types.ts          # EnvelopeResult, BundleResult, DetectedSdk, failure codes
│   │   ├── envelope.ts       # Framework + structural rules + refuse-to-guess detection
│   │   ├── bundler.ts        # Allowlist file walker (.env.local always refused)
│   │   ├── env-share.ts      # Minimal dotenv parser for user-supplied overrides
│   │   ├── encoder-registry.ts  # Registry + generateEncoderEnv() merger
│   │   ├── sdk-encoders/     # supabase.ts, clerk.ts, stripe.ts, sentry.ts, auth0.ts, posthog.ts
│   │   ├── preflight.ts      # Build + ephemeral-port start + deterministic smoke + 30s stderr tail
│   │   ├── injection.ts      # Per-framework root-layout detection + one <script> injection on a COPY
│   │   ├── overlay-source.ts # OVERLAY_SCRIPT_CONTENT — frank-overlay.js as a TS string (shadow DOM, SSE)
│   │   ├── vercel-api.ts     # createDeployment / pollDeployment / deleteDeployment / verifyVercelToken
│   │   └── share-create.ts   # End-to-end orchestration (createShare) + revoke (revokeShare)
│   └── src/*.test.ts         # Vitest tests (310 across 27 files; 9 more in the opt-in cloud integration harness)
├── frank-cloud/              # Reference cloud backend — Vercel + Blob (users host their own)
│   ├── api/                  # Serverless functions (share, comment, health)
│   ├── public/viewer/        # Share viewer page (iframe OR canvas render via Konva CDN)
│   ├── vercel.json           # Routes, headers, security
│   └── README.md             # Deploy guide with security checklist
├── docs/
│   ├── frank-v3-direction.md
│   ├── url-share-auto-deploy-design.md  # URL share auto-deploy design (rev 4, post-calibration)
│   └── share-guards.md                  # FRANK_SHARE=1 guard patterns per SDK
├── CLAUDE.md
├── CLOUD_API.md              # Cloud API contract — required reading if porting to another host
├── PROGRESS.md
└── README.md
```

---

## Key Rules

- **URL-first or canvas-first**: the input is a URL, file (PDF/image), or a blank canvas — not a JSON schema
- **Daemon is sole file writer**: UI never touches the filesystem
- **All data local by default**: nothing leaves the machine unless user hits Share. Frank does not call any AI service itself; routing to AI is clipboard + export only.
- **Self-hosted cloud**: users deploy their own sharing backend (Vercel reference in `frank-cloud/` or any host implementing `CLOUD_API.md`)
- **Setup is required for sharing**: Share button warns until cloud is configured via Settings modal or `frank connect`
- **No build step**: `ui-v2/` must be servable as-is
- **Smart element detection**: clicks bubble up to meaningful elements, not raw DOM nodes
- **Triple-anchor comments** for DOM targets; **shape-anchor comments** for canvas shapes (pin follows on drag; orphaned pins survive at last-known position)
- **Vector exports**: PDF and SVG go through the Konva→SVG translator → svg2pdf for PDF. Raster is only for PNG. "A PDF needs to be vector."
- **Security first**: sensitive content detection before sharing, input validation, upload allowlists + size caps, secret-aware config writes (0600 for API keys)
- **No silent failures**: user-facing errors surface as a toast or an inline error card with a retry/action path
- **URL share never modifies the user's working tree**. Overlay injection happens on a COPY in `~/.frank/share-builds/<shareId>/`. Bundler is a hardcoded allowlist — no flag or config makes it ship `.env.local` or a private key.
- **Refuse-to-guess beats silent dummy**. If an SDK isn't in the encoder registry and the user hasn't supplied values in `.env.share`, Share refuses with a specific actionable message. Overclaiming is a trust failure.

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
| **Viewer** | Content in iframe (URL/proxy/PDF/image) + commenting overlay + curation sidebar. **Numbered colored pins** render on the overlay for each comment; click → same draggable Close/Edit/Delete popover used by canvas; feedback-row click → pin pulses. Empty-space clicks drop free pins. Proxy failures render an inline **error card with Retry**. |
| **Canvas** | Konva-backed sketching: select, rectangle, circle, ellipse, triangle, diamond, hexagon, star, cloud, speech, document, cylinder, parallelogram, arrow, elbow, pen, text, sticky. Pan (space+drag), zoom (wheel). **Intent pill** (amber/green), **shape- and pin-anchored comments** (SVG icon, speech-bubble-plus cursor), **Bookmark moment** (camera icon — captures canvas state + thumbnail to the timeline), **Share** (link icon, live-share toggle, clickable LIVE·N badge), **Download** (bundle zip), **Export dropdown** (PNG / SVG / PDF / JSON), **undo** (button + Cmd+Z), **timeline** (shared event with viewer), **Cmd+C / Cmd+V / Cmd+D** copy/paste/duplicate shapes, **V/R/T/P/N/A/Esc** tool shortcuts, **drag-and-drop images** → content-addressed asset. State persists to `~/.frank/projects/{id}/canvas-state.json`. |
| **Timeline** | Chronological view of comments + bookmarks + curations + AI instructions. Canvas bookmarks show a Canvas badge + inline thumbnail. **Show folder** (reveal in Finder/Explorer) + unified **Export** dropdown (JSON / Markdown / PDF). Close (X) returns to canvas or viewer depending on the project. |

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
has URL proxy / multi-page tracking) are intentional — they reflect
different tools, not visual drift.

## AI routing (BYO tool — no in-app chat)

Frank does not bundle an in-app AI chat. That would lock users into one provider and force API-key management inside Frank. Instead, three handoff paths route feedback to whatever AI tool the user already uses:

- **MCP server — `daemon/src/mcp/`**: AI connects directly to Frank. The user adds a config snippet (Settings → MCP Setup) that spawns `frank mcp` as a subprocess; stdio-to-WebSocket bridge (`bridge.ts`) forwards tool calls to the running daemon. 15 tools: reads (list_projects, load_project, get_intent, get_comments, get_canvas_state, list_snapshots, get_timeline, export_bundle), canvas writes (add_shape, add_text, add_path, add_connector, insert_template placeholder, add_comment), create_share. Canvas writes broadcast `canvas-state-changed` so open browser tabs re-render live. **Intentionally user-driven (not exposed as MCP tools)**: revoke share, live-share start/resume/pause, delete project, curation actions. These are humans' calls.
- **Clipboard — `ai-routing.js`**: the "Copy as prompt" button on approved comments puts a structured prompt on the clipboard (including the project's intent if set). User pastes into Claude, Cursor, ChatGPT, a local LLM, whatever.
- **Export — `daemon/src/export.ts` (JSON) + `daemon/src/report.ts` (MD/PDF) + `daemon/src/bundle.ts` (zip)**: hand off the entire project at once. Every comment, curation, bookmark, and timeline entry is captured. Bundle adds snapshots + source + assets for full-context handoff.

The `daemon/src/ai-chain.ts` log captures every Copy-as-prompt action so the export includes a decision trail of what was routed to which AI.

**MCP projectId discipline:** `activeProjectId` on the daemon is tied to the browser's current view. MCP tools always pass an explicit `projectId` (derived from tool input) so an AI writing to project B never clobbers what the user is looking at in project A.

Historical note: an earlier v2 version had an in-app Claude panel mounted in the viewer's right sidebar. It was removed pre-v3.0 in favor of the BYO-tool pattern above. The daemon-side `ai-conversations.ts` + `ai-providers/claude.ts` modules still exist but are unreachable from the UI — their removal is a v3.x cleanup item, not urgent.

---

## Data shape

### Project lifecycle flags + metadata (`ProjectV2`)
- `archived?: string` — ISO timestamp when archived. Absence = active.
- `trashed?: string` — ISO timestamp when soft-deleted. Auto-purged after 30 days at daemon startup (`purgeExpiredTrash`).
- `intent?: string` — free-text project brief, ≤ 2000 chars (trimmed; empty deletes the field). Managed by `setProjectIntent()`. Renders as amber "Add Intent" / green "Intent set" pill in viewer + canvas toolbars; prepended to Copy-for-AI prompts; included in JSON / MD / PDF exports under "Project brief".

### Comment anchor variants
- `type: 'element'` — DOM target (viewer). Carries `cssSelector`, `domPath`, visual coords **as percentages of the iframe viewport** (not pixels).
- `type: 'pin'` — Free-floating pin. On viewer, coords are percentages + optional `pageNumber` (PDF). On canvas, coords are absolute world coords.
- `type: 'shape'` — Canvas shape target. Carries `shapeId`, world coords, and `shapeLastKnown: { x, y }` that updates on every `dragmove` so deleted-shape pins survive at their final position.

### Curation actions
- `approve` / `dismiss` / `remix` / `batch` — apply a status.
- `reset` (added v2.04) — sets status back to `pending`. Used by the toggle-style buttons in the feedback panel so clicking the active status undoes it.

### Snapshot variants
- DOM snapshot: `snapshot.html` + optional screenshot. Used by URL/PDF/image projects.
- Canvas "Bookmark moment" (`canvasState: true` marker on meta): writes `canvas-state.json` (serialized Konva) + optional `thumbnail.png` (0.5× stage PNG) inside the snapshot dir. User-facing terminology is "Bookmark moment" to distinguish capture-a-point-in-time from the Download bundle; the on-disk layout is unchanged from the v2 "snapshot" concept.

### Download bundle
- Built by `daemon/src/bundle.ts` via JSZip. Contains: `project.json` (structured export), `report.md` + `report.pdf`, `canvas-state.json` (canvas projects), `snapshots/` (every bookmark moment), `source/` (uploaded PDF / image sources), `assets/` (content-addressed canvas image drops + comment attachments).

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

The daemon has a Vitest test suite (**310 passing across 27 files**, plus an opt-in cloud integration harness with 9 more tests). Unit tests use temp directories — never touch real `~/.frank/`.

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

**Covered modules:** `projects.ts`, `assets.ts`, `snapshots.ts`, `curation.ts`, `ai-chain.ts`, `export.ts`, `report.ts`, `proxy.ts`, `cloud.ts`, `inject.ts`, `canvas.ts`, `ai-conversations.ts`, `revision-store.ts`, `live-share.ts` (transport + per-project-type controllers for canvas/image/pdf), `share/envelope.ts`, `share/bundler.ts`, `share/preflight.ts` (pure helpers — link extraction, error counting, classification, port finder, start-command selection), `share/encoder-registry.ts` (all six SDK encoder outputs), `share/injection.ts` (layout detection per framework + injection idempotence + copy-doesn't-touch-source), `share/vercel-api.ts` (mocked-fetch unit tests — create / poll / delete / verify-token).

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

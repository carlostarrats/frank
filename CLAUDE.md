# Frank — Claude Code Context

## What This Is
A collaboration layer for any web content. Point it at any URL — localhost, staging, production — or drop a PDF, image, or canvas, and Frank wraps it with commenting, sharing, feedback curation, AI routing, and a complete data trail of how the thing was built.

PolyForm Shield 1.0.0 license (source-available; prohibits competing products — see `LICENSE` + `THIRD-PARTY-LICENSES.md`). Mac-first. Browser-based (no native app).

Current branch: `dev-v2.03`.

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
- Sharing uses a **self-hosted Vercel project** (`frank-cloud/`) that the user deploys to their own Vercel account.
- Frank never sends data to our servers. Users own their cloud infrastructure.
- Cloud is optional — everything except sharing works offline.
- For canvas sharing, the daemon bundles the canvas state + every referenced asset as inline data URLs into the share payload, so the cloud viewer can render without round-tripping back to the daemon.

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
│   │   ├── home.js           # Project list — create, rename, archive, trash, search/sort/filter, Help button
│   │   ├── viewer.js         # Content viewer — iframe + overlay + comments + AI panel + error card on proxy fail
│   │   ├── canvas.js         # Konva canvas view — tools, comments, snapshots, share, export, shortcuts, undo/redo
│   │   └── timeline.js       # Chronological view + Report (MD/PDF) export
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
│   │   ├── shortcuts.js      # V/R/T/P/N/A, Esc, Cmd+Z/Shift+Z, Cmd+D
│   │   ├── history.js        # In-memory undo/redo ring buffer
│   │   ├── svg-export.js     # Konva content layer → standalone SVG string
│   │   └── export.js         # PNG/SVG/PDF/JSON download helpers (PDF routes SVG→svg2pdf)
│   ├── overlay/
│   │   ├── overlay.js        # Click handling, comment mode toggle
│   │   ├── element-detect.js # Smart element detection (bubble to meaningful)
│   │   ├── anchoring.js      # Triple-anchor: CSS selector + DOM path + coords
│   │   ├── highlight.js      # Element highlight rendering
│   │   └── snapshot.js       # DOM snapshot capture for sharing
│   ├── components/
│   │   ├── toolbar.js        # Top toolbar (viewer)
│   │   ├── curation.js       # Feedback curation panel (approve/dismiss/remix/batch)
│   │   ├── comments.js       # Comment input (used by overlay callback)
│   │   ├── share-popover.js  # Share link management (viewer + canvas)
│   │   ├── ai-routing.js     # Clipboard AI routing (non-Claude fallback)
│   │   ├── ai-panel.js       # In-app Claude conversation, streaming
│   │   ├── url-input.js      # URL paste + file picker + drag-drop (PDF / image)
│   │   ├── help-panel.js     # Getting-started modal (5 feature cards, focus trap)
│   │   ├── toast.js          # info/warn/error notifications (top-right, stackable)
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
│   └── src/*.test.ts         # Vitest tests (132 across 12 files)
├── frank-cloud/              # Self-hosted Vercel project for sharing
│   ├── api/                  # Serverless functions (share, comment, health)
│   ├── public/viewer/        # Share viewer page (iframe OR canvas render via Konva CDN)
│   ├── vercel.json           # Routes, headers, security
│   └── README.md             # Deploy guide with security checklist
├── CLAUDE.md
├── PROGRESS.md
└── README.md
```

---

## Key Rules

- **URL-first or canvas-first**: the input is a URL, file (PDF/image), or a blank canvas — not a JSON schema
- **Daemon is sole file writer**: UI never touches the filesystem
- **All data local by default**: nothing leaves the machine unless user hits Share (or uses the AI panel, which calls Claude directly with the user's own key)
- **Self-hosted cloud**: users deploy their own sharing backend
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
| **Home** | Project list + URL/file entry. Toolbar with **search / sort / type-filter chips**. Cards support **inline rename (F2), archive, soft-delete (30-day trash), restore, permanent delete**. Keyboard: ↑/↓ between cards, Enter to open, Delete to trash, F2 to rename. Persistent **Help** button opens a 5-card Getting Started modal. |
| **Viewer** | Content in iframe (URL/proxy/PDF/image) + commenting overlay + curation sidebar + AI panel sidebar. Proxy failures render an inline **error card with Retry**. |
| **Canvas** | Konva-backed sketching: select, rectangle, circle, ellipse, triangle, diamond, hexagon, star, cloud, speech, document, cylinder, parallelogram, arrow, elbow, pen, text, sticky. Pan (space+drag), zoom (wheel). **Shape-anchored comments** (toggle 💬), **snapshots** (◉, thumbnail saved), **share** (↗, bundled assets), **export dropdown** (PNG / SVG / PDF / JSON), **undo/redo**, **Cmd+D duplicate**, **V/R/T/P/N/A/Esc** tool shortcuts, **drag-and-drop images** → content-addressed asset. State persists to `~/.frank/projects/{id}/canvas-state.json`. |
| **Timeline** | Chronological view of comments + snapshots + curations + AI instructions. Canvas snapshots show a Canvas badge + inline thumbnail. Three export buttons: JSON / Report (MD) / Report (PDF). |

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
- `type: 'element'` — DOM target (viewer). Carries `cssSelector`, `domPath`, visual coords.
- `type: 'pin'` — Free-floating pin (viewer). Carries coords + optional `pageNumber` (PDF).
- `type: 'shape'` — Canvas shape target. Carries `shapeId`, world coords, and `shapeLastKnown: { x, y }` that updates on every `dragmove` so deleted-shape pins survive at their final position.

### Snapshot variants
- DOM snapshot: `snapshot.html` + optional screenshot. Used by URL/PDF/image projects.
- Canvas snapshot (`canvasState: true` marker on meta): writes `canvas-state.json` (serialized Konva) + optional `thumbnail.png` (0.5× stage PNG) inside the snapshot dir.

### Share payload (canvas)
`{ canvasState: string, assets: Record<url, dataUrl>, preview: string }` — fully self-contained; cloud viewer needs nothing but Konva from CDN to render.

---

## Error surfaces

Every failure path in v2.02 uses one of two components:
- `toast.js` — transient: info auto-dismisses 4s, warn 6s, error persists until dismissed. Actions supported (e.g. "Retry now").
- `error-card.js` — inline: replaces failed content (viewer proxy failure, future upload-heavy surfaces).

Wired: viewer proxy failure (error card), canvas save double-failure (toast + retry), canvas export failure (toast), project-creation failure (toast), WebSocket disconnect (persistent error toast) + reconnect (info toast).

---

## Testing

The daemon has a Vitest test suite (**132 tests across 12 files**). Tests use temp directories — never touch real `~/.frank/`.

```bash
cd daemon
npm test           # run all tests once
npm run test:watch # watch mode
```

Test files live alongside source: `src/*.test.ts`. Each test file mocks `./protocol.js` to redirect `PROJECTS_DIR` to a temp directory. The `inject.test.ts` file additionally mocks `os.homedir()` using `vi.hoisted()`.

**Covered modules:** `projects.ts`, `assets.ts`, `snapshots.ts`, `curation.ts`, `ai-chain.ts`, `export.ts`, `report.ts`, `proxy.ts`, `cloud.ts`, `inject.ts`, `canvas.ts`, `ai-conversations.ts`.

After changing any daemon module, run `npm test` to verify nothing broke.

---

## After changing UI code

After any change to files in `ui-v2/`:
1. Just refresh the browser at `localhost:42068` — no build step needed.

After any change to files in `daemon/src/`:
1. `cd daemon && npm run build`
2. Run `npm test` to verify tests pass
3. Restart the daemon: kill the existing process, run `frank start`. Node does not hot-reload; a running daemon executes what it loaded at startup, not the rebuilt `dist/`.

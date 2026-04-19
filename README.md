# Frank

> A persistent context layer for AI-assisted development. Start from a URL, drop a PDF or image, or open a blank canvas. Comment on any element or shape, share for feedback, iterate with Claude in-app — every decision captured along the way.

**v2.02** — Builds on the v2 release: file drop on the home view, drag-and-drop images onto the canvas, shape-anchored comments that follow shapes on drag, canvas snapshots with inline thumbnails, canvas sharing through your own Frank Cloud, vector PDF/SVG export, project reports, undo/redo, tool shortcuts, non-canvas keyboard accessibility, and a project-management surface (rename, archive, soft-delete, search/sort/filter).

**Frank is a terminal tool.** You start it from the command line, and it opens a browser-based UI at `localhost:42068`. Requires [Node.js](https://nodejs.org/) (v18+).


<img width="1312" height="1061" alt="Screenshot 2026-03-31 at 11 40 53 PM" src="https://github.com/user-attachments/assets/7b0a5030-cb9d-47fe-aec7-e1ba6ffb2d1e" />

---

## What it does

Frank wraps what you're building with a commenting overlay, a Claude conversation that sees your project context, and a complete data trail of how the thing was made. Four entry points lead into the same loop:

1. **Start from a URL** — localhost, Vercel preview, production. Click any element to anchor a comment. Share for external review.
2. **Drop a PDF** — drag into the home view, it opens in the viewer, comment on anchored coordinates.
3. **Drop an image** — same flow, rendered in the image viewer.
4. **Start from a canvas** — an infinite Konva canvas with shapes, text, freehand, arrows, connectors, templates (Kanban / Mindmap / Flowchart / Calendar), and drag-drop image placement.

From any entry point:

```
Entry (URL / PDF / image / canvas)
       |
Comment on specific elements or shapes (click to anchor)
       |
Curate feedback (approve / dismiss / remix)
       |
Ask Claude in-app — or copy a structured prompt to any other AI
       |
Iterate, snapshot, undo/redo, repeat
       |
Share for external review (optional, self-hosted) — canvas sharing
bundles all referenced image assets into the share payload
       |
Export when done: PNG / SVG / PDF (vector) / JSON for canvas,
Markdown / PDF project reports from the timeline
```

Everything is captured: every comment, every AI conversation, every snapshot, every decision. Every byte lives in `~/.frank/` unless you explicitly hit Share.

---

## Features

### Core loop (URL / PDF / image)
- **Wrap any URL** — localhost dev server, Vercel preview, production site
- **Drop a file** — PDF or image (PNG, JPG, GIF, WEBP, SVG) up to 50MB; creates a project of the matching type
- **Element-level commenting** — click any element; triple-anchor (CSS selector + DOM path + visual coordinates) survives refactors
- **Smart element detection** — clicks bubble up to the nearest meaningful element (card, button, heading — not the tiny span your cursor landed on)
- **Content proxy** — automatically proxies sites that block iframe embedding; inline error card with **Retry** if the proxy can't reach the target
- **Multi-page tracking** — detects navigation within the iframe, prompts to add new screens
- **Feedback curation** — approve, dismiss, or remix each comment; batch operations; route to AI

### Canvas
- **Konva-based infinite canvas** — plain JS, no build step, loaded via `<script>` tag
- **Shape library** — rectangle, circle, ellipse, triangle, diamond, hexagon, star, cloud, speech bubble, document, cylinder, parallelogram, plus text, sticky, pen, arrow, elbow connector
- **Templates** — one-click Kanban / Mindmap / Flowchart / Calendar inserts; groups preserve selection/move as a unit, Cmd+G / Cmd+Shift+G to group/ungroup
- **Follow-shape connectors** — arrows and elbows glue to source/target shapes and stay attached as you drag
- **Drag-and-drop images** — drop PNGs/JPGs onto the canvas; bytes upload to a content-addressed (sha256) asset store; Konva.Image nodes rehydrate on page reload
- **Shape-anchored comments** — click the 💬 toolbar button, click any shape to anchor a comment; pins follow on drag; deleted-shape pins stay at last-known position with a muted dashed style so the comment survives
- **Snapshots** — ◉ captures serialized canvas state + a 0.5× thumbnail; snapshots surface in the timeline with inline thumbnails
- **Share** — ↗ opens the share popover; canvas shares bundle every referenced asset as inline data URLs, so the cloud viewer renders without daemon round-trips
- **Undo / redo** — in-memory ring buffer, 50 entries; Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z
- **Duplicate** — Cmd/Ctrl+D duplicates selection with +20/+20 offset and a fresh ID
- **Tool shortcuts** — V select, R rectangle, T text, P pen, N sticky, A arrow, Esc back to select + clear comment mode
- **Export** — dropdown with PNG (raster, 2×), SVG (vector), PDF (vector via svg2pdf.js), JSON (serialized Konva state). An 8-shape scene that used to export as a 10MB bitmap-in-PDF is now a 6KB vector PDF.
- **Pan and zoom** — spacebar + drag to pan, wheel to zoom relative to pointer
- **Properties inspector** — fill, stroke, opacity, font size, alignment (L/C/R, T/M/B) when multiple shapes selected
- **Persistent** — canvas state saved to `~/.frank/projects/{id}/canvas-state.json` per project

### In-app AI panel
- **Claude conversations** — docked sidebar in the viewer, streaming responses via `@anthropic-ai/sdk`
- **Project context baked in** — every turn includes your curated comments, recent snapshot metadata, and (for canvas projects) the canvas state, within an explicit token budget
- **Persistent across sessions** — conversations stored per project with size-aware caps and automatic continuation linking
- **Clipboard fallback** — "Copy as prompt" on any message, so non-Claude AIs still work

### Collaboration
- **Self-hosted sharing** — deploy Frank Cloud to your own Vercel account; shared snapshots live in your Blob storage
- **Canvas sharing** — same flow; payload includes serialized canvas state + inlined asset data URLs; cloud viewer lazy-loads Konva from CDN and renders on page load
- **Reviewer experience** — reviewers open the link, see the page or canvas, comment with guided prompts
- **Structured export** — one-click JSON export of the entire project for AI review
- **Project reports** — Markdown or PDF (via pdfmake) reports from the timeline: summary counts, comments, decisions, snapshots, AI instructions, conversations

### Project management (home view)
- **Search** across names (debounced, real-time)
- **Sort** by Most recent / Oldest / A–Z / By type
- **Filter chips** All / Canvas / URL / PDF / Image
- **Inline rename** — click the name to edit in place (Enter commits, Esc cancels); F2 from a focused card
- **Archive + unarchive** — collapsed section below the recent list
- **Soft delete** — deleted projects go to Trash for 30 days before auto-purge; restore or delete permanently
- **Keyboard navigation** — Tab to reach cards; ↑/↓ to move between them; Enter to open; F2 to rename; Delete to trash

### Onboarding + Help
- **Persistent Help button** in the home header — not a one-shot first-run tour; discoverable whenever users want to explore a feature they haven't tried
- **Getting Started modal** — five cards (Review URL / Sketch Canvas / Comments / Route to AI / Share) with one-sentence blurbs; two CTAs launch the real flow, three expand inline "Learn more" detail
- **Keyboard-friendly** — focus trap inside the modal, Esc closes, focus restored to the opening button

### Error handling
- **Toasts** — top-right stack; info/warn auto-dismiss, errors persist until dismissed; can carry an action button
- **Error cards** — inline replacement for failed surfaces (proxy unreachable, etc.); title + message + suggestion + retry
- **Connection awareness** — if the daemon drops, a persistent "Lost connection…" error toast appears; when it comes back, an info toast confirms reconnection

---

## Architecture

Two packages. One local, one cloud.

```
LOCAL (your machine)                         CLOUD (your Vercel account, optional)
+---------------------------+                +---------------------------+
| Frank Daemon (Node.js)    |  -- HTTPS -->  | Frank Cloud (Vercel)      |
| - HTTP server (42068)     |                | - POST /api/share         |
| - WebSocket (42069)       |  <-- poll --   | - POST /api/comment       |
| - Content proxy           |                | - GET  /api/share/:id     |
| - Asset storage (sha256)  |                | - Share viewer page       |
| - Canvas state I/O        |                |   (URL, PDF, image, OR    |
| - Snapshot + thumbnail    |                |    canvas via Konva CDN)  |
| - AI conversation store   |                | - Vercel Blob storage     |
| - Report builder (MD/PDF) |                +---------------------------+
| - Claude API client       |     ----->     Claude API (api.anthropic.com)
| - Project I/O (~/.frank/) |                 (your key, your call)
+---------------------------+
        |
        v
  Browser UI (localhost:42068)
  - Home (URL / file / canvas entry, search/sort/filter, help modal)
  - Viewer (iframe wrapper + overlay + curation + AI panel)
  - Canvas (Konva + tools + comments + snapshots + share + export + undo)
  - Timeline (comments, snapshots, AI instructions, MD/PDF report)
```

Everything lives locally in `~/.frank/` unless you explicitly hit Share or connect an AI provider. The cloud is optional; AI is optional; sharing is optional.

### Tech stack

| Layer | Technology |
|---|---|
| Browser UI | Plain JS ES modules — no framework, no build step |
| Canvas | [Konva](https://konvajs.org/) 9 (MIT), loaded via `<script>` tag |
| Daemon | Node.js + TypeScript — HTTP + WebSocket server |
| AI | [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript), streaming via `messages.stream()` |
| Cloud sharing | Vercel serverless functions + Blob storage (self-hosted) |
| Canvas export | Konva→SVG translator → [svg2pdf.js](https://github.com/yWorks/svg2pdf.js) for vector PDF (both loaded from CDN on first use) |
| Report export | [pdfmake](http://pdfmake.org/) — vector PDF with Roboto, daemon-side |
| Storage | JSON files in `~/.frank/projects/` + content-addressed assets + `~/.frank/config.json` (0600) |
| Comment anchoring | CSS selector + DOM path + visual coordinates (DOM) · shape ID + last-known world position (canvas) |

---

## Prerequisites

Frank requires **[Node.js](https://nodejs.org/) v18 or later**. If you don't have it:

```bash
# Check if you have Node.js
node --version

# If not installed, get it from https://nodejs.org
# or via Homebrew on macOS:
brew install node
```

## Install

```bash
git clone https://github.com/carlostarrats/frank
cd frank/daemon
npm install
npm run build
npm install -g .
```

After install, the `frank` command is available globally in your terminal.

---

## Usage

Open your terminal and run:

```bash
frank start       # start daemon, open browser at localhost:42068
frank stop        # stop daemon, remove Claude Code hooks
frank status      # show daemon and cloud connection status
frank connect     # connect to your self-hosted Frank Cloud
frank export      # export a project as structured JSON
frank uninstall   # remove all Frank data (with confirmation)
```

`frank start` launches the daemon and opens `http://localhost:42068` in your default browser. From the home screen:

- **Paste a URL** to wrap any running site with Frank's commenting overlay.
- **Drop a file** (or click "Browse files…") to import a PDF or image as a project.
- **+ New canvas** for a blank Konva canvas to sketch on.

Hit the **Help** button in the top-right any time you want a quick tour.

When you're done, hit `Ctrl+C` in the terminal or run `frank stop`.

### Using Claude in the app

Frank's AI panel talks to Claude directly — no copy-paste required, and the conversation has your project context built in.

1. Open any project in the viewer and click the **AI** button in the toolbar.
2. The first time, click the gear icon and paste your Claude API key. Get one at <https://console.anthropic.com/>.
3. The key is written to `~/.frank/config.json` with `0600` permissions (owner read/write only). The daemon never logs it.

Every conversation is stored per-project at `~/.frank/projects/{id}/ai-conversations/`. The panel includes your curated comments, recent snapshot metadata, and (for canvas projects) the canvas state as context on every turn, within an explicit token budget so you never blow past Claude's context window.

Prefer a different AI? Every user message has a **Copy** button that exports it as a structured prompt you can paste into any other assistant. The old clipboard-routing flow on curated comments still works for the same reason.

### Connect to cloud (for sharing)

Sharing is self-hosted — you deploy Frank Cloud to your own Vercel account, so shared snapshots live in your Blob storage, not someone else's.

1. Deploy Frank Cloud to your Vercel account (see `frank-cloud/README.md`)
2. Connect locally:

```bash
frank connect https://your-frank-cloud.vercel.app --key YOUR_API_KEY
```

Now the Share button in the viewer (and the ↗ button on the canvas) generates real internet links.

### Canvas keyboard shortcuts

| Shortcut | Action |
|---|---|
| `V` | Select tool |
| `R` | Rectangle |
| `T` | Text |
| `P` | Pen (freehand) |
| `N` | Sticky note |
| `A` | Arrow |
| `Space` + drag | Pan |
| Wheel | Zoom (relative to pointer) |
| `Esc` | Back to Select, clear comment mode |
| `Delete` / `Backspace` | Delete selection |
| `Cmd/Ctrl` + `G` | Group selection |
| `Cmd/Ctrl` + `Shift` + `G` | Ungroup |
| `Cmd/Ctrl` + `D` | Duplicate selection |
| `Cmd/Ctrl` + `Z` | Undo |
| `Cmd/Ctrl` + `Shift` + `Z` | Redo |

### Home keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Tab` | Move focus (search → sort → chips → cards → Help) |
| `↑` / `↓` | Move between project cards |
| `Enter` | Open the focused project |
| `F2` | Rename the focused project in place |
| `Delete` / `Backspace` | Move the focused project to Trash (or permanently delete from Trash) |
| `Esc` | Close the Help modal |

---

## Privacy

- **Local by default** — all project data, canvas state, uploaded files, image assets, and AI conversations stay in `~/.frank/` on your machine
- **API keys stay local** — Claude key stored at `~/.frank/config.json` with `0600` permissions; the daemon never logs it
- **AI calls are your calls** — Frank connects to the Claude API using your key; Anthropic's privacy terms apply; nothing routes through Frank's infrastructure (there isn't any)
- **No telemetry, no analytics, no accounts**
- **Sharing is opt-in** — when you share, a snapshot is uploaded to YOUR Vercel Blob storage
- **Canvas share bundling** — canvas shares inline every referenced image asset as a data URL inside the share payload; nothing else is uploaded beyond what's visible on the canvas
- **Self-hosted cloud** — you deploy and own the sharing infrastructure
- **Sensitive content detection** — Frank warns before sharing if it detects emails, API keys, or passwords in the page

---

## Development

The frontend has no build step — plain JS files served directly by the daemon. Konva loads via `<script>` tag from unpkg; no bundler. jsPDF and svg2pdf.js are loaded on demand from CDN when the user actually exports.

```bash
frank start
# UI is at http://localhost:42068 — edit ui-v2/ files, refresh browser

# Rebuild daemon after TypeScript changes
cd daemon && npm run build
# Then restart the daemon — Node does not hot-reload.
```

### Testing

The daemon has a Vitest test suite (**132 tests across 12 files**). Tests use temp directories — they never touch real `~/.frank/`.

```bash
cd daemon
npm test           # run all tests once
npm run test:watch # run in watch mode
```

Covered modules: projects, assets, snapshots, curation, ai-chain, export, report, proxy, cloud, inject, canvas, ai-conversations.

### Project structure

```
frank/
+-- ui-v2/                    # Browser UI (plain JS, no build step)
|   +-- index.html            # Entry point; links Konva via script tag
|   +-- app.js                # App shell, view router, toast on failure
|   +-- core/                 # WebSocket client (with reconnect toasts), in-memory project state
|   +-- views/                # Home, viewer, canvas, timeline
|   +-- overlay/              # Element detection, anchoring, highlighting, DOM snapshots
|   +-- canvas/               # Stage, tools, transformer, serialize, shapes, paths, connectors,
|   |                         #   anchors, templates, properties, comments (pins), image (drop),
|   |                         #   shortcuts, history (undo/redo), svg-export, export (PNG/SVG/PDF/JSON)
|   +-- components/           # toolbar, curation, comments, share-popover, ai-routing, ai-panel,
|   |                         #   url-input (paste/drop/pick), help-panel, toast, error-card
|   +-- styles/               # tokens, ui, app, overlay, comments, curation, canvas, timeline, ai-panel
+-- daemon/                   # Node.js daemon (TypeScript)
|   +-- src/cli.ts            # CLI commands: start/stop/status/connect/export/uninstall
|   +-- src/server.ts         # HTTP + WebSocket server, all message handlers
|   +-- src/protocol.ts       # Shared types, constants, port assignments
|   +-- src/projects.ts       # Project CRUD + lifecycle (rename/archive/trash/restore/purge)
|   +-- src/assets.ts         # Content-addressed asset storage (sha256)
|   +-- src/snapshots.ts      # DOM + canvas snapshot storage (with thumbnail)
|   +-- src/curation.ts       # Curation log
|   +-- src/canvas.ts         # Canvas state I/O
|   +-- src/ai-conversations.ts     # Per-project AI conversation storage with caps
|   +-- src/ai-providers/claude.ts  # Claude API client + context builder
|   +-- src/ai-chain.ts       # AI instruction chain log
|   +-- src/proxy.ts          # Content proxy for iframe-restricted URLs
|   +-- src/cloud.ts          # Self-hosted cloud client + secret-aware config I/O
|   +-- src/export.ts         # Structured JSON export
|   +-- src/report.ts         # Project report (Markdown + PDF via pdfmake)
|   +-- src/inject.ts         # CLAUDE.md injection/removal
+-- frank-cloud/              # Deployable Vercel project (self-hosted sharing)
|   +-- api/                  # Serverless functions (share, comment, health)
|   +-- public/viewer/        # Share viewer — URL/PDF/image iframe OR canvas via Konva CDN
|   +-- README.md             # Deploy guide with security checklist
+-- CLAUDE.md
+-- README.md
```

---

## License

[MIT](LICENSE) — free to use, modify, and distribute, including commercially. Include the copyright notice in any substantial redistribution.

Prior versions of Frank (through the v1.0 release) were licensed under PolyForm Shield 1.0.0. The project relicensed to MIT ahead of the v2 development cycle.

### Acknowledgements

Frank bundles or depends on:

- [Konva](https://konvajs.org/) — MIT
- [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) — MIT
- [ws](https://github.com/websockets/ws) — MIT
- [pdfmake](http://pdfmake.org/) — MIT (daemon-side report PDF)
- [jsPDF](https://github.com/parallax/jsPDF) — MIT (canvas PDF, loaded on demand from CDN)
- [svg2pdf.js](https://github.com/yWorks/svg2pdf.js) — MIT (canvas PDF, loaded on demand from CDN)
- [Vitest](https://vitest.dev/) — MIT
- [@vercel/blob](https://github.com/vercel/storage) — Apache-2.0 (Frank Cloud only)

Include their licenses wherever you redistribute Frank.

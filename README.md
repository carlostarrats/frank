# Frank

> Runs on your machine. Point Frank at a URL, drop in a file, or start a canvas — then comment, curate, and route feedback to AI. Every decision captured. Nothing leaves your computer unless you share.

Frank is a local-first collaboration layer for things that aren't on the internet yet. It wraps whatever you're building — a localhost dev server, a staging URL, a PDF, an image, or a blank canvas — with a commenting overlay, feedback curation, and structured handoff to the AI tools you already use.

Most review tools assume the thing being reviewed is already deployed somewhere. Frank assumes it's still private, still evolving, still on your machine.

<img width="1312" height="1061" alt="Frank home view" src="https://github.com/user-attachments/assets/7b0a5030-cb9d-47fe-aec7-e1ba6ffb2d1e" />

**Frank is a terminal tool.** You start it from the command line and it opens a browser-based UI at `localhost:42068`. Requires [Node.js](https://nodejs.org/) (v18+).

---

## What it does

Four entry points, one loop:

1. **Wrap any URL** — localhost, Vercel preview, production. Click any element to anchor a comment.
2. **Drop a PDF** — drag into the home view; Frank opens it in the viewer and anchors comments to coordinates.
3. **Drop an image** — same flow (PNG, JPG, GIF, WEBP, SVG up to 50MB).
4. **Start on a blank canvas** — an infinite Konva canvas with shapes, text, freehand, connectors, templates, and drag-drop image placement.

From any entry point:

```
Entry (URL / PDF / image / canvas)
       |
Add a project brief (optional) — tells AI what you're trying to build
       |
Comment on elements or shapes (click to anchor)
       |
Curate feedback — approve, dismiss, or remix each one
       |
Route to AI — Copy as prompt / JSON or MD/PDF export / MCP server
       |
Bookmark moments, undo, iterate, repeat
       |
Share for external review (optional, self-hosted):
  - URL / PDF / image: async link, reviewer comments sync back
  - Canvas: async OR live — every shape edit streams to viewers
       |
Download the whole project as a zip when you're done
```

Every comment, every curation decision, every bookmark, every AI handoff is captured in `~/.frank/`. Nothing leaves your machine unless you explicitly share.

---

## Features

### Core loop (URL / PDF / image)
- **Wrap any URL** — localhost dev server, Vercel preview, production site
- **Drop a file** — PDF or image (PNG, JPG, GIF, WEBP, SVG) up to 50MB; creates a project of the matching type
- **Element-level commenting** — click any element; triple-anchor (CSS selector + DOM path + visual coordinates) survives refactors
- **Smart element detection** — clicks bubble up to the nearest meaningful element
- **Content proxy** — automatically proxies sites that block iframe embedding; inline error card with **Retry** on failure
- **Multi-page tracking** — detects navigation inside the iframe, prompts to add new screens
- **Image wheel-zoom** — scroll to zoom images just like on canvas

### Canvas
- **Infinite canvas** — Konva-backed, plain JS, no build step
- **Shape library** — rectangle, circle, ellipse, triangle, diamond, hexagon, star, cloud, speech, document, cylinder, parallelogram, plus text, sticky, pen, arrow, elbow connector
- **Templates** — one-click Kanban / Mindmap / Flowchart / Calendar; groups with Cmd+G / Cmd+Shift+G
- **Follow-shape connectors** — arrows and elbows stay attached to source/target shapes as you drag
- **Drag-and-drop images** — drop PNG/JPG/etc. directly on the canvas; uploaded to a content-addressed asset store
- **Shape-anchored comments** — pins follow on drag; deleted-shape pins survive at their last-known position
- **Bookmark moments** — capture serialized canvas state + 0.5× thumbnail to the timeline
- **Undo / redo** — 50-entry ring buffer, Cmd+Z / Cmd+Shift+Z
- **Vector export** — PNG (2×), SVG, PDF (vector via svg2pdf), JSON (serialized Konva)

### Feedback curation
- **Approve / dismiss / remix** — and reset back to pending. Two-way toggles sync to both sidebar and canvas pins.
- **Project brief ("Intent")** — set a short description of what you're building; Frank prepends it to every AI handoff so the AI sees your goal, not just the comments.
- **Download** — one-click zip bundle: project JSON + Markdown report + PDF report + all bookmarked snapshots + source files + assets. Ready to hand off or archive.

### Route feedback to AI — three paths
- **MCP server** (new) — Frank exposes 15 tools over the Model Context Protocol so Claude, Cursor, or any MCP-capable AI can connect directly. Tools cover reads (projects, comments, canvas state, timeline, bundles) and curated writes (add shape, text, path, connector, comment — plus `create_share` for canvas). Setup lives under Settings → MCP Setup.
- **Copy as prompt** — on any approved comment, click `↗ AI`. A structured prompt with the comment, its context, and the project brief lands on the clipboard. Paste into Claude, ChatGPT, a local LLM, whatever.
- **Export** — JSON for machine input, Markdown / PDF for human-readable project reports. Everything comments + curations + bookmarks + AI decision trail.

Frank deliberately does not bundle an in-app AI chat. That would lock you into one provider and force API-key management. Route feedback to whatever tool you already trust.

### Self-hosted sharing
- **Async share** — URL, PDF, image, or canvas: create a link, reviewer opens it, both sides comment asynchronously
- **Live canvas share** — flip a live toggle on a canvas share and every shape edit, drop, move, and comment propagates to open viewers in near real time over SSE. Presence counter, revocation, optional expiration (1 day to 1 year or custom), 2-hour session auto-pause with resume
- **You host the backend** — `frank-cloud/` is a one-click Vercel reference implementation. Share payloads live in YOUR Blob storage; live presence lives in YOUR Upstash Redis. Or swap the backend for Cloudflare Workers, Deno Deploy, anything implementing the [Cloud API contract](CLOUD_API.md)

### Project management (home view)
- **Search / sort / filter** by name, date, or project type
- **Inline rename** (F2), archive, soft-delete with 30-day Trash, restore, permanent delete
- **Keyboard navigation** — Tab, ↑/↓, Enter, F2, Delete

### Error handling
- **Toasts** — top-right stack; info/warn auto-dismiss, errors persist until dismissed, with action buttons (e.g. Retry)
- **Inline error cards** — replace failed surfaces (proxy unreachable, etc.) with message + suggestion + retry
- **Connection awareness** — daemon drop surfaces a persistent error toast; reconnection surfaces a confirmation

---

## Architecture

Two packages. One local, one cloud.

```
LOCAL (your machine)                         CLOUD (your Vercel account, optional)
+---------------------------+                +---------------------------+
| Frank Daemon (Node.js)    |  -- HTTPS -->  | Frank Cloud (Vercel)      |
| - HTTP server (42068)     |                | - /api/share (CRUD)       |
| - WebSocket (42069)       |  <-- SSE ---   | - /api/share/:id/state    |
| - MCP stdio bridge        |                | - /api/share/:id/stream   |
| - Content proxy           |                | - /api/comment            |
| - Asset store (sha256)    |                | - Share viewer page       |
| - Canvas state I/O        |                |                           |
| - Live-share controllers  |                |      +-----------------+  |
| - Bundle / report builder |                |      | Vercel Blob     |  |
| - Project I/O (~/.frank/) |                |      | (share payloads)|  |
+---------------------------+                |      +-----------------+  |
        |                                    |      | Upstash Redis   |  |
        v                                    |      | (live presence, |  |
  Browser UI (localhost:42068)               |      |  pubsub, diffs) |  |
  - Home (URL / file / canvas entry)         |      +-----------------+  |
  - Viewer (iframe + overlay + curation)     +---------------------------+
  - Canvas (Konva + tools + live badge)                    ^
  - Timeline (bookmarks, exports)                          | share viewers
                                                           | (anonymous)
                                                         Reviewers
```

Everything lives locally in `~/.frank/` unless you hit Share. The cloud is optional; sharing is optional; AI is optional.

### Tech stack

| Layer | Technology |
|---|---|
| Browser UI | Plain JS ES modules — no framework, no build step |
| Canvas | [Konva](https://konvajs.org/) 9 (MIT), loaded via `<script>` tag |
| Daemon | Node.js + TypeScript — HTTP + WebSocket server |
| AI access | [MCP server](https://modelcontextprotocol.io) (stdio) + clipboard "Copy as prompt" + JSON / Markdown / PDF export. No bundled in-app chat. |
| Cloud sharing | Vercel serverless + Vercel Blob + Upstash Redis (self-hosted) |
| Canvas export | Konva → SVG → [svg2pdf.js](https://github.com/yWorks/svg2pdf.js) for vector PDF |
| Report export | [pdfmake](http://pdfmake.org/) — vector PDF with Roboto |
| Bundle export | [JSZip](https://stuk.github.io/jszip/) — one zip with JSON + reports + snapshots + source + assets |
| Storage | JSON files in `~/.frank/projects/` + content-addressed assets + `~/.frank/config.json` (0600) |
| Comment anchoring | CSS selector + DOM path + visual coordinates (DOM) · shape ID + last-known world position (canvas) |

---

## Install

Requires [Node.js](https://nodejs.org/) v18 or later.

```bash
git clone https://github.com/carlostarrats/frank
cd frank/daemon
npm install
npm run build
npm install -g .
```

After install, the `frank` command is available globally.

---

## Usage

```bash
frank start       # start daemon, open browser at localhost:42068
frank stop        # stop daemon, remove Claude Code hooks
frank status      # show daemon and cloud connection status
frank connect     # connect to your self-hosted Frank Cloud
frank export      # export a project as structured JSON
frank mcp         # run the MCP server (called by your AI tool, not by you)
frank uninstall   # remove all Frank data (with confirmation)
```

`frank start` opens `http://localhost:42068`. From the home screen:

- **Paste a URL** to wrap any running site with a commenting overlay
- **Drop a file** (or click "Browse files…") for a PDF or image
- **+ New canvas** for a blank canvas

Hit the **Help** button in the top-right any time for a quick tour.

When you're done, hit `Ctrl+C` in the terminal or run `frank stop`.

### Route feedback to AI

**MCP (recommended).** Open Settings → **MCP Setup** for the config snippet and client-specific paths (Claude Desktop, Claude Code, Cursor). After adding the config, your AI can list projects, read comments + canvas state, and make curated writes to the canvas. Instructions + security notes are in the Settings panel.

**Copy as prompt.** On any approved comment, click `↗ AI`. A structured prompt lands on your clipboard with the comment, its context, the project brief, and the decision chain. Paste anywhere.

**Export the whole project.**

```bash
frank export --project <id>
```

Exports structured JSON. Or open the Timeline view and Export → Markdown / PDF for a human-readable report.

### Connect to your cloud (for sharing)

Sharing is optional and self-hosted. Frank doesn't talk to any Anthropic-operated cloud — you point it at a backend **you** host. Full walkthrough in [`frank-cloud/DEPLOYMENT.md`](frank-cloud/DEPLOYMENT.md).

| Integration | What it's for | How to attach |
|---|---|---|
| **Upstash Redis** | live-share presence, pubsub, diff buffer | Vercel Marketplace → "Upstash for Redis" → Install → Link |
| **Vercel Blob** | durable share payloads, snapshots, comments | Vercel Storage → Create → Blob (public) → Link |
| **`FRANK_API_KEY`** | daemon ↔ cloud auth | Settings → Environment Variables. Value: `openssl rand -hex 32` |

**From the UI:** Open Frank → Settings cog → **Cloud Backend** tab → **Use Vercel** → **Deploy to Vercel**. A Vercel clone page opens with repo, root directory, and env var prompt pre-filled. Deploy, attach Redis + Blob, disable Deployment Protection (share URLs are public by design), paste the URL + key back into Frank, click **Test connection**.

**From the terminal:**

```bash
frank connect https://your-backend.example.com --key YOUR_API_KEY
```

Both paths write to `~/.frank/config.json` (mode 0600). Until a backend is configured, the Share button warns that cloud isn't set up — everything else in Frank works without it.

**Bring your own backend:** Any host that implements the [Cloud API contract](CLOUD_API.md) works. Settings → **Use your own** tab. Seven JSON-over-HTTPS endpoints.

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
| `Cmd/Ctrl` + `C` / `V` | Copy / paste shapes |
| `Cmd/Ctrl` + `Z` | Undo |
| `Cmd/Ctrl` + `Shift` + `Z` | Redo |

### Home keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Tab` | Move focus |
| `↑` / `↓` | Move between project cards |
| `Enter` | Open the focused project |
| `F2` | Rename in place |
| `Delete` / `Backspace` | Move to Trash (or permanently delete from Trash) |
| `Esc` | Close the Help modal |

---

## Privacy

- **Local by default** — project data, canvas state, uploaded files, image assets, and curation logs stay in `~/.frank/` on your machine
- **No telemetry, no analytics, no accounts** — Frank never phones home
- **No AI calls from Frank itself** — routing to AI happens via MCP (AI connects to you), clipboard (Copy as prompt), or export. You pick which AI, under whatever terms that tool provides.
- **API keys stay local** — config at `~/.frank/config.json` with `0600` permissions; the daemon never logs secrets
- **Sharing is opt-in** — when you share, a snapshot goes to YOUR Blob storage, and live-share state goes to YOUR Redis. Frank's infrastructure is not involved.
- **Sensitive content detection** — Frank warns before sharing if it detects emails, API keys, or passwords in the page
- **Canvas bundle disclosure** — canvas shares inline every referenced image asset as a data URL inside the payload; nothing else is uploaded

---

## Development

Frontend has no build step — plain JS files served by the daemon. Konva loads via `<script>` tag. jsPDF and svg2pdf are loaded from CDN on first export.

```bash
frank start
# UI is at http://localhost:42068 — edit ui-v2/ files, refresh browser.

# Rebuild daemon after TypeScript changes
cd daemon && npm run build
# Restart the daemon — Node does not hot-reload.
```

### Testing

Daemon has a Vitest suite (**182 passing across 21 files**, plus an opt-in cloud integration harness with 9 more). Unit tests use temp directories — they never touch real `~/.frank/`.

```bash
cd daemon
npm test           # run all unit tests
npm run test:watch # watch mode

# Opt-in cloud integration harness — exercises the real backend contract.
# See frank-cloud/INTEGRATION_TESTING.md.
FRANK_CLOUD_BASE_URL=http://localhost:3000 \
  FRANK_CLOUD_API_KEY=<key> \
  npm test -- cloud-integration
```

### Project structure

```
frank/
+-- ui-v2/                    # Browser UI (plain JS, no build step)
|   +-- index.html            # Entry point; Konva loaded via <script>
|   +-- app.js                # App shell, view router
|   +-- core/                 # WebSocket client, in-memory project state
|   +-- views/                # Home, viewer, canvas, timeline
|   +-- overlay/              # Element detection, triple-anchor, DOM snapshots
|   +-- canvas/               # Stage, tools, shapes, connectors, comments (pins),
|   |                         #   image drop, shortcuts, history, SVG/PNG/PDF/JSON export
|   +-- components/           # toolbar, curation, share-popover, intent-button,
|   |                         #   url-input, help-panel, settings-panel (cloud + MCP),
|   |                         #   ai-routing, toast, error-card
|   +-- styles/               # tokens, ui, app, overlay, comments, curation, canvas, timeline
+-- daemon/                   # Node.js daemon (TypeScript)
|   +-- src/cli.ts            # CLI: start / stop / status / connect / export / mcp / uninstall
|   +-- src/server.ts         # HTTP + WebSocket server, all message handlers
|   +-- src/projects.ts       # Project CRUD + intent + lifecycle (archive/trash/restore/purge)
|   +-- src/assets.ts         # Content-addressed asset storage (sha256)
|   +-- src/snapshots.ts      # Bookmark + canvas snapshot storage (with thumbnail)
|   +-- src/curation.ts       # Curation log (approve/dismiss/remix/reset)
|   +-- src/canvas.ts         # Canvas state I/O
|   +-- src/canvas-writes.ts  # Programmatic canvas writes (used by MCP)
|   +-- src/bundle.ts         # One-click download: zip of JSON + reports + snapshots + assets
|   +-- src/report.ts         # Markdown + PDF project reports
|   +-- src/export.ts         # Structured JSON export
|   +-- src/live-share.ts     # Live-share transport (canvas/image/pdf controllers)
|   +-- src/proxy.ts          # Content proxy for iframe-restricted URLs
|   +-- src/cloud.ts          # Self-hosted cloud client + secret-aware config I/O
|   +-- src/mcp/              # MCP server: stdio bridge + 15 tool definitions
+-- frank-cloud/              # Deployable Vercel project (self-hosted sharing)
|   +-- api/                  # Serverless functions (share, comment, health, live)
|   +-- public/viewer/        # Share viewer — URL/PDF/image iframe OR canvas via Konva
+-- CLAUDE.md
+-- CLOUD_API.md
+-- README.md
```

---

## License

[PolyForm Shield 1.0.0](LICENSE) — a source-available license that permits use, modification, and distribution for any purpose **except** providing a product that competes with Frank. Full text in [`LICENSE`](LICENSE); license homepage: <https://polyformproject.org/licenses/shield/1.0.0/>.

What this means in practice:

- **Use it yourself** — individuals, teams, and companies can run Frank internally for any commercial or non-commercial purpose
- **Fork it, modify it, redistribute it** — as long as you keep the license and the `Required Notice` intact
- **Contribute back** — forks and PRs are welcome under the same terms
- **Don't resell it as a competing product** — you may not package Frank (or a derivative) as a SaaS or commercial offering that competes with it

> PolyForm Shield is *source-available* rather than OSI-certified "open source." Consult your own legal counsel if in doubt.

### Acknowledgements

Frank bundles or depends on the following third-party software. All are permissive (MIT, 0BSD, Apache-2.0). Full copyright notices in [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md), which must accompany any redistribution.

- [Konva](https://konvajs.org/) — MIT (CDN at runtime)
- [ws](https://github.com/websockets/ws) — MIT (daemon)
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) — MIT (MCP server)
- [pdfmake](http://pdfmake.org/) — MIT (project report PDF)
- [tslib](https://github.com/microsoft/tslib) — 0BSD (transitive, via pdfmake)
- [JSZip](https://stuk.github.io/jszip/) — MIT (bundle export)
- [jsPDF](https://github.com/parallax/jsPDF) — MIT (canvas PDF, on demand)
- [svg2pdf.js](https://github.com/yWorks/svg2pdf.js) — MIT (canvas PDF, on demand)
- [Roboto fonts](https://fonts.google.com/specimen/Roboto) — Apache-2.0 (bundled inside pdfmake)
- [Vitest](https://vitest.dev/) — MIT (dev-only)
- [@vercel/blob](https://github.com/vercel/storage) — Apache-2.0 (Frank Cloud only)
- [@upstash/redis](https://github.com/upstash/upstash-redis) — MIT (Frank Cloud only)
- [@vercel/node](https://github.com/vercel/vercel/tree/main/packages/node) — Apache-2.0 (Frank Cloud only)

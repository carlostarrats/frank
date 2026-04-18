# Frank — Claude Code Context

## What This Is
A collaboration layer for any web content. Point it at any URL — localhost, staging, production — and Frank wraps it with commenting, sharing, feedback curation, and a complete data trail of how the thing was built.

MIT license. Mac-first. Browser-based (no native app).

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

### Self-Hosted Cloud
- Sharing uses a **self-hosted Vercel project** (`frank-cloud/`) that the user deploys to their own Vercel account.
- Frank never sends data to our servers. Users own their cloud infrastructure.
- Cloud is optional — everything except sharing works offline.

### Plain JS Frontend
- **No build step.** The `ui-v2/` directory is served directly by the daemon's HTTP server.
- **No framework.** Plain DOM — innerHTML for static renders, event listeners for interaction.
- Plain JS ES modules — no TypeScript, no bundler, no transpilation.
- Plain CSS with custom properties — no Tailwind, no CSS-in-JS.
- **Konva** is loaded via `<script>` tag in `index.html` (unpkg CDN) and accessed as `window.Konva`. It powers the canvas view — also no build step.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Browser UI | Plain JS ES modules (no framework, no build step) |
| Daemon | Node.js + TypeScript — HTTP server (42068) + WebSocket (42069) |
| Content wrapping | iframe + transparent overlay + content proxy |
| Cloud sharing | Vercel serverless functions + Blob storage (self-hosted) |
| Project storage | JSON files in `~/.frank/projects/` |
| Comment anchoring | CSS selector + DOM path + visual coordinates (triple-anchor) |

---

## Project Structure

```
frank/
├── ui-v2/                    # Browser UI (plain JS, no build step)
│   ├── index.html            # Entry point
│   ├── app.js                # App shell: view router, state
│   ├── frank-logo.svg        # Logo
│   ├── core/
│   │   ├── sync.js           # WebSocket client — all I/O through daemon
│   │   └── project.js        # In-memory project state manager
│   ├── views/
│   │   ├── home.js           # Project list — create (URL / canvas / scaffold), open, delete
│   │   ├── viewer.js         # Content viewer — iframe + overlay + comments
│   │   ├── canvas.js         # Konva canvas view — shape tools, pan/zoom, persist
│   │   ├── scaffold.js       # Spin One Up — template picker, install + dev-server progress
│   │   └── timeline.js       # Chronological view of all activity
│   ├── canvas/
│   │   ├── stage.js          # Konva Stage + Layer setup, pan (space+drag), zoom
│   │   ├── tools.js          # Tool modes: select, rect, sticky, text, freehand, arrow
│   │   ├── transformer.js    # Selection + Konva.Transformer handles, delete-key
│   │   └── serialize.js      # Save/load via Konva JSON (content layer only)
│   ├── overlay/
│   │   ├── overlay.js        # Click handling, comment mode toggle
│   │   ├── element-detect.js # Smart element detection (bubble to meaningful)
│   │   ├── anchoring.js      # Triple-anchor: CSS selector + DOM path + coords
│   │   ├── highlight.js      # Element highlight rendering
│   │   └── snapshot.js       # DOM snapshot capture for sharing
│   ├── components/
│   │   ├── toolbar.js        # Top toolbar
│   │   ├── curation.js       # Feedback curation panel (approve/dismiss/remix)
│   │   ├── comments.js       # Comment input (used by overlay callback)
│   │   ├── share-popover.js  # Share link management
│   │   ├── ai-routing.js     # AI instruction editor + clipboard copy (fallback for non-Claude providers)
│   │   ├── ai-panel.js       # In-app AI conversation panel — streams Claude responses, persists turns
│   │   └── url-input.js      # URL/file input with validation
│   └── styles/
│       ├── tokens.css        # Design tokens, resets
│       ├── app.css           # App chrome styles
│       ├── overlay.css       # Overlay + highlight styles
│       ├── comments.css      # Comment input styles
│       ├── curation.css      # Curation panel styles
│       └── timeline.css      # Timeline view styles
├── daemon/                   # Node.js daemon (TypeScript)
│   ├── vitest.config.ts      # Test configuration
│   ├── src/cli.ts            # frank start / stop / connect / status / export
│   ├── src/server.ts         # HTTP + WebSocket server, proxy routing, handlers
│   ├── src/protocol.ts       # Shared types and constants
│   ├── src/projects.ts       # Project file I/O + comment CRUD
│   ├── src/proxy.ts          # Content proxy for iframe-restricted URLs
│   ├── src/cloud.ts          # Cloud client (share upload, comment fetch)
│   ├── src/snapshots.ts      # Snapshot storage (save, list, star, delete)
│   ├── src/curation.ts       # Curation log (approve, dismiss, remix, batch)
│   ├── src/ai-chain.ts       # AI instruction chain logging
│   ├── src/export.ts         # Structured JSON export
│   ├── src/inject.ts         # CLAUDE.md injection/removal
│   ├── src/canvas.ts         # Canvas state I/O (one JSON blob per project)
│   ├── src/ai-conversations.ts  # Per-project AI conversation storage (size + msg count caps)
│   ├── src/ai-providers/claude.ts  # Claude API client, context builder with token budget
│   ├── src/scaffold.ts       # Spin One Up — template copy, npm install, dev-server spawn, PID tracking
│   ├── templates/            # Scaffold templates shipped with the daemon
│   │   ├── static/           # Plain HTML/CSS/JS starter with a tiny Node static server
│   │   └── vite-react/       # Vite + React starter (requires npm install)
│   └── src/*.test.ts         # Tests for each module (vitest)
├── frank-cloud/              # Self-hosted Vercel project for sharing
│   ├── api/                  # Serverless functions (share, comment, health)
│   ├── public/viewer/        # Share viewer page for reviewers
│   ├── vercel.json           # Routes, headers, security
│   └── README.md             # Deploy guide with security checklist
├── CLAUDE.md
├── PROGRESS.md
└── README.md
```

---

## Key Rules

- **URL-first**: the input is a URL or file, not a JSON schema
- **Daemon is sole file writer**: UI never touches the filesystem
- **All data local by default**: nothing leaves the machine unless user hits Share
- **Self-hosted cloud**: users deploy their own sharing backend
- **No build step**: `ui-v2/` must be servable as-is
- **Smart element detection**: clicks bubble up to meaningful elements, not raw DOM nodes
- **Triple-anchor comments**: CSS selector + DOM path + visual coordinates for resilience
- **Security first**: sensitive content detection before sharing, input validation, rate limiting

---

## Coding Conventions

- Plain JavaScript ES modules in the frontend (no TypeScript)
- Plain DOM — innerHTML for static renders, event listeners for interaction
- Functions returning HTML strings for rendering
- CSS custom properties for all design tokens
- All file I/O goes through the daemon via WebSocket
- Daemon TypeScript follows strict mode, atomic writes for all file operations

---

## Views

| View | What it shows |
|---|---|
| **Home** | Project list — create new (URL input or "New canvas"), open existing, delete |
| **Viewer** | Content in iframe + commenting overlay + curation sidebar + AI panel sidebar |
| **Canvas** | Konva-backed sketching: select, rectangle, sticky, text, pen, arrow. Pan (space+drag), zoom (wheel). State persists to `~/.frank/projects/{id}/canvas-state.json`. Opened automatically when `project.contentType === 'canvas'`. |
| **Scaffold** | Spin One Up — pick a template (`static` / `vite-react`), name the project, pick a directory. Daemon copies the template, runs `npm install` (streaming output to the UI) when needed, spawns the dev server, detects the URL from stdout, then hands off to the viewer. |
| **Timeline** | Chronological view of snapshots, comments, curations, AI instructions |

## Spin One Up (scaffold)

- Templates ship inside the daemon package at `daemon/templates/{id}/`. Adding a new template: drop files under a new id directory and add an entry to `TEMPLATES` in `daemon/src/scaffold.ts`.
- Dev-server URLs are detected with `/https?:\/\/(?:localhost|127\.0\.0\.1):\d+/` from the child's stdout/stderr. If a template doesn't print such a line, detection will hang — make sure the `dev` script logs one.
- Child processes are tracked in an in-memory map keyed by project ID. `stopDevServer` sends SIGTERM then escalates to SIGKILL after 5 s. `cleanupAllServers` runs in `runStop` during `frank stop` / SIGINT / SIGTERM.
- Orphan detection on daemon restart is not implemented yet — spawning a new scaffold after a crash leaves the old dev server running; users can `lsof -iTCP -sTCP:LISTEN -P` + `kill` manually. Planned for v2.x.
- CLI: `frank scaffold <template> <name> [--dir <target>]` scaffolds without the UI (useful for scripting), prints the new project's directory and next steps, and exits. The dev server is NOT spawned by the CLI — use the UI for the full auto-start flow.

## AI panel

- Persistent Claude conversation docked as a second right-side sidebar in the viewer. Toggle via the "AI" button in the toolbar.
- Claude API key lives in `~/.frank/config.json` under `aiProviders.claude.apiKey`. The daemon enforces `0600` permissions on every write and never logs the key.
- Conversations persist at `~/.frank/projects/{id}/ai-conversations/{conversationId}.json`. Size-first caps: soft warn at 2 MB / 100 messages (banner), hard cap at 5 MB / 200 messages (forces a new conversation with `continuedFrom` linking back).
- `buildContext()` in `ai-providers/claude.ts` assembles each turn's prompt within a per-section token budget (preamble 500 / canvas 3000 / comments 2000 / snapshots 1000 / remainder for history). Logs per-section char counts without content.
- Streaming responses flow daemon → WebSocket → UI: `ai-stream-started` → `ai-stream-delta` × N → `ai-stream-ended` (or `ai-stream-error`).
- Clipboard-based AI routing (`ai-routing.js`) still works as a fallback for users of non-Claude providers — the "Copy as prompt" button on curated comments is unchanged.

---

## Testing

The daemon has a Vitest test suite (82 tests across 8 files). Tests use temp directories — never touch real `~/.frank/`.

```bash
cd daemon
npm test           # run all tests once
npm run test:watch # watch mode
```

Test files live alongside source: `src/*.test.ts`. Each test file mocks `./protocol.js` to redirect `PROJECTS_DIR` to a temp directory. The `inject.test.ts` file additionally mocks `os.homedir()` using `vi.hoisted()`.

**Covered modules:** `projects.ts`, `snapshots.ts`, `curation.ts`, `ai-chain.ts`, `export.ts`, `proxy.ts`, `cloud.ts`, `inject.ts`, `canvas.ts`.

After changing any daemon module, run `npm test` to verify nothing broke.

---

## After changing UI code

After any change to files in `ui-v2/`:
1. Just refresh the browser at `localhost:42068` — no build step needed.

After any change to files in `daemon/src/`:
1. `cd daemon && npm run build`
2. Run `npm test` to verify tests pass
3. Restart the daemon: kill existing process, run `frank start`

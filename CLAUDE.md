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
│   │   ├── home.js           # Project list — create, open, delete
│   │   ├── viewer.js         # Content viewer — iframe + overlay + comments
│   │   └── timeline.js       # Chronological view of all activity
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
│   │   ├── ai-routing.js     # AI instruction editor + clipboard copy
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
| **Home** | Project list — create new (URL input), open existing, delete |
| **Viewer** | Content in iframe + commenting overlay + curation sidebar |
| **Timeline** | Chronological view of snapshots, comments, curations, AI instructions |

---

## Testing

The daemon has a Vitest test suite (82 tests across 8 files). Tests use temp directories — never touch real `~/.frank/`.

```bash
cd daemon
npm test           # run all tests once
npm run test:watch # watch mode
```

Test files live alongside source: `src/*.test.ts`. Each test file mocks `./protocol.js` to redirect `PROJECTS_DIR` to a temp directory. The `inject.test.ts` file additionally mocks `os.homedir()` using `vi.hoisted()`.

**Covered modules:** `projects.ts`, `snapshots.ts`, `curation.ts`, `ai-chain.ts`, `export.ts`, `proxy.ts`, `cloud.ts`, `inject.ts`.

After changing any daemon module, run `npm test` to verify nothing broke.

---

## After changing UI code

After any change to files in `ui-v2/`:
1. Just refresh the browser at `localhost:42068` — no build step needed.

After any change to files in `daemon/src/`:
1. `cd daemon && npm run build`
2. Run `npm test` to verify tests pass
3. Restart the daemon: kill existing process, run `frank start`

# Frank

> A persistent context layer for AI-assisted development. Start from a URL, a canvas sketch, or a scaffolded dev server. Comment on specific elements, share for feedback, iterate with Claude in-app — every decision captured along the way.

**v2.0 Beta** — Three entry points (URL / canvas / scaffold), in-app Claude conversations, and the commenting + share loop from v1. Still early; rough edges exist.

**Frank is a terminal tool.** You start it from the command line, and it opens a browser-based UI at `localhost:42068`. Requires [Node.js](https://nodejs.org/) (v18+).


<img width="1312" height="1061" alt="Screenshot 2026-03-31 at 11 40 53 PM" src="https://github.com/user-attachments/assets/7b0a5030-cb9d-47fe-aec7-e1ba6ffb2d1e" />

---

## What it does

Frank wraps what you're building with a commenting overlay, a Claude conversation that sees your project context, and a complete data trail of how the thing was made. Three entry points all lead to the same loop:

1. **Start from a URL** — localhost, Vercel preview, production. Click any element to anchor a comment. Share for external review.
2. **Start from a canvas** — an infinite Konva canvas with sticky notes, shapes, text, freehand, and arrows. Sketch structure and intent; hand it to Claude as context.
3. **Spin one up** — pick a template (`static` or `vite-react`), name the project, and Frank scaffolds the code, starts the dev server, and lands you in review mode on the live URL.

From any entry point:

```
Entry (URL / canvas / scaffolded app)
       |
Comment on specific elements (click to anchor)
       |
Curate feedback (approve / dismiss / remix)
       |
Ask Claude in-app — or copy a structured prompt to any other AI
       |
Iterate, snapshot, repeat
       |
Share for external review (optional, self-hosted)
```

Everything is captured: every comment, every AI conversation, every snapshot. Every byte lives in `~/.frank/` unless you explicitly hit Share.

---

## Features

### Core loop
- **Wrap any URL** — localhost dev server, Vercel preview, production site, PDFs, images
- **Element-level commenting** — click any element, comment anchors via CSS selector + DOM path + coordinates (triple-anchor for resilience)
- **Smart element detection** — clicks bubble up to the nearest meaningful element (card, button, heading — not the tiny span your cursor landed on)
- **Content proxy** — automatically proxies sites that block iframe embedding
- **Multi-page tracking** — detects navigation within the iframe, prompts to add new screens

### Canvas (new in v2)
- **Konva-based infinite canvas** — plain JS, no build step, loaded via `<script>` tag
- **Tool palette** — select, rectangle, sticky note, text, freehand pen, arrow
- **Pan and zoom** — spacebar + drag to pan, wheel to zoom relative to pointer
- **Transform handles** — multi-select + resize + rotate via Konva's Transformer
- **Persistent** — canvas state saved to `~/.frank/projects/{id}/canvas-state.json` per project

### In-app AI panel (new in v2)
- **Claude conversations** — docked sidebar in the viewer, streaming responses via `@anthropic-ai/sdk`
- **Project context baked in** — every turn includes your curated comments, recent snapshot metadata, and (for canvas projects) the canvas state, within an explicit token budget
- **Persistent across sessions** — conversations stored per project with size-aware caps and automatic continuation linking
- **Clipboard fallback** — "Copy as prompt" on any message, so non-Claude AIs still work

### Spin One Up (new in v2)
- **Two built-in templates** — `static` (HTML/CSS/JS with a Node static server) and `vite-react` (React + Vite with HMR)
- **Streamed install logs** — `npm install` output flows into the scaffold UI so you can see what's happening
- **Auto dev-server detection** — Frank reads the dev URL from stdout and opens the viewer on it
- **Clean shutdown** — `frank stop` kills every spawned dev server

### Collaboration
- **Self-hosted sharing** — deploy Frank Cloud to your own Vercel account, get real internet links
- **Reviewer experience** — reviewers open the link, see the page, comment with guided prompts
- **Feedback curation** — approve, dismiss, or remix each comment
- **Snapshots** — capture interface state at meaningful moments; star important ones; see the timeline
- **Structured export** — one-click JSON export of the entire project for AI review
- **Data capture** — always-on by default, toggleable per project

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
| - Canvas state I/O        |                | - Share viewer page       |
| - AI conversation store   |                | - Vercel Blob storage     |
| - Claude API client       |                +---------------------------+
| - Scaffold + dev-server   |
|   spawner                 |     ----->     Claude API (api.anthropic.com)
| - Project I/O (~/.frank/) |                 (your key, your call)
+---------------------------+
        |
        v
  Browser UI (localhost:42068)
  - Home (URL / canvas / scaffold entry points)
  - Viewer (iframe wrapper + overlay + curation + AI panel)
  - Canvas (Konva stage with tools, pan/zoom, persistence)
  - Scaffold (template picker + streamed install progress)
  - Timeline view
```

Everything lives locally in `~/.frank/` unless you explicitly hit Share or connect an AI provider. The cloud is optional; AI is optional; sharing is optional.

### Tech stack

| Layer | Technology |
|---|---|
| Browser UI | Plain JS ES modules — no framework, no build step |
| Canvas | [Konva](https://konvajs.org/) (MIT), loaded via `<script>` tag |
| Daemon | Node.js + TypeScript — HTTP + WebSocket server |
| AI | [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript), streaming via `messages.stream()` |
| Cloud sharing | Vercel serverless functions + Blob storage (self-hosted) |
| Storage | JSON files in `~/.frank/projects/` + `~/.frank/config.json` (0600) |
| Comment anchoring | CSS selector + DOM path + visual coordinates |

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

The `vite-react` scaffold template requires an internet connection the first time you use it (for `npm install`). The `static` template has no network dependencies.

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
frank stop        # stop daemon, remove Claude Code hooks, kill spawned dev servers
frank status      # show daemon and cloud connection status
frank scaffold    # scaffold a new project from a template (headless)
frank connect     # connect to your self-hosted Frank Cloud
frank export      # export a project as structured JSON
frank uninstall   # remove all Frank data (with confirmation)
```

`frank start` launches the daemon and opens `http://localhost:42068` in your default browser. From the home screen, pick your entry point:

- **Paste a URL** to wrap any running site with Frank's commenting overlay.
- **+ New canvas** for a blank Konva canvas to sketch on.
- **+ Spin one up** to scaffold a new project and land in review mode on the spawned dev server.

When you're done, hit `Ctrl+C` in the terminal or run `frank stop`. Frank will clean up any dev servers it spawned.

### Using Claude in the app

Frank's AI panel talks to Claude directly — no copy-paste required, and the conversation has your project context built in.

1. Open any project in the viewer and click the **AI** button in the toolbar.
2. The first time, click the gear icon and paste your Claude API key. Get one at <https://console.anthropic.com/>.
3. The key is written to `~/.frank/config.json` with `0600` permissions (owner read/write only). The daemon never logs it.

Every conversation is stored per-project at `~/.frank/projects/{id}/ai-conversations/`. The panel includes your curated comments, recent snapshot metadata, and (for canvas projects) the canvas state as context on every turn, within an explicit token budget so you never blow past Claude's context window.

Prefer a different AI? Every user message has a **Copy** button that exports it as a structured prompt you can paste into any other assistant. The old clipboard-routing flow on curated comments still works for the same reason.

### Scaffolding a new project

From the home screen, click **+ Spin one up**, pick a template, name the project, and give it a target directory. Frank will:

1. Copy the template files.
2. Run `npm install` if needed (streaming output to the UI).
3. Spawn the dev server.
4. Read the local URL from stdout.
5. Open the viewer on your running app.

You can also scaffold from the CLI without the UI:

```bash
frank scaffold static "Landing page" --dir ~/projects
frank scaffold vite-react "My App" --dir ~/projects
```

The CLI variant prints the scaffold location and next steps; it does **not** spawn the dev server. Use the UI for the full auto-start flow.

### Connect to cloud (for sharing)

Sharing is self-hosted — you deploy Frank Cloud to your own Vercel account, so shared snapshots live in your Blob storage, not someone else's.

1. Deploy Frank Cloud to your Vercel account (see `frank-cloud/README.md`)
2. Connect locally:

```bash
frank connect https://your-frank-cloud.vercel.app --key YOUR_API_KEY
```

Now the Share button in the viewer generates real internet links.

---

## Privacy

- **Local by default** — all project data, canvas state, and AI conversations stay in `~/.frank/` on your machine
- **API keys stay local** — Claude key stored at `~/.frank/config.json` with `0600` permissions; the daemon never logs it
- **AI calls are your calls** — Frank connects to the Claude API using your key; Anthropic's privacy terms apply; nothing routes through Frank's infrastructure (there isn't any)
- **No telemetry, no analytics, no accounts**
- **Sharing is opt-in** — when you share, a snapshot is uploaded to YOUR Vercel Blob storage
- **Self-hosted cloud** — you deploy and own the sharing infrastructure
- **Sensitive content detection** — Frank warns before sharing if it detects emails, API keys, or passwords in the page

---

## Development

The frontend has no build step — plain JS files served directly by the daemon. Konva loads via `<script>` tag from unpkg; no bundler.

```bash
frank start
# UI is at http://localhost:42068 — edit ui-v2/ files, refresh browser

# Rebuild daemon after TypeScript changes
cd daemon && npm run build
```

### Testing

The daemon has a Vitest test suite (116 tests across 11 files). Tests use temp directories — they never touch real `~/.frank/`.

```bash
cd daemon
npm test           # run all tests once
npm run test:watch # run in watch mode
```

Covered modules: projects, snapshots, curation, ai-chain, export, proxy, cloud, inject, canvas, ai-conversations, scaffold.

### Project structure

```
frank/
+-- ui-v2/                    # Browser UI (plain JS, no build step)
|   +-- index.html            # Entry point; links Konva via script tag
|   +-- app.js                # App shell, view router
|   +-- core/                 # WebSocket client, in-memory project state
|   +-- views/                # Home, viewer, canvas, scaffold, timeline
|   +-- overlay/              # Element detection, anchoring, highlighting, DOM snapshots
|   +-- canvas/               # Konva stage, tools, transformer, serialization
|   +-- components/           # Toolbar, curation, share popover, AI panel, AI routing (fallback)
|   +-- styles/               # CSS tokens, app chrome, overlay, canvas, AI panel, scaffold
+-- daemon/                   # Node.js daemon (TypeScript)
|   +-- src/cli.ts            # CLI commands: start/stop/status/scaffold/connect/export/uninstall
|   +-- src/server.ts         # HTTP + WebSocket server, all message handlers
|   +-- src/protocol.ts       # Shared types, constants, port assignments
|   +-- src/projects.ts       # Project file I/O, comment CRUD
|   +-- src/snapshots.ts      # Snapshot storage (save, list, star, delete)
|   +-- src/curation.ts       # Curation log
|   +-- src/canvas.ts         # Canvas state I/O
|   +-- src/ai-conversations.ts     # Per-project AI conversation storage with caps
|   +-- src/ai-providers/claude.ts  # Claude API client + context builder
|   +-- src/ai-chain.ts       # AI instruction chain log
|   +-- src/scaffold.ts       # Template copy, npm install streaming, dev-server spawn + tracking
|   +-- src/proxy.ts          # Content proxy for iframe-restricted URLs
|   +-- src/cloud.ts          # Self-hosted cloud client + secret-aware config I/O
|   +-- src/export.ts         # Structured JSON export
|   +-- src/inject.ts         # CLAUDE.md injection/removal
|   +-- templates/            # Scaffold templates shipped with the daemon
|       +-- static/           # HTML/CSS/JS + Node static server
|       +-- vite-react/       # Vite + React starter
+-- frank-cloud/              # Deployable Vercel project (self-hosted sharing)
|   +-- api/                  # Serverless functions (share, comment, health)
|   +-- public/viewer/        # Share viewer page
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
- [Vitest](https://vitest.dev/) — MIT
- [@vercel/blob](https://github.com/vercel/storage) — Apache-2.0 (Frank Cloud only)

Include their licenses wherever you redistribute Frank.

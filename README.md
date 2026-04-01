# Frank

> A collaboration layer for any web content. Point it at any URL, comment on specific elements, share for feedback, route feedback to AI, and capture the complete decision-making process.

**v1.0 Beta** — Core functionality works. Rough edges exist.

**Frank is a terminal tool.** You start it from the command line, and it opens a browser-based UI at `localhost:42068`. Requires [Node.js](https://nodejs.org/) (v18+).


<img width="1312" height="1061" alt="Screenshot 2026-03-31 at 11 40 53 PM" src="https://github.com/user-attachments/assets/7b0a5030-cb9d-47fe-aec7-e1ba6ffb2d1e" />

---

## What it does

Frank wraps any URL — localhost, staging, production — with a commenting overlay. Click any element to leave feedback. Share a link so reviewers can comment in the browser. Curate the feedback (approve, dismiss, rewrite), then send it to your AI assistant as a structured prompt. Everything is captured: every comment, every decision, every snapshot.

```
Point at what you're building (any URL)
       |
Comment on specific elements (click to anchor)
       |
Share with reviewers (real internet link)
       |
Reviewers comment with guided prompts (no app needed)
       |
You curate feedback (approve / dismiss / remix)
       |
Route to AI with context (structured clipboard copy)
       |
AI iterates -> take snapshot -> repeat
```

---

## Features

- **Wrap any URL** — localhost dev server, Vercel preview, production site, even PDFs and images
- **Element-level commenting** — click any element, comment anchors via CSS selector + DOM path + coordinates
- **Smart element detection** — clicks bubble up to the nearest meaningful element (card, button, heading — not the tiny span your cursor landed on)
- **Self-hosted sharing** — deploy Frank Cloud to your own Vercel account, get real internet links
- **Reviewer experience** — reviewers open the link, see the page, comment with guided prompts ("How does this feel?", "What's missing?", "What would you change?")
- **Feedback curation** — approve, dismiss, or remix each comment before sending to AI
- **AI routing** — format curated feedback as a structured prompt, copy to clipboard
- **Snapshots** — capture page state at meaningful moments, star important ones
- **Timeline** — chronological view of snapshots, comments, and decisions
- **Structured export** — one-click JSON export of the entire project for AI review
- **Content proxy** — automatically proxies sites that block iframe embedding
- **Multi-page tracking** — detects navigation within the iframe, prompts to add new screens
- **Data capture** — always-on by default, toggleable per project

---

## Architecture

Two packages. One local, one cloud.

```
LOCAL (your machine)                         CLOUD (your Vercel account)
+---------------------------+                +---------------------------+
| Frank Daemon (Node.js)    |  -- HTTPS -->  | Frank Cloud (Vercel)      |
| - HTTP server (42068)     |                | - POST /api/share         |
| - WebSocket (42069)       |  <-- poll --   | - POST /api/comment       |
| - Content proxy           |                | - GET  /api/share/:id     |
| - Project I/O (~/.frank/) |                | - Share viewer page       |
| - Snapshot capture        |                | - Vercel Blob storage     |
| - Comment sync            |                +---------------------------+
+---------------------------+
        |
        v
  Browser UI (localhost:42068)
  - iframe wrapper + overlay
  - Commenting + curation panel
  - Timeline view
  - Share popover
```

All data lives locally in `~/.frank/`. Nothing is sent anywhere unless you explicitly hit Share. Cloud is optional — everything except sharing works offline.

### Tech stack

| Layer | Technology |
|---|---|
| Browser UI | Plain JS ES modules — no framework, no build step |
| Daemon | Node.js + TypeScript — HTTP + WebSocket server |
| Cloud | Vercel serverless functions + Blob storage |
| Share viewer | Plain JS — same commenting overlay for reviewers |
| Storage | JSON files in `~/.frank/projects/` |

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
frank start     # start daemon, open browser at localhost:42068
frank stop      # stop daemon, remove Claude Code hooks
frank status    # show daemon and cloud connection status
frank export    # export project data as structured JSON
```

`frank start` launches the daemon and opens `http://localhost:42068` in your default browser. Paste a URL, start commenting. When you're done, hit `Ctrl+C` in the terminal or run `frank stop`.

### Connect to cloud (for sharing)

1. Deploy Frank Cloud to your Vercel account (see `frank-cloud/README.md`)
2. Connect locally:

```bash
frank connect https://your-frank-cloud.vercel.app --key YOUR_API_KEY
```

Now the Share button generates real internet links.

---

## Privacy

- **Local by default** — all project data stays in `~/.frank/` on your machine
- **No telemetry, no analytics, no accounts**
- **Sharing is opt-in** — when you share, a snapshot is uploaded to YOUR Vercel Blob storage (not ours)
- **Self-hosted cloud** — you deploy and own the sharing infrastructure
- **Sensitive content detection** — Frank warns before sharing if it detects emails, API keys, or passwords in the page

---

## Development

The frontend has no build step — plain JS files served directly by the daemon.

```bash
frank start
# UI is at http://localhost:42068 — edit ui-v2/ files, refresh browser

# Rebuild daemon after TypeScript changes
cd daemon && npm run build
```

### Project structure

```
frank/
+-- ui-v2/                  # Browser UI (plain JS, no build step)
|   +-- index.html          # Entry point
|   +-- app.js              # App shell, view router
|   +-- core/               # WebSocket client, project state
|   +-- views/              # Home, viewer, timeline
|   +-- overlay/            # Element detection, anchoring, highlighting
|   +-- components/         # Toolbar, curation panel, share popover, AI routing
|   +-- styles/             # CSS tokens, app chrome, overlay, curation
+-- daemon/                 # Node.js daemon (TypeScript)
|   +-- src/cli.ts          # CLI commands
|   +-- src/server.ts       # HTTP + WebSocket server
|   +-- src/projects.ts     # Project file I/O
|   +-- src/cloud.ts        # Cloud client (share upload, comment fetch)
|   +-- src/snapshots.ts    # Snapshot storage
|   +-- src/curation.ts     # Curation log
|   +-- src/ai-chain.ts     # AI instruction chain
|   +-- src/export.ts       # Structured JSON export
|   +-- src/proxy.ts        # Content proxy for iframe-restricted URLs
|   +-- src/protocol.ts     # Shared types
|   +-- src/inject.ts       # CLAUDE.md injection
+-- frank-cloud/            # Deployable Vercel project (self-hosted sharing)
|   +-- api/                # Serverless functions (share, comment, health)
|   +-- public/viewer/      # Share viewer page
|   +-- README.md           # Deploy guide with security checklist
+-- docs/                   # Specs, plans, test plan
+-- CLAUDE.md
+-- DIRECTION-v2.md         # Product direction
```

---

## License

[PolyForm Shield 1.0.0](LICENSE) — free to use, source available, cannot be used to build a competing product.

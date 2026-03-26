<img width="684" height="644" alt="Screenshot 2026-03-04 at 7 24 21 PM" src="https://github.com/user-attachments/assets/ededc3d6-5d98-4cde-a06c-d7d0632eb0e7" />


# Frank

> The prototype layer between conversation and code. AI generates wireframes, you iterate visually, share for feedback, and hand off to become real code.

**Status: Beta.** Core functionality works. Rough edges exist. Not ready for general use.

<!-- demo gif goes here -->

---

## Who this is for

Designers and makers who work in code. If you use AI coding assistants to build UI, Frank gives you:

- **Instant preview** — see your layout alongside the terminal without publishing, deploying, or opening a design tool
- **Interactive iteration** — drag sections, try different layouts, save what works
- **Shareable prototypes** — send a link, get feedback from teammates or clients in the browser, no app needed
- **Code handoff** — when the design is right, the schema becomes the blueprint the AI builds from

## The gap

There's no tool where an AI generates a visual prototype, you iterate on it interactively, share it for team feedback, and then hand it off as a code blueprint. Figma requires design skills. Excalidraw has no prototyping or AI generation. v0 goes straight from prompt to code with no shared visual artifact in between. Frank sits in the middle — the iteration and alignment step that doesn't exist anywhere else.

---

## What it does

When you ask Claude Code to design a screen or flow, Frank renders a high-fidelity wireframe in a browser tab alongside your terminal. You iterate visually — "move the chart above the table", "make it mobile", "add a sidebar" — and Frank re-renders instantly. Share it with teammates for feedback. When the layout is right, tell Claude to build it — the wireframe schema becomes the structural blueprint.

---

## The workflow

```
1. Talk to Claude    →  "Design a dashboard with stats, a chart, and a recent orders table"
2. Frank renders     →  Wireframe appears instantly in the browser
3. Iterate visually  →  "Move the chart above the table" — Claude updates, Frank re-renders
4. Share             →  Send a link, teammates comment on specific sections
5. Build it          →  "Build this out in Next.js" — Claude uses the schema as the blueprint
```

---

## What it renders

30+ section types with shadcn/ui-quality rendering:

| Section | What it looks like |
|---|---|
| `header` | App bar — logo, nav links, search, user avatar |
| `hero` | Large headline + subtext + CTA + optional image |
| `stats-row` | KPI cards with label, value, and change badge |
| `chart` | Line/bar chart with axis labels and time-period tabs |
| `list` | Mobile list rows OR data table (auto-detected from content) |
| `form` | Stacked form fields with labels |
| `grid` | 2-column card grid |
| `bottom-nav` | Mobile tab bar with icons |
| `sidebar` | Vertical nav with grouped items |
| `chat` | Message bubbles (sent/received) |
| `empty-state` | Centered icon + headline + CTA |
| `modal` | Overlay dialog |
| `tabs` | Horizontal tab selector |
| `pricing` | Pricing tier cards |
| `footer` | Logo + links + copyright |
| ...and more | `banner`, `toolbar`, `action-row`, `loader`, `map`, `onboarding`, `testimonial`, `gallery`, `feature-grid` |

- Web platform renders with sidebar + content layouts at real dimensions
- Mobile/tablet renders at fixed device dimensions
- Wireframes render at fixed viewport sizes on a zoomable canvas

---

## Features

- **Multi-screen projects** — manage multiple screens per project, saved as `.frank.json` files
- **Screen gallery** — thumbnail grid + flow map showing connections between screens
- **Section-level comments** — click a section to comment on it, notes anchor to specific parts
- **Sharing** — generate a link, reviewers comment in the browser with guided feedback prompts
- **Cover notes** — attach context when sharing ("focus on the payment screen, rest is rough")
- **Prototype preview** — click through hotspot connections between screens
- **Handoff view** — see all screens, notes, and decisions before telling the AI to build
- **Export** — PNG, standalone HTML, or print to PDF
- **Stars** — snapshot screen states, restore later, compare versions
- **Undo/redo** — 10-state stack per screen
- **Drag to reorder** — move sections by dragging

---

## Architecture

```
Claude Code writes schema → /tmp/frank/render-<timestamp>.json
         ↓
  frank daemon watches /tmp/frank/ (FSEvents, ~10ms)
         ↓
  daemon merges screen into active project → ~/Documents/Frank/*.frank.json
         ↓
  WebSocket → browser UI (ws://localhost:42069)
         ↓
  Plain JS validates + renders wireframe (<5ms)
```

Local by default. No data leaves your machine unless you explicitly share a prototype.

### Tech stack

| Layer | Technology |
|---|---|
| UI | Plain JS ES modules — zero dependencies, zero build step |
| Wireframe rendering | shadcn/ui-inspired HTML templates + CSS |
| Icons | SVG icon functions inspired by [Lucide](https://lucide.dev/) |
| Output interception | Claude Code hooks (file watcher daemon) |
| Daemon | Node.js — HTTP server (port 42068) + WebSocket (port 42069) |
| Project storage | `.frank.json` files in `~/Documents/Frank/` |
| Share storage | Local JSON files in `~/.frank/shares/` (mock backend) |

---

## Install

```bash
git clone https://github.com/carlostarrats/frank
cd frank

# Build and install the daemon CLI
cd daemon && npm install && npm run build && cd ..
npm install -g ./daemon
```

---

## Usage

```bash
frank start   # starts daemon, opens browser, injects CLAUDE.md block
frank stop    # stops daemon, removes CLAUDE.md block
```

`frank start` is the only command you need. Open Claude Code, ask for a wireframe, it appears in the browser at `http://localhost:42068`.

---

## Privacy

- Local by default — no data leaves your machine unless you choose to share
- No telemetry, no analytics, no crash reporting
- No account, no API key
- Sharing is opt-in: when you share, the prototype is stored locally in `~/.frank/shares/`

---

## Development

The frontend has no build step — plain JS files served by the daemon's HTTP server.

```bash
# Start the daemon (serves UI + handles WebSocket)
frank start

# The UI is at http://localhost:42068
# Changes to ui/ files are live — just refresh the browser

# Rebuild daemon after TypeScript changes
cd daemon && npm run build
```

### Project structure

```
frank/
├── ui/                   # Plain JS frontend (no build step, no framework)
│   ├── index.html        # Entry point
│   ├── workspace.js      # App shell: view router, state, WebSocket
│   ├── validate.js       # Schema validation
│   ├── views/            # Home, gallery, editor, preview, handoff
│   ├── render/           # Section renderers, screen layout, icons
│   ├── core/             # Sync, project state, undo, stars
│   ├── components/       # Canvas, toolbar, comments, flow map, export
│   ├── viewer/           # Share viewer (standalone page for reviewers)
│   └── styles/           # CSS tokens, wireframe components, workspace
├── daemon/               # Node.js CLI + HTTP server + WebSocket + file I/O
│   ├── src/cli.ts        # frank start / frank stop
│   ├── src/server.ts     # HTTP + WebSocket server, file watcher, note sync
│   ├── src/projects.ts   # Project file I/O (sole file writer)
│   ├── src/shares.ts     # Share storage (mock backend)
│   ├── src/inject.ts     # CLAUDE.md injection/removal
│   └── src/protocol.ts   # Shared types and constants
├── CLAUDE.md
├── DIRECTION.md          # Product direction
└── PROGRESS.md
```

---

## Credits

- [shadcn/ui](https://ui.shadcn.com/) — the component design system that inspired Frank's rendering quality and visual language
- [Lucide](https://lucide.dev/) — icon paths used in the SVG icon system

---

## License

[PolyForm Shield 1.0.0](LICENSE) — free to use, modify, and distribute, but you cannot use it to build a competing product.

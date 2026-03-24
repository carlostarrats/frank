<img width="684" height="644" alt="Screenshot 2026-03-04 at 7 24 21 PM" src="https://github.com/user-attachments/assets/ededc3d6-5d98-4cde-a06c-d7d0632eb0e7" />


# Frank

> A terminal companion for Claude Code that renders wireframes as you design — then hands them off to become real code.

**Status: Beta.** Core functionality works. Rough edges exist. Not ready for general use.

<!-- demo gif goes here -->

---

## What it does

When you ask Claude Code to design a screen or flow, Frank intercepts the output, generates a structured layout schema, and renders it as a wireframe in a floating native panel alongside your terminal. Each screen becomes a tab. The panel stays out of your way until there's something to show.

When the layout is right, you tell Claude to build it — and Claude uses the wireframe schema as a structural blueprint to generate real components in your project.

---

## The workflow

```
1. Talk to Claude    →  "Design a dashboard with stats, a chart, and a recent orders table"
2. Frank renders     →  Wireframe appears instantly in the companion panel
3. Iterate visually  →  "Move the chart above the table" — Claude updates, Frank re-renders
4. Build it          →  "Build this out in Next.js" — Claude uses the schema as the blueprint
```

Frank is the sketch layer. The wireframes are disposable — they communicate layout and content hierarchy. The real code happens in your actual project.

---

## What works

- Single screens and multi-screen flows render automatically as you work with Claude Code
- Section types with dedicated renderers: `header` `hero` `content` `top-nav` `bottom-nav` `sidebar` `form` `list` `grid` `chart` `stats-row` `footer` `empty-state` `banner` `toolbar` `modal` `loader` and more
- `list` sections with column headers render as data tables
- `stats-row` sections with value/badge format render as KPI cards
- `chart` sections render line charts with time-period tabs and axis labels
- Web platform (`"platform": "web"`) renders in full-width desktop layout — no device frame
- Mobile/tablet platforms render inside a device frame
- Tab bar for navigating multiple screens
- `Cmd+Shift+L` to show/hide the panel
- Actions menu per tab: copy markdown, save PNG, close tab

---

## Architecture

```
Claude Code writes schema → /tmp/frank/render-<timestamp>.json
         ↓
  frank daemon watches /tmp/frank/ (FSEvents, ~10ms)
         ↓
  WebSocket → Tauri panel (ws://localhost:42069)
         ↓
  ArrowJS validates + renders wireframe
```

No network traffic. No API calls. Everything stays on your machine.

### Tech stack

| Layer | Technology |
|---|---|
| Companion panel | Tauri v2 (native macOS window) |
| Panel UI | ArrowJS (~5KB, zero dependencies, no build step) |
| Wireframe rendering | ArrowJS templates + plain CSS |
| Output interception | Claude Code hooks (file watcher daemon) |
| Panel/daemon communication | WebSocket (localhost:42069) |
| Export: image | DOM-to-PNG |
| Distribution | Build from source (Homebrew planned) |

---

## Install

```bash
git clone https://github.com/carlostarrats/frank
cd frank

# Build and install the panel app
cargo tauri build
cp -r src-tauri/target/release/bundle/macos/frank.app /Applications/frank.app

# Build and install the daemon CLI
cd daemon && npm install && npm run build && cd ..
npm install -g ./daemon
```

---

## Usage

```bash
frank start   # starts daemon, launches panel, injects CLAUDE.md block
frank stop    # stops daemon, removes CLAUDE.md block
```

`frank start` is the only command you should need. Open Claude Code, ask for a wireframe, it appears.

---

## Schema

Frank renders from a typed JSON schema. Claude writes it; the panel consumes it.

**Single screen:**

```json
{
  "schema": "v1",
  "type": "screen",
  "label": "Dashboard",
  "timestamp": "2026-03-05T00:00:00Z",
  "platform": "web",
  "sections": [
    {
      "type": "header",
      "contains": ["Brand logo wordmark", "Dashboard nav link", "Search input", "User avatar"]
    },
    {
      "type": "stats-row",
      "contains": [
        "Total Revenue stat card — $84,320 value — +12.4% badge",
        "Orders stat card — 1,284 value — +8.1% badge"
      ]
    },
    {
      "type": "list",
      "label": "Recent Orders",
      "contains": [
        "Order # column header", "Customer column header", "Status column header",
        "#ORD-001 — Sarah Johnson — Fulfilled badge",
        "Previous button", "Page 1 of 12", "Next button"
      ]
    }
  ]
}
```

**Multi-screen flow:**

```json
{
  "schema": "v1",
  "type": "flow",
  "label": "Onboarding",
  "timestamp": "2026-03-05T00:00:00Z",
  "platform": "mobile",
  "screens": [
    { "label": "Welcome", "sections": [...] },
    { "label": "Create Account", "sections": [...] }
  ]
}
```

---

## Design to code

The wireframe schema is the bridge between visual design and real implementation:

1. **Sketch** — Ask Claude for a wireframe. Frank renders it instantly.
2. **Iterate** — Refine the layout conversationally. Claude updates the schema, Frank re-renders.
3. **Export** — Copy the schema as markdown or save as a file.
4. **Build** — Tell Claude to build from the wireframe. Claude already knows the structure — it wrote the schema. It translates section types into real components (React, SwiftUI, whatever your stack is).

The schema captures layout intent: what sections exist, what they contain, how they're arranged. Claude uses this as the structural blueprint, not a pixel-perfect spec.

---

## Privacy

- No data leaves your machine. Ever.
- No telemetry, no analytics, no crash reporting.
- Reads only local files Claude Code writes to `/tmp/frank/`.
- No account, no API key, no network calls.

---

## Development

The frontend has no build step — ArrowJS templates are served directly to Tauri's webview.

```bash
# Serve the UI for browser testing (no Tauri needed)
npx serve ui -p 8080

# Tauri dev with hot reload
cargo tauri dev

# Build for distribution
cargo tauri build
```

### Project structure

```
frank/
├── ui/                   # ArrowJS frontend (no build step)
│   ├── index.html        # Entry point
│   ├── app.js            # Main app: tabs, WebSocket, state
│   ├── screen.js         # Device frame wrapper
│   ├── sections.js       # 30+ section renderers
│   ├── smart-item.js     # Item classification + rendering
│   ├── icons.js          # SVG icon functions
│   ├── validate.js       # Schema validation
│   └── style.css         # All styles (panel + wireframe + utilities)
├── daemon/               # Node.js CLI + file watcher
│   ├── src/cli.ts        # frank start / frank stop
│   ├── src/server.ts     # File watcher + WebSocket server
│   └── src/inject.ts     # CLAUDE.md injection
├── src-tauri/            # Tauri shell (minimal Rust)
│   ├── src/lib.rs        # Window + hotkey (Cmd+Shift+L)
│   └── tauri.conf.json   # App configuration
├── CLAUDE.md
└── package.json
```

---

## License

MIT

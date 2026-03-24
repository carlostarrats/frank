<img width="684" height="644" alt="Screenshot 2026-03-04 at 7 24 21 PM" src="https://github.com/user-attachments/assets/ededc3d6-5d98-4cde-a06c-d7d0632eb0e7" />


# Frank

> A terminal companion for Claude Code that renders wireframes as you design — then hands them off to become real code.

**Status: Beta.** Core functionality works. Rough edges exist. Not ready for general use.

<!-- demo gif goes here -->

---

## What it does

When you ask Claude Code to design a screen or flow, Frank renders a wireframe in a floating native panel alongside your terminal. You iterate visually — "move the chart above the table", "make it mobile", "add a sidebar" — and Frank re-renders instantly. When the layout is right, you tell Claude to build it, and Claude uses the wireframe schema as a structural blueprint to generate real components in your project.

Frank is the sketch layer. Wireframes are disposable — they communicate layout and content hierarchy. The real code happens in your actual project.

---

## The workflow

```
1. Talk to Claude    →  "Design a dashboard with stats, a chart, and a recent orders table"
2. Frank renders     →  Wireframe appears instantly in the companion panel
3. Iterate visually  →  "Move the chart above the table" — Claude updates, Frank re-renders
4. Build it          →  "Build this out in Next.js" — Claude uses the schema as the blueprint
```

---

## What it renders

30+ section types with dedicated renderers:

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

- Web platform renders full-width — no device frame
- Mobile/tablet renders inside a device frame (iPhone/iPad dimensions)
- Tab bar for navigating multiple screens
- `Cmd+Shift+L` to show/hide the panel

---

## Design intelligence

Frank doesn't just render schemas — it teaches Claude how to design. When Frank is running, Claude gets injected design knowledge:

- **Section vocabulary** — what Frank can render and when to use each section type
- **Contains syntax** — how to write content strings that render correctly (headlines, buttons, inputs, badges, toggles, charts, data tables)
- **Design taste** — visual hierarchy, composition rules, proportion limits, platform-specific patterns
- **Realistic content** — "$84,320" not "$X,XXX", "Sarah Johnson" not "User Name"

This means Claude produces better wireframes out of the box — proper information hierarchy, appropriate section types, realistic data, and platform-aware layouts.

---

## Architecture

```
Claude Code writes schema → /tmp/frank/render-<timestamp>.json
         ↓
  frank daemon watches /tmp/frank/ (FSEvents, ~10ms)
         ↓
  WebSocket → Tauri panel (ws://localhost:42069)
         ↓
  Plain JS validates + renders wireframe (<5ms)
```

No network traffic. No API calls. Everything stays on your machine.

### Tech stack

| Layer | Technology |
|---|---|
| Companion panel | [Tauri v2](https://v2.tauri.app/) (native macOS window) |
| Panel UI | Plain JavaScript ES modules — zero dependencies, zero build step |
| Wireframe rendering | HTML string templates + plain CSS |
| Icons | SVG icon functions inspired by [Lucide](https://lucide.dev/) |
| Output interception | Claude Code hooks (file watcher daemon) |
| Panel/daemon communication | WebSocket (localhost:42069) |
| Distribution | Build from source (Homebrew planned) |

The frontend was originally built with React + Vite + shadcn + Tailwind + Framer Motion. It was rebuilt as plain JavaScript with no framework, no bundler, and no build step — inspired by the philosophy of [Arrow.js](https://github.com/standardagents/arrow-js), a reactive UI library that proved zero-dependency frontends can be fast, simple, and maintainable. Arrow.js's approach to reactive templates without a build step directly influenced Frank's architecture pivot.

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

Frank renders from a JSON schema. Claude writes it; the panel consumes it.

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
4. **Build** — Tell Claude to build from the wireframe. Claude already knows the structure — it wrote the schema. It translates section types into real components for whatever stack you're using.

The schema captures layout intent — what sections exist, what they contain, how they're arranged. It's a structural blueprint, not a pixel-perfect spec.

---

## Privacy

- No data leaves your machine. Ever.
- No telemetry, no analytics, no crash reporting.
- Reads only local files Claude Code writes to `/tmp/frank/`.
- No account, no API key, no network calls.

---

## Development

The frontend has no build step — plain JS files are served directly to Tauri's webview.

```bash
# Serve the UI for browser testing (no Tauri needed)
npx serve ui -p 8080

# Test with sample wireframe
open http://localhost:8080?test

# Tauri dev with hot reload
cargo tauri dev

# Build for distribution
cargo tauri build
```

### Project structure

```
frank/
├── ui/                   # Plain JS frontend (no build step, no dependencies)
│   ├── index.html        # Entry point
│   ├── app.js            # Main app: tabs, WebSocket, state, actions menu
│   ├── screen.js         # Device frame wrapper + chrome detection
│   ├── sections.js       # 30+ section renderers (HTML string templates)
│   ├── smart-item.js     # Item classification + rendering
│   ├── icons.js          # 57 SVG icon functions
│   ├── validate.js       # Schema validation
│   └── style.css         # All styles: panel chrome + wireframe tokens + utilities
├── daemon/               # Node.js CLI + file watcher
│   ├── src/cli.ts        # frank start / frank stop
│   ├── src/server.ts     # FSEvents watcher + WebSocket server
│   └── src/inject.ts     # CLAUDE.md injection/removal
├── src-tauri/            # Tauri shell (minimal Rust — infrastructure only)
│   ├── src/lib.rs        # Window + hotkey (Cmd+Shift+L) + show/hide
│   └── tauri.conf.json   # App configuration
├── CLAUDE.md
└── package.json
```

---

## Credits

- [Arrow.js](https://github.com/standardagents/arrow-js) by Standard Agents — the reactive UI framework whose zero-dependency, no-build-step philosophy directly inspired Frank's architecture. Arrow.js proved that modern UIs don't need heavyweight frameworks.
- [Tauri](https://v2.tauri.app/) — native app shell
- [Lucide](https://lucide.dev/) — icon paths used in the SVG icon system

---

## License

MIT

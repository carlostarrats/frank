# Frank — Progress

Last updated: 2026-03-23

---

## Original vision (Looky Loo, Feb 2026)

Frank started as "Looky Loo" — an open source terminal companion for developers working with AI coding assistants. The core problem: when working in Claude Code, visual output (layouts, screen designs, component structures) is described in text. Reading that text and mentally constructing the visual is slow and error-prone.

**Original principles** (all still hold):
- Zero friction — nothing to configure, it just works alongside your workflow
- Zero cost — piggybacks on the existing AI session, no API calls
- Zero data collection — reads only local files, nothing leaves the machine
- Static only — renders snapshots, not interactive prototypes
- Schema first — one schema drives the panel render and all exports
- Mac first — ship tight for Mac, cross-platform later
- Open source, always — not a business, a contribution

**Original tech stack:** Tauri v2 + React + TypeScript + shadcn/Radix + Tailwind + Framer Motion + Vite. The React app was the entire frontend — rendering, tabs, schema validation, exports.

**What was built in v1:** 30+ section renderers, tab system, Cmd+Shift+L hotkey, skeleton loading states, PNG export, edit overlay, file watcher daemon, CLAUDE.md injection. The core rendering worked well but the build pipeline (Vite + TypeScript + Tailwind + shadcn + Framer Motion) was heavy and fragile, and the project stalled.

**What changed:** Discovered [Arrow.js](https://github.com/standardagents/arrow-js) and its zero-dependency philosophy. Realized wireframes are static content — no framework needed. Rebuilt the entire frontend as plain JavaScript ES modules with no build step. Added a design-to-code workflow where wireframes become structural blueprints for real code generation. Renamed to Frank.

Full original proposal: `lookyloo-product-proposal.md`

---

## What Frank is now

A terminal companion for Claude Code that renders wireframes in a native macOS panel. You talk to Claude about UI, Frank shows you the wireframe. You iterate visually, then tell Claude to build it for real. The wireframe schema becomes the structural blueprint for code generation.

---

## What's done

### Architecture pivot: React → plain JS (2026-03-23)

**Why:** The original stack (React + Vite + TypeScript + shadcn + Tailwind + Framer Motion) was too heavy for what are essentially static wireframes rendered from JSON. The build pipeline was fragile, Tauri builds were slow, and the project stalled.

**What changed:**
- Replaced the entire `src/` React frontend with `ui/` — plain JavaScript ES modules, no framework, no build step
- Inspired by [Arrow.js](https://github.com/standardagents/arrow-js), which proved zero-dependency frontends work. We evaluated ArrowJS but ultimately went with pure DOM/innerHTML since wireframes are static content with no reactivity needed.
- 8 files, ~3,000 lines total. The old React app was ~2,500 lines across 15+ files plus a full node_modules tree.

**What exists now in `ui/`:**

| File | Lines | What it does |
|------|-------|-------------|
| `app.js` | ~270 | Tab management, WebSocket connection, idle state, actions menu |
| `sections.js` | ~1,040 | 30+ section renderers (header, hero, stats-row, chart, list, form, etc.) |
| `style.css` | ~1,060 | All CSS — panel chrome, wireframe tokens, component classes, layout utilities |
| `validate.js` | ~260 | Schema validation (ported from TypeScript, same logic) |
| `icons.js` | ~140 | 57 SVG icon functions (replaces Lucide React) |
| `smart-item.js` | ~130 | Classifies `contains` strings → render types (headline, button, badge, etc.) |
| `screen.js` | ~35 | Device frame wrapper, chrome detection, flex fill logic |
| `index.html` | ~13 | Entry point |

### Design intelligence (2026-03-23)

**Why:** Claude could produce structurally correct schemas but the wireframes lacked design taste — wrong proportions, poor hierarchy, unrealistic content.

**What changed:**
- Rewrote the `~/.claude/CLAUDE.md` injection block from a mechanical schema reference to a full design companion guide
- Added: section vocabulary table, contains syntax guide, structured format references
- Added: design taste rules — visual hierarchy, composition, proportion limits, platform awareness, flow design, realistic content

### Documentation (2026-03-23)

- `README.md` — updated with new architecture, section type table, design intelligence section, design-to-code workflow, credits (Arrow.js, Tauri, Lucide)
- `CLAUDE.md` — updated with new project structure, coding conventions, ArrowJS-free architecture

---

## What's not done

### Tauri integration (next)
- Update `src-tauri/tauri.conf.json` to point `frontendDist` at `../ui`
- Set `withGlobalTauri: true` for `window.__TAURI__` API access
- Remove `beforeBuildCommand` (no build step needed)
- Test: `cargo tauri dev` should open the panel and render wireframes
- Test: `frank start` → ask Claude for wireframe → appears in panel

### Exports
- PNG export — port `src/exports/png.ts` to `ui/export-png.js` (html-to-image, vendored or CDN)
- Markdown export — port `src/exports/github.ts` to `ui/export-md.js` (pure string manipulation)
- Wire up the actions menu buttons (currently show "Coming soon")

### Edit overlay
- Port `src/components/EditOverlay.tsx` to plain JS
- Click a section → overlay appears → type edit instruction → sends via WebSocket

### Cleanup
- Delete old `src/` directory (React frontend)
- Delete `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `components.json`
- Simplify `package.json` (remove React/shadcn/Tailwind/Vite deps)
- Remove `ui/test-inject.js` (test helper, not needed in repo)

### Distribution
- Homebrew formula
- npm package for the daemon
- Single `frank start` should handle everything (install check, daemon, panel)

---

## Key decisions

| Decision | Why |
|----------|-----|
| Plain JS over React | Wireframes are static HTML. No reactivity, no state management, no virtual DOM needed. innerHTML is faster and simpler. |
| Plain JS over ArrowJS | Evaluated ArrowJS — elegant API but conditional rendering (ternary swapping DOM trees) didn't work reliably. For static wireframes, plain DOM is better. |
| No build step | The entire point of the pivot. `ui/` is served directly to Tauri's webview. No Vite, no bundler, no TypeScript compilation. |
| No Tailwind | Replaced with CSS utility classes in `style.css`. Wireframe components use `.wf-btn`, `.wf-card`, `.wf-badge` etc. Same visual result, zero build dependency. |
| Design taste in CLAUDE.md | The schema vocabulary alone produces correct but bland wireframes. Design rules (hierarchy, proportion, platform patterns) produce wireframes that look like a designer made them. |
| HTML strings over DOM API | Section renderers return HTML strings concatenated with template literals. Simpler than `document.createElement` chains, and `innerHTML` is fast enough for static content. |
| Daemon stays as-is | The Node.js daemon (file watcher + WebSocket) works well. No reason to rewrite it. |
| Tauri stays as-is | The Rust shell (94 lines — window + hotkey) is infrastructure. Only `tauri.conf.json` needs updating. |

---

## How to test right now

```bash
cd /path/to/frank
npx serve ui -p 8080
open http://localhost:8080?test
```

This loads a sample dashboard wireframe (header, stats, chart, data table) without needing the daemon or Tauri.

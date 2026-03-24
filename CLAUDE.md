# Frank — Claude Code Context

## What This Is
Terminal companion tool for Claude Code. Renders wireframes in a native Tauri panel from structured JSON schemas. Wireframes serve as visual sketches that become structural blueprints for real code.

Open source, MIT, Mac-first v1.

Full product proposal: `lookyloo-product-proposal.md`

---

## Architecture — Non-Negotiable Decisions

### Output Interception
- **Claude Code hooks system only** (PostToolUse, session events)
- Do NOT wrap the process, read from TTY/pty, or use any other interception method
- Hooks are the intended extension point — stable as Claude Code evolves

### Prompt Wrapper
- Inject a delimited block into `~/.claude/CLAUDE.md` on install
- Append if file exists, clean remove on uninstall
- User never touches it manually

### Tauri Layer
- **Thin shell only**: native window + hotkey in Rust
- All logic lives in ArrowJS — rendering, tabs, schema, exports
- Do not put application logic in Rust/Tauri. Treat it as infrastructure.

### Schema
- Schema is the single source of truth
- Panel render and ALL exports consume the identical schema
- Schema is versioned from day one (`"schema": "v1"`)
- Never render without a valid schema

### ArrowJS Frontend
- **No build step.** The `ui/` directory is served directly to Tauri's webview.
- ArrowJS loaded from CDN (`https://esm.sh/@arrow-js/core`)
- Plain JS ES modules — no TypeScript, no bundler, no transpilation
- Plain CSS with custom properties — no Tailwind, no CSS-in-JS

---

## Tech Stack

| Layer | Technology |
|---|---|
| Companion panel | Tauri v2 (native macOS window) |
| Panel UI | ArrowJS (~5KB, zero deps, no build step) |
| Wireframe rendering | ArrowJS templates + plain CSS |
| Output interception | Claude Code hooks system |
| Panel/daemon communication | WebSocket (localhost:42069) |
| Export: image | DOM-to-PNG |
| Distribution | Build from source (Homebrew planned) |

---

## Project Structure

```
frank/
├── ui/                   # ArrowJS frontend (no build step, served directly)
│   ├── index.html        # Entry point — loads app.js as ES module
│   ├── app.js            # Main app: reactive state, WebSocket, tabs, menus
│   ├── screen.js         # Device frame wrapper + chrome detection
│   ├── sections.js       # 30+ dedicated section renderers
│   ├── smart-item.js     # SmartItem classifier + renderer (classify, displayLabel, smartItem)
│   ├── icons.js          # SVG icon functions (replaces Lucide React)
│   ├── validate.js       # Schema validation (port of validate.ts)
│   └── style.css         # All styles: panel chrome + wireframe tokens + components + utilities
├── daemon/               # Node.js CLI + file watcher
│   ├── src/cli.ts        # frank start / frank stop
│   ├── src/server.ts     # FSEvents watcher + WebSocket server
│   └── src/inject.ts     # CLAUDE.md injection/removal
├── src-tauri/            # Tauri shell (infrastructure only)
│   ├── src/lib.rs        # Window + hotkey (Cmd+Shift+L) + show/hide
│   └── tauri.conf.json   # App config
└── CLAUDE.md
```

---

## Key Rules

- **Schema first**: never build a renderer before the schema it consumes is defined
- **Conservative classification**: render 5 things perfectly > attempt 20 and miss some
- **No persistence**: session-scoped only, nothing written to disk between sessions
- **No data leaves the machine**: no network calls except user-initiated exports
- **Static renders only**: no interaction, no hover states, no animation in wireframes
- **No dock icon, no menu bar**: panel is invisible until there is something to render
- **No build step**: the `ui/` directory must be servable as-is — no compilation, no bundling

---

## Coding Conventions

- Plain JavaScript ES modules (no TypeScript in the frontend)
- ArrowJS `reactive()` for state, `html` tagged templates for DOM
- Functions returning `html` templates (not classes, not components in the React sense)
- SVG icons as string functions via `icon(name)` and `rawHtml()` helper
- CSS custom properties for all design tokens
- CSS utility classes in `style.css` for common layouts (flex, gap, padding, typography)
- Keep Rust surface area minimal — if logic can live in JS, it lives in JS

---

## Wireframe Renderer Rules

These rules apply to every section renderer in `ui/sections.js`. Violating them produces renders that look broken. No exceptions.

### Use wireframe component classes. Never write raw styled divs.

| Need | Use |
|---|---|
| Any button | `.wf-btn` — add `.wf-btn--outline` / `.wf-btn--ghost` / `.wf-btn--icon` |
| Any text input | `.wf-input` — never a raw div with a border |
| Avatar / user photo | `.wf-avatar` — add `.wf-avatar--sm` for small |
| Card / contained block | `.wf-card` + `.wf-card__content` |
| Divider / separator line | `.wf-separator` |
| Tag / chip / label | `.wf-badge` |
| Toggle switch | `.wf-switch` — add `.wf-switch--on` for checked |
| Form label | `.wf-label` |
| Image placeholder | `.wf-image-placeholder` |

### Typography — use the CSS utility classes.

| Class | Size | For |
|---|---|---|
| `.text-xs` | 11px | Timestamps, captions, eyebrow labels |
| `.text-sm` | 13px | Secondary text, meta info, badges |
| `.text-base` | 14px | Primary body text, list items |
| `.text-lg` | 16px | Section headings, card titles |
| `.text-xl` | 18px | Screen titles |
| `.text-2xl` | 24px | Hero headlines |

### Spacing — use gap/padding utility classes on the 4px grid.

Use `.gap-1` (4px) / `.gap-2` (8px) / `.gap-3` (12px) / `.gap-4` (16px) / `.gap-6` (24px).
Use `.p-2` / `.p-3` / `.p-4` and `.px-*` / `.py-*` variants.

### Mobile device is a fixed viewport.

- Mobile: `min-height: 650px`. Tablet: `min-height: 960px`.
- `screen.js` detects the first non-chrome section and gives it `flex: 1` to fill space.
- Chrome sections: `header`, `top-nav`, `toolbar`, `bottom-nav`, `banner`
- Fill sections: everything else (`list`, `content`, `chat`, `form`, `grid`, `empty-state`)

### Icons — use the `icon()` and `rawHtml()` helpers.

```js
import { icon, headerIcon, navIcon } from './icons.js'
import { rawHtml } from './smart-item.js'

// In a template:
html`<span>${rawHtml(icon('search', 16))}</span>`
```

Never inline raw SVG paths. Always use `icon(name, size)` from `icons.js`.

---

## Design-to-Code Workflow

Frank's wireframes are not the final product — they're the sketch layer:

1. **Sketch**: User asks Claude for a wireframe → Claude writes schema → Frank renders it
2. **Iterate**: User refines layout conversationally → Claude updates schema → Frank re-renders
3. **Build**: User says "build this" → Claude uses the schema as a structural blueprint → generates real components

The schema captures layout intent (section types, content hierarchy, arrangement). Claude translates this into real code for whatever stack the user is working in.

---

## After fixing renderer code

After any change to files in `ui/`:
1. Run `cargo tauri build` in the frank project root
2. Kill the running app: `osascript -e 'quit app "frank"' 2>/dev/null; sleep 0.5; kill -9 $(pgrep -f "frank.app/Contents/MacOS/frank") 2>/dev/null; sleep 0.3`
3. Install: `cp -r src-tauri/target/release/bundle/macos/frank.app /Applications/frank.app`
4. Tell the user: "Done — run `frank start`"

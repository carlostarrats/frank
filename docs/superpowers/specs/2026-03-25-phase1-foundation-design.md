# Phase 1 — Foundation Design Spec

Date: 2026-03-25
Status: Approved
Builds on: DIRECTION.md
Review: Passed (spec-document-reviewer, 1 iteration)

---

## Overview

Clean rebuild of Frank's frontend as a multi-view workspace with fixed viewports, project persistence, screen gallery, and bidirectional AI communication. The rendering engine (sections, smart-item, icons) is ported from v0 unchanged. Everything else is new.

---

## File structure

```
ui/
├── index.html
├── workspace.js          # App shell: view router, state, WebSocket
├── views/
│   ├── home.js           # Project picker
│   ├── gallery.js        # Screen thumbnails + flow map
│   └── editor.js         # Single screen workspace
├── render/
│   ├── sections.js       # 30+ section renderers (ported from v0)
│   ├── smart-item.js     # Item classifier + renderer (ported from v0)
│   ├── icons.js          # SVG icon functions (ported from v0)
│   └── screen.js         # Device frame wrapper — fixed dimensions
├── core/
│   ├── project.js        # Project model: in-memory state, validation, screen CRUD
│   ├── undo.js           # 10-state undo stack per screen
│   ├── stars.js          # Snapshot management
│   └── sync.js           # WebSocket client — all file I/O goes through daemon
├── components/
│   ├── canvas.js         # Canvas background + zoom controls
│   ├── comments.js       # Comment panel
│   ├── toolbar.js        # Editor toolbar
│   └── flow-map.js       # Visual connection graph
├── validate.js           # Schema validation (ported from v0)
└── styles/
    ├── tokens.css        # Design tokens, resets, typography utilities
    ├── wireframe.css     # Wireframe component classes (.wf-btn, .wf-card, etc.)
    ├── workspace.css     # App chrome — views, toolbar, panels, canvas
    └── flow-map.css      # Flow map styles
```

Old code archived to `ui-v0/` for reference during build.

Preview view (`preview.js`) is Phase 4 — added to the file structure when that phase begins, not before.

---

## Tech constraints

- Plain JS ES modules — no TypeScript, no bundler, no transpilation
- Plain DOM — innerHTML for static renders, event listeners for interaction. No ArrowJS, no framework. (CLAUDE.md will be updated to reflect this — the v0 ArrowJS reference is outdated.)
- No build step — `ui/` served directly to Tauri's webview
- CSS custom properties for design tokens — no Tailwind, no CSS-in-JS
- Multiple CSS files loaded via `<link>` tags in `index.html`

### File I/O: daemon is the sole file writer

The UI runs in a Tauri webview (browser context). It cannot call `fs.writeFileSync()` or `fs.readdir()` directly. All file operations go through the daemon via WebSocket:

- **App → daemon (WebSocket):** "save project", "create project", "list projects", "delete screen", etc.
- **Daemon → filesystem:** atomic writes, directory listings, file reads
- **Daemon → app (WebSocket):** project data, file listings, confirmation

`project.js` manages the in-memory project state and validation. It does NOT touch the filesystem. When a mutation happens (drag, delete, rename), `project.js` updates memory, then `sync.js` sends the updated project to the daemon for saving.

This means:
- One writer for the project file (the daemon) — no race conditions
- No Tauri FS plugin needed — the daemon handles all I/O
- The app stays a pure webview with no native dependencies

### User preferences

Canvas background color and other display preferences stored in `localStorage` (Tauri webview persists localStorage across sessions). No separate preferences file.

---

## 1. Fixed viewport + canvas

### Problem

Wireframes currently scale to fill the window. This is a bug — wireframes should render at real device dimensions.

### Solution

Wireframes render at fixed pixel dimensions inside a zoomable canvas.

```
┌─ window ──────────────────────────────────┐
│  canvas background (#1e1e1e)              │
│                                           │
│      ┌─ wireframe (390x844) ─┐           │
│      │                       │           │
│      │   sections render     │           │
│      │   at fixed size       │           │
│      │                       │           │
│      └───────────────────────┘           │
│                                           │
└───────────────────────────────────────────┘
```

### canvas.js

- Creates a full-window container with configurable background color
- Contains a transform wrapper: `transform: scale(N)` around the wireframe
- Default zoom: fit-to-window (calculates scale so wireframe + padding fits)
- Scrollable when zoomed past window bounds
- Centers the wireframe within the available space

### screen.js (modified from v0)

- Sets hard `width` and `height` on the wireframe container
- Reads dimensions from the screen's `viewport` field, or falls back to platform defaults
- No `flex: 1`, no fluid sizing

### Viewport picker (in toolbar)

Dropdown with device presets + always-editable width/height fields:

```
[ iPhone 16  ▾ ]  [ 390 ] x [ 844 ]
```

Presets:
- iPhone 16: 390 x 844
- iPhone 16 Pro Max: 430 x 932
- iPad: 768 x 1024
- iPad Pro: 1024 x 1366
- Desktop: 1440 x 900
- Desktop Wide: 1920 x 1080
- Custom (just edit the fields)

Picking a preset fills the fields. Editing fields directly sets "Custom". Dimensions saved per screen: `"viewport": { "width": 390, "height": 844 }`.

### Zoom controls (in toolbar)

- Fit to window (default)
- 100% actual pixels
- +/- buttons for manual zoom
- Zoom only changes `transform: scale()` — never changes wireframe dimensions

### Canvas background color

- User-configurable, stored in `localStorage`
- Default: `#1e1e1e` (dark neutral)
- Not per-project — it's a display preference

---

## 2. Project model + persistence

### project.js — in-memory state manager

Manages the project object in memory. Does NOT perform file I/O — all saves go through `sync.js` → daemon.

**Create:**
- Builds a new project object with label and empty screens
- Sends to daemon via `sync.js` to save to `~/Documents/Frank/<label>.frank.json`

**Load:**
- Receives project JSON from daemon (daemon reads the file)
- Validates schema, populates in-memory state
- On validation failure: show error, don't crash

**Mutations:**
- All CRUD operations update the in-memory project, then call `sync.save(project)` which sends the full project to the daemon for atomic write
- Auto-save on every mutation — no manual save button, no "unsaved changes" state

**Screen CRUD:**
- `addScreen(screen)` — adds to `screens` object + appends to `screenOrder`
- `updateScreen(id, screen)` — replaces screen in `screens` object
- `deleteScreen(id)` — removes from `screens` and `screenOrder`
- `duplicateScreen(id, newLabel)` — copies screen with new ID and label
- `reorderScreens(newOrder)` — replaces `screenOrder`

**Validation on every save:**
- `screenOrder` entries match `screens` keys — orphans cleaned automatically
- Required fields present on each screen

**Screen IDs:**
- Generated as slugs from the label: "Landing Page" → `landing-page`
- If slug already exists, append a number: `landing-page-2`
- AI can explicitly set an `id` field to control this
- **IDs are immutable once created.** Renaming a screen only changes the `label` field, never the ID. This prevents breaking `connections` references.

### Project file format

Same shape in memory as on disk. See DIRECTION.md for the full schema.

Key fields per screen:
- `label`, `platform`, `sections`, `context`, `connections`, `notes`, `viewport`, `stars`
- `viewport`: `{ "width": number, "height": number }` — optional, falls back to platform default

### Storage

- Project files: `~/Documents/Frank/*.frank.json` (managed by daemon)
- Display preferences: `localStorage` (managed by app)
- Flat folder, no nesting, `.frank.json` extension

---

## 3. Screen gallery

### Home view (home.js)

Project picker — shown when no project is open.

- Requests project list from daemon via `sync.js` (daemon reads `~/Documents/Frank/` directory)
- Each project shows: label, last modified date, screen count
- Click to open → daemon loads project, sends to app, switches to gallery view
- "New Project" button → prompts for label, creates project via daemon, opens gallery
- "Archive" action on each project (daemon moves file to `~/Documents/Frank/.archive/`)

### Gallery view (gallery.js)

Shown when a project is open. Two sections:

**Thumbnail grid:**
- All screens as preview cards in a responsive grid
- Each card: miniature wireframe render (actual renderer at small scale via CSS transform), screen label, platform badge
- Click card → opens editor for that screen
- Drag cards to reorder → updates `screenOrder`, auto-saves
- "+" card at the end → creates new empty screen, opens editor
- Right-click/menu: duplicate, delete, rename

**Thumbnail rendering performance:**
- Thumbnails render lazily — only screens visible in the viewport are rendered
- Initial load shows a placeholder card (label + platform badge) while the full render completes
- Renders are staggered (one per frame via `requestAnimationFrame`) to avoid freezing on large projects
- Once rendered, thumbnail DOM is cached and reused until the screen's sections change

**Flow map (flow-map.js):**
- Below the thumbnail grid
- Simple node graph: boxes (screen labels) connected by arrows (from `connections`)
- Screens with no connections shown as unconnected nodes
- Click a box → opens editor for that screen
- Read-only — connections are defined in the editor, not the flow map

**Flow map layout:**
- Automatic left-to-right layout based on connection order
- First screen in `screenOrder` is placed leftmost
- Connected screens flow right; unconnected screens stack below
- Straight-line arrows between boxes (no orthogonal routing — keep it simple)
- No manual node dragging — layout is deterministic from the data
- For projects with 10+ screens, the flow map becomes scrollable horizontally

### View router (workspace.js)

Simple state-based routing. The workspace maintains a `currentView` state:

```
home → gallery → editor → (back to gallery)
```

View switching is a function call that swaps the visible view container. No URL routing, no history API — it's a native app, not a web page.

Navigation:
- `[← Projects]` in toolbar → home view
- `[← Gallery]` in editor toolbar → gallery view
- Click screen card in gallery → editor view

---

## 4. Bidirectional AI communication

### Single writer principle

**The daemon is the sole writer of project files.** The app never writes to disk directly. This eliminates race conditions between the app and daemon.

### Data flow 1: AI creates/updates a screen

```
AI writes single screen → /tmp/frank/render-*.json
  → daemon detects (FSEvents, existing watcher)
  → daemon checks: is there an active project?
    → yes: merge into project file
      → screen ID matches existing? replace that screen
      → new ID? add to screens + append to screenOrder
      → atomic write to project file
    → no: create new project in ~/Documents/Frank/
      → use screen label as project label
      → single screen project
  → daemon sends updated project to app via WebSocket
  → app re-renders current view
```

The AI only writes single-screen schemas (same format as today). The daemon handles merging into the project. This keeps the AI's job simple and the merge logic centralized.

### Data flow 2: User edits in the app

```
User makes a change (drag, delete, etc.)
  → app updates project in memory (project.js)
  → app sends full updated project to daemon via WebSocket (sync.js)
  → daemon does atomic write to project file
  → daemon sends confirmation back to app
  → AI reads updated file on its next turn
```

No echo prevention needed — the daemon only writes when explicitly told to by the app or when it merges an AI screen. There's no FSEvents-triggered echo loop because the app doesn't watch the file; it only receives updates via WebSocket.

### Data flow 3: Active project tracking

```
User switches project in home view
  → app sends "project-changed" message via WebSocket with file path
  → daemon updates its internal active project reference
  → daemon rewrites CLAUDE.md injection block with new path:
    "Active project: ~/Documents/Frank/My App.frank.json"
  → AI's next turn reads the correct file
```

The CLAUDE.md injection (already managed by `frank start` / `frank stop`) gains one new dynamic line: the active project path. Updated on project switch.

### Daemon changes (server.ts)

Today the daemon:
- Watches `/tmp/frank/` for new schema files
- Sends schemas to the app via WebSocket

Tomorrow the daemon also:
- Manages `~/Documents/Frank/` — creates directory, reads project list, reads/writes project files
- Merges single screens from `/tmp/frank/` into the active project file
- Tracks active project and updates CLAUDE.md injection
- Accepts bidirectional WebSocket messages from the app:
  - `save-project` — write project to disk
  - `list-projects` — return directory listing
  - `load-project` — read and return a project file
  - `create-project` — create new project file
  - `project-changed` — update active project tracking
  - `archive-project` — move to .archive/

### sync.js (app side)

WebSocket client that:
- Connects to `ws://localhost:42069` (same as today)
- Receives project updates from daemon → updates app state → re-renders
- Sends mutations to daemon for saving (all file I/O goes through here)
- Sends `project-changed` on project switch
- Provides async API: `sync.save(project)`, `sync.listProjects()`, `sync.loadProject(path)`, etc.

---

## 5. Editor view

### Layout

```
┌─ toolbar ────────────────────────────────────────────────┐
│ [← Gallery]  Landing Page  [iPhone 16 ▾] [390]x[844]    │
│ [Undo] [Redo]  [☆ Star]  [Zoom: Fit ▾]  [Share]         │
├──────────────────────────────────────┬───────────────────┤
│                                      │  Comments         │
│    canvas background                 │                   │
│                                      │  Sara             │
│      ┌─ wireframe ─┐                │  "Hero copy is    │
│      │  header      │  ← drag       │   good"           │
│      │  stats-row   │  handles      │  [✓] [✗] [Reply]  │
│      │  chart       │               │                   │
│      │  list        │               │  ─────────────    │
│      └──────────────┘                │  + Add note       │
│                                      │                   │
├──────────────────────────────────────┴───────────────────┤
│  Auto-saved • 2 screens • 1 note pending                 │
└──────────────────────────────────────────────────────────┘
```

### Toolbar (toolbar.js)

- Back to gallery
- Screen label (editable — click to rename, updates `label` only, not `id`)
- Viewport picker (dropdown + editable dimensions)
- Undo / Redo buttons (disabled when stack is empty)
- Star button (☆ → ★ N when stars exist, dropdown to view/restore)
- Zoom controls (Fit / 100% / +/-)
- Share button (Phase 3, disabled until then)

### Canvas area

- `canvas.js` manages the background + zoom transform
- `screen.js` renders the wireframe at fixed dimensions inside the canvas
- `render/sections.js` draws each section (ported from v0, unchanged)

### Drag to reorder

- Each section shows a subtle grab handle on hover (left edge, 6-dot grip icon)
- Drag up/down to reorder sections within the wireframe
- On drop: update `sections` array in the screen, auto-save, push to undo stack
- Visual feedback: dragged section shows a drop indicator line between sections
- **Implementation:** Pointer events (not HTML5 Drag and Drop) for better control. `pointerdown` on grab handle starts drag, `pointermove` updates position, `pointerup` commits.
- **Zoom-awareness:** Pointer coordinates are divided by the current zoom scale factor to get the correct position within the wireframe. The canvas component exposes `getScale()` for this.

### Comment panel (comments.js)

- Right side panel, collapsible via toggle
- Shows all notes for the current screen
- Each note: author name, timestamp, text, section reference
- Actions per note: approve (✓), dismiss (✗), reply
- Replies are local-only in v1 (stored in project file, visible to AI, not sent to reviewer)
- "Add note" at the bottom for local notes (you adding notes to yourself/AI)
- **Local author name:** Pulled from `git config user.name` on first launch (daemon reads it). Falls back to "You" if not set.

### Undo / redo (undo.js)

- 10-state stack per screen
- Every action pushes the previous `sections` array onto the stack
- Undo: pop stack, restore sections, auto-save
- Redo: push current to redo stack, pop undo stack
- Stack is in-memory only — doesn't persist across app restarts
- Stars are separate from undo — permanent, not in the stack

### Stars (stars.js)

- Star the current screen state → stores a snapshot: `{ label, ts, sections }`
- Stored in the screen object: `"stars": [...]`
- Stars persist (they're in the project file)
- Restore a star → pushes current state to undo stack first, then replaces sections
- Stars are permanent — only deleted manually
- Star button in toolbar shows count, dropdown lists stars with label + timestamp

---

## 6. Design direction

### Visual style

- Dark by default — native macOS dark mode aesthetic
- Reference: Agentation's app UI
- Minimal chrome — wireframe is the focus, UI stays out of the way
- Monochrome with one accent color for interactive elements
- Subtle borders and separators, not heavy dividers
- Clean typography hierarchy — larger for labels, smaller for metadata

### Tokens (tokens.css)

```css
--bg-app: #0d0d0d;
--bg-surface: #1a1a1a;
--bg-elevated: #242424;
--border: #2a2a2a;
--text-primary: #e8e8e8;
--text-secondary: #888;
--text-muted: #555;
--accent: #4a9eff;
--accent-hover: #6ab0ff;
--danger: #ff4a4a;
--success: #4aff8b;
```

These are starting points — will be refined during implementation.

---

## Build order

1. Archive `ui/` → `ui-v0/`
2. Update daemon (`server.ts`) — add WebSocket message handling for project operations (save, load, list, create). This must come first because the app depends on it for all file I/O.
3. Build `sync.js` — WebSocket client with async API for project operations. This is needed by everything else.
4. Scaffold new `ui/` with `index.html`, `workspace.js`, styles directory
5. Port rendering engine (`sections.js`, `smart-item.js`, `icons.js`, `validate.js`) from v0
6. Build `canvas.js` + `screen.js` — fixed viewport rendering with zoom
7. Build `project.js` — in-memory project model with validation and screen CRUD
8. Build `home.js` — project picker view
9. Build `gallery.js` — thumbnail grid (lazy rendering) + flow map (auto-layout)
10. Build `editor.js` — canvas + wireframe + toolbar + viewport picker
11. Build `comments.js` — comment panel
12. Build drag to reorder (in `editor.js`) + `undo.js`
13. Build `stars.js` — snapshot management
14. Add daemon merge logic — single screens from `/tmp/frank/` merged into active project
15. Update CLAUDE.md injection — add active project path
16. Integration testing — full flow: AI writes screen → appears in app → user edits → AI sees changes

---

## Success criteria

- Wireframes render at fixed device dimensions, not fluid
- Canvas background is visible around the wireframe, zoom works
- Viewport picker allows device presets and custom dimensions
- Projects save and load from `~/Documents/Frank/*.frank.json`
- Screen gallery shows all screens with accurate thumbnails (lazy rendered)
- Flow map shows screen connections with auto-layout
- AI writes a screen → it appears in the active project
- User drags a section → AI sees the updated schema on next turn
- Undo/redo works for drag and other mutations
- Stars capture and restore screen states
- Screen IDs are immutable — renaming doesn't break connections
- All file I/O goes through the daemon — no race conditions
- The app looks and feels like a native macOS tool

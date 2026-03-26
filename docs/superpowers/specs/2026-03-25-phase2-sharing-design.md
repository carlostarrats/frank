# Phase 2 — Sharing + Section-Level Comments Design Spec

Date: 2026-03-25
Status: Approved (review pass 1 complete)
Builds on: Phase 1 foundation, DIRECTION.md

---

## Overview

Add section-level comments to the editor and build the sharing system: a share viewer page for reviewers, a mock backend for storing shares/notes, daemon-driven note sync, cover notes, and guided feedback prompts.

---

## 1. Section-level comments (editor)

### Interaction

- Hover over any section in the wireframe → subtle highlight border (2px dashed `var(--accent)` with low opacity)
- Click a section → "selected" state (solid blue outline stays). Section index stored in editor state.
- Comment panel on the right filters to show only comments for the selected section
- "Add a note" textarea anchors to the selected section — note gets `section: <index>`
- Click canvas background (not a section) → deselect, comment panel shows all comments
- Each comment displays its section reference: "on Stats Row", "on Chart", etc.

### Data model

No schema changes. The existing note format already has a `section` field:
```json
{ "id": "n1", "author": "Sara", "section": 2, "text": "...", "ts": "...", "status": null }
```

Currently `section` is always `null`. With this change, it gets populated with the section index when a section is selected during comment creation.

### Files to modify

- `ui/views/editor.js` — add section click handlers, selection state, highlight CSS
- `ui/components/comments.js` — filter by selected section, show section label on each note
- `ui/styles/workspace.css` — section hover/selected styles

---

## 2. Share viewer

### What it is

A standalone HTML page at `ui/viewer/index.html` that renders a shared prototype for reviewers. No editor chrome, no project management — just the wireframe + commenting.

### Structure

```
ui/viewer/
├── index.html      # Entry point — loads viewer.js
├── viewer.js       # Fetch share data, render wireframe, handle comments
└── viewer.css      # Viewer-specific styles (cover note toast, comment overlay)
```

The viewer reuses the rendering engine from `ui/render/` — same `sections.js`, `screen.js`, `smart-item.js`, `icons.js`. It imports them directly.

### Layout

```
┌─ cover note toast ────────────────────────────────────┐
│  "Focus on the payment screen, rest is rough." — Carlos  [×] │
└───────────────────────────────────────────────────────┘

┌─ screen nav (if multiple screens) ────────────────────┐
│  [Landing Page]  [Sign Up]  [Dashboard ●]             │
└───────────────────────────────────────────────────────┘

┌─ wireframe ──────────────────────┬─ comments ─────────┐
│                                  │  Sara on Stats Row  │
│  (full-size rendered wireframe)  │  "Add conversion    │
│  (sections are clickable)        │   rate"             │
│                                  │                     │
│                                  │  [+ Add comment]    │
│                                  │  How does this feel? │
│                                  │  What's missing?     │
│                                  │  What would you      │
│                                  │  change?             │
└──────────────────────────────────┴─────────────────────┘
```

### Reviewer flow

1. Open `http://localhost:42068/viewer/?id=abc123`
2. Viewer fetches `GET /api/share/abc123` — gets project JSON + notes + cover note
3. Wireframe renders at full size (same renderer)
4. Cover note appears as a toast bar at top (if present)
5. Click X on toast → collapses to a "📌 Note" pill in the corner. Click pill → expands back. Never fully disappears.
6. If multiple screens → nav bar at top to switch
7. Click a section → comment input appears in side panel, anchored to that section
8. First comment → name prompt (inline input, stored in localStorage)
9. Type comment → submit. Saved via `POST /api/note`
10. Guided feedback prompt buttons appear below the textarea (optional, pre-fill text)

### Error states

- **Expired link:** Centered message: "This prototype has been updated. Ask the owner for the new link." No wireframe rendered, no comment panel.
- **Invalid/not found link:** Centered message: "This link doesn't exist. Check the URL and try again."
- **Network error:** "Unable to load. Check your connection and refresh."

### Guided feedback prompts

Below the comment textarea, three optional buttons:
- "How does this feel?"
- "What's missing?"
- "What would you change?"

Clicking one pre-fills the textarea. Reviewer can edit or add to it. Not required — just shortcuts for better feedback.

The three prompts are hardcoded (not customizable by the share creator). Always the same three for consistency.

---

## 3. Share flow (editor)

### Share button

The "Share" button in the editor toolbar (currently disabled) becomes active.

**First share (no active link):**
1. Click "Share" → inline popover appears below the button
2. Cover note textarea (optional): "Any context for the reviewer?"
3. "Create Link" button
4. Click "Create Link" → daemon sends project to mock backend → returns share ID
5. Popover updates: shows URL + "Copy" button
6. URL auto-copied to clipboard
7. `activeShare` updated in project file: `{ id, revokeToken, createdAt, expiresAt, coverNote, lastSyncedNoteId: null, unseenNotes: 0 }`

**Re-share (active link exists):**
1. Click "Share" → popover shows:
   - Current URL + "Copy Link" button
   - Cover note field (editable)
   - "Update Link" button (revokes old, creates new)
2. Click "Update Link" → button shows loading state ("Updating..."), then URL field updates with new URL, auto-copied to clipboard. Same behavior as first share but in-place update.

**One active link per project.** Re-sharing kills the old link instantly.

### Files to modify

- `ui/components/toolbar.js` — enable Share button, add popover
- `ui/core/sync.js` — add `createShare()`, `getShare()` methods
- `ui/styles/workspace.css` — share popover styles

---

## 4. Mock backend

### HTTP endpoints on the daemon (port 42068)

The daemon already serves static files on port 42068. Add three API routes:

```
POST /api/share
  Body: { project, coverNote, revokeToken? }
  Returns: { shareId, revokeToken, url }
  Action: If revokeToken provided (re-share), validates it against existing share, deletes old.
          Generates 12+ char random ID + new revokeToken.
          Saves project JSON + metadata to ~/.frank/shares/<id>.json.
          Expiry always 7 days (no UI picker — hardcoded).

GET /api/share/:id
  Returns: { project, notes, coverNote, metadata }
  Or: { error: "expired", message: "This prototype has been updated. Ask the owner for the new link." }
  Or: { error: "not found" }

POST /api/note
  Body: { shareId, screenId, section, author, text }
  Returns: { note }
  Action: Validates note length ≤ 2,000 chars, max 100 notes per share.
          Appends note to the share's notes array.
```

### Storage

```
~/.frank/shares/
├── abc123.json    # { project, notes: [...], coverNote, createdAt, expiresAt }
├── def456.json
└── ...
```

Each share is a single JSON file. Notes are an array inside the file. This is the mock backend — when we deploy to Vercel later, these become Blob operations. The API shape stays the same.

### Share ID generation

Random 12+ character alphanumeric string (e.g., `a8f3k2x9m7p1`). Generated with `crypto.randomBytes(9).toString('base64url').slice(0, 12)`. Matches DIRECTION.md security requirement of 12+ unguessable chars.

### Expiry

Default: 7 days. Checked on `GET /api/share/:id` — if expired, return error. The share file stays on disk (lazy cleanup, not urgent for mock backend).

### Revocation

When re-sharing, the daemon deletes the old share file and creates a new one. The old share ID immediately returns "not found".

### Files to create/modify

- `daemon/src/shares.ts` — new file: share CRUD operations
- `daemon/src/server.ts` — add HTTP route handling for `/api/*`

---

## 5. Note sync via daemon

### Why the daemon, not the browser

If the browser tab is closed, polling stops. Notes that arrive while you're away would be lost. The daemon runs in the background and handles sync regardless of browser state.

### How it works

1. Daemon tracks which projects have active shares (from `activeShare` in the project file)
2. Every 30 seconds, daemon reads the share file directly from disk (`~/.frank/shares/<id>.json`) — NOT via HTTP. The mock backend is local files, no need for network indirection. (When migrating to Vercel, this becomes an HTTP call to the remote API — the abstraction layer lives in `shares.ts`.)
3. Compares notes by checking `lastSyncedNoteId` — if new notes exist (notes with IDs newer than the last synced), writes them into the correct screen's `notes` array in the `.frank.json` project file. Each note has a `screenId` field that maps it to the right screen.
4. Updates `activeShare.lastSyncedNoteId` and increments `activeShare.unseenNotes` for each new note
5. If browser is open, daemon pushes a `notes-updated` WebSocket message → editor refreshes comment panel
6. On daemon startup, sync all active shares immediately (catch up on missed notes)

### Notification badge

- `activeShare.unseenNotes` tracks count of unread reviewer notes
- When the editor renders, the Share button shows a badge: "Share (2)"
- Opening the comment panel marks notes as seen (resets `unseenNotes` to 0, saves to project file)
- The home view project cards also show a badge if there are unseen notes

### NotesUpdatedMessage (WebSocket)

```ts
interface NotesUpdatedMessage {
  type: 'notes-updated';
  screenId: string;
  notes: Array<{ id: string; author: string; screenId: string; section: number | null; text: string; ts: string; }>;
}
```

Added to `PanelMessage` union in `protocol.ts`.

### Files to modify

- `daemon/src/server.ts` — add polling loop, note sync logic
- `daemon/src/projects.ts` — add note merge function
- `daemon/src/protocol.ts` — add `NotesUpdatedMessage` type
- `ui/components/toolbar.js` — show badge on Share button
- `ui/views/home.js` — show badge on project cards

---

## 6. Cover note toast (share viewer)

### Behavior

- When share has a cover note → toast bar appears at top of viewer on load
- Full-width bar: muted background, cover note text, author name, X button
- Click X → toast collapses to a small pill/button in the top-right corner with a pin icon (using `icon('pin')` from `icons.js`) + "Note" label
- Click pill → toast expands back to full bar
- State stored in sessionStorage (so refreshing the page re-shows the toast)
- Never fully disappears — always accessible

### Styles

```css
.viewer-toast { /* full bar */ }
.viewer-toast.collapsed { display: none; }
.viewer-toast-pill { /* small corner indicator */ }
.viewer-toast-pill.hidden { display: none; }
```

---

## 7. Serving the viewer

The daemon's HTTP server needs to handle:
- `/viewer/*` → serve files from `ui/viewer/`
- `/api/*` → API endpoints (share, note)
- Everything else → serve from `ui/` (main app)

The viewer page imports the renderer from `../render/sections.js` etc. using relative paths. This works because the daemon's HTTP server serves `ui/` at the root — so `/viewer/viewer.js` importing `../render/sections.js` resolves to `/render/sections.js` which maps to `ui/render/sections.js`. The routing order in the daemon must be: `/api/*` first, then `/viewer/*`, then catch-all for `ui/`.

---

## Architecture summary

```
Editor (localhost:42068)
  ├── Click section → select → comment anchored to section
  ├── Share button → popover → create/update link
  ├── Comment panel → filtered by section, shows reviewer notes
  └── Share badge → unseen note count

Daemon (Node.js)
  ├── HTTP: serves main app + viewer + API endpoints
  ├── WebSocket: project ops + live note push
  ├── Polls mock backend for new notes
  ├── Writes notes to .frank.json project file
  └── Manages ~/.frank/shares/ directory

Share Viewer (localhost:42068/viewer/?id=xxx)
  ├── Fetches share data via GET /api/share/:id
  ├── Renders wireframe (same engine)
  ├── Section click → comment input
  ├── Guided prompts
  ├── Cover note toast
  └── Posts notes via POST /api/note

Mock Backend (daemon HTTP)
  ├── POST /api/share → create share
  ├── GET /api/share/:id → get share + notes
  └── POST /api/note → add note
```

---

## What stays the same

- Rendering engine unchanged (sections.js, screen.js, etc.)
- Project file format unchanged (notes already have section field)
- WebSocket protocol unchanged (project ops still go through WS)
- Undo/redo, stars, drag — all unchanged
- Canvas, viewport, zoom — all unchanged

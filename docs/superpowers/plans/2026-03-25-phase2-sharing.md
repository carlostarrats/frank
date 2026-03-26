# Phase 2 — Sharing + Section-Level Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add section-level comments, a share viewer for reviewers, a mock backend, daemon-driven note sync, cover notes, and guided feedback prompts.

**Architecture:** The mock backend is local JSON files managed by the daemon. The share viewer is a standalone HTML page using the same rendering engine. Note sync runs in the daemon (not the browser) so it works when the app is closed. Section-level comments use the existing note `section` field.

**Tech Stack:** Plain JS ES modules (no build step), Node.js daemon with HTTP + WebSocket, local JSON file storage for shares.

**Spec:** `docs/superpowers/specs/2026-03-25-phase2-sharing-design.md`

---

## Task 1: Mock backend — shares.ts

Create the share storage module in the daemon.

**Files:**
- Create: `daemon/src/shares.ts`

- [ ] **Step 1: Create shares.ts**

```ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const SHARES_DIR = path.join(process.env.HOME || '', '.frank', 'shares');

function ensureSharesDir(): void {
  fs.mkdirSync(SHARES_DIR, { recursive: true });
}

function generateId(): string {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

export function createShare(project: unknown, coverNote: string, oldRevokeToken?: string, oldShareId?: string): { shareId: string; revokeToken: string; url: string } {
  ensureSharesDir();

  // Revoke old share if provided
  if (oldShareId && oldRevokeToken) {
    const oldPath = path.join(SHARES_DIR, `${oldShareId}.json`);
    if (fs.existsSync(oldPath)) {
      const old = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
      if (old.revokeToken === oldRevokeToken) {
        fs.unlinkSync(oldPath);
      }
    }
  }

  const shareId = generateId();
  const revokeToken = generateId();
  const share = {
    project,
    coverNote: coverNote || '',
    notes: [],
    revokeToken,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };

  const filePath = path.join(SHARES_DIR, `${shareId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(share, null, 2), 'utf8');

  return { shareId, revokeToken, url: `/viewer/?id=${shareId}` };
}

export function getShare(shareId: string): { project: unknown; notes: unknown[]; coverNote: string; metadata: unknown } | { error: string; message?: string } {
  ensureSharesDir();
  const filePath = path.join(SHARES_DIR, `${shareId}.json`);

  if (!fs.existsSync(filePath)) {
    return { error: 'not found' };
  }

  const share = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (new Date(share.expiresAt) < new Date()) {
    return { error: 'expired', message: 'This prototype has been updated. Ask the owner for the new link.' };
  }

  return {
    project: share.project,
    notes: share.notes || [],
    coverNote: share.coverNote || '',
    metadata: { createdAt: share.createdAt, expiresAt: share.expiresAt },
  };
}

export function addNote(shareId: string, note: { screenId: string; section: number | null; author: string; text: string }): { note: unknown } | { error: string } {
  ensureSharesDir();
  const filePath = path.join(SHARES_DIR, `${shareId}.json`);

  if (!fs.existsSync(filePath)) return { error: 'not found' };

  const share = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (new Date(share.expiresAt) < new Date()) return { error: 'expired' };
  if ((share.notes || []).length >= 100) return { error: 'max notes reached' };
  if (note.text.length > 2000) return { error: 'note too long' };

  const newNote = {
    id: 'n' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
    screenId: note.screenId,
    section: note.section,
    author: note.author,
    text: note.text,
    ts: new Date().toISOString(),
  };

  share.notes = share.notes || [];
  share.notes.push(newNote);
  fs.writeFileSync(filePath, JSON.stringify(share, null, 2), 'utf8');

  return { note: newNote };
}

export function readShareFile(shareId: string): { notes?: Array<{ id: string; screenId: string; section: number | null; author: string; text: string; ts: string }>; [key: string]: unknown } | null {
  const filePath = path.join(SHARES_DIR, `${shareId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

- [ ] **Step 3: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add daemon/src/shares.ts
git commit -m "feat: mock backend — shares.ts with create, get, addNote, readShareFile"
```

---

## Task 2: HTTP API routes in daemon

Add `/api/*` route handling to the daemon's HTTP server.

**Files:**
- Modify: `daemon/src/server.ts` — add API route handling before static file serving
- Modify: `daemon/src/protocol.ts` — add NotesUpdatedMessage type

- [ ] **Step 1: Update protocol.ts**

Add to protocol.ts:

```ts
export interface NotesUpdatedMessage {
  type: 'notes-updated';
  screenId: string;
  notes: Array<{ id: string; author: string; screenId: string; section: number | null; text: string; ts: string; }>;
}
```

Update the `PanelMessage` union to include `NotesUpdatedMessage`.

- [ ] **Step 2: Add API routes to server.ts**

Read the current `server.ts` HTTP server code. The HTTP server currently serves static files. Add API route handling BEFORE the static file handler. Parse the URL and method:

- `POST /api/share` → parse JSON body, call `createShare()`, return JSON response
- `GET /api/share/:id` → extract ID from URL, call `getShare()`, return JSON response
- `POST /api/note` → parse JSON body, call `addNote()`, return JSON response

For POST routes, read the request body:
```ts
function readBody(req): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}
```

Route matching: check `req.url` starts with `/api/`. Parse with `new URL(req.url, 'http://localhost')`.

**CRITICAL: After handling an API route, `return` immediately.** Do not let execution fall through to the static file handler, or both will try to write to `res`.

Return JSON with `res.writeHead(200, { 'Content-Type': 'application/json' })` and `res.end(JSON.stringify(data))`.

The POST body for `/api/share` uses fields `{ project, coverNote, oldRevokeToken?, oldShareId? }`. Map these to `createShare(project, coverNote, oldRevokeToken, oldShareId)`.

Also add CORS headers for the viewer (same origin, but good practice):
```ts
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
```

Handle OPTIONS preflight requests with 204 response.

- [ ] **Step 3: Build and test**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

Test with curl:
```bash
# Create a share
curl -X POST http://localhost:42068/api/share -H "Content-Type: application/json" -d '{"project":{"test":true},"coverNote":"Test note"}'

# Get the share (use the ID from above)
curl http://localhost:42068/api/share/SHARE_ID

# Add a note
curl -X POST http://localhost:42068/api/note -H "Content-Type: application/json" -d '{"shareId":"SHARE_ID","screenId":"home","section":0,"author":"Test","text":"Looks good"}'
```

- [ ] **Step 4: Commit**

```bash
git add daemon/src/server.ts daemon/src/protocol.ts
git commit -m "feat: HTTP API routes — /api/share and /api/note endpoints"
```

---

## Task 3: Section-level comments in editor

Add section click-to-select and filtered comments.

**Files:**
- Modify: `ui/views/editor.js` — section click handlers, selection state
- Modify: `ui/components/comments.js` — filter by section, show section label
- Modify: `ui/styles/workspace.css` — hover/selected styles

- [ ] **Step 1: Add section selection to editor.js**

Read the current `editor.js`. Add `selectedSection` at the module level (alongside `currentCanvas` and `currentToolbar`), so both `setupSectionSelection` and `refreshComments` can access it:

```js
let selectedSection = null; // null = show all, number = section index (module-level, not inside a function)

function setupSectionSelection(screenId) {
  const canvasContent = currentCanvas.content;
  const screen = projectManager.getScreen(screenId);

  // IMPORTANT: In web layouts with sidebars, screen.js reorders sections (sidebar extracted,
  // header moved into main). We need to map DOM elements back to original section indices.
  // Add data-section-index attributes during rendering, or find sections by type matching.
  // Safest approach: query all elements with [data-section-index] attribute.
  // This requires screen.js to add data-section-index="N" to each rendered section wrapper.
  // Alternatively, match by section type class (.wf-section--header, .wf-section--sidebar, etc.)

  const sectionEls = canvasContent.querySelectorAll('[data-section-index]');
  // If data-section-index not available (renderer not updated yet), fall back to .wf-section
  const fallbackEls = sectionEls.length > 0 ? sectionEls : canvasContent.querySelectorAll('.wf-section');

  fallbackEls.forEach((section, domIndex) => {
    const sectionIndex = section.dataset?.sectionIndex != null ? parseInt(section.dataset.sectionIndex) : domIndex;
    section.style.cursor = 'pointer';
    section.addEventListener('click', (e) => {
      e.stopPropagation();
      fallbackEls.forEach(s => s.classList.remove('section-selected'));
      section.classList.add('section-selected');
      selectedSection = sectionIndex;
      refreshComments();
    });
  });

  // Click canvas background to deselect
  canvasContent.addEventListener('click', (e) => {
    if (e.target === canvasContent || e.target.closest('.wireframe') === e.target) {
      sectionEls.forEach(s => s.classList.remove('section-selected'));
      selectedSection = null;
      refreshComments();
    }
  });
}
```

Call `setupSectionSelection(screenId)` after `setupDragHandles(screenId)`.

Pass `selectedSection` to `refreshComments()` — update the refreshComments function to pass it through.

- [ ] **Step 2: Update comments.js — filter by section**

Read current `comments.js`. Modify `renderComments` to accept a `selectedSection` parameter. When `selectedSection !== null`:
- Filter notes to only show those where `note.section === selectedSection`
- Show a "Viewing: [section type]" label at the top of the panel
- The "Add a note" input creates notes with `section: selectedSection`

When `selectedSection === null`:
- Show all notes (current behavior)
- Notes with a section show "on [section type]" label

To get the section type name: read it from the screen's sections array: `screen.sections[index]?.type || 'Section ' + index`.

- [ ] **Step 2.5: Add data-section-index to screen.js**

Modify `ui/render/screen.js` to add `data-section-index="N"` attribute to each section wrapper. In the `renderScreen` function, where sections are mapped to HTML, add the attribute:

```js
// In the sections.map() call, add data-section-index to each wrapper:
`<div data-section-index="${i}" ${fillStyle} class="wf-section wf-section--${section.type}">${content}</div>`
```

This ensures section click handlers can always map back to the correct index in `screen.sections[]`, even when the DOM layout reorders sections (e.g., sidebar extracted in web layouts).

- [ ] **Step 3: Add CSS for section hover/selection**

Append to `ui/styles/workspace.css`:

```css
/* Section selection */
.wf-section { transition: outline 0.1s, outline-offset 0.1s; }
.wf-section:hover { outline: 2px dashed rgba(74, 158, 255, 0.3); outline-offset: 2px; }
.wf-section.section-selected { outline: 2px solid var(--accent); outline-offset: 2px; }
```

- [ ] **Step 4: Test**

Open the app, navigate to a screen with sections (e.g., the credit dashboard). Click on a section — it should highlight. Comment panel should filter. Click canvas background — should deselect and show all comments.

- [ ] **Step 5: Commit**

```bash
git add ui/views/editor.js ui/components/comments.js ui/styles/workspace.css
git commit -m "feat: section-level comments — click to select, filtered comment panel"
```

---

## Task 4: Share popover in toolbar

Enable the Share button and add the share popover.

**Files:**
- Modify: `ui/components/toolbar.js` — enable Share, add popover
- Modify: `ui/core/sync.js` — add createShare(), getShareUrl() methods
- Modify: `ui/styles/workspace.css` — popover styles

- [ ] **Step 1: Add share methods to sync.js**

Read current `sync.js`. Add two methods to the sync object:

```js
async createShare(project, coverNote, oldRevokeToken, oldShareId) {
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, coverNote, oldRevokeToken, oldShareId }),
  });
  return res.json();
},

async getShareNotes(shareId) {
  const res = await fetch(`/api/share/${shareId}`);
  return res.json();
},
```

Note: these use HTTP fetch, not WebSocket, because the API endpoints are HTTP.

Also add a `onNotesUpdated` callback to sync.js. In the `ws.onmessage` handler, add:
```js
if (msg.type === 'notes-updated' && onNotesUpdated) {
  onNotesUpdated(msg);
}
```
And in the sync object:
```js
onNotesUpdated(cb) { onNotesUpdated = cb; },
```
Add `let onNotesUpdated = null;` at module level alongside the other callbacks.

- [ ] **Step 2: Add share popover to toolbar.js**

Read current `toolbar.js`. Enable the Share button (remove `disabled`). Add click handler that shows an inline popover:

The popover is a div positioned below the Share button. It contains:
- If no active share: cover note textarea + "Create Link" button
- If active share: URL display + "Copy Link" button + cover note textarea + "Update Link" button

On "Create Link":
1. Call `sync.createShare(projectManager.get(), coverNote)`
2. Update popover to show URL
3. Copy URL to clipboard: `navigator.clipboard.writeText(fullUrl)`
4. Update project's `activeShare`: `projectManager.updateActiveShare({ id, revokeToken, ... })`

Add `updateActiveShare(share)` to project.js — sets `project.activeShare = share` and saves.

On "Copy Link": `navigator.clipboard.writeText(url)`

On "Update Link": same as Create but passes old revokeToken.

Close popover on click outside (same pattern as star dropdown).

- [ ] **Step 3: Add to project.js**

Read current `project.js`. Add method:

```js
updateActiveShare(share) {
  if (!project) return;
  project.activeShare = share;
  this.save();
},

getActiveShare() {
  return project?.activeShare || null;
},
```

- [ ] **Step 4: Add popover styles to workspace.css**

```css
/* Share popover */
.share-popover {
  position: fixed;
  z-index: 100;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
  min-width: 320px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.share-popover-url {
  display: flex; gap: 8px; align-items: center; margin-bottom: 12px;
}
.share-popover-url input {
  flex: 1; padding: 6px 10px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--bg-surface);
  color: var(--text-primary); font-size: 12px; font-family: monospace;
}
.share-popover textarea {
  width: 100%; padding: 8px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--bg-surface);
  color: var(--text-primary); font-size: 13px; font-family: inherit;
  resize: none; min-height: 60px; margin-bottom: 8px;
}
.share-popover-actions { display: flex; gap: 8px; justify-content: flex-end; }
```

- [ ] **Step 5: Test**

Open the editor, click Share. Enter a cover note, click "Create Link". Verify URL appears, copied to clipboard. Close popover, reopen — should show existing URL with Copy/Update options.

- [ ] **Step 6: Commit**

```bash
git add ui/components/toolbar.js ui/core/sync.js ui/core/project.js ui/styles/workspace.css
git commit -m "feat: share popover — create link, copy, update with cover note"
```

---

## Task 5: Share viewer — basic wireframe display

Create the viewer page that renders shared prototypes.

**Files:**
- Create: `ui/viewer/index.html`
- Create: `ui/viewer/viewer.js`
- Create: `ui/viewer/viewer.css`

- [ ] **Step 1: Create viewer/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Frank — Shared Prototype</title>
  <link rel="stylesheet" href="../styles/tokens.css">
  <link rel="stylesheet" href="../styles/wireframe.css">
  <link rel="stylesheet" href="viewer.css">
</head>
<body>
  <div id="viewer-app"></div>
  <script type="module" src="viewer.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create viewer/viewer.js**

The viewer:
1. Reads `?id=` from URL params
2. Fetches `GET /api/share/:id`
3. If error → show error message
4. If success → render the wireframe using `renderScreen()` from the shared render engine
5. If multiple screens → show nav bar to switch
6. Cover note → toast bar

```js
import { renderScreen } from '../render/screen.js';

const params = new URLSearchParams(window.location.search);
const shareId = params.get('id');

async function init() {
  const app = document.getElementById('viewer-app');

  if (!shareId) {
    app.innerHTML = '<div class="viewer-error"><h2>No share ID</h2><p>Check the URL and try again.</p></div>';
    return;
  }

  try {
    const res = await fetch(`/api/share/${shareId}`);
    const data = await res.json();

    if (data.error) {
      app.innerHTML = `<div class="viewer-error"><h2>${data.error === 'expired' ? 'Link Expired' : 'Not Found'}</h2><p>${data.message || "This link doesn't exist. Check the URL and try again."}</p></div>`;
      return;
    }

    renderViewer(app, data);
  } catch (e) {
    app.innerHTML = '<div class="viewer-error"><h2>Unable to load</h2><p>Check your connection and refresh.</p></div>';
  }
}

function renderViewer(app, data) {
  const { project, notes, coverNote } = data;
  const screens = project.screenOrder.map(id => ({ id, ...project.screens[id] })).filter(s => s.sections);
  let currentScreenIndex = 0;

  app.innerHTML = `
    ${coverNote ? `
      <div class="viewer-toast" id="viewer-toast">
        <div class="viewer-toast-content">
          <span class="viewer-toast-text">"${escapeHtml(coverNote)}"</span>
          <button class="viewer-toast-close" id="toast-close">×</button>
        </div>
      </div>
      <div class="viewer-toast-pill hidden" id="toast-pill">📌 Note</div>
    ` : ''}
    ${screens.length > 1 ? `
      <div class="viewer-nav" id="viewer-nav">
        ${screens.map((s, i) => `<button class="viewer-nav-btn ${i === 0 ? 'active' : ''}" data-index="${i}">${escapeHtml(s.label || s.id)}</button>`).join('')}
      </div>
    ` : ''}
    <div class="viewer-layout">
      <div class="viewer-wireframe" id="viewer-wireframe"></div>
      <div class="viewer-comments" id="viewer-comments"></div>
    </div>
  `;

  // Render first screen
  renderCurrentScreen();

  // Toast toggle
  const toast = document.getElementById('viewer-toast');
  const pill = document.getElementById('toast-pill');
  document.getElementById('toast-close')?.addEventListener('click', () => {
    toast?.classList.add('collapsed');
    pill?.classList.remove('hidden');
  });
  pill?.addEventListener('click', () => {
    toast?.classList.remove('collapsed');
    pill?.classList.add('hidden');
  });

  // Screen nav
  document.getElementById('viewer-nav')?.querySelectorAll('.viewer-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentScreenIndex = parseInt(btn.dataset.index);
      document.querySelectorAll('.viewer-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCurrentScreen();
    });
  });

  function renderCurrentScreen() {
    const screen = screens[currentScreenIndex];
    if (!screen) return;
    const wireframeEl = document.getElementById('viewer-wireframe');
    wireframeEl.innerHTML = renderScreen(screen);
    setupSectionClicks(wireframeEl, screen, currentScreenIndex);
    renderComments(screens[currentScreenIndex], notes);
  }

  function setupSectionClicks(container, screen, screenIndex) {
    // Section click for commenting — implemented in Task 6
  }

  function renderComments(screen, allNotes) {
    // Comment panel — implemented in Task 6
    const commentsEl = document.getElementById('viewer-comments');
    const screenNotes = allNotes.filter(n => n.screenId === screens[currentScreenIndex]?.id);
    commentsEl.innerHTML = `
      <div class="viewer-comments-inner">
        <h3 class="viewer-comments-title">Comments (${screenNotes.length})</h3>
        <div class="viewer-comments-list">
          ${screenNotes.length === 0 ? '<p class="viewer-comments-empty">Click a section to add a comment</p>' : ''}
          ${screenNotes.map(n => `
            <div class="viewer-comment">
              <span class="viewer-comment-author">${escapeHtml(n.author)}</span>
              ${n.section !== null ? `<span class="viewer-comment-section">on ${escapeHtml(screen.sections?.[n.section]?.type || 'Section')}</span>` : ''}
              <p class="viewer-comment-text">${escapeHtml(n.text)}</p>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

init();
```

- [ ] **Step 3: Create viewer/viewer.css**

Styles for the viewer layout, toast, nav, error states, and comment panel. Match the dark theme from tokens.css but with a clean, minimal reviewer experience.

- [ ] **Step 4: Test**

Create a share via the editor's Share button (or curl), then open `http://localhost:42068/viewer/?id=SHARE_ID` in a new tab. Verify the wireframe renders, cover note toast works, screen nav works (if multiple screens).

- [ ] **Step 5: Commit**

```bash
git add ui/viewer/
git commit -m "feat: share viewer — renders shared prototypes with toast and screen nav"
```

---

## Task 6: Viewer commenting — section click + guided prompts

Add commenting to the share viewer.

**Files:**
- Modify: `ui/viewer/viewer.js` — section click handlers, comment form, guided prompts, name prompt

- [ ] **Step 1: Implement section click + comment form**

In the viewer's `setupSectionClicks` function, add click handlers to each `.wf-section` element. On click, show the comment input in the side panel, anchored to that section. Include the name prompt (first comment asks for name, stored in localStorage).

- [ ] **Step 2: Add guided feedback prompts**

Below the comment textarea, add three buttons:
```html
<div class="viewer-prompts">
  <button class="viewer-prompt-btn" data-prompt="How does this feel?">How does this feel?</button>
  <button class="viewer-prompt-btn" data-prompt="What's missing?">What's missing?</button>
  <button class="viewer-prompt-btn" data-prompt="What would you change?">What would you change?</button>
</div>
```

Clicking a prompt pre-fills the textarea.

- [ ] **Step 3: Submit notes via POST /api/note**

On comment submit:
```js
const res = await fetch('/api/note', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ shareId, screenId: currentScreen.id, section: selectedSection, author: authorName, text }),
});
```

After successful submit, refresh the comments list.

- [ ] **Step 4: Add viewer comment styles**

Append to `viewer.css`: comment form, guided prompt buttons, name prompt input, section hover/selected styles within the viewer.

- [ ] **Step 5: Test**

Open the viewer, click a section, type a comment, submit. Verify it appears in the comments list. Try the guided prompts. Refresh the page — comment should persist (fetched from the share file).

- [ ] **Step 6: Commit**

```bash
git add ui/viewer/viewer.js ui/viewer/viewer.css
git commit -m "feat: viewer commenting — section click, guided prompts, note submission"
```

---

## Task 7: Note sync in daemon

The daemon polls share files and syncs notes into project files.

**Files:**
- Modify: `daemon/src/server.ts` — add sync loop
- Modify: `daemon/src/projects.ts` — add note merge function

- [ ] **Step 1: Add note merge to projects.ts**

Read current `projects.ts`. Add:

```ts
export function mergeNotesIntoProject(projectFilePath: string, shareNotes: Array<{ id: string; screenId: string; section: number | null; author: string; text: string; ts: string }>, lastSyncedNoteId: string | null): { newNotes: typeof shareNotes; lastNoteId: string | null } {
  const content = fs.readFileSync(projectFilePath, 'utf8');
  const project = JSON.parse(content) as Record<string, unknown>;
  const screens = project.screens as Record<string, Record<string, unknown>>;

  // Find notes newer than lastSyncedNoteId
  let startIndex = 0;
  if (lastSyncedNoteId) {
    const idx = shareNotes.findIndex(n => n.id === lastSyncedNoteId);
    if (idx >= 0) startIndex = idx + 1;
  }

  const newNotes = shareNotes.slice(startIndex);
  if (newNotes.length === 0) return { newNotes: [], lastNoteId: lastSyncedNoteId };

  // Merge into correct screens
  for (const note of newNotes) {
    if (screens[note.screenId]) {
      const screen = screens[note.screenId];
      screen.notes = (screen.notes as unknown[]) || [];
      // Don't add duplicates
      const existing = (screen.notes as Array<{ id: string }>);
      if (!existing.find(n => n.id === note.id)) {
        existing.push(note);
      }
    }
  }

  // Update activeShare
  const activeShare = project.activeShare as Record<string, unknown> | null;
  if (activeShare) {
    activeShare.lastSyncedNoteId = newNotes[newNotes.length - 1].id;
    activeShare.unseenNotes = ((activeShare.unseenNotes as number) || 0) + newNotes.length;
  }

  atomicWrite(projectFilePath, JSON.stringify(project, null, 2));
  return { newNotes, lastNoteId: newNotes[newNotes.length - 1].id };
}
```

(Uses the existing `atomicWrite` function already in projects.ts)

- [ ] **Step 2: Add sync loop to server.ts**

In `startServer()`, after starting the file watcher and WebSocket server, start a sync interval:

```ts
import { readShareFile } from './shares.js';
import { mergeNotesIntoProject } from './projects.js';

setInterval(() => {
  syncShareNotes();
}, 30000);

// Also sync on startup
setTimeout(() => syncShareNotes(), 2000);

function syncShareNotes() {
  if (!activeProjectPath) return;
  try {
    const content = fs.readFileSync(activeProjectPath, 'utf8');
    const project = JSON.parse(content);
    const activeShare = project.activeShare;
    if (!activeShare?.id) return;

    const share = readShareFile(activeShare.id);
    if (!share || !share.notes) return;

    const { newNotes, lastNoteId } = mergeNotesIntoProject(
      activeProjectPath,
      share.notes,
      activeShare.lastSyncedNoteId || null
    );

    if (newNotes.length > 0) {
      // Push to connected clients
      for (const note of newNotes) {
        broadcast({ type: 'notes-updated', screenId: note.screenId, notes: [note] });
      }
      console.log(`[frank] synced ${newNotes.length} new note(s) from share ${activeShare.id}`);
    }
  } catch (e) {
    // Silent fail — sync is best-effort
  }
}
```

- [ ] **Step 3: Build and test**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

Test: create a share, add a note via the viewer, wait 30 seconds (or restart daemon), check if the note appears in the project file.

- [ ] **Step 4: Commit**

```bash
git add daemon/src/server.ts daemon/src/projects.ts
git commit -m "feat: daemon note sync — polls shares, merges notes into project file"
```

---

## Task 8: Notification badges

Show unseen note counts in the UI.

**Files:**
- Modify: `ui/components/toolbar.js` — badge on Share button
- Modify: `ui/views/home.js` — badge on project cards
- Modify: `ui/views/editor.js` — handle notes-updated WebSocket message

- [ ] **Step 1: Add badge to Share button in toolbar**

Read current `toolbar.js`. The Share button should show a count badge when `project.activeShare?.unseenNotes > 0`:

```html
<button class="toolbar-btn toolbar-share">Share${unseenNotes > 0 ? ` <span class="toolbar-badge">${unseenNotes}</span>` : ''}</button>
```

Add `toolbar-badge` styles:
```css
.toolbar-badge {
  background: var(--accent); color: #fff; font-size: 10px;
  padding: 1px 5px; border-radius: 8px; margin-left: 4px;
}
```

- [ ] **Step 2: Add badge to home project cards**

Read current `home.js`. When listing projects, check if `project.activeShare?.unseenNotes > 0` and show a badge on the card.

Note: the home view gets projects from `sync.listProjects()` which returns `{ label, filePath, modifiedAt, screenCount }`. The daemon's `listProjects()` in projects.ts needs to also return `unseenNotes`. Update the daemon to include this field.

- [ ] **Step 3: Handle notes-updated in editor**

In `workspace.js` or `editor.js`, listen for `notes-updated` WebSocket messages via `sync.onProjectUpdate`. When received, refresh the comment panel and update the toolbar badge.

- [ ] **Step 4: Mark notes as seen**

When the user opens the comment panel (or clicks on the Share button), reset `unseenNotes` to 0 in the project file.

- [ ] **Step 5: Commit**

```bash
git add ui/components/toolbar.js ui/views/home.js ui/views/editor.js daemon/src/projects.ts
git commit -m "feat: notification badges — unseen note count on Share button and project cards"
```

---

## Task 9: Integration testing

Full end-to-end test of the sharing flow.

**Files:** No new files.

- [ ] **Step 1: Full flow test**

1. Start daemon (`frank start`)
2. Open the app at `localhost:42068`
3. Open/create a project with screens
4. Click a section in the editor → comment panel filters
5. Add a comment on a specific section → verify it shows the section reference
6. Click Share → enter cover note → Create Link
7. Copy the viewer URL
8. Open the viewer URL in a new tab
9. Cover note toast appears → click X → collapses to pill → click pill → expands
10. Click a section → comment form appears with guided prompts
11. Enter name, type comment, submit
12. Switch back to editor tab → wait 30 seconds (or restart daemon) → note appears in comment panel with badge
13. Close editor tab → restart daemon → open editor → note still there (persisted in project file)

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes for Phase 2 sharing flow"
```

---

## Summary

9 tasks:
1. **shares.ts** — mock backend storage module
2. **HTTP API routes** — /api/share and /api/note endpoints
3. **Section-level comments** — click section, filtered panel
4. **Share popover** — create/update/copy link from toolbar
5. **Share viewer** — standalone page rendering shared prototypes
6. **Viewer commenting** — section click, guided prompts, note submission
7. **Note sync** — daemon polls shares, merges into project file
8. **Notification badges** — unseen count on Share button and project cards
9. **Integration testing** — end-to-end verification

Build order ensures dependencies: backend first (1-2), then editor features (3-4), then viewer (5-6), then sync (7-8), then test (9).

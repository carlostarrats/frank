# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Frank as a multi-view workspace with fixed viewports, project persistence, screen gallery, and bidirectional AI communication.

**Architecture:** Clean rebuild. Old `ui/` archived to `ui-v0/`. New `ui/` is a plain JS workspace app. Daemon becomes the sole file writer — the app sends mutations over WebSocket, daemon handles all disk I/O. Rendering engine (`sections.js`, `smart-item.js`, `icons.js`) ported from v0 unchanged. `screen.js` is ported and modified — it already uses plain JS (not ArrowJS), but needs fixed viewport dimensions added.

**Key API note:** The v0 renderer exports `renderSection(section, screenLabel, platform)` (singular) from `sections.js`, and `renderScreen(schema)` from `screen.js` which iterates sections and handles chrome detection / flex-fill logic. These APIs are preserved in the port.

**Tech Stack:** Plain JS ES modules (no build step), Tauri v2 webview, Node.js daemon with WebSocket (ws), CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-03-25-phase1-foundation-design.md`

---

## Task 1: Archive old UI and scaffold new structure

**Files:**
- Move: `ui/` → `ui-v0/`
- Create: `ui/index.html`
- Create: `ui/workspace.js`
- Create: `ui/styles/tokens.css`
- Create: `ui/styles/workspace.css`
- Create: `ui/styles/wireframe.css`

- [ ] **Step 1: Archive old UI**

```bash
mv ui ui-v0
```

- [ ] **Step 2: Create new ui directory structure**

```bash
mkdir -p ui/views ui/render ui/core ui/components ui/styles
```

- [ ] **Step 3: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Frank</title>
  <link rel="stylesheet" href="styles/tokens.css">
  <link rel="stylesheet" href="styles/wireframe.css">
  <link rel="stylesheet" href="styles/workspace.css">
  <link rel="stylesheet" href="styles/flow-map.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="workspace.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create tokens.css with design tokens**

Create `ui/styles/tokens.css` — dark theme tokens, reset, typography utilities. Reference v0's `ui-v0/style.css` for the wireframe tokens (lines 1-80 approximately) but use the new dark palette from the spec:

```css
:root {
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
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
  background: var(--bg-app);
  color: var(--text-primary);
  overflow: hidden;
  height: 100vh;
}

#app { height: 100vh; display: flex; flex-direction: column; }
```

Also include the typography utility classes (`.text-xs` through `.text-2xl`) and spacing utilities (`.gap-1` through `.gap-6`, `.p-2` through `.p-4`) — port these directly from `ui-v0/style.css`.

- [ ] **Step 5: Create workspace.css shell**

Create `ui/styles/workspace.css` with basic layout classes for the workspace views. Start minimal — just the view container and transitions:

```css
.workspace { height: 100vh; display: flex; flex-direction: column; }
.view { display: none; flex: 1; overflow: hidden; }
.view.active { display: flex; flex-direction: column; }
```

- [ ] **Step 6: Create wireframe.css**

Copy the wireframe component classes from `ui-v0/style.css` — everything prefixed with `.wf-` (`.wf-btn`, `.wf-card`, `.wf-input`, `.wf-badge`, `.wf-avatar`, `.wf-switch`, `.wf-separator`, `.wf-label`, `.wf-image-placeholder`). These are the proven wireframe styles — copy as-is.

- [ ] **Step 7: Create workspace.js shell**

```js
// workspace.js — App shell: view router, state management

const state = {
  currentView: 'home', // 'home' | 'gallery' | 'editor'
  project: null,
  activeScreenId: null,
};

function switchView(view, params = {}) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.add('active');
  state.currentView = view;
}

function init() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="workspace">
      <div id="view-home" class="view active"></div>
      <div id="view-gallery" class="view"></div>
      <div id="view-editor" class="view"></div>
    </div>
  `;
  switchView('home');
}

document.addEventListener('DOMContentLoaded', init);

export { state, switchView };
```

- [ ] **Step 8: Verify scaffold loads in browser**

```bash
cd /Users/carlostarrats/Documents/frank && npx serve ui -p 8080
```

Open `http://localhost:8080` — should show a dark background with no errors in console.

- [ ] **Step 9: Commit**

```bash
git add ui-v0 ui docs/superpowers
git commit -m "chore: archive v0 UI, scaffold new workspace structure"
```

---

## Task 2: Port rendering engine from v0

**Files:**
- Create: `ui/render/sections.js` (copy from `ui-v0/sections.js`)
- Create: `ui/render/smart-item.js` (copy from `ui-v0/smart-item.js`)
- Create: `ui/render/icons.js` (copy from `ui-v0/icons.js`)
- Create: `ui/validate.js` (copy from `ui-v0/validate.js`)

- [ ] **Step 1: Copy rendering files**

```bash
cp ui-v0/sections.js ui/render/sections.js
cp ui-v0/smart-item.js ui/render/smart-item.js
cp ui-v0/icons.js ui/render/icons.js
cp ui-v0/screen.js ui/render/screen.js
cp ui-v0/validate.js ui/validate.js
```

Note: `screen.js` is already plain JS (no ArrowJS). It exports `renderScreen(schema)` which iterates sections, handles chrome detection, and applies flex-fill logic. It will be modified in Task 5 to add fixed viewport dimensions, but the core rendering logic is preserved.

- [ ] **Step 2: Fix import paths**

The v0 files use relative imports like `import { classify } from './smart-item.js'`. Since all render files stay in the same `render/` directory, most imports stay as-is:

- `sections.js` imports from `'./smart-item.js'` and `'./icons.js'` — both stay as-is
- `screen.js` imports from `'./sections.js'` — stays as-is
- `validate.js` has no imports — no changes needed

Check each file for any other imports and fix paths if needed.

- [ ] **Step 3: Create a test page to verify rendering works**

Add a temporary test in `workspace.js` using the actual v0 API (`renderScreen` from `screen.js`, which calls `renderSection` internally):

```js
import { renderScreen } from './render/screen.js';

function testRender() {
  const testSchema = {
    schema: 'v1', type: 'screen', label: 'Test', platform: 'web',
    sections: [
      { type: 'header', contains: ['Brand logo wordmark', 'Dashboard nav link', 'Search input', 'User avatar'] },
      { type: 'stats-row', contains: ['Revenue stat card — $84,320 value — +12.4% badge', 'Orders stat card — 1,284 value — +8.1% badge'] },
    ]
  };
  const container = document.getElementById('view-home');
  container.innerHTML = renderScreen(testSchema);
}
```

Call `testRender()` from `init()` temporarily.

- [ ] **Step 4: Verify rendering in browser**

```bash
npx serve ui -p 8080
```

Open `http://localhost:8080` — should show the header and stats-row sections rendered correctly on the dark background.

- [ ] **Step 5: Remove test render code, commit**

Remove the `testRender()` function and import. The rendering engine is confirmed working.

```bash
git add ui/render ui/validate.js
git commit -m "feat: port rendering engine from v0 — sections, smart-item, icons, validate"
```

---

## Task 3: Build sync.js — WebSocket client

The app-side WebSocket client. Built first as a structural module — fully testable after Task 4 (daemon) is complete.

**Files:**
- Create: `ui/core/sync.js`

- [ ] **Step 1: Create sync.js**

```js
// sync.js — WebSocket client. All file I/O goes through the daemon.

const WS_URL = 'ws://localhost:42069';
let ws = null;
let pendingRequests = new Map(); // id → { resolve, reject }
let requestId = 0;
let onProjectUpdate = null; // callback set by workspace

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => console.log('[sync] connected to daemon');

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      // Handle response to a request
      if (msg.requestId && pendingRequests.has(msg.requestId)) {
        const { resolve } = pendingRequests.get(msg.requestId);
        pendingRequests.delete(msg.requestId);
        resolve(msg);
        return;
      }
      // Handle push messages from daemon
      if (msg.type === 'render' && onProjectUpdate) {
        onProjectUpdate(msg);
      }
      if (msg.type === 'project-updated' && onProjectUpdate) {
        onProjectUpdate(msg);
      }
    } catch (e) {
      console.warn('[sync] message parse error:', e);
    }
  };

  ws.onclose = () => {
    console.log('[sync] disconnected, reconnecting in 2s...');
    // Reject all pending requests on disconnect
    for (const [id, { reject }] of pendingRequests) {
      reject(new Error('WebSocket disconnected'));
    }
    pendingRequests.clear();
    setTimeout(connect, 2000);
  };

  ws.onerror = () => {}; // onclose will fire after this
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function request(msg) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    msg.requestId = id;
    pendingRequests.set(id, { resolve, reject });
    send(msg);
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }
    }, 10000);
  });
}

// Public API
const sync = {
  connect,
  onProjectUpdate(cb) { onProjectUpdate = cb; },

  async listProjects() {
    const res = await request({ type: 'list-projects' });
    return res.projects || [];
  },

  async loadProject(filePath) {
    const res = await request({ type: 'load-project', filePath });
    return res.project || null;
  },

  async saveProject(project) {
    const res = await request({ type: 'save-project', project });
    return res.success || false;
  },

  async createProject(label) {
    const res = await request({ type: 'create-project', label });
    return res.project || null;
  },

  async archiveProject(filePath) {
    const res = await request({ type: 'archive-project', filePath });
    return res.success || false;
  },

  setActiveProject(filePath) {
    send({ type: 'project-changed', filePath });
  },
};

export default sync;
```

- [ ] **Step 2: Import sync in workspace.js**

Add `import sync from './core/sync.js';` to workspace.js and call `sync.connect()` in `init()`.

- [ ] **Step 3: Commit**

```bash
git add ui/core/sync.js ui/workspace.js
git commit -m "feat: add sync.js WebSocket client for daemon communication"
```

---

## Task 4: Update daemon — project file operations

The daemon needs to handle project file I/O. sync.js (Task 3) sends these messages — the daemon now needs to respond. After this task, the full app ↔ daemon communication is testable.

**Files:**
- Modify: `daemon/src/protocol.ts` — add new message types
- Modify: `daemon/src/server.ts` — add project file handlers + update `PanelMessage` union type
- Create: `daemon/src/projects.ts` — project file I/O module

- [ ] **Step 1: Update protocol.ts with new message types**

Add to `daemon/src/protocol.ts`:

```ts
// ─── App → Daemon (WebSocket) ─────────────────────────────────────────────

export interface ListProjectsRequest { type: 'list-projects'; requestId?: number; }
export interface LoadProjectRequest { type: 'load-project'; filePath: string; requestId?: number; }
export interface SaveProjectRequest { type: 'save-project'; project: unknown; requestId?: number; }
export interface CreateProjectRequest { type: 'create-project'; label: string; requestId?: number; }
export interface ArchiveProjectRequest { type: 'archive-project'; filePath: string; requestId?: number; }
export interface ProjectChangedMessage { type: 'project-changed'; filePath: string; }

export type AppMessage =
  | ListProjectsRequest
  | LoadProjectRequest
  | SaveProjectRequest
  | CreateProjectRequest
  | ArchiveProjectRequest
  | ProjectChangedMessage
  | { type: 'inject'; prompt: string };

// ─── Daemon → App (WebSocket responses) ───────────────────────────────────

export interface ProjectUpdatedMessage {
  type: 'project-updated';
  project: unknown;
  filePath: string;
}

export const PROJECTS_DIR = `${process.env.HOME}/Documents/Frank`;
export const ARCHIVE_DIR = `${process.env.HOME}/Documents/Frank/.archive`;
```

- [ ] **Step 2: Create projects.ts — file I/O module**

Create `daemon/src/projects.ts`:

```ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PROJECTS_DIR, ARCHIVE_DIR } from './protocol.js';

export function ensureProjectsDir(): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

export function listProjects(): Array<{ label: string; filePath: string; modifiedAt: string; screenCount: number }> {
  ensureProjectsDir();
  const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.frank.json'));
  return files.map(f => {
    const filePath = path.join(PROJECTS_DIR, f);
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const stat = fs.statSync(filePath);
      return {
        label: content.label || f.replace('.frank.json', ''),
        filePath,
        modifiedAt: stat.mtime.toISOString(),
        screenCount: content.screenOrder ? content.screenOrder.length : 0,
      };
    } catch {
      return { label: f.replace('.frank.json', ''), filePath, modifiedAt: '', screenCount: 0 };
    }
  });
}

export function loadProject(filePath: string): unknown {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

export function saveProject(project: Record<string, unknown>): string {
  const label = (project.label as string) || 'Untitled';
  const filePath = (project._filePath as string) || path.join(PROJECTS_DIR, `${slugify(label)}.frank.json`);
  const toSave = { ...project, savedAt: new Date().toISOString() };
  delete toSave._filePath; // don't persist internal field
  atomicWrite(filePath, JSON.stringify(toSave, null, 2));
  return filePath;
}

export function createProject(label: string): { project: Record<string, unknown>; filePath: string } {
  ensureProjectsDir();
  const id = slugify(label);
  const filePath = path.join(PROJECTS_DIR, `${id}.frank.json`);
  const project: Record<string, unknown> = {
    schema: 'v1',
    type: 'project',
    label,
    savedAt: new Date().toISOString(),
    screens: {},
    screenOrder: [],
    activeShare: null,
    shareHistory: [],
    timeline: [],
  };
  atomicWrite(filePath, JSON.stringify(project, null, 2));
  return { project, filePath };
}

export function archiveProject(filePath: string): boolean {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const dest = path.join(ARCHIVE_DIR, path.basename(filePath));
  fs.renameSync(filePath, dest);
  return true;
}

export function mergeScreenIntoProject(projectFilePath: string, screen: Record<string, unknown>): Record<string, unknown> {
  const content = fs.readFileSync(projectFilePath, 'utf8');
  const project = JSON.parse(content) as Record<string, unknown>;
  const screens = (project.screens || {}) as Record<string, unknown>;
  const screenOrder = (project.screenOrder || []) as string[];

  const screenLabel = (screen.label as string) || 'Untitled Screen';
  const screenId = (screen.id as string) || slugify(screenLabel);

  if (screens[screenId]) {
    // Update existing screen
    screens[screenId] = { ...(screens[screenId] as object), ...screen, id: undefined };
  } else {
    // Add new screen
    screens[screenId] = { ...screen, id: undefined };
    screenOrder.push(screenId);
  }

  project.screens = screens;
  project.screenOrder = screenOrder;
  project.savedAt = new Date().toISOString();

  atomicWrite(projectFilePath, JSON.stringify(project, null, 2));
  return project;
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function getGitUserName(): string {
  try {
    const { execSync } = require('child_process');
    return execSync('git config user.name', { encoding: 'utf8' }).trim() || 'You';
  } catch {
    return 'You';
  }
}
```

- [ ] **Step 3: Update server.ts — add message routing**

In `server.ts`, update the `ws.on('message')` handler to route new message types. Add imports for the project functions. Keep existing `render` and `inject` handling. Add:

```ts
import { listProjects, loadProject, saveProject, createProject, archiveProject, mergeScreenIntoProject, getGitUserName } from './projects.js';
import { PROJECTS_DIR } from './protocol.js';

let activeProjectPath: string | null = null;
```

In the `ws.on('message')` handler, add cases for each new message type. Each case calls the corresponding function from `projects.ts`, catches errors, and sends back a response with the same `requestId`.

Also update `handleSchemaFile` to check for `activeProjectPath` — if set, merge the screen into the active project file and broadcast the updated project. If not set, create a new project.

- [ ] **Step 4: Build and test daemon**

```bash
cd daemon && npm run build
```

Fix any TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/protocol.ts daemon/src/projects.ts daemon/src/server.ts
git commit -m "feat: daemon project file operations — save, load, list, create, merge, archive"
```

---

## Task 5: Build canvas.js + modify screen.js — fixed viewport

**Files:**
- Create: `ui/components/canvas.js`
- Modify: `ui/render/screen.js` (already ported from v0 in Task 2)

- [ ] **Step 1: Modify screen.js — add fixed dimensions**

The v0 `screen.js` (already copied in Task 2) exports `renderScreen(schema)` with chrome detection and flex-fill logic. Modify it to:
- Add a `PLATFORM_DEFAULTS` object with default viewport dimensions
- Accept an optional `viewport` field from the screen data (`schema.viewport`)
- Apply fixed `width` and `min-height` on the outer `.wf-device` wrapper
- Export `PLATFORM_DEFAULTS` for use by the viewport picker

The v0 function signature is `renderScreen(schema)` where `schema` is a screen object with `{ platform, sections, label, viewport? }`. Add the viewport dimension logic while preserving the existing chrome detection and flex-fill behavior:

```js
const PLATFORM_DEFAULTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  web: { width: 1440, height: 900 },
};

// In renderScreen(), after determining deviceClass:
const viewport = schema.viewport || PLATFORM_DEFAULTS[deviceClass] || PLATFORM_DEFAULTS.web;
// Apply to the outer div:
// style="width: ${viewport.width}px; min-height: ${viewport.height}px;"
```

Keep the existing `renderSection` calls and flex-fill logic unchanged.

Export: `export { PLATFORM_DEFAULTS };`

- [ ] **Step 2: Create canvas.js — zoomable canvas**

```js
// canvas.js — Canvas background + zoom controls

const DEFAULT_BG = '#1e1e1e';
const DEFAULT_PADDING = 40; // px around wireframe

let currentScale = 1;

export function createCanvas(container) {
  const bg = localStorage.getItem('frank-canvas-bg') || DEFAULT_BG;

  container.innerHTML = `
    <div class="canvas" style="background: ${bg};">
      <div class="canvas-viewport">
        <div class="canvas-transform">
          <div class="canvas-content"></div>
        </div>
      </div>
    </div>
  `;

  const canvas = container.querySelector('.canvas');
  const viewport = container.querySelector('.canvas-viewport');
  const transform = container.querySelector('.canvas-transform');
  const content = container.querySelector('.canvas-content');

  function setContent(html) {
    content.innerHTML = html;
    fitToWindow();
  }

  function fitToWindow() {
    const wfScreen = content.querySelector('.wf-screen');
    if (!wfScreen) return;
    const wfWidth = wfScreen.offsetWidth;
    const wfHeight = wfScreen.offsetHeight;
    const vpWidth = viewport.clientWidth - DEFAULT_PADDING * 2;
    const vpHeight = viewport.clientHeight - DEFAULT_PADDING * 2;
    currentScale = Math.min(vpWidth / wfWidth, vpHeight / wfHeight, 1);
    applyScale();
  }

  function setZoom(scale) {
    currentScale = scale;
    applyScale();
  }

  function applyScale() {
    transform.style.transform = `scale(${currentScale})`;
    transform.style.transformOrigin = 'top center';
  }

  function getScale() { return currentScale; }

  // Refit on window resize
  window.addEventListener('resize', fitToWindow);

  return { setContent, fitToWindow, setZoom, getScale, canvas, content };
}
```

- [ ] **Step 3: Add canvas styles to workspace.css**

```css
.canvas {
  flex: 1;
  overflow: auto;
  display: flex;
  justify-content: center;
  padding: 40px;
}

.canvas-viewport {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  overflow: auto;
}

.canvas-transform {
  transition: transform 0.15s ease;
}

.wf-screen {
  box-shadow: 0 0 0 1px var(--border), 0 4px 24px rgba(0,0,0,0.4);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
```

- [ ] **Step 4: Test canvas with a hardcoded screen**

Temporarily wire up `workspace.js` to create a canvas and render a test screen into it. Verify the wireframe renders at fixed dimensions with the dark canvas background around it.

- [ ] **Step 5: Commit**

```bash
git add ui/components/canvas.js ui/render/screen.js ui/styles/workspace.css
git commit -m "feat: fixed viewport canvas — wireframes render at real device dimensions"
```

---

## Task 6: Build project.js — in-memory state manager

**Files:**
- Create: `ui/core/project.js`

- [ ] **Step 1: Create project.js**

```js
// project.js — In-memory project state. Does NOT perform file I/O.
// All saves go through sync.js → daemon.

import sync from './sync.js';

let project = null;
let filePath = null;
let onChange = null; // callback for re-renders

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function generateScreenId(label, existingIds) {
  let id = slugify(label);
  if (!existingIds.includes(id)) return id;
  let n = 2;
  while (existingIds.includes(`${id}-${n}`)) n++;
  return `${id}-${n}`;
}

const projectManager = {
  get() { return project; },
  getFilePath() { return filePath; },

  load(data, path) {
    project = data;
    filePath = path;
    if (onChange) onChange(project);
  },

  setOnChange(cb) { onChange = cb; },

  // Save current state to daemon
  async save() {
    if (!project || !filePath) return;
    project.savedAt = new Date().toISOString();
    // Validate screenOrder matches screens keys
    const screenKeys = Object.keys(project.screens || {});
    project.screenOrder = (project.screenOrder || []).filter(id => screenKeys.includes(id));
    // Add any screens missing from screenOrder
    for (const key of screenKeys) {
      if (!project.screenOrder.includes(key)) project.screenOrder.push(key);
    }
    project._filePath = filePath;
    try {
      await sync.saveProject(project);
    } catch (e) {
      console.warn('[project] save failed:', e.message);
      // State is still updated in memory — next mutation will retry save
    }
    if (onChange) onChange(project);
  },

  // All mutation methods update memory synchronously, then save async.
  // Save errors are logged but don't block — next mutation retries.

  addScreen(screen) {
    if (!project) return null;
    const id = generateScreenId(screen.label || 'Untitled', Object.keys(project.screens || {}));
    project.screens = project.screens || {};
    project.screens[id] = { ...screen };
    project.screenOrder = project.screenOrder || [];
    project.screenOrder.push(id);
    this.save(); // async, fire-and-forget with error logging
    return id;
  },

  updateScreen(id, updates) {
    if (!project?.screens?.[id]) return;
    project.screens[id] = { ...project.screens[id], ...updates };
    this.save();
  },

  deleteScreen(id) {
    if (!project?.screens?.[id]) return;
    delete project.screens[id];
    project.screenOrder = (project.screenOrder || []).filter(sid => sid !== id);
    this.save();
  },

  duplicateScreen(id, newLabel) {
    if (!project?.screens?.[id]) return null;
    const original = project.screens[id];
    const newScreen = JSON.parse(JSON.stringify(original));
    newScreen.label = newLabel;
    newScreen.notes = [];
    newScreen.stars = [];
    return this.addScreen(newScreen);
  },

  reorderScreens(newOrder) {
    if (!project) return;
    project.screenOrder = newOrder;
    this.save();
  },

  getScreen(id) {
    return project?.screens?.[id] || null;
  },

  getScreenOrder() {
    return project?.screenOrder || [];
  },
};

export default projectManager;
```

- [ ] **Step 2: Commit**

```bash
git add ui/core/project.js
git commit -m "feat: project.js in-memory state manager with screen CRUD"
```

---

## Task 7: Build home.js — project picker

**Files:**
- Create: `ui/views/home.js`
- Modify: `ui/workspace.js` — integrate home view

- [ ] **Step 1: Create home.js**

```js
// home.js — Project picker view

import sync from '../core/sync.js';

export function renderHome(container, { onOpenProject, onCreateProject }) {
  container.innerHTML = `
    <div class="home">
      <div class="home-header">
        <h1 class="home-title">Frank</h1>
        <button class="home-new-btn">New Project</button>
      </div>
      <div class="home-projects"></div>
    </div>
  `;

  const projectsList = container.querySelector('.home-projects');
  const newBtn = container.querySelector('.home-new-btn');

  newBtn.addEventListener('click', async () => {
    const label = prompt('Project name:');
    if (!label?.trim()) return;
    onCreateProject(label.trim());
  });

  loadProjects();

  async function loadProjects() {
    try {
      const projects = await sync.listProjects();
      if (projects.length === 0) {
        projectsList.innerHTML = '<p class="home-empty">No projects yet. Create one to get started.</p>';
        return;
      }
      projectsList.innerHTML = projects.map(p => `
        <div class="home-project-card" data-path="${p.filePath}">
          <div class="home-project-info">
            <span class="home-project-label">${p.label}</span>
            <span class="home-project-meta">${p.screenCount} screen${p.screenCount !== 1 ? 's' : ''} · ${formatDate(p.modifiedAt)}</span>
          </div>
        </div>
      `).join('');

      projectsList.querySelectorAll('.home-project-card').forEach(card => {
        card.addEventListener('click', () => onOpenProject(card.dataset.path));
      });
    } catch (e) {
      projectsList.innerHTML = '<p class="home-empty">Unable to load projects. Is the daemon running?</p>';
    }
  }
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
```

- [ ] **Step 2: Add home view styles to workspace.css**

```css
.home { padding: 48px; max-width: 640px; margin: 0 auto; }
.home-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
.home-title { font-size: 24px; font-weight: 600; color: var(--text-primary); }
.home-new-btn {
  padding: 8px 16px; border-radius: var(--radius-md); border: 1px solid var(--border);
  background: var(--bg-elevated); color: var(--text-primary); cursor: pointer; font-size: 13px;
}
.home-new-btn:hover { background: var(--accent); color: #fff; border-color: var(--accent); }
.home-projects { display: flex; flex-direction: column; gap: 8px; }
.home-project-card {
  padding: 16px; border-radius: var(--radius-md); border: 1px solid var(--border);
  background: var(--bg-surface); cursor: pointer; transition: border-color 0.15s;
}
.home-project-card:hover { border-color: var(--accent); }
.home-project-info { display: flex; flex-direction: column; gap: 4px; }
.home-project-label { font-size: 15px; font-weight: 500; color: var(--text-primary); }
.home-project-meta { font-size: 12px; color: var(--text-secondary); }
.home-empty { color: var(--text-muted); font-size: 14px; text-align: center; padding: 48px 0; }
```

- [ ] **Step 3: Wire up home view in workspace.js**

Update `workspace.js` to import `renderHome` and call it when switching to the home view. Wire up `onOpenProject` and `onCreateProject` callbacks.

- [ ] **Step 4: Test home view**

Start the daemon (`frank start`), then serve the UI. The home view should show "No projects yet" or list any existing projects if you manually create `.frank.json` files.

- [ ] **Step 5: Commit**

```bash
git add ui/views/home.js ui/workspace.js ui/styles/workspace.css
git commit -m "feat: home view — project picker with create and open"
```

---

## Task 8: Build gallery.js — screen thumbnails + flow map

**Files:**
- Create: `ui/views/gallery.js`
- Create: `ui/components/flow-map.js`
- Create: `ui/styles/flow-map.css`
- Modify: `ui/workspace.js` — integrate gallery view

- [ ] **Step 1: Create gallery.js**

Build the gallery view with thumbnail grid. Each thumbnail renders the actual wireframe at small scale. Thumbnails render lazily using `IntersectionObserver` — only visible thumbnails get rendered.

The gallery shows: screen thumbnails in a grid, a "+" card to add screens, and the flow map below.

Key implementation details:
- Each thumbnail is a container at a fixed size (e.g., 240x160 for web, 120x200 for mobile)
- The full wireframe is rendered inside via `renderScreen()` at full size
- CSS `transform: scale()` shrinks it to fit the thumbnail
- `pointer-events: none` on the thumbnail content prevents accidental clicks on wireframe elements
- `IntersectionObserver` triggers rendering when a card scrolls into view
- Rendered thumbnails are cached — only re-render when `screen.sections` changes

- [ ] **Step 2: Create flow-map.js**

Simple left-to-right layout:
- Each screen is a box (label + small platform badge)
- Arrows drawn with SVG `<line>` elements between connected screens
- Layout: first screen leftmost, connected screens flow right, unconnected stack below
- Auto-layout is deterministic from the data — same input always produces same layout
- Horizontal scroll for projects with many screens

Use an SVG overlay for arrows, with HTML boxes positioned via `position: absolute` on a containing div.

- [ ] **Step 3: Add flow-map.css**

Add `<link rel="stylesheet" href="styles/flow-map.css">` to `index.html`.

```css
.flow-map { position: relative; min-height: 120px; padding: 24px; overflow-x: auto; }
.flow-map-node {
  position: absolute; padding: 8px 16px; border-radius: var(--radius-md);
  border: 1px solid var(--border); background: var(--bg-surface); cursor: pointer;
  font-size: 13px; color: var(--text-primary); white-space: nowrap;
}
.flow-map-node:hover { border-color: var(--accent); }
.flow-map-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
.flow-map-arrow { stroke: var(--text-muted); stroke-width: 1.5; marker-end: url(#arrowhead); }
```

- [ ] **Step 4: Wire up gallery in workspace.js**

Import `renderGallery` and call it when switching to gallery view. Pass the current project and callbacks for opening screens, adding screens, etc.

- [ ] **Step 5: Test gallery view**

Create a test project with 2-3 screens (manually or via daemon). Open it — the gallery should show thumbnails and a flow map.

- [ ] **Step 6: Commit**

```bash
git add ui/views/gallery.js ui/components/flow-map.js ui/styles/flow-map.css ui/index.html ui/workspace.js
git commit -m "feat: gallery view — screen thumbnails with lazy rendering + flow map"
```

---

## Task 9: Build editor.js — main workspace

**Files:**
- Create: `ui/views/editor.js`
- Create: `ui/components/toolbar.js`
- Modify: `ui/workspace.js` — integrate editor view

- [ ] **Step 1: Create toolbar.js**

The toolbar renders: back button, screen label (editable), viewport picker (dropdown + fields), undo/redo, star, zoom, share (disabled).

```js
// toolbar.js — Editor toolbar

import { PLATFORM_DEFAULTS } from '../render/screen.js';

const PRESETS = [
  { label: 'iPhone 16', width: 390, height: 844 },
  { label: 'iPhone 16 Pro Max', width: 430, height: 932 },
  { label: 'iPad', width: 768, height: 1024 },
  { label: 'iPad Pro', width: 1024, height: 1366 },
  { label: 'Desktop', width: 1440, height: 900 },
  { label: 'Desktop Wide', width: 1920, height: 1080 },
];

export function renderToolbar(container, { screen, onBack, onViewportChange, onUndo, onRedo, onStar, onZoom, undoCount, redoCount, starCount, currentZoom }) {
  // Build toolbar HTML with all controls
  // Viewport picker: dropdown + editable width/height fields
  // Wire up event listeners for each control
  // Return update function for refreshing button states
}
```

Full implementation in the step — the toolbar is a self-contained component that emits callbacks.

- [ ] **Step 2: Create editor.js**

The editor view composes: toolbar (top), canvas with wireframe (center-left), comment panel (right).

```js
// editor.js — Single screen editor

import { createCanvas } from '../components/canvas.js';
import { renderScreen } from '../render/screen.js';
import { renderToolbar } from '../components/toolbar.js';
import projectManager from '../core/project.js';

export function renderEditor(container, { screenId, onBack }) {
  const screen = projectManager.getScreen(screenId);
  if (!screen) { onBack(); return; }

  container.innerHTML = `
    <div class="editor">
      <div class="editor-toolbar"></div>
      <div class="editor-body">
        <div class="editor-canvas-area"></div>
        <div class="editor-comments"></div>
      </div>
      <div class="editor-status"></div>
    </div>
  `;

  // Initialize toolbar
  const toolbarEl = container.querySelector('.editor-toolbar');
  renderToolbar(toolbarEl, { screen, onBack, ... });

  // Initialize canvas
  const canvasArea = container.querySelector('.editor-canvas-area');
  const canvas = createCanvas(canvasArea);
  canvas.setContent(renderScreen(screen, projectManager.get()));

  // Initialize status bar
  updateStatus();
}
```

- [ ] **Step 3: Add editor styles to workspace.css**

```css
.editor { display: flex; flex-direction: column; height: 100%; }
.editor-toolbar {
  display: flex; align-items: center; gap: 8px; padding: 8px 16px;
  border-bottom: 1px solid var(--border); background: var(--bg-surface);
  flex-shrink: 0;
}
.editor-body { display: flex; flex: 1; overflow: hidden; }
.editor-canvas-area { flex: 1; overflow: hidden; }
.editor-comments {
  width: 280px; border-left: 1px solid var(--border); background: var(--bg-surface);
  overflow-y: auto; flex-shrink: 0;
}
.editor-comments.collapsed { display: none; }
.editor-status {
  padding: 4px 16px; font-size: 11px; color: var(--text-muted);
  border-top: 1px solid var(--border); background: var(--bg-surface);
  flex-shrink: 0;
}
```

- [ ] **Step 4: Wire up editor in workspace.js**

Import `renderEditor`, call it when switching to editor view with the active screen ID.

- [ ] **Step 5: Test editor view**

Open a project, click a screen → editor should show the toolbar, canvas with wireframe at fixed dimensions, and the comment panel area.

- [ ] **Step 6: Commit**

```bash
git add ui/views/editor.js ui/components/toolbar.js ui/workspace.js ui/styles/workspace.css
git commit -m "feat: editor view — toolbar, canvas, wireframe rendering at fixed viewport"
```

---

## Task 10: Build comments.js — comment panel

**Files:**
- Create: `ui/components/comments.js`

- [ ] **Step 1: Create comments.js**

```js
// comments.js — Comment panel for the editor

export function renderComments(container, { screen, screenId, onApprove, onDismiss, onAddNote, authorName }) {
  const notes = screen.notes || [];

  container.innerHTML = `
    <div class="comments-panel">
      <div class="comments-header">
        <span class="comments-title">Comments</span>
        <span class="comments-count">${notes.length}</span>
      </div>
      <div class="comments-list">
        ${notes.length === 0 ? '<p class="comments-empty">No comments yet</p>' : ''}
        ${notes.map((note, i) => `
          <div class="comment-item" data-index="${i}">
            <div class="comment-author">${note.author || 'Unknown'}</div>
            <div class="comment-text">${note.text}</div>
            <div class="comment-meta">${formatTime(note.ts)}${note.status ? ' · ' + note.status : ''}</div>
            <div class="comment-actions">
              ${note.status !== 'approved' ? `<button class="comment-approve" data-index="${i}" title="Approve">✓</button>` : ''}
              ${note.status !== 'dismissed' ? `<button class="comment-dismiss" data-index="${i}" title="Dismiss">✗</button>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
      <div class="comments-add">
        <textarea class="comments-input" placeholder="Add a note..." rows="2"></textarea>
        <button class="comments-submit">Add</button>
      </div>
    </div>
  `;

  // Wire up event listeners for approve, dismiss, add note
  container.querySelectorAll('.comment-approve').forEach(btn => {
    btn.addEventListener('click', () => onApprove(parseInt(btn.dataset.index)));
  });
  container.querySelectorAll('.comment-dismiss').forEach(btn => {
    btn.addEventListener('click', () => onDismiss(parseInt(btn.dataset.index)));
  });
  container.querySelector('.comments-submit')?.addEventListener('click', () => {
    const input = container.querySelector('.comments-input');
    const text = input.value.trim();
    if (!text) return;
    onAddNote({ author: authorName || 'You', text, section: null, ts: new Date().toISOString(), status: null });
    input.value = '';
  });
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
```

- [ ] **Step 2: Add comment styles to workspace.css**

```css
.comments-panel { display: flex; flex-direction: column; height: 100%; padding: 12px; }
.comments-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.comments-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.comments-count { font-size: 11px; color: var(--text-muted); background: var(--bg-elevated); padding: 2px 6px; border-radius: 10px; }
.comments-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.comments-empty { color: var(--text-muted); font-size: 13px; text-align: center; padding: 24px 0; }
.comment-item { padding: 8px; border-radius: var(--radius-sm); background: var(--bg-elevated); }
.comment-author { font-size: 12px; font-weight: 500; color: var(--accent); }
.comment-text { font-size: 13px; color: var(--text-primary); margin: 4px 0; }
.comment-meta { font-size: 11px; color: var(--text-muted); }
.comment-actions { display: flex; gap: 4px; margin-top: 4px; }
.comment-actions button {
  padding: 2px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border);
  background: var(--bg-surface); color: var(--text-secondary); cursor: pointer; font-size: 12px;
}
.comment-approve:hover { color: var(--success); border-color: var(--success); }
.comment-dismiss:hover { color: var(--danger); border-color: var(--danger); }
.comments-add { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.comments-input {
  background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm);
  color: var(--text-primary); padding: 8px; font-size: 13px; resize: none; font-family: inherit;
}
.comments-submit {
  align-self: flex-end; padding: 4px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border);
  background: var(--bg-elevated); color: var(--text-primary); cursor: pointer; font-size: 12px;
}
.comments-submit:hover { background: var(--accent); color: #fff; border-color: var(--accent); }
```

- [ ] **Step 3: Integrate comments into editor.js**

Import `renderComments`, call it on the `.editor-comments` container. Wire up `onApprove`, `onDismiss`, and `onAddNote` to update the screen's notes array via `projectManager.updateScreen()`.

- [ ] **Step 4: Commit**

```bash
git add ui/components/comments.js ui/views/editor.js ui/styles/workspace.css
git commit -m "feat: comment panel — notes display, approve, dismiss, add"
```

---

## Task 11: Build undo.js + drag to reorder

**Files:**
- Create: `ui/core/undo.js`
- Modify: `ui/views/editor.js` — add drag handles and undo integration

- [ ] **Step 1: Create undo.js**

```js
// undo.js — 10-state undo stack per screen

const MAX_STATES = 10;
const stacks = {}; // screenId → { undo: [], redo: [] }

function getStack(screenId) {
  if (!stacks[screenId]) stacks[screenId] = { undo: [], redo: [] };
  return stacks[screenId];
}

const undoManager = {
  push(screenId, sections) {
    const stack = getStack(screenId);
    stack.undo.push(JSON.parse(JSON.stringify(sections)));
    if (stack.undo.length > MAX_STATES) stack.undo.shift();
    stack.redo = []; // clear redo on new action
  },

  undo(screenId, currentSections) {
    const stack = getStack(screenId);
    if (stack.undo.length === 0) return null;
    stack.redo.push(JSON.parse(JSON.stringify(currentSections)));
    return stack.undo.pop();
  },

  redo(screenId, currentSections) {
    const stack = getStack(screenId);
    if (stack.redo.length === 0) return null;
    stack.undo.push(JSON.parse(JSON.stringify(currentSections)));
    return stack.redo.pop();
  },

  canUndo(screenId) { return (stacks[screenId]?.undo.length || 0) > 0; },
  canRedo(screenId) { return (stacks[screenId]?.redo.length || 0) > 0; },
  undoCount(screenId) { return stacks[screenId]?.undo.length || 0; },
  redoCount(screenId) { return stacks[screenId]?.redo.length || 0; },
  clear(screenId) { delete stacks[screenId]; },
};

export default undoManager;
```

- [ ] **Step 2: Add drag-to-reorder in editor.js**

Implementation approach:
- After rendering the wireframe, inject drag handles (6-dot grip icon) on each section via DOM manipulation
- Use pointer events (`pointerdown`, `pointermove`, `pointerup`) — not HTML5 drag and drop
- On `pointerdown` on a handle: capture the section index, add a `.dragging` class
- On `pointermove`: calculate position adjusted by canvas zoom (`y / canvas.getScale()`), show drop indicator between sections
- On `pointerup`: reorder sections array, push old order to undo stack, save, re-render

Key: pointer coordinates must be divided by `canvas.getScale()` to account for zoom.

- [ ] **Step 3: Wire undo/redo to toolbar buttons**

In editor.js, connect the undo/redo toolbar buttons to `undoManager.undo()` / `undoManager.redo()`. On undo/redo, update the screen's sections and re-render.

- [ ] **Step 4: Test drag and undo**

Drag a section to a new position → verify it moves. Click undo → verify it returns. Click redo → verify it re-applies.

- [ ] **Step 5: Commit**

```bash
git add ui/core/undo.js ui/views/editor.js
git commit -m "feat: drag-to-reorder sections + undo/redo (10-state stack)"
```

---

## Task 12: Build stars.js — snapshot management

**Files:**
- Create: `ui/core/stars.js`
- Modify: `ui/views/editor.js` — integrate star button

- [ ] **Step 1: Create stars.js**

```js
// stars.js — Snapshot management. Stars are permanent, stored in the project file.

import projectManager from './project.js';
import undoManager from './undo.js';

const starsManager = {
  star(screenId, label) {
    const screen = projectManager.getScreen(screenId);
    if (!screen) return;
    screen.stars = screen.stars || [];
    screen.stars.push({
      label: label || `Star ${screen.stars.length + 1}`,
      ts: new Date().toISOString(),
      sections: JSON.parse(JSON.stringify(screen.sections)),
    });
    projectManager.updateScreen(screenId, { stars: screen.stars });
  },

  restore(screenId, starIndex) {
    const screen = projectManager.getScreen(screenId);
    if (!screen?.stars?.[starIndex]) return null;
    // Push current state to undo before restoring
    undoManager.push(screenId, screen.sections);
    const restored = JSON.parse(JSON.stringify(screen.stars[starIndex].sections));
    projectManager.updateScreen(screenId, { sections: restored });
    return restored;
  },

  list(screenId) {
    const screen = projectManager.getScreen(screenId);
    return screen?.stars || [];
  },

  remove(screenId, starIndex) {
    const screen = projectManager.getScreen(screenId);
    if (!screen?.stars?.[starIndex]) return;
    screen.stars.splice(starIndex, 1);
    projectManager.updateScreen(screenId, { stars: screen.stars });
  },

  count(screenId) {
    const screen = projectManager.getScreen(screenId);
    return screen?.stars?.length || 0;
  },
};

export default starsManager;
```

- [ ] **Step 2: Integrate star button in toolbar**

The star button in the toolbar:
- Click → stars current screen (prompts for optional label)
- Shows count badge when stars exist
- Dropdown/popover shows list of stars with label + timestamp
- Click a star in the dropdown → restore it
- Delete button on each star → remove it

- [ ] **Step 3: Test stars**

Star a screen → verify it appears in the dropdown. Restore a star → verify sections change. Undo after restore → verify it reverts. Delete a star → verify it's gone.

- [ ] **Step 4: Commit**

```bash
git add ui/core/stars.js ui/views/editor.js ui/components/toolbar.js
git commit -m "feat: stars — snapshot, restore, list, delete"
```

---

## Task 13: Update daemon — merge logic + active project tracking

**Files:**
- Modify: `daemon/src/server.ts` — screen merge + CLAUDE.md injection update
- Modify: `daemon/src/inject.ts` — add active project path to injection

- [ ] **Step 1: Update handleSchemaFile to merge into active project**

In `server.ts`, modify `handleSchemaFile()`:

```ts
function handleSchemaFile(content: string): void {
  let schema: Record<string, unknown>;
  try {
    schema = JSON.parse(content);
  } catch { return; }

  if (schema.schema !== 'v1') return;

  if (activeProjectPath) {
    // Merge screen into active project
    try {
      const updatedProject = mergeScreenIntoProject(activeProjectPath, schema);
      broadcast({ type: 'project-updated', project: updatedProject, filePath: activeProjectPath });
    } catch (e) {
      console.warn('[frank] merge failed:', e);
    }
  } else {
    // No active project — create one
    const label = (schema.label as string) || 'Untitled';
    const { project, filePath } = createProject(label);
    const screenId = slugify(label);
    (project.screens as Record<string, unknown>)[screenId] = schema;
    (project.screenOrder as string[]).push(screenId);
    saveProject(project);
    activeProjectPath = filePath;
    broadcast({ type: 'project-updated', project, filePath });
    updateInjectionWithProject(filePath);
  }
}
```

- [ ] **Step 2: Update inject.ts — add active project path**

Read `daemon/src/inject.ts` and add a function `updateProjectPath(filePath)` that re-injects the CLAUDE.md block with an additional line:

```
Active project: ~/Documents/Frank/My App.frank.json
```

The inject module already knows how to find and replace the block between `INJECT_MARKER_START` and `INJECT_MARKER_END`. Add the project path line inside that block.

- [ ] **Step 3: Wire up project-changed message in server.ts**

When the daemon receives a `project-changed` message from the app, update `activeProjectPath` and call `updateProjectPath()`.

- [ ] **Step 4: Build and test**

```bash
cd daemon && npm run build
```

Test: start daemon, open a project in the app → daemon should log the active project path. Have Claude write a screen → it should merge into the active project.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/server.ts daemon/src/inject.ts
git commit -m "feat: daemon merge logic — AI screens merge into active project + CLAUDE.md tracking"
```

---

## Task 14: Update Tauri config

**Files:**
- Modify: `src-tauri/tauri.conf.json` — point to new `ui/` directory

- [ ] **Step 1: Update tauri.conf.json**

The current config points to Vite (`../dist`). Update to serve `ui/` directly:

- Change `"frontendDist"` from `"../dist"` to `"../ui"`
- Change `"beforeDevCommand"` from `"npm run dev"` to `""` (empty — no build step)
- Change `"beforeBuildCommand"` from `"npm run build"` to `""` (empty — no build step)
- Remove `"devUrl": "http://localhost:1420"` (no dev server)
- Increase window size for the new workspace layout:
  - `"width"`: 440 → 1200 (canvas + comment panel + toolbar need space)
  - `"height"`: 760 → 800
  - `"minWidth"`: 360 → 800
  - `"minHeight"`: 500 → 600

- [ ] **Step 2: Test with `cargo tauri dev`**

```bash
cargo tauri dev
```

The app should open and show the home view. Navigate through project creation → gallery → editor.

- [ ] **Step 3: Build for release**

```bash
cargo tauri build
```

- [ ] **Step 4: Install**

```bash
cp -r src-tauri/target/release/bundle/macos/frank.app /Applications/frank.app
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "chore: update Tauri config to point to new UI"
```

---

## Task 15: Integration testing

**Files:** No new files — end-to-end verification.

- [ ] **Step 1: Full flow test**

1. Run `frank start`
2. Open the app — home view shows, no projects
3. Create a new project → gallery view opens
4. In Claude Code, ask for a wireframe → screen appears in the gallery
5. Click the screen → editor opens with fixed viewport + canvas
6. Drag a section to reorder → verify it moves
7. Undo → verify it returns
8. Star the screen → verify star appears in dropdown
9. Add a note in the comment panel → verify it shows
10. Go back to gallery → thumbnail reflects the reordered sections
11. Flow map shows the screen
12. Quit and reopen the app → project loads, everything persisted

- [ ] **Step 2: Update CLAUDE.md**

Update the project's `CLAUDE.md` to reflect the new architecture:
- Remove ArrowJS references
- Update project structure to match new `ui/` layout
- Update coding conventions for plain DOM (no ArrowJS)
- Add note about daemon being sole file writer

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for new workspace architecture"
```

---

## Summary

16 build steps across 15 tasks. Each task produces a working, committable increment. The build order ensures dependencies are met:

1. Archive + scaffold (structure)
2. Port renderers (proven code — sections.js, smart-item.js, icons.js, screen.js)
3. sync.js (WebSocket client — structural, testable after Task 4)
4. Daemon project ops (file I/O — enables full app ↔ daemon communication)
5. Canvas + modify screen.js (fixed viewport)
6. project.js (in-memory state)
7. Home view (project picker)
8. Gallery view (thumbnails + flow map)
9. Editor view (main workspace)
10. Comments panel
11. Undo + drag
12. Stars
13. Daemon merge + tracking
14. Tauri config (update paths, remove Vite references, increase window size)
15. Integration test + docs update

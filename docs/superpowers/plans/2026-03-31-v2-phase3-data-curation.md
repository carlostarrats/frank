# v2 Phase 3 — Data Capture, Curation & AI Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the data capture system (snapshots with stars), feedback curation panel (approve/dismiss/remix/batch), AI feedback routing (clipboard-based), timeline view, and structured JSON export.

**Architecture:** Snapshots are captured by the browser and stored by the daemon in per-project directories. The curation panel replaces the simple comment list with approve/dismiss/remix actions. AI routing formats curated feedback as a structured prompt for clipboard copy. Export bundles all project data as a single JSON file.

**Tech Stack:** Plain JS browser UI, Node.js daemon (TypeScript), structured JSON files.

**Spec:** `docs/superpowers/specs/2026-03-31-v2-collaboration-layer-design.md` — Sections 4, 6, 7

**Depends on:** Phase 1 (complete), Phase 2 (complete)

---

## File Structure

### Daemon additions

```
daemon/src/
├── snapshots.ts          # CREATE: snapshot file I/O (save, list, star, delete)
├── curation.ts           # CREATE: curation log I/O (approve, dismiss, remix, batch)
├── ai-chain.ts           # CREATE: AI instruction log
├── export.ts             # CREATE: project export to structured JSON
├── timeline.ts           # CREATE: unified timeline builder
├── protocol.ts           # MODIFY: add snapshot/curation/export message types
├── server.ts             # MODIFY: add WebSocket handlers for new features
└── cli.ts                # MODIFY: add frank export command
```

### UI additions

```
ui-v2/
├── components/
│   ├── curation.js       # CREATE: curation panel (replaces simple comment list)
│   ├── ai-routing.js     # CREATE: AI instruction editor + copy-to-clipboard
│   └── toolbar.js        # MODIFY: add snapshot button, notification badge
├── views/
│   ├── timeline.js       # CREATE: timeline view
│   └── viewer.js         # MODIFY: add snapshot trigger, curation integration
├── styles/
│   ├── curation.css      # CREATE: curation panel styles
│   └── timeline.css      # CREATE: timeline view styles
└── index.html            # MODIFY: add timeline view container + CSS links
```

---

## Task 1: Snapshot storage module

Create the daemon module for saving, listing, starring, and deleting snapshots.

**Files:**
- Create: `daemon/src/snapshots.ts`

- [ ] **Step 1: Create snapshots.ts**

```ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECTS_DIR } from './protocol.js';

export interface SnapshotMeta {
  id: string;
  trigger: 'manual' | 'share' | 'ai-applied';
  triggeredBy: string | null;
  starred: boolean;
  label: string;
  frankVersion: string;
  ts: string;
}

function snapshotsDir(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, 'snapshots');
}

function snapshotDir(projectId: string, snapshotId: string): string {
  return path.join(snapshotsDir(projectId), snapshotId);
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function saveSnapshot(
  projectId: string,
  html: string,
  screenshotBase64: string | null,
  trigger: 'manual' | 'share' | 'ai-applied',
  triggeredBy: string | null = null
): SnapshotMeta {
  const id = 'snap-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  const dir = snapshotDir(projectId, id);
  fs.mkdirSync(dir, { recursive: true });

  const meta: SnapshotMeta = {
    id,
    trigger,
    triggeredBy,
    starred: false,
    label: '',
    frankVersion: '2',
    ts: new Date().toISOString(),
  };

  atomicWrite(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  atomicWrite(path.join(dir, 'snapshot.html'), html);

  if (screenshotBase64) {
    const buf = Buffer.from(screenshotBase64, 'base64');
    fs.writeFileSync(path.join(dir, 'screenshot.png'), buf);
  }

  return meta;
}

export function listSnapshots(projectId: string): SnapshotMeta[] {
  const dir = snapshotsDir(projectId);
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const snapshots: SnapshotMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(dir, entry.name, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      snapshots.push(JSON.parse(fs.readFileSync(metaPath, 'utf8')));
    } catch { /* skip corrupt */ }
  }

  return snapshots.sort((a, b) => b.ts.localeCompare(a.ts));
}

export function starSnapshot(projectId: string, snapshotId: string, label: string): SnapshotMeta | null {
  const metaPath = path.join(snapshotDir(projectId, snapshotId), 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SnapshotMeta;
  meta.starred = true;
  meta.label = label;
  atomicWrite(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

export function unstarSnapshot(projectId: string, snapshotId: string): SnapshotMeta | null {
  const metaPath = path.join(snapshotDir(projectId, snapshotId), 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SnapshotMeta;
  meta.starred = false;
  meta.label = '';
  atomicWrite(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

export function deleteSnapshot(projectId: string, snapshotId: string): boolean {
  const dir = snapshotDir(projectId, snapshotId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
```

- [ ] **Step 2: Build**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

- [ ] **Step 3: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add daemon/src/snapshots.ts
git commit -m "feat(daemon): snapshot storage — save, list, star, delete snapshots"
```

---

## Task 2: Curation log module

Create the daemon module for recording approve/dismiss/remix/batch actions.

**Files:**
- Create: `daemon/src/curation.ts`

- [ ] **Step 1: Create curation.ts**

```ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECTS_DIR, type Comment } from './protocol.js';

export interface CurationEntry {
  id: string;
  commentIds: string[];
  action: 'approve' | 'dismiss' | 'remix' | 'batch';
  originalTexts: string[];
  remixedText: string;
  dismissReason: string;
  ts: string;
}

function curationPath(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, 'curation.json');
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function loadCurations(projectId: string): CurationEntry[] {
  const p = curationPath(projectId);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}

export function addCuration(
  projectId: string,
  commentIds: string[],
  action: 'approve' | 'dismiss' | 'remix' | 'batch',
  originalTexts: string[],
  remixedText: string = '',
  dismissReason: string = ''
): CurationEntry {
  const curations = loadCurations(projectId);
  const entry: CurationEntry = {
    id: 'cur-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
    commentIds,
    action,
    originalTexts,
    remixedText,
    dismissReason,
    ts: new Date().toISOString(),
  };
  curations.push(entry);
  atomicWrite(curationPath(projectId), JSON.stringify(curations, null, 2));
  return entry;
}

// Update comment statuses based on curation action
export function applyCurationToComments(
  projectId: string,
  commentIds: string[],
  newStatus: 'approved' | 'dismissed' | 'remixed'
): void {
  const commentsPath = path.join(PROJECTS_DIR, projectId, 'comments.json');
  if (!fs.existsSync(commentsPath)) return;
  const comments = JSON.parse(fs.readFileSync(commentsPath, 'utf8')) as Comment[];
  const idSet = new Set(commentIds);
  for (const c of comments) {
    if (idSet.has(c.id)) c.status = newStatus;
  }
  atomicWrite(commentsPath, JSON.stringify(comments, null, 2));
}
```

- [ ] **Step 2: Build**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

- [ ] **Step 3: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add daemon/src/curation.ts
git commit -m "feat(daemon): curation log — approve, dismiss, remix, batch with comment status updates"
```

---

## Task 3: AI interaction chain module

Create the module that logs AI instructions.

**Files:**
- Create: `daemon/src/ai-chain.ts`

- [ ] **Step 1: Create ai-chain.ts**

```ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECTS_DIR } from './protocol.js';

export interface AiInstruction {
  id: string;
  feedbackIds: string[];
  curationIds: string[];
  instruction: string;
  resultSnapshot: string | null;
  ts: string;
}

function chainPath(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, 'ai-chain.json');
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function loadAiChain(projectId: string): AiInstruction[] {
  const p = chainPath(projectId);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}

export function addAiInstruction(
  projectId: string,
  feedbackIds: string[],
  curationIds: string[],
  instruction: string
): AiInstruction {
  const chain = loadAiChain(projectId);
  const entry: AiInstruction = {
    id: 'ai-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
    feedbackIds,
    curationIds,
    instruction,
    resultSnapshot: null,
    ts: new Date().toISOString(),
  };
  chain.push(entry);
  atomicWrite(chainPath(projectId), JSON.stringify(chain, null, 2));
  return entry;
}

export function linkSnapshotToInstruction(
  projectId: string,
  instructionId: string,
  snapshotId: string
): void {
  const chain = loadAiChain(projectId);
  const entry = chain.find(e => e.id === instructionId);
  if (entry) {
    entry.resultSnapshot = snapshotId;
    atomicWrite(chainPath(projectId), JSON.stringify(chain, null, 2));
  }
}
```

- [ ] **Step 2: Build**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

- [ ] **Step 3: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add daemon/src/ai-chain.ts
git commit -m "feat(daemon): AI interaction chain — log instructions, link snapshots"
```

---

## Task 4: Export module

Create the structured JSON export.

**Files:**
- Create: `daemon/src/export.ts`

- [ ] **Step 1: Create export.ts**

```ts
import { PROJECTS_DIR } from './protocol.js';
import { loadProject, loadComments } from './projects.js';
import { listSnapshots } from './snapshots.js';
import { loadCurations } from './curation.js';
import { loadAiChain } from './ai-chain.js';

export interface FrankExport {
  frank_export_version: '1';
  exportedAt: string;
  project: {
    name: string;
    url?: string;
    file?: string;
    contentType: string;
    created: string;
    screens: Array<{ id: string; route: string; label: string }>;
  };
  snapshots: Array<{
    id: string;
    trigger: string;
    triggeredBy: string | null;
    starred: boolean;
    label: string;
    ts: string;
  }>;
  comments: Array<{
    id: string;
    author: string;
    screenId: string;
    anchor: unknown;
    text: string;
    status: string;
    ts: string;
  }>;
  curations: Array<{
    id: string;
    commentIds: string[];
    action: string;
    originalTexts: string[];
    remixedText: string;
    ts: string;
  }>;
  aiInstructions: Array<{
    id: string;
    curationIds: string[];
    instruction: string;
    resultSnapshot: string | null;
    ts: string;
  }>;
  timeline: Array<{
    type: string;
    id: string;
    ts: string;
    [key: string]: unknown;
  }>;
}

export function exportProject(projectId: string): FrankExport {
  const project = loadProject(projectId);
  const comments = loadComments(projectId);
  const snapshots = listSnapshots(projectId);
  const curations = loadCurations(projectId);
  const aiChain = loadAiChain(projectId);

  // Build unified timeline
  const timeline: FrankExport['timeline'] = [];

  for (const c of comments) {
    timeline.push({ type: 'comment', id: c.id, ts: c.ts, author: c.author, screenId: c.screenId });
  }
  for (const cur of curations) {
    timeline.push({ type: 'curation', id: cur.id, ts: cur.ts, action: cur.action });
  }
  for (const ai of aiChain) {
    timeline.push({ type: 'ai_instruction', id: ai.id, ts: ai.ts });
  }
  for (const snap of snapshots) {
    timeline.push({ type: 'snapshot', id: snap.id, ts: snap.ts, trigger: snap.trigger, triggeredBy: snap.triggeredBy });
  }

  timeline.sort((a, b) => a.ts.localeCompare(b.ts));

  const screens = Object.entries(project.screens).map(([id, s]) => ({
    id,
    route: s.route,
    label: s.label,
  }));

  return {
    frank_export_version: '1',
    exportedAt: new Date().toISOString(),
    project: {
      name: project.name,
      url: project.url,
      file: project.file,
      contentType: project.contentType,
      created: project.created,
      screens,
    },
    snapshots: snapshots.map(s => ({
      id: s.id,
      trigger: s.trigger,
      triggeredBy: s.triggeredBy,
      starred: s.starred,
      label: s.label,
      ts: s.ts,
    })),
    comments: comments.map(c => ({
      id: c.id,
      author: c.author,
      screenId: c.screenId,
      anchor: c.anchor,
      text: c.text,
      status: c.status,
      ts: c.ts,
    })),
    curations: curations.map(cur => ({
      id: cur.id,
      commentIds: cur.commentIds,
      action: cur.action,
      originalTexts: cur.originalTexts,
      remixedText: cur.remixedText,
      ts: cur.ts,
    })),
    aiInstructions: aiChain.map(ai => ({
      id: ai.id,
      curationIds: ai.curationIds,
      instruction: ai.instruction,
      resultSnapshot: ai.resultSnapshot,
      ts: ai.ts,
    })),
    timeline,
  };
}
```

- [ ] **Step 2: Build**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

- [ ] **Step 3: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add daemon/src/export.ts
git commit -m "feat(daemon): project export — structured JSON with timeline, comments, curations, AI chain"
```

---

## Task 5: Wire new modules into daemon server + protocol + CLI

Add WebSocket handlers for snapshots, curation, AI chain, and export. Add `frank export` CLI command.

**Files:**
- Modify: `daemon/src/protocol.ts` — add new message types
- Modify: `daemon/src/server.ts` — add handlers
- Modify: `daemon/src/cli.ts` — add export command

- [ ] **Step 1: Add message types to protocol.ts**

Read `daemon/src/protocol.ts`. Add to `AppMessage`:

```ts
export interface SaveSnapshotRequest { type: 'save-snapshot'; html: string; screenshot: string | null; trigger: 'manual' | 'share' | 'ai-applied'; triggeredBy?: string; requestId?: number; }
export interface ListSnapshotsRequest { type: 'list-snapshots'; requestId?: number; }
export interface StarSnapshotRequest { type: 'star-snapshot'; snapshotId: string; label: string; requestId?: number; }
export interface CurateCommentRequest { type: 'curate-comment'; commentIds: string[]; action: 'approve' | 'dismiss' | 'remix' | 'batch'; remixedText?: string; dismissReason?: string; requestId?: number; }
export interface LogAiInstructionRequest { type: 'log-ai-instruction'; feedbackIds: string[]; curationIds: string[]; instruction: string; requestId?: number; }
export interface ExportProjectRequest { type: 'export-project'; requestId?: number; }
```

Add to `AppMessage` union type.

Add response types:

```ts
export interface SnapshotSavedMessage { type: 'snapshot-saved'; requestId?: number; snapshot: unknown; }
export interface SnapshotListMessage { type: 'snapshot-list'; requestId?: number; snapshots: unknown[]; }
export interface CurationDoneMessage { type: 'curation-done'; requestId?: number; curation: unknown; }
export interface AiInstructionLoggedMessage { type: 'ai-instruction-logged'; requestId?: number; instruction: unknown; }
export interface ExportReadyMessage { type: 'export-ready'; requestId?: number; data: unknown; }
```

Add to `DaemonMessage` union.

- [ ] **Step 2: Add handlers to server.ts**

Read `daemon/src/server.ts`. Add imports:

```ts
import { saveSnapshot, listSnapshots, starSnapshot } from './snapshots.js';
import { addCuration, applyCurationToComments, loadCurations } from './curation.js';
import { addAiInstruction, loadAiChain } from './ai-chain.js';
import { exportProject } from './export.js';
```

Add switch cases in `handleMessage`:

```ts
    case 'save-snapshot': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const meta = saveSnapshot(activeProjectId, msg.html, msg.screenshot, msg.trigger, msg.triggeredBy);
        reply({ type: 'snapshot-saved', snapshot: meta });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'list-snapshots': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        reply({ type: 'snapshot-list', snapshots: listSnapshots(activeProjectId) });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'star-snapshot': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        starSnapshot(activeProjectId, msg.snapshotId, msg.label);
        reply({ type: 'snapshot-list', snapshots: listSnapshots(activeProjectId) });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'curate-comment': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const comments = loadLocalComments(activeProjectId);
        const origTexts = msg.commentIds.map(id => comments.find(c => c.id === id)?.text || '');
        const statusMap: Record<string, 'approved' | 'dismissed' | 'remixed'> = {
          approve: 'approved', dismiss: 'dismissed', remix: 'remixed', batch: 'approved',
        };
        const curation = addCuration(activeProjectId, msg.commentIds, msg.action, origTexts, msg.remixedText || '', msg.dismissReason || '');
        applyCurationToComments(activeProjectId, msg.commentIds, statusMap[msg.action]);
        const updatedComments = loadLocalComments(activeProjectId);
        reply({ type: 'curation-done', curation });
        broadcast({ type: 'project-loaded', projectId: activeProjectId, project: loadProject(activeProjectId), comments: updatedComments } as any);
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'log-ai-instruction': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const instruction = addAiInstruction(activeProjectId, msg.feedbackIds, msg.curationIds, msg.instruction);
        reply({ type: 'ai-instruction-logged', instruction });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'export-project': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const data = exportProject(activeProjectId);
        reply({ type: 'export-ready', data });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }
```

- [ ] **Step 3: Add frank export to cli.ts**

Read `daemon/src/cli.ts`. Add case:

```ts
  case 'export': {
    const projectArg = process.argv[3];
    if (!projectArg) {
      console.log('Usage: frank export <project-id>');
      console.log('Find project IDs with: ls ~/.frank/projects/');
      process.exit(1);
    }
    const { exportProject } = await import('./export.js');
    try {
      const data = exportProject(projectArg);
      const outPath = path.join(process.env.HOME || '', '.frank', 'exports', `${projectArg}-${Date.now()}.json`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[frank] exported to ${outPath}`);
    } catch (e: any) {
      console.error(`[frank] export failed: ${e.message}`);
      process.exit(1);
    }
    process.exit(0);
  }
```

Also add `import path from 'path';` if not already imported, and update the help text to include `frank export`.

- [ ] **Step 4: Build**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

- [ ] **Step 5: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add daemon/src/protocol.ts daemon/src/server.ts daemon/src/cli.ts
git commit -m "feat(daemon): wire snapshots, curation, AI chain, and export into server + CLI"
```

---

## Task 6: Curation panel UI

Replace the simple comment list with a curation panel that supports approve/dismiss/remix.

**Files:**
- Create: `ui-v2/components/curation.js`
- Create: `ui-v2/styles/curation.css`
- Modify: `ui-v2/core/sync.js` — add curation/snapshot/export methods
- Modify: `ui-v2/views/viewer.js` — use curation panel instead of simple comments
- Modify: `ui-v2/index.html` — add curation.css link

- [ ] **Step 1: Add methods to sync.js**

Read `ui-v2/core/sync.js`. Add to the sync object:

```js
  saveSnapshot(html, screenshot, trigger, triggeredBy) {
    return send({ type: 'save-snapshot', html, screenshot, trigger, triggeredBy });
  },
  listSnapshots() { return send({ type: 'list-snapshots' }); },
  starSnapshot(snapshotId, label) { return send({ type: 'star-snapshot', snapshotId, label }); },
  curateComment(commentIds, action, remixedText, dismissReason) {
    return send({ type: 'curate-comment', commentIds, action, remixedText, dismissReason });
  },
  logAiInstruction(feedbackIds, curationIds, instruction) {
    return send({ type: 'log-ai-instruction', feedbackIds, curationIds, instruction });
  },
  exportProject() { return send({ type: 'export-project' }); },
```

- [ ] **Step 2: Create curation.js**

```js
// curation.js — Curation panel: approve, dismiss, remix, batch comments
import sync from '../core/sync.js';
import projectManager from '../core/project.js';

let selectedIds = new Set();
let filterMode = 'all'; // all | pending | approved | dismissed

export function renderCuration(container, { screenId, onCommentModeToggle }) {
  function render() {
    const allComments = screenId
      ? projectManager.getCommentsForScreen(screenId)
      : projectManager.getComments();

    const comments = filterMode === 'all'
      ? allComments
      : allComments.filter(c => c.status === filterMode);

    container.innerHTML = `
      <div class="curation-panel">
        <div class="curation-header">
          <h3>Feedback (${allComments.length})</h3>
          <button class="btn-ghost" id="toggle-comment-mode">+ Add</button>
        </div>
        <div class="curation-filters">
          ${['all', 'pending', 'approved', 'dismissed'].map(f =>
            `<button class="curation-filter ${filterMode === f ? 'active' : ''}" data-filter="${f}">${f}</button>`
          ).join('')}
        </div>
        <div class="curation-list" id="curation-list">
          ${comments.length === 0
            ? '<p class="curation-empty">No comments</p>'
            : comments.map(c => `
                <div class="curation-item ${selectedIds.has(c.id) ? 'selected' : ''} curation-status-${c.status}" data-id="${c.id}">
                  <div class="curation-item-header">
                    <label class="curation-check">
                      <input type="checkbox" ${selectedIds.has(c.id) ? 'checked' : ''} data-id="${c.id}">
                    </label>
                    <strong>${esc(c.author)}</strong>
                    <span class="curation-badge curation-badge-${c.status}">${c.status}</span>
                    <span class="curation-time">${timeAgo(c.ts)}</span>
                  </div>
                  <p class="curation-text">${esc(c.text)}</p>
                  ${c.anchor?.cssSelector ? `<span class="curation-anchor">${esc(c.anchor.cssSelector)}</span>` : ''}
                  <div class="curation-actions">
                    <button class="curation-act" data-action="approve" data-id="${c.id}" title="Approve">✓</button>
                    <button class="curation-act" data-action="dismiss" data-id="${c.id}" title="Dismiss">✕</button>
                    <button class="curation-act" data-action="remix" data-id="${c.id}" title="Remix">✎</button>
                  </div>
                </div>
              `).join('')
          }
        </div>
        ${selectedIds.size > 0 ? `
          <div class="curation-batch">
            <span>${selectedIds.size} selected</span>
            <button class="btn-ghost" id="batch-approve">Approve All</button>
            <button class="btn-ghost" id="batch-dismiss">Dismiss All</button>
            <button class="btn-primary" id="batch-send">Send to AI</button>
          </div>
        ` : ''}
        <div class="curation-remix-area" id="remix-area" style="display:none">
          <textarea class="input curation-remix-text" id="remix-text" placeholder="Rewrite in your own words..." rows="3"></textarea>
          <div class="curation-remix-actions">
            <button class="btn-ghost" id="remix-cancel">Cancel</button>
            <button class="btn-primary" id="remix-save">Save Remix</button>
          </div>
        </div>
      </div>
    `;

    // Event listeners
    container.querySelector('#toggle-comment-mode')?.addEventListener('click', onCommentModeToggle);

    // Filters
    container.querySelectorAll('.curation-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        filterMode = btn.dataset.filter;
        render();
      });
    });

    // Checkboxes
    container.querySelectorAll('.curation-check input').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedIds.add(cb.dataset.id);
        else selectedIds.delete(cb.dataset.id);
        render();
      });
    });

    // Individual actions
    container.querySelectorAll('.curation-act').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;

        if (action === 'remix') {
          showRemixArea(container, [id]);
          return;
        }

        sync.curateComment([id], action);
      });
    });

    // Batch actions
    container.querySelector('#batch-approve')?.addEventListener('click', () => {
      sync.curateComment([...selectedIds], 'approve');
      selectedIds.clear();
    });
    container.querySelector('#batch-dismiss')?.addEventListener('click', () => {
      sync.curateComment([...selectedIds], 'dismiss');
      selectedIds.clear();
    });
    container.querySelector('#batch-send')?.addEventListener('click', () => {
      showAiRouting(container, [...selectedIds]);
    });
  }

  render();
  projectManager.onChange(render);
  return () => { projectManager.offChange(render); };
}

function showRemixArea(container, commentIds) {
  const area = container.querySelector('#remix-area');
  if (!area) return;
  area.style.display = 'block';
  area.querySelector('#remix-text')?.focus();

  area.querySelector('#remix-save')?.addEventListener('click', () => {
    const text = area.querySelector('#remix-text').value.trim();
    if (text) {
      sync.curateComment(commentIds, 'remix', text);
      area.style.display = 'none';
      area.querySelector('#remix-text').value = '';
    }
  });
  area.querySelector('#remix-cancel')?.addEventListener('click', () => {
    area.style.display = 'none';
    area.querySelector('#remix-text').value = '';
  });
}

function showAiRouting(container, commentIds) {
  const comments = projectManager.getComments().filter(c => commentIds.includes(c.id));
  const combined = comments.map(c => `[${c.author}]: ${c.text}`).join('\n');

  // Dispatch to AI routing component
  const event = new CustomEvent('frank:open-ai-routing', {
    detail: { commentIds, comments, combined },
  });
  window.dispatchEvent(event);
}

function esc(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }
function timeAgo(iso) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now'; if (m < 60) return m + 'm'; const h = Math.floor(m / 60);
  if (h < 24) return h + 'h'; return Math.floor(h / 24) + 'd';
}
```

- [ ] **Step 3: Create curation.css**

```css
.curation-panel { display: flex; flex-direction: column; height: 100%; padding: 16px; }
.curation-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.curation-header h3 { font-size: 14px; font-weight: 600; }
.curation-filters { display: flex; gap: 4px; margin-bottom: 12px; }
.curation-filter { padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); font-size: 11px; text-transform: capitalize; cursor: pointer; }
.curation-filter.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.curation-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.curation-empty { color: var(--text-muted); font-size: 13px; }
.curation-item { padding: 10px; border-radius: 6px; background: var(--bg-elevated); border-left: 3px solid transparent; }
.curation-item.selected { border-left-color: var(--accent); }
.curation-status-approved { border-left-color: var(--success); }
.curation-status-dismissed { border-left-color: var(--text-muted); opacity: 0.6; }
.curation-status-remixed { border-left-color: var(--warning); }
.curation-item-header { display: flex; align-items: center; gap: 6px; font-size: 13px; margin-bottom: 4px; }
.curation-check input { cursor: pointer; }
.curation-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; text-transform: uppercase; }
.curation-badge-pending { background: var(--bg-surface); color: var(--text-muted); }
.curation-badge-approved { background: rgba(74, 255, 139, 0.15); color: var(--success); }
.curation-badge-dismissed { background: rgba(255, 255, 255, 0.05); color: var(--text-muted); }
.curation-badge-remixed { background: rgba(255, 184, 74, 0.15); color: var(--warning); }
.curation-time { margin-left: auto; font-size: 11px; color: var(--text-muted); }
.curation-text { font-size: 14px; line-height: 1.4; }
.curation-anchor { display: inline-block; margin-top: 4px; font-size: 10px; font-family: monospace; color: var(--text-muted); background: var(--bg-surface); padding: 1px 4px; border-radius: 3px; }
.curation-actions { display: flex; gap: 4px; margin-top: 6px; opacity: 0; transition: opacity 0.15s; }
.curation-item:hover .curation-actions { opacity: 1; }
.curation-act { padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); font-size: 12px; cursor: pointer; }
.curation-act:hover { color: var(--text-primary); border-color: var(--accent); }
.curation-batch { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px solid var(--border); margin-top: 8px; font-size: 13px; color: var(--text-secondary); }
.curation-remix-area { border-top: 1px solid var(--border); padding-top: 12px; margin-top: 8px; }
.curation-remix-text { width: 100%; resize: none; min-height: 60px; margin-bottom: 8px; }
.curation-remix-actions { display: flex; gap: 8px; justify-content: flex-end; }
```

- [ ] **Step 4: Update index.html**

Read `ui-v2/index.html`. Add CSS link for curation:

```html
<link rel="stylesheet" href="styles/curation.css">
```

- [ ] **Step 5: Update viewer.js to use curation panel**

Read `ui-v2/views/viewer.js`. Replace the `renderComments` import and usage with `renderCuration`:

Change import:
```js
import { renderCuration } from '../components/curation.js';
```

Replace the `renderComments(sidebar, ...)` call with:
```js
  renderCuration(sidebar, {
    screenId,
    onCommentModeToggle() {
      const isActive = toggleCommentMode();
      const btn = document.querySelector('#toggle-comment-mode');
      if (btn) btn.textContent = isActive ? '✕ Cancel' : '+ Add';
    },
  });
```

Keep the `showCommentInput` import and usage in the overlay callback — that's still needed for the comment creation flow.

- [ ] **Step 6: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add ui-v2/components/curation.js ui-v2/styles/curation.css ui-v2/core/sync.js ui-v2/views/viewer.js ui-v2/index.html
git commit -m "feat(ui): curation panel — approve, dismiss, remix with status badges and batch mode"
```

---

## Task 7: AI routing — clipboard-based

Create the AI instruction editor and copy-to-clipboard flow.

**Files:**
- Create: `ui-v2/components/ai-routing.js`

- [ ] **Step 1: Create ai-routing.js**

```js
// ai-routing.js — Format curated feedback as AI instruction, copy to clipboard
import sync from '../core/sync.js';
import projectManager from '../core/project.js';

export function setupAiRouting() {
  window.addEventListener('frank:open-ai-routing', (e) => {
    const { commentIds, comments, combined } = e.detail;
    showAiRoutingModal(commentIds, comments, combined);
  });
}

function showAiRoutingModal(commentIds, comments, combined) {
  // Remove existing modal
  document.querySelector('.ai-routing-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'ai-routing-modal';
  modal.innerHTML = `
    <div class="ai-routing-overlay" id="ai-close-overlay"></div>
    <div class="ai-routing-dialog">
      <h3>Send to AI</h3>
      <div class="ai-routing-context">
        <div class="ai-routing-label">Reviewer feedback (${comments.length} comments)</div>
        <div class="ai-routing-feedback">
          ${comments.map(c => `
            <div class="ai-routing-comment">
              <strong>${esc(c.author)}:</strong> ${esc(c.text)}
              ${c.anchor?.cssSelector ? `<span class="ai-routing-anchor">${esc(c.anchor.cssSelector)}</span>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
      <div class="ai-routing-instruction">
        <div class="ai-routing-label">Your instruction to the AI (edit freely)</div>
        <textarea class="input ai-routing-textarea" id="ai-instruction" rows="5">${esc(combined)}</textarea>
      </div>
      <div class="ai-routing-actions">
        <button class="btn-ghost" id="ai-cancel">Cancel</button>
        <button class="btn-primary" id="ai-copy">Copy for AI</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('ai-close-overlay').addEventListener('click', () => modal.remove());
  document.getElementById('ai-cancel').addEventListener('click', () => modal.remove());

  document.getElementById('ai-copy').addEventListener('click', async () => {
    const instruction = document.getElementById('ai-instruction').value.trim();
    if (!instruction) return;

    // Format structured prompt
    const prompt = formatAiPrompt(comments, instruction);

    // Copy to clipboard
    await navigator.clipboard.writeText(prompt);

    // Log the instruction
    const curationIds = []; // Would need to look up curations for these comments
    await sync.logAiInstruction(commentIds, curationIds, instruction);

    // Visual feedback
    document.getElementById('ai-copy').textContent = 'Copied!';
    setTimeout(() => modal.remove(), 1000);
  });
}

function formatAiPrompt(comments, instruction) {
  const lines = [
    '## Feedback from reviewers',
    '',
  ];

  for (const c of comments) {
    lines.push(`**${c.author}** ${c.anchor?.cssSelector ? `(on \`${c.anchor.cssSelector}\`)` : ''}:`);
    lines.push(`> ${c.text}`);
    lines.push('');
  }

  lines.push('## My instruction');
  lines.push('');
  lines.push(instruction);

  return lines.join('\n');
}

function esc(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }
```

- [ ] **Step 2: Add AI routing styles to app.css**

Append to `ui-v2/styles/app.css`:

```css
/* AI routing modal */
.ai-routing-modal { position: fixed; inset: 0; z-index: 200; display: flex; align-items: center; justify-content: center; }
.ai-routing-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.6); }
.ai-routing-dialog { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px; width: 560px; max-height: 80vh; overflow-y: auto; }
.ai-routing-dialog h3 { margin-bottom: 16px; font-size: 16px; }
.ai-routing-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 6px; }
.ai-routing-feedback { background: var(--bg-surface); border-radius: 6px; padding: 12px; margin-bottom: 16px; max-height: 200px; overflow-y: auto; }
.ai-routing-comment { font-size: 13px; margin-bottom: 8px; line-height: 1.4; }
.ai-routing-comment:last-child { margin-bottom: 0; }
.ai-routing-anchor { font-family: monospace; font-size: 10px; color: var(--text-muted); background: var(--bg-elevated); padding: 1px 4px; border-radius: 3px; margin-left: 4px; }
.ai-routing-textarea { width: 100%; resize: vertical; min-height: 100px; margin-bottom: 12px; }
.ai-routing-actions { display: flex; gap: 8px; justify-content: flex-end; }
```

- [ ] **Step 3: Wire AI routing into app.js**

Read `ui-v2/app.js`. Add import and setup:

```js
import { setupAiRouting } from './components/ai-routing.js';
```

After `sync.connect()`, add:
```js
setupAiRouting();
```

- [ ] **Step 4: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add ui-v2/components/ai-routing.js ui-v2/styles/app.css ui-v2/app.js
git commit -m "feat(ui): AI routing — editable instruction editor with clipboard copy"
```

---

## Task 8: Snapshot button in toolbar + timeline view

Add a manual snapshot button and a basic timeline view.

**Files:**
- Modify: `ui-v2/components/toolbar.js` — add snapshot button
- Create: `ui-v2/views/timeline.js`
- Create: `ui-v2/styles/timeline.css`
- Modify: `ui-v2/index.html` — add timeline view + CSS
- Modify: `ui-v2/app.js` — add timeline route

- [ ] **Step 1: Add snapshot button to toolbar.js**

Read `ui-v2/components/toolbar.js`. Add a snapshot button to the toolbar HTML:

```html
<button class="toolbar-btn" id="toolbar-snapshot" title="Take snapshot">📸</button>
```

Add click handler:
```js
  container.querySelector('#toolbar-snapshot')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('frank:take-snapshot'));
  });
```

Also add a timeline button:
```html
<button class="toolbar-btn" id="toolbar-timeline" title="Timeline">📋</button>
```

- [ ] **Step 2: Handle snapshot in viewer.js**

Read `ui-v2/views/viewer.js`. Add listener for manual snapshots:

```js
  window.addEventListener('frank:take-snapshot', async () => {
    const iframe = document.querySelector('#content-iframe');
    if (!iframe) return;
    const snapshot = await captureSnapshot(iframe);
    if (snapshot) {
      await sync.saveSnapshot(snapshot.html, null, 'manual');
    }
  });
```

Note: `captureSnapshot` is already imported from Phase 2's snapshot.js.

- [ ] **Step 3: Create timeline.js**

```js
// timeline.js — Chronological view of snapshots, comments, curations, AI instructions
import sync from '../core/sync.js';
import projectManager from '../core/project.js';

export function renderTimeline(container, { onBack }) {
  container.innerHTML = `
    <div class="toolbar">
      <button class="btn-ghost" id="timeline-back">← Back</button>
      <span class="toolbar-title">Timeline</span>
      <div class="toolbar-spacer"></div>
      <button class="btn-primary" id="timeline-export">Export JSON</button>
    </div>
    <div class="timeline-body" id="timeline-body">
      <div class="viewer-loading">Loading timeline...</div>
    </div>
  `;

  container.querySelector('#timeline-back').addEventListener('click', onBack);
  container.querySelector('#timeline-export').addEventListener('click', async () => {
    const result = await sync.exportProject();
    if (result.data) {
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectManager.get()?.name || 'project'}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  });

  // Load all data
  Promise.all([
    sync.listSnapshots(),
  ]).then(([snapshotData]) => {
    const body = container.querySelector('#timeline-body');
    const comments = projectManager.getComments();
    const snapshots = snapshotData.snapshots || [];

    // Build timeline items
    const items = [];
    for (const c of comments) {
      items.push({ type: 'comment', ts: c.ts, data: c });
    }
    for (const s of snapshots) {
      items.push({ type: 'snapshot', ts: s.ts, data: s });
    }
    items.sort((a, b) => b.ts.localeCompare(a.ts));

    if (items.length === 0) {
      body.innerHTML = '<div class="timeline-empty">No activity yet</div>';
      return;
    }

    body.innerHTML = `
      <div class="timeline-list">
        ${items.map(item => {
          if (item.type === 'comment') {
            const c = item.data;
            return `
              <div class="timeline-item timeline-comment">
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                  <span class="timeline-badge">Comment</span>
                  <strong>${esc(c.author)}</strong>: ${esc(c.text)}
                  <div class="timeline-meta">${new Date(c.ts).toLocaleString()}</div>
                </div>
              </div>
            `;
          }
          if (item.type === 'snapshot') {
            const s = item.data;
            return `
              <div class="timeline-item timeline-snapshot">
                <div class="timeline-dot dot-snapshot"></div>
                <div class="timeline-content">
                  <span class="timeline-badge badge-snapshot">${s.starred ? '⭐ ' : ''}Snapshot</span>
                  ${s.label ? `<strong>${esc(s.label)}</strong> — ` : ''}${s.trigger}
                  <div class="timeline-meta">${new Date(s.ts).toLocaleString()}</div>
                </div>
              </div>
            `;
          }
          return '';
        }).join('')}
      </div>
    `;
  });
}

function esc(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }
```

- [ ] **Step 4: Create timeline.css**

```css
.timeline-body { flex: 1; overflow-y: auto; padding: 24px; max-width: 720px; margin: 0 auto; width: 100%; }
.timeline-empty { color: var(--text-muted); text-align: center; padding: 40px; }
.timeline-list { display: flex; flex-direction: column; gap: 0; border-left: 2px solid var(--border); margin-left: 12px; padding-left: 24px; }
.timeline-item { position: relative; padding: 12px 0; }
.timeline-dot { position: absolute; left: -31px; top: 16px; width: 10px; height: 10px; border-radius: 50%; background: var(--border); }
.dot-snapshot { background: var(--accent); }
.timeline-content { font-size: 14px; line-height: 1.5; }
.timeline-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--bg-elevated); color: var(--text-muted); text-transform: uppercase; margin-right: 4px; }
.badge-snapshot { background: rgba(74, 158, 255, 0.15); color: var(--accent); }
.timeline-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
```

- [ ] **Step 5: Update index.html**

Read `ui-v2/index.html`. Add timeline view container and CSS:

```html
<link rel="stylesheet" href="styles/timeline.css">
```

Add inside `#app`:
```html
<div id="view-timeline" class="view"></div>
```

- [ ] **Step 6: Update app.js with timeline route**

Read `ui-v2/app.js`. Add import:
```js
import { renderTimeline } from './views/timeline.js';
```

Add timeline view handler in `switchView`:
```js
  if (view === 'timeline') {
    renderTimeline(document.getElementById('view-timeline'), {
      onBack() { switchView('viewer'); },
    });
  }
```

Wire the timeline button (toolbar dispatches a custom event):
```js
window.addEventListener('frank:open-timeline', () => {
  if (projectManager.get()) switchView('timeline');
});
```

In toolbar.js, add click handler for timeline button:
```js
  container.querySelector('#toolbar-timeline')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('frank:open-timeline'));
  });
```

- [ ] **Step 7: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add ui-v2/components/toolbar.js ui-v2/views/viewer.js ui-v2/views/timeline.js ui-v2/styles/timeline.css ui-v2/index.html ui-v2/app.js
git commit -m "feat(ui): snapshot button, timeline view, and JSON export"
```

---

## Summary

8 tasks:
1. **Snapshot storage** — daemon module for save/list/star/delete
2. **Curation log** — daemon module for approve/dismiss/remix/batch
3. **AI chain** — daemon module for instruction logging
4. **Export** — structured JSON with unified timeline
5. **Server wiring** — WebSocket handlers + CLI export command
6. **Curation panel UI** — replaces simple comments with approve/dismiss/remix
7. **AI routing UI** — instruction editor + clipboard copy
8. **Timeline + snapshots** — snapshot button, timeline view, export button

Build order: 1-4 (daemon modules), 5 (wire into server), 6-8 (UI).

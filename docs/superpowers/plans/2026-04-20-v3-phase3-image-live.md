# v3 Phase 3 — Image Live Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire image projects to Phase 1's live-share transport. Author-side comment changes (add, delete, curate) stream to viewers in near real time. Reviewer comments already sync back to the author via Phase 1's existing `POST /api/comment` pub/sub — Phase 3 only needs to add the author→viewer direction. No UI changes to the Frank app's commenting surface are required — the daemon observes the existing `add-comment`, `delete-comment`, and `curate-comment` message handlers and forks a live push off each.

**Architecture:** Daemon-driven, same pattern as Phase 2 but simpler. The image file is immutable during a live session (it was uploaded at project creation and doesn't change), so the payload splits cleanly: `state` events carry `{ fileDataUrl, mimeType, comments }` — image bytes + current comment list; `diff` events carry just `{ comments }` because the viewer has the image cached from the most recent state event. The daemon's send-state tracker promotes a push to `state` on three triggers: first push of the session, 30+ seconds since the last state event (keeps the backend snapshot fresh for cold-open viewers), or if it's the initial push. Otherwise it sends as a diff with the comment-only payload. Cloud viewer adds a `renderImageLive(payload)` function that re-renders comment pins (from the v2 pin overlay) without rebuilding the `<img>` element, plus updates the comment list in the sidebar.

**Tech Stack:** Node.js + TypeScript (daemon), plain JS (cloud viewer), Vitest (daemon tests). No UI changes to the Frank app.

**Context:** Phases 1 and 2 are merged to `dev-v2.08` (HEAD `fcf77fd`). The v2 image + PDF share fix is also merged — image static shares now work end-to-end. Phase 3 builds live updates on top of that working foundation.

**Spec:** `/Users/carlostarrats/Downloads/frank-v3-direction.md`, "Image shares — trivial" section:

> Images barely change. The only "live" element is annotations and comments appearing. Ships in v3.0.

For Frank's image projects specifically, "annotations" means comments — pin markers with text, anchored to image coordinates. There are no other annotation types on image projects.

**Phases (recap):**
- **Phase 1 (complete):** SSE transport, revisions, rolling buffer, lifecycle primitives.
- **Phase 2 (complete):** Canvas live share — full-state + diff events, asset cache, graceful 413, precise throttle.
- **v2 image/PDF share fix (complete):** image and PDF static shares work end-to-end.
- **Phase 3 (this plan):** Image live share — author's comment changes stream to viewers.
- **Phase 4:** PDF live share (page + scroll + comments).
- **Phase 5:** Lifecycle + presence UI polish.
- **v3.1 (out of scope):** URL live share.

---

## Snapshot & diff invariants — must hold through every task

Same shape as Phase 2's invariants but adapted for image's immutable-file model:

1. **The backend's stored snapshot is ALWAYS a full state event with `fileDataUrl` + `mimeType` + current `comments`.** Diff events append to the rolling buffer; they never replace the snapshot. A viewer cold-opening a share receives the latest snapshot first, and that snapshot alone is sufficient to render image + comments.
2. **Diff events carry ONLY the changed part — the `comments` list.** Shape: `{ comments }`. The viewer has `fileDataUrl` + `mimeType` cached from the most recent state event (or from the initial v2 snapshot on cold open).
3. **The daemon promotes a push to `state` when ANY of the following are true** (otherwise sends as `diff`):
   - First push of the session (no prior state has been sent)
   - ≥ 30 seconds have elapsed since the last state event (prevents stale snapshot drift for cold-openers)
4. **The send-state tracker is per-share, not per-project.** Keyed by `shareId`. Revoke/stop/expire clears the cache entry.
5. **Only `image` project types take this path.** URL projects have no live share (deferred to v3.1). PDF projects have their own live-share path in Phase 4. Canvas is Phase 2. The server.ts hooks guard on `project.contentType === 'image'` so other types aren't accidentally wired.

---

## File Structure

### Daemon (`daemon/src/`)

```
daemon/src/
├── image-live.ts             # CREATE: payload builder — reads image file + comments
├── image-live.test.ts        # CREATE: unit tests (4 tests)
├── image-send-state.ts       # CREATE: per-share state-promotion tracker
├── image-send-state.test.ts  # CREATE: unit tests (4 tests)
├── server.ts                 # MODIFY: fork live push from add-comment / delete-comment / curate-comment handlers
└── live-share.integration.test.ts  # MODIFY: +1 test (image payload e2e)
```

### Cloud viewer (`frank-cloud/public/viewer/`)

```
frank-cloud/public/viewer/
└── viewer.js                 # MODIFY: add renderImageLive(payload) + hook frank:state/frank:diff for image shares
```

### Docs

```
README.md                     # MODIFY: update v3-in-progress section to include Phase 3
```

No daemon UI or protocol changes — the live-share message types exist from Phase 1. No bandwidth or caching additions — comment payloads are tiny (~hundreds of bytes per comment) so the existing 3 MB burst / 1 MB sustained caps have enormous headroom.

---

## Task 1: Image live-payload builder (daemon)

Build the server-side payload that a `state` event carries for image projects.

**Why daemon-side:** the image file lives on the daemon's disk (`~/.frank/projects/{id}/source/{file}`). The comments list also lives there (loaded via `loadComments(projectId)`). Putting the builder on the daemon keeps everything together and avoids a round-trip to the UI.

**Files:**
- Create: `daemon/src/image-live.ts`
- Create: `daemon/src/image-live.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// daemon/src/image-live.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('./protocol.js', async () => {
  const mod = await vi.importActual<typeof import('./protocol.js')>('./protocol.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-image-live-'));
  return { ...mod, PROJECTS_DIR: tmp };
});

import { PROJECTS_DIR } from './protocol.js';
import { buildImageLivePayload } from './image-live.js';

function mkProject(id: string, projectJson: object): void {
  const dir = path.join(PROJECTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(projectJson), 'utf8');
  fs.writeFileSync(path.join(dir, 'comments.json'), JSON.stringify([]), 'utf8');
}

function writeSourceFile(projectId: string, filename: string, bytes: Buffer): string {
  const dir = path.join(PROJECTS_DIR, projectId, 'source');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), bytes);
  return `projects/${projectId}/source/${filename}`;
}

function writeComments(projectId: string, comments: unknown[]): void {
  fs.writeFileSync(
    path.join(PROJECTS_DIR, projectId, 'comments.json'),
    JSON.stringify(comments),
    'utf8',
  );
}

describe('image-live', () => {
  beforeEach(() => {
    for (const d of fs.readdirSync(PROJECTS_DIR)) {
      fs.rmSync(path.join(PROJECTS_DIR, d), { recursive: true, force: true });
    }
  });

  it('returns null when the project has no source file', async () => {
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'image',
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      // intentionally no `file` field
    });
    expect(await buildImageLivePayload('p1')).toBeNull();
  });

  it('returns null when the source file is missing from disk', async () => {
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'image',
      file: 'projects/p1/source/missing.png',
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    // No source file written — should return null.
    expect(await buildImageLivePayload('p1')).toBeNull();
  });

  it('returns payload with inlined image + comments', async () => {
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic
    const filePath = writeSourceFile('p1', 'pic.png', pngBytes);
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'image',
      file: filePath,
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    writeComments('p1', [
      { id: 'c1', screenId: 'default', anchor: { type: 'pin', x: 10, y: 20 }, author: 'You', text: 'hi', ts: '2026-01-01T00:00:00Z', status: 'pending' },
    ]);

    const payload = await buildImageLivePayload('p1');
    expect(payload).not.toBeNull();
    expect(payload!.fileDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(payload!.mimeType).toBe('image/png');
    expect(payload!.comments).toHaveLength(1);
    expect(payload!.comments[0].text).toBe('hi');
  });

  it('derives MIME from file extension (.jpg → image/jpeg)', async () => {
    const jpgBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    const filePath = writeSourceFile('p1', 'pic.jpg', jpgBytes);
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'image',
      file: filePath,
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    const payload = await buildImageLivePayload('p1');
    expect(payload!.mimeType).toBe('image/jpeg');
    expect(payload!.fileDataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd daemon && npx vitest run src/image-live.test.ts
```

Expected: FAIL — "Cannot find module './image-live.js'".

- [ ] **Step 3: Implement `image-live.ts`**

```ts
// daemon/src/image-live.ts
import fs from 'fs';
import path from 'path';
import { PROJECTS_DIR } from './protocol.js';
import type { Comment, ProjectV2 } from './protocol.js';
import { loadComments } from './projects.js';

export interface ImageLivePayload {
  fileDataUrl: string;
  mimeType: string;
  comments: Comment[];
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

function mimeForFile(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? MIME_BY_EXT[ext] || null : null;
}

function resolveSourcePath(projectId: string, file: string): string {
  // `file` in ProjectV2 is stored as e.g. "projects/<id>/source/<name>". Rebuild
  // the path from PROJECTS_DIR so we can't be tricked into reading files
  // outside the projects directory.
  const segments = file.split('/');
  // Expected shape: ['projects', '<id>', 'source', '<filename>']
  if (segments.length !== 4 || segments[0] !== 'projects' || segments[2] !== 'source') {
    return '';
  }
  const projectIdFromPath = segments[1];
  const filename = segments[3];
  if (projectIdFromPath !== projectId) return '';
  return path.join(PROJECTS_DIR, projectId, 'source', filename);
}

function loadProjectJson(projectId: string): ProjectV2 | null {
  try {
    const raw = fs.readFileSync(path.join(PROJECTS_DIR, projectId, 'project.json'), 'utf8');
    return JSON.parse(raw) as ProjectV2;
  } catch {
    return null;
  }
}

export async function buildImageLivePayload(projectId: string): Promise<ImageLivePayload | null> {
  const project = loadProjectJson(projectId);
  if (!project || project.contentType !== 'image' || !project.file) return null;

  const sourcePath = resolveSourcePath(projectId, project.file);
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;

  const mimeType = mimeForFile(sourcePath);
  if (!mimeType) return null;

  let bytes: Buffer;
  try { bytes = fs.readFileSync(sourcePath); } catch { return null; }

  const comments = loadComments(projectId);

  return {
    fileDataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    mimeType,
    comments,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd daemon && npx vitest run src/image-live.test.ts
```

Expected: PASS — 4/4.

- [ ] **Step 5: Full suite + build**

```bash
cd daemon && npm test && npm run build
```

Expected: 168/168 (164 baseline + 4 new), build clean.

- [ ] **Step 6: Commit**

```bash
git add daemon/src/image-live.ts daemon/src/image-live.test.ts
git commit -m "$(cat <<'EOF'
feat(daemon): image live-share payload builder

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Image send-state tracker (state vs diff)

Decides whether an outgoing push goes as a full `state` (image + comments) or a lean `diff` (comments only). Same model as Phase 2's `canvas-send-state.ts` but simpler — the image is immutable so there's no "new asset" trigger, just "first push or 30s stale."

**Files:**
- Create: `daemon/src/image-send-state.ts`
- Create: `daemon/src/image-send-state.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// daemon/src/image-send-state.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { decideImageSend, __resetForTests } from './image-send-state.js';

describe('decideImageSend', () => {
  beforeEach(() => {
    __resetForTests();
    vi.useFakeTimers();
  });

  it('first push is state with full image + comments', () => {
    const decision = decideImageSend('share1', {
      fileDataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      comments: [{ id: 'c1', text: 'hi' } as any],
    });
    expect(decision.kind).toBe('state');
    expect(decision.payload.fileDataUrl).toBe('data:image/png;base64,AAA');
    expect(decision.payload.mimeType).toBe('image/png');
    expect(decision.payload.comments).toHaveLength(1);
  });

  it('second push within 30s sends as diff with comments only', () => {
    decideImageSend('share1', {
      fileDataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      comments: [{ id: 'c1', text: 'hi' } as any],
    });
    vi.advanceTimersByTime(5_000);
    const decision = decideImageSend('share1', {
      fileDataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      comments: [{ id: 'c1', text: 'hi' } as any, { id: 'c2', text: 'yo' } as any],
    });
    expect(decision.kind).toBe('diff');
    // Diff payload carries ONLY comments — no fileDataUrl, no mimeType.
    expect((decision.payload as any).fileDataUrl).toBeUndefined();
    expect((decision.payload as any).mimeType).toBeUndefined();
    expect(decision.payload.comments).toHaveLength(2);
  });

  it('promotes to state after 30s idle even with no comment changes', () => {
    decideImageSend('share1', {
      fileDataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      comments: [],
    });
    vi.advanceTimersByTime(31_000);
    const decision = decideImageSend('share1', {
      fileDataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      comments: [],
    });
    expect(decision.kind).toBe('state');
    expect(decision.payload.fileDataUrl).toBe('data:image/png;base64,AAA');
  });

  it('separate shares have independent caches', () => {
    decideImageSend('share1', {
      fileDataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      comments: [],
    });
    const decision = decideImageSend('share2', {
      fileDataUrl: 'data:image/png;base64,BBB',
      mimeType: 'image/png',
      comments: [],
    });
    expect(decision.kind).toBe('state'); // first push for share2
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd daemon && npx vitest run src/image-send-state.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `image-send-state.ts`**

```ts
// daemon/src/image-send-state.ts
// Per-share state-promotion decision for image live share. Simpler than canvas's
// send-state tracker because the image file is immutable — no "new asset"
// trigger. Promotion rules:
//   - First push of the session → state
//   - ≥ 30s since last state → state (keeps backend snapshot fresh)
//   - Otherwise → diff with comments only
//
// Why state-promotion matters: the backend-stored snapshot is overwritten only
// by `state` events. Diffs append to the rolling buffer but don't replace the
// snapshot. A cold-opening viewer reads the snapshot first, so if we only ever
// sent diffs the snapshot would drift increasingly stale. Promoting to state
// every 30 seconds bounds the drift.

import type { Comment } from './protocol.js';

export interface ImagePayloadIn {
  fileDataUrl: string;
  mimeType: string;
  comments: Comment[];
}

export type ImageSendDecision =
  | { kind: 'state'; payload: ImagePayloadIn }
  | { kind: 'diff'; payload: { comments: Comment[] } };

interface SendState {
  lastStateAt: number;
  hasSentInitial: boolean;
}

const STATE_PROMOTION_MS = Number(process.env.FRANK_STATE_PROMOTION_MS || 30_000);

const states = new Map<string, SendState>();

function getOrCreate(shareId: string): SendState {
  let s = states.get(shareId);
  if (!s) {
    s = { lastStateAt: 0, hasSentInitial: false };
    states.set(shareId, s);
  }
  return s;
}

const DEBUG = process.env.FRANK_DEBUG_LIVE_SHARE === '1';

function debug(msg: string): void {
  if (DEBUG) console.log(`[live-share] ${msg}`);
}

export function decideImageSend(shareId: string, payload: ImagePayloadIn): ImageSendDecision {
  const state = getOrCreate(shareId);
  const elapsedMs = Date.now() - state.lastStateAt;
  const stale = elapsedMs > STATE_PROMOTION_MS;

  if (!state.hasSentInitial || stale) {
    const reason = !state.hasSentInitial ? 'first push' : `${Math.round(elapsedMs / 1000)}s since last state`;
    debug(`${shareId} image → state (${reason})`);
    state.lastStateAt = Date.now();
    state.hasSentInitial = true;
    return { kind: 'state', payload };
  }

  debug(`${shareId} image → diff (comments only, ${payload.comments.length} comments)`);
  return {
    kind: 'diff',
    payload: { comments: payload.comments },
  };
}

export function clearImageSendState(shareId: string): void {
  states.delete(shareId);
}

// Test helper.
export function __resetForTests(): void {
  states.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd daemon && npx vitest run src/image-send-state.test.ts
```

Expected: PASS — 4/4.

- [ ] **Step 5: Full suite + build**

```bash
cd daemon && npm test && npm run build
```

Expected: 172/172 (168 + 4 new), build clean.

- [ ] **Step 6: Commit**

```bash
git add daemon/src/image-send-state.ts daemon/src/image-send-state.test.ts
git commit -m "$(cat <<'EOF'
feat(daemon): per-share state-promotion tracker for image live share

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Hook comment handlers to fork live push

Three existing comment handlers (`add-comment`, `delete-comment`, `curate-comment`) need to fork a live-share push when:
1. The project is an image project (Phase 4 will add PDF, Phase 2 handles canvas differently)
2. A `LiveShareController` exists for that project
3. An `activeShare` exists on the project (needed for the shareId)

The push is fire-and-forget — comment persistence must succeed regardless of live-share outcome.

**Files:**
- Modify: `daemon/src/server.ts`

- [ ] **Step 1: Add imports**

Near the other imports at the top of `daemon/src/server.ts`, add:

```ts
import { buildImageLivePayload } from './image-live.js';
import { decideImageSend, clearImageSendState } from './image-send-state.js';
```

- [ ] **Step 2: Add a shared helper for the fork**

Near the top of the file, alongside the existing `liveShareRate()` and `canvasSendStates` helpers, add:

```ts
// Phase 3: image projects fork a live push off each comment change. Phase 4
// will add PDF. Canvas doesn't use this path — it has its own canvas-state
// fork in save-canvas-state (Phase 2).
//
// Race behavior: two near-simultaneous comment events (e.g., add + curate
// firing within ~100ms) each call this function. Both call buildImageLivePayload,
// which re-reads the LATEST comments.json each time — so both pushes reflect
// post-both-events state, not pre-event state. The LiveShareController's
// pushState/pushDiff coalesces under the hood (Phase 1 `live-share.ts`:
// `this.pending = { kind, payload }` replaces any pending update; `flushTimer`
// debounces), so the backend only sees the final state, not intermediate ones.
// The first fork's call is effectively a no-op by the time the debounced
// flush fires. This is correct behavior — we want latest-wins, not
// triggering-event-wins.
async function forkImageLivePush(projectId: string): Promise<void> {
  const ctl = liveShares.get(projectId);
  if (!ctl) return;
  const project = loadProject(projectId);
  if (!project || project.contentType !== 'image' || !project.activeShare?.id) return;
  try {
    const payload = await buildImageLivePayload(projectId);
    if (!payload) return;
    const decision = decideImageSend(project.activeShare.id, payload);
    if (decision.kind === 'state') ctl.pushState(decision.payload);
    else ctl.pushDiff(decision.payload);
  } catch { /* best-effort; persistence already succeeded */ }
}
```

- [ ] **Step 3: Extend `add-comment` handler**

Find the handler at `daemon/src/server.ts:355-368`. The current shape:

```ts
    case 'add-comment': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const comment = addComment(activeProjectId, {
          screenId: msg.screenId,
          anchor: msg.anchor,
          author: 'You',
          text: msg.text,
        });
        broadcast({ type: 'comment-added', comment } as any);
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }
```

After the `broadcast(...)` call and before the catch, add a fire-and-forget fork:

```ts
    case 'add-comment': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const comment = addComment(activeProjectId, {
          screenId: msg.screenId,
          anchor: msg.anchor,
          author: 'You',
          text: msg.text,
        });
        broadcast({ type: 'comment-added', comment } as any);
        void forkImageLivePush(activeProjectId);
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }
```

- [ ] **Step 4: Extend `delete-comment` handler**

Find the handler at `daemon/src/server.ts:371-382`. After the `deleteComment(...)` call and before `reply(...)`, add the fork:

```ts
    case 'delete-comment': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        deleteComment(activeProjectId, msg.commentId);
        void forkImageLivePush(activeProjectId);
        const project = loadProject(activeProjectId);
        const comments = loadComments(activeProjectId);
        reply({ type: 'project-loaded', projectId: activeProjectId, project, comments });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }
```

- [ ] **Step 5: Extend `curate-comment` handler**

Find the handler at `daemon/src/server.ts:519-536`. After `applyCurationToComments(...)` and before the `reply(...)`/`broadcast(...)` calls, add the fork:

```ts
    case 'curate-comment': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const localComments = loadComments(activeProjectId);
        const origTexts = msg.commentIds.map(id => localComments.find(c => c.id === id)?.text || '');
        const statusMap: Record<string, 'approved' | 'dismissed' | 'remixed' | 'pending'> = {
          approve: 'approved', dismiss: 'dismissed', remix: 'remixed', batch: 'approved', reset: 'pending',
        };
        const curation = addCuration(activeProjectId, msg.commentIds, msg.action, origTexts, msg.remixedText || '', msg.dismissReason || '');
        applyCurationToComments(activeProjectId, msg.commentIds, statusMap[msg.action]);
        void forkImageLivePush(activeProjectId);
        const updatedComments = loadComments(activeProjectId);
        reply({ type: 'curation-done', curation });
        broadcast({ type: 'project-loaded', projectId: activeProjectId, project: loadProject(activeProjectId), comments: updatedComments } as any);
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }
```

- [ ] **Step 6: Clear send-state on lifecycle events (read-and-match pattern)**

Image send-state needs cleanup on stop/revoke/SIGINT, mirroring Phase 2's canvas cleanup. DO NOT assume specific line shapes — Phase 2 may have factored the cleanup into a helper or changed the surrounding code since. Instead: read the current handler, find where canvas send-state is cleared (`clearSendState(...)` from `canvas-send-state.js`), and add the image cleanup in the same pattern at the same location.

For each of the three sites below, find the canvas cleanup call and add a parallel image cleanup next to it:

**`stop-live-share` handler** — find `case 'stop-live-share':`. Locate the existing `clearSendState(...)` call from canvas-send-state. Add an image equivalent in the same conditional guard:

```ts
        // After: clearSendState(project.activeShare.id);  ← existing canvas cleanup
        clearImageSendState(project.activeShare.id);
```

**`revoke-share` handler** — same pattern. Find `case 'revoke-share':`, find the existing `clearSendState(...)`, add the image equivalent adjacent to it with the same guards.

**SIGINT handler** — find `process.on('SIGINT', ...)`. The existing handler iterates live shares and clears canvas send-state per share. Add `clearImageSendState(...)` in the same loop body, with the same guards on `project?.activeShare?.id`.

If Phase 2 refactored these into a single helper (e.g., `clearAllSendStates(shareId)` that internally calls both canvas and image clears), just extend that helper to call `clearImageSendState` too and don't touch the callers.

The key principle: match the pattern canvas uses. If canvas clears unconditionally, image clears unconditionally. If canvas clears inside a try/catch, image clears inside the same try/catch. Don't invent a new pattern.

- [ ] **Step 7: Build + full suite**

```bash
cd daemon && npm run build && npm test
```

Expected: build clean, 172/172 tests pass (no new tests; Task 5's integration test covers this wiring).

- [ ] **Step 8: Commit**

```bash
git add daemon/src/server.ts
git commit -m "$(cat <<'EOF'
feat(daemon): fork image live-share push from comment handlers

add-comment, delete-comment, and curate-comment now fork a live-share push
for image projects when a LiveShareController is active. Fire-and-forget —
comment persistence succeeds regardless of live-share outcome. Guarded on
contentType === 'image' so PDF (Phase 4) and canvas (Phase 2) aren't
accidentally wired through this path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Cloud viewer renders image live updates

The cloud viewer already renders image shares statically (after the v2 fix: `<img src="${fileDataUrl}">` + `renderCommentList(comments)`). Phase 3 adds live updates — when `frank:state` or `frank:diff` fires for an image share, update the comment list without rebuilding the image.

**Files:**
- Modify: `frank-cloud/public/viewer/viewer.js`

- [ ] **Step 1: Read the current viewer.js**

```bash
cat /Users/carlostarrats/Documents/frank/frank-cloud/public/viewer/viewer.js | head -200
```

Identify:
- The existing `renderCommentList(comments)` function (around line 139) — we'll reuse it.
- The existing module-level state from Phase 2 (`__canvasStage`, `__assetCache`) — we add `__imageCache` alongside.
- The existing `frank:state` / `frank:diff` event listeners from Phase 2 — we extend them to handle image payloads.

- [ ] **Step 2: Add module-level image cache + `renderImageLive` near the existing Phase 2 canvas render block**

Right AFTER the existing `renderCanvas()` function (Phase 2 wired it with `__canvasStage` + `__assetCache`), add:

```js
// v3 Phase 3 — image live share.
// Cache the image data URL across events. Purpose: the cold-open initial
// render writes the <img>'s src once; subsequent state events compare their
// payload.fileDataUrl against __imageCache to skip redundant `img.src =`
// assignments when the image hasn't changed (which is the 30s-promotion
// case — same image, new comments). Without the cache we'd re-assign src
// to an identical data URL on every state event, which is a no-op in
// practice but an unnecessary DOM write.
//
// If a future feature ever swaps the source image mid-session (re-upload
// through a UI that doesn't exist yet), the cache comparison correctly
// triggers a visible img.src update.
let __imageCache = null; // { fileDataUrl, mimeType } or null

function renderImageLive(payload) {
  // payload is either:
  //   state: { fileDataUrl, mimeType, comments }
  //   diff:  { comments }
  // The <img> element in #v-content stays put across events. We update the
  // src only when fileDataUrl actually changed, and re-render the comment
  // list on every event that carries comments.
  if (payload?.fileDataUrl) {
    if (__imageCache?.fileDataUrl !== payload.fileDataUrl) {
      __imageCache = { fileDataUrl: payload.fileDataUrl, mimeType: payload.mimeType };
      const img = document.querySelector('#v-content .v-image');
      if (img) img.src = payload.fileDataUrl;
    }
  }
  if (Array.isArray(payload?.comments)) {
    renderCommentList(payload.comments);
  }
}
```

- [ ] **Step 3: Extend the `frank:state` / `frank:diff` listeners**

Find the existing Phase 2 event listener (`window.addEventListener('frank:state', ...)`). It currently dispatches to `renderCanvas` when `payload?.canvasState` is present. Extend it to also dispatch to `renderImageLive` when the payload looks like an image payload:

Replace the existing Phase 2 listener:

```js
window.addEventListener('frank:state', async (e) => {
  const { contentType, payload } = e.detail;
  if (contentType === 'canvas' || (payload && payload.canvasState)) {
    await renderCanvas(payload);
  }
});
```

With:

```js
window.addEventListener('frank:state', async (e) => {
  const { contentType, payload } = e.detail;
  if (contentType === 'canvas' || (payload && payload.canvasState)) {
    await renderCanvas(payload);
  } else if (contentType === 'image' || (payload && payload.fileDataUrl && Array.isArray(payload.comments))) {
    renderImageLive(payload);
  }
});
```

And the `frank:diff` listener similarly. Find the existing Phase 2 listener and extend:

```js
window.addEventListener('frank:diff', async (e) => {
  const { payload } = e.detail;
  if (payload && payload.canvasState) {
    await renderCanvas(payload);
  } else if (payload && Array.isArray(payload.comments) && !payload.canvasState) {
    // Image diff — comments only.
    renderImageLive(payload);
  }
});
```

- [ ] **Step 4: Seed image cache on initial (v2-fix) render**

Find the existing v2-fix render branch that handles `snapshot?.fileDataUrl` (around line 77). Right after the `contentEl.innerHTML = '<img src="${esc(snapshot.fileDataUrl)}">...'` line, seed the cache so the first live `state` event (which carries the same fileDataUrl as the cold-open snapshot) doesn't trigger a redundant `img.src =` assignment:

```js
  } else if (snapshot?.fileDataUrl) {
    if (metadata.contentType === 'image') {
      contentEl.innerHTML = `<img src="${esc(snapshot.fileDataUrl)}" class="v-image" alt="Shared content">`;
      __imageCache = { fileDataUrl: snapshot.fileDataUrl, mimeType: snapshot.mimeType };
    } else if (metadata.contentType === 'pdf') {
      contentEl.innerHTML = `<iframe src="${esc(snapshot.fileDataUrl)}" class="v-iframe"></iframe>`;
    } else {
      contentEl.innerHTML = '<div class="v-error"><p>Unsupported content type</p></div>';
    }
  } else {
```

Only the image branch adds the cache-seeding line. PDF stays untouched (Phase 4's concern).

- [ ] **Step 5: Verify viewer.js parses**

```bash
node --check frank-cloud/public/viewer/viewer.js
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add frank-cloud/public/viewer/viewer.js
git commit -m "$(cat <<'EOF'
feat(cloud-viewer): renderImageLive + frank:state/frank:diff dispatch for image shares

Image state events update the <img> source (rare — image is immutable) and
refresh the comment list. Diff events carry only comments; the image stays
put and the comment list re-renders. Module-level __imageCache keeps the
mental model consistent with Phase 2's canvas cache.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Integration test — image payload e2e

Extend the existing integration-test file with one test that verifies an image payload flows through the full daemon → cloud path.

**Files:**
- Modify: `daemon/src/live-share.integration.test.ts`

- [ ] **Step 1: Add the test**

Inside the existing `describe('live share — integration with fake cloud', () => { ... })` block, after the existing tests and before the closing `});`, add:

```ts
  it('image payload flows through decide-send to the fake cloud as a state event', async () => {
    clearV2OnlyMarker();
    const liveFile = path.join(tmp, 'p1', 'live.json');
    if (fs.existsSync(liveFile)) fs.unlinkSync(liveFile);

    // Seed a project.json + source file + comments.json for p1.
    fs.writeFileSync(
      path.join(tmp, 'p1', 'project.json'),
      JSON.stringify({
        frank_version: '2',
        name: 'test',
        contentType: 'image',
        file: 'projects/p1/source/pic.png',
        screens: {},
        screenOrder: [],
        capture: false,
        activeShare: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      }),
      'utf8',
    );
    fs.mkdirSync(path.join(tmp, 'p1', 'source'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'p1', 'source', 'pic.png'),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    fs.writeFileSync(path.join(tmp, 'p1', 'comments.json'), JSON.stringify([]), 'utf8');

    const { buildImageLivePayload } = await import('./image-live.js');
    const { decideImageSend, __resetForTests } = await import('./image-send-state.js');
    __resetForTests();

    const payload = await buildImageLivePayload('p1');
    expect(payload).not.toBeNull();
    expect(payload!.mimeType).toBe('image/png');

    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 'share-image',
      contentType: 'image',
      ratePerSecond: 30,
    });
    const decision = decideImageSend('share-image', payload!);
    expect(decision.kind).toBe('state'); // first push → state
    ctl.pushState(decision.payload);
    await new Promise((r) => setTimeout(r, 250));

    const posts = fake.getPosts().filter((p) => p.shareId === 'share-image');
    expect(posts.length).toBe(1);
    expect(posts[0].type).toBe('state');
    const body = posts[0].payload as { fileDataUrl: string; mimeType: string; comments: unknown[] };
    expect(body.fileDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(body.mimeType).toBe('image/png');
    expect(body.comments).toEqual([]);
    await ctl.stop();
  });
```

- [ ] **Step 2: Run tests**

```bash
cd daemon && npx vitest run src/live-share.integration.test.ts
```

Expected: PASS — 6/6 (3 Phase 1 + 2 Phase 2 + 1 new).

- [ ] **Step 3: Full suite**

```bash
cd daemon && npm test
```

Expected: 173/173 (172 + 1 new).

- [ ] **Step 4: Commit**

```bash
git add daemon/src/live-share.integration.test.ts
git commit -m "$(cat <<'EOF'
test(daemon): integration test — image payload flows through fake cloud

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Docs — Phase 3 in README + smoke test

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update main README's v3 section**

Find the existing `## v3 — live share (in progress)` section. Replace its first paragraph with:

```markdown
## v3 — live share (in progress)

Phases 1, 2, and 3 are merged. Phase 1 shipped the transport layer (SSE streams, monotonic revisions, rolling 60-second diff buffer, viewer presence, share revocation, 2-hour session auto-pause). Phase 2 wired canvas projects — edits on the canvas view stream to viewers with daemon-side asset bundling, per-share asset cache, bandwidth caps, and graceful oversized-canvas handling. Phase 3 wires image projects — author-side comments (add, delete, curate/approve/dismiss/remix) sync to viewers in near real time. The image file itself is immutable during a session, so live updates carry only the changed comment list as `diff` events (with full state promoted every 30 seconds to keep cold-open snapshots fresh). PDF live share lands in Phase 4; URL live share is deferred to v3.1.

- Contract: [`CLOUD_API.md`](CLOUD_API.md) v3 section
- Phase 1 plan: [`docs/superpowers/plans/2026-04-19-v3-phase1-sse-foundation.md`](docs/superpowers/plans/2026-04-19-v3-phase1-sse-foundation.md)
- Phase 2 plan: [`docs/superpowers/plans/2026-04-19-v3-phase2-canvas-live.md`](docs/superpowers/plans/2026-04-19-v3-phase2-canvas-live.md)
- Phase 3 plan: [`docs/superpowers/plans/2026-04-20-v3-phase3-image-live.md`](docs/superpowers/plans/2026-04-20-v3-phase3-image-live.md)
- Reference backend env vars + setup: [`frank-cloud/README.md`](frank-cloud/README.md)
```

Preserve the existing link list (updating to add the Phase 3 entry between Phase 2 and the reference backend link).

- [ ] **Step 2: Run the smoke test**

Manual end-to-end verification. No code changes, no commit.

```bash
# 1. Start the daemon.
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
frank start

# 2. Start cloud backend against Vercel dev.
cd /Users/carlostarrats/Documents/frank/frank-cloud && npx vercel dev
```

**Image live share — viewer opens BEFORE live starts:**
1. Create an image project (drag a small PNG or JPG onto the UI).
2. Open the project, add 2–3 pin comments on the image.
3. Open the share modal (configure Settings → cloud if not already). Click "Create".
4. Click "Start live share" in the popover's live-share section.
5. In a second browser (incognito), open the share URL. Confirm the image renders with all 2–3 comments visible in the sidebar.
6. Back in the Frank app, add a new comment. Confirm the viewer tab picks it up within ~1 second.
7. Delete a comment in the app. Confirm it disappears from the viewer tab.
8. Curate (approve) a comment in the feedback panel. Confirm the viewer's comment list updates.
9. Let the session idle for ~30 seconds with no edits. Then add one more comment. The daemon console should print `[live-share] <shareId> image → state (30s since last state)` (the debug log from Task 2, visible when `FRANK_DEBUG_LIVE_SHARE=1` is set in the daemon's environment). Before this, each push should have printed `→ diff (comments only, N comments)`.
10. Click "Pause live share" in the author's popover. Confirm the viewer stops receiving updates. Click "Resume". Add a new comment. Viewer should pick it up.

**Image live share — viewer opens AFTER live has been running (cold-open-mid-session):**

This is the harder case. It verifies that a viewer cold-opening a share mid-session receives the current state (image + comments) and then continues receiving diffs, rather than getting the initial-v2-snapshot state and missing live updates.

1. Start the daemon with `FRANK_DEBUG_LIVE_SHARE=1 frank start`.
2. Create a fresh image project. Create a share. Click "Start live share".
3. In the Frank app, add 5 comments, one at a time with ~5 second gaps between them. The daemon console should show the first push as `→ state` and subsequent as `→ diff`.
4. Wait for a `→ state (30s since last state)` line in the console (or add another comment after 30s of idle to trigger it).
5. After the promoted state event, add another 2–3 comments (these go as `→ diff`).
6. NOW open the share URL in a second incognito browser for the first time. Confirm:
   - The image renders.
   - All comments from steps 3–5 are in the sidebar (not just the early ones from before the promoted state).
   - Adding one more comment in the Frank app causes the viewer to pick it up within ~1 second.

If the viewer is missing comments from between the promoted state and connect time, the rolling diff buffer aged them out (default 60s window) AND the snapshot wasn't refreshed. Either wait less than 60 seconds between step 4's promotion and step 6's viewer connect, or raise `FRANK_DIFF_BUFFER_MS` — both are legitimate test-pacing adjustments, not behavior bugs.

**Regression checks:**
1. Create a canvas project, start live share, edit shapes. Should still work exactly as before — Phase 3 didn't touch canvas.
2. Create a URL project. Share button should still work as in v2; no live-share option for URL (Phase 3 only wired image). Confirm the popover's live-share block either doesn't render for URL or shows an appropriate "live share unavailable for URL projects" state.
3. Existing PDF projects: sharing should work (via the v2 fix), but live share should NOT push updates — PDF is Phase 4. The `forkImageLivePush` guard on `contentType === 'image'` prevents cross-wiring.

- [ ] **Step 3: Commit the README update**

```bash
cd /Users/carlostarrats/Documents/frank && git add README.md && git commit -m "$(cat <<'EOF'
docs: update v3 in-progress status to include Phase 3 image live share

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Thresholds to revisit before tagging v3.0

Phase 3's numbers are mostly inherited from Phase 2, with one new knob:

| Knob | Phase 3 default | Reason to revisit |
|---|---|---|
| `FRANK_STATE_PROMOTION_MS` | 30 s | Shared with Phase 2 canvas. If cold-open viewers frequently see stale comment lists, tighten; if sustained-bandwidth pressure becomes an issue (unlikely at comment-only rates), loosen. |
| Image rate cap | 1/s (Phase 1 default for `image` contentType) | Comment edits are slow-typed; 1/s is generous. No reason to change. |
| `FRANK_STATE_MAX_BYTES` | 1 MB | Same concern as Phase 2: a large image (e.g., 2 MB PNG) as a data URL exceeds the cap and falls through to the 413-paused flow. Smoke-test a larger image to confirm the UX is acceptable ("Canvas too heavy for live share — reduce inline assets" — the existing Phase 2 error message also fits image). |

---

## Out of scope for Phase 3 (picked up later)

- **PDF live share.** Phase 4 — adds current-page + scroll-percentage + comments state.
- **URL live share.** v3.1 — architectural class change (server-visible rendering context, not just daemon).
- **Real-time comment edits (text updates).** The `curate-comment` action with `remix` updates comment text; Phase 3 handles this because curation flows through the `forkImageLivePush`. But in-place text editing (future feature — editing a comment without a curation action) would need its own handler path. Not in scope now because the feature doesn't exist yet.
- **Reviewer-side comment sync back to author.** Already works via Phase 1's existing comment pub/sub. Not re-implemented here.
- **Thumbnail / preview image generation for image shares.** Share-page cover thumbnails are a Phase 5+ polish item.
- **Delta diffs for large comment lists.** Phase 3's `diff` payload is `{ comments }` — the full current comment list, not the changed comment(s). This is efficient for small-to-medium projects (typical comment counts: 5–50). For heavy-curation sessions on projects with 500+ comments (~200 KB per diff), rapid curation clicks can push sustained bandwidth past the 1 MB/min cap. When that happens, Phase 2's existing bandwidth-cap UX kicks in: the share popover shows "Live updates throttled — catching up", and pushes resume when the sliding window catches up. Upgrading to delta diffs (`{ added, removed, updated }`) would give constant-size payloads regardless of project size; that's a Phase 5+ optimization if real-world usage shows the throttle is actually hit.

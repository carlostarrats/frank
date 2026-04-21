# v3 Phase 4a — PDF Comment Live Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire PDF projects to Phase 1's live-share transport for the subset of PDF live share that's buildable on Frank's current rendering stack: author-side comment changes (add, delete, curate) stream to viewers in near real time. The PDF file itself is immutable during a live session, same model as Phase 3's image live share. Page and scroll-position sync are deliberately deferred — see "Scope deviation from direction doc" below.

**Architecture:** Daemon-driven, same pattern as Phase 3 with PDF substituted for image. Comment handlers (`add-comment`, `delete-comment`, `curate-comment`) fork a fire-and-forget `forkPdfLivePush` when `project.contentType === 'pdf'`. The `pdf-send-state.ts` tracker decides state-vs-diff on the same triggers as image: first push OR ≥30s since last state → full state (`{ fileDataUrl, mimeType, comments }`); otherwise diff (`{ comments }`). Cloud viewer adds a `renderPdfLive(payload)` that re-renders the comment list — the `<iframe>` element rendering the PDF stays untouched across events, so graceful degradation is automatic: when live share pauses/ends, the iframe keeps rendering the static PDF and the comment list just stops updating. No Frank app UI changes.

**Tech Stack:** Node.js + TypeScript (daemon), plain JS (cloud viewer), Vitest (daemon tests). No new dependencies, no UI changes to the Frank app.

**Context:** Phases 1, 2, 3 + v2 image/PDF share fix are merged to `dev-v2.08` (HEAD `b6038ea`). PDF static shares work end-to-end via the v2 fix's inline data URL (`<iframe src="data:application/pdf;base64,...">`). Phase 4a builds comment-sync on top.

**Spec:** `/Users/carlostarrats/Downloads/frank-v3-direction.md`, "PDF shares — medium" section. See "Scope deviation" below for how Phase 4a diverges.

**Phases (recap):**
- **Phase 1 (complete):** SSE transport, revisions, rolling buffer, lifecycle primitives.
- **Phase 2 (complete):** Canvas live share.
- **v2 image/PDF share fix (complete):** image and PDF static shares work end-to-end.
- **Phase 3 (complete):** Image comment live share.
- **Phase 4a (this plan):** PDF comment live share. Parallels Phase 3 with PDF substituted.
- **Phase 4b (v3.x, post-v3.0, pre-v3.1):** Migrate PDF rendering from browser-native iframe to PDF.js. User-visible value on its own (consistent cross-browser rendering, programmable controls, better pin anchoring). Page + scroll live share becomes a natural follow-on once Frank controls the PDF render pipeline.
- **Phase 5:** Lifecycle + presence UI polish.
- **v3.1 (out of scope):** URL live share.

---

## Scope deviation from direction doc

The direction doc's PDF section says:

> State includes current page, scroll position, and annotations. Streaming page navigation and annotations is well-bounded.

Phase 4a ships **annotations only** (comments). Page and scroll-position sync are deferred to **Phase 4b (v3.x)**.

**Reason:** Frank currently renders PDFs via `<iframe src="/files/...pdf">`, relying on the browser's native PDF viewer (Chrome's PDFium, Safari's PDFKit, Firefox's built-in viewer). These viewers don't expose page/scroll events to the embedding page — `iframe.contentDocument` is null for PDFs because they're rendered by the browser's plugin layer, not as HTML. You cannot read which page the user is on, the scroll position inside the PDF, or programmatically scroll/switch pages from the parent. This holds cross-browser.

Implementing page/scroll sync on top of native PDF viewers would require either hash-URL polling hacks (Chrome-only, browser-compatibility lie) or a full rendering migration (bundle PDF.js, replace the iframe, re-anchor pins). The rendering migration is meaningful work in its own right — consistent cross-browser PDF rendering, programmable scrolling, proper page events, better pin anchoring — and it's cleaner to ship as its own phase than to bundle it with live-share work.

Phase 4a's comment-only scope ships what's actually buildable on the current stack. The rest moves to Phase 4b with honest sequencing.

**Task 6 of this plan updates the direction doc** so readers don't expect v3.0 to deliver what Phase 4a explicitly defers.

---

## Snapshot & diff invariants — must hold through every task

Mirrors Phase 3's invariants with PDF substituted for image. Re-stated here so the plan is self-contained:

1. **The backend-stored snapshot is ALWAYS a full `state` event** with `fileDataUrl` + `mimeType` + current `comments`. Diff events append to the rolling buffer; they never replace the snapshot.
2. **Diff events carry ONLY `{ comments }`.** The viewer has `fileDataUrl` + `mimeType` cached from the most recent state event (or the initial v2 snapshot on cold open).
3. **The daemon promotes a push to `state` when** first push of the session OR ≥30s since last state (otherwise sends `diff`).
4. **The send-state tracker is per-share, not per-project.** Cleared on stop/revoke/SIGINT, mirroring Phase 2's canvas cleanup + Phase 3's image cleanup.
5. **Only `pdf` project types take this path.** `forkPdfLivePush` guards on `project.contentType === 'pdf'` — canvas (Phase 2) and image (Phase 3) have their own forks.

---

## Graceful degradation (static fallback is automatic)

The cloud viewer's initial render (from the v2 fix) writes the `<iframe>` element from `snapshot.fileDataUrl` in a cold-open. Phase 4a's `renderPdfLive` only touches the comment list — it does NOT rebuild the iframe. Therefore:

- **While live share is active:** comments sync via `frank:state` / `frank:diff` events. PDF iframe stays put, renders the static PDF.
- **When live share is paused or ended:** no `frank:*` events arrive. Comment list stops updating. PDF iframe stays rendering the static PDF.
- **If the EventSource connection drops:** Phase 1's polling fallback kicks in if configured; otherwise comments freeze at last state. PDF still renders.

The architecture preserves the static share path as the fallback surface. Task 6's smoke test exercises this explicitly — pause live share mid-session and confirm the PDF keeps rendering while the comment list stops updating.

---

## v2 PDF browser-compat caveat (not Phase 4a's concern)

`<iframe src="data:application/pdf;base64,...">` rendering behavior varies by browser. Chrome handles data-URL PDFs natively; Firefox historically blocks data-URL navigation for PDFs in some configurations; Safari is generally permissive but has its own PDFKit quirks.

**This is a v2 concern, not Phase 4a's.** The v2 image/PDF share fix is what introduced data-URL PDF rendering in the cloud viewer. Phase 4a inherits whatever cross-browser baseline v2 delivered — Phase 4a layers comment sync on top without touching the iframe src or the data-URL pipeline.

**If the Phase 4a smoke test reveals rendering issues in Safari or Firefox (e.g., PDF not displaying, different page controls, missing scrollbar):** file as a **v2 follow-up**, not as a Phase 4a bug. The fix belongs alongside the v2 share fix or in Phase 4b's PDF.js migration. Phase 4a is comment-sync only.

---

## File Structure

### Daemon (`daemon/src/`)

```
daemon/src/
├── pdf-live.ts              # CREATE: payload builder — reads PDF file + comments
├── pdf-live.test.ts         # CREATE: unit tests (4 tests)
├── pdf-send-state.ts        # CREATE: per-share state-promotion tracker
├── pdf-send-state.test.ts   # CREATE: unit tests (4 tests)
├── server.ts                # MODIFY: fork PDF live push from comment handlers; extend cleanup
└── live-share.integration.test.ts  # MODIFY: +1 test (PDF payload e2e)
```

### Cloud viewer (`frank-cloud/public/viewer/`)

```
frank-cloud/public/viewer/
└── viewer.js                # MODIFY: add renderPdfLive(payload) + extend frank:state/frank:diff dispatch
```

### Docs

```
README.md                    # MODIFY: update v3-in-progress section
/Users/carlostarrats/Downloads/frank-v3-direction.md  # MODIFY: reframe PDF promise (Phase 4a ships comments; page/scroll in Phase 4b v3.x)
```

No daemon UI or protocol changes — the live-share message types exist from Phase 1. No bandwidth or caching additions beyond what Phase 3 already added; comment payloads are tiny.

---

## Task 1: PDF live-payload builder (daemon)

Mirror of Phase 3's `image-live.ts`. Reads the PDF source file + comments and returns `{ fileDataUrl, mimeType: 'application/pdf', comments }`.

**Files:**
- Create: `daemon/src/pdf-live.ts`
- Create: `daemon/src/pdf-live.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// daemon/src/pdf-live.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('./protocol.js', async () => {
  const mod = await vi.importActual<typeof import('./protocol.js')>('./protocol.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-pdf-live-'));
  return { ...mod, PROJECTS_DIR: tmp };
});

import { PROJECTS_DIR } from './protocol.js';
import { buildPdfLivePayload } from './pdf-live.js';

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

describe('pdf-live', () => {
  beforeEach(() => {
    for (const d of fs.readdirSync(PROJECTS_DIR)) {
      fs.rmSync(path.join(PROJECTS_DIR, d), { recursive: true, force: true });
    }
  });

  it('returns null when the project has no source file', async () => {
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'pdf',
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    expect(await buildPdfLivePayload('p1')).toBeNull();
  });

  it('returns null when the source file is missing from disk', async () => {
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'pdf',
      file: 'projects/p1/source/missing.pdf',
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    expect(await buildPdfLivePayload('p1')).toBeNull();
  });

  it('returns payload with inlined PDF + comments', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4\n'); // PDF magic prefix
    const filePath = writeSourceFile('p1', 'doc.pdf', pdfBytes);
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'pdf',
      file: filePath,
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    writeComments('p1', [
      { id: 'c1', screenId: 'default', anchor: { type: 'pin', x: 10, y: 20, pageNumber: 1 }, author: 'You', text: 'hi', ts: '2026-01-01T00:00:00Z', status: 'pending' },
    ]);

    const payload = await buildPdfLivePayload('p1');
    expect(payload).not.toBeNull();
    expect(payload!.fileDataUrl).toMatch(/^data:application\/pdf;base64,/);
    expect(payload!.mimeType).toBe('application/pdf');
    expect(payload!.comments).toHaveLength(1);
    expect(payload!.comments[0].text).toBe('hi');
  });

  it('accepts uppercase .PDF extension', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4\n');
    const filePath = writeSourceFile('p1', 'report.PDF', pdfBytes);
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'pdf',
      file: filePath,
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    // Trusts project.contentType === 'pdf' — uppercase extensions are valid.
    // v2 static-share rendering is permissive about extensions; live share
    // should match that permissiveness to avoid asymmetric behavior.
    const payload = await buildPdfLivePayload('p1');
    expect(payload).not.toBeNull();
    expect(payload!.mimeType).toBe('application/pdf');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/carlostarrats/Documents/frank/.worktrees/<your-worktree>/daemon && npx vitest run src/pdf-live.test.ts
```

Expected: FAIL — "Cannot find module './pdf-live.js'".

- [ ] **Step 3: Implement `pdf-live.ts`**

```ts
// daemon/src/pdf-live.ts
import fs from 'fs';
import path from 'path';
import { PROJECTS_DIR } from './protocol.js';
import type { Comment, ProjectV2 } from './protocol.js';
import { loadComments } from './projects.js';

export interface PdfLivePayload {
  fileDataUrl: string;
  mimeType: string;
  comments: Comment[];
}

function resolveSourcePath(projectId: string, file: string): string {
  // `file` in ProjectV2 is stored as e.g. "projects/<id>/source/<name>". Rebuild
  // the path from PROJECTS_DIR so we can't be tricked into reading files
  // outside the projects directory.
  const segments = file.split('/');
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

export async function buildPdfLivePayload(projectId: string): Promise<PdfLivePayload | null> {
  // Trust project.contentType === 'pdf'. The project's declared type is the
  // authoritative signal; file-extension sniffing would create false negatives
  // for legitimate PDFs stored as report.PDF, report (no extension), or files
  // renamed by the user. The v2 static-share iframe rendering is similarly
  // extension-agnostic — live share should match that permissiveness.
  const project = loadProjectJson(projectId);
  if (!project || project.contentType !== 'pdf' || !project.file) return null;

  const sourcePath = resolveSourcePath(projectId, project.file);
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;

  let bytes: Buffer;
  try { bytes = fs.readFileSync(sourcePath); } catch { return null; }

  const comments = loadComments(projectId);

  return {
    fileDataUrl: `data:application/pdf;base64,${bytes.toString('base64')}`,
    mimeType: 'application/pdf',
    comments,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd daemon && npx vitest run src/pdf-live.test.ts
```

Expected: PASS — 4/4.

- [ ] **Step 5: Full suite + build**

```bash
cd daemon && npm test && npm run build
```

Expected: 177/177 (173 baseline + 4 new), build clean.

- [ ] **Step 6: Commit (canonical trailer REQUIRED)**

```bash
git add daemon/src/pdf-live.ts daemon/src/pdf-live.test.ts
git commit -m "$(cat <<'EOF'
feat(daemon): PDF live-share payload builder

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: PDF send-state tracker

Structural mirror of Phase 3's `image-send-state.ts`. Same decision logic (first push OR ≥30s stale → state; otherwise diff), same debug log, different type name.

**Files:**
- Create: `daemon/src/pdf-send-state.ts`
- Create: `daemon/src/pdf-send-state.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// daemon/src/pdf-send-state.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { decidePdfSend, __resetForTests } from './pdf-send-state.js';

describe('decidePdfSend', () => {
  beforeEach(() => {
    __resetForTests();
    vi.useFakeTimers();
  });

  it('first push is state with full PDF + comments', () => {
    const decision = decidePdfSend('share1', {
      fileDataUrl: 'data:application/pdf;base64,AAA',
      mimeType: 'application/pdf',
      comments: [{ id: 'c1', text: 'hi' } as any],
    });
    expect(decision.kind).toBe('state');
    expect(decision.payload.fileDataUrl).toBe('data:application/pdf;base64,AAA');
    expect(decision.payload.mimeType).toBe('application/pdf');
    expect(decision.payload.comments).toHaveLength(1);
  });

  it('second push within 30s sends as diff with comments only', () => {
    decidePdfSend('share1', {
      fileDataUrl: 'data:application/pdf;base64,AAA',
      mimeType: 'application/pdf',
      comments: [{ id: 'c1', text: 'hi' } as any],
    });
    vi.advanceTimersByTime(5_000);
    const decision = decidePdfSend('share1', {
      fileDataUrl: 'data:application/pdf;base64,AAA',
      mimeType: 'application/pdf',
      comments: [{ id: 'c1', text: 'hi' } as any, { id: 'c2', text: 'yo' } as any],
    });
    expect(decision.kind).toBe('diff');
    expect((decision.payload as any).fileDataUrl).toBeUndefined();
    expect((decision.payload as any).mimeType).toBeUndefined();
    expect(decision.payload.comments).toHaveLength(2);
  });

  it('promotes to state after 30s idle even with no comment changes', () => {
    decidePdfSend('share1', {
      fileDataUrl: 'data:application/pdf;base64,AAA',
      mimeType: 'application/pdf',
      comments: [],
    });
    vi.advanceTimersByTime(31_000);
    const decision = decidePdfSend('share1', {
      fileDataUrl: 'data:application/pdf;base64,AAA',
      mimeType: 'application/pdf',
      comments: [],
    });
    expect(decision.kind).toBe('state');
    expect(decision.payload.fileDataUrl).toBe('data:application/pdf;base64,AAA');
  });

  it('separate shares have independent caches', () => {
    decidePdfSend('share1', {
      fileDataUrl: 'data:application/pdf;base64,AAA',
      mimeType: 'application/pdf',
      comments: [],
    });
    const decision = decidePdfSend('share2', {
      fileDataUrl: 'data:application/pdf;base64,BBB',
      mimeType: 'application/pdf',
      comments: [],
    });
    expect(decision.kind).toBe('state');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd daemon && npx vitest run src/pdf-send-state.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pdf-send-state.ts`**

```ts
// daemon/src/pdf-send-state.ts
// Per-share state-promotion decision for PDF live share. Mirrors
// image-send-state.ts structure — the PDF file is immutable during a session,
// so the only state-promotion triggers are "first push" and "≥30s since last
// state." Diffs carry comments only.

import type { Comment } from './protocol.js';

export interface PdfPayloadIn {
  fileDataUrl: string;
  mimeType: string;
  comments: Comment[];
}

export type PdfSendDecision =
  | { kind: 'state'; payload: PdfPayloadIn }
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

export function decidePdfSend(shareId: string, payload: PdfPayloadIn): PdfSendDecision {
  const state = getOrCreate(shareId);
  const elapsedMs = Date.now() - state.lastStateAt;
  const stale = elapsedMs > STATE_PROMOTION_MS;

  if (!state.hasSentInitial || stale) {
    const reason = !state.hasSentInitial ? 'first push' : `${Math.round(elapsedMs / 1000)}s since last state`;
    debug(`${shareId} pdf → state (${reason})`);
    state.lastStateAt = Date.now();
    state.hasSentInitial = true;
    return { kind: 'state', payload };
  }

  debug(`${shareId} pdf → diff (comments only, ${payload.comments.length} comments)`);
  return {
    kind: 'diff',
    payload: { comments: payload.comments },
  };
}

export function clearPdfSendState(shareId: string): void {
  states.delete(shareId);
}

// Test helper.
export function __resetForTests(): void {
  states.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd daemon && npx vitest run src/pdf-send-state.test.ts
```

Expected: PASS — 4/4.

- [ ] **Step 5: Full suite + build**

```bash
cd daemon && npm test && npm run build
```

Expected: 181/181 (177 + 4 new), build clean.

- [ ] **Step 6: Commit**

```bash
git add daemon/src/pdf-send-state.ts daemon/src/pdf-send-state.test.ts
git commit -m "$(cat <<'EOF'
feat(daemon): per-share state-promotion tracker for PDF live share

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Hook comment handlers to fork PDF live push

Add `forkPdfLivePush` helper + wire into the same three comment handlers Phase 3 touched. Guard on `contentType === 'pdf'`. Extend cleanup at stop-live-share / revoke-share / SIGINT using read-and-match-pattern (same as Phase 3 did for image).

**Files:**
- Modify: `daemon/src/server.ts`

- [ ] **Step 1: Add imports**

Near the other imports at the top of `daemon/src/server.ts`, add:

```ts
import { buildPdfLivePayload } from './pdf-live.js';
import { decidePdfSend, clearPdfSendState } from './pdf-send-state.js';
```

- [ ] **Step 2: Add the forkPdfLivePush helper**

Add this helper immediately after the existing `forkImageLivePush` function (Phase 3 placed that near `liveShareRate()` + `canvasSendStates`). Mirror structure exactly:

```ts
// Phase 4a: PDF projects fork a live push off each comment change. Same
// pattern as Phase 3's forkImageLivePush — the PDF file is immutable during
// a session, so comment changes drive live updates. Page/scroll sync is
// NOT implemented here (deferred to Phase 4b post-PDF.js-migration).
async function forkPdfLivePush(projectId: string): Promise<void> {
  const ctl = liveShares.get(projectId);
  if (!ctl) return;
  const project = loadProject(projectId);
  if (!project || project.contentType !== 'pdf' || !project.activeShare?.id) return;
  try {
    const payload = await buildPdfLivePayload(projectId);
    if (!payload) return;
    const decision = decidePdfSend(project.activeShare.id, payload);
    if (decision.kind === 'state') ctl.pushState(decision.payload);
    else ctl.pushDiff(decision.payload);
  } catch { /* best-effort; persistence already succeeded */ }
}
```

- [ ] **Step 3: Extend comment handlers**

Find the three comment handlers that Phase 3 already modified. Phase 3 added `void forkImageLivePush(activeProjectId);` at specific points. Add `void forkPdfLivePush(activeProjectId);` immediately AFTER each of the existing `forkImageLivePush` calls.

**add-comment handler:**

Phase 3 currently has:

```ts
        broadcast({ type: 'comment-added', comment } as any);
        void forkImageLivePush(activeProjectId);
      } catch (e: any) {
```

Change to:

```ts
        broadcast({ type: 'comment-added', comment } as any);
        void forkImageLivePush(activeProjectId);
        void forkPdfLivePush(activeProjectId);
      } catch (e: any) {
```

**delete-comment handler:**

Phase 3 currently has:

```ts
        deleteComment(activeProjectId, msg.commentId);
        void forkImageLivePush(activeProjectId);
        const project = loadProject(activeProjectId);
```

Change to:

```ts
        deleteComment(activeProjectId, msg.commentId);
        void forkImageLivePush(activeProjectId);
        void forkPdfLivePush(activeProjectId);
        const project = loadProject(activeProjectId);
```

**curate-comment handler:**

Phase 3 currently has:

```ts
        applyCurationToComments(activeProjectId, msg.commentIds, statusMap[msg.action]);
        void forkImageLivePush(activeProjectId);
        const updatedComments = loadComments(activeProjectId);
```

Change to:

```ts
        applyCurationToComments(activeProjectId, msg.commentIds, statusMap[msg.action]);
        void forkImageLivePush(activeProjectId);
        void forkPdfLivePush(activeProjectId);
        const updatedComments = loadComments(activeProjectId);
```

Each fork is fire-and-forget and guards internally on its own contentType — calling both is safe. Only one fires for a given project (the one matching `project.contentType`).

- [ ] **Step 4: Extend cleanup on lifecycle events (READ-AND-MATCH PATTERN)**

Phase 3 already clears `clearSendState` (canvas) and `clearImageSendState` (image) at three lifecycle sites. Add a parallel `clearPdfSendState(...)` call at each of the same sites. DO NOT assume specific line shapes — read the current handler structure and match.

**Approach:**

1. Grep for `clearImageSendState` to find all call sites:
   ```bash
   grep -n "clearImageSendState" daemon/src/server.ts
   ```

2. For each site, add a `clearPdfSendState(shareId)` call immediately after the `clearImageSendState` call, with the same argument and same guards.

3. If Phase 3 factored the cleanup into a shared helper (unlikely based on review feedback, but check), extend the helper to also call `clearPdfSendState`.

The three sites are `stop-live-share`, `revoke-share`, and the SIGINT handler. In each, `clearImageSendState` sits next to `clearSendState` (canvas) inside the same guard. `clearPdfSendState` joins the group as the third call.

If you see anything unexpected — factored helpers, different guard patterns, missing sites — report it before continuing.

- [ ] **Step 5: Build + full suite**

```bash
cd daemon && npm run build && npm test
```

Expected: build clean, 181/181 tests pass (no new tests here; Task 5's integration test covers this wiring).

- [ ] **Step 6: Commit**

```bash
git add daemon/src/server.ts
git commit -m "$(cat <<'EOF'
feat(daemon): fork PDF live-share push from comment handlers

add-comment, delete-comment, and curate-comment now fork a live-share push
for PDF projects when a LiveShareController is active. Fire-and-forget;
guarded on contentType === 'pdf' so image (Phase 3) and canvas (Phase 2)
aren't double-wired. Lifecycle handlers (stop-live-share, revoke-share,
SIGINT) also clear PDF send-state alongside canvas + image.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Cloud viewer renders PDF live comment updates

The cloud viewer already renders PDFs statically (v2 fix wrote `<iframe src="${fileDataUrl}">`). Phase 4a adds comment-list updates on `frank:state` / `frank:diff` events without touching the iframe.

**Files:**
- Modify: `frank-cloud/public/viewer/viewer.js`

- [ ] **Step 1: Read the existing viewer.js**

```bash
cat /Users/carlostarrats/Documents/frank/.worktrees/<your-worktree>/frank-cloud/public/viewer/viewer.js | head -200
```

Identify:
- The existing `renderCommentList(comments)` function.
- Phase 2's `__canvasStage` + `__assetCache` module state.
- Phase 3's `__imageCache` module state (added alongside Phase 2's cache cluster).
- The Phase 2 + 3 `frank:state` / `frank:diff` event listeners — we extend them to handle PDF payloads.
- The v2-fix initial render branch that handles `snapshot?.fileDataUrl` for PDF (`metadata.contentType === 'pdf'` → iframe innerHTML assignment).

- [ ] **Step 2: Add `__pdfCache` to the module-level cache cluster**

Find the existing cache declarations (Phase 2 + 3):

```js
let __canvasStage = null;
const __assetCache = {}; // url → dataUrl, merged across state + diff events

// v3 Phase 3 — image live share cache. ...
let __imageCache = null; // { fileDataUrl, mimeType } or null
```

Add `__pdfCache` immediately after, following the same structure:

```js
let __canvasStage = null;
const __assetCache = {}; // url → dataUrl, merged across state + diff events

// v3 Phase 3 — image live share cache. ...
let __imageCache = null; // { fileDataUrl, mimeType } or null

// v3 Phase 4a — PDF live share cache. Same pattern as __imageCache: cold-open
// render seeds this, and renderPdfLive compares payload.fileDataUrl against
// it to skip redundant iframe src reassignment. PDF file is immutable during
// a session so the src rarely changes; state events carry it for snapshot
// freshness, not because the PDF actually updated.
let __pdfCache = null; // { fileDataUrl, mimeType } or null
```

- [ ] **Step 3: Add `renderPdfLive` near the Phase 3 `renderImageLive` function**

Add this function immediately after `renderImageLive`. Mirror structure:

```js
// v3 Phase 4a — PDF live share renderer. Declaration of __pdfCache lives
// alongside __canvasStage / __assetCache / __imageCache above, by convention.
function renderPdfLive(payload) {
  // payload is either:
  //   state: { fileDataUrl, mimeType, comments }
  //   diff:  { comments }
  // The <iframe> element in #v-content stays put across events. The iframe
  // src only changes on true source-file swaps (rare — the PDF is immutable
  // during a session). We re-render the comment list on every event that
  // carries comments.
  if (payload?.fileDataUrl) {
    if (__pdfCache?.fileDataUrl !== payload.fileDataUrl) {
      __pdfCache = { fileDataUrl: payload.fileDataUrl, mimeType: payload.mimeType };
      const iframe = document.querySelector('#v-content .v-iframe');
      if (iframe) iframe.src = payload.fileDataUrl;
    }
  }
  if (Array.isArray(payload?.comments)) {
    renderCommentList(payload.comments);
  }
}
```

- [ ] **Step 4 (deferred to Step 5a/5b — see below)**

The frank:state and frank:diff listener changes are both handled as a coordinated unit in Steps 5a and 5b because they share a prerequisite: ensuring `contentType` is on ALL live events (state + diff). Jumping straight to "extend frank:state listener" without first securing `contentType` on diff events would leave Phase 3's image diff dispatch silently broken. Skip ahead to Step 5a.

- [ ] **Step 5a (PREREQUISITE): Ensure `contentType` is on diff events — commit separately BEFORE changing the listener**

This step is a pre-requisite because Phase 1 shipped with `contentType` on **state events only** — diff events were published without it. Phase 3's current diff listener works via payload-shape detection (`Array.isArray(payload.comments) && !payload.canvasState`) and didn't need `contentType`. But Phase 4a needs to disambiguate image vs PDF diffs, and payload-shape can't distinguish them — both are `{ comments }` only.

If we change the listener to use `contentType` BEFORE ensuring `contentType` is actually present on diff events, Phase 3's image live share breaks silently (the new `else if (contentType === 'image')` branch never matches, image comments stop syncing, and regression smoke-test step surfaces the bug — but only after commit).

**Fix `contentType` on diff events first, as its own commit.**

Read the existing publish site: `frank-cloud/api/share-state.ts`. The current publish call (from Phase 1):

```ts
await publish(shareId, type, { revision: assigned, payload });
```

Change to include `contentType` from the already-loaded meta:

```ts
await publish(shareId, type, { revision: assigned, contentType: meta.contentType, payload });
```

This change flows `contentType` into the event data the backend publishes. The SSE stream handler (`frank-cloud/api/share-stream.ts`) already forwards the data verbatim to the SSE client, so no change needed there. The cloud viewer's `initLiveShare` IIFE (`frank-cloud/public/viewer/viewer.js`) dispatches `frank:diff` with the full `data` in `detail`, so `detail.contentType` becomes available.

Verify the state-event publish path also carries `contentType` (it should — Phase 1 set this up). Grep for `publish(shareId, 'state'` or similar in `share-state.ts` to confirm. If state events also missed `contentType`, fix both in this same commit.

Commit this change on its own:

```bash
git add frank-cloud/api/share-state.ts
git commit -m "$(cat <<'EOF'
fix(cloud): include contentType on published diff events

Phase 1 shipped contentType on state events only. Phase 3's image diff
listener worked via payload-shape detection. Phase 4a needs to disambiguate
image vs PDF diffs (both are { comments } only by payload), which requires
contentType on the event detail. Adding it as a precondition so the
listener change in Phase 4a Task 4 Step 5 can rely on it without silently
breaking Phase 3 image live share.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Between this commit and Step 5b, verify Phase 3 image live share still works (image dispatch still uses payload-shape and ignores the new `contentType` field). It will — the dispatcher doesn't break on extra fields.

- [ ] **Step 5b: Simplify the `frank:state` + `frank:diff` listeners to use `contentType` alone**

With `contentType` now reliable on BOTH state and diff events, the payload-shape fallbacks in Phase 2 + 3's listeners become dead defensive code. Simplify both listeners to use `contentType` as the single discriminator. Less code, clearer intent, no regression risk because Phase 1 guarantees `contentType` on all events now.

Replace Phase 3's existing `frank:state` listener:

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

With:

```js
window.addEventListener('frank:state', async (e) => {
  const { contentType, payload } = e.detail;
  if (contentType === 'canvas') {
    await renderCanvas(payload);
  } else if (contentType === 'image') {
    renderImageLive(payload);
  } else if (contentType === 'pdf') {
    renderPdfLive(payload);
  }
});
```

Replace Phase 3's existing `frank:diff` listener:

```js
window.addEventListener('frank:diff', async (e) => {
  const { payload } = e.detail;
  if (payload && payload.canvasState) {
    await renderCanvas(payload);
  } else if (payload && Array.isArray(payload.comments) && !payload.canvasState) {
    // Image diff — comments only, image already cached.
    renderImageLive(payload);
  }
});
```

With:

```js
window.addEventListener('frank:diff', async (e) => {
  const { contentType, payload } = e.detail;
  if (contentType === 'canvas') {
    await renderCanvas(payload);
  } else if (contentType === 'image') {
    renderImageLive(payload);
  } else if (contentType === 'pdf') {
    renderPdfLive(payload);
  }
});
```

Single discriminator, no stacked strategies, no `mimeType` predicate, no payload-shape fallback. The contract layer (Phase 1) guarantees `contentType`; the dispatcher trusts it.

- [ ] **Step 6: Seed the PDF cache on cold-open**

Find the existing v2-fix cold-open render branch for PDF:

```js
    } else if (metadata.contentType === 'pdf') {
      contentEl.innerHTML = `<iframe src="${esc(snapshot.fileDataUrl)}" class="v-iframe"></iframe>`;
    }
```

Add the cache seed line:

```js
    } else if (metadata.contentType === 'pdf') {
      contentEl.innerHTML = `<iframe src="${esc(snapshot.fileDataUrl)}" class="v-iframe"></iframe>`;
      __pdfCache = { fileDataUrl: snapshot.fileDataUrl, mimeType: snapshot.mimeType };
    }
```

- [ ] **Step 7: Verify viewer.js parses**

```bash
node --check frank-cloud/public/viewer/viewer.js
```

Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add frank-cloud/public/viewer/viewer.js
git commit -m "$(cat <<'EOF'
feat(cloud-viewer): renderPdfLive + frank:state/frank:diff dispatch for PDF shares

PDF state events update the <iframe> src (rare — PDF is immutable) and
refresh the comment list. Diff events carry only comments; the iframe stays
put and the comment list re-renders. Module-level __pdfCache mirrors Phase 3's
__imageCache; seeded from the cold-open v2-fix branch so the first live state
event doesn't redundantly re-set iframe.src. Diff listener now dispatches by
contentType (from event detail) since diff payloads don't carry mimeType.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Integration test — PDF payload e2e

One new test that verifies a PDF payload flows through the full daemon → fake-cloud path.

**Files:**
- Modify: `daemon/src/live-share.integration.test.ts`

- [ ] **Step 1: Add the test**

Inside the existing `describe('live share — integration with fake cloud', () => { ... })` block, after the last existing test and before the closing `});`, add:

```ts
  it('PDF payload flows through decide-send to the fake cloud as a state event', async () => {
    clearV2OnlyMarker();
    const liveFile = path.join(tmp, 'p1', 'live.json');
    if (fs.existsSync(liveFile)) fs.unlinkSync(liveFile);

    // Seed a project.json + source file + comments.json for p1.
    fs.writeFileSync(
      path.join(tmp, 'p1', 'project.json'),
      JSON.stringify({
        frank_version: '2',
        name: 'test',
        contentType: 'pdf',
        file: 'projects/p1/source/doc.pdf',
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
      path.join(tmp, 'p1', 'source', 'doc.pdf'),
      Buffer.from('%PDF-1.4\n'),
    );
    fs.writeFileSync(path.join(tmp, 'p1', 'comments.json'), JSON.stringify([]), 'utf8');

    const { buildPdfLivePayload } = await import('./pdf-live.js');
    const { decidePdfSend, __resetForTests } = await import('./pdf-send-state.js');
    __resetForTests();

    const payload = await buildPdfLivePayload('p1');
    expect(payload).not.toBeNull();
    expect(payload!.mimeType).toBe('application/pdf');

    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 'share-pdf',
      contentType: 'pdf',
      ratePerSecond: 30,
    });
    const decision = decidePdfSend('share-pdf', payload!);
    expect(decision.kind).toBe('state');
    ctl.pushState(decision.payload);
    await new Promise((r) => setTimeout(r, 250));

    const posts = fake.getPosts().filter((p) => p.shareId === 'share-pdf');
    expect(posts.length).toBe(1);
    expect(posts[0].type).toBe('state');
    const body = posts[0].payload as { fileDataUrl: string; mimeType: string; comments: unknown[] };
    expect(body.fileDataUrl).toMatch(/^data:application\/pdf;base64,/);
    expect(body.mimeType).toBe('application/pdf');
    expect(body.comments).toEqual([]);
    await ctl.stop();
  });
```

- [ ] **Step 2: Run tests**

```bash
cd daemon && npx vitest run src/live-share.integration.test.ts
```

Expected: PASS — 7/7 (3 Phase 1 + 2 Phase 2 + 1 Phase 3 + 1 new).

- [ ] **Step 3: Full suite**

```bash
cd daemon && npm test
```

Expected: 182/182 (181 + 1 new).

- [ ] **Step 4: Commit**

```bash
git add daemon/src/live-share.integration.test.ts
git commit -m "$(cat <<'EOF'
test(daemon): integration test — PDF payload flows through fake cloud

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Docs — README + direction doc + smoke test

Two doc updates (README v3-in-progress section, direction doc PDF section reframing) + manual smoke test.

**Files:**
- Modify: `README.md`
- Modify: `/Users/carlostarrats/Downloads/frank-v3-direction.md`

- [ ] **Step 1: Update the main README's v3 section**

Find the `## v3 — live share (in progress)` section. Replace its first paragraph with:

```markdown
## v3 — live share (in progress)

Phases 1, 2, 3, and 4a are merged. Phase 1 shipped the transport layer (SSE streams, monotonic revisions, rolling 60-second diff buffer, viewer presence, share revocation, 2-hour session auto-pause). Phase 2 wired canvas projects. Phase 3 wired image projects — author-side comments (add, delete, curate) sync to viewers in near real time. Phase 4a extends the same pattern to PDF projects — PDF file stays static, comments stream live. PDF page and scroll-position sync are NOT part of v3.0 — they're deferred to Phase 4b (v3.x), which migrates PDF rendering from browser-native iframe to PDF.js and enables programmatic page/scroll control as a follow-on. URL live share is deferred to v3.1.
```

Add a Phase 4a plan link to the existing bullet list (between Phase 3 and the reference-backend link):

```markdown
- Phase 4a plan: [`docs/superpowers/plans/2026-04-20-v3-phase4a-pdf-comments-live.md`](docs/superpowers/plans/2026-04-20-v3-phase4a-pdf-comments-live.md)
```

Preserve all existing bullet entries.

- [ ] **Step 2: Update the direction doc's PDF section**

File: `/Users/carlostarrats/Downloads/frank-v3-direction.md`.

Find the section starting `### PDF shares — medium`. The current text reads (approximately):

```markdown
### PDF shares — medium

State includes current page, scroll position, and annotations. Streaming page navigation and annotations is well-bounded. No streaming of the PDF content itself — it is already delivered at share time. Ships in v3.0.
```

Replace with:

```markdown
### PDF shares — medium (split into 4a + 4b)

**v3.0 (Phase 4a): annotations only.** Comments sync live between author and viewers — add, delete, and curate actions all stream in near real time. The PDF file itself is delivered at share time and doesn't stream. This is the subset buildable on Frank's current PDF rendering stack (browser-native iframe embedding).

**v3.x (Phase 4b, post-v3.0 / pre-v3.1): page + scroll sync after PDF.js migration.** The original direction for this section assumed Frank controlled the PDF render pipeline. It doesn't — PDFs currently render in each browser's native viewer, which doesn't expose page or scroll events to the embedding page. Adding page/scroll sync requires replacing the iframe-native-viewer path with a PDF.js render, which is a meaningful rendering-infrastructure improvement on its own (consistent cross-browser rendering, programmable scrolling, better pin anchoring). Phase 4b is framed as that migration; page/scroll live sync becomes a natural follow-on once Frank controls the render.
```

The honesty pattern here is the same as the URL-live-share deferral already in the direction doc: surface what's deferred, name what will enable it, and place it in the roadmap.

- [ ] **Step 3: Run the smoke test**

Manual end-to-end verification. No commit.

The `FRANK_DEBUG_LIVE_SHARE=1` env-gated log lines referenced below come from `decidePdfSend` in `daemon/src/pdf-send-state.ts` (Task 2 of this plan) — they mirror the infrastructure Phase 3 added for `decideImageSend`. No separate debug module to install. Both modules format lines as `[live-share] <shareId> <kind> → state/diff (<reason>)`.

```bash
# 1. Start the daemon with debug logging enabled (makes state-vs-diff visible).
FRANK_DEBUG_LIVE_SHARE=1 frank start

# 2. Start cloud backend.
cd /Users/carlostarrats/Documents/frank/frank-cloud && npx vercel dev
```

**PDF live share — viewer opens BEFORE live starts:**
1. Create a PDF project (drag a small PDF onto the UI — keep it under 1 MB to stay clear of the data-URL ceiling).
2. Open the project, add 2–3 pin comments on the PDF.
3. Open the share modal. Click "Create".
4. Click "Start live share" in the popover's live-share section.
5. In a second browser (incognito), open the share URL. Confirm the PDF renders in an iframe and all 2–3 comments are visible in the sidebar.
6. Back in the Frank app, add a new comment. Confirm the viewer tab picks it up within ~1 second.
7. Delete a comment. Confirm it disappears from the viewer.
8. Curate (approve) a comment. Confirm the comment list updates.
9. Wait ~30 seconds with no edits, then add one more comment. Daemon console should print `[live-share] <shareId> pdf → state (30s since last state)`. Preceding pushes should have printed `→ diff (comments only, N comments)`.

**PDF live share — cold-open-mid-session (the harder case):**
1. Create a fresh PDF project, create a share, click "Start live share".
2. Add 5 comments over ~25 seconds (daemon console shows the first as `→ state`, rest as `→ diff`).
3. Wait for a `→ state (30s since last state)` line (or add a comment after 30s idle to trigger it).
4. Add 2–3 more comments (these go as `→ diff`).
5. NOW open the share URL in a second incognito browser for the first time. Confirm:
   - The PDF renders.
   - All comments from steps 2–4 are in the sidebar.
   - Adding one more comment causes the viewer to pick it up within ~1 second.

**Graceful degradation — static fallback works:**
1. With an active live-share session and a viewer tab open, click "Pause live share" in the author's popover.
2. Confirm in the viewer tab:
   - **The PDF iframe keeps rendering the PDF.** This is the critical check — it validates that renderPdfLive only touches comments, not the iframe.
   - The comment list stops updating — new comments added in the author's app don't appear.
3. Click "Resume live share" in the author's popover. Confirm updates resume.

**Cross-browser PDF static rendering (v2-inherited caveat):**
1. Open the share URL in at least two browsers (Chrome + one other — Firefox or Safari).
2. If the PDF renders correctly in Chrome but not in Firefox/Safari: this is a v2 browser-compat issue, not a Phase 4a bug. The PDF rendering comes from the v2-fix's inline data URL path; Phase 4a didn't introduce it. File as a v2 follow-up (or as input into Phase 4b's PDF.js migration scope), not as a blocker for Phase 4a.

**Regression checks:**
1. Canvas project — start live share, edit shapes. Should still work as in Phase 2.
2. Image project — start live share, add a comment. Should still work as in Phase 3.
3. URL project — share button should work (v2 path); no live-share option for URL (deferred to v3.1).

- [ ] **Step 4: Commit the README + direction-doc updates**

```bash
cd /Users/carlostarrats/Documents/frank && git add README.md && git commit -m "$(cat <<'EOF'
docs: update v3 in-progress status to include Phase 4a PDF comment live share

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

The direction doc lives at `/Users/carlostarrats/Downloads/frank-v3-direction.md` (outside the git repo — it's a reference doc in the user's Downloads folder). Its edit doesn't get committed anywhere — it just gets updated in place so future readers of that doc don't expect v3.0 to ship what Phase 4a defers. If the direction doc is ever moved into the repo, commit this edit then.

**Architectural note (out of scope for Phase 4a, flagging for future attention):** The direction doc lives outside the repo, so its edits aren't PR-reviewable and don't version with the code they describe. The doc has been mutated several times across Phase 1–4a planning sessions without any of those changes being reviewable in git. At some point (a separate hygiene task, not blocking any live-share phase) the direction doc should move into `docs/` so it versions with the code and shows up in reviews. Not this phase — just surfacing the limitation.

---

## Thresholds to revisit before tagging v3.0

Phase 4a inherits Phase 3's numbers:

| Knob | Phase 4a default | Reason to revisit |
|---|---|---|
| `FRANK_STATE_PROMOTION_MS` | 30 s | Shared across Phases 2, 3, 4a. One knob, three cache types. |
| PDF rate cap | 5/s (Phase 1 default for `pdf` contentType) | Comment edits are slow-typed; 5/s is generous. No reason to change. |
| `FRANK_STATE_MAX_BYTES` | 1 MB | Large PDFs (>1 MB) as data URLs exceed the cap on the FIRST push (state) and fall through to the 413-paused flow via `live-share.ts`'s existing handling. Phase 2's "Canvas too heavy" banner copy generalizes reasonably ("File too heavy for live share"), but ideally Phase 5 specializes the copy per project type. |

---

## Out of scope for Phase 4a (picked up later)

- **Page + scroll sync.** Phase 4b — requires migration from browser-native PDF viewer to PDF.js.
- **PDF.js rendering migration.** Phase 4b — a user-visible rendering improvement on its own that incidentally enables page/scroll sync.
- **URL live share.** v3.1.
- **Specialized "file too heavy for live share" messages** per project type. Phase 5 polish — the Phase 2 canvas-specific wording currently applies to image + PDF too.
- **Cross-browser PDF rendering improvements.** Inherited v2 concern — if smoke test reveals Firefox/Safari issues with data-URL iframes, that's addressed alongside the v2 fix or as part of Phase 4b's PDF.js migration (which would naturally fix cross-browser inconsistency). NOT a Phase 4a deliverable.
- **Page-aware pin anchoring.** Pins on PDFs currently anchor to iframe viewport coordinates with an optional `pageNumber` field that's not reliably populated. Phase 4b will revisit anchoring when PDF.js gives Frank real page context.

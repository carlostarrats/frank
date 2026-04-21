# v3 Phase 2 — Canvas Live Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the canvas project type to Phase 1's live-share transport — the author's Konva edits stream to viewers in near real time. After this phase, an author on Frank's canvas view can hit "Start live share" in the share popover, and anyone with the share link sees the canvas update as it's edited. Image/PDF live share stays in Phases 3–4; URL live share stays deferred to v3.1.

**Architecture:** Daemon-driven. The Frank app already sends `save-canvas-state` on every edit (debounced by the canvas view). The daemon's handler, after persisting, builds the canvas payload (`{ canvasState, assets }`) by reading the saved Konva JSON and resolving referenced `/files/...` asset URLs from disk into inline data URLs. The server then decides — based on a per-share sent-assets cache — whether to send the payload as a full `state` event (new assets referenced, or ≥30 s since last state) or as a lean `diff` event carrying just the canvas JSON. Periodic state-promotion ensures the backend's stored snapshot never drifts more than ~30 seconds stale, so cold-open viewers always render correctly. Adds byte-level bandwidth caps deferred from Phase 1 (3 MB burst / 1 MB-min sustained) with precise delay computation (no polling), a dedicated throttle timer that new edits can preempt, and a new `'throttled'` status so the share popover can render "Live updates throttled — catching up" instead of silently swallowing edits. Cloud viewer refactors its existing v2 canvas renderer into a pure `renderCanvas(payload)` function *by extracting the current pipeline* (not rewriting it) and re-invokes it on every `frank:state` / `frank:diff` CustomEvent.

**Tech Stack:** Node.js + TypeScript (daemon), Konva 9 via CDN (cloud viewer + app canvas view), plain JS ES modules (UI), Vitest (daemon tests).

**Spec:** `/Users/carlostarrats/Downloads/frank-v3-direction.md`, canvas section. Previous plan: `docs/superpowers/plans/2026-04-19-v3-phase1-sse-foundation.md` — Phase 1 is merged into `dev-v2.08` as of commit `cd09cb0`.

**Phases (recap):**
- **Phase 1 (complete):** SSE transport, revisions, rolling buffer, lifecycle primitives.
- **Phase 2 (this plan):** Canvas live share — full-state + diff events, asset cache, graceful 413, precise throttle.
- **Phase 3:** Image live share (annotations only).
- **Phase 4:** PDF live share (page + scroll + annotations).
- **Phase 5:** Lifecycle + presence UI polish (explicit revoke button, expiration picker, "N watching" consolidation, 2h-pause banner).
- **v3.1 (out of scope):** URL live share.

---

## Snapshot & diff invariants — must hold through every task

These are the rules every task enforces together. If an implementation step contradicts one of these, stop and reread.

1. **The backend's stored snapshot is ALWAYS a full state event with every currently-referenced asset inlined.** Diff events are append-only to the rolling buffer; they never replace the snapshot. A viewer cold-opening a share receives the latest snapshot first, and that snapshot alone is sufficient to render.
2. **Diff events carry ONLY changes that build on a known-good snapshot.** A Phase 2 diff payload is `{ canvasState, assets: {} }` — the canvas JSON may reference assets by URL, but the `assets` map is empty because the viewer already has them cached from the most recent state event.
3. **The daemon promotes a push to `state` when ANY of the following are true** (otherwise sends as `diff`):
   - First push of the session (no prior state has been sent)
   - The canvas JSON references an asset URL that isn't in the per-share sent-assets cache
   - ≥ 30 seconds have elapsed since the last state event (prevents stale snapshot drift)
4. **The sent-assets cache is per-share, not per-project.** Keyed by `shareId`. A revoke + new share starts with an empty cache. (Currently one share per project is enforced in the UI, but keying by `shareId` is semantically correct and robust against any future multi-share-per-project feature.)
5. **Payload-too-large (HTTP 413) is distinct from transient errors.** The daemon does not retry a 413. It pauses the controller, emits `onError('payload-too-large')`, and waits for explicit user `resume-live-share`. A single 4 MB photo blocking live share should say so, not loop forever.

---

## File Structure

### Daemon (`daemon/src/`)

```
daemon/src/
├── canvas-live.ts             # CREATE: payload builder — reads canvas-state.json + assets
├── canvas-live.test.ts        # CREATE: unit tests (5 tests)
├── canvas-send-state.ts       # CREATE: per-share send-state tracker + decideCanvasSend()
├── canvas-send-state.test.ts  # CREATE: unit tests (5 tests) for decide logic
├── server.ts                  # MODIFY: hook save-canvas-state handler, wire throttle status
├── live-share.ts              # MODIFY: precise bandwidth delay, throttle timer, 413 branch, onBandwidthStatus
├── live-share.test.ts         # MODIFY: +3 tests (precise delay, new-edit-cancel, 413)
├── live-share.integration.test.ts  # MODIFY: +2 tests (canvas e2e, push-after-resume)
└── protocol.ts                # MODIFY: add 'throttled' to LiveShareStateMessage status union
```

### Browser UI (`ui-v2/`)

```
ui-v2/
├── core/
│   └── sync.js                # MODIFY: re-emit live-share-state / -comment / share-revoked as DOM events
├── components/
│   └── share-popover.js       # MODIFY: render live-share controls + status + banners (incl. throttled)
└── styles/
    └── app.css                # MODIFY: live-share status pill, paused banner, throttled banner
```

The canvas view (`ui-v2/views/canvas.js`) does NOT change — the daemon observes `save-canvas-state` and forks the live push from there.

### Cloud viewer (`frank-cloud/public/viewer/`)

```
frank-cloud/public/viewer/
└── viewer.js                  # MODIFY: extract existing canvas render into a function + hook frank:state
```

### Docs

```
README.md                      # MODIFY: update "v3 in progress" section
docs/superpowers/plans/2026-04-19-v3-phase2-canvas-live.md  # THIS FILE
```

---

## Task 1: Canvas live-payload builder (daemon)

Build the server-side equivalent of the UI's existing `buildCanvasSnapshot()` (see `ui-v2/views/canvas.js:613`). The daemon reads the saved Konva JSON and inlines referenced assets into data URLs.

**Why daemon-side:** the UI already sends the Konva JSON on every edit via `save-canvas-state`. Re-bundling assets on the client per edit and re-serializing over the WebSocket would duplicate ~100 KB of data per push. Daemon-side bundling reads assets from local disk (already cached by OS) and keeps the WebSocket message lean.

**Files:**
- Create: `daemon/src/canvas-live.ts`
- Create: `daemon/src/canvas-live.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// daemon/src/canvas-live.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('./protocol.js', async () => {
  const mod = await vi.importActual<typeof import('./protocol.js')>('./protocol.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-canvas-live-'));
  return { ...mod, PROJECTS_DIR: tmp };
});

import { PROJECTS_DIR } from './protocol.js';
import { buildCanvasLivePayload } from './canvas-live.js';

function mkProject(id: string): string {
  const dir = path.join(PROJECTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeCanvasState(projectId: string, konvaJson: object): void {
  fs.writeFileSync(
    path.join(PROJECTS_DIR, projectId, 'canvas-state.json'),
    JSON.stringify(konvaJson),
    'utf8',
  );
}

function writeAsset(projectId: string, filename: string, bytes: Buffer): string {
  const dir = path.join(PROJECTS_DIR, projectId, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), bytes);
  return `/files/projects/${projectId}/assets/${filename}`;
}

describe('canvas-live', () => {
  beforeEach(() => {
    for (const d of fs.readdirSync(PROJECTS_DIR)) {
      fs.rmSync(path.join(PROJECTS_DIR, d), { recursive: true, force: true });
    }
  });

  it('returns null when no canvas-state.json exists', async () => {
    mkProject('p1');
    expect(await buildCanvasLivePayload('p1')).toBeNull();
  });

  it('returns empty assets map for a canvas with no images', async () => {
    mkProject('p1');
    writeCanvasState('p1', {
      className: 'Layer',
      children: [{ className: 'Rect', attrs: { x: 0, y: 0, width: 10, height: 10 } }],
    });
    const payload = await buildCanvasLivePayload('p1');
    expect(payload).not.toBeNull();
    expect(payload!.assets).toEqual({});
    expect(typeof payload!.canvasState).toBe('string');
  });

  it('inlines referenced assets as data URLs', async () => {
    mkProject('p1');
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const url = writeAsset('p1', 'abc123.png', pngBytes);
    writeCanvasState('p1', {
      className: 'Layer',
      children: [{ className: 'Image', attrs: { assetUrl: url } }],
    });
    const payload = await buildCanvasLivePayload('p1');
    expect(payload!.assets[url]).toBeDefined();
    expect(payload!.assets[url]).toMatch(/^data:image\/png;base64,/);
  });

  it('skips missing asset files without throwing', async () => {
    mkProject('p1');
    writeCanvasState('p1', {
      className: 'Layer',
      children: [{ className: 'Image', attrs: { assetUrl: '/files/projects/p1/assets/missing.png' } }],
    });
    const payload = await buildCanvasLivePayload('p1');
    expect(payload!.assets).toEqual({});
  });

  it('resolves assets referenced by nested groups', async () => {
    mkProject('p1');
    const url = writeAsset('p1', 'deep.png', Buffer.from([137, 80, 78, 71]));
    writeCanvasState('p1', {
      className: 'Layer',
      children: [{
        className: 'Group',
        children: [{ className: 'Image', attrs: { assetUrl: url } }],
      }],
    });
    const payload = await buildCanvasLivePayload('p1');
    expect(payload!.assets[url]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd daemon && npx vitest run src/canvas-live.test.ts
```

Expected: FAIL — "Cannot find module './canvas-live.js'".

- [ ] **Step 3: Implement `canvas-live.ts`**

```ts
// daemon/src/canvas-live.ts
import fs from 'fs';
import path from 'path';
import { PROJECTS_DIR } from './protocol.js';

export interface CanvasLivePayload {
  canvasState: string;
  assets: Record<string, string>;
}

const ASSET_URL_RE = /^\/files\/projects\/[^/]+\/assets\/([a-zA-Z0-9_.-]+)$/;

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

function collectAssetUrls(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const n = node as { className?: string; attrs?: { assetUrl?: string }; children?: unknown[] };
  if (n.className === 'Image' && typeof n.attrs?.assetUrl === 'string') {
    out.add(n.attrs.assetUrl);
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) collectAssetUrls(child, out);
  }
}

function resolveAssetPath(url: string): string | null {
  if (!ASSET_URL_RE.test(url)) return null;
  const segments = url.split('/');
  // Expected: ['', 'files', 'projects', '<id>', 'assets', '<filename>']
  if (segments.length !== 6) return null;
  const projectId = segments[3];
  const filename = segments[5];
  return path.join(PROJECTS_DIR, projectId, 'assets', filename);
}

export async function buildCanvasLivePayload(projectId: string): Promise<CanvasLivePayload | null> {
  const statePath = path.join(PROJECTS_DIR, projectId, 'canvas-state.json');
  if (!fs.existsSync(statePath)) return null;

  const canvasState = fs.readFileSync(statePath, 'utf8');
  let parsed: unknown;
  try { parsed = JSON.parse(canvasState); } catch { return null; }

  const urls = new Set<string>();
  collectAssetUrls(parsed, urls);

  const assets: Record<string, string> = {};
  for (const url of urls) {
    const p = resolveAssetPath(url);
    if (!p || !fs.existsSync(p)) continue;
    const mime = mimeForFile(p);
    if (!mime) continue;
    try {
      const bytes = fs.readFileSync(p);
      assets[url] = `data:${mime};base64,${bytes.toString('base64')}`;
    } catch { /* skip unreadable files */ }
  }

  return { canvasState, assets };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd daemon && npx vitest run src/canvas-live.test.ts
```

Expected: PASS — 5/5.

- [ ] **Step 5: Full suite + build**

```bash
cd daemon && npm test && npm run build
```

Expected: 153/153 pass (148 existing + 5 new), build clean.

- [ ] **Step 6: Commit**

```bash
git add daemon/src/canvas-live.ts daemon/src/canvas-live.test.ts
git commit -m "$(cat <<'EOF'
feat(daemon): canvas live-share payload builder

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Precise bandwidth caps + throttled status

Phase 1 shipped a per-second POST count cap. That's insufficient for real canvas payloads — a session at 15 POST/s × 100 KB each is 1.5 MB/s, blowing free-tier Upstash budgets. The direction doc's burst-plus-sustained model closes this.

**Enforced thresholds:**
- **Burst:** ≤ 3 MB in a 10-second sliding window (env-overridable via `FRANK_BURST_CAP_BYTES` / `FRANK_BURST_WINDOW_MS`).
- **Sustained:** ≤ 1 MB in a 60-second sliding window (env-overridable via `FRANK_SUSTAINED_CAP_BYTES` / `FRANK_SUSTAINED_WINDOW_MS`).

**Design choices:**
- **Precise delay, not polling.** When a push would exceed a cap, compute the exact time until the oldest entry in the limiting window ages out, and set a single timer for that delay — not `setTimeout(..., 1000)` spinning every second.
- **Separate throttle timer from rate-cap timer.** The existing Phase 1 `flushTimer` is for minInterval debouncing (keeps 15/s rate in check); new pushes intentionally don't reset it so coalescing works. A new `throttleTimer` handles bandwidth waits; new pushes DO reset it so a tiny edit during a throttle window can flush immediately if the smaller payload fits the remaining budget.
- **`'throttled'` as a first-class UI status.** A one-shot toast doesn't match the user's mental model ("why aren't my edits showing up?"). Instead, the controller emits `onBandwidthStatus(true)` when entering throttle and `onBandwidthStatus(false)` when clearing. `server.ts` translates this to `live-share-state: { status: 'throttled' }` / `status: 'live'`, and the share popover renders a sticky banner.

**Files:**
- Modify: `daemon/src/protocol.ts`
- Modify: `daemon/src/live-share.ts`
- Modify: `daemon/src/live-share.test.ts`
- Modify: `daemon/src/server.ts` (wire the new callback)

- [ ] **Step 1: Add `'throttled'` to the LiveShareStateMessage status union**

In `daemon/src/protocol.ts`, find the `LiveShareStateMessage` interface (Phase 1 defined it around line 363). Extend the `status` union:

```ts
export interface LiveShareStateMessage {
  type: 'live-share-state';
  projectId: string;
  // 'unsupported' = backend is v2-only (see Migration Coexistence section).
  // 'throttled' = daemon hit bandwidth cap; live is still active but current edits are buffered.
  status: 'idle' | 'connecting' | 'live' | 'paused' | 'offline' | 'error' | 'unsupported' | 'throttled';
  viewers: number;
  revision: number;
  lastError: string | null;
}
```

- [ ] **Step 2: Write the failing tests**

Add these three tests at the end of the existing `describe('LiveShareController', ...)` block in `daemon/src/live-share.test.ts`:

```ts
  it('throttles when burst cap (3 MB / 10s) is exceeded and uses precise delay', async () => {
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => ({
      acceptedRevision: body.revision,
    }));
    let throttleStarts = 0;
    let throttleClears = 0;
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 30,
      onBandwidthStatus: (throttled) => {
        if (throttled) throttleStarts++; else throttleClears++;
      },
    });
    const bigPayload = { blob: 'x'.repeat(1_000_000) };
    for (let i = 0; i < 4; i++) {
      ctl.pushState({ ...bigPayload, i });
      await vi.advanceTimersByTimeAsync(120);
    }
    expect(throttleStarts).toBe(1);
    expect((cloud.postState as any).mock.calls.length).toBeLessThanOrEqual(3);
    // Advance just past the burst window — the timer should fire at exactly that
    // moment (not on a 1-second poll). Advancing 10.1s should be enough.
    await vi.advanceTimersByTimeAsync(10_100);
    expect((cloud.postState as any).mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(throttleClears).toBe(1);
    await ctl.stop();
  });

  it('new edit during throttle cancels the pending retry if it fits the remaining budget', async () => {
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => ({
      acceptedRevision: body.revision,
    }));
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 30,
    });
    // Fill burst so the next big push gets throttled.
    const bigPayload = { blob: 'x'.repeat(1_000_000) };
    for (let i = 0; i < 3; i++) {
      ctl.pushState({ ...bigPayload, i });
      await vi.advanceTimersByTimeAsync(120);
    }
    // This fourth big push should be throttled — timer set for ~10s.
    ctl.pushState({ ...bigPayload, i: 3 });
    await vi.advanceTimersByTimeAsync(120);
    const callsAfterThrottle = (cloud.postState as any).mock.calls.length;
    // Now a tiny edit arrives. Pending is replaced with the tiny payload; the
    // throttle timer should cancel and reschedule based on the tiny size.
    // With ~0 bytes to send, the tiny edit fits immediately.
    ctl.pushState({ shapes: 42 });
    await vi.advanceTimersByTimeAsync(120);
    expect((cloud.postState as any).mock.calls.length).toBeGreaterThan(callsAfterThrottle);
    const lastCall = (cloud.postState as any).mock.calls.at(-1)[1];
    expect(lastCall.payload).toEqual({ shapes: 42 });
    await ctl.stop();
  });

  it('413 response pauses the controller without retrying', async () => {
    let calls = 0;
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => {
      calls++;
      return { error: 'payload-too-large', httpStatus: 413 };
    });
    let err = '';
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 30,
      onError: (e) => { err = e; },
    });
    ctl.pushState({ blob: 'x'.repeat(2_000_000) });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(err).toBe('payload-too-large');
    // No retry — only the one original POST.
    expect(calls).toBe(1);
    // Further pushes are dropped until resume.
    ctl.pushState({ shapes: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(1);
    await ctl.stop();
  });
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd daemon && npx vitest run src/live-share.test.ts
```

Expected: 3 new tests fail. Existing 5 continue passing.

- [ ] **Step 4: Modify `LiveShareController` — constants, options, fields**

In `daemon/src/live-share.ts`:

Add constants near the top (after the existing `SESSION_MAX_MS` line):

```ts
const BURST_WINDOW_MS = Number(process.env.FRANK_BURST_WINDOW_MS || 10_000);
const BURST_CAP_BYTES = Number(process.env.FRANK_BURST_CAP_BYTES || 3 * 1024 * 1024);
const SUSTAINED_WINDOW_MS = Number(process.env.FRANK_SUSTAINED_WINDOW_MS || 60_000);
const SUSTAINED_CAP_BYTES = Number(process.env.FRANK_SUSTAINED_CAP_BYTES || 1 * 1024 * 1024);
```

Extend `LiveShareControllerOptions` with:

```ts
  // Bandwidth throttle transitions. true = entered throttle, false = cleared.
  // Separate from onError to keep the "throttled" UX distinct from genuine errors.
  onBandwidthStatus?: (throttled: boolean) => void;
```

Add private fields to the class:

```ts
  private bandwidthLog: Array<{ ts: number; bytes: number }> = [];
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private isThrottled = false;
```

- [ ] **Step 5: Add the precise-delay helpers**

Add these methods to the class:

```ts
  private pruneBandwidth(now: number): void {
    this.bandwidthLog = this.bandwidthLog.filter((e) => now - e.ts < SUSTAINED_WINDOW_MS);
  }

  // Returns the number of ms to wait before `bytes` can be sent without
  // exceeding either cap. Zero means "send now."
  private nextAvailableDelay(bytes: number): number {
    const now = Date.now();
    this.pruneBandwidth(now);

    const burstEntries = this.bandwidthLog.filter((e) => now - e.ts < BURST_WINDOW_MS);
    const burstUsed = burstEntries.reduce((s, e) => s + e.bytes, 0);
    let burstDelay = 0;
    if (burstUsed + bytes > BURST_CAP_BYTES && burstEntries.length > 0) {
      const oldest = burstEntries[0];
      burstDelay = Math.max(0, oldest.ts + BURST_WINDOW_MS - now);
    }

    const sustainedUsed = this.bandwidthLog.reduce((s, e) => s + e.bytes, 0);
    let sustainedDelay = 0;
    if (sustainedUsed + bytes > SUSTAINED_CAP_BYTES && this.bandwidthLog.length > 0) {
      const oldest = this.bandwidthLog[0];
      sustainedDelay = Math.max(0, oldest.ts + SUSTAINED_WINDOW_MS - now);
    }

    return Math.max(burstDelay, sustainedDelay);
  }

  private recordBandwidth(bytes: number): void {
    this.bandwidthLog.push({ ts: Date.now(), bytes });
  }

  private setThrottled(state: boolean): void {
    if (this.isThrottled === state) return;
    this.isThrottled = state;
    this.opts.onBandwidthStatus?.(state);
  }
```

- [ ] **Step 6: Modify `pushState` / `pushDiff` to cancel throttle on new edits**

Replace the existing `pushState` + `pushDiff` methods with:

```ts
  pushState(payload: unknown): void {
    if (this.stopped || this.paused) return;
    if (isBackendV2Only()) return;
    this.pending = { kind: 'state', payload };
    // If we're currently waiting on a bandwidth throttle, cancel and re-evaluate.
    // A smaller payload may fit in the remaining burst budget immediately.
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.scheduleFlush();
  }

  pushDiff(payload: unknown): void {
    if (this.stopped || this.paused) return;
    if (isBackendV2Only()) return;
    if (this.pending?.kind === 'state') return;
    this.pending = { kind: 'diff', payload };
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.scheduleFlush();
  }
```

- [ ] **Step 7: Modify `flush()` — bandwidth check, 413 branch, record on success**

Replace the body of `flush()`. Find the existing method (starts with `this.flushTimer = null;`) and update it to:

```ts
  private async flush(): Promise<void> {
    this.flushTimer = null;
    if (this.stopped || !this.pending) return;
    const update = this.pending;
    this.pending = null;
    this.lastFlushAt = Date.now();

    const payloadBytes = JSON.stringify(update.payload).length;
    const delay = this.nextAvailableDelay(payloadBytes);
    if (delay > 0) {
      // Too big for the current window. Put the update back and schedule a
      // precise retry — not a polling loop.
      this.pending = update;
      this.setThrottled(true);
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        void this.flush();
      }, delay);
      return;
    }

    const rev = nextRevision(this.opts.projectId);
    const res = await postState(this.opts.shareId, {
      revision: rev,
      type: update.kind,
      payload: update.payload,
    });
    if ('error' in res && res.httpStatus === 404) {
      this.pending = null;
      this.opts.onError?.('v2-only-backend');
      this.opts.onAuthorStatus?.('ended');
      return;
    }
    if ('error' in res && res.httpStatus === 413) {
      // Payload too big for the backend's per-request cap. Distinct from
      // bandwidth throttle — we do NOT retry. Pause until the user resumes.
      this.pending = null;
      this.paused = true;
      this.opts.onError?.('payload-too-large');
      return;
    }
    if ('error' in res && res.error === 'revision-behind' && res.currentRevision) {
      saveRevision(this.opts.projectId, res.currentRevision);
      this.pending = update;
      this.scheduleFlush();
      return;
    }
    if ('error' in res) {
      this.opts.onError?.(res.error);
      this.pending = update;
      this.flushTimer = setTimeout(() => void this.flush(), 1500);
      return;
    }

    // Success. Record bandwidth usage (rejections don't count), clear throttle,
    // persist revision. The `if (this.pending) this.scheduleFlush()` line below
    // is preserved from Phase 1 — it handles updates that arrived during this
    // in-flight POST and is not specific to the bandwidth change.
    saveRevision(this.opts.projectId, res.acceptedRevision);
    this.recordBandwidth(payloadBytes);
    this.setThrottled(false);
    if (this.pending) this.scheduleFlush();
  }
```

- [ ] **Step 8: Clear throttle timer in `pause` / `stop`**

In the existing `pause()`, `stop()`, and auto-pause (inside `armSessionTimer`'s setTimeout callback), add:

```ts
    if (this.throttleTimer) { clearTimeout(this.throttleTimer); this.throttleTimer = null; }
```

alongside the existing flushTimer/sessionTimer cleanup.

- [ ] **Step 9: Run tests to verify they pass**

```bash
cd daemon && npx vitest run src/live-share.test.ts
```

Expected: 8/8 pass (5 existing + 3 new).

- [ ] **Step 10: Wire the new callback into `server.ts`**

In `daemon/src/server.ts`, find the `start-live-share` handler. In the `new LiveShareController({...})` constructor call (Phase 1 Task 13 added this), add the new `onBandwidthStatus` callback to the options object:

```ts
    onBandwidthStatus: (throttled) => broadcast(ws, {
      type: 'live-share-state',
      projectId: msg.projectId,
      status: throttled ? 'throttled' : 'live',
      viewers: ctl.viewers,
      revision: ctl.revision,
      lastError: null,
    }),
```

Place it alongside the other callbacks (e.g., after `onAuthorStatus`).

- [ ] **Step 11: Build + full suite**

```bash
cd daemon && npm run build && npm test
```

Expected: build clean, 156/156 pass (148 + 5 canvas-live + 3 bandwidth). No regressions in existing tests.

- [ ] **Step 12: Commit**

```bash
git add daemon/src/protocol.ts daemon/src/live-share.ts daemon/src/live-share.test.ts daemon/src/server.ts
git commit -m "$(cat <<'EOF'
feat(daemon): precise bandwidth caps, 'throttled' status, graceful 413

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Asset-aware push strategy (state vs diff)

The key correctness piece. Without this, every canvas edit sends all referenced assets inline, so any canvas with images blows past the 1 MB per-request cap and can't live-share at all.

**Logic (restating the invariants):**
- Per-share sent-assets cache: `Map<shareId, { sentAssets: Set<string>; lastStateAt: number; hasSentInitial: boolean }>`.
- On each push: compare the payload's `Object.keys(assets)` against `sentAssets`.
  - If any URL in the new payload is NOT in `sentAssets`, send as **state** with full assets, then update `sentAssets ← referencedAssets` and `lastStateAt ← now`.
  - Else if `now - lastStateAt > 30_000`, send as **state** with full assets (promotion — keeps backend snapshot fresh for cold opens), update `lastStateAt`.
  - Else send as **diff** with `{ canvasState, assets: {} }`. Viewer uses its cached assets from the last state event.
- Cleanup on controller stop: delete the per-share cache entry.

Cache is keyed by `shareId` (not `projectId`) per the invariants section above.

**Files:**
- Create: `daemon/src/canvas-send-state.ts`
- Create: `daemon/src/canvas-send-state.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// daemon/src/canvas-send-state.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { decideCanvasSend, clearSendState, __resetForTests } from './canvas-send-state.js';

describe('decideCanvasSend', () => {
  beforeEach(() => {
    __resetForTests();
    vi.useFakeTimers();
  });

  it('first push is always state with all assets', () => {
    const decision = decideCanvasSend('share1', {
      canvasState: '{"k":1}',
      assets: { 'url-a': 'data:image/png;base64,AAA', 'url-b': 'data:image/png;base64,BBB' },
    });
    expect(decision.kind).toBe('state');
    expect(Object.keys(decision.payload.assets)).toEqual(['url-a', 'url-b']);
  });

  it('second push with same assets sends as diff with empty assets', () => {
    decideCanvasSend('share1', {
      canvasState: '{"k":1}',
      assets: { 'url-a': 'data:image/png;base64,AAA' },
    });
    const decision = decideCanvasSend('share1', {
      canvasState: '{"k":2}',
      assets: { 'url-a': 'data:image/png;base64,AAA' },
    });
    expect(decision.kind).toBe('diff');
    expect(decision.payload.assets).toEqual({});
    expect(decision.payload.canvasState).toBe('{"k":2}');
  });

  it('new asset triggers a state push carrying full asset bundle', () => {
    decideCanvasSend('share1', {
      canvasState: '{"k":1}',
      assets: { 'url-a': 'data:image/png;base64,AAA' },
    });
    const decision = decideCanvasSend('share1', {
      canvasState: '{"k":2}',
      assets: { 'url-a': 'data:image/png;base64,AAA', 'url-b': 'data:image/png;base64,BBB' },
    });
    expect(decision.kind).toBe('state');
    expect(Object.keys(decision.payload.assets).sort()).toEqual(['url-a', 'url-b']);
  });

  it('promotes to state after 30s idle even with no asset changes', () => {
    decideCanvasSend('share1', { canvasState: '{"k":1}', assets: { 'a': 'x' } });
    const d1 = decideCanvasSend('share1', { canvasState: '{"k":2}', assets: { 'a': 'x' } });
    expect(d1.kind).toBe('diff');
    vi.advanceTimersByTime(31_000);
    const d2 = decideCanvasSend('share1', { canvasState: '{"k":3}', assets: { 'a': 'x' } });
    expect(d2.kind).toBe('state');
  });

  it('separate shares have independent caches', () => {
    decideCanvasSend('share1', { canvasState: '{"k":1}', assets: { 'a': 'x' } });
    const decision = decideCanvasSend('share2', { canvasState: '{"k":1}', assets: { 'a': 'x' } });
    expect(decision.kind).toBe('state'); // first push for share2
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd daemon && npx vitest run src/canvas-send-state.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `canvas-send-state.ts`**

```ts
// daemon/src/canvas-send-state.ts
// Per-share asset-cache + state-promotion decision. Keeps track of which assets
// have been sent on each active share so subsequent pushes can go as lean
// `diff` events (canvas JSON only) and force a full `state` only when a new
// asset appears OR when the snapshot has drifted >30s stale.

export interface CanvasPayloadIn {
  canvasState: string;
  assets: Record<string, string>;
}

export type CanvasSendDecision =
  | { kind: 'state'; payload: CanvasPayloadIn }
  | { kind: 'diff'; payload: CanvasPayloadIn };

interface SendState {
  sentAssets: Set<string>;
  lastStateAt: number;
  hasSentInitial: boolean;
}

const STATE_PROMOTION_MS = Number(process.env.FRANK_STATE_PROMOTION_MS || 30_000);

const states = new Map<string, SendState>();

function getOrCreate(shareId: string): SendState {
  let s = states.get(shareId);
  if (!s) {
    s = { sentAssets: new Set(), lastStateAt: 0, hasSentInitial: false };
    states.set(shareId, s);
  }
  return s;
}

export function decideCanvasSend(shareId: string, payload: CanvasPayloadIn): CanvasSendDecision {
  const state = getOrCreate(shareId);
  const currentAssets = new Set(Object.keys(payload.assets));

  const hasNewAsset = [...currentAssets].some((url) => !state.sentAssets.has(url));
  const stale = Date.now() - state.lastStateAt > STATE_PROMOTION_MS;

  if (!state.hasSentInitial || hasNewAsset || stale) {
    state.sentAssets = currentAssets;
    state.lastStateAt = Date.now();
    state.hasSentInitial = true;
    return { kind: 'state', payload };
  }

  return {
    kind: 'diff',
    payload: { canvasState: payload.canvasState, assets: {} },
  };
}

export function clearSendState(shareId: string): void {
  states.delete(shareId);
}

// Test helper.
export function __resetForTests(): void {
  states.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd daemon && npx vitest run src/canvas-send-state.test.ts
```

Expected: PASS — 5/5.

- [ ] **Step 5: Full suite + build**

```bash
cd daemon && npm test && npm run build
```

Expected: 161/161 (156 + 5 new), build clean.

- [ ] **Step 6: Commit**

```bash
git add daemon/src/canvas-send-state.ts daemon/src/canvas-send-state.test.ts
git commit -m "$(cat <<'EOF'
feat(daemon): per-share asset cache with 30s state-promotion for canvas diffs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Hook save-canvas-state to push live (with asset-aware decision)

Wire the daemon's existing `save-canvas-state` handler to the Phase 2 plumbing. After persisting the canvas JSON, look up the controller for this project; if found, build the full payload, run it through `decideCanvasSend`, and call `pushState` or `pushDiff` accordingly.

The existing handler uses variable name `activeProjectId` (confirmed at `daemon/src/server.ts:600`). No hedging — use that name verbatim.

**Files:**
- Modify: `daemon/src/server.ts`

- [ ] **Step 1: Add imports**

Near the other imports at the top of `daemon/src/server.ts`, add:

```ts
import { buildCanvasLivePayload } from './canvas-live.js';
import { decideCanvasSend, clearSendState } from './canvas-send-state.js';
```

- [ ] **Step 2: Modify the `save-canvas-state` handler**

Find the handler at `daemon/src/server.ts:599-608`. Replace:

```ts
    case 'save-canvas-state': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        saveCanvasState(activeProjectId, msg.state);
        reply({ type: 'canvas-state-saved' });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }
```

With:

```ts
    case 'save-canvas-state': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        saveCanvasState(activeProjectId, msg.state);

        // v3 Phase 2: fork the live-share push off the save path.
        const ctl = liveShares.get(activeProjectId);
        const project = loadProject(activeProjectId);
        const shareId = project?.activeShare?.id;
        if (ctl && shareId) {
          (async () => {
            try {
              const payload = await buildCanvasLivePayload(activeProjectId!);
              if (!payload) return;
              const decision = decideCanvasSend(shareId, payload);
              if (decision.kind === 'state') ctl.pushState(decision.payload);
              else ctl.pushDiff(decision.payload);
            } catch { /* best-effort; persistence already succeeded */ }
          })();
        }

        reply({ type: 'canvas-state-saved' });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }
```

- [ ] **Step 3: Clear send-state when live-share stops**

Find the Phase 1 `stop-live-share` handler. After the existing `ctl.pause()` line, add a send-state cleanup. Use the share ID from the loaded project:

```ts
    case 'stop-live-share': {
      const ctl = liveShares.get(msg.projectId);
      if (ctl) { ctl.pause(); }
      const project = loadProject(msg.projectId);
      if (project?.activeShare) clearSendState(project.activeShare.id);
      // ... rest of existing handler
```

Do the same in `revoke-share` (after `project.activeShare = null`) and in `SIGINT` cleanup (iterate `liveShares` and clear each corresponding send-state).

- [ ] **Step 4: Build + full suite**

```bash
cd daemon && npm run build && npm test
```

Expected: build clean, 161/161 pass.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/server.ts
git commit -m "$(cat <<'EOF'
feat(daemon): fork asset-aware live push off save-canvas-state handler

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: UI sync — dispatch live-share events

The daemon broadcasts `live-share-state`, `live-share-comment`, `share-revoked` messages over the WebSocket. The UI's WebSocket client (`ui-v2/core/sync.js`) currently routes known message types to handlers but doesn't know about these v3 messages. Add a pass-through that dispatches them as `CustomEvent`s the share popover can listen to.

**Files:**
- Modify: `ui-v2/core/sync.js`

- [ ] **Step 1: Locate the message-routing block**

```bash
grep -n "msg.type\|switch.*msg\|onMessage" ui-v2/core/sync.js
```

This identifies where incoming WebSocket messages are dispatched. Pattern is typically a switch or if/else chain on `msg.type`.

- [ ] **Step 2: Add the pass-through**

Inside the message handler, add a branch EARLY (before any fallback default case) that catches the three v3 types:

```js
  if (msg.type === 'live-share-state' || msg.type === 'live-share-comment' || msg.type === 'share-revoked') {
    window.dispatchEvent(new CustomEvent(`frank:${msg.type}`, { detail: msg }));
    return;
  }
```

If the existing routing uses a `switch`, add three `case` entries:

```js
    case 'live-share-state':
    case 'live-share-comment':
    case 'share-revoked':
      window.dispatchEvent(new CustomEvent(`frank:${msg.type}`, { detail: msg }));
      return;
```

Match the existing style. Don't refactor.

- [ ] **Step 3: Smoke test**

```bash
cd daemon && npm run build && frank start
```

Open `localhost:42068`, open DevTools console:

```js
window.addEventListener('frank:live-share-state', e => console.log('live-share-state:', e.detail));
```

No error; listener idle until Task 6 triggers it.

- [ ] **Step 4: Commit**

```bash
git add ui-v2/core/sync.js
git commit -m "$(cat <<'EOF'
feat(ui): re-emit v3 live-share WebSocket messages as DOM custom events

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Share popover — live-share controls + status (incl. throttled)

Wire the Go-Live control + status surface into the existing share popover. The popover opens from the share button. Current state: shows the share link. Phase 2 adds a row below it: a toggle between "Start live share" / "Pause" / "Resume" + a status line.

**States rendered:**
- `idle` → "Start live share" button
- `connecting` → disabled "Starting…" button
- `live` → "Pause live share" button + "Live · N watching" line
- `paused` → "Resume live share" button (+ 2h-timeout banner if `lastError === 'session-timeout-2h'`)
- `paused` + `lastError === 'payload-too-large'` → "Canvas too heavy for live share — reduce inline assets" banner + "Resume" button
- `offline` → view-only "Author offline · Reconnecting…"
- `error` → retry button + error text
- `unsupported` → "Live updates unavailable — update your backend" banner
- `throttled` → sticky "Live updates throttled — catching up" banner + "Pause" button (still live, just buffered)

**Files:**
- Modify: `ui-v2/components/share-popover.js`
- Modify: `ui-v2/styles/app.css`

- [ ] **Step 1: Read the current share-popover**

```bash
cat ui-v2/components/share-popover.js
```

Note: public export, how it's mounted, where the share-link block lives, how it currently sends WebSocket messages (so the Step 5 `sync.send(...)` call matches the file's existing pattern).

- [ ] **Step 2: Add module-level state + event listeners**

At the top of `share-popover.js` outside any function, add:

```js
const liveShareState = new Map(); // projectId → { status, viewers, lastError }

window.addEventListener('frank:live-share-state', (e) => {
  const { projectId, status, viewers, lastError } = e.detail;
  liveShareState.set(projectId, { status, viewers, lastError });
  const open = document.querySelector('.share-popover[data-project-id="' + projectId + '"]');
  if (open) rerenderLiveBlock(open, projectId);
});

window.addEventListener('frank:share-revoked', (e) => {
  liveShareState.delete(e.detail.projectId);
  const open = document.querySelector('.share-popover[data-project-id="' + e.detail.projectId + '"]');
  if (open) rerenderLiveBlock(open, e.detail.projectId);
});

function getLiveState(projectId) {
  return liveShareState.get(projectId) || { status: 'idle', viewers: 0, lastError: null };
}
```

- [ ] **Step 3: Add the live-share block renderer**

```js
function renderLiveBlock(projectId) {
  const { status, viewers, lastError } = getLiveState(projectId);

  let html = '<div class="share-live-block">';
  if (status === 'idle') {
    html += `<button type="button" class="share-live-btn" data-action="start">Start live share</button>`;
  } else if (status === 'connecting') {
    html += `<button type="button" class="share-live-btn" disabled>Starting…</button>`;
  } else if (status === 'live') {
    html += `<button type="button" class="share-live-btn" data-action="pause">Pause live share</button>`;
    const count = viewers === 1 ? '1 watching' : `${viewers} watching`;
    html += `<div class="share-live-presence">Live · ${count}</div>`;
  } else if (status === 'throttled') {
    html += `<button type="button" class="share-live-btn" data-action="pause">Pause live share</button>`;
    html += `<div class="share-live-banner">Live updates throttled — catching up.</div>`;
  } else if (status === 'paused') {
    html += `<button type="button" class="share-live-btn" data-action="resume">Resume live share</button>`;
    if (lastError === 'session-timeout-2h') {
      html += `<div class="share-live-banner">Live share paused — sessions auto-pause after 2 hours to prevent accidental long-running sessions. Click Resume to continue.</div>`;
    } else if (lastError === 'payload-too-large') {
      html += `<div class="share-live-banner error">Canvas too heavy for live share — reduce inline assets, then click Resume.</div>`;
    }
  } else if (status === 'offline') {
    html += `<div class="share-live-status">Author offline · Reconnecting…</div>`;
  } else if (status === 'error') {
    html += `<button type="button" class="share-live-btn" data-action="start">Retry live share</button>`;
    if (lastError) html += `<div class="share-live-banner error">${escapeHtml(lastError)}</div>`;
  } else if (status === 'unsupported') {
    html += `<div class="share-live-banner error">Live updates unavailable — your backend needs updating.</div>`;
  }
  html += '</div>';
  return html;
}

function rerenderLiveBlock(popoverEl, projectId) {
  const existing = popoverEl.querySelector('.share-live-block');
  if (existing) existing.outerHTML = renderLiveBlock(projectId);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = String(s);
  return div.innerHTML;
}
```

- [ ] **Step 4: Wire the block into the popover's main render**

Find the popover's main render function. Locate where it builds the HTML for the link block. Directly after that block, concatenate:

```js
  html += renderLiveBlock(project.id);
```

Where the popover element is created (e.g., `div.classList.add('share-popover')`), add:

```js
  div.setAttribute('data-project-id', project.id);
```

- [ ] **Step 5: Wire the button click handler**

After innerHTML is set on the popover element:

```js
  div.addEventListener('click', (e) => {
    const btn = e.target.closest('.share-live-btn[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'start') sync.send({ type: 'start-live-share', projectId: project.id });
    else if (action === 'pause') sync.send({ type: 'stop-live-share', projectId: project.id });
    else if (action === 'resume') sync.send({ type: 'resume-live-share', projectId: project.id });
  });
```

Adjust `sync.send(...)` to whatever the file already uses — look for existing WebSocket send calls in the file.

- [ ] **Step 6: Add CSS**

Append to `ui-v2/styles/app.css`:

```css
.share-live-block {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
}
.share-live-btn {
  width: 100%;
  padding: 8px 12px;
  background: var(--button-primary-bg, #3b82f6);
  color: var(--button-primary-text, #fff);
  border: none;
  border-radius: 6px;
  font: 13px/1 -apple-system, system-ui, sans-serif;
  cursor: pointer;
}
.share-live-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.share-live-btn:hover:not(:disabled) { filter: brightness(1.1); }
.share-live-presence {
  margin-top: 6px;
  font: 12px/1.3 -apple-system, system-ui, sans-serif;
  color: var(--text-muted, rgba(255, 255, 255, 0.7));
}
.share-live-banner {
  margin-top: 8px;
  padding: 8px 10px;
  background: rgba(255, 200, 0, 0.08);
  border: 1px solid rgba(255, 200, 0, 0.25);
  border-radius: 4px;
  font: 12px/1.35 -apple-system, system-ui, sans-serif;
  color: var(--text-muted, rgba(255, 255, 255, 0.8));
}
.share-live-banner.error {
  background: rgba(255, 100, 80, 0.08);
  border-color: rgba(255, 100, 80, 0.3);
}
.share-live-status {
  padding: 8px 10px;
  font: 12px/1.35 -apple-system, system-ui, sans-serif;
  color: var(--text-muted, rgba(255, 255, 255, 0.7));
}
```

Adjust fallback colors if `app.css` uses different variable names.

- [ ] **Step 7: Smoke test**

```bash
cd daemon && npm run build && frank start
```

Open a canvas project, click share, verify: "Start live share" button below the link. Click → "Starting…" → "Pause live share" + "Live · 0 watching". Click Pause → "Resume live share".

- [ ] **Step 8: Commit**

```bash
git add ui-v2/components/share-popover.js ui-v2/styles/app.css
git commit -m "$(cat <<'EOF'
feat(ui): share popover live-share controls, status banners, throttled state

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Cloud viewer — extract existing renderer + hook frank:state

**This task is a refactor + wire, NOT a rewrite.** The v2 viewer already renders canvas shares: it parses the snapshot's `canvasState`, pre-loads referenced images as `HTMLImageElement`s, then calls `Konva.Node.create(...)`. Phase 2's job is to pull that existing pipeline into a function `renderCanvas(payload)` and call the same function from a `frank:state` / `frank:diff` CustomEvent listener — without changing the internal loading logic.

**Why this framing matters:** Konva's deserializer expects `attrs.image` to be a loaded image object, not a URL. The v2 viewer has working async-loading code for that. Writing new loader code here would get it wrong and break rendering silently. Extract, don't rewrite.

**Files:**
- Modify: `frank-cloud/public/viewer/viewer.js`

- [ ] **Step 1: Find the existing canvas render path**

```bash
grep -n "canvasState\|Konva\|contentLayer\|new Konva" frank-cloud/public/viewer/viewer.js
```

Identify the block that (a) parses the snapshot's `canvasState`, (b) loads images for each `Image` node referencing an asset URL, and (c) creates the Konva Stage + Layer. Note the variable names it uses (e.g. `canvasState`, `assets`, etc.) and the loader function if one exists.

- [ ] **Step 2: Extract the existing code into a named async function**

Wrap the existing sequence in a new function with this signature:

```js
let __canvasStage = null; // preserved between live events so we can re-render in place

async function renderCanvas(payload) {
  // payload: { canvasState: string, assets: Record<url, dataUrl> }
  // Preserves the existing v2 logic: parse JSON → preload images → Konva.Node.create.
  if (!payload || !payload.canvasState) return;

  // KEEP the existing image-preload logic — do not replace it. If the current
  // code awaits a helper like `preloadImages(parsed, assets)`, call the same
  // helper. The goal of this refactor is to move the existing code, not change it.
  // ... <existing v2 body goes here, parameterized on `payload` instead of fetched-snapshot> ...

  // On subsequent calls, destroy the old stage contents before adding new ones,
  // so the viewer updates in place instead of creating a second stage.
  if (__canvasStage) {
    __canvasStage.destroyChildren();
    __canvasStage.add(/* the layer created from Konva.Node.create(parsed) */);
    __canvasStage.draw();
  } else {
    __canvasStage = /* the existing Stage-creation expression */;
    __canvasStage.add(/* the layer */);
    __canvasStage.draw();
  }
}
```

The `// ...existing v2 body...` comment marks where to move the current code. Read it, cut it, paste it inside `renderCanvas`. Adjust references: wherever the existing code read `snapshot.canvasState`, change to `payload.canvasState`; wherever it read `snapshot.assets`, change to `payload.assets`.

If the current code builds the stage inside an anonymous async function or inline IIFE, lift the whole thing into `renderCanvas`.

- [ ] **Step 3: Call `renderCanvas` from the existing initial-render site**

Wherever the v2 viewer previously inlined the render after fetching the snapshot from `GET /api/share?id=...`, replace with:

```js
// After fetching `data` from GET /api/share:
if (data.metadata?.contentType === 'canvas' && data.snapshot) {
  await renderCanvas(data.snapshot);
  window.__frankInitialRevision = data.snapshot.revision ?? 0;
}
```

- [ ] **Step 4: Hook `frank:state` and `frank:diff` events**

After `renderCanvas`'s definition, add:

```js
window.addEventListener('frank:state', async (e) => {
  const { contentType, payload } = e.detail;
  if (contentType === 'canvas' || (payload && payload.canvasState)) {
    await renderCanvas(payload);
  }
});

// Phase 2 canvas diffs carry { canvasState, assets: {} } — the assets are
// already cached from the previous state event, so renderCanvas just needs
// the new canvasState. But the existing image-preload logic will look for
// dataUrls in payload.assets and fall back to the cached image (if your
// preloader handles this, great; if not, it'll attempt to reload and fail
// gracefully).
window.addEventListener('frank:diff', async (e) => {
  const { payload } = e.detail;
  if (payload && payload.canvasState) {
    // Merge the cached assets so renderCanvas has what it needs.
    const merged = { ...payload, assets: { ...(window.__frankCachedAssets || {}), ...payload.assets } };
    await renderCanvas(merged);
  }
});

// Cache assets from state events for subsequent diffs.
window.addEventListener('frank:state', (e) => {
  if (e.detail?.payload?.assets) {
    window.__frankCachedAssets = { ...(window.__frankCachedAssets || {}), ...e.detail.payload.assets };
  }
});
```

Note: a single `frank:state` now has two listeners (one renders, one caches). Order matters — caching must happen regardless, so the second listener runs alongside the first. If the v2 preloader already deduplicates requests when given a URL it can't resolve, the diff fallback works cleanly.

- [ ] **Step 5: Verify viewer.js parses**

```bash
node --check frank-cloud/public/viewer/viewer.js
```

Expected: no output (valid JS).

- [ ] **Step 6: Commit**

```bash
git add frank-cloud/public/viewer/viewer.js
git commit -m "$(cat <<'EOF'
feat(cloud-viewer): extract canvas renderer, hook frank:state/frank:diff

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Integration tests — canvas e2e + push-after-resume

Extend the existing `daemon/src/live-share.integration.test.ts` with two more tests.

**Files:**
- Modify: `daemon/src/live-share.integration.test.ts`

- [ ] **Step 1: Add the canvas e2e test**

Inside the existing `describe('live share — integration with fake cloud', () => { ... })` block, add:

```ts
  it('a save-canvas-state-triggered push delivers canvas payload to the backend', async () => {
    clearV2OnlyMarker();
    const liveFile = path.join(tmp, 'p1', 'live.json');
    if (fs.existsSync(liveFile)) fs.unlinkSync(liveFile);

    // Seed a canvas-state.json so buildCanvasLivePayload has something to read.
    fs.writeFileSync(
      path.join(tmp, 'p1', 'canvas-state.json'),
      JSON.stringify({ className: 'Layer', children: [{ className: 'Rect', attrs: { x: 1 } }] }),
      'utf8',
    );

    const { buildCanvasLivePayload } = await import('./canvas-live.js');
    const { decideCanvasSend } = await import('./canvas-send-state.js');
    const payload = await buildCanvasLivePayload('p1');
    expect(payload).not.toBeNull();

    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 'share-canvas',
      contentType: 'canvas',
      ratePerSecond: 30,
    });
    const decision = decideCanvasSend('share-canvas', payload!);
    expect(decision.kind).toBe('state'); // first push → state
    ctl.pushState(decision.payload);
    await new Promise((r) => setTimeout(r, 250));

    const posts = fake.getPosts().filter((p) => p.shareId === 'share-canvas');
    expect(posts.length).toBe(1);
    expect(posts[0].type).toBe('state');
    expect((posts[0].payload as { canvasState: string }).canvasState).toContain('"Rect"');
    await ctl.stop();
  });
```

- [ ] **Step 2: Add the push-after-resume test**

Right after the e2e test:

```ts
  it('pushState after resume delivers to backend (not dropped by paused state)', async () => {
    clearV2OnlyMarker();
    const liveFile = path.join(tmp, 'p1', 'live.json');
    if (fs.existsSync(liveFile)) fs.unlinkSync(liveFile);

    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 'share-resume',
      contentType: 'canvas',
      ratePerSecond: 30,
    });
    ctl.pause();
    ctl.pushState({ step: 'during-pause' });
    await new Promise((r) => setTimeout(r, 200));
    const beforeResume = fake.getPosts().filter((p) => p.shareId === 'share-resume').length;
    expect(beforeResume).toBe(0); // paused drops the push

    ctl.resume();
    ctl.pushState({ step: 'after-resume' });
    await new Promise((r) => setTimeout(r, 250));
    const afterResume = fake.getPosts().filter((p) => p.shareId === 'share-resume');
    expect(afterResume.length).toBe(1);
    expect(afterResume[0].payload).toEqual({ step: 'after-resume' });
    await ctl.stop();
  });
```

- [ ] **Step 3: Run tests**

```bash
cd daemon && npx vitest run src/live-share.integration.test.ts
```

Expected: PASS 5/5 (3 Phase 1 + 2 new).

- [ ] **Step 4: Full suite**

```bash
cd daemon && npm test
```

Expected: 163/163 (161 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add daemon/src/live-share.integration.test.ts
git commit -m "$(cat <<'EOF'
test(daemon): integration tests — canvas e2e + push-after-resume

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Docs — Phase 2 in README + smoke test

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update main README's v3 section**

Find the "v3 — live share (in progress)" section added in Phase 1. Replace its first paragraph with:

```markdown
## v3 — live share (in progress)

Phases 1 and 2 are merged. Phase 1 shipped the transport layer (SSE streams, monotonic revisions, rolling 60-second diff buffer, viewer presence, share revocation, 2-hour session auto-pause). Phase 2 wires the canvas project type onto that transport: edits on the canvas view stream to any viewer in near real time, with daemon-side asset bundling + per-share asset cache (only new assets re-sent), 30-second state-promotion so cold-open viewers always see a fresh snapshot, 3 MB / 1 MB-min bandwidth caps with precise-delay throttling and a sticky `throttled` UI status, graceful handling of oversized-canvas (413) as a distinct paused state, and a "Start live share" control in the share popover. Image and PDF live share land in phases 3 and 4; URL live share is deferred to v3.1.

- Contract: [`CLOUD_API.md`](CLOUD_API.md) v3 section
- Phase 1 plan: [`docs/superpowers/plans/2026-04-19-v3-phase1-sse-foundation.md`](docs/superpowers/plans/2026-04-19-v3-phase1-sse-foundation.md)
- Phase 2 plan: [`docs/superpowers/plans/2026-04-19-v3-phase2-canvas-live.md`](docs/superpowers/plans/2026-04-19-v3-phase2-canvas-live.md)
- Reference backend env vars + setup: [`frank-cloud/README.md`](frank-cloud/README.md)
```

- [ ] **Step 2: Run the smoke test**

Manual verification — no code changes, no commit:

```bash
# 1. Start the daemon.
cd daemon && npm run build
frank start

# 2. Start the cloud backend against Vercel dev.
cd frank-cloud && npx vercel dev

# 3. In Frank, create a canvas project, configure Settings → cloud backend
#    (http://localhost:3000, FRANK_API_KEY). Hit Share → create a share →
#    click "Start live share".

# 4. In a second browser tab (incognito), open the share URL. Confirm the
#    canvas renders.

# 5. Author tab: add shapes, move shapes, type text. Confirm the viewer tab
#    updates within ~1 second per edit.

# 6. Drop an image onto the canvas. Confirm it appears in the viewer.
#    (First push with the image will be a `state` event with the image;
#    subsequent edits of other shapes should be `diff` events — check the
#    browser console in viewer tab or tail KV entries to confirm.)

# 7. Drop a large image (~2 MB). Confirm one of:
#      a) It works (payload fit under 1 MB cap, maybe compressed).
#      b) The share popover shows "Canvas too heavy for live share..." and
#         Resume is offered. This is expected behavior when 413 fires.

# 8. Edit rapidly for ~10 seconds with several images present. Confirm the
#    share popover shows "Live updates throttled — catching up" at some
#    point if bandwidth caps engage, and that it recovers to "Live · N
#    watching" when the window slides.

# 9. Click Pause live share → confirm viewer tab sees the offline/ended state.
#    Click Resume → confirm viewer resumes receiving updates.

# 10. Leave edit loop running for past the session-max (or set
#     FRANK_SESSION_MAX_MS=60000 for a 1-minute test). Confirm the
#     auto-pause banner appears with the verbatim copy:
#     "Live share paused — sessions auto-pause after 2 hours to prevent
#      accidental long-running sessions. Click Resume to continue."
```

If any step fails, check the daemon console for `buildCanvasLivePayload` errors, the browser console in the viewer tab for `frank:state` / `frank:diff` events, and KV for the stored snapshot shape.

- [ ] **Step 3: Commit the README update**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: update v3 in-progress status to include Phase 2 canvas live share

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Thresholds to revisit before tagging v3.0

Phase 2 is the first real-payload test of the numbers.

| Knob | Phase 2 default | Reason to revisit |
|---|---|---|
| `FRANK_BURST_CAP_BYTES` | 3 MB | Match against real canvas-with-images sessions. |
| `FRANK_SUSTAINED_CAP_BYTES` | 1 MB/min | If typical canvas+image sessions consistently throttle, raise. |
| `FRANK_STATE_MAX_BYTES` | 1 MB | Single-state pushes with many images will 413. 413 is handled gracefully (paused state) but it's still a UX cliff. Consider raising to 2–4 MB for canvas specifically once session sizes are measured. |
| `FRANK_STATE_PROMOTION_MS` | 30 s | Tighter promotion = fresher snapshot but more re-sent bandwidth. Loosen if measurements show cold-open misses are rare AND bandwidth is pressured. |
| Canvas rate cap | 15/s | Phase 1 assumed; Phase 2 doesn't change it. If feedback lag is perceptible at 15/s, try 30/s. |

Phase 2 defers shape-level diff computation (true Konva delta serialization). Every `diff` event still carries the full canvasState — just without the asset map. If Phase 5 measurements show canvas JSON itself is bandwidth-dominant, add shape-level diff generation then.

---

## Out of scope for Phase 2 (picked up later)

- **Shape-level diff computation.** Current `diff` events carry the full `canvasState` JSON. Fine for now; a true delta (shape add/update/remove as individual operations) is a Phase 5+ optimization if bandwidth pressure warrants.
- **Image and PDF project types.** Phases 3 and 4.
- **Full share-popover polish** (explicit revoke button, expiration picker, "N watching" badge consolidation across views) — Phase 5.
- **Canvas snapshot preview (thumbnail) updates.** The v2 share-page cover image is set at share-creation time and does not refresh during live share. Phase 5 can add periodic refresh if users notice the stale cover.
- **Shared `beforeEach` cleanup in integration tests.** Phase 1 + Phase 2 tests each do one-off `live.json` cleanup per test. Worth a future refactor to a shared `beforeEach` for test-isolation hygiene, but not a Phase 2 deliverable — Phase 2 matches the existing pattern.

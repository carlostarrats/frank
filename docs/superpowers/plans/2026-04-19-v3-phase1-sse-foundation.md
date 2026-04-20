# v3 Phase 1 — SSE Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live-share transport to Frank — Server-Sent Events on the existing user-hosted backend, HTTPS POST for daemon→cloud state updates, monotonic revisions, and a 60-second rolling diff buffer. After this phase the plumbing is live end-to-end: the daemon streams arbitrary state payloads to the cloud, the cloud broadcasts them to any connected viewer, and reconnects are seamless. The four project-type integrations (canvas/image/PDF, plus lifecycle features) ride this phase in the follow-on plans listed below.

**Architecture:** Additive changes only — v2 endpoints remain untouched. The cloud gets three new endpoints (`GET /api/share/:id/stream`, `GET /api/share/:id/author-stream`, `POST /api/share/:id/state`) plus revocation (`DELETE /api/share/:id`). Revision numbers are monotonic and per-share; the backend stores the canonical snapshot, a rolling 60-second diff buffer, and the current revision. The daemon holds an SSE "author-stream" open per active share (that connection is the online/offline signal), posts state updates as regular HTTPS POSTs, and persists its last revision to disk. Viewers use `EventSource` — the browser handles reconnection; `Last-Event-ID` drives the diff-replay-or-full-state choice. One-way data flow: author → cloud → viewers, with comments continuing to ride `POST /api/comment` unchanged.

**Tech Stack:** Node.js + TypeScript daemon, Vercel serverless functions + Blob + KV-style store for the reference backend, plain JS browser UI (`EventSource` API), Vitest for daemon tests.

**Spec:** `/Users/carlostarrats/Downloads/frank-v3-direction.md`

**Phases:**
- **Phase 1 (this plan):** SSE transport, revisions, rolling diff buffer, cloud API migration. Transport-level green field — no project-type hooks yet.
- **Phase 2:** Canvas live share — daemon-side diff emitter from Konva state, viewer-side diff apply.
- **Phase 3:** Image live share — annotations-only diffs on top of the immutable image payload.
- **Phase 4:** PDF live share — page + scroll + annotation diffs on top of the immutable PDF payload.
- **Phase 5:** Lifecycle + presence — revoke button, optional expiration picker, live-session kill switch, "N watching" indicator in the share popover (both author + viewer surfaces).
- **v3.1 (out of scope):** URL live share — deferred per the direction doc; requires server-visible rendering context not present in v3.0.

---

## File Structure

### Reference backend (`frank-cloud/`)

```
frank-cloud/
├── api/
│   ├── share.ts                # MODIFY: keep v2 POST/GET as-is, add DELETE /api/share?id=
│   ├── comment.ts              # MODIFY: after persisting, publish comment event to the share's pub/sub channel
│   ├── health.ts               # untouched
│   ├── share-stream.ts         # CREATE: GET /api/share/:id/stream — viewer SSE
│   ├── share-author-stream.ts  # CREATE: GET /api/share/:id/author-stream — daemon SSE (online signal)
│   └── share-state.ts          # CREATE: POST /api/share/:id/state — daemon state push
├── lib/
│   ├── revisions.ts            # CREATE: read/write per-share revision counter
│   ├── diff-buffer.ts          # CREATE: rolling 60-second diff buffer (time-bounded ring)
│   ├── pubsub.ts               # CREATE: in-process + durable fanout helper (see "Pub/sub on Vercel" below)
│   ├── session.ts              # CREATE: client-session token dedup + viewer count
│   └── limits.ts               # CREATE: viewer cap, idle timeout, IP rate limit
├── api/lib/                    # (Vercel's convention — same contents, Vercel doesn't allow top-level lib/)
├── vercel.json                 # MODIFY: add routes for the three new endpoints
├── public/viewer/
│   ├── index.html              # MODIFY: load the new live-viewer bundle
│   ├── viewer.css              # MODIFY: presence pill, "author offline" banner, "reconnecting" pill
│   └── viewer.js               # MODIFY: open EventSource, apply diffs, route comments + presence
└── README.md                   # MODIFY: document new env vars + endpoint list
```

### Daemon (`daemon/src/`)

```
daemon/src/
├── protocol.ts                 # MODIFY: v3 message types + revision tracking on ActiveShare
├── cloud.ts                    # MODIFY: add openAuthorStream, postState, revokeShare; keep v2 helpers
├── live-share.ts               # CREATE: per-share controller — owns revisions, debounce, coalesce, reconnect
├── revision-store.ts           # CREATE: per-share revision persistence under ~/.frank/projects/<id>/live.json
├── server.ts                   # MODIFY: message handlers for live-share-start/stop/state-push + viewer-count broadcast
└── live-share.test.ts          # CREATE: unit tests for revision store, debounce, reconnect
```

Integration tests live at `daemon/src/live-share.integration.test.ts` and hit a fake cloud implemented in `daemon/test/fake-cloud.ts`.

### Browser UI (`ui-v2/`)

```
ui-v2/
├── core/
│   └── sync.js                 # (untouched) daemon WebSocket is not used for live share — daemon owns SSE directly
├── components/
│   ├── share-popover.js        # MODIFY: "N watching" indicator, kill-switch pause/resume toggle (Phase 5 wires actions; Phase 1 just leaves the indicator slot empty)
│   └── live-status.js          # CREATE: tiny reusable renderer for "online/offline/ended" author status
└── styles/
    └── app.css                 # MODIFY: add styles for the presence pill + author-offline banner
```

The daemon is the SSE client for author-stream. The UI only renders status surfaced through the existing WebSocket; no `EventSource` in the Frank app itself. That keeps the UI cleanly stateless about the cloud link.

---

## Pub/sub on Vercel — the single decision that shapes the phase

Vercel functions are stateless and scale horizontally. You cannot rely on in-memory pub/sub for cross-instance fanout. The `/stream` endpoints need to receive events emitted by `POST /api/share/:id/state` and `POST /api/comment` even when those requests hit different function instances.

**Decision:** use Upstash Redis (via the Vercel Marketplace integration) as the pub/sub layer. Redis provides the primitives we need — atomic `INCR`, `RPUSH`/`LTRIM`/`LRANGE` for the event list, `EXPIRE` for TTLs. Serverless functions can't hold a long-lived Redis `SUBSCRIBE` across requests, so the /stream handlers long-poll the event list via `tail()` instead.

If KV is not available (host doesn't provide it), the fallback is polling the diff buffer every 500ms from inside the SSE handler — works, but noisier and costlier. The reference implementation requires KV; the `CLOUD_API.md` contract lets other hosts choose their own fanout mechanism.

Tasks below assume Upstash Redis. The env vars are `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, which `Redis.fromEnv()` picks up automatically. The Vercel Marketplace "Redis (by Upstash)" integration sets both env vars on install.

---

## Task 1: Extend `CLOUD_API.md` with the v3 contract

Updating the contract first gives every later task a single reference to point at.

**Files:**
- Modify: `CLOUD_API.md`

- [ ] **Step 1: Append a "v3 Live Share" section to `CLOUD_API.md`**

Append (do not replace existing v2 content):

````markdown
---

## v3 — Live Share (additive)

v3 adds live-share transport on top of the v2 endpoints. v2 clients continue to work against a v3 backend with no change in behavior (static shares). v3 clients use the new endpoints for streaming.

### New endpoints

#### `GET /api/share/:id/stream`
Viewer SSE stream. Returns `Content-Type: text/event-stream`. No auth — share ID is the capability.

Request headers:
- `Last-Event-ID` (optional) — the last revision the viewer applied. Backend uses this to decide between diff replay and full-state send.
- `X-Frank-Session` (optional) — opaque client session token for dedup. If omitted the backend assigns one via `Set-Cookie: frank_session=...; HttpOnly; SameSite=Lax`.

Events (JSON bodies, one `data:` line each). Every event carries a string `id:` equal to its revision number:

| Event | `data` shape |
|---|---|
| `state` | `{ revision: number, contentType: "canvas"\|"image"\|"pdf"\|"url", payload: unknown }` |
| `diff` | `{ revision: number, payload: unknown }` |
| `comment` | `{ id, author, text, ts, anchor }` (matches `POST /api/comment`'s stored shape) |
| `presence` | `{ viewers: number }` |
| `author-status` | `{ status: "online"\|"offline"\|"ended" }` |
| `share-ended` | `{ reason: "revoked"\|"expired" }` — connection closes after send |

Initial event sequence on connect:
1. If no `Last-Event-ID` or snapshot behind buffer: one `state` event with current snapshot.
2. If `Last-Event-ID` matches current revision: one `author-status` event (no redundant state transfer).
3. If `Last-Event-ID` is within the rolling buffer: replay each buffered `diff` since then, in order.
4. Then the stream stays open; future events are broadcast in real time.

#### `GET /api/share/:id/author-stream`
Daemon SSE stream. Requires `Authorization: Bearer <FRANK_API_KEY>`.

Same event frame as viewer stream, but only delivers:
- `comment` — new comments posted by viewers.
- `presence` — viewer count changes.
- `share-ended` — revocation or expiration.

The backend tracks author-online state by whether at least one author-stream connection is open for the share. When the last author-stream closes, a 15-second grace timer starts; if no new author-stream is opened before it fires, the backend broadcasts `author-status: offline` on the viewer stream. A reconnect inside the grace window cancels the timer.

#### `POST /api/share/:id/state`
Daemon state push. Requires `Authorization: Bearer <FRANK_API_KEY>`.

Body: `{ revision: number, type: "state" | "diff", payload: unknown }`.

Response: `{ acceptedRevision: number }` on success, or `{ error: "revision-behind", currentRevision: number }` if `revision` is lower than what the backend already stored. The daemon fast-forwards its local counter in that case.

Atomicity requirement: the backend MUST treat snapshot update, diff buffer append, revision bump, and broadcast as a single logical operation. On failure the stored snapshot and revision do not change.

#### `DELETE /api/share/:id`
Revoke. Requires `Authorization: Bearer <FRANK_API_KEY>` and `X-Frank-Revoke-Token: <token>`.

Ordered sequence (strict):
1. Mark share ID invalid so new stream/state requests return 410.
2. Broadcast `share-ended: { reason: "revoked" }` on both viewer and author streams.
3. Delete snapshot, diff buffer, and per-share KV entries.

### Requirements for implementers

1. Support the four new endpoints above.
2. Maintain a rolling diff buffer (default 60s, host-configurable) keyed by share ID. Entries older than the window drop off on write.
3. Tag `state` and `diff` events with the revision as both the JSON `revision` field and the SSE `id:` line.
4. Support `Last-Event-ID`-based resume — replay from buffer when within window, send full `state` otherwise.
5. Maintain presence: the number of open viewer-stream connections per share, deduplicated by `X-Frank-Session` / `frank_session` cookie. Author streams do not count.
6. Enforce a per-share viewer cap (host-configurable default — the contract does not prescribe a number, since it depends on the host's cost model). On cap hit, respond 429 with `{ error: "viewer-cap" }`.
7. Enforce idle-viewer timeout (default 30min, configurable). Idle = no comment POST + no heartbeat ping (see below) for the whole window.
8. Viewer clients SHOULD emit a heartbeat `POST /api/share/:id/ping` (body empty) every 60s while the tab is foregrounded. Hosts that do not implement `ping` can rely on TCP-level idle detection instead.
9. Rate-limit connection attempts per IP (host picks specific numbers; contract does not mandate them).
10. On expiration or revocation: invalidate → close streams → delete snapshot/buffer, **in that order**.

### Data plane note

Every `state` and `diff` payload is opaque to the backend. Canvas, image, and PDF each define their own payload shape in their respective phase plans. The backend never inspects the payload beyond size limits (≤1 MB per update by default).

### Implementation flexibility (non-normative)

The contract does not mandate any specific storage or fanout technology. The Vercel reference implementation uses Upstash Redis (via the Vercel Marketplace integration) for revisions, diff buffers, and pub/sub fanout because serverless functions can't hold a Redis `SUBSCRIBE` across requests. Other hosts can use what fits their runtime:

- **Cloudflare Workers:** a Durable Object per share (naturally single-threaded, owns the snapshot + subscriber set).
- **Deno Deploy / Fly.io / long-lived Node:** in-memory pub/sub, a disk-backed snapshot, and an in-process ring buffer.
- **Self-hosted Node:** same as above, plus optionally Redis if scaling horizontally.

The only contract requirements are the endpoints, the event shapes, revision monotonicity, and the rolling buffer semantics — not the storage backend. If you're porting to a new host, document that choice in your fork's README so users understand the cost model.
````

- [ ] **Step 2: Commit**

```bash
git add CLOUD_API.md
git commit -m "docs: add v3 live-share contract to CLOUD_API.md"
```

---

## Task 2: Extend `protocol.ts` with v3 message types

The daemon needs types for live-share start/stop/state-push messages between the UI and itself, and needs to extend `ActiveShare` with the last-revision persistence hook.

**Files:**
- Modify: `daemon/src/protocol.ts`

- [ ] **Step 1: Extend `ActiveShare` with live-share fields**

Replace the existing `ActiveShare` interface (around lines 29–37) with:

```ts
export interface ActiveShare {
  id: string;
  revokeToken: string;
  createdAt: string;
  expiresAt: string;
  coverNote: string;
  lastSyncedNoteId: string | null;
  unseenNotes: number;
  // v3 additions — absent on v2 shares
  live?: {
    revision: number;           // last revision the daemon pushed successfully
    startedAt: string;          // ISO — when the live session opened
    paused: boolean;            // true when the author clicked "Stop live share"
  };
}
```

- [ ] **Step 2: Add v3 request + daemon→app message types**

Add below the existing request types (right after `RevealProjectFolderRequest` around line 129):

```ts
// v3 live-share controls (UI → daemon)
export interface StartLiveShareRequest { type: 'start-live-share'; projectId: string; requestId?: number; }
export interface StopLiveShareRequest { type: 'stop-live-share'; projectId: string; requestId?: number; }
export interface ResumeLiveShareRequest { type: 'resume-live-share'; projectId: string; requestId?: number; }
export interface PushLiveStateRequest {
  type: 'push-live-state';
  projectId: string;
  kind: 'state' | 'diff';
  payload: unknown;
  requestId?: number;
}
export interface RevokeShareRequest { type: 'revoke-share'; projectId: string; requestId?: number; }
```

Add to `AppMessage` union:

```ts
  | StartLiveShareRequest
  | StopLiveShareRequest
  | ResumeLiveShareRequest
  | PushLiveStateRequest
  | RevokeShareRequest;
```

Add below the existing daemon→app messages (right after `FolderRevealedMessage` around line 335):

```ts
// v3 live-share status broadcasts (daemon → UI)
export interface LiveShareStateMessage {
  type: 'live-share-state';
  projectId: string;
  // 'unsupported' = backend is v2-only (see Migration Coexistence section).
  // Distinct from 'error' because the share itself is fine, just no live.
  status: 'idle' | 'connecting' | 'live' | 'paused' | 'offline' | 'error' | 'unsupported';
  viewers: number;
  revision: number;
  lastError: string | null;
}
export interface LiveShareCommentMessage {
  type: 'live-share-comment';
  projectId: string;
  comment: Comment;
}
export interface ShareRevokedMessage {
  type: 'share-revoked';
  projectId: string;
}
```

Add to `DaemonMessage` union:

```ts
  | LiveShareStateMessage
  | LiveShareCommentMessage
  | ShareRevokedMessage;
```

- [ ] **Step 3: Build and run existing tests to confirm nothing regressed**

```bash
cd daemon && npm run build && npm test
```

Expected: build succeeds; 135/135 tests still pass (no new tests yet).

- [ ] **Step 4: Commit**

```bash
git add daemon/src/protocol.ts
git commit -m "feat(protocol): add v3 live-share message types"
```

---

## Task 3: Revision store on disk

Revisions must survive daemon restart per the direction doc. The store lives at `~/.frank/projects/<id>/live.json` — a single file with `{ revision, lastPush }`. Using the project dir keeps it local and purged with the project.

**Files:**
- Create: `daemon/src/revision-store.ts`
- Create: `daemon/src/revision-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// daemon/src/revision-store.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Redirect PROJECTS_DIR to a temp dir for the whole suite.
vi.mock('./protocol.js', async () => {
  const mod = await vi.importActual<typeof import('./protocol.js')>('./protocol.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-rev-'));
  return { ...mod, PROJECTS_DIR: tmp };
});

import { PROJECTS_DIR } from './protocol.js';
import { loadRevision, saveRevision, nextRevision } from './revision-store.js';

function mkProject(id: string) {
  fs.mkdirSync(path.join(PROJECTS_DIR, id), { recursive: true });
}

describe('revision-store', () => {
  beforeEach(() => {
    for (const d of fs.readdirSync(PROJECTS_DIR)) {
      fs.rmSync(path.join(PROJECTS_DIR, d), { recursive: true, force: true });
    }
  });

  it('returns 0 for a project with no live.json', () => {
    mkProject('p1');
    expect(loadRevision('p1')).toBe(0);
  });

  it('persists a revision and reads it back', () => {
    mkProject('p1');
    saveRevision('p1', 42);
    expect(loadRevision('p1')).toBe(42);
  });

  it('nextRevision bumps monotonically across restarts', () => {
    mkProject('p1');
    expect(nextRevision('p1')).toBe(1);
    expect(nextRevision('p1')).toBe(2);
    expect(loadRevision('p1')).toBe(2);
    // Simulated restart: fresh call reads from disk and continues.
    expect(nextRevision('p1')).toBe(3);
  });

  it('fast-forwards when the backend revision is ahead', () => {
    mkProject('p1');
    saveRevision('p1', 5);
    saveRevision('p1', 10); // simulate backend catch-up
    expect(loadRevision('p1')).toBe(10);
    expect(nextRevision('p1')).toBe(11);
  });

  it('does not let nextRevision regress if saveRevision is called with a lower value', () => {
    mkProject('p1');
    saveRevision('p1', 100);
    // A stale "accepted" response should never lower the counter.
    saveRevision('p1', 50);
    expect(loadRevision('p1')).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd daemon && npx vitest run src/revision-store.test.ts
```

Expected: FAIL — "Cannot find module './revision-store.js'".

- [ ] **Step 3: Implement `revision-store.ts`**

```ts
// daemon/src/revision-store.ts
import fs from 'fs';
import path from 'path';
import { PROJECTS_DIR } from './protocol.js';

interface LiveFile {
  revision: number;
  lastPush: string | null;
}

function livePath(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, 'live.json');
}

function read(projectId: string): LiveFile {
  try {
    const raw = fs.readFileSync(livePath(projectId), 'utf8');
    const parsed = JSON.parse(raw) as Partial<LiveFile>;
    return {
      revision: Number.isFinite(parsed.revision) ? (parsed.revision as number) : 0,
      lastPush: typeof parsed.lastPush === 'string' ? parsed.lastPush : null,
    };
  } catch {
    return { revision: 0, lastPush: null };
  }
}

function writeAtomic(projectId: string, data: LiveFile): void {
  const p = livePath(projectId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

export function loadRevision(projectId: string): number {
  return read(projectId).revision;
}

export function saveRevision(projectId: string, revision: number): void {
  const current = read(projectId);
  // Never regress: accept only equal-or-greater values. The "backend is ahead"
  // case still lands here because the daemon fast-forwards explicitly.
  if (revision < current.revision) return;
  writeAtomic(projectId, { revision, lastPush: new Date().toISOString() });
}

export function nextRevision(projectId: string): number {
  const current = read(projectId);
  const next = current.revision + 1;
  writeAtomic(projectId, { revision: next, lastPush: new Date().toISOString() });
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd daemon && npx vitest run src/revision-store.test.ts
```

Expected: PASS — all 5 assertions green.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/revision-store.ts daemon/src/revision-store.test.ts
git commit -m "feat(daemon): persistent per-project revision store for live share"
```

---

## Task 4: Cloud KV + Blob helpers — revisions, diff buffer, pub/sub

Before wiring new endpoints, build the three shared helpers they all need. These all live under `frank-cloud/lib/` (Vercel's runtime resolves these fine from inside `api/*.ts` via relative import).

**Files:**
- Create: `frank-cloud/lib/revisions.ts`
- Create: `frank-cloud/lib/diff-buffer.ts`
- Create: `frank-cloud/lib/pubsub.ts`
- Modify: `frank-cloud/package.json` — add `@upstash/redis` dependency

- [ ] **Step 1: Add `@upstash/redis` to `frank-cloud/package.json`**

In `frank-cloud/package.json`, add to `dependencies`:

```json
"@upstash/redis": "^1.37.0"
```

Run:

```bash
cd frank-cloud && npm install
```

- [ ] **Step 2: Implement `frank-cloud/lib/revisions.ts`**

```ts
// Using @upstash/redis directly rather than @vercel/kv — Vercel has moved
// KV to the Upstash Marketplace integration and @vercel/kv is deprecated.
// Same reasoning as the VIEWER_CAP comment in lib/limits.ts: anchor the
// choice in-code so nobody later "helpfully" swaps the wrapper back.
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

// Per-share revision counter. INCR is atomic in Redis, which gives us the
// monotonic guarantee the direction doc requires.
export async function nextRevision(shareId: string): Promise<number> {
  const rev = await redis.incr(`share:${shareId}:revision`);
  return rev as number;
}

export async function peekRevision(shareId: string): Promise<number> {
  const rev = (await redis.get<number>(`share:${shareId}:revision`)) ?? 0;
  return rev;
}

// On revocation: wipe the counter along with everything else for the share.
export async function deleteRevision(shareId: string): Promise<void> {
  await redis.del(`share:${shareId}:revision`);
}
```

- [ ] **Step 3: Implement `frank-cloud/lib/diff-buffer.ts`**

```ts
// Using @upstash/redis directly rather than @vercel/kv — Vercel has moved
// KV to the Upstash Marketplace integration and @vercel/kv is deprecated.
// Same reasoning as the VIEWER_CAP comment in lib/limits.ts: anchor the
// choice in-code so nobody later "helpfully" swaps the wrapper back.
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export interface BufferedDiff {
  revision: number;
  type: 'state' | 'diff';
  payload: unknown;
  ts: number;           // Date.now() when the event was appended
}

const BUFFER_WINDOW_MS = Number(process.env.FRANK_DIFF_BUFFER_MS || 60_000);

// The buffer is a Redis list; each entry is a JSON-encoded BufferedDiff.
// `prune` drops entries older than the window before every append or read.
function key(shareId: string): string {
  return `share:${shareId}:diffs`;
}

async function prune(shareId: string): Promise<void> {
  const entries = (await redis.lrange<string>(key(shareId), 0, -1)) as string[];
  if (entries.length === 0) return;
  const cutoff = Date.now() - BUFFER_WINDOW_MS;
  const kept: string[] = [];
  for (const raw of entries) {
    try {
      const parsed = JSON.parse(raw) as BufferedDiff;
      if (parsed.ts >= cutoff) kept.push(raw);
    } catch { /* drop corrupt */ }
  }
  if (kept.length === entries.length) return;
  await redis.del(key(shareId));
  if (kept.length > 0) {
    await redis.rpush(key(shareId), ...kept);
  }
}

export async function appendDiff(shareId: string, entry: BufferedDiff): Promise<void> {
  await prune(shareId);
  await redis.rpush(key(shareId), JSON.stringify(entry));
  // One-hour TTL safety net in case of a share that goes cold.
  await redis.expire(key(shareId), 3600);
}

// Returns all diffs with revision > sinceRevision, in order. Empty if
// the requested revision is older than the oldest buffered entry.
export async function diffsSince(shareId: string, sinceRevision: number): Promise<BufferedDiff[] | 'buffer-miss'> {
  await prune(shareId);
  const entries = (await redis.lrange<string>(key(shareId), 0, -1)) as string[];
  if (entries.length === 0) return 'buffer-miss';
  const parsed: BufferedDiff[] = [];
  for (const raw of entries) {
    try { parsed.push(JSON.parse(raw) as BufferedDiff); } catch { /* skip */ }
  }
  parsed.sort((a, b) => a.revision - b.revision);
  if (parsed[0].revision > sinceRevision + 1) return 'buffer-miss';
  return parsed.filter((d) => d.revision > sinceRevision);
}

export async function deleteBuffer(shareId: string): Promise<void> {
  await redis.del(key(shareId));
}
```

- [ ] **Step 4: Implement `frank-cloud/lib/pubsub.ts`**

```ts
// Upstash Redis supports PUBLISH but not long-lived SUBSCRIBE
// from inside a serverless function. For broadcast we use a "polling" tail:
// listeners long-poll a list + its last-id offset. This is simpler and
// avoids needing a Redis connection kept open outside the function lifetime.
//
// Producers call `publish(shareId, event)`. Listeners call `tail(shareId, lastId)`
// which returns any events newer than lastId and blocks up to `timeoutMs` for
// at least one new event.
//
// Using @upstash/redis directly rather than @vercel/kv — Vercel has moved
// KV to the Upstash Marketplace integration and @vercel/kv is deprecated.
// Same reasoning as the VIEWER_CAP comment in lib/limits.ts: anchor the
// choice in-code so nobody later "helpfully" swaps the wrapper back.
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export interface ChannelEvent {
  id: number;
  kind: 'state' | 'diff' | 'comment' | 'presence' | 'author-status' | 'share-ended';
  data: unknown;
}

function listKey(shareId: string): string {
  return `share:${shareId}:events`;
}
function counterKey(shareId: string): string {
  return `share:${shareId}:eventCounter`;
}

const EVENT_TTL_SEC = 120; // events are transient; we only care about recent ones

// Hard cap on the list's length. At 15 events/sec sustained the 60s rolling
// window is ~900 entries; 2000 gives headroom for bursts + occasional slow
// consumers without letting storage grow unbounded on very long sessions.
const EVENT_LIST_MAX = Number(process.env.FRANK_EVENT_LIST_MAX || 2000);

export async function publish(shareId: string, kind: ChannelEvent['kind'], data: unknown): Promise<number> {
  const id = (await redis.incr(counterKey(shareId))) as number;
  const ev: ChannelEvent = { id, kind, data };
  await redis.rpush(listKey(shareId), JSON.stringify(ev));
  // Keep only the trailing EVENT_LIST_MAX entries. LTRIM is O(N) but N is
  // bounded by the cap itself, so this is cheap in steady state.
  await redis.ltrim(listKey(shareId), -EVENT_LIST_MAX, -1);
  await redis.expire(listKey(shareId), EVENT_TTL_SEC);
  await redis.expire(counterKey(shareId), EVENT_TTL_SEC);
  return id;
}

// Long-poll: return any events with id > lastId. If none, wait in 500ms
// increments up to timeoutMs. Returns whatever landed (possibly empty).
export async function tail(
  shareId: string,
  lastId: number,
  timeoutMs = 8000,
): Promise<ChannelEvent[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw = (await redis.lrange<string>(listKey(shareId), 0, -1)) as string[];
    const parsed: ChannelEvent[] = [];
    for (const s of raw) {
      try {
        const ev = JSON.parse(s) as ChannelEvent;
        if (ev.id > lastId) parsed.push(ev);
      } catch { /* skip */ }
    }
    if (parsed.length > 0) {
      parsed.sort((a, b) => a.id - b.id);
      return parsed;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return [];
}

export async function deleteChannel(shareId: string): Promise<void> {
  await redis.del(listKey(shareId));
  await redis.del(counterKey(shareId));
}
```

**Why long-poll instead of a native Redis subscription:** Vercel serverless functions don't guarantee a long-lived connection outside the request; opening a Redis subscriber inside each SSE handler works but is fragile across Vercel's connection-pooling. Long-polling a list is portable, cheap for low-to-medium traffic (each poll is a single `LRANGE`), and degrades cleanly on short function limits — when the function times out, the browser reconnects and the loop continues. For Vercel Pro with Fluid Compute the inner loop simply stays up longer.

- [ ] **Step 5: Commit**

```bash
git add frank-cloud/package.json frank-cloud/package-lock.json frank-cloud/lib/
git commit -m "feat(cloud): KV-backed revisions, diff buffer, and pubsub helpers"
```

---

## Task 5: `POST /api/share/:id/state` — the write path

**Files:**
- Create: `frank-cloud/api/share-state.ts`
- Modify: `frank-cloud/vercel.json` — route `/api/share/:id/state` to the new function

- [ ] **Step 1: Implement the handler**

```ts
// frank-cloud/api/share-state.ts
import { put, list } from '@vercel/blob';
import { nextRevision, peekRevision } from '../lib/revisions.js';
import { appendDiff } from '../lib/diff-buffer.js';
import { publish } from '../lib/pubsub.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

const MAX_PAYLOAD_BYTES = Number(process.env.FRANK_STATE_MAX_BYTES || 1_048_576); // 1 MB

function extractShareId(pathname: string): string | null {
  // Expect: /api/share/<id>/state
  const m = pathname.match(/^\/api\/share\/([a-zA-Z0-9_-]{8,20})\/state\/?$/);
  return m ? m[1] : null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (apiKey !== process.env.FRANK_API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const shareId = extractShareId(url.pathname);
  if (!shareId) return Response.json({ error: 'Invalid share ID' }, { status: 400 });

  // Share must exist and not be expired/revoked.
  const metaBlob = await fetchBlob(`shares/${shareId}/meta.json`);
  if (!metaBlob) return Response.json({ error: 'not found' }, { status: 404 });
  const meta = JSON.parse(metaBlob);
  if (meta.revoked === true) return Response.json({ error: 'revoked' }, { status: 410 });
  if (new Date(meta.expiresAt) < new Date()) {
    return Response.json({ error: 'expired' }, { status: 410 });
  }

  let body: { revision?: number; type?: string; payload?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { revision: clientRevision, type, payload } = body;
  if (type !== 'state' && type !== 'diff') {
    return Response.json({ error: 'Invalid type' }, { status: 400 });
  }
  if (typeof clientRevision !== 'number' || !Number.isFinite(clientRevision)) {
    return Response.json({ error: 'Invalid revision' }, { status: 400 });
  }

  const encoded = JSON.stringify(payload);
  if (encoded.length > MAX_PAYLOAD_BYTES) {
    return Response.json({ error: 'payload-too-large', max: MAX_PAYLOAD_BYTES }, { status: 413 });
  }

  // Backend revision wins per the direction doc. If the client's revision is
  // BEHIND what we already stored, reject with the current so the daemon can
  // fast-forward. Otherwise allocate the next monotonic revision.
  const current = await peekRevision(shareId);
  if (clientRevision <= current) {
    return Response.json({ error: 'revision-behind', currentRevision: current }, { status: 409 });
  }

  const assigned = await nextRevision(shareId);

  // For `state` events, replace the stored snapshot. For `diff`, leave the
  // snapshot alone and just buffer. The store-then-buffer-then-publish order
  // matters: viewers connecting during this call must never see a revision
  // that's only in the broadcast but not in the snapshot/buffer.
  if (type === 'state') {
    await put(
      `shares/${shareId}/snapshot.json`,
      JSON.stringify({ revision: assigned, contentType: meta.contentType, payload }),
      { access: 'public', contentType: 'application/json', addRandomSuffix: false },
    );
  }

  await appendDiff(shareId, {
    revision: assigned,
    type,
    payload,
    ts: Date.now(),
  });

  await publish(shareId, type, { revision: assigned, payload });

  return Response.json({ acceptedRevision: assigned });
}

async function fetchBlob(key: string): Promise<string | null> {
  try {
    const blobs = await list({ prefix: key });
    if (blobs.blobs.length === 0) return null;
    const res = await fetch(blobs.blobs[0].url);
    return await res.text();
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Register the route in `frank-cloud/vercel.json`**

Read the existing `vercel.json`. Add to the `rewrites` section (create the section if it doesn't exist):

```json
{
  "rewrites": [
    { "source": "/api/share/:id/state", "destination": "/api/share-state" },
    { "source": "/api/share/:id/stream", "destination": "/api/share-stream" },
    { "source": "/api/share/:id/author-stream", "destination": "/api/share-author-stream" },
    { "source": "/api/share/:id/ping", "destination": "/api/share-ping" }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add frank-cloud/api/share-state.ts frank-cloud/vercel.json
git commit -m "feat(cloud): POST /api/share/:id/state — daemon state push"
```

---

## Task 6: `GET /api/share/:id/stream` — viewer SSE

**Files:**
- Create: `frank-cloud/api/share-stream.ts`
- Create: `frank-cloud/lib/session.ts`
- Create: `frank-cloud/lib/limits.ts`

- [ ] **Step 1: Implement session token dedup + viewer counting**

```ts
// frank-cloud/lib/session.ts
import { Redis } from '@upstash/redis';
import crypto from 'crypto';

const redis = Redis.fromEnv();

// A viewer session is counted once, even across tabs. We track it by an
// opaque token placed in a cookie (or supplied as X-Frank-Session). Each
// unique token contributes one "seat". Heartbeats refresh the TTL; when the
// TTL expires the viewer is considered gone.
const SESSION_TTL_SEC = Number(process.env.FRANK_SESSION_TTL || 90);

export function readOrCreateSessionToken(req: Request): { token: string; setCookie: string | null } {
  const hdr = req.headers.get('x-frank-session');
  if (hdr && /^[a-zA-Z0-9_-]{16,64}$/.test(hdr)) return { token: hdr, setCookie: null };
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/frank_session=([a-zA-Z0-9_-]{16,64})/);
  if (m) return { token: m[1], setCookie: null };
  const token = crypto.randomBytes(16).toString('base64url');
  const setCookie = `frank_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC * 10}`;
  return { token, setCookie };
}

function key(shareId: string): string { return `share:${shareId}:sessions`; }

export async function touchSession(shareId: string, token: string): Promise<void> {
  // Store token in a sorted set scored by expiry timestamp. Pruning on read.
  const expireAt = Date.now() + SESSION_TTL_SEC * 1000;
  await redis.zadd(key(shareId), { score: expireAt, member: token });
  await redis.expire(key(shareId), SESSION_TTL_SEC * 4);
}

export async function removeSession(shareId: string, token: string): Promise<void> {
  await redis.zrem(key(shareId), token);
}

export async function countViewers(shareId: string): Promise<number> {
  const now = Date.now();
  await redis.zremrangebyscore(key(shareId), 0, now);
  const count = (await redis.zcard(key(shareId))) as number;
  return count ?? 0;
}
```

- [ ] **Step 2: Implement caps + rate limiting**

```ts
// frank-cloud/lib/limits.ts
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

// Intentional override of v3 direction doc's 50-default to keep Upstash Redis
// free-tier cost bounded for small users. Env-overridable via FRANK_VIEWER_CAP.
// Future-you will thank present-you.
export const VIEWER_CAP = Number(process.env.FRANK_VIEWER_CAP || 10);
export const IDLE_TIMEOUT_MS = Number(process.env.FRANK_IDLE_TIMEOUT_MS || 30 * 60_000);
const IP_BUCKET_WINDOW_SEC = 60;
const IP_BUCKET_MAX = Number(process.env.FRANK_IP_RATE_PER_MIN || 120);

export async function allowConnectFromIp(ip: string): Promise<boolean> {
  const k = `ip:${ip}:connect`;
  const hits = (await redis.incr(k)) as number;
  if (hits === 1) await redis.expire(k, IP_BUCKET_WINDOW_SEC);
  return hits <= IP_BUCKET_MAX;
}
```

- [ ] **Step 3: Implement the viewer SSE handler**

```ts
// frank-cloud/api/share-stream.ts
import { list } from '@vercel/blob';
import { Redis } from '@upstash/redis';
import { tail } from '../lib/pubsub.js';
import { diffsSince } from '../lib/diff-buffer.js';
import { peekRevision } from '../lib/revisions.js';
import { readOrCreateSessionToken, touchSession, countViewers } from '../lib/session.js';
import { allowConnectFromIp, VIEWER_CAP } from '../lib/limits.js';
import { publish } from '../lib/pubsub.js';

const redis = Redis.fromEnv();

// Inline check: has the author's grace window elapsed without a reconnect?
// When a viewer connects or the long-poll loop ticks, we sweep the single
// deadline key for this share — no cron latency. Cron stays as backstop
// for shares with no viewer activity at all.
async function maybeFireAuthorOffline(shareId: string): Promise<void> {
  const deadline = await redis.get<number>(`share:${shareId}:authorOfflineAt`);
  if (deadline && deadline <= Date.now()) {
    const deleted = await redis.del(`share:${shareId}:authorOfflineAt`);
    if (deleted) {
      // Only one concurrent connection wins the DEL; that one broadcasts.
      await redis.del(`share:${shareId}:author`);
      await publish(shareId, 'author-status', { status: 'offline' });
    }
  }
}

export const config = { runtime: 'nodejs', maxDuration: 300 };

function extractShareId(pathname: string): string | null {
  const m = pathname.match(/^\/api\/share\/([a-zA-Z0-9_-]{8,20})\/stream\/?$/);
  return m ? m[1] : null;
}

function sseLine(id: number | string, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const url = new URL(req.url);
  const shareId = extractShareId(url.pathname);
  if (!shareId) return Response.json({ error: 'Invalid share ID' }, { status: 400 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  if (!(await allowConnectFromIp(ip))) {
    return new Response('Rate limit exceeded', { status: 429 });
  }

  // Session dedup + viewer cap.
  const { token, setCookie } = readOrCreateSessionToken(req);
  const viewersBefore = await countViewers(shareId);
  // Cap is on unique sessions, not connections. If this token is already
  // counted we let it through; otherwise it'd have to fit under the cap.
  if (viewersBefore >= VIEWER_CAP) {
    return new Response(
      JSON.stringify({ error: 'viewer-cap', cap: VIEWER_CAP }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Share must exist and be live.
  const snapshotRaw = await fetchBlob(`shares/${shareId}/snapshot.json`);
  const metaRaw = await fetchBlob(`shares/${shareId}/meta.json`);
  if (!metaRaw) return Response.json({ error: 'not found' }, { status: 404 });
  const meta = JSON.parse(metaRaw);
  if (meta.revoked === true) return Response.json({ error: 'revoked' }, { status: 410 });
  if (new Date(meta.expiresAt) < new Date()) {
    return Response.json({ error: 'expired' }, { status: 410 });
  }

  const lastEventIdHeader = req.headers.get('last-event-id');
  const lastAppliedRevision = lastEventIdHeader ? Number(lastEventIdHeader) : -1;

  // Build the opening event(s) before we start streaming.
  const currentRevision = await peekRevision(shareId);
  const openingEvents: string[] = [];

  if (lastAppliedRevision < 0) {
    // Cold open — send full state.
    if (snapshotRaw) {
      const snap = JSON.parse(snapshotRaw);
      openingEvents.push(sseLine(snap.revision, 'state', {
        revision: snap.revision,
        contentType: snap.contentType || meta.contentType,
        payload: snap.payload,
      }));
    }
  } else if (lastAppliedRevision === currentRevision) {
    // You're current — let the client know so it stops showing "reconnecting".
    openingEvents.push(sseLine(currentRevision, 'author-status', { status: 'online' }));
  } else {
    // Try to replay diffs from the buffer.
    const replay = await diffsSince(shareId, lastAppliedRevision);
    if (replay === 'buffer-miss' && snapshotRaw) {
      const snap = JSON.parse(snapshotRaw);
      openingEvents.push(sseLine(snap.revision, 'state', {
        revision: snap.revision,
        contentType: snap.contentType || meta.contentType,
        payload: snap.payload,
      }));
    } else if (Array.isArray(replay)) {
      for (const d of replay) {
        openingEvents.push(sseLine(d.revision, d.type, {
          revision: d.revision,
          payload: d.payload,
        }));
      }
    }
  }

  // Mark session + broadcast presence change (if new).
  await touchSession(shareId, token);
  const viewersAfter = await countViewers(shareId);
  if (viewersAfter !== viewersBefore) {
    await publish(shareId, 'presence', { viewers: viewersAfter });
  }

  // Inline author-offline sweep: piggyback on connect so Hobby users see
  // offline status within ~15s of the author leaving, not 15s + cron tick.
  await maybeFireAuthorOffline(shareId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      for (const line of openingEvents) controller.enqueue(encoder.encode(line));

      // Tell the browser to retry after 1s on disconnect.
      controller.enqueue(encoder.encode('retry: 1000\n\n'));

      let lastEventId = 0;
      let alive = true;

      req.signal.addEventListener('abort', async () => {
        alive = false;
        try {
          const { removeSession } = await import('../lib/session.js');
          await removeSession(shareId, token);
          const viewersNow = await countViewers(shareId);
          await publish(shareId, 'presence', { viewers: viewersNow });
        } catch { /* best effort */ }
        try { controller.close(); } catch { /* already closed */ }
      });

      // Long-poll loop.
      while (alive) {
        const events = await tail(shareId, lastEventId, 8_000);
        if (!alive) break;
        for (const ev of events) {
          lastEventId = ev.id;
          const revision = (ev.data as { revision?: number })?.revision;
          const idHeader = revision ?? ev.id;
          controller.enqueue(encoder.encode(sseLine(idHeader, ev.kind, ev.data)));
          if (ev.kind === 'share-ended') {
            alive = false;
          }
        }
        // Keep-alive comment so proxies don't time out on long gaps.
        if (events.length === 0) controller.enqueue(encoder.encode(': keep-alive\n\n'));
        // Refresh the session TTL while the connection stays up + sweep
        // the author-offline deadline opportunistically. This means the
        // offline broadcast fires within the long-poll cycle (~8s) of the
        // grace window elapsing, rather than waiting for cron.
        await touchSession(shareId, token);
        await maybeFireAuthorOffline(shareId);
      }
      try { controller.close(); } catch { /* already closed */ }
    },
  });

  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // disable reverse-proxy buffering
  };
  if (setCookie) headers['Set-Cookie'] = setCookie;

  return new Response(stream, { status: 200, headers });
}

async function fetchBlob(key: string): Promise<string | null> {
  try {
    const blobs = await list({ prefix: key });
    if (blobs.blobs.length === 0) return null;
    const res = await fetch(blobs.blobs[0].url);
    return await res.text();
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add frank-cloud/api/share-stream.ts frank-cloud/lib/session.ts frank-cloud/lib/limits.ts
git commit -m "feat(cloud): GET /api/share/:id/stream — viewer SSE with resume + presence"
```

---

## Task 7: `GET /api/share/:id/author-stream` — daemon SSE + online signal

**Files:**
- Create: `frank-cloud/api/share-author-stream.ts`

- [ ] **Step 1: Implement the author-stream handler**

The author stream differs from the viewer stream in three ways: it requires the API key, only delivers `comment` / `presence` / `share-ended` events to the daemon, and its open/closed state drives `author-status` broadcasts to viewers.

```ts
// frank-cloud/api/share-author-stream.ts
import { Redis } from '@upstash/redis';
import { tail, publish } from '../lib/pubsub.js';
import { list } from '@vercel/blob';

const redis = Redis.fromEnv();

export const config = { runtime: 'nodejs', maxDuration: 300 };

const GRACE_MS = Number(process.env.FRANK_AUTHOR_GRACE_MS || 15_000);

function extractShareId(pathname: string): string | null {
  const m = pathname.match(/^\/api\/share\/([a-zA-Z0-9_-]{8,20})\/author-stream\/?$/);
  return m ? m[1] : null;
}

function sseLine(id: number | string, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function markAuthorOnline(shareId: string): Promise<void> {
  const was = await redis.get<string>(`share:${shareId}:author`);
  await redis.set(`share:${shareId}:author`, 'online', { ex: 60 }); // refreshed by heartbeat loop
  if (was !== 'online') {
    await publish(shareId, 'author-status', { status: 'online' });
  }
  // Cancel any pending offline timer.
  await redis.del(`share:${shareId}:authorOfflineAt`);
}

async function scheduleAuthorOffline(shareId: string): Promise<void> {
  // Write an "offline-at" timestamp in the future. A separate background
  // tick (see Task 8 — the Cron job) inspects these and broadcasts offline
  // once the grace has elapsed. This avoids depending on the stream handler
  // still being alive.
  await redis.set(
    `share:${shareId}:authorOfflineAt`,
    Date.now() + GRACE_MS,
    { ex: 300 },
  );
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }
  const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (apiKey !== process.env.FRANK_API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const shareId = extractShareId(url.pathname);
  if (!shareId) return Response.json({ error: 'Invalid share ID' }, { status: 400 });

  const metaBlob = await fetchBlob(`shares/${shareId}/meta.json`);
  if (!metaBlob) return Response.json({ error: 'not found' }, { status: 404 });
  const meta = JSON.parse(metaBlob);
  if (meta.revoked === true) return Response.json({ error: 'revoked' }, { status: 410 });

  await markAuthorOnline(shareId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('retry: 1000\n\n'));

      let alive = true;
      let lastEventId = 0;

      req.signal.addEventListener('abort', async () => {
        alive = false;
        try { await scheduleAuthorOffline(shareId); controller.close(); } catch { /* already closed */ }
      });

      while (alive) {
        const events = await tail(shareId, lastEventId, 8_000);
        if (!alive) break;
        for (const ev of events) {
          lastEventId = ev.id;
          if (ev.kind === 'comment' || ev.kind === 'presence' || ev.kind === 'share-ended') {
            controller.enqueue(encoder.encode(sseLine(ev.id, ev.kind, ev.data)));
          }
          if (ev.kind === 'share-ended') alive = false;
        }
        if (events.length === 0) controller.enqueue(encoder.encode(': keep-alive\n\n'));
        // Refresh online TTL while the connection is up.
        await redis.set(`share:${shareId}:author`, 'online', { ex: 60 });
      }
      try { controller.close(); } catch { /* already closed */ }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function fetchBlob(key: string): Promise<string | null> {
  try {
    const blobs = await list({ prefix: key });
    if (blobs.blobs.length === 0) return null;
    const res = await fetch(blobs.blobs[0].url);
    return await res.text();
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frank-cloud/api/share-author-stream.ts
git commit -m "feat(cloud): GET /api/share/:id/author-stream — author online signal"
```

---

## Task 8: Author-offline tick + idle-viewer sweep (Vercel Cron)

A background tick runs periodically and fires `author-status: offline` events whose deadlines have passed. This is the **backstop** — the viewer stream handler (Task 6) does an inline sweep every time a viewer connects or its long-poll loop ticks, so any share with at least one viewer sees the offline broadcast within ~15s grace + ~8s poll cycle. Cron exists for shares where nobody is watching, and as belt-and-braces in case a viewer never triggers the inline path. Vercel Hobby's minimum cron interval is 1 minute.

**Files:**
- Create: `frank-cloud/api/tick.ts`
- Modify: `frank-cloud/vercel.json` — add a cron schedule for `/api/tick` every 30s (Vercel Cron's minimum is 1min on Hobby; for 30s use `* * * * *` twice or upgrade. Default to `*/1 * * * *` and note the tradeoff).

- [ ] **Step 1: Implement the tick**

```ts
// frank-cloud/api/tick.ts
import { Redis } from '@upstash/redis';
import { publish } from '../lib/pubsub.js';

const redis = Redis.fromEnv();

export const config = { runtime: 'nodejs', maxDuration: 30 };

export default async function handler(req: Request): Promise<Response> {
  // Vercel Cron sends a specific user-agent + bearer; in open-deployment setups
  // you can harden this with the CRON_SECRET env var.
  if (process.env.CRON_SECRET) {
    const expected = `Bearer ${process.env.CRON_SECRET}`;
    if (req.headers.get('Authorization') !== expected) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const now = Date.now();

  // Scan all shares with a pending offline deadline.
  // In Upstash Redis, `scan` is the idiomatic approach; `keys` is ok at small scale.
  const offlineKeys = await redis.keys('share:*:authorOfflineAt');
  for (const key of offlineKeys) {
    const shareId = key.split(':')[1];
    const ts = (await redis.get<number>(key)) ?? 0;
    if (ts && ts <= now) {
      await redis.del(key);
      await redis.del(`share:${shareId}:author`);
      await publish(shareId, 'author-status', { status: 'offline' });
    }
  }

  return Response.json({ ok: true, swept: offlineKeys.length });
}
```

- [ ] **Step 2: Register the cron in `frank-cloud/vercel.json`**

Add:

```json
{
  "crons": [
    { "path": "/api/tick", "schedule": "*/1 * * * *" }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add frank-cloud/api/tick.ts frank-cloud/vercel.json
git commit -m "feat(cloud): background tick broadcasts author-offline after grace window"
```

---

## Task 9: Viewer-heartbeat endpoint and comment broadcast

Comments already go through `POST /api/comment`. After storing, publish to the pub/sub channel so every open stream picks them up. Add a cheap `POST /api/share/:id/ping` used by viewers to refresh their session while they're alive.

**Files:**
- Modify: `frank-cloud/api/comment.ts`
- Create: `frank-cloud/api/share-ping.ts`

- [ ] **Step 1: Read current `frank-cloud/api/comment.ts`**

```bash
cat frank-cloud/api/comment.ts
```

- [ ] **Step 2: After the existing comment-persist path, publish the comment event**

In the actual file, the persisted object is named `comment` and the share ID is `shareId`. Insert **after** the `await put(...)` call (line 67 of the current file) and **before** `return Response.json({ comment });`:

```ts
// v3: also broadcast to all open streams for this share.
try {
  const { publish } = await import('../lib/pubsub.js');
  await publish(shareId, 'comment', comment);
} catch { /* broadcast is best-effort; persistence is what matters */ }
```

- [ ] **Step 3: Implement `frank-cloud/api/share-ping.ts`**

```ts
// frank-cloud/api/share-ping.ts
import { readOrCreateSessionToken, touchSession, countViewers } from '../lib/session.js';
import { publish } from '../lib/pubsub.js';

export const config = { runtime: 'nodejs', maxDuration: 10 };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/api\/share\/([a-zA-Z0-9_-]{8,20})\/ping\/?$/);
  if (!m) return Response.json({ error: 'Invalid share ID' }, { status: 400 });
  const shareId = m[1];

  const { token, setCookie } = readOrCreateSessionToken(req);
  const before = await countViewers(shareId);
  await touchSession(shareId, token);
  const after = await countViewers(shareId);
  if (after !== before) await publish(shareId, 'presence', { viewers: after });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  return new Response(JSON.stringify({ ok: true, viewers: after }), { status: 200, headers });
}
```

- [ ] **Step 4: Commit**

```bash
git add frank-cloud/api/comment.ts frank-cloud/api/share-ping.ts
git commit -m "feat(cloud): broadcast comments + viewer heartbeat endpoint"
```

---

## Task 10: `DELETE /api/share/:id` — revoke

The POST-create handler already accepts `oldShareId` / `oldRevokeToken` for soft replacement. v3 adds a distinct explicit revoke that follows the ordered sequence from the spec: invalidate → close streams → delete.

**Files:**
- Modify: `frank-cloud/api/share.ts`

- [ ] **Step 1: Add a DELETE branch to the existing handler**

Inside `export default async function handler(req)`, before the final `return Response.json({ error: 'Method not allowed' }...)`, add:

```ts
// DELETE /api/share?id=xxx — authenticated, revokes + tears down.
if (req.method === 'DELETE') {
  const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (apiKey !== process.env.FRANK_API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const shareId = url.searchParams.get('id');
  if (!shareId || !/^[a-zA-Z0-9_-]{8,20}$/.test(shareId)) {
    return Response.json({ error: 'Invalid share ID' }, { status: 400 });
  }
  const revokeToken = req.headers.get('x-frank-revoke-token') || '';

  try {
    const metaBlob = await fetchBlob(`shares/${shareId}/meta.json`);
    if (!metaBlob) return Response.json({ error: 'not found' }, { status: 404 });
    const meta = JSON.parse(metaBlob);
    if (meta.revokeToken !== revokeToken) {
      return Response.json({ error: 'Invalid revoke token' }, { status: 403 });
    }

    // 1. Invalidate — flip the meta flag + expire so new requests see 410.
    meta.revoked = true;
    meta.expiresAt = new Date(0).toISOString();
    await put(`shares/${shareId}/meta.json`, JSON.stringify(meta), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
    });

    // 2. Close streams via broadcast.
    const { publish, deleteChannel } = await import('../lib/pubsub.js');
    await publish(shareId, 'share-ended', { reason: 'revoked' });
    // Give streams a moment to flush.
    await new Promise((r) => setTimeout(r, 500));
    await deleteChannel(shareId);

    // 3. Delete stored artifacts.
    const { deleteRevision } = await import('../lib/revisions.js');
    const { deleteBuffer } = await import('../lib/diff-buffer.js');
    await deleteRevision(shareId);
    await deleteBuffer(shareId);
    // Blob cleanup: rely on Vercel's prefix-delete. If unavailable, leaving
    // the blobs behind is fine because the meta is flagged revoked.
    try {
      const { del } = await import('@vercel/blob');
      const listed = await list({ prefix: `shares/${shareId}/` });
      for (const b of listed.blobs) await del(b.url);
    } catch { /* best effort */ }

    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frank-cloud/api/share.ts
git commit -m "feat(cloud): DELETE /api/share revokes + tears down streams + buffers"
```

---

## Task 11: Daemon `LiveShareController` — debounce, reconnect, revision tracking

**Depends on Task 12** — the controller imports `postState`, `openAuthorStream`, `revokeShare`, `AuthorStreamHandle` from `./cloud.js`. If you're executing tasks in order, do Task 12 first, then come back here. (The test file uses `vi.mock('./cloud.js')`, so the runtime mock is fine either way — but TypeScript needs the exports to type-check.)

This is the core daemon-side class: one instance per active share. It owns the author-stream `EventSource`-equivalent (using Node's `undici` / `fetch` streaming), debounces + coalesces outgoing state updates, handles the sustained-rate throttle, and tracks the revision counter.

**Files:**
- Create: `daemon/src/live-share.ts`
- Create: `daemon/src/live-share.test.ts`

- [ ] **Step 1: Write unit tests for debounce + coalesce + rate cap**

```ts
// daemon/src/live-share.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./protocol.js', async () => {
  const mod = await vi.importActual<typeof import('./protocol.js')>('./protocol.js');
  return { ...mod, PROJECTS_DIR: '/tmp/frank-ls-test' };
});

vi.mock('./cloud.js', () => ({
  postState: vi.fn().mockResolvedValue({ acceptedRevision: 0 }),
  openAuthorStream: vi.fn().mockReturnValue({ close: () => {}, on: () => {} }),
  revokeShare: vi.fn().mockResolvedValue({ ok: true }),
}));

import { LiveShareController } from './live-share.js';
import * as cloud from './cloud.js';
import fs from 'fs';
import path from 'path';

beforeEach(() => {
  fs.rmSync('/tmp/frank-ls-test', { recursive: true, force: true });
  fs.mkdirSync('/tmp/frank-ls-test/p1', { recursive: true });
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LiveShareController', () => {
  it('coalesces bursts of state pushes into a single send', async () => {
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => ({
      acceptedRevision: body.revision,
    }));
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 10,
    });
    for (let i = 0; i < 20; i++) ctl.pushState({ shapes: i });
    // Advance just over one debounce window.
    await vi.advanceTimersByTimeAsync(120);
    expect(cloud.postState).toHaveBeenCalledTimes(1);
    const lastCall = (cloud.postState as any).mock.calls[0][1];
    expect(lastCall.payload).toEqual({ shapes: 19 });
    expect(lastCall.type).toBe('state');
    await ctl.stop();
  });

  it('enforces per-second rate cap across sustained traffic', async () => {
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => ({
      acceptedRevision: body.revision,
    }));
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 5,
    });
    for (let i = 0; i < 60; i++) {
      ctl.pushState({ shapes: i });
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(500);
    // 60 input bursts over 1.2s with cap=5/s: we should see at most ~6 sends.
    expect((cloud.postState as any).mock.calls.length).toBeLessThanOrEqual(7);
    await ctl.stop();
  });

  it('fast-forwards revision on revision-behind response', async () => {
    let calls = 0;
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => {
      calls++;
      if (calls === 1) return { error: 'revision-behind', currentRevision: 500 };
      return { acceptedRevision: body.revision };
    });
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 30,
    });
    ctl.pushState({ shapes: 1 });
    await vi.advanceTimersByTimeAsync(150);
    ctl.pushState({ shapes: 2 });
    await vi.advanceTimersByTimeAsync(150);
    const secondCall = (cloud.postState as any).mock.calls[1][1];
    expect(secondCall.revision).toBeGreaterThan(500);
    await ctl.stop();
  });

  it('auto-pauses after 2 hours of continuous live sharing', async () => {
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => ({
      acceptedRevision: body.revision,
    }));
    let timedOut = false;
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 30,
      onSessionTimeout: () => { timedOut = true; },
    });
    // Just under 2h — should still be live.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 - 1_000);
    expect(timedOut).toBe(false);
    // Cross the 2h mark.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(timedOut).toBe(true);
    // Pushes after auto-pause are silently dropped — no more calls.
    const callsBefore = (cloud.postState as any).mock.calls.length;
    ctl.pushState({ late: true });
    await vi.advanceTimersByTimeAsync(500);
    expect((cloud.postState as any).mock.calls.length).toBe(callsBefore);
    await ctl.stop();
  });

  it('resume restarts the 2-hour clock', async () => {
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => ({
      acceptedRevision: body.revision,
    }));
    let timeoutCount = 0;
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 30,
      onSessionTimeout: () => { timeoutCount++; },
    });
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 100);
    expect(timeoutCount).toBe(1);
    ctl.resume();
    // An hour in — should NOT have fired again.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(timeoutCount).toBe(1);
    // Another hour — should fire a second time.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    expect(timeoutCount).toBe(2);
    await ctl.stop();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd daemon && npx vitest run src/live-share.test.ts
```

Expected: FAIL — "Cannot find module './live-share.js'".

- [ ] **Step 3: Implement `LiveShareController`**

```ts
// daemon/src/live-share.ts
import { nextRevision, saveRevision, loadRevision } from './revision-store.js';
import { postState, openAuthorStream, revokeShare, AuthorStreamHandle } from './cloud.js';

export interface LiveShareControllerOptions {
  projectId: string;
  shareId: string;
  contentType: 'canvas' | 'image' | 'pdf' | 'url';
  // Upper bound on state-POSTs per second. Defaults match the direction doc:
  // canvas=15, pdf=5, image=1.
  ratePerSecond: number;
  // Author-stream event handlers. Wired by server.ts to broadcast on the
  // UI websocket.
  onComment?: (comment: unknown) => void;
  onPresence?: (viewers: number) => void;
  onAuthorStatus?: (status: 'online' | 'offline' | 'ended') => void;
  onShareEnded?: (reason: 'revoked' | 'expired') => void;
  onError?: (err: string) => void;
  // Auto-pause fires after 2h of continuous streaming. When the UI receives
  // this, the share popover should render this EXACT copy (wired in Phase 5):
  //   "Live share paused — sessions auto-pause after 2 hours to prevent
  //    accidental long-running sessions. Click Resume to continue."
  // Clock is daemon-local and resets on restart (restart = fresh session).
  onSessionTimeout?: () => void;
}

const SESSION_MAX_MS = Number(process.env.FRANK_SESSION_MAX_MS || 2 * 60 * 60 * 1000);

interface PendingUpdate {
  kind: 'state' | 'diff';
  payload: unknown;
}

export class LiveShareController {
  private opts: LiveShareControllerOptions;
  private pending: PendingUpdate | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushAt = 0;
  private authorStream: AuthorStreamHandle | null = null;
  private stopped = false;
  private minIntervalMs: number;
  private paused = false;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: LiveShareControllerOptions) {
    this.opts = opts;
    this.minIntervalMs = Math.max(30, Math.floor(1000 / Math.max(1, opts.ratePerSecond)));
    this.openAuthor();
    this.armSessionTimer();
  }

  private armSessionTimer(): void {
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = setTimeout(() => {
      // Daemon-local 2h cap. Exists to prevent "left laptop open overnight"
      // accidents, not to police deliberate continuations — if the user
      // clicks Resume, a fresh 2h starts. Timer state is NOT persisted
      // across daemon restarts: restart = fresh session, matching user
      // intent when they relaunch Frank.
      this.paused = true;
      this.pending = null;
      this.authorStream?.close();
      this.authorStream = null;
      this.opts.onSessionTimeout?.();
    }, SESSION_MAX_MS);
  }

  get revision(): number { return loadRevision(this.opts.projectId); }
  get viewers(): number { return this._viewers; }
  private _viewers = 0;

  pushState(payload: unknown): void {
    if (this.stopped || this.paused) return;
    // Coalesce — latest state wins. This is the "don't replay history" rule.
    this.pending = { kind: 'state', payload };
    this.scheduleFlush();
  }

  pushDiff(payload: unknown): void {
    if (this.stopped || this.paused) return;
    // Diffs can't be coalesced the same way because each one is additive.
    // But if a `state` was pending, the state supersedes the diff.
    if (this.pending?.kind === 'state') return;
    this.pending = { kind: 'diff', payload };
    this.scheduleFlush();
  }

  pause(): void {
    this.paused = true;
    if (this.sessionTimer) { clearTimeout(this.sessionTimer); this.sessionTimer = null; }
    this.authorStream?.close();
    this.authorStream = null;
  }

  resume(): void {
    this.paused = false;
    this.openAuthor();
    this.armSessionTimer(); // fresh 2h clock
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = null;
    this.authorStream?.close();
    this.authorStream = null;
  }

  async revoke(revokeToken: string): Promise<void> {
    await revokeShare(this.opts.shareId, revokeToken);
    await this.stop();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    const sinceLast = Date.now() - this.lastFlushAt;
    const wait = Math.max(this.minIntervalMs - sinceLast, 100); // min 100ms debounce
    this.flushTimer = setTimeout(() => void this.flush(), wait);
  }

  private async flush(): Promise<void> {
    this.flushTimer = null;
    if (this.stopped || !this.pending) return;
    const update = this.pending;
    this.pending = null;
    this.lastFlushAt = Date.now();

    const rev = nextRevision(this.opts.projectId);
    const res = await postState(this.opts.shareId, {
      revision: rev,
      type: update.kind,
      payload: update.payload,
    });
    if ('error' in res && res.error === 'revision-behind' && res.currentRevision) {
      // Fast-forward and retry this exact update at the new revision.
      saveRevision(this.opts.projectId, res.currentRevision);
      this.pending = update;
      this.scheduleFlush();
      return;
    }
    if ('error' in res) {
      this.opts.onError?.(res.error);
      // Keep the update and retry with backoff.
      this.pending = update;
      this.flushTimer = setTimeout(() => void this.flush(), 1500);
      return;
    }
    // Success — persist the accepted revision.
    saveRevision(this.opts.projectId, res.acceptedRevision);
    // If something queued up while we were sending, schedule again.
    if (this.pending) this.scheduleFlush();
  }

  private openAuthor(): void {
    this.authorStream = openAuthorStream(this.opts.shareId, {
      onComment: (c) => this.opts.onComment?.(c),
      onPresence: ({ viewers }) => {
        this._viewers = viewers;
        this.opts.onPresence?.(viewers);
      },
      onShareEnded: ({ reason }) => this.opts.onShareEnded?.(reason),
      onError: (err) => this.opts.onError?.(err),
      onReconnect: () => {
        // Browser-style EventSource reconnect is automatic; our equivalent
        // is the reconnect loop inside openAuthorStream. Nothing to do here
        // except surface it.
        this.opts.onAuthorStatus?.('online');
      },
      onClose: () => this.opts.onAuthorStatus?.('offline'),
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd daemon && npx vitest run src/live-share.test.ts
```

Expected: PASS — 3/3 assertions green. If any fail, inspect the mock call ordering — the debounce / fake-timer interaction is finicky. Do not skip assertions.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/live-share.ts daemon/src/live-share.test.ts
git commit -m "feat(daemon): LiveShareController with debounce + rate cap + revision fast-forward"
```

---

## Task 12: Cloud client — `openAuthorStream`, `postState`, `revokeShare`

Daemon-side HTTP client for the three new endpoints. `openAuthorStream` is the only one that's non-trivial: it opens an SSE connection using `fetch` + streaming response reader, parses event frames, and reconnects with exponential backoff on drop.

**Files:**
- Modify: `daemon/src/cloud.ts`

- [ ] **Step 1: Add the new exports**

Append to `daemon/src/cloud.ts`:

```ts
export interface AuthorStreamHandlers {
  onComment?: (comment: unknown) => void;
  onPresence?: (ev: { viewers: number }) => void;
  onShareEnded?: (ev: { reason: 'revoked' | 'expired' }) => void;
  onReconnect?: () => void;
  onClose?: () => void;
  onError?: (err: string) => void;
}

export interface AuthorStreamHandle {
  close(): void;
}

export function openAuthorStream(shareId: string, handlers: AuthorStreamHandlers): AuthorStreamHandle {
  const config = loadConfig();
  if (!config) {
    handlers.onError?.('Not connected to cloud');
    return { close() {} };
  }

  let closed = false;
  let controller: AbortController | null = null;
  let backoffMs = 500;

  async function loop() {
    while (!closed) {
      controller = new AbortController();
      try {
        const res = await fetch(`${config.url}/api/share/${shareId}/author-stream`, {
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Accept': 'text/event-stream',
          },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          if (res.status === 410) {
            handlers.onShareEnded?.({ reason: 'expired' });
            return;
          }
          handlers.onError?.(`author-stream HTTP ${res.status}`);
          await sleep(backoffMs);
          backoffMs = Math.min(backoffMs * 2, 10_000);
          continue;
        }
        handlers.onReconnect?.();
        backoffMs = 500;
        await readSse(res.body, handlers);
      } catch (e: any) {
        if (closed) return;
        handlers.onError?.(e.message || String(e));
      }
      handlers.onClose?.();
      if (closed) return;
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 10_000);
    }
  }
  void loop();

  return {
    close() {
      closed = true;
      controller?.abort();
    },
  };
}

async function readSse(body: ReadableStream<Uint8Array>, handlers: AuthorStreamHandlers): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event = '';
  let data = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line === '') {
        // Dispatch.
        if (event && data) {
          try {
            const parsed = JSON.parse(data);
            if (event === 'comment') handlers.onComment?.(parsed);
            else if (event === 'presence') handlers.onPresence?.(parsed);
            else if (event === 'share-ended') handlers.onShareEnded?.(parsed);
          } catch { /* ignore malformed frame */ }
        }
        event = '';
        data = '';
        continue;
      }
      if (line.startsWith(':')) continue; // keep-alive comment
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trim();
      // We intentionally ignore the `id:` line here — the daemon doesn't need
      // Last-Event-ID because the author always reads from the live tail.
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function postState(
  shareId: string,
  body: { revision: number; type: 'state' | 'diff'; payload: unknown },
): Promise<{ acceptedRevision: number } | { error: string; currentRevision?: number }> {
  const config = loadConfig();
  if (!config) return { error: 'Not connected to cloud' };
  try {
    const res = await fetch(`${config.url}/api/share/${shareId}/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: data.error || `HTTP ${res.status}`, currentRevision: data.currentRevision };
    }
    return { acceptedRevision: data.acceptedRevision };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function revokeShare(shareId: string, revokeToken: string): Promise<{ ok: boolean; error?: string }> {
  const config = loadConfig();
  if (!config) return { ok: false, error: 'Not connected to cloud' };
  try {
    const res = await fetch(`${config.url}/api/share?id=${encodeURIComponent(shareId)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'X-Frank-Revoke-Token': revokeToken,
      },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
```

(`loadConfig` is already defined in the file — do not re-declare it.)

- [ ] **Step 2: Build**

```bash
cd daemon && npm run build
```

Expected: clean build. If `fetch` or `ReadableStream` aren't typed, add `"dom"` to `compilerOptions.lib` in `daemon/tsconfig.json` — Node 18+ provides them at runtime.

- [ ] **Step 3: Commit**

```bash
git add daemon/src/cloud.ts daemon/tsconfig.json
git commit -m "feat(daemon): cloud client for author-stream, state push, revoke"
```

---

## Task 13: Wire controllers into `server.ts`

`server.ts` gets a per-project registry of `LiveShareController` instances, new message handlers, and a fan-out of live-share events to whatever browser tab is connected to that project.

**Files:**
- Modify: `daemon/src/server.ts`

- [ ] **Step 1: Add the registry near the top of `server.ts`**

Add after the existing imports / constants:

```ts
import { LiveShareController } from './live-share.js';

// One controller per projectId. Cleaned up on stop-live-share / project close.
const liveShares = new Map<string, LiveShareController>();

function liveShareRate(contentType: 'canvas' | 'image' | 'pdf' | 'url'): number {
  if (contentType === 'canvas') return 15;
  if (contentType === 'pdf') return 5;
  if (contentType === 'image') return 1;
  return 1;
}
```

- [ ] **Step 2: Add handlers for the five new UI→daemon messages**

Inside the main WebSocket message switch (look for the existing `case 'upload-share':` branch), add:

```ts
case 'start-live-share': {
  const project = loadProject(msg.projectId);
  if (!project) return sendError(ws, msg.requestId, 'Project not found');
  if (!project.activeShare) {
    return sendError(ws, msg.requestId, 'No active share — create a share first');
  }
  if (liveShares.has(msg.projectId)) {
    return sendError(ws, msg.requestId, 'Live share already running');
  }
  const ctype = project.contentType as 'canvas' | 'image' | 'pdf' | 'url';
  const ctl = new LiveShareController({
    projectId: msg.projectId,
    shareId: project.activeShare.id,
    contentType: ctype,
    ratePerSecond: liveShareRate(ctype),
    onComment: (comment) => broadcast(ws, { type: 'live-share-comment', projectId: msg.projectId, comment: comment as any }),
    onPresence: (viewers) => broadcast(ws, { type: 'live-share-state', projectId: msg.projectId, status: 'live', viewers, revision: ctl.revision, lastError: null }),
    onAuthorStatus: (status) => broadcast(ws, { type: 'live-share-state', projectId: msg.projectId, status: status === 'online' ? 'live' : status === 'offline' ? 'offline' : 'idle', viewers: ctl.viewers, revision: ctl.revision, lastError: null }),
    onShareEnded: (reason) => {
      liveShares.get(msg.projectId)?.stop();
      liveShares.delete(msg.projectId);
      broadcast(ws, { type: reason === 'revoked' ? 'share-revoked' : 'live-share-state', projectId: msg.projectId, ...(reason === 'revoked' ? {} : { status: 'idle', viewers: 0, revision: ctl.revision, lastError: null }) } as any);
    },
    onError: (err) => broadcast(ws, { type: 'live-share-state', projectId: msg.projectId, status: 'error', viewers: ctl.viewers, revision: ctl.revision, lastError: err }),
    onSessionTimeout: () => {
      // UI banner copy (Phase 5 renders it verbatim from this lastError):
      //   "Live share paused — sessions auto-pause after 2 hours to prevent
      //    accidental long-running sessions. Click Resume to continue."
      const project = loadProject(msg.projectId);
      if (project?.activeShare?.live) {
        project.activeShare.live.paused = true;
        saveProject(project);
      }
      broadcast(ws, {
        type: 'live-share-state',
        projectId: msg.projectId,
        status: 'paused',
        viewers: ctl.viewers,
        revision: ctl.revision,
        lastError: 'session-timeout-2h',
      });
    },
  });
  liveShares.set(msg.projectId, ctl);
  // v3 marks live state on the ActiveShare so it survives restart.
  project.activeShare.live = { revision: ctl.revision, startedAt: new Date().toISOString(), paused: false };
  saveProject(project);
  return sendOk(ws, msg.requestId, { type: 'live-share-state', projectId: msg.projectId, status: 'connecting', viewers: 0, revision: ctl.revision, lastError: null });
}
case 'stop-live-share': {
  const ctl = liveShares.get(msg.projectId);
  if (ctl) { ctl.pause(); }
  const project = loadProject(msg.projectId);
  if (project?.activeShare?.live) {
    project.activeShare.live.paused = true;
    saveProject(project);
  }
  return sendOk(ws, msg.requestId, { type: 'live-share-state', projectId: msg.projectId, status: 'paused', viewers: 0, revision: ctl?.revision ?? 0, lastError: null });
}
case 'resume-live-share': {
  const ctl = liveShares.get(msg.projectId);
  if (!ctl) return sendError(ws, msg.requestId, 'Live share not initialized');
  ctl.resume();
  const project = loadProject(msg.projectId);
  if (project?.activeShare?.live) {
    project.activeShare.live.paused = false;
    saveProject(project);
  }
  return sendOk(ws, msg.requestId, { type: 'live-share-state', projectId: msg.projectId, status: 'connecting', viewers: ctl.viewers, revision: ctl.revision, lastError: null });
}
case 'push-live-state': {
  const ctl = liveShares.get(msg.projectId);
  if (!ctl) return sendError(ws, msg.requestId, 'Live share not running');
  if (msg.kind === 'state') ctl.pushState(msg.payload);
  else ctl.pushDiff(msg.payload);
  return; // fire-and-forget
}
case 'revoke-share': {
  const project = loadProject(msg.projectId);
  if (!project?.activeShare) return sendError(ws, msg.requestId, 'No active share');
  const ctl = liveShares.get(msg.projectId);
  await (ctl ?? { revoke: async (t: string) => {
    const { revokeShare } = await import('./cloud.js');
    await revokeShare(project.activeShare!.id, t);
  } }).revoke(project.activeShare.revokeToken);
  liveShares.delete(msg.projectId);
  project.activeShare = null;
  saveProject(project);
  return sendOk(ws, msg.requestId, { type: 'share-revoked', projectId: msg.projectId });
}
```

Helper functions `sendOk`, `sendError`, `broadcast` may already exist in the file. If not, use the existing single-send pattern (e.g. `ws.send(JSON.stringify(...))`) in their place — do not introduce new helpers in this task.

- [ ] **Step 3: Add a clean shutdown path**

At the bottom of the file (before the `server.listen` call, or in whatever cleanup block exists), add:

```ts
process.on('SIGINT', async () => {
  for (const ctl of liveShares.values()) await ctl.stop();
  process.exit(0);
});
```

- [ ] **Step 4: Rebuild + run all tests**

```bash
cd daemon && npm run build && npm test
```

Expected: build passes. 135 existing tests + the 5 new revision/live-share tests = 140+ pass. Any regressions here usually mean a message-shape mismatch — check protocol.ts against the handler.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/server.ts
git commit -m "feat(daemon): wire LiveShareController into WebSocket handlers"
```

---

## Task 14: Viewer page — connect EventSource, apply generic events

`frank-cloud/public/viewer/` already renders a static snapshot. v3 adds an SSE layer that's aware of the three event kinds Phase 1 cares about: `state`, `diff`, `presence`, `author-status`, `share-ended`, and `comment`. Phase 1 renders them all generically — project-type-specific apply lands in Phases 2–4.

**Files:**
- Modify: `frank-cloud/public/viewer/viewer.js`
- Modify: `frank-cloud/public/viewer/viewer.css`

- [ ] **Step 1: Read the existing viewer**

```bash
cat frank-cloud/public/viewer/viewer.js
cat frank-cloud/public/viewer/viewer.css
```

- [ ] **Step 2: Append the live-share client to `viewer.js`**

Add at the end of the file:

```js
// ─── v3 live-share client ───────────────────────────────────────────────────
// Subscribes to /api/share/:id/stream, dispatches events to the renderer
// appropriate for the project's contentType. Project-type renderers are
// added in phases 2–4; for phase 1 we log events and update generic UI.

(function initLiveShare() {
  const shareId = new URLSearchParams(location.search).get('id')
    || location.pathname.match(/\/s\/([^/]+)/)?.[1];
  if (!shareId) return;

  const presenceEl = document.getElementById('frank-presence');
  const authorStatusEl = document.getElementById('frank-author-status');
  const reconnectEl = document.getElementById('frank-reconnect');

  let lastRevision = window.__frankInitialRevision || -1;
  let es = null;
  let heartbeatTimer = null;
  let fallbackPollTimer = null;

  function setPresence(n) {
    if (!presenceEl) return;
    presenceEl.textContent = n === 1 ? '1 watching' : `${n} watching`;
    presenceEl.hidden = n === 0;
  }
  function setAuthor(status) {
    if (!authorStatusEl) return;
    authorStatusEl.dataset.status = status;
    authorStatusEl.hidden = false;
    authorStatusEl.textContent = {
      online: 'Author online',
      offline: 'Author offline',
      ended: 'Author ended live share',
    }[status] || '';
  }
  function setReconnecting(on) { if (reconnectEl) reconnectEl.hidden = !on; }

  function openStream() {
    setReconnecting(false);
    es = new EventSource(`/api/share/${encodeURIComponent(shareId)}/stream`, { withCredentials: true });
    // Track last event id so EventSource resume works. The browser adds it
    // automatically on reconnect, but some proxies strip it; this is belt+braces.
    es.addEventListener('state', (ev) => {
      const data = JSON.parse(ev.data);
      lastRevision = data.revision;
      window.dispatchEvent(new CustomEvent('frank:state', { detail: data }));
    });
    es.addEventListener('diff', (ev) => {
      const data = JSON.parse(ev.data);
      lastRevision = data.revision;
      window.dispatchEvent(new CustomEvent('frank:diff', { detail: data }));
    });
    es.addEventListener('comment', (ev) => {
      window.dispatchEvent(new CustomEvent('frank:comment', { detail: JSON.parse(ev.data) }));
    });
    es.addEventListener('presence', (ev) => {
      const { viewers } = JSON.parse(ev.data);
      setPresence(viewers);
    });
    es.addEventListener('author-status', (ev) => {
      const { status } = JSON.parse(ev.data);
      setAuthor(status);
    });
    es.addEventListener('share-ended', (ev) => {
      const { reason } = JSON.parse(ev.data);
      setAuthor('ended');
      if (es) { es.close(); es = null; }
      document.body.classList.add(`frank-ended-${reason}`);
    });
    es.onerror = () => {
      setReconnecting(true);
      // Browser auto-reconnects. If the error is terminal (404/410) onerror
      // will fire and readyState goes to CLOSED — fall back to polling.
      if (es && es.readyState === EventSource.CLOSED) {
        es = null;
        startPollingFallback();
      }
    };
  }

  function startPollingFallback() {
    if (fallbackPollTimer) return;
    const pollEl = document.getElementById('frank-updates-disabled');
    if (pollEl) pollEl.hidden = false;
    async function poll() {
      try {
        const r = await fetch(`/api/share?id=${encodeURIComponent(shareId)}`);
        const j = await r.json();
        if (j.snapshot && j.snapshot.revision && j.snapshot.revision > lastRevision) {
          lastRevision = j.snapshot.revision;
          window.dispatchEvent(new CustomEvent('frank:state', { detail: j.snapshot }));
        }
      } catch { /* keep trying */ }
    }
    fallbackPollTimer = setInterval(poll, 5_000);
  }

  function startHeartbeat() {
    heartbeatTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fetch(`/api/share/${encodeURIComponent(shareId)}/ping`, { method: 'POST', credentials: 'include' })
        .catch(() => { /* transient */ });
    }, 60_000);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !es && !fallbackPollTimer) {
      openStream();
    }
  });

  openStream();
  startHeartbeat();
})();
```

- [ ] **Step 3: Add the small UI chrome the script references**

In `frank-cloud/public/viewer/index.html`, add inside the main container (wherever the existing header lives):

```html
<div id="frank-presence" class="frank-presence" hidden></div>
<div id="frank-author-status" class="frank-author-status" hidden></div>
<div id="frank-reconnect" class="frank-reconnect" hidden>Reconnecting…</div>
<div id="frank-updates-disabled" class="frank-updates-disabled" hidden>Live updates unavailable. Polling every 5s.</div>
```

Append to `frank-cloud/public/viewer/viewer.css`:

```css
.frank-presence {
  position: fixed;
  top: 12px;
  right: 12px;
  background: rgba(30, 30, 30, 0.85);
  color: #f0f0f0;
  padding: 4px 10px;
  border-radius: 999px;
  font: 12px/1.2 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  backdrop-filter: blur(6px);
}
.frank-author-status {
  position: fixed;
  top: 42px;
  right: 12px;
  padding: 4px 10px;
  border-radius: 4px;
  font: 11px/1.2 -apple-system, system-ui, sans-serif;
  color: #f0f0f0;
}
.frank-author-status[data-status="online"]  { background: rgba(30, 120, 70, 0.8); }
.frank-author-status[data-status="offline"] { background: rgba(120, 80, 30, 0.8); }
.frank-author-status[data-status="ended"]   { background: rgba(60, 60, 60, 0.8); }
.frank-reconnect,
.frank-updates-disabled {
  position: fixed;
  bottom: 12px;
  right: 12px;
  padding: 6px 12px;
  background: rgba(80, 40, 30, 0.9);
  color: #fff;
  border-radius: 4px;
  font: 12px/1.2 -apple-system, system-ui, sans-serif;
}
.frank-ended-revoked::before,
.frank-ended-expired::before {
  content: "This live share has ended.";
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  color: #fff;
  font-size: 22px;
  font-family: -apple-system, system-ui, sans-serif;
  z-index: 10000;
}
```

- [ ] **Step 4: Commit**

```bash
git add frank-cloud/public/viewer/
git commit -m "feat(cloud-viewer): EventSource client, presence/author/reconnect chrome"
```

---

## Task 15: End-to-end integration test against a fake cloud

Phase 1 works or it doesn't — there's no way to verify the pieces fit without putting them under traffic. This test boots a fake HTTP server that implements the v3 contract with an in-memory KV, points the daemon's `openAuthorStream` + `postState` at it, and drives the controller.

**Files:**
- Create: `daemon/test/fake-cloud.ts`
- Create: `daemon/src/live-share.integration.test.ts`

- [ ] **Step 1: Implement a bare fake cloud**

```ts
// daemon/test/fake-cloud.ts
import http from 'http';
import { AddressInfo } from 'net';

interface Fake {
  url: string;
  stop: () => Promise<void>;
  // Hooks the test can inspect.
  getPosts: () => Array<{ shareId: string; revision: number; type: string; payload: unknown }>;
  broadcastComment: (shareId: string, comment: unknown) => void;
  broadcastShareEnded: (shareId: string, reason: 'revoked' | 'expired') => void;
}

export async function startFakeCloud(apiKey: string): Promise<Fake> {
  const posts: Array<{ shareId: string; revision: number; type: string; payload: unknown }> = [];
  const authorClients = new Map<string, http.ServerResponse[]>();

  const server = http.createServer(async (req, res) => {
    const authOk = req.headers.authorization === `Bearer ${apiKey}`;
    const u = new URL(req.url || '', 'http://localhost');

    const stateM = u.pathname.match(/^\/api\/share\/([^/]+)\/state$/);
    const authorM = u.pathname.match(/^\/api\/share\/([^/]+)\/author-stream$/);

    if (req.method === 'POST' && stateM) {
      if (!authOk) { res.writeHead(401); return res.end(); }
      const shareId = stateM[1];
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      posts.push({ shareId, revision: body.revision, type: body.type, payload: body.payload });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ acceptedRevision: body.revision }));
    }

    if (req.method === 'GET' && authorM) {
      if (!authOk) { res.writeHead(401); return res.end(); }
      const shareId = authorM[1];
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': hello\n\n');
      const list = authorClients.get(shareId) || [];
      list.push(res);
      authorClients.set(shareId, list);
      req.on('close', () => {
        const cur = authorClients.get(shareId) || [];
        authorClients.set(shareId, cur.filter((r) => r !== res));
      });
      return;
    }

    res.writeHead(404); res.end();
  });

  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;

  function broadcast(shareId: string, event: string, data: unknown) {
    const list = authorClients.get(shareId) || [];
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of list) res.write(frame);
  }

  return {
    url,
    stop: () => new Promise<void>((r) => server.close(() => r())),
    getPosts: () => posts.slice(),
    broadcastComment: (shareId, comment) => broadcast(shareId, 'comment', comment),
    broadcastShareEnded: (shareId, reason) => broadcast(shareId, 'share-ended', { reason }),
  };
}
```

- [ ] **Step 2: Write the integration test**

```ts
// daemon/src/live-share.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-int-'));
vi.mock('./protocol.js', async () => {
  const mod = await vi.importActual<typeof import('./protocol.js')>('./protocol.js');
  return { ...mod, PROJECTS_DIR: tmp, CONFIG_PATH: path.join(tmp, 'config.json') };
});

import { startFakeCloud } from '../test/fake-cloud.js';
import { saveCloudConfig } from './cloud.js';
import { LiveShareController } from './live-share.js';

let fake: Awaited<ReturnType<typeof startFakeCloud>>;

beforeAll(async () => {
  fake = await startFakeCloud('test-key');
  fs.mkdirSync(path.join(tmp, 'p1'), { recursive: true });
  saveCloudConfig(fake.url, 'test-key');
});

afterAll(async () => { await fake.stop(); });

describe('live share — integration with fake cloud', () => {
  it('pushState reaches the backend with monotonic revisions', async () => {
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 'share1',
      contentType: 'canvas',
      ratePerSecond: 30,
    });
    ctl.pushState({ step: 'a' });
    await new Promise((r) => setTimeout(r, 250));
    ctl.pushState({ step: 'b' });
    await new Promise((r) => setTimeout(r, 250));
    const posts = fake.getPosts();
    expect(posts.length).toBe(2);
    expect(posts[0].revision).toBe(1);
    expect(posts[1].revision).toBe(2);
    expect(posts[0].payload).toEqual({ step: 'a' });
    expect(posts[1].payload).toEqual({ step: 'b' });
    await ctl.stop();
  });

  it('receives broadcast comments via author-stream', async () => {
    let received: unknown = null;
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 'share1',
      contentType: 'canvas',
      ratePerSecond: 30,
      onComment: (c) => { received = c; },
    });
    await new Promise((r) => setTimeout(r, 200));
    fake.broadcastComment('share1', { id: 'c1', text: 'hi' });
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toEqual({ id: 'c1', text: 'hi' });
    await ctl.stop();
  });

  it('surfaces share-ended when the backend broadcasts it', async () => {
    let ended: { reason: string } | null = null;
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 'share1',
      contentType: 'canvas',
      ratePerSecond: 30,
      onShareEnded: (ev) => { ended = ev; },
    });
    await new Promise((r) => setTimeout(r, 200));
    fake.broadcastShareEnded('share1', 'revoked');
    await new Promise((r) => setTimeout(r, 300));
    expect(ended).toEqual({ reason: 'revoked' });
    await ctl.stop();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd daemon && npx vitest run src/live-share.integration.test.ts
```

Expected: PASS — 3/3.

- [ ] **Step 4: Commit**

```bash
git add daemon/src/live-share.integration.test.ts daemon/test/fake-cloud.ts
git commit -m "test(daemon): integration tests for live share against fake cloud"
```

---

## Task 16: Manual smoke test + README update

Phase 1 is plumbing. Before shipping, smoke-test against a local Vercel dev or Upstash Redis's local emulator.

**Files:**
- Modify: `README.md`
- Modify: `frank-cloud/README.md`

- [ ] **Step 1: Update `frank-cloud/README.md` env section**

Add to the env vars table:

```markdown
| `UPSTASH_REDIS_REST_URL`   | Yes | Upstash Redis REST URL. Install the "Redis (by Upstash)" integration from Vercel Marketplace and link it to the project — Vercel sets this env var automatically. |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis token. Auto-set by the Vercel Marketplace integration. |
| `FRANK_DIFF_BUFFER_MS`  | No  | Rolling diff buffer window, default 60000. |
| `FRANK_AUTHOR_GRACE_MS` | No  | Author-offline grace window, default 15000. |
| `FRANK_VIEWER_CAP`      | No  | Per-share viewer cap, default 10. Intentionally low to keep Upstash Redis free-tier costs bounded; raise for paid plans or alternative hosts. |
| `FRANK_IDLE_TIMEOUT_MS` | No  | Viewer idle timeout, default 1800000 (30 min). |
| `FRANK_IP_RATE_PER_MIN` | No  | Connection attempts per IP per minute, default 120. |
| `FRANK_STATE_MAX_BYTES` | No  | Max bytes per state-push body, default 1048576 (1 MB). |
| `CRON_SECRET`           | No  | If set, `/api/tick` requires `Authorization: Bearer $CRON_SECRET`. |
```

Also add a new section:

```markdown
## v3 endpoints

The deployment exposes the live-share endpoints defined in `CLOUD_API.md`. Cron is used once per minute to sweep author-offline deadlines — make sure `*/1 * * * *` is active in Vercel's dashboard under "Cron Jobs".
```

- [ ] **Step 2: Add a Phase-1 note to the main `README.md`**

Under a new "v3 (in progress)" heading, add:

```markdown
### v3 Phase 1 — SSE transport

- Live-share plumbing is implemented: monotonic revisions, rolling diff buffer, author online/offline detection, viewer presence, share revocation.
- Project-type hooks (canvas/image/PDF live renders) land in Phases 2–4. Until then, `start-live-share` opens the wire but no project emits diffs.
- See [`CLOUD_API.md`](CLOUD_API.md) for the new endpoints and [`docs/superpowers/plans/2026-04-19-v3-phase1-sse-foundation.md`](docs/superpowers/plans/2026-04-19-v3-phase1-sse-foundation.md) for the plan.
```

- [ ] **Step 3: Manual smoke test checklist (run locally, no commit)**

```bash
# 1. Start a Vercel dev instance of frank-cloud with a KV resource linked.
cd frank-cloud && npx vercel dev

# 2. Create a share via the existing v2 path (UI or curl).
curl -X POST http://localhost:3000/api/share \
  -H 'Authorization: Bearer $FRANK_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"snapshot":{"hello":"world"},"coverNote":"smoke","contentType":"canvas"}'

# 3. In another shell, open the viewer stream. Confirm a "state" event arrives.
curl -N http://localhost:3000/api/share/<id>/stream

# 4. POST state updates. Confirm the viewer receives each.
curl -X POST http://localhost:3000/api/share/<id>/state \
  -H 'Authorization: Bearer $FRANK_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"revision":1,"type":"diff","payload":{"tick":1}}'

# 5. Kill the author-stream connection. After ~15s, confirm the viewer
#    stream receives {author-status: offline}.

# 6. DELETE the share. Confirm the viewer stream closes with share-ended.
```

If any step above fails, fix the relevant task's handler before merging.

- [ ] **Step 4: Commit**

```bash
git add README.md frank-cloud/README.md
git commit -m "docs: document v3 Phase 1 env vars, endpoints, smoke test"
```

---

## Migration coexistence

Phase 1 preserves both directions of compatibility so live share can ship without coordinated upgrades:

**v2 client against a v3 backend** — fully covered by the task edits. The v2 `POST /api/share`, `GET /api/share?id=`, `POST /api/comment` handlers are **only appended to**, never rewritten. A v2 daemon creates a share exactly as before and polls for comments; the v3 backend's new endpoints simply go unused. No existing share links break.

**v3 client against a v2 backend** — the upgrade-in-progress edge case. Two scenarios produce this:

1. User upgraded the daemon but hasn't redeployed their `frank-cloud/` deployment.
2. User points at a third-party "Use your own" port that hasn't caught up to the v3 contract.

Both want the same outcome: **the daemon downgrades to v2 behavior for this backend, silently, and retries capability detection later in case the backend is upgraded mid-session.** No spin loops, no blocking errors — sharing still works, just without live.

### Capability cache with TTL

Add a module-level capability marker to `daemon/src/cloud.ts`:

```ts
// Session-scoped "this backend doesn't speak v3" marker. Set on 404 from a
// v3-only endpoint, cleared on any 2xx from one. The 5-minute TTL makes the
// system self-healing if the user redeploys mid-session without restarting
// the daemon.
const V2_ONLY_TTL_MS = 5 * 60 * 1000;
let v2OnlyUntil = 0;

export function markBackendV2Only(): void {
  v2OnlyUntil = Date.now() + V2_ONLY_TTL_MS;
}

export function clearV2OnlyMarker(): void {
  v2OnlyUntil = 0;
}

export function isBackendV2Only(): boolean {
  return Date.now() < v2OnlyUntil;
}
```

Amend `postState` so the marker is set on 404 and cleared on success:

```ts
export async function postState(
  shareId: string,
  body: { revision: number; type: 'state' | 'diff'; payload: unknown },
): Promise<{ acceptedRevision: number } | { error: string; currentRevision?: number; httpStatus?: number }> {
  const config = loadConfig();
  if (!config) return { error: 'Not connected to cloud' };
  if (isBackendV2Only()) {
    return { error: 'v2-only-backend', httpStatus: 404 };
  }
  try {
    const res = await fetch(`${config.url}/api/share/${shareId}/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (res.status === 404) {
      markBackendV2Only();
      return { error: 'v2-only-backend', httpStatus: 404 };
    }
    const data = await res.json();
    if (!res.ok) {
      return { error: data.error || `HTTP ${res.status}`, currentRevision: data.currentRevision, httpStatus: res.status };
    }
    clearV2OnlyMarker();
    return { acceptedRevision: data.acceptedRevision };
  } catch (e: any) {
    return { error: e.message };
  }
}
```

Amend `openAuthorStream` the same way — 404 calls `markBackendV2Only()` and returns without reconnecting; any successful open calls `clearV2OnlyMarker()`. Concretely:

```ts
if (res.status === 404) {
  markBackendV2Only();
  handlers.onError?.('v2-only-backend');
  return; // single-shot failure; do not enter the reconnect loop
}
if (res.ok && res.body) {
  clearV2OnlyMarker();
  // ... existing stream-read logic
}
```

### Controller behavior

In `LiveShareController.flush()`, add a branch that handles the v2-only marker cleanly:

```ts
if ('error' in res && res.httpStatus === 404) {
  // Backend is v2-only right now. Stop pushing, but DON'T permanently kill
  // the controller — if the backend is upgraded, the 5-min TTL lets us
  // retry. For now, surface 'unsupported' once and swallow queued updates.
  this.pending = null;
  this.opts.onError?.('v2-only-backend');
  this.opts.onAuthorStatus?.('ended');
  return;
}
```

And add a check at the top of `pushState` / `pushDiff` so pending updates don't queue into a black hole during the TTL:

```ts
import { isBackendV2Only } from './cloud.js';

pushState(payload: unknown): void {
  if (this.stopped || this.paused) return;
  if (isBackendV2Only()) return; // silently drop; retry on next start-live-share
  this.pending = { kind: 'state', payload };
  this.scheduleFlush();
}
```

### Share-creation probe

The first `postState` *is* the capability probe — no separate endpoint or preflight request needed. The share is created through the v2 path (`uploadShare` → `POST /api/share`), which works against both v2 and v3 backends; live-share push happens after. If the first push 404s, the user has a working v2 share; they just don't get live updates until the backend catches up.

### UI status

Add `'unsupported'` to the `status` union of `LiveShareStateMessage` in `protocol.ts`:

```ts
status: 'idle' | 'connecting' | 'live' | 'paused' | 'offline' | 'error' | 'unsupported';
```

When `onError` fires with `'v2-only-backend'`, the `server.ts` handler emits:

```ts
broadcast(ws, {
  type: 'live-share-state',
  projectId: msg.projectId,
  status: 'unsupported',
  viewers: 0,
  revision: ctl.revision,
  lastError: 'backend-missing-live-share',
});
```

The share popover (Phase 5 handles the full polish) renders this as a subtle, non-blocking banner near the share link:

> Live updates unavailable — your backend needs updating. [Learn more →]

The banner links to the upgrade docs (whatever `frank-cloud/README.md` says for redeploy — `vercel --prod` for the reference impl).

### What this gives us

- **No spin loops.** 404 is a one-shot signal; no reconnect storm.
- **Session-sticky.** Every subsequent share in the same session reuses the marker and skips the expensive retry path.
- **Self-healing.** A redeploy 2–3 minutes into a session resumes working live share on the next push-after-TTL-expiry; no daemon restart required.
- **Graceful UX.** The share link still works. The user sees exactly one banner. Comments sync as v2. Nothing is blocking.

**Share links created before the backend upgrade** — remain v2 (no `live` field on `ActiveShare`). Opening one after a daemon upgrade works fine: `start-live-share` attaches to the existing share ID and the first push probes the backend as described above.

---

## Thresholds to revisit before v3.0 tagging

The direction doc calls out that defaults are worth sanity-checking. These are the numbers set here; expect them to move during Phase 2–4 when real payloads exist:

| Knob | Default | Reason to revisit |
|---|---|---|
| `FRANK_DIFF_BUFFER_MS` | 60,000 | Canvas bursts may exceed a reconnect's replay window. |
| `FRANK_AUTHOR_GRACE_MS` | 15,000 | Hobby function timeouts are ~10s; 15s might still flicker. |
| Daemon canvas rate cap | 15/s | Will be verified under real burst scenarios in Phase 2. |
| Daemon image rate cap | 1/s | Generous — image sessions rarely update at all. |
| Daemon PDF rate cap | 5/s | Scroll/page events; Phase 4 may drop this. |
| `FRANK_STATE_MAX_BYTES` | 1 MB | Canvas with large inline assets may need higher — measure in Phase 2. |
| `FRANK_VIEWER_CAP` | 10 | Intentionally tightened from the direction doc's 50 to keep Upstash Redis free-tier (via Vercel Marketplace) cost bounded for small users. Env-overridable; Settings modal surfaces this in Phase 5 for users who know what they're doing. |
| Session max duration | 2 hours | Daemon-side timer auto-pauses live share after 2h of continuous streaming to prevent accidental overnight sessions. Resettable by "Resume." Clock resets on daemon restart (matches user mental model: restart = fresh session). |
| `FRANK_EVENT_LIST_MAX` | 2000 | Pub/sub list cap. 15 ev/s × 60s = 900 steady-state; 2× headroom. Revisit if Phase 2 canvas bursts blow past it. |
| Cron schedule | `*/1 * * * *` | Author-offline **backstop** only — inline sweep on viewer traffic handles the hot path. Hobby users with empty shares may see up to 60s extra latency on the offline broadcast; acceptable because nobody's watching. |

Open a follow-up issue capturing the measurement plan before v3.0 ships.

---

## Out of scope for this phase (picked up in later phases)

- Per-project-type diff formats (canvas shapes, image annotations, PDF page/scroll).
- UI surface for the "N watching" indicator and "Stop live share" button — Phase 5.
- Share expiration picker in the share popover — Phase 5.
- URL live-share — v3.1.
- Configuring bandwidth burst/sustained caps from the Settings modal — Phase 5 wires the UI; the daemon-side enforcement lands here.

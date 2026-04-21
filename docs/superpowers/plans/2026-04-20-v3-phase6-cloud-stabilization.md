# v3 Phase 6 — Cloud Stabilization + Deployment Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make v3.0 honestly shippable by closing the gap between per-phase daemon testing and end-to-end deployment testing. Exercise every cloud handler against a real Vercel deployment, document the deployment contract, add an integration harness that would have caught the Phase 1–5 cloud bugs, and revise the "Phase X complete" bar so this class of bug can't survive again.

**Architecture:** No new cloud routes, no rewrites. A documentation layer (deployment guide, contract table), a test harness layer (integration test that runs against a real backend — `vercel dev` locally or a preview deployment for CI), and a stabilization pass over the existing handlers. If the pass surfaces a handler that's fundamentally wrong (not merely buggy), it gets escalated as a separate decision — not rolled into Phase 6.

**Tech Stack:** No new runtime deps. Integration harness uses Vitest with `fetch()` against a configurable base URL, driven from the daemon test suite. Deployment guide is plain Markdown. Handler audit is a doc artifact.

**Context:** All five v3 phases (Phase 1 SSE foundation, Phase 2 canvas, Phase 3 image, Phase 4a PDF comments, Phase 5 lifecycle polish) are merged to `dev-v2.08` at HEAD `ca1cffa`. A smoke-test attempt against the merged state surfaced five categorical cloud bugs in rapid succession:

1. `frank-cloud` npm deps never installed (no local `node_modules`).
2. Every non-health handler declared `runtime: 'nodejs'` but written to Fetch API — every request crashed on `req.headers.get(...)`. Fixed in commit `0294a68`.
3. Node `crypto.randomBytes` in edge-runtime-bound files — fixed alongside the runtime migration (same commit) by swapping to WebCrypto.
4. 7 `put()` sites missing `allowOverwrite: true` — any blob re-write crashed with `This blob already exists`. Fixed in commit `0f2df0d`.
5. Relative asset paths in `public/viewer/index.html` — the `/s/:id → /viewer/index.html` rewrite matched `/s/viewer.js` too, serving HTML as a module. Fixed in commit `9cdbaf3`.

All five fixes are already on `dev-v2.08` as their own commits. Phase 6 assumes those are landed and builds forward from there.

**The deeper lesson:** the five phase plans shared a false premise — that the cloud backend worked. The daemon has real integration tests against a mock cloud; the cloud itself had only unit tests of handlers against assumed contracts. Nobody exercised the real stack end-to-end until the v3.0 smoke test. Phase 6 names this honestly and fixes the process, not just the symptoms.

**Scope guard:** Stabilization, not reconstruction. If Task 3 surfaces a handler that's not just misconfigured but architecturally wrong, stop and escalate — don't rewrite it inside this plan.

**Spec:** `/Users/carlostarrats/Downloads/frank-v3-direction.md` (the v3 direction doc, to be annotated with a Phase 6 note in Task 7).

**Prerequisite artifacts already on branch:**
- `docs/v3.0-smoke-test.md` (committed at `ca1cffa`) — the manual checklist Task 6 runs.

**Phases (recap):**
- **Phase 1–5 (complete):** Transport + per-project-type live share + lifecycle polish. All merged to `dev-v2.08`.
- **Phase 6 (this plan):** Cloud stabilization + deployment verification. Prerequisite for v3.0 tag.
- **Phase 4b (v3.x, post-v3.0 / pre-v3.1):** PDF.js rendering migration + page/scroll live sync.
- **v3.1 (out of scope):** URL live share.

---

## Task ordering rationale

Tests exist before fixes use them. Known specific bugs land before any broader audit so the audit doesn't re-discover them and the harness doesn't keep failing on them. Specifically:

- **Task 1** lands the already-diagnosed UPSTASH/KV env-name split. Specific, known root cause from the smoke test. Doing this first means the harness in Task 2 can actually talk to Redis without `.env.local` aliasing hacks.
- **Task 2** stands up the harness. Even minimal coverage is enough for Tasks 3 and 4 to build on.
- **Task 3** is the handler audit — read-only, findings document only. No fixes inside this task.
- **Task 4** fixes blockers the audit surfaces, with tests added to the harness first. This is the "tests before fixes" discipline intact.
- **Task 5** writes the deployment guide using everything learned in Tasks 1–4.
- **Task 6** is the actual gate: run the real smoke test against a preview deployment.
- **Task 7** codifies the process lesson so this class of bug can't survive another phase.
- **Task 8** tags v3.0.

---

## Non-goals

Phase 6 does NOT:

- Rewrite any existing cloud handler. If a handler is broken, it gets a targeted fix; if it's architecturally wrong, it's flagged and deferred.
- Add new live-share functionality.
- Change the daemon's cloud client surface area (`cloud.ts`). Only the backend contract is in scope.
- Replace the existing daemon tests. The daemon's mock-cloud tests stay useful for fast feedback; the integration harness is additive.
- Deploy anything to the user's production Vercel project. All burn-in runs either against `vercel dev` locally or a preview deployment the user explicitly creates.

---

## File Structure

### New files

```
frank-cloud/
├── DEPLOYMENT.md                    # Env vars matrix, route contract, provisioning steps, smoke probes
├── INTEGRATION_TESTING.md           # How to run the harness locally + CI strategy
└── lib/
    └── redis.ts                     # KV_REST_API_* || UPSTASH_REDIS_REST_* dual-read helper

daemon/
└── src/
    └── cloud-integration.test.ts    # Integration test suite, opt-in via FRANK_CLOUD_BASE_URL env

docs/
└── superpowers/
    └── plans/
        └── 2026-04-20-v3-phase6-handler-audit.md  # Per-handler audit findings (Task 3 output)
```

### Modified files

```
docs/
└── v3.0-smoke-test.md               # ADD: "Prerequisites verified by integration harness" pointer
frank-cloud/
├── README.md                        # EXPAND: point at DEPLOYMENT.md + INTEGRATION_TESTING.md
├── api/
│   ├── share-stream.ts              # Redis.fromEnv() → redisClient()
│   └── share-author-stream.ts       # same
│   └── tick.ts                      # same
└── lib/
    ├── pubsub.ts                    # Redis.fromEnv() → redisClient()
    ├── revisions.ts                 # same
    ├── diff-buffer.ts               # same
    ├── session.ts                   # same
    └── limits.ts                    # same
CLAUDE.md                            # ADD: "Shipping a phase" section
```

### Direction doc annotation

```
~/Downloads/frank-v3-direction.md    # One-line Phase 6 entry under the phase recap
```

---

## Task 1: Dual-read Redis env helper

**Files:**
- Create: `frank-cloud/lib/redis.ts`
- Modify: `frank-cloud/api/share-stream.ts`, `frank-cloud/api/share-author-stream.ts`, `frank-cloud/api/tick.ts`, `frank-cloud/lib/pubsub.ts`, `frank-cloud/lib/revisions.ts`, `frank-cloud/lib/diff-buffer.ts`, `frank-cloud/lib/session.ts`, `frank-cloud/lib/limits.ts` (every `Redis.fromEnv()` call site)

`Redis.fromEnv()` only reads `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Vercel's Marketplace integration sets `KV_REST_API_URL` / `KV_REST_API_TOKEN`. During the smoke test we papered over this by appending alias lines to `.env.local`. That works locally but doesn't propagate to a real deployment. Fix it in code so no deployment ever needs the aliasing dance.

- [ ] **Step 1: Write `frank-cloud/lib/redis.ts`**

```typescript
import { Redis } from '@upstash/redis';

/**
 * Return a Redis client reading config from either naming scheme.
 *
 * Precedence: KV_REST_API_* first because Vercel's Upstash Marketplace
 * integration sets those names automatically when a store is linked to
 * a project. UPSTASH_REDIS_REST_* is the fallback for non-Vercel
 * deployments or direct-from-Upstash setups (what the @upstash/redis
 * docs show). Both should point to the same store; the precedence only
 * matters if a user has both set during a migration.
 */
export function redisClient(): Redis {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('Missing Redis env vars — set KV_REST_API_URL+KV_REST_API_TOKEN (Vercel Marketplace) or UPSTASH_REDIS_REST_URL+UPSTASH_REDIS_REST_TOKEN (direct Upstash).');
  }
  return new Redis({ url, token });
}
```

- [ ] **Step 2: Replace `Redis.fromEnv()` in all 8 call sites**

For each file, change the import and the client construction.

Import diff (`frank-cloud/api/share-stream.ts` as representative):
```typescript
-import { Redis } from '@upstash/redis';
+import { redisClient } from '../lib/redis.js';
```

Construction diff:
```typescript
-const redis = Redis.fromEnv();
+const redis = redisClient();
```

Same pattern for the other seven files. For lib/*.ts files the import is `'./redis.js'` (same directory).

- [ ] **Step 3: Remove the UPSTASH alias lines from `.env.local`**

```bash
cd frank-cloud
sed -i.bak '/^UPSTASH_REDIS_REST_/d' .env.local
rm .env.local.bak
grep -E "^(KV_REST|UPSTASH_)" .env.local | sed 's/=.*/=<SET>/'
# Expected: only KV_REST_API_* lines remain
```

- [ ] **Step 4: Restart vercel dev and probe health**

```bash
kill $(lsof -ti :3000) 2>/dev/null; sleep 1
set -a && source .env.local && set +a && npx vercel dev --yes &
sleep 6
curl -s -H "Authorization: Bearer $(grep '^FRANK_API_KEY=' .env.local | cut -d= -f2-)" http://localhost:3000/api/health
# Expected: {"status":"ok","version":"2"}
```

- [ ] **Step 5: Probe a Redis-backed path**

```bash
# share-state writes to Redis via revisions + diff-buffer
KEY=$(grep '^FRANK_API_KEY=' .env.local | cut -d= -f2-)
# First need a share to post state for — create one via POST /api/share (from next step's harness),
# or skip and rely on Task 2's harness to exercise this.
```

If Step 4 passes, Redis is reachable. Deeper probes come in Task 2.

- [ ] **Step 6: Commit**

```bash
git add frank-cloud/lib/redis.ts frank-cloud/api/share-stream.ts frank-cloud/api/share-author-stream.ts frank-cloud/api/tick.ts frank-cloud/lib/pubsub.ts frank-cloud/lib/revisions.ts frank-cloud/lib/diff-buffer.ts frank-cloud/lib/session.ts frank-cloud/lib/limits.ts
git commit -m "fix(cloud): read KV_REST_API_* or UPSTASH_REDIS_REST_* for Redis

Vercel's Upstash Marketplace integration sets KV_REST_API_* variables;
@upstash/redis's Redis.fromEnv() only reads UPSTASH_REDIS_REST_*.
Introduce redisClient() that reads either, preferring the Marketplace
naming. Removes the need for .env.local aliasing on every deployment.

Surfaced during the v3.0 smoke test: Marketplace integration left
UPSTASH_* vars unset; every Redis-backed handler threw on startup."
```

---

## Task 2: Integration harness

**Files:**
- Create: `daemon/src/cloud-integration.test.ts`
- Create: `frank-cloud/INTEGRATION_TESTING.md`

The harness is a Vitest test suite that:
- Opts in via `FRANK_CLOUD_BASE_URL` env var. Unset → tests are skipped (no flakes on normal `npm test`).
- Expects `FRANK_CLOUD_API_KEY` to match the target backend.
- Exercises the contract: create share, fetch share, post comment, start live share (state event), append diff, fetch via SSE, revoke share, attempt fetch-after-revoke → 410.
- Uses fresh share IDs per test (no shared state between runs).
- SSE tests read until a target event arrives or timeout — NOT assert-on-first-chunk, which flakes on keep-alives and framing differences.

- [ ] **Step 1: Write `frank-cloud/INTEGRATION_TESTING.md`**

Covers:
- How to point the harness at `vercel dev` (local): `FRANK_CLOUD_BASE_URL=http://localhost:3000 FRANK_CLOUD_API_KEY=<key> npm test -- cloud-integration`.
- How to point the harness at a preview deployment: same variables, different URL.
- What the harness does NOT test (UI, WebSocket, Konva serialization — unchanged from existing daemon tests).
- Rationale: "daemon tests use a mock cloud for fast feedback. This harness is the backstop that catches contract drift — the thing that would have caught the Phase 1–5 bugs surfaced during the v3.0 smoke test."
- SSE caveat: the edge runtime's response lifetime is bounded and Vercel's proxy may buffer. The SSE tests accept any event stream where a target event arrives within a per-test timeout, not a particular event ordering.

- [ ] **Step 2: Scaffold `daemon/src/cloud-integration.test.ts`**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.FRANK_CLOUD_BASE_URL;
const API_KEY = process.env.FRANK_CLOUD_API_KEY;

describe.skipIf(!BASE_URL || !API_KEY)('cloud integration', () => {
  beforeAll(() => {
    if (!BASE_URL) throw new Error('FRANK_CLOUD_BASE_URL required');
    if (!API_KEY) throw new Error('FRANK_CLOUD_API_KEY required');
  });

  it('health endpoint returns ok with valid key', async () => {
    const res = await fetch(`${BASE_URL}/api/health`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
```

- [ ] **Step 3: Add "create + fetch static share" test**

```typescript
it('creates a static share and fetches it back', async () => {
  const create = await fetch(`${BASE_URL}/api/share`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snapshot: { html: '<p>integration-test</p>' },
      contentType: 'url',
      coverNote: 'integration test',
    }),
  });
  expect(create.status).toBe(200);
  const created = await create.json();
  expect(created.shareId).toMatch(/^[a-zA-Z0-9_-]{8,20}$/);
  expect(created.revokeToken).toMatch(/^[a-zA-Z0-9_-]{8,20}$/);

  const fetched = await fetch(`${BASE_URL}/api/share?id=${created.shareId}`);
  expect(fetched.status).toBe(200);
  const body = await fetched.json();
  expect(body.snapshot.html).toContain('integration-test');
});
```

- [ ] **Step 4: Add "view increments counter without crashing" regression test**

The `allowOverwrite` regression guard. Create a share, GET it twice, assert 200 both times, assert viewCount ≥ 2 on the second fetch.

- [ ] **Step 5: Add "post comment → comment visible in fetch" test**

POST to `/api/comment?shareId=<id>` with author + text. Assert 200. GET the share and assert the comment appears in the comments array.

- [ ] **Step 6: Add "post state event + SSE delivers it" test**

```typescript
it('posts a state event and receives it via SSE within timeout', async () => {
  // Create share
  const create = await fetch(`${BASE_URL}/api/share`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot: { html: '<p>live</p>' }, contentType: 'canvas' }),
  });
  const { shareId } = await create.json();

  // Post state event
  const post = await fetch(`${BASE_URL}/api/share/${shareId}/state`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'state', payload: { canvasState: '{}', assets: {} } }),
  });
  expect(post.status).toBe(200);

  // Open SSE and read events until we see a `state` type or timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  const stream = await fetch(`${BASE_URL}/api/share/${shareId}/stream`, {
    signal: controller.signal,
  });
  expect(stream.status).toBe(200);

  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let seenState = false;

  try {
    while (!seenState) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events — separated by \n\n, each may have `event:` and `data:` lines.
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const raw of events) {
        const eventLine = raw.split('\n').find(l => l.startsWith('event:'));
        if (eventLine?.includes('state')) {
          seenState = true;
          break;
        }
        // keep-alive or other event types are fine, keep reading
      }
    }
  } finally {
    clearTimeout(timeout);
    try { controller.abort(); } catch { /* already aborted */ }
  }

  expect(seenState).toBe(true);
}, 20_000); // outer timeout > inner 15s so abort fires before Vitest kills test
```

Pattern is "read until target event or timeout." Keep-alives and non-state framing are ignored. The outer Vitest timeout is comfortably larger than the inner abort so failure modes surface as assertion failures, not Vitest-killed-the-test.

- [ ] **Step 7: Add "revoke → 410 on subsequent fetch" test**

Create share, DELETE with revoke token, GET, assert 410.

- [ ] **Step 8: Run harness locally**

```bash
cd frank-cloud
set -a && source .env.local && set +a && npx vercel dev --yes &
sleep 6
cd ../daemon
FRANK_CLOUD_BASE_URL=http://localhost:3000 \
  FRANK_CLOUD_API_KEY=$(grep '^FRANK_API_KEY=' ../frank-cloud/.env.local | cut -d= -f2-) \
  npm test -- cloud-integration
```

All tests pass. Any failure is either a Phase 6 blocker (goes into Task 4) or a harness bug (fix the test).

- [ ] **Step 9: Commit**

```bash
git add daemon/src/cloud-integration.test.ts frank-cloud/INTEGRATION_TESTING.md
git commit -m "test(cloud): integration harness for end-to-end backend verification

Opt-in Vitest suite keyed on FRANK_CLOUD_BASE_URL env var. Exercises
the real contract: health, create/fetch/revoke share, post comment,
post state event + SSE delivery. SSE tests read until the target
event arrives or a timeout fires, not assert-on-first-chunk, so
keep-alives and edge-runtime framing quirks don't cause flakes.

Backstop for the test gap that let Phases 1–5 ship cloud handlers
that only worked in unit tests."
```

---

## Task 3: Handler audit (read-only)

**Files:**
- Create: `docs/superpowers/plans/2026-04-20-v3-phase6-handler-audit.md`

**Read-only.** No code changes in this task. The audit is a findings document. Code changes go in Task 4.

For each of the 9 handlers (`api/share.ts` × HTTP verbs GET/POST/DELETE, `api/share-state.ts`, `api/share-stream.ts`, `api/share-author-stream.ts`, `api/share-ping.ts`, `api/comment.ts`, `api/tick.ts`, `api/health.ts`) and each of the 6 lib modules (`lib/pubsub.ts`, `lib/revisions.ts`, `lib/diff-buffer.ts`, `lib/session.ts`, `lib/limits.ts`, `lib/redis.ts` [new from Task 1]), document:

- **Contract:** route + verb + auth + request shape + response shape.
- **Runtime:** edge (confirmed post-commit `0294a68`).
- **External deps:** Upstash Redis commands used, Blob put/list/del paths, any other HTTP fetches.
- **Mutability:** which paths re-write existing blobs (must have `allowOverwrite: true`); which Redis keys persist past the request; whether TTLs are set.
- **Failure modes:** what happens when Redis is unreachable / Blob quota exceeded / malformed payload / missing env var. Note which are "returns 500" vs "silently logs and continues."
- **Known gaps:** anything the smoke test / harness could not reach that still concerns the auditor.

**Section length bounds: 10–30 lines per handler.** Shorter than 10 = audit is shallow, incomplete. Longer than 30 = the auditor is scope-creeping into redesign. If a handler genuinely warrants more detail, factor the detail into a "Deep dive" subsection and keep the main entry compact.

- [ ] **Step 1: Scaffold the audit document**

Create the file with one heading per handler + one per lib module. Use consistent formatting: `### api/share.ts — POST /api/share`. Add a "Findings" section at the end categorizing results (Blocker / Fragile / Document-only).

- [ ] **Step 2: Fill audit for `api/health.ts`**

Quickest handler, useful warm-up. 10–30 lines covering the fields above.

- [ ] **Step 3: Fill audit for `api/share.ts` (GET, POST, DELETE) and `api/comment.ts`**

Static-sharing handlers. Three sections for share.ts (one per verb) + one for comment.ts. Each 10–30 lines.

- [ ] **Step 4: Fill audit for `api/share-state.ts`, `api/share-stream.ts`, `api/share-author-stream.ts`, `api/share-ping.ts`**

Live-share data plane. Note SSE-specific concerns: client disconnect handling, long-poll duration vs edge runtime's hard ceiling, keep-alive cadence, revision monotonicity. Each 10–30 lines.

- [ ] **Step 5: Fill audit for `api/tick.ts`**

Cron. Document what it sweeps, what happens if it doesn't run for 10 minutes, whether anything depends on its cadence for correctness vs just performance. 10–30 lines.

- [ ] **Step 6: Fill audit for lib/ modules**

For each: what keys it reads/writes, TTL semantics, whether any state survives cold start, whether it's safe to call concurrently across handler invocations. 10–30 lines each.

- [ ] **Step 7: Populate the Findings section**

Categorize each concern surfaced above:
- **Blocker** — must fix before v3.0 tag. Goes into Task 4's queue.
- **Fragile** — works but brittle. Nice-to-fix but can defer to v3.0.1 if there's no bandwidth.
- **Document-only** — correct behavior, needs a mention in `DEPLOYMENT.md` (Task 5) so future ops know.

**Off-ramp:** if any finding is architectural (not just a bug or a misconfiguration), stop and escalate to the user before proceeding to Task 4. Architectural findings are out of Phase 6's scope by design.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/plans/2026-04-20-v3-phase6-handler-audit.md
git commit -m "docs: v3 Phase 6 cloud handler audit — findings"
```

---

## Task 4: Fix blockers surfaced by Task 3

**Files:**
- Modify: any `frank-cloud/api/*.ts` or `frank-cloud/lib/*.ts` the audit tagged as blocker.
- Modify: `daemon/src/cloud-integration.test.ts` (add test per blocker).

Runs only if Task 3 surfaced blockers. If the audit had zero blockers, skip directly to Task 5.

- [ ] **Step 1: Read Task 3 findings; enumerate blockers**

List them out. For each, note which handler/lib and a one-sentence description of the bug.

- [ ] **Step 2: For each blocker, write a failing test in the harness**

The harness exists from Task 2. Add a targeted test that reproduces the blocker against the current backend; it should fail pre-fix. This is the "tests before fixes" discipline — the harness now covers the category of bug the blocker represents.

- [ ] **Step 3: Run the harness; confirm the new test(s) fail**

```bash
FRANK_CLOUD_BASE_URL=http://localhost:3000 \
  FRANK_CLOUD_API_KEY=$(grep '^FRANK_API_KEY=' ../frank-cloud/.env.local | cut -d= -f2-) \
  npm test -- cloud-integration
```

Expected: the new tests fail; all prior tests still pass.

- [ ] **Step 4: Fix the blockers, one at a time**

Per blocker: minimal change, no drive-by refactors. Run the harness after each fix; the corresponding new test should now pass.

- [ ] **Step 5: Commit per blocker**

```bash
git commit -m "fix(cloud): <one-line description of blocker>

Surfaced during Phase 6 handler audit. Test added to
cloud-integration.test.ts reproduces the bug against a real backend
pre-fix."
```

One commit per blocker. Each message names the bug and points at the harness test that would have caught it.

---

## Task 5: Deployment guide

**Files:**
- Create: `frank-cloud/DEPLOYMENT.md`
- Modify: `frank-cloud/README.md` (pointer only)

Makes the deployment invisible state visible.

### Required env vars

| Variable | Required | Source | Notes |
|---|---|---|---|
| `FRANK_API_KEY` | Yes | User-generated (e.g. `openssl rand -hex 32`) | Must match daemon's `apiKey` in `~/.frank/config.json`. |
| `KV_REST_API_URL` | Yes | Vercel Marketplace → Upstash for Redis integration | Auto-set when store linked to project. |
| `KV_REST_API_TOKEN` | Yes | same | same |
| `UPSTASH_REDIS_REST_URL` | Alt | Direct-Upstash setups | Only needed if NOT using Vercel's Marketplace integration. |
| `UPSTASH_REDIS_REST_TOKEN` | Alt | same | same |
| `BLOB_READ_WRITE_TOKEN` | Yes | Vercel Storage → Blob store → link to project | Auto-set when linked. |
| `CRON_SECRET` | Optional | User-generated | If set, `/api/tick` requires bearer match. |
| `FRANK_SESSION_TTL` | Optional | default 90 (seconds) | Viewer-session TTL. |
| `FRANK_AUTHOR_GRACE_MS` | Optional | default 15000 (ms) | Author offline detection grace. |
| `FRANK_STATE_MAX_BYTES` | Optional | default 1048576 (1 MB) | Per-push payload cap for live share. |

### Provisioning steps (ordered)

1. Clone `frank-cloud/` or link existing repo to a Vercel project.
2. Marketplace → Upstash for Redis → Install → Link to project.
3. Storage → Blob → Create store → Link to project. (Creating without linking does NOT propagate the env var — confirm link via `vercel blob list-stores` showing the project name in the Projects column.)
4. Settings → Environment Variables → add `FRANK_API_KEY` (generate with `openssl rand -hex 32`).
5. Deploy.

### Post-deploy smoke probes

Three curl commands; all must return 200 (or 200-equivalent for SSE):

```bash
# Health check
curl -H "Authorization: Bearer $FRANK_API_KEY" https://<your-deployment>/api/health
# Expected: {"status":"ok","version":"2"}
```

```bash
# Post-then-fetch a share
SHARE=$(curl -s -X POST https://<deployment>/api/share \
  -H "Authorization: Bearer $FRANK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"snapshot":{"html":"<p>test</p>"},"contentType":"url"}' \
  | jq -r .shareId)
curl -s https://<deployment>/api/share?id=$SHARE | jq .
# Expected: {snapshot, comments, coverNote, metadata}
```

```bash
# Open live-share stream (holds connection open; Ctrl+C to close)
curl -N https://<deployment>/api/share/$SHARE/stream
# Expected: SSE events + ~8s keep-alives
```

If any probe fails, the deployment is not v3.0-ready.

The preferred programmatic check is the integration harness (`frank-cloud/INTEGRATION_TESTING.md`) pointed at the deployment URL.

### Vercel UI gotchas discovered during v3.0 burn-in

- Blob stores must be *linked to the project*; creation alone does not propagate `BLOB_READ_WRITE_TOKEN`. Verify with `vercel blob list-stores --all` that the Projects column includes your project name.
- `vercel env pull .env.local` overwrites the file — don't add local-only values below pulled ones; set them via shell env before `vercel dev` instead.
- `vercel dev` does NOT always reliably source `.env.local` across CLI versions; `set -a && source .env.local && set +a && npx vercel dev` is the belt-and-suspenders path.
- Upstash Marketplace integration sets `KV_REST_API_*` (legacy Vercel KV naming); this codebase reads either that or `UPSTASH_REDIS_REST_*` since the Task 1 helper landed. No aliasing required.

- [ ] **Step 1: Write `DEPLOYMENT.md`** using the structure above.

- [ ] **Step 2: Add pointer to `README.md`**

```markdown
For deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).
For integration-test setup, see [INTEGRATION_TESTING.md](INTEGRATION_TESTING.md).
```

Insert after the opening paragraph — don't duplicate contents.

- [ ] **Step 3: Update `docs/v3.0-smoke-test.md` with a pointer**

Add a note in Section 0 Prerequisites:

```markdown
- [ ] Integration harness passes against the target backend (see
  `frank-cloud/INTEGRATION_TESTING.md`). This verifies Sections 0–3
  at the contract level; the browser flow below is the UI-layer
  check on top.
```

- [ ] **Step 4: Commit**

```bash
git add frank-cloud/DEPLOYMENT.md frank-cloud/README.md docs/v3.0-smoke-test.md
git commit -m "docs(cloud): deployment guide + smoke-test pointer to integration harness"
```

---

## Task 6: Run the smoke test end-to-end against a real deployment

**Files:** No source changes in this task if the smoke test passes clean. Otherwise, file bug commits per failure.

This is the actual gate for tag-ready. Everything above was plumbing.

- [ ] **Step 1: Deploy `dev-v2.08` to a Vercel preview**

```bash
cd frank-cloud
npx vercel --yes
```

Note the preview URL (e.g., `https://frank-cloud-xyz.vercel.app`).

- [ ] **Step 2: Run the harness against the preview**

```bash
cd ../daemon
FRANK_CLOUD_BASE_URL=https://<preview-url> \
  FRANK_CLOUD_API_KEY=$FRANK_API_KEY \
  npm test -- cloud-integration
```

Expected: all tests pass. If any fail, the failure reveals a real Vercel-runtime divergence from local `vercel dev`. Fix before continuing — it's a new blocker that goes through Task 4's pattern (write test if not already covered, fix, commit).

- [ ] **Step 3: Point Frank daemon at the preview URL**

```bash
frank connect https://<preview-url> --key $FRANK_API_KEY
```

- [ ] **Step 4: Work through `docs/v3.0-smoke-test.md` against the preview**

The checklist exists at `docs/v3.0-smoke-test.md` (committed at `ca1cffa`). Use it top-to-bottom. Record every failure in the checklist's bug log with severity (blocker / important / cosmetic / v2-inherited).

- [ ] **Step 5: Triage and fix**

For each bug-log entry:
- **blocker** — fix in this session, commit per fix.
- **important** — fix if cheap, defer to v3.0.1 otherwise.
- **cosmetic** — document, defer.
- **v2-inherited** — note and move on.

- [ ] **Step 6: Re-run the harness + smoke test after fixes**

If anything was fixed, re-run to confirm no regression. Repeat until smoke test is clean.

- [ ] **Step 7: Mark smoke test sign-off**

Fill in the date, tick the sign-off boxes, commit the updated smoke-test doc.

```bash
git add docs/v3.0-smoke-test.md
git commit -m "docs: v3.0 smoke test passing end-to-end against preview deployment"
```

---

## Task 7: Revise the ship-readiness bar

**Files:**
- Modify: `CLAUDE.md` (the repo-level CLAUDE.md for Frank)
- Modify: `~/Downloads/frank-v3-direction.md` (one-line addition; user-owned, noted here for completeness)

- [ ] **Step 1: Add a section to repo `CLAUDE.md`**

Under a new heading `## Shipping a phase`, add:

```markdown
## Shipping a phase

A phase isn't complete when `daemon/npm test` passes. It's complete when
the end-to-end flow it enables works against a real deployment — `vercel
dev` or a Vercel preview — with the cloud integration harness green.

For any phase that touches the daemon ↔ cloud contract:
1. Daemon unit tests pass (`cd daemon && npm test`).
2. Cloud integration harness passes (`FRANK_CLOUD_BASE_URL=… npm test --
   cloud-integration`).
3. Manual smoke of the phase's user-visible flow in the browser.

Steps 1 and 2 are table stakes; step 3 catches UI-layer bugs neither set
of tests can see. Skipping any of the three invalidates the "phase
complete" claim.

This rule was written after the v3.0 smoke test surfaced five
categorical cloud bugs that had survived Phases 1–5 because only step 1
was enforced. The rule exists because the failure mode is real and
recent.
```

- [ ] **Step 2: Annotate the v3 direction doc**

The direction doc lives in `~/Downloads/` (user-owned, not in repo). Add to the phase recap:

```markdown
- **Phase 6 — cloud stabilization + deployment verification.** Addresses
  the gap between per-phase daemon testing and end-to-end deployment
  testing that surfaced during the v3.0 smoke test. Tracked in
  `docs/superpowers/plans/2026-04-20-v3-phase6-cloud-stabilization.md`.
```

Same honesty pattern as the Phase 4b and v3.1 entries. (This edit is out-of-repo; the user can migrate the doc into the repo as part of v3.0 tag prep if desired.)

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: phase-complete requires integration harness green + manual smoke"
```

### Follow-up (not part of Phase 6)

The "Shipping a phase" rule is advisory. Stronger enforcement patterns worth considering post-tag:
- A `npm run preflight` script that runs unit tests + integration harness against a configured URL.
- A pre-commit or pre-merge git hook that blocks merges to `dev-v2.*` unless preflight passed within the last N minutes.
- A required checkbox in the plan template (`- [ ] Cloud integration harness green against preview deployment`) that can't be honestly checked without evidence.

None of those are Phase 6 scope. File as a Phase 7 candidate or a v3.x tech-debt ticket.

---

## Task 8: Tag v3.0

**Files:** None. Just the git operation.

Only reachable if every earlier task is done AND the smoke test sign-off (Task 6 Step 7) is checked.

- [ ] **Step 1: Confirm HEAD is clean**

```bash
git status
# Expected: clean working tree on dev-v2.08
```

- [ ] **Step 2: Confirm integration harness passes against the preview**

```bash
cd daemon
FRANK_CLOUD_BASE_URL=https://<preview-url> \
  FRANK_CLOUD_API_KEY=$FRANK_API_KEY \
  npm test -- cloud-integration
```

- [ ] **Step 3: Merge `dev-v2.08` to `main`** (assuming that's still the release flow)

```bash
git checkout main
git pull
git merge dev-v2.08
```

- [ ] **Step 4: Tag `v3.0` on main**

```bash
git tag -a v3.0 -m "v3.0 — live share for canvas, image, PDF. URL live share deferred to v3.1."
```

- [ ] **Step 5: Push (if the user wants it remote)**

```bash
git push origin main v3.0
```

Don't push unless the user explicitly says to. Tag locally either way.

---

## Self-review checklist

Before handing this plan off:

- [ ] Every task produces a deliverable (doc, test, commit, or tag).
- [ ] No task says "refactor" or "clean up" without a named target.
- [ ] Task 3 has an explicit "if the finding is architectural, escalate" off-ramp — so the plan can't quietly expand into a rewrite.
- [ ] Tests exist before fixes use them. Task 2 (harness) lands before Task 4 (fix blockers with tests).
- [ ] Known specific bugs land first. Task 1 (UPSTASH/KV) before anything that depends on Redis working in any environment.
- [ ] Task 6 is the actual gate. Tasks 1–5 are instrumentation; Task 6 is where we find out if v3.0 ships.
- [ ] Task 7 addresses the *process* failure, not just the code failures, so this class of bug can't survive another phase.

---

## Out of scope (explicit deferrals)

- **PDF.js migration** — Phase 4b.
- **URL live share** — v3.1.
- **Canvas perf tuning** — hasn't been measured under real viewer load; post-tag once Task 6 gives us a real Vercel deployment to measure against.
- **Cloud log aggregation / observability** — Vercel's default logging is the v3.0 floor. Dedicated Sentry/Datadog hook is v3.x.
- **Cloud backend Cloudflare Workers port** — mentioned in `CLOUD_API.md` as possible; not needed for v3.0.
- **Stronger enforcement of the ship-readiness rule** — Task 7 sets the rule; automating the enforcement (preflight script, git hook, plan-template checkbox) is a Phase 7 / v3.x follow-up.

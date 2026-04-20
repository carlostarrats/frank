# v3 Phase 6 — Cloud Stabilization + Deployment Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make v3.0 honestly shippable by closing the gap between per-phase daemon testing and end-to-end deployment testing. Exercise every cloud handler against a real Vercel deployment, document the deployment contract, add an integration harness that would have caught the Phase 1–5 cloud bugs, and revise the "Phase X complete" bar so this class of bug can't survive again.

**Architecture:** No new cloud routes, no rewrites. A documentation layer (deployment guide, contract table), a test harness layer (integration test that runs against a real backend — `vercel dev` locally or a preview deployment for CI), and a stabilization pass over the existing handlers. If the pass surfaces a handler that's fundamentally wrong (not merely buggy), it gets escalated as a separate decision — not rolled into Phase 6.

**Tech Stack:** No new runtime deps. Integration harness uses `node --test` or Vitest with `fetch()` against a configurable base URL, driven from the daemon test suite. Deployment guide is plain Markdown. Handler audit is a doc artifact.

**Context:** All five v3 phases (1 Phase 1 SSE foundation, Phase 2 canvas, Phase 3 image, Phase 4a PDF comments, Phase 5 lifecycle polish) are merged to `dev-v2.08` at HEAD `ca1cffa`. A smoke-test attempt against the merged state surfaced five categorical cloud bugs in rapid succession:

1. `frank-cloud` npm deps never installed (no local `node_modules`).
2. Every non-health handler declared `runtime: 'nodejs'` but written to Fetch API — every request crashed on `req.headers.get(...)`. Fixed in commit `0294a68`.
3. Node `crypto.randomBytes` in edge-runtime-bound files — fixed alongside the runtime migration (same commit) by swapping to WebCrypto.
4. 7 `put()` sites missing `allowOverwrite: true` — any blob re-write crashed with `This blob already exists`. Fixed in commit `0f2df0d`.
5. Relative asset paths in `public/viewer/index.html` — the `/s/:id → /viewer/index.html` rewrite matched `/s/viewer.js` too, serving HTML as a module. Fixed in commit `9cdbaf3`.

All five fixes are already on `dev-v2.08` as their own commits. Phase 6 assumes those are landed and builds forward from there.

**The deeper lesson:** the five phase plans shared a false premise — that the cloud backend worked. The daemon has real integration tests against a mock cloud; the cloud itself had only unit tests of handlers against assumed contracts. Nobody exercised the real stack end-to-end until the v3.0 smoke test. Phase 6 names this honestly and fixes the process, not just the symptoms.

**Scope guard:** Stabilization, not reconstruction. If Task 2 surfaces a handler that's not just misconfigured but architecturally wrong, stop and escalate — don't rewrite it inside this plan.

**Spec:** `/Users/carlostarrats/Downloads/frank-v3-direction.md` (the v3 direction doc, to be annotated with a Phase 6 note in Task 6).

**Phases (recap):**
- **Phase 1–5 (complete):** Transport + per-project-type live share + lifecycle polish. All merged to `dev-v2.08`.
- **Phase 6 (this plan):** Cloud stabilization + deployment verification. Prerequisite for v3.0 tag.
- **Phase 4b (v3.x, post-v3.0 / pre-v3.1):** PDF.js rendering migration + page/scroll live sync.
- **v3.1 (out of scope):** URL live share.

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
├── DEPLOYMENT.md           # Env vars matrix, route contract, provisioning steps, smoke probes
└── INTEGRATION_TESTING.md  # How to run the harness locally + CI strategy

daemon/
└── src/
    └── cloud-integration.test.ts  # Integration test suite, opt-in via FRANK_CLOUD_BASE_URL env

docs/
└── superpowers/
    └── plans/
        └── 2026-04-20-v3-phase6-handler-audit.md  # Per-handler audit findings (Task 2 output)
```

### Modified files

```
docs/
└── v3.0-smoke-test.md     # ADD: "Prerequisites verified by integration harness" note + pointer to INTEGRATION_TESTING.md
frank-cloud/
└── README.md              # EXPAND: point at DEPLOYMENT.md + INTEGRATION_TESTING.md
```

### Direction doc annotation

```
~/Downloads/frank-v3-direction.md  # One-line Phase 6 entry under the phase recap
```

---

## Task 1: Handler audit

**Files:**
- Create: `docs/superpowers/plans/2026-04-20-v3-phase6-handler-audit.md`

The audit is a *findings document*, not a code change. For each of the 9 handlers (`api/share.ts` × HTTP verbs GET/POST/DELETE, `api/share-state.ts`, `api/share-stream.ts`, `api/share-author-stream.ts`, `api/share-ping.ts`, `api/comment.ts`, `api/tick.ts`, `api/health.ts`) and each of the 6 lib modules (`lib/pubsub.ts`, `lib/revisions.ts`, `lib/diff-buffer.ts`, `lib/session.ts`, `lib/limits.ts`), document:

- **Contract:** route + verb + auth + request shape + response shape.
- **Runtime:** edge (confirmed post-commit `0294a68`).
- **External deps:** Upstash Redis commands used, Blob put/list/del paths, any other HTTP fetches.
- **Mutability:** which paths re-write existing blobs (must have `allowOverwrite: true`); which Redis keys persist past the request; whether TTLs are set.
- **Failure modes:** what happens when Redis is unreachable / Blob quota exceeded / malformed payload / missing env var. Note which are "returns 500" vs "silently logs and continues."
- **Known gaps:** anything the smoke test could not reach that still concerns the auditor.

- [ ] **Step 1: Scaffold the audit document**

Create the file with one section per handler + one per lib module. Use a consistent heading format: `### api/share.ts — POST /api/share`.

- [ ] **Step 2: Fill audit for `api/health.ts`**

Quickest handler, useful warm-up. Document the exact request/response contract. Note that it's the only handler on edge from day one (so any runtime-specific findings elsewhere are about the migration, not architecture).

- [ ] **Step 3: Fill audit for `api/share.ts` (GET, POST, DELETE) and `api/comment.ts`**

These are the request/response handlers that drive v2-style static sharing. Document each verb separately — GET is public/read, POST/DELETE are authed.

- [ ] **Step 4: Fill audit for `api/share-state.ts`, `api/share-stream.ts`, `api/share-author-stream.ts`, `api/share-ping.ts`**

The v3 live-share data plane. Note SSE-specific concerns: client disconnect handling, long-poll duration vs edge runtime's hard ceiling, keep-alive cadence, revision monotonicity.

- [ ] **Step 5: Fill audit for `api/tick.ts`**

Cron handler. Document what it sweeps, what happens if it doesn't run for 10 minutes, whether anything depends on its cadence for correctness vs just performance.

- [ ] **Step 6: Fill audit for lib/ modules**

For each: what keys it reads/writes, TTL semantics, whether any state survives cold start, whether it's safe to call concurrently across handler invocations.

- [ ] **Step 7: Collect findings section**

At the end of the audit doc, add a "Findings" section categorizing each concern as:
- **Blocker** — must fix before v3.0 tag. Examples: missing auth check, mutable blob without `allowOverwrite`.
- **Fragile** — works but brittle. File into Phase 6 work as a Task.
- **Document-only** — correct behavior, needs a mention in `DEPLOYMENT.md` so future ops know about it.

If any finding is architectural (not just a bug), note it and stop — escalate to the user before adding it to the task list.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/plans/2026-04-20-v3-phase6-handler-audit.md
git commit -m "docs: v3 Phase 6 cloud handler audit — findings"
```

---

## Task 2: Fix blockers surfaced by the audit

**Files:**
- Modify: any `frank-cloud/api/*.ts` or `frank-cloud/lib/*.ts` the audit tagged as blocker.

- [ ] **Step 1: Read Task 1 findings, enumerate blockers**

If the findings section is empty of blockers, skip to Task 3. If it has blockers, proceed.

- [ ] **Step 2: For each blocker, write a targeted test in the integration harness (Task 3 scaffolds this — if Task 3 isn't done yet, skip the test-first step and document the test to add in Task 3)**

Tests drive fixes. Every blocker fix gets an integration test that would have caught the blocker pre-fix.

- [ ] **Step 3: Fix the blocker**

Minimal change. No drive-by refactors.

- [ ] **Step 4: Run the integration harness**

Expected: the new test passes. Pre-existing tests continue to pass.

- [ ] **Step 5: Commit per blocker**

```bash
git commit -m "fix(cloud): <one-line description of blocker>"
```

One commit per blocker, not one mega-commit. Each message explains what was broken and how it surfaced.

---

## Task 3: Integration harness

**Files:**
- Create: `daemon/src/cloud-integration.test.ts`
- Create: `frank-cloud/INTEGRATION_TESTING.md`

The harness is a Vitest test suite that:
- Opts in via `FRANK_CLOUD_BASE_URL` env var. Unset → tests are skipped (no flakes on normal `npm test`).
- Expects `FRANK_CLOUD_API_KEY` to match the target backend.
- Exercises the contract: create share, fetch share, post comment, start live share (state event), append diff, fetch via SSE, revoke share, attempt fetch-after-revoke → 410.
- Uses fresh share IDs per test (no shared state between runs).

- [ ] **Step 1: Write `INTEGRATION_TESTING.md`**

Covers:
- How to point the harness at `vercel dev` (local): `FRANK_CLOUD_BASE_URL=http://localhost:3000 FRANK_CLOUD_API_KEY=<key> npm test -- cloud-integration`.
- How to point the harness at a preview deployment: same variables, different URL.
- What the harness does NOT test (UI, WebSocket, Konva serialization — unchanged from existing daemon tests).
- Rationale: "daemon tests use a mock cloud for fast feedback. This harness is the backstop that catches contract drift — the thing that would have caught the Phase 1–5 bugs surfaced during the v3.0 smoke test."

- [ ] **Step 2: Scaffold `cloud-integration.test.ts`**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.FRANK_CLOUD_BASE_URL;
const API_KEY = process.env.FRANK_CLOUD_API_KEY;

// Opt-in: skip entire file if BASE_URL unset.
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

- [ ] **Step 3: Write "create static share" test**

POST a minimal URL-type share. Assert 200. Assert response has `shareId`, `revokeToken`, `url`.

Then GET `/api/share?id=<shareId>`. Assert 200. Assert snapshot matches what was posted.

- [ ] **Step 4: Write "first view increments viewCount without crashing" test**

This is the regression test for the `allowOverwrite` bug. GET the share twice; second call must still return 200.

- [ ] **Step 5: Write "post comment" test**

POST to `/api/comment?shareId=<id>` with author + text. Assert 200. Then GET the share and confirm the comment is in the returned comments array.

- [ ] **Step 6: Write "live share: post state event + fetch via SSE" test**

POST to `/api/share/<id>/state` with a minimal state payload. Assert 200.

Open an SSE stream to `/api/share/<id>/stream`. Use `fetch()` with a manually-parsed stream reader (the Web ReadableStream API). Assert the first event received is `state` with the posted payload.

Close the stream after one event. Set a test timeout ≤ 15 seconds so a hung stream fails fast.

- [ ] **Step 7: Write "revoke share → fetch returns 410" test**

POST a new share. DELETE it with the revoke token. GET the share. Assert 410.

- [ ] **Step 8: Run harness locally**

```bash
cd frank-cloud && set -a && source .env.local && set +a && npx vercel dev --yes &
sleep 5
cd ../daemon
FRANK_CLOUD_BASE_URL=http://localhost:3000 \
  FRANK_CLOUD_API_KEY=$(grep '^FRANK_API_KEY=' ../frank-cloud/.env.local | cut -d= -f2-) \
  npm test -- cloud-integration
```

All tests pass. If any fail, the failure is either a Phase 6 blocker (go fix it in Task 2) or a harness bug (fix the test).

- [ ] **Step 9: Commit**

```bash
git add daemon/src/cloud-integration.test.ts frank-cloud/INTEGRATION_TESTING.md
git commit -m "test(cloud): integration harness for end-to-end backend verification"
```

---

## Task 4: Deployment guide

**Files:**
- Create: `frank-cloud/DEPLOYMENT.md`
- Modify: `frank-cloud/README.md` (pointer only)

`DEPLOYMENT.md` is the artifact that makes the deployment invisible state visible. Covers:

### Required env vars

| Variable | Required | Source | Notes |
|---|---|---|---|
| `FRANK_API_KEY` | Yes | User-generated (e.g. `openssl rand -hex 32`) | Must match daemon's `apiKey` in `~/.frank/config.json`. |
| `UPSTASH_REDIS_REST_URL` | Yes | Vercel Marketplace → Upstash for Redis integration | Auto-set when store linked to project. |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | same | same |
| `BLOB_READ_WRITE_TOKEN` | Yes | Vercel Storage → Blob store → link to project | Auto-set when linked. |
| `CRON_SECRET` | Optional | User-generated | If set, `/api/tick` requires bearer match. |
| `FRANK_SESSION_TTL` | Optional | default 90 (seconds) | Viewer-session TTL. Keep unless debugging. |
| `FRANK_AUTHOR_GRACE_MS` | Optional | default 15000 (ms) | Author offline detection grace. |
| `FRANK_STATE_MAX_BYTES` | Optional | default 1048576 (1 MB) | Per-push payload cap for live share. |

### Provisioning steps (ordered)

1. Clone `frank-cloud/` or link existing repo to a Vercel project.
2. Marketplace → Upstash for Redis → Install → Link to project.
3. Storage → Blob → Create store → Link to project. (Creating without linking does NOT propagate the env var — confirm link via `vercel blob list-stores` showing the project name in the Projects column.)
4. Settings → Environment Variables → add `FRANK_API_KEY` (generate with `openssl rand -hex 32`).
5. Deploy.

### Post-deploy smoke probes

Three curl commands; all must return 200:

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
# Open live-share stream (will hold connection open)
curl -N https://<deployment>/api/share/$SHARE/stream
# Expected: SSE keep-alives every ~8s; Ctrl+C to close
```

If any probe fails, the deployment is not v3.0-ready.

### Vercel UI gotchas discovered during v3.0 burn-in

Real findings from the session that produced this document:
- Blob stores must be *linked to the project*; creation alone does not propagate `BLOB_READ_WRITE_TOKEN`. Verify with `vercel blob list-stores --all` that the Projects column includes your project name.
- `vercel env pull .env.local` overwrites the file — don't add local-only values below pulled ones, add a wrapper `.env.local.local` or set shell env before `vercel dev`.
- `vercel dev` does NOT automatically source `.env.local` reliably in every CLI version; `set -a && source .env.local && set +a && npx vercel dev` is the belt-and-suspenders path.
- Upstash's Marketplace integration names its env vars `KV_REST_API_*` (legacy Vercel KV naming), but `Redis.fromEnv()` from `@upstash/redis` reads `UPSTASH_REDIS_REST_*`. Either (a) alias the KV vars to UPSTASH names in env, or (b) change each `Redis.fromEnv()` call to `new Redis({ url, token })` with explicit reads. Phase 6 picks one; see Task 5.

- [ ] **Step 1: Write `DEPLOYMENT.md`** using the structure above.

- [ ] **Step 2: Add pointer to `README.md`**

```markdown
For deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).
For integration-test setup, see [INTEGRATION_TESTING.md](INTEGRATION_TESTING.md).
```

Insert after the opening paragraph — don't duplicate the contents.

- [ ] **Step 3: Commit**

```bash
git add frank-cloud/DEPLOYMENT.md frank-cloud/README.md
git commit -m "docs(cloud): deployment guide covering env vars, provisioning, smoke probes"
```

---

## Task 5: Resolve the UPSTASH vs KV env naming

**Files:**
- Modify: `frank-cloud/api/share-stream.ts`, `frank-cloud/api/share-author-stream.ts`, `frank-cloud/api/tick.ts`, `frank-cloud/lib/pubsub.ts`, `frank-cloud/lib/revisions.ts`, `frank-cloud/lib/diff-buffer.ts`, `frank-cloud/lib/limits.ts`, `frank-cloud/lib/session.ts` (every `Redis.fromEnv()` call site)

`Redis.fromEnv()` only reads `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Vercel's Marketplace integration sets `KV_REST_API_URL` / `KV_REST_API_TOKEN`. During the smoke test we papered over this by appending alias lines to `.env.local`. That works locally but doesn't propagate to a real deployment.

Pick one:
- **Option A (tried in smoke test):** alias in env. Users must manually add UPSTASH-named vars. Requires action in Vercel dashboard for every deployment. Failure-prone.
- **Option B (recommended):** change `Redis.fromEnv()` to a helper that reads either naming, defaulting to KV_* (what the integration sets) and falling back to UPSTASH_* (what the `@upstash/redis` docs show). One change, works in every deployment.

Choose Option B.

- [ ] **Step 1: Add helper to `frank-cloud/lib/redis.ts`**

Create a new file:

```typescript
import { Redis } from '@upstash/redis';

export function redisClient(): Redis {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('Missing Redis env vars — set KV_REST_API_URL+KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL+UPSTASH_REDIS_REST_TOKEN');
  }
  return new Redis({ url, token });
}
```

- [ ] **Step 2: Replace `Redis.fromEnv()` with `redisClient()` in all call sites**

Files: as listed above. Change the import from `import { Redis } from '@upstash/redis'` to `import { redisClient } from './redis.js'` (or `'../lib/redis.js'` from handlers), and change `const redis = Redis.fromEnv();` to `const redis = redisClient();`.

- [ ] **Step 3: Run the integration harness against `vercel dev` WITHOUT the alias lines in `.env.local`**

```bash
# Remove the UPSTASH_* alias block we added during smoke test
sed -i.bak '/^UPSTASH_REDIS_REST_/d' frank-cloud/.env.local
rm frank-cloud/.env.local.bak

# Restart vercel dev
cd frank-cloud
kill $(lsof -ti :3000) 2>/dev/null; sleep 1
set -a && source .env.local && set +a && npx vercel dev --yes &

# Re-run the harness
cd ../daemon
FRANK_CLOUD_BASE_URL=http://localhost:3000 \
  FRANK_CLOUD_API_KEY=$(grep '^FRANK_API_KEY=' ../frank-cloud/.env.local | cut -d= -f2-) \
  npm test -- cloud-integration
```

Expected: all tests pass, reading from `KV_REST_API_*` directly.

- [ ] **Step 4: Update `DEPLOYMENT.md`**

Remove the "pick one: UPSTASH vs KV" gotcha from the Vercel UI gotchas section — it's resolved. Replace with: "`KV_REST_API_*` (from Upstash Marketplace integration) works directly; no aliasing needed."

- [ ] **Step 5: Commit**

```bash
git add frank-cloud/lib/redis.ts frank-cloud/api/*.ts frank-cloud/lib/*.ts frank-cloud/DEPLOYMENT.md
git commit -m "fix(cloud): read either KV_REST_API_* or UPSTASH_REDIS_REST_* for Redis"
```

---

## Task 6: Run the smoke test end-to-end against a real deployment

**Files:** No source changes in this task if the smoke test passes clean. Otherwise, file bug commits per failure.

This is the actual gate for tag-ready. Everything above was plumbing; this is the burn-in.

- [ ] **Step 1: Deploy `dev-v2.08` to a Vercel preview**

```bash
cd frank-cloud
npx vercel --yes
```

Note the preview URL (e.g., `https://frank-cloud-xyz.vercel.app`).

- [ ] **Step 2: Point Frank daemon at the preview URL**

```bash
frank connect https://<preview-url> --key $FRANK_API_KEY
```

- [ ] **Step 3: Run the harness against the preview**

```bash
cd daemon
FRANK_CLOUD_BASE_URL=https://<preview-url> \
  FRANK_CLOUD_API_KEY=$FRANK_API_KEY \
  npm test -- cloud-integration
```

Expected: all tests pass. If not, the test failure reveals a real Vercel-runtime divergence from local `vercel dev`. Fix before continuing.

- [ ] **Step 4: Work through `docs/v3.0-smoke-test.md` against the preview**

Use the checklist top-to-bottom. Record every failure in the checklist's bug log with severity.

- [ ] **Step 5: Triage and fix**

For each bug-log entry:
- **blocker** — fix in this session, commit per fix.
- **important** — fix if cheap, defer to v3.0.1 otherwise.
- **cosmetic** — document, defer.
- **v2-inherited** — note and move on.

- [ ] **Step 6: Re-run the harness and smoke test after fixes**

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
- Modify: `~/Downloads/frank-v3-direction.md` (one-line addition)

The point: future phases don't re-fall into the "daemon tests pass but cloud is broken" trap.

- [ ] **Step 1: Add a section to repo `CLAUDE.md`**

Under a new heading "## Shipping a phase" (or similar), add:

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

Add a one-line entry under the phase recap (wherever Phases 1–5 are listed):

```markdown
- **Phase 6 — cloud stabilization + deployment verification.** Addresses
  the gap between per-phase daemon testing and end-to-end deployment
  testing that surfaced during the v3.0 smoke test. Tracked in
  `docs/superpowers/plans/2026-04-20-v3-phase6-cloud-stabilization.md`.
```

Same honesty pattern as the Phase 4b and v3.1 entries.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: phase-complete requires integration harness green + manual smoke"
```

The direction doc is user-owned (lives in ~/Downloads), not in the repo, so it doesn't get committed here — but the user can copy the annotation over by hand or migrate the doc into the repo as part of v3.0 tag prep.

---

## Task 8: Tag v3.0

**Files:** None. Just the git operation.

Only reachable if every earlier task is done AND the smoke test sign-off (Task 6 Step 7) is checked.

- [ ] **Step 1: Confirm HEAD is clean**

```bash
git status
# Expected: clean working tree on dev-v2.08
```

- [ ] **Step 2: Confirm integration harness passes**

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
- [ ] Task 2 has an explicit "if the finding is architectural, escalate" off-ramp — so the plan can't quietly expand into a rewrite.
- [ ] Task 6 is the actual gate. Tasks 1–5 are instrumentation; Task 6 is where we find out if v3.0 ships.
- [ ] Task 7 addresses the *process* failure, not just the code failures, so this class of bug can't survive another phase.

---

## Out of scope (explicit deferrals)

- **PDF.js migration** — Phase 4b.
- **URL live share** — v3.1.
- **Canvas perf tuning** — hasn't been measured under real viewer load; post-tag once Task 6 gives us a real Vercel deployment to measure against.
- **Cloud log aggregation / observability** — Vercel's default logging is the v3.0 floor. Dedicated Sentry/Datadog hook is v3.x.
- **Cloud backend Cloudflare Workers port** — mentioned in `CLOUD_API.md` as possible; not needed for v3.0.

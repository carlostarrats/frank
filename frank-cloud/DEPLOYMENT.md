# Frank Cloud — Deployment Guide

The cloud backend is a Vercel-hosted, edge-runtime serverless layer that powers Frank's share links and v3 live-share transport. It depends on Upstash Redis (for pub/sub, rate limits, sessions, revisions, diff buffers) and Vercel Blob (for durable share payloads + comments).

This doc makes the invisible parts of the deployment visible: every env var, every provisioning step, every smoke probe you need to run after a deploy.

> **Before deploying:** run the integration harness against a local `vercel dev` to catch contract regressions ahead of the real deploy. See [INTEGRATION_TESTING.md](INTEGRATION_TESTING.md).

---

## Required env vars

### Core

| Variable | Source | Notes |
|---|---|---|
| `FRANK_API_KEY` | You generate (`openssl rand -hex 32`). | Must match the `apiKey` the Frank daemon writes to `~/.frank/config.json` via `frank connect`. Without it, every authed endpoint returns 401. |
| `KV_REST_API_URL` | Vercel Marketplace → Upstash for Redis → Link to project. | Auto-set. Used by all Redis-backed handlers + lib modules. |
| `KV_REST_API_TOKEN` | same | same |
| `BLOB_READ_WRITE_TOKEN` | Vercel Storage → Blob → **Link to project**. Store must be created **public**. | Auto-set once the store is linked. Without linking, creation alone does NOT propagate the token. See the [gotchas](#vercel-ui-gotchas) section. |

### Alternative Redis naming (non-Vercel)

| Variable | Required? | Notes |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Only if `KV_REST_API_URL` is not set. | For direct-from-Upstash setups (no Vercel Marketplace integration). |
| `UPSTASH_REDIS_REST_TOKEN` | same | same |

`lib/redis.ts` reads `KV_REST_API_*` first, falling back to `UPSTASH_REDIS_REST_*`. Don't set both — they should point at the same store anyway. The precedence only matters during a migration.

### Optional / tunable

| Variable | Default | Notes |
|---|---|---|
| `CRON_SECRET` | (unset) | If set, `/api/tick` requires `Authorization: Bearer <CRON_SECRET>`. **Set this in production** — without it, `/api/tick` is publicly callable. Harmless in effect (just triggers a sweep), but rude. |
| `FRANK_SESSION_TTL` | `90` (seconds) | Viewer-session TTL. Keep unless debugging. |
| `FRANK_AUTHOR_GRACE_MS` | `15000` (ms) | Author-offline detection grace. |
| `FRANK_STATE_MAX_BYTES` | `1048576` (1 MB) | Per-push payload cap for live-share state events. 413 on exceed. |
| `FRANK_VIEWER_CAP` | `10` | Max concurrent viewers per share. 429 on exceed. |
| `FRANK_IP_RATE_PER_MIN` | `120` | Per-IP connect rate limit on `/api/share/:id/stream`. |
| `FRANK_DIFF_BUFFER_MS` | `60000` | Rolling diff buffer window — how long a cold-open viewer can reconnect via diff replay before needing a state snapshot. |
| `FRANK_EVENT_LIST_MAX` | `1000` | Per-channel pubsub list cap. |

---

## Provisioning steps (ordered)

1. **Fork / clone** `frank-cloud/` into a Vercel project.
2. **Upstash Redis** — Vercel Dashboard → Marketplace → "Upstash for Redis" → Install → select your Frank project. This sets `KV_REST_API_URL` + `KV_REST_API_TOKEN` automatically.
3. **Vercel Blob** — Vercel Dashboard → Storage → Create Store → **Blob** → pick **Public** access → link to your Frank project. (Linking is a separate step from creation — see gotchas.) This sets `BLOB_READ_WRITE_TOKEN`.
4. **`FRANK_API_KEY`** — Settings → Environment Variables → Add. Value: output of `openssl rand -hex 32`. Apply to Production, Preview, and Development.
5. **`CRON_SECRET` (recommended)** — same place. `openssl rand -hex 32`.
6. **Deploy.**

After step 6, point your Frank daemon at the deployment:

```bash
frank connect https://<your-deployment> --key <FRANK_API_KEY>
```

The Settings modal in the Frank UI (cog icon on the home header) provides the same configuration without the CLI.

---

## Post-deploy smoke probes

All three should pass. Run them in order.

### 1. Health

```bash
curl -H "Authorization: Bearer $FRANK_API_KEY" https://<deployment>/api/health
# Expected: {"status":"ok","version":"3"}
```

Failure → `FRANK_API_KEY` isn't set or doesn't match what you're sending.

### 2. Round-trip a share

```bash
SHARE=$(curl -s -X POST https://<deployment>/api/share \
  -H "Authorization: Bearer $FRANK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"snapshot":{"html":"<p>deploy-probe</p>"},"contentType":"url"}' \
  | jq -r .shareId)
echo "shareId: $SHARE"
curl -s https://<deployment>/api/share?id=$SHARE | jq .
# Expected: {snapshot, comments, coverNote, metadata: {createdAt, expiresAt, viewCount, contentType}}
```

Failure → check `BLOB_READ_WRITE_TOKEN` is set + store is linked to this project.

### 3. Open a live-share stream

```bash
curl -N https://<deployment>/api/share/$SHARE/stream
# Expected: SSE frames + ~8s keep-alives. Ctrl+C to close.
```

Failure → check the Redis env vars (`KV_REST_API_*` or `UPSTASH_REDIS_REST_*`).

### Preferred: the integration harness

For a programmatic check covering all three (plus the revoke contract + comment round-trip):

```bash
cd daemon
FRANK_CLOUD_BASE_URL=https://<deployment> \
  FRANK_CLOUD_API_KEY=$FRANK_API_KEY \
  npm test -- cloud-integration
# Expected: 9 passed (9)
```

See [INTEGRATION_TESTING.md](INTEGRATION_TESTING.md) for details.

---

## Vercel UI gotchas

These cost us hours during the v3.0 smoke test; writing them down so future-you doesn't re-discover them.

### Deployment Protection must be disabled

Vercel projects default to "Deployment Protection" enabled, which gates preview URLs (and in some plans production too) behind Vercel SSO. Frank's share URLs are **public by design** — anonymous reviewers need to open them without signing into anything. Protection gates break that flow and also block automated smoke tests.

Before any deploy (preview or production):

**Vercel dashboard → your `frank-cloud` project → Settings → Deployment Protection → Disabled.**

Not "Only Production Deployments" — that still gates previews, which means the integration harness and smoke tests can't reach preview URLs. Full disable is correct; Frank's threat model is the same for previews and production.

### `vercel dev` does not enforce Edge-runtime module restrictions

A handler with `runtime: 'edge'` that imports Node-only packages (e.g. `@vercel/blob` → `undici` → `node:stream`) will run fine under `vercel dev` locally but fail at **production build** with errors like:

```
The Edge Function "api/comment" is referencing unsupported modules:
  - undici: stream, net, http, tls, ...
```

Always verify Edge-runtime handlers with a real preview deployment — local `vercel dev` is not a substitute.

### Vercel's pure-API Node runtime requires classic `(req, res)` signatures

This is the most important and least-documented Vercel constraint. Running an otherwise-correct Fetch-API handler on Node runtime gives you this at runtime, regardless of TypeScript types or `"type": "module"` in package.json:

```
TypeError: req.headers.get is not a function
```

On pure-API Vercel projects (i.e., not Next.js App Router), **`runtime: 'nodejs'` always receives an `IncomingMessage`-style `req`**, not a Fetch `Request`. There's no opt-in. The only way to use Fetch-API handlers on Vercel is the Edge runtime — but Edge cannot use `@vercel/blob` (previous gotcha). Therefore: **handlers that touch `@vercel/blob` must use classic Node signatures**:

```ts
import { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { runtime: 'nodejs' };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = req.headers['authorization']?.replace('Bearer ', '');
  const body = req.body;  // auto-parsed from JSON
  // ... side effects on res ...
  res.status(200).json({ ok: true });
}
```

NOT `handler(req: Request): Promise<Response>` with `req.headers.get(...)` and `return Response.json(...)`. That compiles but fails at runtime.

Edge runtime (for handlers that don't touch `@vercel/blob`) keeps the Fetch-API pattern.

### Blob store "connected" vs "linked"

When you **create** a Blob store from Vercel Storage, Vercel shows it in the store list — but it's not automatically linked to any project. "Creating" and "linking" are two steps. Linking is what propagates `BLOB_READ_WRITE_TOKEN` into the project env.

Verify with:

```bash
cd frank-cloud && npx vercel blob list-stores --all
# The `Projects` column must include your project name.
```

If Projects shows `–`, open the store in the dashboard and connect it to your project.

### `vercel env pull` overwrites `.env.local`

Any manually-added lines (aliases, local overrides) get wiped when you re-pull. If you need a local override, set it via shell env before `vercel dev`:

```bash
cd frank-cloud
set -a && source .env.local && set +a
export FRANK_DEBUG_LOCAL=1  # shell env stays even if you re-pull
npx vercel dev --yes
```

### `vercel dev` env loading is CLI-version-dependent

Some CLI versions auto-source `.env.local`, some don't. Belt-and-suspenders:

```bash
cd frank-cloud
set -a && source .env.local && set +a
npx vercel dev --yes
```

This makes the env vars visible to both `vercel dev`'s process AND any child processes it spawns.

### `KV_REST_API_*` vs `UPSTASH_REDIS_REST_*`

The Upstash Marketplace integration sets `KV_REST_API_*` (legacy Vercel-KV naming, kept for back-compat). Direct-from-Upstash setups use `UPSTASH_REDIS_REST_*`. This codebase reads either — you don't need to alias.

If you have both set (e.g. during a migration): `KV_REST_API_*` wins.

### Edge runtime function "still running" warnings

`vercel dev` may log:

```
The function `share-stream.ts` is still running after 30s.
(hint: do you have a long-running waitUntil() promise?)
```

This is benign for SSE endpoints — they're *supposed* to hold the connection open. Ignore unless you see actual errors.

---

## CORS

CORS headers are applied globally via `vercel.json`:

```json
"headers": [
  { "source": "/api/(.*)", "headers": [
    { "key": "Access-Control-Allow-Origin", "value": "*" },
    { "key": "Access-Control-Allow-Methods", "value": "GET, POST, DELETE, OPTIONS" },
    { "key": "Access-Control-Allow-Headers", "value": "Content-Type, Authorization" }
  ]}
]
```

If you self-host on anything other than Vercel (Cloudflare Workers, Deno Deploy, self-hosted Node), you'll need to replicate this header config in the new host's equivalent.

---

## Capacity sizing

v3.0 uses these Upstash Redis keys per active share:

- `share:<id>:revision` — INCR counter
- `share:<id>:diffs` — list, bounded by `FRANK_EVENT_LIST_MAX`
- `share:<id>:events` — pubsub-like list, same bound
- `share:<id>:eventCounter` — INCR
- `share:<id>:sessions` — sorted set
- `share:<id>:authorOfflineAt` — scalar
- `share:<id>:author` — scalar

~7 keys per active share. Upstash Hobby caps you at 10,000 keys total, so you can have ~1,400 active shares before hitting the cap. For a typical single-user Frank deployment this is ample; if you're running a team deployment with hundreds of simultaneous authors, plan on the Pay-as-you-go tier.

---

## Observability

Default Vercel logging is the v3.0 floor — view logs via the Vercel dashboard (Deployments → pick one → Logs). No dedicated Sentry/Datadog hook is wired in; that's a v3.x follow-up.

`/api/tick` runs every minute (Hobby floor) and sweeps stale `share:<id>:authorOfflineAt` deadlines, broadcasting `author-status: offline` to viewers. Worst-case author-offline detection latency is ~75 s (`FRANK_AUTHOR_GRACE_MS` default 15 s + 60 s cron interval).

---

## Security notes

- **Comment content** is stored verbatim and returned to the viewer for rendering. The viewer is responsible for escape; this codebase does not HTML-strip or sanitize. If you render comments anywhere outside the official Frank viewer, handle escape yourself.
- **Error messages** from `/api/share` and `/api/comment` may leak raw exception strings in 500 responses. Scrubbing is a v3.0.1 follow-up. Don't put secrets in env var *names* that could appear in error messages.
- **`CRON_SECRET`** — set it. Without it, `/api/tick` is publicly callable; a bot could trigger sweeps frequently but can't cause data loss.

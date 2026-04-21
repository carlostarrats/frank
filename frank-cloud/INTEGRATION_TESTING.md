# Cloud Integration Testing

This harness exercises the real cloud backend contract — the layer the Phase 1–5 unit tests mocked and that, unmocked, surfaced five categorical bugs during the v3.0 smoke test. It is the backstop for "daemon tests pass but the cloud is broken."

## What the harness does

Runs a Vitest suite (`daemon/src/cloud-integration.test.ts`) against a configurable backend URL:

- **Health endpoint** returns `{status: 'ok'}` with a valid API key.
- **Create + fetch static share** — POST `/api/share`, GET `/api/share?id=…`, assert snapshot round-trips.
- **View-count increment** — GET twice, both return 200. Regression guard for the `allowOverwrite` bug.
- **Comment round-trip** — POST `/api/comment`, GET share, confirm comment appears.
- **Live-share state event + SSE delivery** — POST `/api/share/<id>/state`, open SSE on `/api/share/<id>/stream`, read until a `state` event arrives or the per-test timeout fires.
- **Revoke → 410** — DELETE share, GET returns 410.

## What the harness does NOT test

- Daemon WebSocket behavior (covered by existing `daemon/src/*.test.ts`).
- UI interactions (covered manually by `docs/v3.0-smoke-test.md`).
- Konva serialization / canvas rendering.
- Long-running SSE behavior beyond receipt of one event.

The three layers compose:
1. `daemon/npm test` (unit + mock-cloud integration) — fast feedback on daemon logic.
2. Cloud integration harness (this) — verifies the real backend contract.
3. Manual browser smoke test — verifies UI-layer behavior.

All three must be green for a phase to claim "complete" against the rule in the repo-level `CLAUDE.md`.

## Running locally against `vercel dev`

```bash
# Terminal 1: bring up the cloud
cd frank-cloud
set -a && source .env.local && set +a
npx vercel dev --yes

# Terminal 2: run the harness
cd daemon
FRANK_CLOUD_BASE_URL=http://localhost:3000 \
  FRANK_CLOUD_API_KEY=$(grep '^FRANK_API_KEY=' ../frank-cloud/.env.local | cut -d= -f2-) \
  npm test -- cloud-integration
```

Expected: all tests pass. Any failure points at a contract break between daemon expectations and cloud behavior.

## Running against a Vercel preview

```bash
# Deploy a preview
cd frank-cloud
npx vercel --yes
# Note the preview URL printed at the end.

cd ../daemon
FRANK_CLOUD_BASE_URL=https://<preview-url> \
  FRANK_CLOUD_API_KEY=<FRANK_API_KEY used at deploy time> \
  npm test -- cloud-integration
```

This is the real gate for Phase 6 Task 6. A green result here + the manual smoke test in `docs/v3.0-smoke-test.md` is the v3.0 ship-ready signal.

## Opt-in semantics

The harness is opt-in via `FRANK_CLOUD_BASE_URL`. When the variable is unset, Vitest skips the entire suite — so a normal `npm test` run stays fast and offline-capable. CI configurations that exercise the harness set `FRANK_CLOUD_BASE_URL` + `FRANK_CLOUD_API_KEY` at the job level.

## SSE test caveat

The SSE test reads events until a `state` event arrives or a 15-second abort fires. It does NOT assert on the first chunk received — keep-alive comments, connection-setup framing, and any other non-`state` events are tolerated. This is a deliberate defense against the ways edge-runtime SSE can legitimately differ between environments.

If the SSE test flakes:
- Check that `state` events are actually being published (daemon-side `FRANK_DEBUG_LIVE_SHARE=1` shows the `→ state` / `→ diff` log lines).
- Check that the backend's keep-alive cadence isn't starving real events.
- Increase the per-test timeout as a last resort; most flakes are keep-alive latency, not real breakage.

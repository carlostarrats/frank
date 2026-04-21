# v3 Phase 6 — Cloud Handler Audit

**Purpose:** Findings document for Phase 6 Task 3. Read-only. Categorized concerns drive Phase 6 Task 4 (blocker fixes) and Task 5 (deployment-guide entries).

**Context:** The v3.0 smoke test surfaced five categorical cloud bugs — edge-runtime misconfig, a WebCrypto swap, missing `allowOverwrite` on overwritten blobs, relative asset paths in the share payload, and `KV_REST_*` vs `UPSTASH_REDIS_REST_*` env-name drift. Those five are fixed in commits `0294a68`, `0f2df0d`, `9cdbaf3`, and `150591f`. This audit reads the eight handlers and six lib modules under `frank-cloud/` to catalogue what the smoke test / integration harness cannot reach, so v3.0 tags with known-good cloud code.

---

## Handlers

### api/health.ts

- **Contract** — `GET/OPTIONS /api/health`. Auth: `Authorization: Bearer <FRANK_API_KEY>` required. Request shape: none. Response: `{ status: 'ok', version: '2' }` on success; `{ status: 'error', message }` with 500/401 on missing env / bad key.
- **Runtime** — `edge` (line 1, confirmed post `0294a68`).
- **External deps** — none. No Redis, no Blob, no fetch.
- **Mutability** — none. Pure read.
- **Failure modes** — `FRANK_API_KEY` unset → 500 with explicit message. Bad/missing key → 401. No other failure paths; the handler does no I/O.
- **Known gaps** — the CORS preflight returns 204 with no CORS headers on the response itself — the headers are applied globally via `vercel.json`, which is correct for Vercel deploys but would break for self-hosters who serve this code on another platform. Otherwise this handler is as simple as it looks. Note the reported `version: '2'` is stale — v3.0 ships and the string still reads `'2'`, harmless but misleading in the field.

### api/share.ts — GET /api/share?id=…

- **Contract** — `GET /api/share?id=<shareId>`. Public (reviewers). Validates `^[a-zA-Z0-9_-]{8,20}$` on id. Response: `{ snapshot, comments[], coverNote, metadata }` on 200; `{ error }` on 400/404/410/500.
- **Runtime** — `edge` (file-level config, shared by all three verbs).
- **External deps** — `@vercel/blob`: `list` by prefix, `fetch` on returned blob URLs, `put` for meta re-write. No Redis.
- **Mutability** — re-writes `shares/<id>/meta.json` on **every GET** to increment `viewCount` and stamp `lastViewedAt` (has `allowOverwrite: true`). Snapshot + comments are read-only here.
- **Failure modes** — missing meta → 404; expired (`expiresAt < now`) → 410 with "updated" message; any thrown error → 500 with `e.message` leaked. Corrupt comment blobs are silently skipped (`catch {}`).
- **Known gaps** — the per-GET meta re-write is a concurrency hazard: two concurrent GETs race on `viewCount` and one increment is lost (read-modify-write, no CAS). It also doubles blob billing on read-heavy shares. The `meta.revoked === true` check is *absent* from GET — GET only checks expiry. That's one of the two reasons the revoked-returns-410 harness test fails (the other, noted below, is DELETE destroying meta.json). Error messages leak raw exception strings to unauthenticated callers.

### api/share.ts — POST /api/share

- **Contract** — `POST /api/share`. Auth: Bearer `FRANK_API_KEY`. Body: `{ snapshot, coverNote?, contentType?, expiryDays?, oldShareId?, oldRevokeToken? }`. Response: `{ shareId, revokeToken, url: '/s/<id>' }`.
- **Runtime** — `edge`.
- **External deps** — `@vercel/blob`: `put` for meta + snapshot, `list` + `put` for optional old-share revoke path.
- **Mutability** — writes `shares/<id>/meta.json` + `shares/<id>/snapshot.json` (both `allowOverwrite: true`, safe even though the id is freshly generated because `generateId` could theoretically collide — see gap). If `oldShareId`+`oldRevokeToken` supplied, re-writes the old meta with `expiresAt` set to epoch zero.
- **Failure modes** — missing snapshot → 400; missing/bad key → 401; thrown error → 500 with `e.message`. The old-share revoke is wrapped in `try/catch {}` so a failure is silent — user sees success with a still-live old share.
- **Known gaps** — `generateId()` produces a 12-char base64url token from 9 random bytes (~72 bits). Collision probability is negligible but not checked; `allowOverwrite: true` means a collision would silently overwrite a live share. The old-share "soft revoke" here only flips `expiresAt`, not the `revoked` flag, so the distinct 410-revoked vs 410-expired message the rest of the codebase expects collapses into the expired path. `expiryDays` is not validated — a caller can pass `expiryDays: 999999` and get a share that never expires.

### api/share.ts — DELETE /api/share?id=…

- **Contract** — `DELETE /api/share?id=<shareId>`. Auth: Bearer key **plus** `x-frank-revoke-token: <token>` header. Response: `{ ok: true }` or error.
- **Runtime** — `edge`.
- **External deps** — `@vercel/blob`: `list`, `put`, `del`. `pubsub.publish`, `pubsub.deleteChannel`, `revisions.deleteRevision`, `diff-buffer.deleteBuffer` (dynamic imports).
- **Mutability** — step 1 flips `meta.revoked = true` + expires immediately (overwrite). Step 2 publishes `share-ended`, sleeps 500 ms, calls `deleteChannel`. Step 3 deletes Redis revision counter + diff buffer. Step 4 **deletes every blob in the `shares/<id>/` prefix**, including `meta.json` itself.
- **Failure modes** — 404 if meta missing; 403 on revoke-token mismatch. Blob prefix-delete is wrapped in `try/catch {}` — a partial failure leaves orphaned blobs with no reconciliation. The 500 ms `setTimeout` before `deleteChannel` is a best-effort flush with no confirmation.
- **Known gaps** — **pre-known blocker (already covered by harness):** step 4 deletes `meta.json`, so subsequent GETs find no meta and return **404**, never reaching the `meta.revoked === true` branch. The integration harness's revoked-returns-410 test currently fails for this reason. The `setTimeout(r, 500)` is edge-runtime-flaky: edge functions are free to freeze the event loop on return, but here we `await`, so it nominally works — still fragile. No idempotency: calling DELETE twice on a revoked share returns 404 on the second call, which the daemon may misinterpret.

### api/comment.ts

- **Contract** — `POST /api/comment`. Public (reviewers post comments). Body: `{ shareId, screenId?, anchor?, author, text }`. Response: `{ comment }` or `{ error }`. No auth — share id + rate limit are the gate.
- **Runtime** — `edge`.
- **External deps** — `@vercel/blob`: `list` (meta verify + comment count), `put` (comment blob). `pubsub.publish` (dynamic import).
- **Mutability** — writes `shares/<id>/comments/<commentId>.json` with `allowOverwrite: true`. `commentId = 'c-' + Date.now() + '-' + randomHex(3)` — 24-bit random suffix; collisions under burst are possible but `allowOverwrite: true` makes them silent data loss.
- **Failure modes** — validation errors → 400; missing share → 404; expired → 410; ≥100 comments → 429; broadcast failure is swallowed (`catch {}`); thrown error → 500 with `e.message`.
- **Known gaps** — no `meta.revoked === true` check (same gap as GET) — a revoked-but-not-expired share still accepts comments until the DELETE path zeros `expiresAt`. The `existingComments.blobs.length >= 100` cap is racy: two parallel POSTs at count=99 both see 99 and both pass, yielding 101 stored comments. No sensitive-content scan, no HTML/script stripping — text is stored verbatim and returned to the viewer which renders it (viewer is responsible for escaping, but that's an assumption). No author-rate-limit at the comment level beyond the global IP check in share-stream — a reviewer can spam 100 comments from one SSE connection.

### api/share-state.ts

- **Contract** — `POST /api/share/<id>/state` (rewritten from `/api/share-state` via `vercel.json`). Auth: Bearer `FRANK_API_KEY` (daemon-only). Body: `{ revision: number, type: 'state' | 'diff', payload }`. Response: `{ acceptedRevision }` or `{ error }`.
- **Runtime** — `edge`.
- **External deps** — `@vercel/blob` (list meta, optionally put snapshot); `revisions.peekRevision`, `revisions.nextRevision`; `diff-buffer.appendDiff`; `pubsub.publish`.
- **Mutability** — on `type: 'state'`, re-writes `shares/<id>/snapshot.json` (`allowOverwrite: true`). Always appends to the Redis diff buffer and publishes. Revision counter monotonically increments in Redis.
- **Failure modes** — meta missing → 404; `meta.revoked === true` → 410; expired → 410; bad JSON → 400; bad type/revision → 400; payload > `FRANK_STATE_MAX_BYTES` (default 1 MB) → 413; `clientRevision <= current` → 409 with `currentRevision`. Redis outages (peek/next/appendDiff/publish) are **not caught** — they bubble as 500 with raw `e.message`.
- **Known gaps** — the `peekRevision`/`nextRevision` pair is not atomic: between the peek (line 63) and the INCR (line 68), another concurrent POST can slip in and claim the assigned id. The "backend revision wins" semantic is documented but the check can fire spuriously under concurrent daemon writes. Snapshot `put` happens **before** `appendDiff` + `publish`, matching the documented order, but if `appendDiff` fails after `put`, the snapshot has the new revision while the buffer doesn't — later reconnectors with `lastEventId=N-1` will get `buffer-miss` and fall back to the full snapshot, which is the right behavior only by accident. No size validation on `payload` shape itself, only the JSON-encoded length.

### api/share-stream.ts

- **Contract** — `GET /api/share/<id>/stream` (SSE). No bearer auth — public reviewer endpoint. Honors `Last-Event-Id` header for resume. Response: `text/event-stream`.
- **Runtime** — `edge` — correct for long-lived SSE.
- **External deps** — `@vercel/blob` (list + fetch for meta + snapshot); Redis directly (via `redisClient()` for `authorOfflineAt` sweep); `pubsub.tail`, `pubsub.publish`; `diff-buffer.diffsSince`; `revisions.peekRevision`; `session.*`; `limits.allowConnectFromIp`, `limits.VIEWER_CAP`.
- **Mutability** — writes session token (cookie), touches session zset (`share:<id>:sessions`, TTL-bounded), on abort removes session + broadcasts presence. On `authorOfflineAt` sweep wins, DELs the deadline key and `share:<id>:author`, then publishes `author-status: offline`.
- **Failure modes** — rate-limit → 429 plain text; viewer-cap → 429 JSON; meta missing → 404; revoked → 410; expired → 410. Any thrown error inside the stream loop is **not caught** — it escapes and Vercel will 500 the already-open SSE connection (browser reconnects due to `retry: 1000`).
- **Known gaps** — `redis.keys('share:*:authorOfflineAt')` is used in `tick.ts`, not here, but the inline `maybeFireAuthorOffline` uses `redis.get` + `redis.del`, racing with tick.ts safely (only one DEL wins). The long-poll loop sleeps 500 ms inside `tail`; on a 10-second edge function hard cap this yields ~16 iterations before disconnect, which is fine — but on Hobby plan Vercel's 10s edge streaming limit is not enforced for SSE; on Pro it's 25s, etc. This handler blocks on `tail` for up to 8 s before writing keep-alive, so on a near-silent share a client can wait 8 s between packets. No backpressure: if the viewer's connection is slow, enqueued events pile up in the `ReadableStream`'s internal queue until the connection is torn down.

### api/share-author-stream.ts

- **Contract** — `GET /api/share/<id>/author-stream`. Auth: Bearer `FRANK_API_KEY` (daemon). SSE response carrying comment/presence/share-ended events filtered from the channel.
- **Runtime** — `edge`.
- **External deps** — Redis directly (author key read/write, del); `pubsub.tail`; `@vercel/blob` list/fetch (meta).
- **Mutability** — writes `share:<id>:author` (value `'online'`, `ex: 60`), deletes `share:<id>:authorOfflineAt` on connect, schedules new `authorOfflineAt` on abort (`ex: 300`). Publishes `author-status: online` on connect transition. TTL is refreshed inside the loop every ~8 s.
- **Failure modes** — bad key → 401; bad id → 400; missing meta → 404; revoked → 410; expired → 410. Redis errors inside the stream are uncaught (same concern as share-stream).
- **Known gaps** — the `markAuthorOnline` function reads `share:<id>:author` to decide whether to publish a state-transition broadcast, but between GET and SET another concurrent author-stream can slip in — duplicate "online" events may be published. Downstream consumers must be idempotent (they are, per the code in `frank-cloud/public/viewer/` which this audit does not cover). The abort handler schedules `authorOfflineAt = now + GRACE_MS` **without** clearing `share:<id>:author` — a reconnect inside the grace window correctly sees "already online" and skips the broadcast, but if the author's second tab connects, the first's abort still schedules an offline timer, and only the second tab's connect deletes `authorOfflineAt`. If the second tab disconnects before the grace elapses, the *first* tab's scheduled deadline is overwritten with a new future one — correct. But if the author disconnects entirely, there is a ~15 s window where the key `authorOfflineAt` points to a time in the past and no viewer is connected to sweep it: tick.ts (cron) is the backstop, running every 1 min. On Hobby plans Vercel cron minimum is 1 min so worst-case latency is ~75 s.

### api/share-ping.ts

- **Contract** — `POST /api/share/<id>/ping`. Public (reviewer heartbeat). Response: `{ ok: true, viewers }`. No bearer auth; relies on session cookie continuity.
- **Runtime** — `edge`.
- **External deps** — `session.readOrCreateSessionToken`, `session.touchSession`, `session.countViewers`; `pubsub.publish`.
- **Mutability** — sets session cookie on new sessions, updates zset score in `share:<id>:sessions`. If viewer count changes, publishes presence.
- **Failure modes** — bad id → 400. No 404 for missing share — a ping to a non-existent share creates a session row and returns `{ ok: true, viewers: 1 }` silently. Redis errors are uncaught.
- **Known gaps** — **no share-existence check and no meta.revoked/expiry check** — a reviewer can ping a revoked or expired share and the zset + counters keep ticking. Harmless but wasteful on Redis ops; also a minor DoS vector: a malicious client can inflate viewer counts on any valid-format share id. No rate-limit on ping (the global IP bucket only applies to `/api/share/<id>/stream`, not here). Consider this the weakest auth gate in the cloud surface.

### api/tick.ts

- **Contract** — cron-triggered, scheduled every minute via `vercel.json`. Optional `Bearer ${CRON_SECRET}` auth when the env var is set. Response: `{ ok: true, swept }`.
- **Runtime** — `edge`.
- **External deps** — Redis: `keys('share:*:authorOfflineAt')`, `get`, `del`. `pubsub.publish`.
- **Mutability** — deletes expired `authorOfflineAt` keys, deletes the matching `share:<id>:author` key, broadcasts `author-status: offline`.
- **Failure modes** — missing `CRON_SECRET` means the endpoint is publicly invokable (comment acknowledges this); anyone can force a sweep. Redis errors abort the sweep mid-loop (no per-key try/catch) and return 500.
- **Known gaps** — `redis.keys('share:*:authorOfflineAt')` on Upstash is **O(N)** across the entire keyspace and is flagged in production Redis playbooks as a footgun. The comment in the file acknowledges "`scan` is idiomatic; `keys` is ok at small scale." This will bite deployments with thousands of active shares. No pagination, no SCAN cursor. Cron frequency (1 min) is the minimum on Hobby; Pro plans allow faster but this code doesn't know. No protection against the cron running concurrently with itself (Vercel doesn't promise non-overlap on long runs, though 1-min cadence with a tiny handler makes overlap unlikely).

---

## Lib modules

### lib/redis.ts

- **Contract** — `redisClient(): Redis` factory. Reads `KV_REST_API_URL`/`KV_REST_API_TOKEN` first (Vercel Marketplace names), falls back to `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`. Throws on missing env with a message pointing to both schemes.
- **Runtime** — n/a (library), consumed by edge handlers.
- **External deps** — `@upstash/redis` package.
- **Mutability** — none. Pure factory.
- **Failure modes** — throws at module init time (because every consumer calls `redisClient()` at top-level), which means a misconfigured deployment crashes on *first request* rather than at deploy. This is the env-name-drift fix (`150591f`).
- **Known gaps** — the factory is called **once per module** (e.g. pubsub.ts, limits.ts, session.ts, revisions.ts all do `const redis = redisClient()` at top level). Each creates its own client. Upstash's REST-based client is stateless so this is cheap, but the repeated env-var reading at cold start is unnecessary. The error message is good but the throw happens inside the handler's first call, surfacing as a 500 with the raw stack — users see a crash-like experience rather than a graceful "cloud not configured" response. Consider documenting this in `DEPLOYMENT.md`.

### lib/pubsub.ts

- **Contract** — `publish(shareId, kind, data): Promise<number>`; `tail(shareId, lastId, timeoutMs?): Promise<ChannelEvent[]>`; `deleteChannel(shareId): Promise<void>`. Event `kind`s enumerated in `ChannelEvent`.
- **Runtime** — library.
- **External deps** — Redis: `incr` (counter), `rpush` (list), `ltrim` (cap), `expire` (TTL), `lrange` (tail), `del` (channel teardown).
- **Mutability** — `share:<id>:events` list, `share:<id>:eventCounter` counter. Both TTL'd to `EVENT_TTL_SEC = 120` on every publish. List is capped at `EVENT_LIST_MAX` (default 2000) via `LTRIM`.
- **Failure modes** — all operations propagate Redis errors to the caller. The long-poll `tail` sleeps 500 ms between polls, reading the whole list each iteration (LRANGE 0 -1).
- **Known gaps** — **TTL-on-every-publish means the events list + counter expire 2 min after the *last* publish**, not after creation. On a share with a brief burst and then silence, events older than 2 min disappear — fine for a 60 s buffer spec, worth documenting. More serious: `tail` does `LRANGE 0 -1` every 500 ms — on a share with many viewers each doing their own long-poll, that's N clients × 2/s × full-list reads = O(N × list-size) Redis ops per second. At the 2000-cap that's 4000 entry-reads/s/viewer. Upstash bills per-command, not per-entry, but bandwidth is still proportional. No SUBSCRIBE → this is by design per the header comment. The `publish` function does 4 Redis round-trips (INCR + RPUSH + LTRIM + 2×EXPIRE) — could be pipelined; currently each handler pays 4 RTTs per event.

### lib/revisions.ts

- **Contract** — `nextRevision(shareId): Promise<number>` (atomic INCR); `peekRevision(shareId): Promise<number>`; `deleteRevision(shareId): Promise<void>`.
- **Runtime** — library.
- **External deps** — Redis: `incr`, `get`, `del` on `share:<id>:revision`.
- **Mutability** — single integer key, no TTL set. This is the one key in the surface area that **persists forever** unless `deleteRevision` is called.
- **Failure modes** — straight passthrough of Redis errors. No retry, no fallback.
- **Known gaps** — **no TTL on the revision counter** means an orphaned share (DELETE failed partway, or share expired naturally without a DELETE call) leaves a `share:<id>:revision` key in Redis indefinitely. At Upstash Hobby's 10k key cap this is a slow leak; `tick.ts` does not sweep expired shares. The `peek`-then-`next` pattern used in `share-state.ts` is not atomic across the pair (see that section). `get<number>` relies on Upstash deserializing the string-stored integer — works, but fragile to client version upgrades.

### lib/diff-buffer.ts

- **Contract** — `appendDiff(shareId, entry): Promise<void>`; `diffsSince(shareId, sinceRevision): Promise<BufferedDiff[] | 'buffer-miss'>`; `deleteBuffer(shareId): Promise<void>`. Window: 60 s default, env-overridable.
- **Runtime** — library.
- **External deps** — Redis: `lrange`, `rpush`, `del`, `expire` on `share:<id>:diffs`. 1-hour TTL safety net.
- **Mutability** — `share:<id>:diffs` list. `prune` runs before every append and every read, rewriting the list if any entries were dropped.
- **Failure modes** — JSON parse failures silently drop corrupt entries (`catch {}`). `prune`'s non-atomic delete-then-rpush sequence is a race window: if two callers prune simultaneously, one may delete + rpush kept entries while the other adds new, and the second rpush lands against a fresh list missing the new entries.
- **Known gaps** — **`prune` reads the full list, decides the keeper set, `DEL`s the key, then `RPUSH`es back** (lines 36-39). This is not atomic — a concurrent `appendDiff` between the DEL and the RPUSH will lose its entry. At the event rates contemplated (diff-per-canvas-tick) this race is real. A Lua-scripted atomic prune or a ZSET-scored-by-ts would avoid it. Also: no cap on list length — `BUFFER_WINDOW_MS = 60_000` bounds it by time, but a chatty share (hundreds of diffs/s) can balloon memory. `diffsSince` returning `'buffer-miss'` vs the empty list distinction is correct but undocumented in the public-ish type.

### lib/session.ts

- **Contract** — `readOrCreateSessionToken(req): { token, setCookie }`; `touchSession(shareId, token): Promise<void>`; `removeSession(shareId, token): Promise<void>`; `countViewers(shareId): Promise<number>`.
- **Runtime** — library, used in edge handlers.
- **External deps** — WebCrypto (`crypto.getRandomValues`, post-`0f2df0d`); Redis: `zadd`, `expire`, `zrem`, `zremrangebyscore`, `zcard` on `share:<id>:sessions`.
- **Mutability** — zset per share. Each member is a session token, score is absolute expiry timestamp in ms. Key TTL is 4× `SESSION_TTL_SEC` (default 90 × 4 = 360 s) — auto-evicts when a share goes quiet.
- **Failure modes** — `countViewers` runs `zremrangebyscore` before `zcard`; both errors are uncaught. The cookie `Max-Age` is `SESSION_TTL_SEC * 10` (15 min at defaults) while the zset score is `SESSION_TTL_SEC * 1` (90 s). So a viewer with a valid cookie but no recent ping will not count as a viewer but can rejoin quickly.
- **Known gaps** — `zremrangebyscore(0, now)` uses milliseconds as the score range — correct because `touchSession` writes `Date.now() + ttl*1000` as score. The regex `^[a-zA-Z0-9_-]{16,64}$` is applied only when reading existing cookies/headers; freshly generated tokens are produced via `btoa` on 16 random bytes and stripped of padding, which yields a 22-char string — always valid by the regex. No abuse check: a malicious client can rotate cookies to inflate viewer counts, bounded only by the 10-viewer cap and the IP rate limit on `/stream` (ping has no IP check). Consider documenting.

### lib/limits.ts

- **Contract** — `VIEWER_CAP` constant (default 10, env-overridable); `allowConnectFromIp(ip): Promise<boolean>`.
- **Runtime** — library.
- **External deps** — Redis: `incr`, `expire` on `ip:<ip>:connect`.
- **Mutability** — per-IP counter, 60 s TTL. Fixed-window rate limit at `IP_BUCKET_MAX` (default 120/min).
- **Failure modes** — uncaught Redis errors bubble. The fixed-window approach permits 2× the intended rate across window boundaries (120 in last second of window N + 120 in first second of window N+1 = 240 in 2 s).
- **Known gaps** — only enforced in `share-stream.ts` — ping, comment POST, state POST are all un-limited per-IP. The limiter keys on raw IP; behind Vercel's edge, `x-forwarded-for` is trustworthy, but the code takes `.split(',')[0].trim()` which gets the *leftmost* (original-client) address — fine. No per-share or per-token rate limit, just per-IP. No allowlist for daemon IPs (not needed because daemon auth'd endpoints don't go through this). Consider a separate rate limit on `/api/comment` since that's the main abuse vector.

---

## Findings

### Blockers

- **DELETE destroys meta.json, so revoked shares return 404 not 410** — `api/share.ts` DELETE step 4 deletes every blob under `shares/<id>/`, including `meta.json`. The GET handler's 404 path fires before it can read `meta.revoked === true`. Coverage: **already covered by the integration harness test** (revoked-returns-410 failing). Fix complexity: **trivial** — skip `meta.json` during the prefix-delete loop, or change the GET handler to treat "no meta" as 410 when a tombstone marker is present.
- **GET /api/share does not check `meta.revoked`** — only expiry is checked (lines 35-40). Even if DELETE preserved meta.json, GET would still serve the snapshot+comments because the `meta.revoked === true` branch is simply absent. Coverage: **needs test**. Fix complexity: **trivial** — add `if (meta.revoked === true) return 410` above the expiry check.
- **POST /api/comment does not check `meta.revoked`** — a revoked share accepts comments until DELETE also zeros `expiresAt`. Since DELETE *does* zero expiry, this is masked today; will surface if the revoke flow ever changes. Coverage: **needs test**. Fix complexity: **trivial**.
- **POST /api/share-ping has no share-existence or revocation check** — a malicious or careless client can ping a non-existent share id and have Redis happily track sessions. Coverage: **needs test** (ping to nonexistent id should 404). Fix complexity: **trivial** — mirror the meta-fetch+revoke-check block from stream.

### Fragile

- **`tick.ts` uses `redis.keys('share:*:authorOfflineAt')`** — O(N) across entire Upstash keyspace. The file comment acknowledges this is "ok at small scale." Fix by switching to `SCAN` cursor iteration. File for Phase 6 Task 4 if cheap, otherwise v3.0.1 — safe at < 1k active shares.
- **`diff-buffer.ts prune` is not atomic (DEL + RPUSH race)** — concurrent `appendDiff` during a prune can lose entries. Real at high event rates. Fix: Lua script, or swap to a ZSET scored by `ts`. Phase 6 Task 4 if time.
- **`share-state.ts`: peek + next revision is not atomic** — two concurrent daemon POSTs can both pass the `clientRevision <= current` gate and both INCR. No data corruption, but the 409-on-behind contract can fire on the wrong client. Low-impact; the daemon today is single-source-of-truth so concurrent POSTs are unlikely. Defer to v3.0.1.
- **GET /api/share re-writes meta.json on every read** — race on `viewCount`, doubles blob billing, and is a load amplifier. Consider moving viewCount/lastViewedAt to Redis (incrementable atomically) or dropping them entirely. v3.0.1.
- **`share.ts` POST swallows old-share revocation failures silently** — a user updating a share believes the old one is revoked when it may still be live. Fix: surface a warning in the response body; harness test for it.
- **`commentId` uses 24 bits of randomness + ms timestamp + `allowOverwrite: true`** — collision under burst silently overwrites. Raise random suffix to 48+ bits or drop `allowOverwrite` on this path (comment blobs should never be overwritten legitimately).
- **`ai-panel.ts`-style `e.message` leaks in 500 responses** — `Response.json({ error: e.message }, { status: 500 })` exposes raw internal errors (Upstash URL fragments, stack messages) to unauthenticated callers on share.ts GET and comment.ts. Scrub in v3.0.1.
- **`revisions.ts` key has no TTL** — orphaned shares (DELETE never ran, or failed mid-way) leave the revision counter forever. Slow Redis-key leak. Add TTL on `nextRevision` + a sweep in `tick.ts`. v3.0.1.
- **`health.ts` reports `version: '2'` in v3.0** — cosmetic, trivial, noisy in ops dashboards. Fix in Task 4.
- **`pubsub.tail` LRANGEs the full list every 500 ms** — bandwidth scales with (viewers × list-size × 2/s). Fine at small scale; budget-surprise at scale. Document in DEPLOYMENT.

### Document-only

- **CORS headers are applied via `vercel.json`, not per-handler** — self-hosters on non-Vercel platforms will lose CORS unless they replicate the header config. Mention in DEPLOYMENT.md.
- **Upstash Hobby 10k-key limit vs Redis keyspace** — current design uses ~6 keys per active share (revision, events, eventCounter, diffs, sessions, authorOfflineAt, author). At 1500 active shares you hit the cap. Worth a "capacity sizing" note.
- **Vercel Cron minimum cadence is 1 min on Hobby** — worst-case author-offline detection latency is ~75 s (GRACE_MS + cron interval). Document as expected behavior.
- **`FRANK_*` env var reference** — `FRANK_API_KEY`, `FRANK_STATE_MAX_BYTES`, `FRANK_AUTHOR_GRACE_MS`, `FRANK_SESSION_TTL`, `FRANK_VIEWER_CAP`, `FRANK_IP_RATE_PER_MIN`, `FRANK_DIFF_BUFFER_MS`, `FRANK_EVENT_LIST_MAX`, `CRON_SECRET` — many are undocumented. DEPLOYMENT.md should table them.
- **`KV_REST_API_*` precedence over `UPSTASH_REDIS_REST_*`** — already fixed (150591f); must be called out in deployment docs so self-hosters don't set both and wonder which wins.
- **SSE `retry: 1000` means clients reconnect every 1 s on drop** — on a flapping connection this can spam the endpoint. Document the tuning knob (there is none today — it's hardcoded).
- **Comment content is stored verbatim; viewer is responsible for escape** — not a bug, but a deployment surface the operator should know about when auditing XSS risk.
- **`CRON_SECRET` is optional; if unset `/api/tick` is publicly callable** — harmless in effect (just triggers a sweep), but ops should know. Document as "set this in production."

### Architectural concerns (if any)

- **None rising to the "escalation" bar.** The design is internally consistent: Redis for hot state + pubsub + sessions, Blob for durable payloads, edge runtime for everything. The use of long-poll `tail` over true Redis SUBSCRIBE is documented and reasonable given Upstash's serverless constraints. The trade-off between "revoke flips a flag" vs "revoke deletes data" is currently confused (DELETE does both, and the order leaves the flag-check dead), but that's a bug, not a design flaw — flipping the flag is the canonical path. No architectural escalation needed. **Phase 6 scope-guard holds: stabilization, not reconstruction.**

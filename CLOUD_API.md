# Frank Cloud API — implementation spec

Frank's sharing feature is not tied to Vercel. `frank-cloud/` is a reference
implementation; you can host the same contract on Cloudflare Workers, Deno
Deploy, a bare Node server, or anywhere that can run a JSON-over-HTTPS API.

This document is the contract. If your backend honors these four endpoints
with the shapes described below, the Frank daemon and share viewer will work
against it unchanged.

## Overview

Two principals interact with your backend:

- **Daemon** — runs on the owner's machine. Authenticates with a bearer token
  over HTTPS. Creates, revokes, and health-checks shares.
- **Reviewer browser** — the person you shared a link with. Unauthenticated.
  Reads a share and posts comments.

The reviewer's browser loads `/s/:id` (whatever you serve for that route) and
that page calls `GET /api/share?id=:id` plus `POST /api/comment` at the same
origin. You own the viewer page — the reference copy lives in
`frank-cloud/public/viewer/`.

## Auth

Daemon-authenticated routes require:

```
Authorization: Bearer <FRANK_API_KEY>
```

You choose the value when you set up your backend. The daemon stores it in
`~/.frank/config.json` alongside the cloud URL.

All routes should send these CORS headers so the viewer and daemon can reach
the API:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

## Endpoints

### 1. `GET /api/health`

**Auth:** bearer. **Purpose:** the daemon calls this to confirm your backend
is reachable and the key is correct. Also used by the Settings "Test
connection" button in the UI.

**200 response**

```json
{ "status": "ok", "version": "2" }
```

**401 response** — missing or wrong `Authorization` header.
**500 response** — backend misconfigured (e.g., the server key isn't set).

### 2. `POST /api/share`

**Auth:** bearer. **Purpose:** create a new share. Optionally revoke a prior
share in the same call (used when re-sharing supersedes an old link).

**Request body**

```json
{
  "snapshot": { /* see "Snapshot payload" below; omit for URL-share auto-deploy */ },
  "deployment": {                        // v3.3+: URL-share auto-deploy
    "vercelId": "dpl_...",               // Vercel deployment id
    "vercelTeamId": "team_...",          // optional — only if the token is team-scoped
    "url": "frank-share-abc.vercel.app", // bare host (no scheme)
    "readyState": "READY"                // optional; diagnostic
  },
  "coverNote": "Optional reviewer-visible message",
  "contentType": "url" | "pdf" | "image" | "canvas" | "url-share",
  "expiryDays": 7,
  "oldShareId": "optional previous shareId to revoke",
  "oldRevokeToken": "optional matching token for oldShareId"
}
```

**At least one of `snapshot` or `deployment` is required.** `snapshot` is
used by static shares (canvas / image / PDF / URL-snapshot). `deployment`
is used by URL-share auto-deploy (v3.3+), where the share link points at a
live Vercel preview the daemon created on the user's own Vercel account.
Reject with `400 { error: "Missing snapshot or deployment" }` if neither
is present.

When `deployment` is set, `contentType` MUST be `"url-share"`.

**200 response**

```json
{
  "shareId": "8- to 20-char URL-safe id",
  "revokeToken": "opaque token the daemon stores to revoke later",
  "url": "/s/<shareId>"
}
```

The returned `url` is relative to your backend's origin; the daemon prepends
its configured cloud URL to display the full share link.

**Error responses** — `400` for malformed body, `401` for auth, `500` for
storage failure.

### 3. `GET /api/share?id=<shareId>`

**Auth:** none. **Purpose:** the viewer page reads a share by id.

**200 response**

```json
{
  "snapshot": { /* whatever the daemon uploaded, or null for URL-share */ },
  "deployment": {                        // v3.3+: present on URL-share records, else null
    "vercelId": "dpl_...",
    "vercelTeamId": "team_..." | null,
    "url": "frank-share-abc.vercel.app",
    "readyState": "READY"
  },
  "comments": [
    {
      "id": "c-...",
      "shareId": "...",
      "screenId": "default",
      "anchor": { /* type varies — see "Anchor types" */ },
      "author": "alice",
      "text": "Make this bigger",
      "ts": "2026-01-02T03:04:05.000Z"
    }
  ],
  "coverNote": "",
  "metadata": {
    "createdAt": "ISO",
    "expiresAt": "ISO",
    "viewCount": 12,
    "contentType": "url" | "pdf" | "image" | "canvas" | "url-share"
  }
}
```

Exactly one of `snapshot` or `deployment` will be set. Both present or both
null indicate a malformed record — the viewer page should show an error.

**404** if the id doesn't exist, **410** if the share has expired (set
`expiresAt` in the past to revoke without deleting), **400** if the id format
is invalid.

Your backend should also increment `viewCount` + update `lastViewedAt` on
each successful GET — the daemon uses this to surface "12 views" in the UI.

### 4. `POST /api/comment`

**Auth:** none (public reviewers). **Purpose:** reviewer leaves a comment on
a shared artifact.

**Request body**

```json
{
  "shareId": "...",
  "screenId": "default",
  "anchor": { /* see "Anchor types" */ },
  "author": "alice",
  "text": "up to 2000 chars"
}
```

**200 response**

```json
{
  "comment": {
    "id": "c-...",
    "shareId": "...",
    "screenId": "default",
    "anchor": { /* echoed */ },
    "author": "alice",
    "text": "...",
    "ts": "ISO"
  }
}
```

**Validation the reference implementation performs** (recommended):

- `shareId` matches `/^[a-zA-Z0-9_-]{8,20}$/`
- `text` non-empty and ≤ 2000 chars
- `author` non-empty and ≤ 100 chars
- Share exists and isn't expired (410 otherwise)
- Reject past 100 comments per share (429) to bound abuse

## Anchor types

The `anchor` object on comments varies by content type:

- **Element** (URL / PDF / image projects)
  ```json
  { "type": "element", "cssSelector": ".btn", "domPath": "body > ... > button:nth-child(3)", "x": 42.1, "y": 18.7 }
  ```
  `x` and `y` are percentages of the iframe viewport at creation time.

- **Pin** (free click in URL/PDF/image, or any click on a PDF page)
  ```json
  { "type": "pin", "x": 42.1, "y": 18.7, "pageNumber": 3 }
  ```
  `pageNumber` is only present for PDF projects.

- **Shape** (canvas projects)
  ```json
  { "type": "shape", "shapeId": "shape-abc123", "x": 320, "y": 180, "shapeLastKnown": { "x": 320, "y": 180 } }
  ```
  Coordinates are world coordinates on the Konva canvas (not percentages).

Your backend stores and echoes the anchor unchanged — it doesn't interpret
the contents. The daemon and the viewer page handle the math.

## Snapshot payload

`snapshot` is opaque JSON the daemon uploads and the viewer page renders.
Shape varies by project type:

- **URL / PDF / image** — `{ "html": "<serialized DOM>", "screenshot": "<optional data URL>" }`
- **Canvas** — `{ "canvasState": "<serialized Konva JSON>", "assets": { "<url>": "<data URL>" }, "preview": "<thumbnail data URL>" }`

Your backend should not parse, transform, or inline-embed these. Store the
JSON as-is and return it unchanged on `GET /api/share`.

## Storage expectations

The reference implementation uses Vercel Blob with four objects per share:

```
shares/<shareId>/meta.json          # revokeToken, createdAt, expiresAt, viewCount, coverNote, contentType, deployment?, auditLog?
shares/<shareId>/snapshot.json      # snapshot payload — absent for url-share records
shares/<shareId>/comments/<commentId>.json
```

`meta.json` fields added in v3.3+:

- **`deployment`** — set on URL-share records; `null` (or absent) on snapshot shares. Same shape as the `deployment` field in the `GET /api/share` response.
- **`auditLog: Event[]`** — optional append-only list of lifecycle events. Each event is `{ at: ISO, kind: "created" | "revoke-requested" | "cloud-flag-flipped" | "vercel-delete-succeeded" | "vercel-delete-failed", detail?: string }`. The daemon doesn't read this — it exists so an operator debugging a broken revoke can see the history without a log-scrape. Implementations that don't want to support audit can omit the field; the daemon handles missing `auditLog` as equivalent to `[]`.

Any key-value or object store with read + write is enough — S3, R2,
Cloudflare KV, Postgres, etc. The contract doesn't care how you persist it.

## The viewer page

The reference viewer at `frank-cloud/public/viewer/index.html` is the other
half: a static page that calls `GET /api/share?id=...` and `POST
/api/comment`. You can use the reference copy as-is on any host that can
serve static HTML, or write your own. As long as it reads and writes the
shapes above, Frank's experience is complete.

## Versioning

`/api/health` returns `{ "version": "2" }` today. When the contract breaks
we'll bump it. Backends should return the version they implement; the daemon
will display a mismatch warning in the Settings modal if your backend
advertises a different major version.

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

Response: `{ acceptedRevision: number }` (HTTP 200) on success, or `{ error: "revision-behind", currentRevision: number }` (HTTP 409) if `revision` is lower than what the backend already stored. The daemon fast-forwards its local counter in that case.

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
3. Tag `state` and `diff` events with the revision as both the JSON `revision` field and the SSE `id:` line. Revision numbers must be monotonically increasing per share.
4. Support `Last-Event-ID`-based resume — replay from buffer when within window, send full `state` otherwise.
5. Maintain presence: the number of open viewer-stream connections per share, deduplicated by `X-Frank-Session` / `frank_session` cookie. Author streams do not count.
6. Enforce a per-share viewer cap (host-configurable default — the contract does not prescribe a number, since it depends on the host's cost model). On cap hit, respond 429 with `{ error: "viewer-cap" }`.
7. Enforce idle-viewer timeout (default 30min, configurable). Idle = no comment POST + no heartbeat ping (see below) for the whole window.
8. Viewer clients SHOULD emit a heartbeat `POST /api/share/:id/ping` (body empty) every 60s while the tab is foregrounded. Hosts that implement `ping` SHOULD return HTTP 200 with body `{ ok: true, viewers: number }` (the body is advisory — viewers already receive `presence` events). Hosts that do not implement `ping` can rely on TCP-level idle detection instead.
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

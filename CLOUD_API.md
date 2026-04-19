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
  "snapshot": { /* see "Snapshot payload" below */ },
  "coverNote": "Optional reviewer-visible message",
  "contentType": "url" | "pdf" | "image" | "canvas",
  "expiryDays": 7,
  "oldShareId": "optional previous shareId to revoke",
  "oldRevokeToken": "optional matching token for oldShareId"
}
```

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
  "snapshot": { /* whatever the daemon uploaded */ },
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
    "contentType": "url"
  }
}
```

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
shares/<shareId>/meta.json          # revokeToken, createdAt, expiresAt, viewCount, coverNote, contentType
shares/<shareId>/snapshot.json      # snapshot payload
shares/<shareId>/comments/<commentId>.json
```

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

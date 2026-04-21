# Frank v3 — Direction

This document captures the design intent and architectural decisions for Frank v3. It is a direction doc, not a build plan — the mechanics are settled but the tasking is not.

---

## The Core Idea

v3's core addition is **live share**: share links that show the author's work in real time, applied uniformly across every project type Frank supports.

In v2, share links are static. A link captures state at the moment of sharing. Reviewers see that frozen state. Comments sync back asynchronously.

In v3, every share link shows the author's current state in real time.

### The behavior

- When a reviewer opens a share link, they see whatever the author is currently working on.
- If the author makes changes, the reviewer's view updates in near real time.
- If the author is not actively working, the reviewer sees the current state as a static page.
- Comments posted by reviewers appear in real time to the author and to other reviewers viewing the same link.

There is no mode picker. No "share as static" toggle. No distinction between live and frozen links. One share behavior, applied uniformly across all project types.

### Mental model

- **For the author:** "I hit share. The person I sent it to sees what I'm looking at."
- **For the reviewer:** "I opened a Frank link. What I see is what they're working on."

---

## Applies to Every Project Type

The design applies to all four project types. The difficulty of implementation varies significantly across them.

### Canvas shares — straightforward

The canvas is already a serializable data structure (Konva JSON). The daemon streams state diffs to the backend, the backend broadcasts to viewers, viewers apply diffs. This is the cleanest case and ships in v3.0.

### Image shares — trivial

Images barely change. The only "live" element is annotations and comments appearing. Ships in v3.0.

### PDF shares — medium (split into 4a + 4b)

**v3.0 (Phase 4a): annotations only.** Comments sync live between author and viewers — add, delete, and curate actions all stream in near real time. The PDF file itself is delivered at share time and doesn't stream. This is the subset buildable on Frank's current PDF rendering stack (browser-native iframe embedding).

**v3.x (Phase 4b, post-v3.0 / pre-v3.1): page + scroll sync after PDF.js migration.** The original direction for this section assumed Frank controlled the PDF render pipeline. It doesn't — PDFs currently render in each browser's native viewer, which doesn't expose page or scroll events to the embedding page. Adding page/scroll sync requires replacing the iframe-native-viewer path with a PDF.js render, which is a meaningful rendering-infrastructure improvement on its own (consistent cross-browser rendering, programmable scrolling, better pin anchoring). Phase 4b is framed as that migration; page/scroll live sync becomes a natural follow-on once Frank controls the render.

### URL shares — a different problem, deferred to v3.1

URL live-share is harder than the other three combined. Making Frank's URL viewer "live" requires either periodic re-snapshotting, streamed DOM mutations across cross-origin iframes, or a cloud-side shared proxy with streamed scroll and navigation events. Frank's current proxy lives in the daemon — reviewers cannot reach it. The architecture has to change for URL specifically.

URL live-share gets its own sub-spec as v3.1. v3.0 ships without it — URL shares continue to work as they do in v2 (static) until v3.1 is built.

Worth naming now so v3.1 scoping isn't surprised by it: URL live-share will require **server-visible rendering context** (either a cloud-side proxy or some equivalent), not just daemon-side rendering. That's a new architectural class compared to the canvas/image/PDF cases, where the daemon is the sole renderer. v3.1 will need to reconcile this shift with Frank's "daemon as source of truth" principle.

---

## Architecture

### Transport: SSE on the existing backend

Live share uses **Server-Sent Events (SSE)** over the existing user-hosted backend. This is the key decision that keeps v3 architecturally continuous with v2 — no new platform, no WebSocket rewrite, no different reference implementation.

**Data flow:**

- The author's daemon opens a single long-lived SSE connection to the backend per active share (`GET /api/share/:id/author-stream`). This is how the daemon receives comments and presence events, and it is how the backend detects when the author is online or offline.
- The daemon pushes state updates to the backend via `POST /api/share/:id/state`. These are regular HTTPS POSTs — not streaming. Each POST carries one state update (full or diff) and its revision number.
- The backend stores the latest snapshot, appends the update to the rolling diff buffer, and broadcasts the change to all open viewer streams.
- Viewers open an SSE connection to `GET /api/share/:id/stream`. The first event delivers current state; subsequent events carry diffs, comments, presence updates, and author status.
- Reviewers post comments via `POST /api/comment` (unchanged from v2). The backend broadcasts them down every open stream — viewer streams and the author's author-stream alike.

This is pub/sub with one publisher (the author's daemon) and multiple subscribers (viewers, plus the author's own stream for comment/presence delivery). One-way data flow: author → cloud → viewers. No conflict resolution, no CRDT, no merge logic. The author's local Frank instance remains the source of truth. The cloud is a relay.

**Author online/offline detection.** The backend treats the author as online while the author-stream connection is open, offline when it closes. Brief drops (the same short-function-timeout reconnect pattern that affects viewers) do not flip status immediately — the backend waits ~15 seconds after a drop before broadcasting `author-status: offline` to give the daemon time to reconnect. This matches user intuition: "author is online" shouldn't flicker every time Vercel recycles a function.

**Daemon reconnect and revision continuity.** Revision numbers are per-share and persisted by the daemon across restarts. When the daemon restarts and re-opens its author-stream, it resumes from the revision it left off at. If the daemon's persisted revision is somehow behind the backend's (unlikely but possible), the backend's revision wins and the daemon fast-forwards. If the daemon's revision is ahead (more likely: daemon made edits while offline), those updates POST with their existing revisions and the backend accepts them as the new canonical state.

### State revisions

Every state update carries a monotonic revision number. The daemon increments the revision on each update. The backend stores the latest revision with the snapshot and tags every broadcast event with it.

Viewers track the revision they've applied. If a viewer detects a gap (expected revision 1043, received 1045), it requests a full state resync immediately rather than trying to reconstruct missing diffs. If the backend's stored snapshot revision is older than the latest broadcast revision, it refreshes from the daemon.

Revisions make the snapshot-plus-stream model correct by construction. Without them, drift between snapshot and stream could accumulate silently. With them, any inconsistency is detected the moment it matters and self-heals.

### What the backend stores

The backend stores three things per active share:

- **The latest state snapshot** — canonical current state, used for cold opens.
- **A small rolling buffer of recent diffs** — roughly the last 60 seconds of updates, used to let viewers resume after brief disconnects without a full resync. This buffer is bounded by time, not size — older diffs drop off as new ones arrive. The buffer size is configurable by the host.
- **The current revision number** — updated with each state change.

Note the nuance: Frank is not event-sourced. The snapshot is canonical; the rolling buffer is a recent-history cache to make reconnect cheap. If the buffer is lost (function restart, cache eviction), nothing breaks — viewers just resync to the snapshot on their next gap.

### Frank carries state, not history

Beyond the 60-second rolling buffer, Frank does not retain update history. The daemon drops intermediate states when it is ahead of the network. Viewers who disconnect for more than a minute resync to current state rather than replaying what they missed. This matches the product: reviewers care about what the author is working on now, not what the author did three minutes ago.

### Why SSE and not WebSockets

- Vercel Serverless, the current reference implementation, supports SSE. It does not support WebSockets.
- Live share is one-way from author to viewer (updates) plus one-way from viewer to author (comments). Bidirectional streaming is not required — SSE handles the "down" direction, existing HTTPS POST handles the "up" direction.
- Browsers handle SSE reconnection automatically. The viewer does not need custom reconnect logic.
- SSE keeps the `CLOUD_API.md` contract continuous with v2 — one new endpoint, not a rewritten protocol.

### Quality varies by host, honestly

SSE on serverless functions with short execution limits (Vercel Hobby, Netlify Free) works but requires frequent reconnection. On longer-running environments (Vercel Pro with Fluid Compute, Cloudflare Workers, Deno Deploy, always-on Node servers) SSE connections stay open for much longer and the experience is smoother.

This means a user on Vercel Hobby will see occasional stutters during very active sessions. A user on Vercel Pro or a community-contributed Cloudflare Workers port will see a smooth experience. This is acceptable — "tried it out on free tier, upgrade for smooth experience" is a reasonable product story, and the technical truth is captured in the "Use your own" tab's documentation.

### Reference implementation stays Vercel

The `frank-cloud/` reference implementation continues to target Vercel. v3 adds the `/stream` endpoint to the existing Vercel functions. No platform change.

Users who want the smoothest live-share experience without paying Vercel Pro can self-host on Cloudflare Workers, Deno Deploy, Fly.io, or any platform that handles long-lived connections well, by implementing the updated Cloud API contract themselves. The "Use your own" tab exists for this. Frank does not maintain ports for other platforms.

---

## Contract Changes

`CLOUD_API.md` gets additive changes. Existing endpoints keep working (see migration note below). New endpoints and requirements are layered on.

### New endpoints

- `GET /api/share/:id/stream` — viewer-facing SSE stream. Returns `text/event-stream`. First event delivers current state; subsequent events carry diffs, comments, presence, and author status. Supports `Last-Event-ID` for resume.
- `GET /api/share/:id/author-stream` — daemon-facing SSE stream. Delivers comments and presence events to the author. The backend uses the open/closed state of this connection to determine author online/offline status.
- `POST /api/share/:id/state` — daemon-facing endpoint for pushing state updates. Accepts a JSON body with `{ revision: number, type: "state" | "diff", payload: ... }`. Each successful POST updates the stored snapshot, appends to the rolling diff buffer, and triggers a broadcast.
- `DELETE /api/share/:id` — revokes a share (see v2 Gaps section).

### Event format

Events are JSON-encoded with a `type` field. State-bearing events carry the monotonic revision number:

- `state` — full state snapshot with revision. Sent on initial connect, after long reconnect gaps, and whenever a diff would be larger than a full snapshot.
- `diff` — incremental state change with revision.
- `comment` — new comment posted by a viewer.
- `presence` — viewer count update.
- `author-status` — `online`, `offline`, or `ended` (live session explicitly stopped).
- `share-ended` — share has been revoked or expired; viewers should disconnect.

### What "snapshot" means per project type

The word "snapshot" carries different payloads depending on the project:

- **Canvas:** serialized Konva JSON plus any referenced assets as inline data URLs (matches v2's existing canvas share payload).
- **Image:** the image file plus annotation overlay state.
- **PDF:** the PDF file plus current page, scroll position, and annotation overlay state.
- **URL (v3.0 static only; v3.1 adds live):** the v2 DOM snapshot HTML.

State updates (`diff` events) change only the mutable parts — annotations, canvas shapes, current page, etc. — never the underlying asset (image bytes, PDF bytes, DOM HTML).

### Existing endpoints

- `POST /api/share` continues to behave as in v2: creates a new share, returns the share ID and initial snapshot. This is called once per share, at share creation. Ongoing state updates use `POST /api/share/:id/state`, not this endpoint.
- `POST /api/comment` continues to accept comments (unchanged). The backend now also broadcasts accepted comments to all open streams.

### New contract requirements

Hosts implementing the contract must:

1. Support `GET /api/share/:id/stream` and `GET /api/share/:id/author-stream` as long-lived `text/event-stream` responses.
2. Accept `POST /api/share/:id/state` updates, persist the latest snapshot, maintain a rolling diff buffer (default: 60 seconds), and broadcast changes to all open viewer streams.
3. Tag all `state` and `diff` events with the current monotonic revision number; support `Last-Event-ID`-based resume (replay diffs from the buffer on short gaps, send full state on long gaps or buffer miss).
4. Treat the author-stream connection as the author-online signal. Broadcast `author-status: offline` after ~15 seconds of no author-stream connection, not instantly.
5. On revocation or expiration: invalidate the share ID, close all streams for that share with `share-ended`, delete the stored snapshot and buffer — in that order.
6. Maintain viewer counts per share (deduplicated by client session token, excluding the author's author-stream) and broadcast `presence` events when they change.
7. Enforce per-share viewer caps (default 50, configurable by the host).
8. Disconnect idle viewer sessions after 30 minutes with no interaction.
9. Rate-limit connection attempts per IP to prevent abuse.

### Migration from v2

Existing v2 shares keep working under the v2 contract. The v3 reference backend implements both the v2 HTTPS-only endpoints and the new v3 streaming endpoints. When a v2 client (daemon running old code) talks to a v3 backend, everything works as before — no streaming, no live updates, static share behavior. When a v3 client creates a new share, it uses the streaming endpoints.

Users upgrading from v2 to v3 redeploy their backend once. Existing share links they have distributed continue to function as static v2 shares. New shares created after the upgrade are live.

No forced migration of existing share data. No expired-overnight share links. The upgrade is additive on both the client and server sides.

---

## Edge Cases and Decisions

These are decisions made now so they don't surprise anyone during v3 implementation.

### Rate limiting and caps

Per-share viewer cap of 50 by default, configurable by the host. When the cap is hit, new connections receive HTTP 429 with a clear message ("This share has reached its viewer limit"). The cap is a contract requirement but the number is a host-configurable default.

The cap applies to concurrent active viewer sessions. It excludes the author's own connection (the daemon does not count against it). Duplicate sessions from the same client — the same browser across multiple tabs, for example — collapse to a single seat using a lightweight client session token. Reconnection attempts from an existing session do not consume additional cap capacity.

Per-IP connection rate limit is required in the contract. Specific numbers are up to the host. Self-hosters are encouraged to put Cloudflare or similar DDoS protection in front of their backend.

### Idle viewer timeout

To prevent cheap persistent bandwidth-drain attacks (an attacker opening many long-lived viewer connections), the backend disconnects viewers that have shown no interaction for 30 minutes. "Interaction" here means any comment post, scroll event relayed to the author, or a heartbeat ping from an active browser tab. Background tabs that go inactive for 30 minutes are disconnected; the browser reconnects automatically when the user returns.

This keeps anonymous viewing intact (no auth required) while bounding the cost of abuse.

### Author offline behavior

The backend uses the author-stream connection (see Architecture → Data flow) as the author-online signal. When the daemon's author-stream connection closes:

- The backend waits ~15 seconds (configurable) before flipping status. This grace window absorbs Vercel function timeouts and normal SSE reconnects so that status does not flicker.
- If the daemon has not reconnected within the grace window, the backend broadcasts `author-status: offline` to all viewers.
- Viewers see the last state with a subtle "author offline" indicator.
- Viewer streams stay open; the viewers will receive new updates automatically when the author returns.
- If the daemon reconnects (author opens laptop, network comes back), the backend broadcasts `author-status: online` and streaming resumes.

If the author explicitly ends the live session via the kill switch (see v2 Gaps → Live session kill switch), the backend broadcasts `author-status: ended` instead of `offline`. Viewers see "author has ended live share" and the page falls back to static-snapshot behavior.

### Viewer offline behavior

When a viewer's connection drops (tab backgrounded, wifi drop, laptop sleep):

- Browser handles reconnection automatically via EventSource.
- On reconnect, the viewer sends its last applied revision via `Last-Event-ID`.
- If the requested revision is still in the backend's rolling diff buffer (default: the last ~60 seconds of updates), the backend replays those diffs and the stream resumes normally.
- If the requested revision has aged out of the buffer, or if the buffer was lost (function restart, cache eviction), the backend sends a full `state` event as the first message and the viewer continues from there.

The rolling buffer is the mechanism; the viewer does not need to know whether it got diffs or a full state, only that the stream is live again.

Viewer UI briefly shows "reconnecting" during the gap, then returns to normal.

### Connection timeout and reconnection (Vercel Hobby specifically)

On Vercel Hobby's 10-second function limit, SSE connections die after ~10 seconds and the browser reconnects. Because the reconnect gap is short (usually under a second), the reconnect falls within the rolling diff buffer window — the backend replays the handful of missed diffs and the stream continues.

This is the design's worst legitimate case, and it's acceptable: viewers see tiny stutters during very active sessions but the experience never breaks. Users who want smooth playback upgrade to Vercel Pro with Fluid Compute (much longer function durations, rare reconnects) or self-host on a platform without short function timeouts.

### State snapshot staleness at cold open

When a viewer first loads a share link, the page renders the static snapshot (same as v2) for a fast first paint. Then the SSE connection opens.

The viewer sends its snapshot's revision as `Last-Event-ID` on the initial stream connect. The backend compares to the current revision:

- If they match, the first stream event is a small "you're current" marker, and the viewer proceeds with incoming diffs. No redundant full state transfer.
- If the backend is ahead, the first event is either replayed diffs (if within the rolling buffer) or a full `state` event (if the gap exceeds the buffer).

This keeps cold opens cheap on the common case and correct on the edge case.

### Daemon-side backpressure

The daemon debounces and coalesces state updates before sending. Per project type, the daemon caps outgoing updates at a configurable rate (default: 15/second for canvas, 5/second for PDF, 1/second for image) and coalesces intermediate states — it always sends the latest, never replays history.

If the daemon's upload queue grows beyond a threshold (slow network, backend slow), it drops intermediate states and sends only the latest. Rule: "catch up to current, don't replay history."

All rate defaults are configurable in Settings and tunable per-share if needed.

### Bandwidth bounds

Bursty workloads (dropping in a batch of shapes, rapid editing) need headroom that a flat rate limit doesn't provide. The daemon uses a burst-plus-sustained model:

- Burst allowance: up to 3 MB in a short window.
- Sustained rate: 1 MB/minute averaged over time.

Above the sustained rate, the daemon pauses state updates until the average drops below the cap. This protects self-hosters from runaway bandwidth bills while letting legitimate bursts through unthrottled. Both numbers are user-configurable in Settings.

A viewer watching a very active session may see reduced update frequency if the author is hitting the sustained cap. The author sees a warning toast. This is rare in practice but worth defining.

### Comment ordering under concurrency

Server assigns the canonical timestamp on receipt. Client timestamps are ignored for ordering. Comments appear in all viewers' streams in the order the server received them.

### Stream endpoint authentication

The share ID in the URL is the capability, same as v2. No additional authentication on the stream endpoint. Anyone with the share link can connect to the stream. This matches the existing v2 model — no inconsistent security posture across endpoints.

### Graceful degradation when SSE is blocked

Some networks or browser configurations block SSE. If the viewer fails to open an SSE connection after retries, the viewer falls back to polling the static snapshot every 5 seconds. Not smooth, but functional. The viewer UI shows a subtle "live updates unavailable" indicator so the user understands why things feel slower.

### Snapshot and stream consistency

Consistency is enforced by the revision numbers described in Architecture. The backend's stored snapshot, its rolling diff buffer, and every broadcast event share the same monotonic revision. Any divergence is detected the moment a viewer applies an update — the viewer sees a revision gap and requests resync.

Explicit guarantees:

- Every `POST /api/share/:id/state` call atomically updates the snapshot, appends to the diff buffer, increments the revision, and broadcasts — or fails entirely. Partial success is not allowed.
- Viewers that detect a revision gap request a resync immediately rather than waiting.
- Any viewer can force a clean resync by reloading the page.

The earlier draft required the daemon to send a full state every 5 minutes as drift-prevention. With revisions and atomic updates, that is no longer needed.

---

## v2 Gaps Addressed by v3

The following are gaps in v2's share model that v3 is a natural moment to close. These are not strictly required for live share to work, but it would be strange to ship v3 without them given the work involved.

### Share revocation

**Current v2 state:** No way to revoke a share link. Once created, a link works until the project is deleted (if even then).

**v3 behavior:** A "Revoke share" button in the share popover. Clicking it triggers a strict sequence on the backend to prevent race conditions with cold-opens in progress:

1. Invalidate the share ID so new connection attempts and new cold-open requests are rejected.
2. Close all open SSE stream connections for that share with a `share-ended` event.
3. Delete the stored snapshot from backend storage.

Viewers with the link see "This share has been ended by the author" and the page becomes inert. Revocation is immediate and irreversible.

### Optional share expiration

**Current v2 state:** No expiration. Shares are permanent until explicitly deleted.

**v3 behavior:** When creating a share, the user optionally selects an expiration from a picker (default: 7 days; options: 1 day, 7 days, 30 days, 90 days, 1 year). When a share expires, the backend follows the same ordered sequence as revocation:

1. Invalidate the share ID so new connection attempts and cold-open requests are rejected.
2. Close all existing stream connections with a `share-ended` event.
3. Delete the stored snapshot.

Default is 7 days (matching v2's implicit behavior). The picker adds a range from 1 day to 1 year; no indefinite option, since unbounded shares complicate storage cleanup and users needing longer can re-create.

### Live session kill switch

**Current v2 state:** Not applicable (no live sessions).

**v3 behavior:** A "Stop live share" button separate from revoke. When the author clicks it:
- The daemon closes its author-stream connection and stops pushing updates to the backend.
- Backend broadcasts `author-status: ended` to all viewers (distinct from `offline`, which means "may come back any moment").
- The share link still works — reviewers can still open it and see the static snapshot.
- Comments from reviewers continue to sync (via POST, as in v2).
- The author can restart live sharing at any time by clicking "Resume live share," which reopens the author-stream and resumes normal broadcasting.

This separation matters: "stop broadcasting" and "revoke the link" are different actions. The author might want to walk away without killing reviewers' ability to see the last state.

### Viewer count presence

**Current v2 state:** No presence information.

**v3 behavior:** A small indicator in the author's UI showing "N people watching." No list, no names, no avatars — just the count. Viewers see the same count so they know if others are watching with them.

The count updates on viewer connect and disconnect only. Idle detection, reconnection jitter, and background-tab pauses are not surfaced — the count reflects "how many viewer sessions are currently open," not "how many viewers are actively paying attention." This keeps the indicator stable and predictable rather than flickering as viewers move between tabs.

This is the minimum presence signal that makes live share feel like collaboration rather than surveillance. Implementing it is trivial given the SSE infrastructure (count equals the number of open stream connections for the share, deduplicated by client session token).

---

## What Is NOT Part of v3

### No live editing

Multiple users modifying the same canvas or document simultaneously is explicitly not part of v3. That requires CRDT, conflict resolution, presence sync, per-user undo. Different architecture, months of work. v3 is one-author-many-viewers, full stop.

### No richer presence indicators

No cursors, no avatars, no typing indicators, no per-viewer names. Just the count. Viewer identity is not tracked — anyone with the link can view anonymously. Adding richer presence would require per-viewer auth, which is a bigger product change than v3 is taking on.

The client session token used to deduplicate the viewer count is a lightweight heuristic (browser-set cookie or similar), not an identity. A determined user can easily get multiple seats by clearing cookies or using multiple browsers. That is acceptable for a count-only display; it would not be acceptable if presence ever grew into identity-bearing features. If v3.x ever adds named presence, that is the moment to revisit the session model.

### No "freeze" or "version" concept

Earlier drafts of this document included a "freeze" toggle so authors could share a specific state rather than their live state. This is unnecessary. If an author wants a specific state captured for the record, they take a snapshot (which already exists for versioning). Share links don't duplicate snapshot functionality.

One share model. No toggles. No modes.

### Removing individual viewers

Not possible with the current anonymous-link model. The only viewer-affecting actions are revoke (kills for everyone) and stop live share (pauses for everyone). Per-viewer removal would require per-viewer identity, which v3 is not adding.

---

## Why SSE Instead of WebSockets — the Honest Version

Earlier drafts of this document framed WebSocket infrastructure as a blocker that required prototyping, a new backend platform, and a breaking contract rewrite. That framing was wrong. The honest reasoning:

- Live share is architecturally one-way (author pushes, viewers receive) with a separate return channel for comments (viewers POST, author's daemon receives). Bidirectional streaming is not required.
- SSE gives real-time-feeling delivery over HTTPS, works on Vercel, requires no new platform, and has automatic reconnection built into browsers.
- The quality difference between SSE and WebSockets for this use case — maybe 100ms vs 200ms latency under typical conditions — is not perceptible in a review-session context.

The tradeoffs of SSE on Vercel Hobby (periodic reconnects) are real but are acceptable for a free-tier experience and are addressed by the Pro tier or by self-hosting on a host with longer connection durations. Users have a path to a better experience without Frank picking a different platform for everyone.

---

## Sequencing

1. **v3.0 ships** with: SSE transport on the updated contract, canvas live state, image live state, PDF live state, viewer-count presence, share revocation, optional expiration, live session kill switch.
2. **Phase 6 — cloud stabilization + deployment verification.** Addresses the gap between per-phase daemon testing and end-to-end deployment testing that surfaced during the v3.0 smoke test. Tracked in `docs/superpowers/plans/2026-04-20-v3-phase6-cloud-stabilization.md`. Shipped alongside v3.0.
3. **v3.1 ships** with URL live-share as its own scoped release.

---

## Note to Claude Code

The design and core mechanics in this doc are settled:

- **Design:** one share model, four project types, one-way author→cloud→viewers.
- **Transport:** SSE on Vercel, daemon holds author-stream back, state updates via HTTPS POST.
- **Consistency:** monotonic revisions, rolling 60-second diff buffer, atomic state+buffer+broadcast on each update.
- **v2 gaps closed by v3:** revocation, optional expiration, kill switch, viewer count.
- **Migration:** v3 backend implements v2 endpoints too; upgrade is additive, no forced migration.

When the author asks you to plan or build v3, proceed. Flag any default thresholds worth revisiting (rate caps, grace windows, buffer size, per-project-type backpressure numbers) but treat the design itself as decided.

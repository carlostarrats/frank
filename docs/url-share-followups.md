# URL share auto-deploy — follow-up work

Status: **v1 code-complete and UI-verified through Settings → Share Preview.**
First real test needs a Vercel token.

This doc captures what's NOT done, grouped by urgency. Use it to pick up where
the build left off — each item has a rough effort estimate so the next session
can plan a realistic chunk. Design doc of record: [`url-share-auto-deploy-design.md`](url-share-auto-deploy-design.md).

---

## Must-fix before v1 goes wide

These are the gaps between "code-complete" and "reviewable end-to-end."

### 1. URL-share viewer page on frank-cloud (~2-3h)

`frank-cloud/api/share.ts` now stores `contentType: 'url-share'` records
with a `deployment: { vercelId, url, readyState }` object. GET returns this
alongside the snapshot (or null). But no frontend serves the viewer yet.

**Build:** new file `frank-cloud/public/viewer/url-share/index.html` that:
1. Reads `shareId` from the URL (e.g., `/s/<id>`).
2. Fetches `/api/share?id=<id>` to get `deployment.url`.
3. Iframes the deployment URL with overlay script tag on top (shadow DOM).
4. Handles the revoked → 410 state with a polite "this share has expired" page.

Caveat: the existing `frank-cloud/public/viewer/` is for snapshot shares
(static HTML blobs). URL shares need their own route. `vercel.json` route
config needs a pattern that distinguishes `/s/<id>` with a URL-share meta
vs. a snapshot meta, OR the single viewer probes the meta and branches.

### 2. Share flow in the viewer toolbar (~4-6h)

Today URL share is only reachable from Settings → Share Preview. Real UX:
user opens a URL project pointing at `localhost:3000`, hits Share in the
viewer toolbar, Frank recognizes it's a localhost URL and launches the
auto-deploy flow.

**Build:**
- Extend `ProjectV2` protocol with optional `sourceDir?: string`. Ship a
  migration path (absence = prompt on first share).
- First-time source-dir picker: when the user hits Share on a URL project
  without `sourceDir`, show a modal asking for the absolute path (text
  input, same constraint as Settings → Share Preview since browsers can't
  pick directories). Save it to the project.
- Extend `share-popover.js` to route URL-share clicks to `createShare`
  instead of the snapshot upload path.
- Progress UI inside the share popover (envelope → preflight → bundle →
  upload → building → ready). Reuse `renderPreflightResult` +
  `renderShareCreateResult` from `share-envelope-panel.js`.
- Pre-flight gate: if envelope fails, show refusal UI in the popover
  (also reusable from the panel component).

### 3. Share list UI + revoke flow (~3-4h)

After a user creates a share and closes the diagnostics panel, they lose
the ability to revoke it. Revoke currently only works in the same session,
while the create-result is still on screen.

**Build:**
- Daemon: `list-url-shares` WebSocket handler. Reads active shares from
  frank-cloud (`GET /api/share?owner=<something>`) or from a local
  `~/.frank/share-records.json` that the daemon writes at share-create
  time. Latter is simpler + works offline.
- UI: per-project "Shares" panel (probably inside the viewer or a
  dedicated tab in Settings). Shows `{ shareId, createdAt, expiresAt,
  deploymentUrl, revokeStatus }`.
- Per-row "Revoke" button that calls `share-revoke-url` with the stored
  `{ shareId, revokeToken, vercelDeploymentId }`.
- Per-row "Copy link" button.

### 4. Live Vercel deploy test (~15 min for user)

Code-complete but never run against a real Vercel account. User needs to:

1. Start daemon: `cd daemon && npm run build && frank start`
2. Settings → Share Preview → paste Vercel personal access token → Save
3. Point at AdaptiveShop: `/Users/carlostarrats/Documents/AdaptiveShop/adaptive-shop`
4. Click Check envelope → Run pre-flight → Create share
5. Confirm preview URL opens and renders the app

Likely to surface one or two issues the mocked-fetch tests couldn't catch
(Vercel API quirks, real build-env differences, etc.). Budget another
1-2h for whatever comes up.

### 5. Cross-browser spot-check of the overlay (~30-45min for user)

Shadow DOM + SSE behavior varies. I only tested Chrome. Safari and Firefox
should be checked at least once. `frank-overlay.js` is the script to watch —
if the pill doesn't render or the SSE connection doesn't hold, the overlay
asset needs browser-specific tweaks.

---

## v1-hardening (ship v1, then schedule)

### 6. Revoke retry queue with exponential backoff (~3-4h)

Design doc §8 calls for 24h backoff, v1 does one sync attempt. If Vercel
API is down when revoke fires, the cloud flag flips (share link dead) but
the Vercel deployment sits around until the user manually retries.

**Build:**
- `~/.frank/revoke-queue.json` tracking pending Vercel deletes.
- Background retry task on daemon startup: read queue, retry each entry
  with exponential backoff (1min → 5min → 30min → 1h → 6h → 24h).
- Audit log in the share record updated after each attempt.
- Share list UI surfaces pending/failed state ("⚠️ Revoked from share
  link, but Vercel deployment still live. Retry cleanup?").

### 7. Build-log streaming + three-zone build UX in UI (~3-4h)

Vercel's `/v13/deployments/:id/events` endpoint streams build output as
newline-delimited JSON. Currently the UI shows a generic "Vercel
building…" spinner with no visibility.

**Build:**
- Extend `vercel-api.ts` with `streamBuildLogs(deploymentId, token, onLine)`.
- Plumb through `share-create` as a progress event.
- UI: scrollable log pane in the share-create result block.
- Three-zone time states (§6.3): 0-90s "expected" / 90s-5min "taking
  longer than usual" / >5min "timeout — check Vercel dashboard."

### 8. Share-builds directory cleanup (~30 min)

`~/.frank/share-builds/<shareId>/` accumulates forever. Each dir is 5-10MB
(framework source copy + overlay). Over months this adds up.

**Build:** daemon startup hook (like `purgeExpiredTrash` in `projects.ts`)
that reads share records and deletes working dirs where `expiresAt` has
passed. Also clean up on manual revoke.

### 9. Playwright click-interaction probe for Clerk + Auth0 (~1h)

Sandbox blocked the Playwright script in the calibration sweep session.
Clerk and Auth0 are marked "render-validated" only. Need to run the probe
outside the sandbox to confirm auth-button clicks degrade gracefully.

**Build:** `daemon/scripts/probe-clerk-click.mjs` + `probe-auth0-click.mjs`
running against the apps in `/tmp/clerk-frank-test` and `/tmp/auth0-frank-test`.
If either white-screens on click, the guard library in `docs/share-guards.md`
becomes mandatory rather than optional for those SDKs.

---

## v1.1 — data-driven, per design doc §9a / §10

### 10. Codemod + pattern-detection framework (weeks)

Design doc defers this explicitly. Prioritize by which guard patterns v1
users hit most. Would need AST parsers per framework (TS/JS for Next + Vite
+ Remix; Svelte; Astro) + a pattern matcher + transform + diff review UI.

Start with the Supabase `useEffect` + `getSession` pattern since it's the
most common and already documented in `share-guards.md`.

### 11. Monorepo support (weeks)

v1 refuses. v1.1 should detect subpackages, resolve `workspace:*` deps from
the lockfile, flatten into a single deployable bundle. Per-workspace-manager
logic (pnpm, Yarn, npm workspaces, Turborepo, Nx) — each slightly different.

### 12. Additional SDK encoders (10 min each, ongoing)

Whatever v1 users surface as refuse-to-guess. Each runs Appendix A's
validation protocol. Likely near-term adds:
- `better-auth`, `@nuxt/*`, more OAuth providers
- Analytics/monitoring: Datadog, LogRocket, Fullstory
- CMS: Sanity, Contentful, Payload
- Database: Prisma, Drizzle (wrap their env)

---

## v1.2+ — polish

### 13. Expiry management
Expiry set at create-time can't be adjusted. Add an "extend" button that
POSTs a new expiresAt to frank-cloud.

### 14. Audit log viewer
`meta.json.auditLog` exists server-side but no UI reads it. Per-share
detail view showing the event timeline.

### 15. `frank share <dir>` CLI
Command-line equivalent of the UI flow. All internal modules exist; wire
`cli.ts` to call `createShare()` and print the preview URL.

### 16. Hard-isolation mode (§10 open question)
Two Vercel tokens (one for frank-cloud, one for deploys). Only worth
building if users ask — most won't care.

---

## Dev hygiene (independent of share work)

### 17. Drop legacy AI modules (~1h)

CLAUDE.md has flagged these since pre-v3.0:
- `@anthropic-ai/sdk` in `daemon/package.json`
- `daemon/src/ai-conversations.ts`
- `daemon/src/ai-providers/claude.ts`
- All the `send-ai-message` / `list-ai-conversations` protocol + server handlers

All UI-unreachable. Clean up pass would save ~50KB of daemon dist + a few
hundred lines.

### 18. Update `CLOUD_API.md` for v3.3 additions (~30 min)

The contract now includes:
- POST `/api/share` body accepts `deployment: { vercelId, vercelTeamId?, url, readyState }` alongside or instead of `snapshot`.
- GET response includes `deployment` field.
- meta.json includes `auditLog: Event[]`.

Any third-party implementing the cloud contract (Cloudflare Workers, Deno
Deploy) would miss these without the doc update.

---

## Sequencing recommendation

**Before v1 ships wide:** items 1, 2, 3 (10-13h total).
**Day-one validation:** items 4, 5 (both user-driven, ~1h).
**Point releases after v1:** items 6, 7, 8 (~8h total).
**v1.1 scope (data-driven):** 10, 11, 12.
**Polish (anytime):** 13-16.
**Hygiene (anytime):** 17, 18.

Skipping items 1-3 is defensible for an internal / self-use v1 since the
Settings diagnostics panel IS a working end-to-end flow. Just know that
real external users will want revoke-after-session and share-from-toolbar.

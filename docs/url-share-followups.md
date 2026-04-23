# URL share auto-deploy — follow-up work

Status: **End-to-end through v1-hardening as of dev-v3.11 (2026-04-23).** Every must-fix-before-v1-wide item (1–5) plus v1-hardening items 6, 7, 8, 17, 18 are done. Static-HTML support added alongside; `engines.node` downgraded to warning; SSO/password-protection auto-disabled on the deployed project.

Remaining: item 9 (Playwright Clerk/Auth0 click probe, ~1h — was sandbox-blocked previously) + real-Safari/Firefox live sanity check for item 5.

This doc captures what's NOT done, grouped by urgency. Use it to pick up where
the build left off — each item has a rough effort estimate so the next session
can plan a realistic chunk. Design doc of record: [`url-share-auto-deploy-design.md`](url-share-auto-deploy-design.md).

---

## Must-fix before v1 goes wide

These are the gaps between "code-complete" and "reviewable end-to-end."

### 1. URL-share viewer page on frank-cloud (~2-3h) — ✅ DONE (dev-v3.10, 2026-04-23)

`frank-cloud/public/viewer/viewer.js` now probes `metadata.contentType === 'url-share'` (or `deployment?.url`) at the top of `renderViewer` and delegates to a new `renderUrlShare` path — a full-viewport iframe pointed at `deployment.url` with a dismissible cover-note banner and no sidebar (overlay handles commenting inside the deployment). `vercel.json` gained `frame-src 'self' https://*.vercel.app` in the viewer CSP to allow the iframe. Revoked → 410 handling falls through the existing `{ error: 'expired' }` path in `init()`; nothing extra needed.

The single-viewer-branches-on-meta approach was chosen over a separate `/viewer/url-share/` route — simpler, keeps the `/s/:id` rewrite intact.

### 2. Share flow in the viewer toolbar (~4-6h) — ✅ DONE (dev-v3.9, 2026-04-23)

`showSharePopover` now detects localhost URL projects via a new `isLocalhostUrl()` helper and delegates to a URL-share popover that runs the Vercel-token gate + sourceDir gate + one-click "Create share." `ProjectV2.sourceDir` was added to the protocol + `set-project-source-dir` handler + sync wrapper so the path is remembered per project. Result renders via the shared `renderShareCreateResult` helper with revoke-in-session.

Progress events were fixed simultaneously: `share-create-progress` messages stamped with the request's `requestId` were resolving the pending promise early in `sync.js` and making every share look like it failed at "unknown." They now broadcast only, letting the final `share-create-result` resolve the promise as intended.

**Original description kept below for context:**

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

### 3. Share list UI + revoke flow (~3-4h) — ✅ DONE (dev-v3.10, 2026-04-23)

Picked the local-file approach from the two options in the original plan — `daemon/src/share/share-records.ts` writes to `~/.frank/share-records.json` at mode 0600, atomic (.tmp → rename), filters by projectId / revoked / expired, with a 30-day retention purge on daemon startup. 16 unit tests cover write / read / mark-revoked / purge.

Protocol: `ListUrlSharesRequest`; `ShareCreateRequest` gained `projectId?` so the persistence hook can bind records to the right project. Server writes on share-create success and marks on share-revoke-url.

UI: the URL-share popover now renders an "Active shares (N)" section above the Source row. Each row: clickable shareUrl, "Expires in 3 days · Vercel: <host>" meta, Copy + Revoke buttons. Revoke fires the confirm dialog + `shareRevokeUrl` + refreshes the list in place. Freshly-created shares surface immediately — no close+reopen needed.

Revoke is still same-project only — a dedicated "Shares" tab in Settings that crosses projects is v1.1 polish if real users want it.

### 4. Live Vercel deploy test (~15 min for user) — ✅ DONE (2026-04-23)

Validated end-to-end against AdaptiveShop and a scaffolded static-HTML test site. Findings fed back into three in-flight fixes:
- AdaptiveShop surfaced the expected Supabase `getSession()` spinner (documented pattern from `share-guards.md`); docs + in-app copy were hardened so future users see the gotcha before hitting it.
- Frank-cloud deployed version was stale (rejected URL-share records with "Missing snapshot"); redeployed.
- Vercel's default SSO protection returned 401 to anonymous reviewers; new `disableDeploymentProtection` PATCH wired into `share-create.ts` + documented in design doc §6.4 as P0.

**Original description kept below for context:**

Code-complete but never run against a real Vercel account. User needs to:

1. Start daemon: `cd daemon && npm run build && frank start`
2. Settings → Share Preview → paste Vercel personal access token → Save
3. Point at AdaptiveShop: `/Users/carlostarrats/Documents/AdaptiveShop/adaptive-shop`
4. Click Check envelope → Run pre-flight → Create share
5. Confirm preview URL opens and renders the app

Likely to surface one or two issues the mocked-fetch tests couldn't catch
(Vercel API quirks, real build-env differences, etc.). Budget another
1-2h for whatever comes up.

### 5. Cross-browser spot-check of the overlay (~30-45min for user) — ✅ STATIC-PASS (dev-v3.11, 2026-04-23)

Live Safari + Firefox runs weren't practical through the MCP automation (can't navigate to `*.vercel.app`), so this was verified via static source analysis of `frank-overlay.js` as served from an active deployment. The overlay was deliberately authored Safari-conservative:

- No arrow functions, no `const` / `let`, no template literals, no `class`, no optional chaining / nullish coalescing. Pure ES5 syntax.
- Explicit Safari fallback at lines 8–16 for `document.currentScript` (the old WebKit bug).
- Only two modern APIs: `attachShadow({ mode: 'open' })` and `EventSource`. Both universal since Safari 10+, Firefox 63+, Chrome 53+.
- No `fetch()` at all — SSE via EventSource only.
- 109 lines, 3.9 KB served.

**Remaining human step:** a 60-second live open in real Safari + Firefox to confirm the shadow-DOM pill visually renders + SSE opens. Nothing in the source would plausibly fail, so surfacing surprises is the only value — treat as a real-user-feedback loop, not a blocker.

---

## v1-hardening (ship v1, then schedule)

### 6. Revoke retry queue with exponential backoff (~3-4h) — ✅ DONE (dev-v3.11, 2026-04-23)

Two new modules:

- **`daemon/src/share/revoke-queue.ts`** — pure-data queue at `~/.frank/revoke-queue.json` (mode 0600, atomic write). Schedule: 1min → 5min → 30min → 1h → 6h → 24h (6 retries; after the last failure the entry gets `gaveUpAt` set rather than being deleted, so the UI can surface "manual cleanup needed"). Supports enqueue / list / due-for-now / mark-attempt / give-up. 19 unit tests.

- **`daemon/src/share/revoke-worker.ts`** — background worker driven by `setTimeout` chain. Deps injected (Vercel token getter + delete function) so tests drive it deterministically with a clock override. `startRevokeWorker` on daemon startup; `notifyRevokeEnqueued` re-arms the timer when a fresh entry arrives. `onSuccess` callback patches the share record so the list UI sees `vercelDeleted: true` after a late retry succeeds. 7 unit tests.

Wiring: `server.ts#share-revoke-url` handler enqueues when `linkInvalidated && !vercelDeleted && vercelError` (i.e. the privacy-critical flag flip worked but Vercel delete failed). `list-pending-revokes` WebSocket handler + `sync.listPendingRevokes()` surface the queue to the UI.

UI: URL-share popover renders a "Vercel cleanup retrying (N)" block below the active-shares list, plus a red "Vercel cleanup failed — delete manually" block for gave-up entries. No buttons — worker is autonomous; surface is purely informational (verified end-to-end with a manually-seeded queue entry).

### 7. Build-log streaming + three-zone build UX in UI (~3-4h) — ✅ DONE (dev-v3.11, 2026-04-23)

`vercel-api.ts` gained `streamBuildLogs` hitting `/v3/deployments/:id/events?follow=1&builds=1` — newline-delimited JSON streamed through a `ReadableStream` reader with split-at-newline parsing (handles mid-chunk boundary + malformed lines gracefully). Runs in parallel with `pollDeployment`; aborted when poll resolves.

`share-create.ts` surfaces log lines through a new `ShareProgress` stage `'vercel-log'` with `logType` + `logText` fields, filtered to stdout / stderr / fatal (deployment-state noise stripped — poll already covers that). UI popover now renders a build-progress block with: current stage label, live elapsed-time timer (driven off `requestAnimationFrame`), three-zone banner (yellow at 90s, red at 5min per design doc §6.3), and a scrollable `<pre>` log pane with auto-scroll-to-bottom (sticky unless the user scrolls up manually).

+7 unit tests covering the streamer: parse, chunk-boundary split, malformed-line tolerance, non-2xx silent return, consumer-exception swallowing, teamId query append, external abort.

### 8. Share-builds directory cleanup (~30 min) — ✅ DONE (dev-v3.10, 2026-04-23)

`share-records.ts` gained `purgeOrphanedShareBuilds` (startup sweep: deletes
dirs whose record is revoked, expired, or missing entirely) and
`removeShareBuild` (synchronous cleanup called from the revoke handler).
Wired into `startServer` alongside `purgeExpiredRecords`. 8 new tests.

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

### 17. Drop legacy AI modules (~1h) — ✅ DONE (dev-v3.10, 2026-04-23)

Removed the UI-unreachable in-app AI chat plumbing flagged pre-v3.0:
- `@anthropic-ai/sdk` dep
- `daemon/src/ai-conversations.ts` + its 13-test suite
- `daemon/src/ai-providers/claude.ts`
- 6 server handlers (`get-ai-config`, `set-ai-api-key`, `clear-ai-api-key`, `list-ai-conversations`, `load-ai-conversation`, `send-ai-message`) + their protocol types
- `handleSendAiMessage` function
- `getClaudeApiKey` / `setClaudeApiKey` / `clearClaudeApiKey` in `cloud.ts`
- Matching 6 UI wrappers in `sync.js`
- `conversations` field from `report.ts` (ReportData + MD + PDF renderers)

Zero dangling refs. Build clean. Tests drop from 355 → 342 (the 13 removed are the deleted ai-conversations suite). AI handoff keeps the three shipping paths: MCP, Copy-for-AI, JSON/MD/PDF export.

### 18. Update `CLOUD_API.md` for v3.3 additions (~30 min) — ✅ DONE (dev-v3.10, 2026-04-23)

POST `/api/share` body + `GET /api/share` response + `meta.json` shape all
document the v3.3+ URL-share auto-deploy additions. Third-party implementers
porting to Cloudflare Workers / Deno Deploy / etc. have the full contract
now.

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

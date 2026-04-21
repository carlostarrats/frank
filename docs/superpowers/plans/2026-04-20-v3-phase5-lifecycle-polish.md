# v3 Phase 5 — Lifecycle + Presence UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining v2-gap UI wiring the direction doc named as part of v3.0: explicit "Revoke share" button in the share popover, optional share-expiration picker at share creation, content-type-aware copy for the `payload-too-large` error banner (Phase 2 shipped canvas-specific wording that doesn't fit image or PDF), and an ambient "LIVE · N watching" badge on the main share button so the author sees presence without reopening the popover. All daemon plumbing and backend contract support exists from Phase 1 — Phase 5 is UI wiring.

**Architecture:** Pure UI + thin daemon pass-through. No new daemon modules. No new backend routes. `revoke-share` handler already exists in `server.ts` from Phase 1 — UI just dispatches the message. `POST /api/share` backend already accepts `expiryDays` — daemon's `uploadShare` signature gets one new optional parameter that flows through to the HTTP body. Share popover gains a revoke button (with confirm), an expiration `<select>` on the create path, generalized banner copy mapping by the project's contentType, and dispatches the same `start/stop/resume/revoke` messages. An ambient live badge on the toolbar share button renders whenever `liveShareState.status` for the current project is `'live'` or `'throttled'` — subscribes to the same `frank:live-share-state` DOM events the popover already consumes.

**Tech Stack:** Plain JS (UI), Node.js + TypeScript daemon passthrough only, Vitest for daemon type/signature check. No new UI tests (UI code isn't under Vitest; validation is smoke-test based, matching Phases 2–4a).

**Context:** Phases 1, 2, 3, and 4a are merged to `dev-v2.08` (HEAD `cc71913`). All transport + per-project-type live-share work is functionally complete. Phase 5 is the last pre-v3.0 phase.

**Spec:** `/Users/carlostarrats/Downloads/frank-v3-direction.md`, "v2 Gaps Addressed by v3" section:
- **Share revocation** — "A 'Revoke share' button in the share popover." — daemon shipped, UI not wired.
- **Optional share expiration** — "When creating a share, the user can optionally set 'Expire after N days' (default: no expiration)." — backend accepts it, UI not wired.
- **Live session kill switch** — ALREADY SHIPPED in Phase 2 (the "Pause live share" button in the popover is this, with resume-live-share restoring it).
- **Viewer count presence** — Phase 2 shipped it inside the popover; Phase 5 adds an ambient version on the toolbar share button.

Plus one tech-debt cleanup that isn't a v2-gap but should land before v3.0 tags:
- Phase 2's `payload-too-large` banner says "Canvas too heavy for live share — reduce inline assets." That copy leaks across to image + PDF projects (any project type can hit the 1 MB cap). Generalize it per contentType.

**Phases (recap):**
- **Phase 1–4a (complete):** Transport + canvas + image + PDF live share.
- **Phase 5 (this plan):** Lifecycle + presence UI polish.
- **Phase 4b (v3.x, post-v3.0 / pre-v3.1):** PDF.js rendering migration + page/scroll live sync.
- **v3.1 (out of scope):** URL live share.

---

## Scope note on expiration defaults

The direction doc says "Default stays at 'no expiration' to preserve current behavior." That was aspirational — v2's actual behavior was a 7-day default (see `frank-cloud/api/share.ts:114`: `const days = expiryDays || 7`, and `ui-v2/views/viewer.js` sets `expiresAt: new Date(Date.now() + 7 * 86400000)` when creating an active share).

Phase 5 does NOT change the default. A share created without selecting an expiration option keeps the existing 7-day behavior. The picker is opt-in for users who want a different duration. Options: "1 day", "7 days (default)", "30 days", "90 days", "1 year". No "Never" option — unbounded shares complicate storage cleanup and aren't materially better than "1 year" for the rare case that wants a long-lived share. If someone genuinely needs longer than 1 year, they can re-create the share.

Direction doc will get a one-line update in Task 5 reflecting "7 days default with picker for 1 day to 1 year" — same honesty pattern as the other deferrals.

---

## What's already shipped that Phase 5 does NOT need to build

Confirmed via grep + code review:

- **`revoke-share` WebSocket handler** — exists in `daemon/src/server.ts:881`. Calls `ctl.revoke(revokeToken)` or falls back to direct `cloud.revokeShare(...)`. Clears per-share send-state for canvas/image/PDF. Sets `project.activeShare = null`, saves project, broadcasts `share-revoked`.
- **Backend DELETE /api/share + share-ended broadcast** — shipped in Phase 1.
- **`frank:share-revoked` DOM event listener** — share-popover.js already clears its local `liveShareState` entry on receipt.
- **`expiryDays` in backend POST /api/share** — shipped in Phase 1 (`frank-cloud/api/share.ts:87` destructures it, line 114 uses it with default 7).
- **2h auto-pause banner copy** — shipped verbatim in Phase 2's share-popover.js.
- **"N watching" in the popover** — Phase 2 `renderLiveBlock` shows it in the `live` status branch.
- **Reviewer-side presence pill** — Phase 1 Task 14 shipped `#frank-presence` in the cloud viewer.

---

## File Structure

### Daemon (`daemon/src/`)

```
daemon/src/
├── cloud.ts                 # MODIFY: add optional expiryDays param to uploadShare(); flow through to POST body
└── protocol.ts              # MODIFY: add optional expiryDays to UploadShareRequest
```

### Frank app UI (`ui-v2/`)

```
ui-v2/
├── core/
│   └── sync.js              # MODIFY: uploadShare() passes through expiryDays
├── components/
│   └── share-popover.js     # MODIFY: revoke button + confirm, expiration picker, contentType-aware banner copy, dispatch revoke-share
├── components/
│   └── toolbar.js           # MODIFY: ambient LIVE badge on share button subscribes to frank:live-share-state
├── views/
│   └── viewer.js            # MODIFY: pass coverNote + expiryDays through the existing share flow
├── views/
│   └── canvas.js            # MODIFY: same passthrough as viewer.js for canvas projects
└── styles/
    └── app.css              # MODIFY: revoke button style, expiration select style, live badge pulse animation
```

### Docs

```
README.md                    # MODIFY: update v3-in-progress section to mark Phase 5 complete
/Users/carlostarrats/Downloads/frank-v3-direction.md  # MODIFY: note expiration default (7 days with picker 1d–1y)
```

No cloud viewer changes — Phase 5 is author-side only. No new backend routes. No test count change — daemon changes are type-only signature pass-throughs and don't warrant new tests.

---

## Task 1: Daemon — expiryDays passthrough

Extend `uploadShare` + `UploadShareRequest` so the UI can pass an explicit expiration. Backend already accepts it; daemon just forwards it.

**Files:**
- Modify: `daemon/src/protocol.ts`
- Modify: `daemon/src/cloud.ts`
- Modify: `daemon/src/server.ts` (handler passthrough)

- [ ] **Step 0: Preflight — confirm no other callers of `uploadShare` break**

Before extending the signature, grep for all callers:

```bash
grep -rn "uploadShare(" daemon/src/ --include="*.ts"
```

Expected: one caller in `server.ts` (the `upload-share` handler). Adding an optional trailing parameter is non-breaking for any caller that doesn't pass it — TypeScript accepts the old call sites unchanged. If the grep turns up additional callers (tests, scripts, other modules), verify they still compile after Step 2's signature change. None should break since the new param is optional, but a quick `npm test` + `npm run build` between commits catches any surprise.

- [ ] **Step 1: Extend `UploadShareRequest` interface**

Find `UploadShareRequest` in `daemon/src/protocol.ts` (around line 109). Current:

```ts
export interface UploadShareRequest { type: 'upload-share'; snapshot: unknown; coverNote: string; contentType: string; oldShareId?: string; oldRevokeToken?: string; requestId?: number; }
```

Replace with (adds optional `expiryDays`):

```ts
export interface UploadShareRequest {
  type: 'upload-share';
  snapshot: unknown;
  coverNote: string;
  contentType: string;
  oldShareId?: string;
  oldRevokeToken?: string;
  expiryDays?: number;  // v3 Phase 5: optional. Absent = backend default (7 days).
  requestId?: number;
}
```

- [ ] **Step 2: Extend `uploadShare()` signature in cloud.ts**

Find `uploadShare()` in `daemon/src/cloud.ts` (around line 114). The current signature:

```ts
export async function uploadShare(
  snapshot: unknown,
  coverNote: string,
  contentType: string,
  oldShareId?: string,
  oldRevokeToken?: string,
): Promise<{ shareId: string; revokeToken: string; url: string } | { error: string }> {
```

Add `expiryDays?: number` as the last parameter:

```ts
export async function uploadShare(
  snapshot: unknown,
  coverNote: string,
  contentType: string,
  oldShareId?: string,
  oldRevokeToken?: string,
  expiryDays?: number,
): Promise<{ shareId: string; revokeToken: string; url: string } | { error: string }> {
```

In the same function's POST body, include `expiryDays` conditionally — omit when undefined so the backend falls through to its 7-day default:

```ts
    const res = await fetch(`${config.url}/api/share`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ snapshot, coverNote, contentType, oldShareId, oldRevokeToken, ...(expiryDays !== undefined ? { expiryDays } : {}) }),
    });
```

(The spread-into-object pattern keeps the body compact — JSON.stringify of `undefined` omits the key, but being explicit also documents intent.)

- [ ] **Step 3: Pass `expiryDays` through the `upload-share` handler**

In `daemon/src/server.ts`, find the existing `case 'upload-share':` handler (around line 392). The current call:

```ts
const result = await uploadShare(msg.snapshot, msg.coverNote, msg.contentType, oldShareId, oldRevokeToken);
```

Replace with:

```ts
const result = await uploadShare(msg.snapshot, msg.coverNote, msg.contentType, oldShareId, oldRevokeToken, msg.expiryDays);
```

Also, when the handler sets `project.activeShare.expiresAt` after a successful upload, the hardcoded 7-day value becomes wrong if the user picked a different duration. Find:

```ts
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
```

Replace with:

```ts
              expiresAt: new Date(Date.now() + (msg.expiryDays ?? 7) * 24 * 60 * 60 * 1000).toISOString(),
```

- [ ] **Step 4: Build + full suite**

```bash
cd /Users/carlostarrats/Documents/frank/.worktrees/<your-worktree>/daemon && npm run build 2>&1 | tail -3
cd /Users/carlostarrats/Documents/frank/.worktrees/<your-worktree>/daemon && npm test 2>&1 | tail -5
```

Expected: build clean, 182/182 tests pass (no new tests — type-only signature passthrough).

- [ ] **Step 5: Commit**

```bash
git add daemon/src/protocol.ts daemon/src/cloud.ts daemon/src/server.ts
git commit -m "$(cat <<'EOF'
feat(daemon): thread optional expiryDays from UploadShareRequest to cloud POST

Backend already accepts expiryDays in POST /api/share (Phase 1). This wires
the daemon passthrough so the UI can offer an expiration picker. Absent =
backend default (7 days). activeShare.expiresAt mirrors whatever expiry was
used so the UI can display accurate "expires in" dates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: UI sync — pass expiryDays through

`ui-v2/core/sync.js` wraps the daemon WebSocket. Its `uploadShare` helper needs to accept an expiryDays arg and forward it.

**Files:**
- Modify: `ui-v2/core/sync.js`

- [ ] **Step 1: Read current uploadShare helper**

```bash
sed -n '118,130p' /Users/carlostarrats/Documents/frank/.worktrees/<your-worktree>/ui-v2/core/sync.js
```

Expected around line 120:

```js
  uploadShare(snapshot, coverNote, contentType, oldShareId, oldRevokeToken) {
    return send({ type: 'upload-share', snapshot, coverNote, contentType, oldShareId, oldRevokeToken });
  }
```

- [ ] **Step 2: Add optional expiryDays parameter**

Replace with:

```js
  uploadShare(snapshot, coverNote, contentType, oldShareId, oldRevokeToken, expiryDays) {
    return send({ type: 'upload-share', snapshot, coverNote, contentType, oldShareId, oldRevokeToken, expiryDays });
  }
```

JavaScript sends `expiryDays: undefined` in the message; the daemon sees `msg.expiryDays === undefined` and skips the POST body injection (per Task 1). Correct no-op behavior when the UI doesn't specify.

- [ ] **Step 3: Verify file parses**

```bash
node --check /Users/carlostarrats/Documents/frank/.worktrees/<your-worktree>/ui-v2/core/sync.js
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add ui-v2/core/sync.js
git commit -m "$(cat <<'EOF'
feat(ui): uploadShare passes expiryDays through to daemon

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Share popover — revoke button + expiration picker + generalized banner copy

The core Phase 5 UI task. Touches `share-popover.js` + a few CSS additions.

**Files:**
- Modify: `ui-v2/components/share-popover.js`
- Modify: `ui-v2/styles/app.css`

- [ ] **Step 1: Read the current share-popover.js**

```bash
cat /Users/carlostarrats/Documents/frank/.worktrees/<your-worktree>/ui-v2/components/share-popover.js
```

Note:
- The `renderLiveBlock(projectId)` function — specifically the `paused + payload-too-large` branch (around line 60) that hardcodes "Canvas too heavy."
- The modal's create flow (`share-create` click handler around line 134) — dispatches `frank:capture-snapshot` with `{ coverNote }`.
- The existing "active share" rendering — look for where the share URL and copy button are rendered when `project.activeShare` exists.
- The existing click handler delegation for `.share-live-btn[data-action]` (start/pause/resume) — we'll add `revoke` as a fourth action.

- [ ] **Step 2: Generalize the `payload-too-large` banner copy**

Find this branch in `renderLiveBlock(projectId)`:

```js
  } else if (status === 'paused') {
    html += `<button type="button" class="share-live-btn" data-action="resume">Resume live share</button>`;
    if (lastError === 'session-timeout-2h') {
      html += `<div class="share-live-banner">Live share paused — sessions auto-pause after 2 hours to prevent accidental long-running sessions. Click Resume to continue.</div>`;
    } else if (lastError === 'payload-too-large') {
      html += `<div class="share-live-banner error">Canvas too heavy for live share — reduce inline assets, then click Resume.</div>`;
    }
  }
```

The project's `contentType` is accessible via `projectManager.get()?.contentType` (the same source share-popover uses elsewhere). Add a helper at the top of the file, after the existing helpers:

```js
// v3 Phase 5: payload-too-large maps to different user-friendly copy per
// project type. Canvas hits this with inline assets; image and PDF hit it
// with the file itself being too large.
function payloadTooLargeCopy(contentType) {
  if (contentType === 'canvas') return 'Canvas too heavy for live share — reduce inline assets, then click Resume.';
  if (contentType === 'image') return 'Image too large for live share — use a smaller file, then click Resume.';
  if (contentType === 'pdf') return 'PDF too large for live share — use a smaller file, then click Resume.';
  return 'File too large for live share — reduce size, then click Resume.';
}
```

Then update the paused branch to use it:

```js
  } else if (status === 'paused') {
    html += `<button type="button" class="share-live-btn" data-action="resume">Resume live share</button>`;
    if (lastError === 'session-timeout-2h') {
      html += `<div class="share-live-banner">Live share paused — sessions auto-pause after 2 hours to prevent accidental long-running sessions. Click Resume to continue.</div>`;
    } else if (lastError === 'payload-too-large') {
      const contentType = projectManager.get()?.contentType;
      html += `<div class="share-live-banner error">${payloadTooLargeCopy(contentType)}</div>`;
    }
  }
```

Verify `projectManager` is imported at the top of the file — it should be, since the existing code already uses it.

- [ ] **Step 3: Add the expiration picker to the create flow**

Find the modal HTML structure. Near the cover-note input (`#share-note`), add an expiration `<select>`. The existing structure probably looks like:

```html
<label for="share-note">Cover note (optional)</label>
<textarea id="share-note" placeholder="..."></textarea>
```

Immediately after the cover-note block, add an expiration block. If the modal HTML is built as a template literal, find the `#share-note` line and append:

```html
<label for="share-expiry">Expires after</label>
<select id="share-expiry" class="share-expiry-select">
  <option value="1">1 day</option>
  <option value="7" selected>7 days (default)</option>
  <option value="30">30 days</option>
  <option value="90">90 days</option>
  <option value="365">1 year</option>
</select>
```

In the `share-create` click handler, read the selected value and pass it through. Find:

```js
  modal.querySelector('#share-create').addEventListener('click', async () => {
    const statusEl = modal.querySelector('#share-status');
    const coverNote = modal.querySelector('#share-note').value.trim();
    statusEl.textContent = 'Capturing snapshot...';
    // ... timeout setup ...
    const event = new CustomEvent('frank:capture-snapshot', { detail: { coverNote } });
    window.dispatchEvent(event);
  });
```

Update to extract and pass `expiryDays`:

```js
  modal.querySelector('#share-create').addEventListener('click', async () => {
    const statusEl = modal.querySelector('#share-status');
    const coverNote = modal.querySelector('#share-note').value.trim();
    const expiryDays = Number(modal.querySelector('#share-expiry').value) || 7;
    statusEl.textContent = 'Capturing snapshot...';
    // ... existing timeout setup (captureInProgress / captureTimeoutId) stays as-is ...
    const event = new CustomEvent('frank:capture-snapshot', { detail: { coverNote, expiryDays } });
    window.dispatchEvent(event);
  });
```

- [ ] **Step 4: Add the revoke button to the existing-share UI**

Find where the existing share URL + copy button are rendered when `project.activeShare` is set. This is typically the section that shows the share URL, expiration info, and a copy-to-clipboard button.

After the existing copy button (or as a new row below the share URL), add a revoke button:

```html
<div class="share-revoke-row">
  <button type="button" class="share-revoke-btn" id="share-revoke">Revoke share</button>
  <span class="share-revoke-help">Invalidates the link for all current viewers.</span>
</div>
```

Wire the click handler. Add this alongside the existing click handler for `#share-copy` (or in the same delegation block used for `.share-live-btn[data-action]`):

```js
  modal.querySelector('#share-revoke')?.addEventListener('click', () => {
    const project = projectManager.get();
    if (!project?.activeShare) return;
    const confirmed = confirm(
      'Revoke this share?\n\n' +
      'The link will stop working for all current viewers and cannot be restored.\n\n' +
      'Your project is unchanged — you can create a new share afterward.'
    );
    if (!confirmed) return;
    sync.send({ type: 'revoke-share', projectId: project.id });
    // Daemon broadcasts share-revoked; the existing frank:share-revoked
    // listener clears liveShareState for this project. The popover also
    // listens for project-loaded broadcasts, which re-render with a null
    // activeShare and put the modal back into "create new share" state.
  });
```

The `confirm()` dialog is the simplest option. It's synchronous and native, which matches v2's existing confirm usage (e.g., the sensitive-content warning in the share flow). A custom confirmation modal would be nicer UX but is explicit scope creep for Phase 5.

- [ ] **Step 5: Append CSS**

Append to `ui-v2/styles/app.css`:

```css
.share-expiry-select {
  width: 100%;
  padding: 6px 8px;
  margin: 6px 0 12px;
  background: var(--input-bg, #1e1e1e);
  color: var(--text-primary, #f0f0f0);
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.15));
  border-radius: 4px;
  font: 13px/1 -apple-system, system-ui, sans-serif;
}
.share-revoke-row {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  display: flex;
  gap: 8px;
  align-items: center;
}
.share-revoke-btn {
  padding: 6px 10px;
  background: transparent;
  color: #ff6b6b;
  border: 1px solid rgba(255, 107, 107, 0.4);
  border-radius: 4px;
  font: 12px/1 -apple-system, system-ui, sans-serif;
  cursor: pointer;
}
.share-revoke-btn:hover {
  background: rgba(255, 107, 107, 0.08);
  border-color: rgba(255, 107, 107, 0.6);
}
.share-revoke-help {
  font: 11px/1.3 -apple-system, system-ui, sans-serif;
  color: var(--text-muted, rgba(255, 255, 255, 0.5));
  flex: 1;
}
```

If `app.css` uses different CSS-custom-property names for theme tokens, adjust fallbacks to match.

- [ ] **Step 6: Verify parses**

```bash
node --check /Users/carlostarrats/Documents/frank/.worktrees/<your-worktree>/ui-v2/components/share-popover.js
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add ui-v2/components/share-popover.js ui-v2/styles/app.css
git commit -m "$(cat <<'EOF'
feat(ui): share popover revoke button + expiration picker + generalized banner copy

Revoke button (with native confirm) dispatches revoke-share daemon message;
daemon already broadcasts share-revoked for state cleanup.

Expiration picker on the create flow — 1d / 7d (default) / 30d / 90d / 1y.
Absent selection keeps v2's 7-day default via daemon's fallback handling.

payload-too-large banner copy now maps per project.contentType:
- canvas → "Canvas too heavy... reduce inline assets..."
- image  → "Image too large... use a smaller file..."
- pdf    → "PDF too large... use a smaller file..."
Phase 2 shipped canvas-only wording; this closes the leak to image+PDF.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: View share handlers pass expiryDays through

`viewer.js` (URL/PDF/image) and `canvas.js` (canvas) both listen for `frank:capture-snapshot` and call `sync.uploadShare(...)`. Both need to forward `e.detail.expiryDays`.

**Files:**
- Modify: `ui-v2/views/viewer.js`
- Modify: `ui-v2/views/canvas.js`

- [ ] **Step 1: Update viewer.js's capture-snapshot handler**

Find the existing `sync.uploadShare(...)` call in `ui-v2/views/viewer.js` (around line 137, inside the `frank:capture-snapshot` listener). The current call:

```js
const result = await sync.uploadShare(
  snapshot,
  e.detail.coverNote,
  project.contentType,
);
```

Replace with:

```js
const result = await sync.uploadShare(
  snapshot,
  e.detail.coverNote,
  project.contentType,
  undefined,  // oldShareId — unused on fresh creation, share-popover handles replacement elsewhere
  undefined,  // oldRevokeToken
  e.detail.expiryDays,
);
```

Verify no existing call to `uploadShare` in viewer.js already passes `oldShareId`/`oldRevokeToken` positionally. If it does, preserve those values; the `expiryDays` addition is the only new argument.

- [ ] **Step 2: Update canvas.js's capture-snapshot handler**

Find the equivalent `sync.uploadShare(...)` call in `ui-v2/views/canvas.js` (around line 387). The current call shape is similar. Replace with the same pattern as Step 1 — pass `e.detail.expiryDays` as the final argument.

- [ ] **Step 3: Verify both files parse**

```bash
node --check /Users/carlostarrats/Documents/frank/.worktrees/<your-worktree>/ui-v2/views/viewer.js
node --check /Users/carlostarrats/Documents/frank/.worktrees/<your-worktree>/ui-v2/views/canvas.js
```

Expected: no output from either.

- [ ] **Step 4: Commit**

```bash
git add ui-v2/views/viewer.js ui-v2/views/canvas.js
git commit -m "$(cat <<'EOF'
feat(ui): viewer + canvas share handlers forward expiryDays to uploadShare

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Ambient live badge on the toolbar share button

When live share is active for the current project, the main share button (toolbar) gets a small "LIVE · N" badge that pulses softly. This means the author can see presence without reopening the popover.

**Files:**
- Modify: `ui-v2/components/toolbar.js`
- Modify: `ui-v2/styles/app.css`

- [ ] **Step 1: Read the current toolbar**

```bash
cat /Users/carlostarrats/Documents/frank/.worktrees/<your-worktree>/ui-v2/components/toolbar.js
```

Identify how the share button is rendered — it's likely a function returning an HTML string with an `<button>` element. Note any existing SVG icon setup.

- [ ] **Step 2a: Verify `frank:share-revoked` event detail shape**

Before wiring the toolbar listener, confirm the event's detail shape matches what the toolbar expects. Grep for how `share-popover.js` reads the event (it's the authoritative consumer from Phase 2):

```bash
grep -A 3 "frank:share-revoked" ui-v2/components/share-popover.js
```

Expected: share-popover reads `e.detail.projectId`. The core/sync.js dispatcher (Phase 2 Task 5) sends the whole WebSocket message as `detail`, so the daemon's `{ type: 'share-revoked', projectId }` becomes `detail.projectId`. The toolbar code below uses the same shape — if the grep reveals share-popover uses a different field path, update the toolbar listener to match exactly.

- [ ] **Step 2b: Add the badge element + subscriber + project-switch rerender**

The badge needs to react to `frank:live-share-state` events (same source the popover uses). It also needs to render correctly when the user switches to a project whose live share started BEFORE the switch (otherwise the badge wouldn't appear until the next state event fires).

Near the top of `toolbar.js`, outside any rendering function, add:

```js
// v3 Phase 5: ambient LIVE badge on the toolbar share button. Tracks the
// frank:live-share-state DOM events emitted by core/sync.js — same source
// the share popover consumes. The popover handles detailed interaction;
// this badge is a passive, always-visible signal.
const toolbarLiveState = new Map(); // projectId → { status, viewers }

window.addEventListener('frank:live-share-state', (e) => {
  const { projectId, status, viewers } = e.detail;
  toolbarLiveState.set(projectId, { status, viewers });
  rerenderBadge(projectId);
});

window.addEventListener('frank:share-revoked', (e) => {
  toolbarLiveState.delete(e.detail.projectId);
  rerenderBadge(e.detail.projectId);
});

function rerenderBadge(projectId) {
  // Marker-based selector. Both the viewer's toolbar (components/toolbar.js)
  // and the canvas view's inline share button (views/canvas.js) tag their
  // share buttons with data-frank-share-btn + data-project-id. Neither
  // existing button's class name is shared between the two views, so we
  // use a neutral data-attribute marker rather than a class selector.
  const shareBtn = document.querySelector('[data-frank-share-btn][data-project-id="' + projectId + '"]');
  if (!shareBtn) return;
  const badge = shareBtn.querySelector('.toolbar-live-badge');
  const state = toolbarLiveState.get(projectId);
  if (!state || (state.status !== 'live' && state.status !== 'throttled')) {
    if (badge) badge.remove();
    return;
  }
  const count = state.viewers || 0;
  const label = count === 1 ? 'LIVE · 1' : `LIVE · ${count}`;
  if (badge) {
    badge.textContent = label;
  } else {
    const el = document.createElement('span');
    el.className = 'toolbar-live-badge';
    el.textContent = label;
    shareBtn.appendChild(el);
  }
}

// Called from the toolbar render path below to sync badge state when the
// toolbar re-renders (project switch, initial mount). Without this, a user
// who starts live share on project A, switches to project B, then switches
// back to A would not see the badge until the next state event fires —
// potentially 30s later at the next state-promotion tick.
export function syncToolbarLiveBadge(projectId) {
  rerenderBadge(projectId);
}
```

**Known limitation (documented, not fixed here):** `toolbarLiveState` grows over the session as the user opens different projects with active live shares. Entries are harmless (stale entries don't render anything because the corresponding share button doesn't exist after project switch), but the map isn't pruned. A future cleanup hook could prune on project-close; Phase 5 doesn't add one — the cost is a few bytes per project the user has live-shared.

- [ ] **Step 3: Tag both share buttons + call syncToolbarLiveBadge after mount**

Frank has TWO share-button locations that need the badge:
- **Viewer view** — `components/toolbar.js` renders the toolbar including the share button (id `toolbar-share`).
- **Canvas view** — `views/canvas.js` builds its own toolbar inline (id `canvas-share-btn` at around line 102).

Both share buttons need two data attributes for `rerenderBadge` to find them:
- `data-frank-share-btn` — the marker attribute (neutral across views)
- `data-project-id` — the project's id (for per-project disambiguation)

Both views also need to call `syncToolbarLiveBadge(project.id)` after the share button is mounted so project-switch state is rendered immediately (rather than waiting for the next state event, which may not fire for 30+ seconds if the session is idle).

**3a. Update `components/toolbar.js`'s share button:**

Find the existing share button markup (around line 23):

```js
        <button class="toolbar-btn toolbar-icon-btn" id="toolbar-share" title="Share" aria-label="Share">
          ${iconLink()}
        </button>
```

Change to include the marker + project-id attributes. Since the existing `renderToolbar(container, options)` function signature may not carry `projectId`, accept one via options. Find the function signature:

```bash
grep -n "export function renderToolbar" ui-v2/components/toolbar.js
```

Extend it to accept `projectId` in its options bag. Then the markup becomes:

```js
        <button class="toolbar-btn toolbar-icon-btn" id="toolbar-share" data-frank-share-btn data-project-id="${projectId}" title="Share" aria-label="Share">
          ${iconLink()}
        </button>
```

**3b. Update `views/viewer.js`'s `renderToolbar` call site:**

Find the existing call at around line 30:

```js
  renderToolbar(container.querySelector('#viewer-toolbar'), {
    // ... existing options ...
  });
```

Pass `projectId: project.id` (the project is already loaded in this scope). Then call `syncToolbarLiveBadge` after the render:

```js
  renderToolbar(container.querySelector('#viewer-toolbar'), {
    projectId: project.id,
    // ... existing options ...
  });
  syncToolbarLiveBadge(project.id);
```

Add the import at the top of `viewer.js`:

```js
import { syncToolbarLiveBadge } from '../components/toolbar.js';
```

**3c. Update `views/canvas.js`'s share button:**

Find the button at around line 102:

```js
        <button class="btn-ghost canvas-icon-btn canvas-share-btn" id="canvas-share-btn" title="Share canvas" aria-label="Share canvas">${iconLink()}</button>
```

Change to include the marker + project-id:

```js
        <button class="btn-ghost canvas-icon-btn canvas-share-btn" id="canvas-share-btn" data-frank-share-btn data-project-id="${project.id}" title="Share canvas" aria-label="Share canvas">${iconLink()}</button>
```

(`project` is in scope in canvas.js's render path; if the variable name differs, match the existing code.)

Then, after `shareBtn = container.querySelector('#canvas-share-btn')` is established (around line 375), call the sync:

```js
  const shareBtn = container.querySelector('#canvas-share-btn');
  shareBtn.addEventListener('click', () => {
    showSharePopover(shareBtn, { onClose() {} });
  });
  syncToolbarLiveBadge(project.id);  // v3 Phase 5: sync badge on canvas mount
```

Add the import at the top of `canvas.js`:

```js
import { syncToolbarLiveBadge } from '../components/toolbar.js';
```

**Both views re-render on project switch** (each view is mounted fresh when the route changes), so the post-mount `syncToolbarLiveBadge` call fires on every switch, not just initial boot. This confirms the project-switch case works with the post-mount pattern rather than needing a separate route-change subscription.

- [ ] **Step 4: Append CSS**

Append to `ui-v2/styles/app.css`:

```css
[data-frank-share-btn] {
  position: relative;  /* anchor for the absolute-positioned badge */
}
.toolbar-live-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  padding: 2px 6px;
  background: #ef4444;
  color: #fff;
  font: 600 9px/1.2 -apple-system, system-ui, sans-serif;
  border-radius: 8px;
  letter-spacing: 0.02em;
  animation: toolbar-live-pulse 2s ease-in-out infinite;
  pointer-events: none;
}
@keyframes toolbar-live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
```

The `[data-frank-share-btn]` selector matches both the viewer toolbar button (components/toolbar.js) and the canvas view share button (views/canvas.js) once Step 3's attribute additions land. No class-name dependency.

- [ ] **Step 5: Verify toolbar.js parses**

```bash
node --check /Users/carlostarrats/Documents/frank/.worktrees/<your-worktree>/ui-v2/components/toolbar.js
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add ui-v2/components/toolbar.js ui-v2/styles/app.css
git commit -m "$(cat <<'EOF'
feat(ui): ambient LIVE badge on toolbar share button

Subscribes to frank:live-share-state DOM events (same source as the share
popover's detailed UI) and renders a small pulsing "LIVE · N" badge on the
share button when status is 'live' or 'throttled'. Gives the author ambient
presence visibility without needing to reopen the share modal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Docs + direction doc + smoke test

**Files:**
- Modify: `README.md`
- Modify: `/Users/carlostarrats/Downloads/frank-v3-direction.md` (outside repo, not committed)

- [ ] **Step 1: Update the README's v3 section**

Find `## v3 — live share (in progress)` in `README.md`. Replace its first paragraph with:

```markdown
## v3 — live share

v3.0 is functionally complete for canvas, image, and PDF projects. Phase 1 shipped the transport layer (SSE streams, monotonic revisions, rolling 60-second diff buffer, viewer presence, share revocation, 2-hour session auto-pause). Phase 2 wired canvas projects. Phase 3 wired image projects. Phase 4a wired PDF projects — comments only; PDF page + scroll sync is deferred to Phase 4b (v3.x) and requires a PDF.js rendering migration. Phase 5 closed the v2 gaps the direction doc named: explicit "Revoke share" button, optional share-expiration picker (1 day / 7 days / 30 days / 90 days / 1 year), content-type-aware "too large for live share" copy, and an ambient LIVE badge on the toolbar share button. URL live share is deferred to v3.1. Tagging v3.0 is gated on a full smoke-test pass across all project types.
```

Add a Phase 5 plan link to the existing bullet list (between Phase 4a and the reference-backend link):

```markdown
- Phase 5 plan: [`docs/superpowers/plans/2026-04-20-v3-phase5-lifecycle-polish.md`](docs/superpowers/plans/2026-04-20-v3-phase5-lifecycle-polish.md)
```

Preserve all other links. Note the section heading changes from "v3 — live share (in progress)" to "v3 — live share" since it's no longer "in progress" once Phase 5 merges (pending smoke-test-and-tag).

- [ ] **Step 2: Update the direction doc**

File: `/Users/carlostarrats/Downloads/frank-v3-direction.md` (outside repo, not committed).

Find the "Optional share expiration" section. The current text says:

```markdown
**v3 behavior:** When creating a share, the user can optionally set "Expire after N days" (default: no expiration). When a share expires, the backend follows the same ordered sequence as revocation:
```

Replace "default: no expiration" with "default: 7 days; picker offers 1 day, 7 days, 30 days, 90 days, 1 year":

```markdown
**v3 behavior:** When creating a share, the user optionally selects an expiration from a picker (default: 7 days; options: 1 day, 7 days, 30 days, 90 days, 1 year). When a share expires, the backend follows the same ordered sequence as revocation:
```

Also update the next sentence that references "no expiration to preserve current behavior" — replace:

```markdown
Default stays at "no expiration" to preserve current behavior. Expiration is opt-in.
```

With:

```markdown
Default is 7 days (matching v2's implicit behavior). The picker adds a range from 1 day to 1 year; no indefinite option, since unbounded shares complicate storage cleanup and users needing longer can re-create.
```

- [ ] **Step 3: Run the smoke test**

Manual verification. No commit for this step.

Requires a configured cloud backend.

```bash
# Start the daemon.
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
frank start

# Start cloud backend.
cd /Users/carlostarrats/Documents/frank/frank-cloud && npx vercel dev
```

**Revoke flow:**
1. Create a canvas project, create a share, start live share.
2. Open the share URL in a second browser tab; verify canvas renders + "1 watching" appears in the author's popover.
3. Close the popover.
4. Verify the toolbar share button shows the "LIVE · 1" pulsing badge.
5. Open the popover again. Click "Revoke share". Confirm the native dialog.
6. Viewer tab: should show "This live share has ended" (from Phase 1's share-ended event) and the page becomes inert.
7. Author tab: popover's share URL disappears; toolbar badge clears; create-new-share flow is available.

**Expiration picker:**
1. Create a fresh image project, open share modal.
2. Pick "1 day" from the expiration select. Click Create.
3. Open the share URL; verify it works (expiration is well in the future).
4. Check `~/.frank/projects/<projectId>/project.json` on disk — `activeShare.expiresAt` should be approximately 24 hours from now:
   ```bash
   cat ~/.frank/projects/<projectId>/project.json | grep -o '"expiresAt":"[^"]*"'
   ```
   Or use `jq` if available. Task 1 Step 3 wires this field to reflect whichever expiry the user chose, so the local state is the ground truth without needing KV console access.
5. Repeat with "90 days" selection; confirm `activeShare.expiresAt` lands near 90 days out.
6. Create a share without touching the select (leave default). Confirm `activeShare.expiresAt` is approximately 7 days out.

**Content-type-aware banner copy:**
1. Create a PDF project with a PDF larger than 1 MB (exceeds `FRANK_STATE_MAX_BYTES`).
2. Start live share. The first state push hits 413.
3. Verify the popover banner reads "PDF too large for live share — use a smaller file, then click Resume." Not "Canvas too heavy."
4. Repeat with a large image project — banner reads "Image too large for live share..."
5. For canvas (heavy inline assets), the original "Canvas too heavy... reduce inline assets..." still appears.

**Ambient LIVE badge:**
1. Close the share popover while live share is active.
2. Toolbar share button shows a pulsing red "LIVE · N" badge.
3. Open a second viewer tab. Badge count updates to "LIVE · 2".
4. Close a viewer tab. Count decreases.
5. Pause live share. Badge disappears.
6. Resume. Badge returns.
7. Revoke share (see revoke flow above). Badge clears permanently.

**Regression checks:**
1. Canvas live share still edits-stream correctly (Phase 2 regression).
2. Image live share still syncs comments correctly (Phase 3 regression).
3. PDF live share still syncs comments correctly (Phase 4a regression).
4. 2-hour auto-pause banner copy still appears verbatim (set `FRANK_SESSION_MAX_MS=60000` to trigger quickly).
5. URL project sharing still works (no live share available, static share only).

- [ ] **Step 4: Commit the README update**

```bash
cd /Users/carlostarrats/Documents/frank/.worktrees/<your-worktree> && git add README.md && git commit -m "$(cat <<'EOF'
docs: update v3 section — Phase 5 complete, v3.0 functionally done

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

The direction-doc edit is not committed (file lives outside the repo).

---

## Thresholds to revisit before tagging v3.0

Phase 5 doesn't add new env-overridable knobs. The existing thresholds from Phases 1–4a carry forward:

| Knob | Current default | Phase-of-origin |
|---|---|---|
| `FRANK_STATE_PROMOTION_MS` | 30 s | Phase 2 |
| `FRANK_STATE_MAX_BYTES` | 1 MB | Phase 1 |
| `FRANK_BURST_CAP_BYTES` | 3 MB / 10s | Phase 2 |
| `FRANK_SUSTAINED_CAP_BYTES` | 1 MB / 60s | Phase 2 |
| `FRANK_VIEWER_CAP` | 10 | Phase 1 |
| `FRANK_SESSION_MAX_MS` | 2 hours | Phase 1 |
| Share expiration default | 7 days | v2 / Phase 5 |

Before tagging v3.0: run the full-phase smoke test (canvas + image + PDF + URL static + all Phase 5 additions), review these knobs against observed real-world behavior during the smoke test, and adjust any that are clearly wrong for the actual use case.

---

## Out of scope for Phase 5 (picked up later, or never)

- **Settings UI for env knobs.** Exposing `FRANK_VIEWER_CAP`, rate caps, session max-duration, etc. in a Settings panel. Not in Phase 5 because the defaults are reasonable for the current user base (you). Users who want to tune can use env vars.
- **Custom confirm modal for revoke.** Phase 5 uses native `confirm()`. Nicer UX is a custom modal; bigger scope than warranted.
- **Per-viewer identity / removal.** Direction doc explicitly deferred these — anonymous link-based access only.
- **Richer presence (cursors, names).** Direction doc explicitly deferred.
- **"Freeze"/version toggle on shares.** Direction doc explicitly rejected this as scope creep.
- **PDF.js rendering migration + page/scroll sync.** Phase 4b (v3.x), separate plan.
- **URL live share.** v3.1.

# v2 Image + PDF Share Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image and PDF project sharing work end-to-end in v2. These two project types have been shipping broken — image shares hang on "Capturing snapshot..." forever, PDF shares "succeed" but render as empty iframes on the cloud viewer. This plan fixes the share-creation flow for both types and adds a defensive timeout on the share-capture UI so future silent failures surface to the user instead of rotting as a spinner.

**Architecture:** Per-project-type snapshot builders in the UI (image/PDF fetch the source file from the daemon's `/files/` route, convert to a data URL, bundle with current comments). The shared share handler in `viewer.js` becomes a type-aware dispatcher — URL still calls the existing `captureSnapshot(iframe)` path; image and PDF each get their own builder call. The cloud viewer repurposes its existing-but-unreachable `fileUrl` render branch to render from inline data URLs. A 15-second timeout wraps the "Capturing snapshot..." state so silent failures (now or in the future) flip to a visible error instead of hanging. Daemon is untouched — this is a pure UI + cloud-viewer fix. v3 Phase 3 (image live share) is written against the resulting working v2.

**Tech Stack:** Plain JS ES modules (UI, cloud viewer), no build step. No daemon changes. No new tests — UI is not under the Vitest harness; validation is smoke-test based, matching how v2 was shipped.

**Context:** Phases 1 and 2 of v3 are merged to `dev-v2.08` (HEAD `8dce24f`). This fix is v2 hygiene and should land between Phase 2 and Phase 3 so Phase 3's image-live-share work inherits a working v2. When Phase 3's plan is written, it assumes this fix is merged.

---

## Why it's broken (for the plan reader)

One shared `frank:capture-snapshot` handler in `ui-v2/views/viewer.js` (around line 116) assumes every viewer-hosted project type uses an iframe:

```js
const iframe = document.querySelector('#content-iframe');
if (!iframe) return;
const snapshot = await captureSnapshot(iframe);
```

**URL projects** work fine — `loadUrlContent` creates `#content-iframe` with the URL's HTML and `captureSnapshot` reads `iframe.contentDocument.documentElement.outerHTML`.

**Image projects** silently fail — `loadImageContent` creates `<img id="content-image">` directly (no iframe, for precise pin coords). `#content-iframe` doesn't exist, the `if (!iframe) return;` guard fires, and the handler returns without calling `updateSharePopover()`. The share popover's status stays on **"Capturing snapshot..." forever.** The user has no error, no timeout, no way to know anything went wrong.

**PDF projects** partially work — `loadPdfContent` does create `#content-iframe`, so the guard passes. But `captureSnapshot` reads `iframe.contentDocument.documentElement.outerHTML`, and for a PDF-in-iframe that's the **browser's PDF-viewer chrome HTML, not the PDF bytes.** The upload "succeeds," the cloud viewer gets served an HTML blob that renders as an empty viewer frame, and reviewers see nothing.

Best guess on how it shipped: the shared viewer-share handler was written when image projects also used `<iframe src="/files/...">`. At some point `loadImageContent` was switched to a direct `<img>` tag, probably for precise pin-anchoring on the image's real dimensions rather than iframe-boxed dimensions. The share handler wasn't updated. PDFs appeared to keep working (handler runs, no error) so the failure went unnoticed — reviewers would need to actually open the share URL to see the empty iframe, which nobody seems to have done.

---

## File Structure

### UI

```
ui-v2/
├── overlay/
│   └── snapshot.js            # MODIFY: add buildMediaFileSnapshot(filePath) alongside existing captureSnapshot + detectSensitiveContent
├── views/
│   └── viewer.js              # MODIFY: frank:capture-snapshot handler branches by project.contentType
└── components/
    └── share-popover.js       # MODIFY: 15s timeout on "Capturing snapshot..." state
```

### Cloud viewer

```
frank-cloud/public/viewer/
└── viewer.js                  # MODIFY: replace unreachable fileUrl render branch with fileDataUrl branch (image / pdf dispatch by metadata.contentType)
```

### Docs

```
README.md                      # (no change needed — feature wasn't in any user-facing docs)
docs/superpowers/plans/2026-04-20-v2-image-pdf-share-fix.md  # THIS FILE
```

---

## Snapshot payload shape

After this fix, image and PDF share snapshots uploaded to the cloud carry this shape (delivered to the cloud's `POST /api/share` in the `snapshot` field):

```js
{
  fileDataUrl: "data:image/png;base64,...",   // or "data:application/pdf;base64,..."
  mimeType: "image/png",                        // redundant with the data URL prefix but kept for convenience
  capturedAt: "2026-04-20T09:30:00.000Z",
  frankVersion: "2"
}
```

**Design choices:**
- **Inline data URL, not external URL.** The daemon's `/files/` route is only reachable from `localhost:42068`; a reviewer's browser on the cloud viewer can't resolve it. Inlining is the only path that works without introducing cloud-side file storage as a separate endpoint.
- **Same shape for image and PDF.** Cloud viewer disambiguates via `metadata.contentType` (already returned by `GET /api/share` — see `frank-cloud/api/share.ts`'s existing GET branch).
- **`fileDataUrl`, not the previous `fileUrl`.** The old cloud-viewer branch expected a URL; it was never reachable because nothing built that shape. Renaming the field makes it explicit that this is a data URL and avoids any conflation with a hypothetical blob-URL feature. The unreachable `fileUrl` branch gets removed, not preserved.

**Out of scope for this fix:**
- Cloud-side file storage for large shares (images >1 MB base64-encoded hit the 1 MB `FRANK_STATE_MAX_BYTES` cap on v3 live share, but for v2 static shares the cap doesn't apply — the payload flows through `POST /api/share` which uses Vercel Blob directly).
- PDF thumbnail/cover image generation.
- Sensitive-content detection for images (the existing `detectSensitiveContent` regex-scans HTML and won't meaningfully apply to base64 data URLs).

---

## Task 1: `buildMediaFileSnapshot` helper

Add a plain helper that fetches the source file from the daemon's `/files/` route, converts it to a data URL, and returns the snapshot shape. Used by image and PDF project types.

**Files:**
- Modify: `ui-v2/overlay/snapshot.js`

- [ ] **Step 1: Read the current state of `ui-v2/overlay/snapshot.js`**

```bash
cat /Users/carlostarrats/Documents/frank/ui-v2/overlay/snapshot.js
```

Familiarize yourself with the existing `captureSnapshot` + `detectSensitiveContent` exports. The new helper goes at the bottom of the file, same module style.

- [ ] **Step 2: Append `buildMediaFileSnapshot`**

At the end of `ui-v2/overlay/snapshot.js`, append:

```js
// Builds a share snapshot for image/PDF project types — fetches the source
// file from the daemon's /files/ route (same-origin, so this works) and
// inlines it as a data URL. Returns null on failure.
export async function buildMediaFileSnapshot(filePath) {
  try {
    const res = await fetch(`/files/${encodeURIComponent(filePath)}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mimeType = blob.type || 'application/octet-stream';
    const fileDataUrl = await blobToDataUrl(blob);
    return {
      fileDataUrl,
      mimeType,
      capturedAt: new Date().toISOString(),
      frankVersion: '2',
    };
  } catch (e) {
    console.error('[snapshot] buildMediaFileSnapshot failed:', e);
    return null;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Read failed'));
    reader.readAsDataURL(blob);
  });
}
```

- [ ] **Step 3: Verify the file parses**

```bash
node --check /Users/carlostarrats/Documents/frank/ui-v2/overlay/snapshot.js
```

Expected: no output (valid JS).

- [ ] **Step 4: Commit**

```bash
cd /Users/carlostarrats/Documents/frank && git add ui-v2/overlay/snapshot.js && git commit -m "$(cat <<'EOF'
feat(ui): buildMediaFileSnapshot helper for image/PDF share snapshots

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Viewer share handler branches by contentType

Replace the iframe-only assumption with a type-aware dispatcher. URL projects keep the existing `captureSnapshot` path. Image and PDF call the new `buildMediaFileSnapshot`.

**Files:**
- Modify: `ui-v2/views/viewer.js`

- [ ] **Step 1: Read the current share handler IN FULL**

This step is not optional — the handler may have diverged from what this plan assumes. Before editing, read `ui-v2/views/viewer.js` lines 115–163 and note:
- What the success path sets on `project.activeShare` (v3 Phase 1 added a `live?` subfield to `ActiveShare` in `daemon/src/protocol.ts`, but the UI-side initialization in this handler may still use the v2 shape — confirm before editing).
- Whether any live-share stop/cleanup logic was added since (shouldn't be — Phases 1 and 2 added logic to `share-popover.js`, not this handler — but verify by grepping for `live-share|liveShare|stopLive` in the current handler body).
- The exact variable names used (`project`, `result`, `e.detail.coverNote`).

Read command:

```bash
sed -n '115,163p' /Users/carlostarrats/Documents/frank/ui-v2/views/viewer.js
```

- [ ] **Step 2: Add `buildMediaFileSnapshot` to the existing imports**

Find the existing import from `'../overlay/snapshot.js'`:

```js
import { captureSnapshot, detectSensitiveContent } from '../overlay/snapshot.js';
```

Replace with:

```js
import { captureSnapshot, detectSensitiveContent, buildMediaFileSnapshot } from '../overlay/snapshot.js';
```

- [ ] **Step 3: Surgical edit — replace ONLY the snapshot-building section of the handler**

This is a targeted edit, NOT a full-handler rewrite. The goal is to swap out the iframe-only snapshot construction while preserving every other line of the handler verbatim (sensitive-content check, try/catch, `sync.uploadShare` call, success path that sets `project.activeShare = {...}`, error handling). That way, any v3 additions to the success path that this plan wasn't aware of stay intact.

Find this block near the top of the handler (approximately lines 117–124 — the early-return + `captureSnapshot` call):

```js
    const iframe = document.querySelector('#content-iframe');
    if (!iframe) return;

    const snapshot = await captureSnapshot(iframe);
    if (!snapshot) {
      updateSharePopover({ error: 'Could not capture snapshot' });
      return;
    }
```

Replace ONLY that block with:

```js
    const project = projectManager.get();
    if (!project) {
      updateSharePopover({ error: 'No project loaded' });
      return;
    }

    let snapshot = null;
    if (project.contentType === 'url') {
      const iframe = document.querySelector('#content-iframe');
      if (!iframe) {
        updateSharePopover({ error: 'No content to capture' });
        return;
      }
      snapshot = await captureSnapshot(iframe);
    } else if (project.contentType === 'image' || project.contentType === 'pdf') {
      if (!project.file) {
        updateSharePopover({ error: 'Project has no file' });
        return;
      }
      snapshot = await buildMediaFileSnapshot(project.file);
    } else {
      updateSharePopover({ error: `Unsupported project type: ${project.contentType}` });
      return;
    }

    if (!snapshot) {
      updateSharePopover({ error: 'Could not build snapshot' });
      return;
    }

    // Pre-upload size check for data-URL payloads. Vercel Hobby's function
    // body limit is ~5 MB; the payload gets JSON-wrapped with cover note +
    // metadata. A 4 MB ceiling on fileDataUrl leaves comfortable headroom
    // and surfaces a user-friendly error instead of letting the upload fail
    // with a cryptic network error.
    const DATA_URL_CEILING = 4 * 1024 * 1024;
    if (snapshot.fileDataUrl && snapshot.fileDataUrl.length > DATA_URL_CEILING) {
      updateSharePopover({ error: 'File is too large to share directly. Resize or compress before sharing.' });
      return;
    }
```

**Important:** do NOT rewrite the lines AFTER that block. The sensitive-content check, the `try { const result = await sync.uploadShare(...) }` block, the success path that sets `project.activeShare = {...}`, and the catch block should all stay exactly as they are in the current file.

One small tweak is needed in the sensitive-content check to avoid false positives on data URLs. Find this block (approximately lines 127–134):

```js
    // Check for sensitive content
    const warnings = detectSensitiveContent(snapshot.html);
    if (warnings.length > 0) {
      const proceed = confirm(`Warning: ${warnings.join(', ')}. Share anyway?`);
      if (!proceed) {
        updateSharePopover({ error: 'Cancelled' });
        return;
      }
    }
```

Replace with (guards the scan on `snapshot.html` existing — data URL snapshots won't have it):

```js
    // Check for sensitive content (URL snapshots only — data URLs are opaque
    // base64 and would false-positive on almost any image's byte pattern).
    if (snapshot.html) {
      const warnings = detectSensitiveContent(snapshot.html);
      if (warnings.length > 0) {
        const proceed = confirm(`Warning: ${warnings.join(', ')}. Share anyway?`);
        if (!proceed) {
          updateSharePopover({ error: 'Cancelled' });
          return;
        }
      }
    }
```

And the `uploadShare` call — if the current code passes `projectManager.get()?.contentType || 'url'` as the contentType argument, leave it alone (it'll resolve to `project.contentType` correctly since we loaded `project` above). If the current code passes literal `'url'`, change it to `project.contentType`. Verify from the Step 1 read.

Summary of the changes:
- Snapshot-building section: iframe-only → type-aware dispatcher with builders per type.
- Size check: new — 4 MB ceiling with a user-friendly error.
- Sensitive-content check: guarded on `snapshot.html` presence.
- Everything else in the handler: untouched.

- [ ] **Step 4: Verify viewer.js parses**

```bash
node --check /Users/carlostarrats/Documents/frank/ui-v2/views/viewer.js
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
cd /Users/carlostarrats/Documents/frank && git add ui-v2/views/viewer.js && git commit -m "$(cat <<'EOF'
fix(ui): viewer share handler dispatches by contentType (image/PDF now work)

URL projects keep the existing captureSnapshot path. Image and PDF call the
new buildMediaFileSnapshot helper to fetch the source file from the daemon
and inline it as a data URL. Every failure path now calls updateSharePopover
so the share popover can't sit on "Capturing snapshot..." forever.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Share popover timeout on "Capturing snapshot..."

Even with Task 2's fix, the handler could still silently hang (network glitch, daemon disconnect, a future project type shipping without a handler branch). Add a 15-second visible timeout so the user always gets feedback.

**Files:**
- Modify: `ui-v2/components/share-popover.js`

- [ ] **Step 1: Read the current share-popover**

Look at `ui-v2/components/share-popover.js`, specifically the `share-create` button handler (around line 134) that sets `statusEl.textContent = 'Capturing snapshot...'` and dispatches `frank:capture-snapshot`. Also look at `updateSharePopover` (around line 155), which is the entry point for both success and error feedback from the handler.

- [ ] **Step 2: Add timeout tracking at module scope**

Near the top of the file (outside any function, with the other module-level state if any), add:

```js
// Tracks the current "Capturing snapshot..." state. `captureInProgress` is
// a flag (not a string comparison on textContent — that would break if any
// other code path changes the status text's whitespace, adds a spinner
// character, or localizes the string). `captureTimeoutId` is the pending
// defensive timeout. Both are cleared by updateSharePopover when a real
// response arrives. Only one share-create flow runs at a time; a Map would
// be overkill.
let captureInProgress = false;
let captureTimeoutId = null;
```

- [ ] **Step 3: Set the timeout when share-create is clicked**

Find the existing `share-create` click handler:

```js
  modal.querySelector('#share-create').addEventListener('click', async () => {
    const statusEl = modal.querySelector('#share-status');
    const coverNote = modal.querySelector('#share-note').value.trim();
    statusEl.textContent = 'Capturing snapshot...';

    const event = new CustomEvent('frank:capture-snapshot', { detail: { coverNote } });
    window.dispatchEvent(event);
  });
```

Replace with (adds the timeout, using a boolean flag instead of a string comparison):

```js
  modal.querySelector('#share-create').addEventListener('click', async () => {
    const statusEl = modal.querySelector('#share-status');
    const coverNote = modal.querySelector('#share-note').value.trim();
    statusEl.textContent = 'Capturing snapshot...';
    statusEl.style.color = '';  // reset any previous error color

    // Defensive timeout. If no snapshot result arrives within 15 seconds,
    // flip to a visible error so the user knows something went wrong instead
    // of staring at a spinner indefinitely. Uses a boolean flag — NOT a string
    // comparison on textContent — so future status-text changes (spinners,
    // whitespace, localization) don't silently break the check.
    if (captureTimeoutId) clearTimeout(captureTimeoutId);
    captureInProgress = true;
    captureTimeoutId = setTimeout(() => {
      captureTimeoutId = null;
      if (captureInProgress) {
        captureInProgress = false;
        statusEl.textContent = 'Snapshot capture failed — please report this';
        statusEl.style.color = '#ff4a4a';
      }
    }, 15_000);

    const event = new CustomEvent('frank:capture-snapshot', { detail: { coverNote } });
    window.dispatchEvent(event);
  });
```

- [ ] **Step 4: Cancel the timeout when `updateSharePopover` runs**

Find the `updateSharePopover` function (around line 155). At the very start of the function body, before any other logic, add:

```js
  // We have a real response — cancel the defensive timeout and clear the flag.
  captureInProgress = false;
  if (captureTimeoutId) { clearTimeout(captureTimeoutId); captureTimeoutId = null; }
```

The function should now start:

```js
export function updateSharePopover(result) {
  captureInProgress = false;
  if (captureTimeoutId) { clearTimeout(captureTimeoutId); captureTimeoutId = null; }
  const modal = document.querySelector('.share-modal');
  if (!modal) return;
  // ... rest unchanged
```

- [ ] **Step 5: Verify share-popover.js parses**

```bash
node --check /Users/carlostarrats/Documents/frank/ui-v2/components/share-popover.js
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd /Users/carlostarrats/Documents/frank && git add ui-v2/components/share-popover.js && git commit -m "$(cat <<'EOF'
feat(ui): 15s timeout on "Capturing snapshot..." share state

Defensive UX for silent-failure bugs. If no snapshot response arrives in 15s,
the popover flips to "Snapshot capture failed — please report this" so the
user has a visible escape hatch instead of an infinite spinner.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Cloud viewer renders from `fileDataUrl`

Replace the unreachable `fileUrl` render branch with a working `fileDataUrl` branch. The existing `metadata.contentType` image/iframe dispatch is preserved.

**Files:**
- Modify: `frank-cloud/public/viewer/viewer.js`

- [ ] **Step 1: Locate the existing content-render block**

In `frank-cloud/public/viewer/viewer.js`, find the block that runs after the snapshot is fetched from `GET /api/share`. Look for the chain of `if/else if` branches checking `snapshot?.canvasState` / `snapshot?.html` / `snapshot?.fileUrl` (starting around line 68).

- [ ] **Step 2: Replace the `fileUrl` branch with a `fileDataUrl` branch**

Find this block:

```js
  } else if (snapshot?.fileUrl) {
    if (metadata.contentType === 'image') {
      contentEl.innerHTML = `<img src="${esc(snapshot.fileUrl)}" class="v-image" alt="Shared content">`;
    } else {
      contentEl.innerHTML = `<iframe src="${esc(snapshot.fileUrl)}" class="v-iframe"></iframe>`;
    }
  } else {
```

Replace with:

```js
  } else if (snapshot?.fileDataUrl) {
    if (metadata.contentType === 'image') {
      contentEl.innerHTML = `<img src="${esc(snapshot.fileDataUrl)}" class="v-image" alt="Shared content">`;
    } else if (metadata.contentType === 'pdf') {
      contentEl.innerHTML = `<iframe src="${esc(snapshot.fileDataUrl)}" class="v-iframe"></iframe>`;
    } else {
      contentEl.innerHTML = '<div class="v-error"><p>Unsupported content type</p></div>';
    }
  } else {
```

Changes:
- `fileUrl` → `fileDataUrl` (the field the new v2 builder actually produces).
- `metadata.contentType === 'image'` stays as the branch condition — `GET /api/share` already returns `contentType` in the metadata response.
- PDF branch now explicit; previously was the `else` fallback for anything not-image. An unknown `contentType` now renders a clear error rather than a silently-broken iframe.

- [ ] **Step 3: Verify viewer.js parses**

```bash
node --check /Users/carlostarrats/Documents/frank/frank-cloud/public/viewer/viewer.js
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd /Users/carlostarrats/Documents/frank && git add frank-cloud/public/viewer/viewer.js && git commit -m "$(cat <<'EOF'
fix(cloud-viewer): render image/PDF shares from fileDataUrl inline data

Replaces the unreachable fileUrl branch (which was never written into by
the v2 share flow) with a working fileDataUrl branch that renders the new
inline-data snapshot shape. Unknown contentType now surfaces a visible error
instead of a silently-broken iframe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Smoke test + cleanup note

No unit tests — UI code isn't under Vitest. Validation is a manual end-to-end smoke test. Also includes a note about pre-existing broken shares in users' storage that should be cleaned up.

**Files:**
- No source files modified. Smoke test is manual.
- Modify: `frank-cloud/README.md` (add the cleanup note)

- [ ] **Step 1: Run the smoke test**

No commits for this step — just verify end-to-end.

Requires a configured cloud backend (`vercel dev` locally or a real deployment with Upstash Redis + Blob linked).

```bash
# 1. Start the daemon.
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
frank start

# 2. In another terminal, start cloud backend.
cd /Users/carlostarrats/Documents/frank/frank-cloud && npx vercel dev
```

**Image project path:**
1. At `localhost:42068`, create a new project. Drag an image file (PNG or JPG) onto the project-creation UI. Project type should be set to `image`.
2. Open the project. Click the image to add a pin/comment. Confirm the pin renders and the comment persists.
3. Click the Share button. Confirm the share modal opens.
4. Type a cover note. Click "Create".
5. Status should flip from "Capturing snapshot..." to the generated share URL within a second or two.
6. Open the share URL in a new incognito window. Confirm:
   - The image renders (not an empty iframe, not a broken image icon).
   - The author's pin is visible on the image.
   - You can add a comment from the reviewer side.

**PDF project path:**
1. Same flow, with a PDF file (small — keep it under 1 MB base64-encoded for this smoke test). Multi-page PDFs OK.
2. Add a comment on page 1 via the pin tool.
3. Share. Confirm the share URL opens and renders the PDF in an iframe with the page navigation working.
4. Navigate to page 2. Add a comment from the reviewer side. Confirm it syncs back.
5. Open the same share URL in at least one second browser (Chrome + Firefox, or Chrome + Safari). PDF-in-iframe rendering and page-navigation UI vary across browsers — catch any cross-browser oddity here rather than post-merge.

**Size-ceiling path:**
1. Try sharing an image larger than 4 MB (a full-quality phone photo, or a large PNG).
2. Confirm the popover shows "File is too large to share directly. Resize or compress before sharing." instead of a cryptic network error.
3. Try sharing a smaller image (under 4 MB). Confirm it succeeds normally.

**Timeout path:**
1. With DevTools open and the network tab set to "Offline" (or block requests to `/files/`), try sharing an image project.
2. After 15 seconds, confirm the status text flips to "Snapshot capture failed — please report this" in red.
3. Re-enable network, click "Create" again. The second attempt should succeed — the timeout cleanup runs correctly.

If any smoke-test step fails, inspect the daemon logs and the browser console. Common issues:
- Image too large for base64 — typical phone photos are 3–5 MB raw, which is ~4–7 MB base64. That's fine for v2 static share (no 1 MB cap), but if you're hitting something try a smaller image.
- CORS: `/files/` is same-origin with the daemon, so `fetch` should always work. If it doesn't, check the daemon's HTTP route.

- [ ] **Step 2: Add a forward-looking note to `frank-cloud/README.md`**

This note exists for future adopters of `frank-cloud` who may have tested
PDF sharing on an early `frank-cloud` deployment and stored broken
snapshots without realizing. Frank doesn't have users yet, so in practice
there's probably nothing to clean up in any current deployment — but
leaving the documentation in place means anyone who does discover this
post-deployment has a clear path.

Append this section at the bottom of `frank-cloud/README.md`:

```markdown
## Known issue with pre-fix PDF shares

If you deployed `frank-cloud` before April 2026 and created any PDF shares
during that window, the snapshots stored in your Vercel Blob contain the
browser's PDF-viewer chrome HTML rather than the actual PDF bytes. These
shares will render as empty iframes on the cloud viewer.

To clean up: open the Vercel Blob dashboard, find blobs under the prefix
`shares/*/snapshot.json` where the share's `meta.json` has
`contentType: "pdf"`, and delete them. Users with those share URLs will
see the standard "not found" error; they can ask the author to re-create
the share.

Image shares created before this fix were never functional — the capture
flow hung on "Capturing snapshot..." and nothing ever reached your backend,
so there's nothing to clean up for image shares specifically.
```

- [ ] **Step 3: Commit the cleanup note**

```bash
cd /Users/carlostarrats/Documents/frank && git add frank-cloud/README.md && git commit -m "$(cat <<'EOF'
docs(cloud): note pre-v3 PDF shares need manual cleanup from Blob storage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist

Before declaring this fix merged and ready for Phase 3:

- [ ] Image project share → confirmed working in smoke test
- [ ] PDF project share → confirmed working in smoke test (PDF actually renders in the iframe, not empty)
- [ ] URL project share → still works (regression check — the rewritten handler still calls `captureSnapshot` for URL projects)
- [ ] Canvas project share → still works (canvas has its own handler in `canvas.js`, untouched by this plan)
- [ ] 15s timeout behavior verified by forcing an offline state
- [ ] Size-ceiling error verified with a >4 MB image
- [ ] All four commits carry canonical trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- [ ] **Enforced: no daemon changes committed.** Run `git diff --stat dev-v2.08..HEAD -- daemon/` from the main tree — must return empty output. This plan is UI + cloud-viewer only; any daemon touch is a mistake.

---

## What's NOT in this fix (flagged for future work)

- **Sensitive-content detection for images.** The existing `detectSensitiveContent` regex-scans HTML text. For image data URLs it would never find a meaningful match (base64 is opaque). No attempt is made to OCR image content — that's a much larger product question.
- **PDF page navigation sync.** The reviewer's cloud viewer shows the PDF in a standard browser PDF viewer; page-switching is local to that viewer. v3 Phase 4 adds page + scroll sync for PDF live share.
- **Cover image / preview thumbnail.** Canvas shares have a `preview` PNG for the share page. Image shares could use the image itself as a preview, and PDFs could render page 1 as a preview thumbnail — but this plan doesn't do either. The cloud viewer is the first place the recipient sees the content; a cover thumbnail is a nice-to-have for share-landing pages but not a regression fix.
- **Large-file handling.** A 20 MB RAW photo as a data URL is ~27 MB. Vercel Blob accepts it fine, but `POST /api/share` pipelines the whole JSON through a serverless function with a 5 MB request body limit on Hobby. If users hit this, the fix is documented (recommend scaling the image before import) or a v3.x scope (direct-to-Blob upload instead of daemon-proxy).
- **UX polish: share-popover feedback during "Uploading to cloud...".** The current popover stays on "Capturing snapshot..." through the `uploadShare` phase too; it should split into "Capturing…" then "Uploading…" for clarity. Minor — a separate UX ticket.

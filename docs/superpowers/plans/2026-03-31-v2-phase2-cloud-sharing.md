# v2 Phase 2 — Cloud Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cloud sharing so users can share content via real internet links, reviewers can comment in the browser, and comments sync back to the local project.

**Architecture:** Two parts: (1) `frank-cloud/` — a deployable Vercel project with serverless API functions + Blob storage + share viewer page. (2) Daemon + UI updates — DOM snapshot capture, share upload, comment sync polling, share popover in toolbar, `frank connect` command.

**Tech Stack:** Vercel serverless functions (TypeScript), Vercel Blob storage, plain JS share viewer, Node.js daemon additions.

**Spec:** `docs/superpowers/specs/2026-03-31-v2-collaboration-layer-design.md` — Sections 5, 8, 9

**Depends on:** Phase 1 (complete)

---

## File Structure

### Frank Cloud (new deployable Vercel project)

```
frank-cloud/
├── api/
│   ├── share.ts          # POST: upload snapshot, GET: fetch share by ID
│   ├── comment.ts        # POST: add reviewer comment
│   └── health.ts         # GET: connection health check
├── public/
│   └── viewer/
│       ├── index.html    # Share viewer page
│       ├── viewer.js     # Fetches snapshot, renders, commenting overlay
│       └── viewer.css    # Viewer styles
├── vercel.json           # Routes, headers, CORS, security
├── package.json
├── tsconfig.json
└── README.md             # Deploy guide with security checklist
```

### Daemon additions

```
daemon/src/
├── cloud.ts              # CREATE: cloud client — upload shares, poll comments
├── snapshot.ts           # CREATE: DOM snapshot receiver — saves snapshots from browser
├── server.ts             # MODIFY: add share/snapshot WebSocket handlers, comment sync loop
├── protocol.ts           # MODIFY: add share/snapshot message types
├── cli.ts                # MODIFY: implement `frank connect` and `frank status`
└── projects.ts           # MODIFY: add cloud comment merge
```

### UI additions

```
ui-v2/
├── components/
│   ├── share-popover.js  # CREATE: share popover (cover note, create link, copy)
│   └── toolbar.js        # MODIFY: enable Share button, wire popover
├── overlay/
│   └── snapshot.js       # CREATE: captures DOM + inlines styles for sharing
└── views/
    └── viewer.js         # MODIFY: add snapshot trigger on share
```

---

## Task 1: Create frank-cloud Vercel project — API functions

Create the deployable Vercel project with the three API endpoints.

**Files:**
- Create: `frank-cloud/package.json`
- Create: `frank-cloud/tsconfig.json`
- Create: `frank-cloud/vercel.json`
- Create: `frank-cloud/api/health.ts`
- Create: `frank-cloud/api/share.ts`
- Create: `frank-cloud/api/comment.ts`

- [ ] **Step 1: Create frank-cloud directory**

```bash
mkdir -p /Users/carlostarrats/Documents/frank/frank-cloud/api
mkdir -p /Users/carlostarrats/Documents/frank/frank-cloud/public/viewer
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "frank-cloud",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "@vercel/blob": "^0.27.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": ".vercel/output",
    "skipLibCheck": true
  },
  "include": ["api/**/*.ts"]
}
```

- [ ] **Step 4: Create vercel.json**

```json
{
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET, POST, OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Content-Type, Authorization" }
      ]
    },
    {
      "source": "/viewer/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "default-src 'self' 'unsafe-inline' blob: data:; img-src * data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" }
      ]
    }
  ],
  "rewrites": [
    { "source": "/s/:id", "destination": "/viewer/index.html" }
  ]
}
```

- [ ] **Step 5: Create api/health.ts**

```ts
export const config = { runtime: 'edge' };

export default function handler(req: Request): Response {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  // Verify API key
  const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '');
  const expectedKey = process.env.FRANK_API_KEY;

  if (!expectedKey) {
    return Response.json({ status: 'error', message: 'FRANK_API_KEY not configured' }, { status: 500 });
  }

  if (apiKey !== expectedKey) {
    return Response.json({ status: 'error', message: 'Invalid API key' }, { status: 401 });
  }

  return Response.json({ status: 'ok', version: '2' });
}
```

- [ ] **Step 6: Create api/share.ts**

```ts
import { put, list, del } from '@vercel/blob';
import crypto from 'crypto';

export const config = { runtime: 'nodejs', maxDuration: 30 };

function generateId(): string {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  // GET /api/share?id=xxx — public (reviewers)
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const shareId = url.searchParams.get('id');
    if (!shareId || !/^[a-zA-Z0-9_-]{8,20}$/.test(shareId)) {
      return Response.json({ error: 'Invalid share ID' }, { status: 400 });
    }

    try {
      // Fetch meta
      const metaBlob = await fetchBlob(`shares/${shareId}/meta.json`);
      if (!metaBlob) {
        return Response.json({ error: 'not found' }, { status: 404 });
      }
      const meta = JSON.parse(metaBlob);

      // Check expiry
      if (new Date(meta.expiresAt) < new Date()) {
        return Response.json({
          error: 'expired',
          message: 'This has been updated. Ask the owner for the new link.',
        }, { status: 410 });
      }

      // Fetch snapshot
      const snapshotBlob = await fetchBlob(`shares/${shareId}/snapshot.json`);
      const snapshot = snapshotBlob ? JSON.parse(snapshotBlob) : null;

      // Fetch comments
      const commentBlobs = await list({ prefix: `shares/${shareId}/comments/` });
      const comments = [];
      for (const blob of commentBlobs.blobs) {
        try {
          const res = await fetch(blob.url);
          comments.push(JSON.parse(await res.text()));
        } catch { /* skip corrupt */ }
      }

      // Log view
      meta.viewCount = (meta.viewCount || 0) + 1;
      meta.lastViewedAt = new Date().toISOString();
      await put(`shares/${shareId}/meta.json`, JSON.stringify(meta), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });

      return Response.json({
        snapshot,
        comments: comments.sort((a: any, b: any) => a.ts.localeCompare(b.ts)),
        coverNote: meta.coverNote || '',
        metadata: {
          createdAt: meta.createdAt,
          expiresAt: meta.expiresAt,
          viewCount: meta.viewCount,
          contentType: meta.contentType || 'url',
        },
      });
    } catch (e: any) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // POST /api/share — authenticated (daemon)
  if (req.method === 'POST') {
    const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (apiKey !== process.env.FRANK_API_KEY) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const body = await req.json();
      const { snapshot, coverNote, contentType, expiryDays, oldShareId, oldRevokeToken } = body;

      if (!snapshot) {
        return Response.json({ error: 'Missing snapshot' }, { status: 400 });
      }

      // Revoke old share if provided
      if (oldShareId && oldRevokeToken) {
        try {
          const oldMetaBlob = await fetchBlob(`shares/${oldShareId}/meta.json`);
          if (oldMetaBlob) {
            const oldMeta = JSON.parse(oldMetaBlob);
            if (oldMeta.revokeToken === oldRevokeToken) {
              oldMeta.expiresAt = new Date(0).toISOString(); // Expire immediately
              await put(`shares/${oldShareId}/meta.json`, JSON.stringify(oldMeta), {
                access: 'public',
                contentType: 'application/json',
                addRandomSuffix: false,
              });
            }
          }
        } catch { /* old share cleanup is best-effort */ }
      }

      const shareId = generateId();
      const revokeToken = generateId();
      const now = new Date();
      const days = expiryDays || 7;

      const meta = {
        shareId,
        revokeToken,
        coverNote: coverNote || '',
        contentType: contentType || 'url',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
        viewCount: 0,
      };

      // Upload meta
      await put(`shares/${shareId}/meta.json`, JSON.stringify(meta), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });

      // Upload snapshot
      await put(`shares/${shareId}/snapshot.json`, JSON.stringify(snapshot), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });

      return Response.json({
        shareId,
        revokeToken,
        url: `/s/${shareId}`,
      });
    } catch (e: any) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}

async function fetchBlob(key: string): Promise<string | null> {
  try {
    const blobs = await list({ prefix: key });
    if (blobs.blobs.length === 0) return null;
    const res = await fetch(blobs.blobs[0].url);
    return await res.text();
  } catch {
    return null;
  }
}
```

- [ ] **Step 7: Create api/comment.ts**

```ts
import { put, list } from '@vercel/blob';
import crypto from 'crypto';

export const config = { runtime: 'nodejs' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { shareId, screenId, anchor, author, text } = body;

    // Validate inputs
    if (!shareId || !/^[a-zA-Z0-9_-]{8,20}$/.test(shareId)) {
      return Response.json({ error: 'Invalid share ID' }, { status: 400 });
    }
    if (!text || typeof text !== 'string') {
      return Response.json({ error: 'Missing comment text' }, { status: 400 });
    }
    if (text.length > 2000) {
      return Response.json({ error: 'Comment too long (max 2000 chars)' }, { status: 400 });
    }
    if (!author || typeof author !== 'string' || author.length > 100) {
      return Response.json({ error: 'Invalid author' }, { status: 400 });
    }

    // Verify share exists and isn't expired
    const metaBlobs = await list({ prefix: `shares/${shareId}/meta.json` });
    if (metaBlobs.blobs.length === 0) {
      return Response.json({ error: 'Share not found' }, { status: 404 });
    }
    const metaRes = await fetch(metaBlobs.blobs[0].url);
    const meta = JSON.parse(await metaRes.text());

    if (new Date(meta.expiresAt) < new Date()) {
      return Response.json({ error: 'Share expired' }, { status: 410 });
    }

    // Check comment count (max 100)
    const existingComments = await list({ prefix: `shares/${shareId}/comments/` });
    if (existingComments.blobs.length >= 100) {
      return Response.json({ error: 'Max comments reached (100)' }, { status: 429 });
    }

    // Create comment
    const commentId = 'c-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
    const comment = {
      id: commentId,
      shareId,
      screenId: screenId || 'default',
      anchor: anchor || { type: 'pin', x: 50, y: 50 },
      author: author.slice(0, 100),
      text: text.slice(0, 2000),
      ts: new Date().toISOString(),
    };

    await put(`shares/${shareId}/comments/${commentId}.json`, JSON.stringify(comment), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
    });

    return Response.json({ comment });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
```

- [ ] **Step 8: Install dependencies**

```bash
cd /Users/carlostarrats/Documents/frank/frank-cloud && npm install
```

- [ ] **Step 9: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add frank-cloud/
git commit -m "feat(cloud): frank-cloud Vercel project — share, comment, and health API endpoints"
```

---

## Task 2: Create share viewer page

The static page that renders shared content for reviewers.

**Files:**
- Create: `frank-cloud/public/viewer/index.html`
- Create: `frank-cloud/public/viewer/viewer.js`
- Create: `frank-cloud/public/viewer/viewer.css`

- [ ] **Step 1: Create viewer/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Frank — Shared Content</title>
  <link rel="stylesheet" href="viewer.css">
</head>
<body>
  <div id="viewer-app">
    <div class="viewer-loading">Loading...</div>
  </div>
  <script type="module" src="viewer.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create viewer/viewer.js**

```js
// viewer.js — Share viewer: fetches snapshot, renders content, commenting for reviewers

const shareId = window.location.pathname.split('/s/')[1] || new URLSearchParams(window.location.search).get('id');

async function init() {
  const app = document.getElementById('viewer-app');
  if (!shareId) {
    app.innerHTML = '<div class="v-error"><h2>No share ID</h2><p>Check the URL and try again.</p></div>';
    return;
  }

  try {
    const res = await fetch(`/api/share?id=${encodeURIComponent(shareId)}`);
    const data = await res.json();

    if (data.error) {
      const title = data.error === 'expired' ? 'Link Expired' : 'Not Found';
      const msg = data.message || "This link doesn't exist.";
      app.innerHTML = `<div class="v-error"><h2>${title}</h2><p>${esc(msg)}</p></div>`;
      return;
    }

    renderViewer(app, data);
  } catch (e) {
    app.innerHTML = '<div class="v-error"><h2>Unable to load</h2><p>Check your connection and refresh.</p></div>';
  }
}

function renderViewer(app, data) {
  const { snapshot, comments, coverNote, metadata } = data;

  app.innerHTML = `
    ${coverNote ? `
      <div class="v-toast" id="v-toast">
        <div class="v-toast-inner">
          <span>${esc(coverNote)}</span>
          <button class="v-toast-close" id="toast-close">&times;</button>
        </div>
      </div>
    ` : ''}
    <div class="v-main">
      <div class="v-content" id="v-content"></div>
      <div class="v-sidebar" id="v-sidebar">
        <div class="v-sidebar-header">
          <h3>Comments (${comments.length})</h3>
          <button class="v-btn" id="v-add-comment">+ Comment</button>
        </div>
        <div class="v-comments" id="v-comments"></div>
        <div class="v-comment-form" id="v-comment-form" style="display:none">
          <input type="text" class="v-input" id="v-author" placeholder="Your name" value="${getAuthor()}">
          <textarea class="v-input v-textarea" id="v-comment-text" placeholder="Add a comment..." rows="3"></textarea>
          <div class="v-prompts">
            <button class="v-prompt" data-text="How does this feel?">How does this feel?</button>
            <button class="v-prompt" data-text="What's missing?">What's missing?</button>
            <button class="v-prompt" data-text="What would you change?">What would you change?</button>
          </div>
          <div class="v-form-actions">
            <button class="v-btn v-btn-ghost" id="v-cancel">Cancel</button>
            <button class="v-btn v-btn-primary" id="v-submit">Comment</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render content
  const contentEl = document.getElementById('v-content');
  if (snapshot?.html) {
    const iframe = document.createElement('iframe');
    iframe.className = 'v-iframe';
    iframe.sandbox = 'allow-same-origin';
    iframe.srcdoc = snapshot.html;
    contentEl.appendChild(iframe);
  } else if (snapshot?.fileUrl) {
    if (metadata.contentType === 'image') {
      contentEl.innerHTML = `<img src="${esc(snapshot.fileUrl)}" class="v-image" alt="Shared content">`;
    } else {
      contentEl.innerHTML = `<iframe src="${esc(snapshot.fileUrl)}" class="v-iframe"></iframe>`;
    }
  } else {
    contentEl.innerHTML = '<div class="v-error"><p>No content in this share</p></div>';
  }

  // Render comments
  renderCommentList(comments);

  // Toast
  document.getElementById('toast-close')?.addEventListener('click', () => {
    document.getElementById('v-toast')?.remove();
  });

  // Comment form
  const form = document.getElementById('v-comment-form');
  document.getElementById('v-add-comment')?.addEventListener('click', () => {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('v-cancel')?.addEventListener('click', () => {
    form.style.display = 'none';
  });

  // Guided prompts
  document.querySelectorAll('.v-prompt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('v-comment-text').value = btn.dataset.text;
    });
  });

  // Submit comment
  document.getElementById('v-submit')?.addEventListener('click', async () => {
    const author = document.getElementById('v-author').value.trim();
    const text = document.getElementById('v-comment-text').value.trim();
    if (!author || !text) return;

    saveAuthor(author);
    try {
      const res = await fetch('/api/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareId, screenId: 'default', author, text }),
      });
      const data = await res.json();
      if (data.comment) {
        comments.push(data.comment);
        renderCommentList(comments);
        document.getElementById('v-comment-text').value = '';
        form.style.display = 'none';
      }
    } catch (e) {
      console.error('Failed to submit comment:', e);
    }
  });
}

function renderCommentList(comments) {
  const el = document.getElementById('v-comments');
  if (!el) return;
  if (comments.length === 0) {
    el.innerHTML = '<p class="v-empty">No comments yet</p>';
    return;
  }
  el.innerHTML = comments.map(c => `
    <div class="v-comment">
      <div class="v-comment-head">
        <strong>${esc(c.author)}</strong>
        <span class="v-comment-time">${timeAgo(c.ts)}</span>
      </div>
      <p>${esc(c.text)}</p>
    </div>
  `).join('');
}

function getAuthor() { return localStorage.getItem('frank-author') || ''; }
function saveAuthor(name) { localStorage.setItem('frank-author', name); }

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text || '';
  return d.innerHTML;
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

init();
```

- [ ] **Step 3: Create viewer/viewer.css**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0d0d0d; color: #e8e8e8; height: 100vh; overflow: hidden; }
#viewer-app { height: 100vh; display: flex; flex-direction: column; }

.viewer-loading { display: flex; align-items: center; justify-content: center; height: 100vh; color: #888; }

.v-error { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; text-align: center; gap: 8px; }
.v-error h2 { color: #e8e8e8; }
.v-error p { color: #888; }

.v-toast { padding: 12px 16px; background: #1a1a2e; border-bottom: 1px solid #333; }
.v-toast-inner { display: flex; align-items: center; justify-content: space-between; max-width: 960px; margin: 0 auto; font-size: 14px; color: #aaa; }
.v-toast-close { background: none; border: none; color: #888; font-size: 18px; cursor: pointer; }

.v-main { display: flex; flex: 1; overflow: hidden; }
.v-content { flex: 1; position: relative; overflow: hidden; }
.v-iframe { width: 100%; height: 100%; border: none; background: #fff; }
.v-image { max-width: 100%; max-height: 100%; object-fit: contain; display: block; margin: auto; }

.v-sidebar { width: 340px; background: #1a1a1a; border-left: 1px solid #2a2a2a; display: flex; flex-direction: column; padding: 16px; overflow-y: auto; }
.v-sidebar-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.v-sidebar-header h3 { font-size: 14px; font-weight: 600; }

.v-comments { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.v-comment { padding: 12px; background: #242424; border-radius: 6px; }
.v-comment-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 13px; }
.v-comment-time { color: #555; font-size: 11px; }
.v-comment p { font-size: 14px; line-height: 1.5; }
.v-empty { color: #555; font-size: 13px; padding: 12px 0; }

.v-comment-form { border-top: 1px solid #2a2a2a; padding-top: 12px; margin-top: 12px; }
.v-input { width: 100%; padding: 8px 12px; border-radius: 6px; border: 1px solid #2a2a2a; background: #0d0d0d; color: #e8e8e8; font-size: 14px; font-family: inherit; margin-bottom: 8px; outline: none; }
.v-input:focus { border-color: #4a9eff; }
.v-textarea { resize: none; min-height: 80px; }
.v-prompts { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.v-prompt { padding: 4px 10px; border-radius: 12px; border: 1px solid #333; background: transparent; color: #888; font-size: 12px; cursor: pointer; }
.v-prompt:hover { border-color: #4a9eff; color: #e8e8e8; }
.v-form-actions { display: flex; gap: 8px; justify-content: flex-end; }

.v-btn { padding: 6px 12px; border-radius: 4px; border: 1px solid #2a2a2a; background: transparent; color: #888; font-size: 13px; cursor: pointer; }
.v-btn:hover { color: #e8e8e8; border-color: #3a3a3a; }
.v-btn-primary { background: #4a9eff; color: #fff; border: none; }
.v-btn-primary:hover { background: #6ab0ff; }
.v-btn-ghost { border: none; }

@media (max-width: 768px) {
  .v-main { flex-direction: column; }
  .v-sidebar { width: 100%; height: 40vh; border-left: none; border-top: 1px solid #2a2a2a; }
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add frank-cloud/public/
git commit -m "feat(cloud): share viewer — renders snapshots with commenting and guided prompts"
```

---

## Task 3: Create README with deploy guide

**Files:**
- Create: `frank-cloud/README.md`

- [ ] **Step 1: Create README.md**

```markdown
# Frank Cloud

Self-hosted sharing backend for [Frank](https://github.com/carlostarrats/frank). Deploy this to your own Vercel account to enable shareable links with commenting.

## Deploy

1. Click the button below to deploy to your Vercel account
2. When prompted, set the `FRANK_API_KEY` environment variable:
   ```bash
   openssl rand -base64 32
   ```
   Copy the output and paste it as the value.
3. After deploy, note your URL (e.g., `https://my-frank-cloud.vercel.app`)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/carlostarrats/frank/tree/main/frank-cloud&env=FRANK_API_KEY&envDescription=API%20key%20for%20daemon%20authentication.%20Generate%20with%20openssl%20rand%20-base64%2032)

## Connect to Frank

After deploying, connect your local Frank instance:

```bash
frank connect https://your-frank-cloud.vercel.app --key YOUR_API_KEY
```

## Security Checklist

After deploying, configure these security measures:

- [ ] **Vercel Firewall:** Go to your project settings > Firewall. Add a rate limit rule: 5 requests/minute per IP on `/api/comment`
- [ ] **Environment Variables:** Verify `FRANK_API_KEY` is set and not committed to code
- [ ] **Blob Storage:** Verify Blob storage is provisioned (happens automatically on first use)
- [ ] **HTTPS:** Enforced by Vercel by default — no action needed
- [ ] **CORS:** Configured in `vercel.json` — allows all origins for the API (reviewers need access)
- [ ] **CSP:** Content Security Policy headers set on the viewer page in `vercel.json`

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | API key | Connection check |
| POST | `/api/share` | API key | Upload snapshot, get share URL |
| GET | `/api/share?id=xxx` | Public | Fetch share for viewer |
| POST | `/api/comment` | Public | Add reviewer comment |

## Data

All data is stored in Vercel Blob on your account. You own it completely.

- Snapshots: `shares/{id}/snapshot.json`
- Metadata: `shares/{id}/meta.json`
- Comments: `shares/{id}/comments/{commentId}.json`
```

- [ ] **Step 2: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add frank-cloud/README.md
git commit -m "docs(cloud): deploy guide with security checklist"
```

---

## Task 4: Add cloud client to daemon

Create the module that communicates with the user's Frank Cloud instance.

**Files:**
- Create: `daemon/src/cloud.ts`

- [ ] **Step 1: Create cloud.ts**

```ts
import fs from 'fs';
import { CONFIG_PATH } from './protocol.js';

interface CloudConfig {
  url: string;
  apiKey: string;
}

function loadConfig(): CloudConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!config.cloudUrl || !config.apiKey) return null;
    return { url: config.cloudUrl, apiKey: config.apiKey };
  } catch {
    return null;
  }
}

export function saveCloudConfig(cloudUrl: string, apiKey: string): void {
  let config: Record<string, unknown> = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch { /* start fresh */ }
  config.cloudUrl = cloudUrl;
  config.apiKey = apiKey;
  const dir = CONFIG_PATH.replace(/\/[^/]+$/, '');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

export function isCloudConnected(): boolean {
  return loadConfig() !== null;
}

export function getCloudUrl(): string | null {
  return loadConfig()?.url || null;
}

export async function healthCheck(): Promise<{ ok: boolean; error?: string }> {
  const config = loadConfig();
  if (!config) return { ok: false, error: 'Not connected. Run: frank connect <url> --key <key>' };

  try {
    const res = await fetch(`${config.url}/api/health`, {
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
    });
    const data = await res.json();
    return data.status === 'ok' ? { ok: true } : { ok: false, error: data.message || 'Unknown error' };
  } catch (e: any) {
    return { ok: false, error: `Cannot reach ${config.url}: ${e.message}` };
  }
}

export async function uploadShare(snapshot: unknown, coverNote: string, contentType: string, oldShareId?: string, oldRevokeToken?: string): Promise<{ shareId: string; revokeToken: string; url: string } | { error: string }> {
  const config = loadConfig();
  if (!config) return { error: 'Not connected to cloud' };

  try {
    const res = await fetch(`${config.url}/api/share`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ snapshot, coverNote, contentType, oldShareId, oldRevokeToken }),
    });
    const data = await res.json();
    if (data.error) return { error: data.error };
    return {
      shareId: data.shareId,
      revokeToken: data.revokeToken,
      url: `${config.url}${data.url}`,
    };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function fetchShareComments(shareId: string): Promise<Array<{ id: string; author: string; screenId: string; anchor: unknown; text: string; ts: string }>> {
  const config = loadConfig();
  if (!config) return [];

  try {
    const res = await fetch(`${config.url}/api/share?id=${encodeURIComponent(shareId)}`);
    const data = await res.json();
    if (data.error) return [];
    return data.comments || [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

- [ ] **Step 3: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add daemon/src/cloud.ts
git commit -m "feat(daemon): cloud client — upload shares, fetch comments, health check"
```

---

## Task 5: Add DOM snapshot capture to browser UI

Create the module that serializes the iframe's DOM with inlined styles for sharing.

**Files:**
- Create: `ui-v2/overlay/snapshot.js`

- [ ] **Step 1: Create snapshot.js**

```js
// snapshot.js — Captures DOM from iframe, inlines styles for sharing

export async function captureSnapshot(iframeEl) {
  try {
    const doc = iframeEl.contentDocument;
    if (!doc) return null;

    // Clone the document
    const html = doc.documentElement.outerHTML;

    // Inline all stylesheets
    let inlinedHtml = html;
    const styles = [];
    for (const sheet of doc.styleSheets) {
      try {
        const rules = Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
        styles.push(rules);
      } catch {
        // Cross-origin stylesheet — fetch it
        if (sheet.href) {
          try {
            const res = await fetch(sheet.href);
            styles.push(await res.text());
          } catch { /* skip unfetchable */ }
        }
      }
    }

    // Strip password field values
    const parser = new DOMParser();
    const clonedDoc = parser.parseFromString(inlinedHtml, 'text/html');
    clonedDoc.querySelectorAll('input[type="password"]').forEach(el => {
      el.setAttribute('value', '');
    });

    // Inject inlined styles
    const styleTag = clonedDoc.createElement('style');
    styleTag.textContent = styles.join('\n');
    clonedDoc.head.appendChild(styleTag);

    // Remove external stylesheet links (they won't work in the share)
    clonedDoc.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());

    // Remove scripts (snapshot is static)
    clonedDoc.querySelectorAll('script').forEach(el => el.remove());

    const finalHtml = '<!DOCTYPE html>\n' + clonedDoc.documentElement.outerHTML;

    return {
      html: finalHtml,
      capturedAt: new Date().toISOString(),
      frankVersion: '2',
    };
  } catch (e) {
    console.error('[snapshot] capture failed:', e);
    return null;
  }
}

// Detect common sensitive patterns in HTML
export function detectSensitiveContent(html) {
  const warnings = [];

  // Email patterns
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = html.match(emailRegex);
  if (emails && emails.length > 0) {
    warnings.push(`${emails.length} email address(es) detected`);
  }

  // API key patterns
  const apiKeyPatterns = [
    /sk[-_][a-zA-Z0-9]{20,}/g,
    /api[-_]?key["\s:=]+["']?[a-zA-Z0-9]{16,}/gi,
    /bearer\s+[a-zA-Z0-9._-]{20,}/gi,
  ];
  for (const pattern of apiKeyPatterns) {
    if (pattern.test(html)) {
      warnings.push('Possible API key or token detected');
      break;
    }
  }

  // Password fields with values
  if (/type=["']password["'][^>]*value=["'][^"']+/i.test(html)) {
    warnings.push('Password field with value detected');
  }

  return warnings;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add ui-v2/overlay/snapshot.js
git commit -m "feat(ui): DOM snapshot capture — inlines styles, strips passwords, detects sensitive content"
```

---

## Task 6: Add share popover and wire sharing flow

Enable the Share button in the toolbar and create the share popover.

**Files:**
- Create: `ui-v2/components/share-popover.js`
- Modify: `ui-v2/components/toolbar.js` — enable Share button, wire popover
- Modify: `ui-v2/views/viewer.js` — add snapshot + share handler
- Modify: `ui-v2/core/sync.js` — add share methods
- Modify: `ui-v2/styles/app.css` — add share popover styles

- [ ] **Step 1: Add share methods to sync.js**

Read `ui-v2/core/sync.js`. Add these methods to the sync object:

```js
  uploadShare(snapshot, coverNote, contentType, oldShareId, oldRevokeToken) {
    return send({ type: 'upload-share', snapshot, coverNote, contentType, oldShareId, oldRevokeToken });
  },
  getCloudStatus() {
    return send({ type: 'cloud-status' });
  },
```

- [ ] **Step 2: Add share/cloud message types to protocol.ts**

Read `daemon/src/protocol.ts`. Add to `AppMessage` union:

```ts
export interface UploadShareRequest { type: 'upload-share'; snapshot: unknown; coverNote: string; contentType: string; oldShareId?: string; oldRevokeToken?: string; requestId?: number; }
export interface CloudStatusRequest { type: 'cloud-status'; requestId?: number; }
```

Add to `AppMessage` union type:
```ts
  | UploadShareRequest
  | CloudStatusRequest;
```

Add to `DaemonMessage`:
```ts
export interface ShareUploadedMessage {
  type: 'share-uploaded';
  requestId?: number;
  shareId: string;
  revokeToken: string;
  url: string;
}

export interface CloudStatusMessage {
  type: 'cloud-status';
  requestId?: number;
  connected: boolean;
  cloudUrl: string | null;
}
```

Add to `DaemonMessage` union:
```ts
  | ShareUploadedMessage
  | CloudStatusMessage;
```

- [ ] **Step 3: Add share handlers to server.ts**

Read `daemon/src/server.ts`. Import cloud functions at the top:

```ts
import { uploadShare, isCloudConnected, getCloudUrl, fetchShareComments } from './cloud.js';
import { loadProject, saveProject, loadComments as loadLocalComments } from './projects.js';
```

Add cases to the `handleMessage` switch:

```ts
    case 'upload-share': {
      (async () => {
        try {
          const project = activeProjectId ? loadProject(activeProjectId) : null;
          const oldShareId = project?.activeShare?.id;
          const oldRevokeToken = project?.activeShare?.revokeToken;
          const result = await uploadShare(msg.snapshot, msg.coverNote, msg.contentType, oldShareId, oldRevokeToken);
          if ('error' in result) {
            reply({ type: 'error', error: result.error });
          } else {
            // Update project with active share
            if (project && activeProjectId) {
              project.activeShare = {
                id: result.shareId,
                revokeToken: result.revokeToken,
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                coverNote: msg.coverNote,
                lastSyncedNoteId: null,
                unseenNotes: 0,
              };
              saveProject(activeProjectId, project);
            }
            reply({ type: 'share-uploaded', shareId: result.shareId, revokeToken: result.revokeToken, url: result.url });
          }
        } catch (e: any) {
          reply({ type: 'error', error: e.message });
        }
      })();
      break;
    }

    case 'cloud-status': {
      reply({
        type: 'cloud-status',
        connected: isCloudConnected(),
        cloudUrl: getCloudUrl(),
      });
      break;
    }
```

- [ ] **Step 4: Create share-popover.js**

```js
// share-popover.js — Share popover with cover note and link management
import sync from '../core/sync.js';
import projectManager from '../core/project.js';

export function showSharePopover(anchorEl, { onClose }) {
  // Remove existing popover
  document.querySelector('.share-popover')?.remove();

  const project = projectManager.get();
  const activeShare = project?.activeShare;

  const popover = document.createElement('div');
  popover.className = 'share-popover';

  // Position below anchor
  const rect = anchorEl.getBoundingClientRect();
  popover.style.top = (rect.bottom + 4) + 'px';
  popover.style.right = (window.innerWidth - rect.right) + 'px';

  popover.innerHTML = `
    <div class="share-popover-inner">
      ${activeShare ? `
        <div class="share-popover-url">
          <input type="text" class="v-input" id="share-url" value="${esc(activeShare.id)}" readonly>
          <button class="v-btn v-btn-primary" id="share-copy">Copy</button>
        </div>
      ` : ''}
      <textarea class="v-input v-textarea" id="share-note" placeholder="Cover note (optional)... e.g. 'Focus on the signup flow'"
        rows="2">${esc(activeShare?.coverNote || '')}</textarea>
      <div class="share-popover-actions">
        <button class="v-btn v-btn-ghost" id="share-cancel">Cancel</button>
        <button class="v-btn v-btn-primary" id="share-create">${activeShare ? 'Update Link' : 'Create Link'}</button>
      </div>
      <div class="share-popover-status" id="share-status"></div>
    </div>
  `;

  document.body.appendChild(popover);

  // Copy link
  popover.querySelector('#share-copy')?.addEventListener('click', () => {
    const urlInput = popover.querySelector('#share-url');
    navigator.clipboard.writeText(urlInput.value);
    popover.querySelector('#share-copy').textContent = 'Copied!';
    setTimeout(() => { popover.querySelector('#share-copy').textContent = 'Copy'; }, 2000);
  });

  // Create/Update share
  popover.querySelector('#share-create').addEventListener('click', async () => {
    const statusEl = popover.querySelector('#share-status');
    const coverNote = popover.querySelector('#share-note').value.trim();
    statusEl.textContent = 'Capturing snapshot...';

    // Dispatch snapshot capture event — viewer.js listens for this
    const event = new CustomEvent('frank:capture-snapshot', { detail: { coverNote } });
    window.dispatchEvent(event);
  });

  // Cancel
  popover.querySelector('#share-cancel').addEventListener('click', () => {
    popover.remove();
    onClose();
  });

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', function closePopover(e) {
      if (!popover.contains(e.target) && e.target !== anchorEl) {
        popover.remove();
        document.removeEventListener('click', closePopover);
        onClose();
      }
    });
  }, 100);

  return popover;
}

// Called after snapshot is captured and uploaded
export function updateSharePopover(result) {
  const popover = document.querySelector('.share-popover');
  if (!popover) return;

  const statusEl = popover.querySelector('#share-status');
  if (result.error) {
    statusEl.textContent = `Error: ${result.error}`;
    statusEl.style.color = '#ff4a4a';
    return;
  }

  // Show URL
  statusEl.textContent = '';
  const urlSection = popover.querySelector('.share-popover-url') || document.createElement('div');
  urlSection.className = 'share-popover-url';
  urlSection.innerHTML = `
    <input type="text" class="v-input" id="share-url" value="${esc(result.url)}" readonly>
    <button class="v-btn v-btn-primary" id="share-copy">Copy</button>
  `;
  if (!popover.querySelector('.share-popover-url')) {
    popover.querySelector('.share-popover-inner').prepend(urlSection);
  }

  navigator.clipboard.writeText(result.url);
  urlSection.querySelector('#share-copy').textContent = 'Copied!';

  urlSection.querySelector('#share-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(result.url);
    urlSection.querySelector('#share-copy').textContent = 'Copied!';
    setTimeout(() => { urlSection.querySelector('#share-copy').textContent = 'Copy'; }, 2000);
  });
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text || '';
  return d.innerHTML;
}
```

- [ ] **Step 5: Update toolbar.js to enable Share**

Read `ui-v2/components/toolbar.js`. Remove `disabled` from the Share button. Add click handler:

```js
import { showSharePopover } from './share-popover.js';
```

In the toolbar HTML, change:
```html
<button class="toolbar-btn" id="toolbar-share" title="Share">Share</button>
```

After the back button event listener, add:
```js
  const shareBtn = container.querySelector('#toolbar-share');
  shareBtn.addEventListener('click', () => {
    showSharePopover(shareBtn, { onClose() {} });
  });
```

- [ ] **Step 6: Wire snapshot capture in viewer.js**

Read `ui-v2/views/viewer.js`. Add import:
```js
import { captureSnapshot, detectSensitiveContent } from '../overlay/snapshot.js';
import { updateSharePopover } from '../components/share-popover.js';
```

In `renderViewer`, add event listener for the share flow:
```js
  // Share flow: capture snapshot → check sensitive → upload
  window.addEventListener('frank:capture-snapshot', async (e) => {
    const iframe = document.querySelector('#content-iframe');
    if (!iframe) return;

    const snapshot = await captureSnapshot(iframe);
    if (!snapshot) {
      updateSharePopover({ error: 'Could not capture snapshot' });
      return;
    }

    // Check for sensitive content
    const warnings = detectSensitiveContent(snapshot.html);
    if (warnings.length > 0) {
      const proceed = confirm(`Warning: ${warnings.join(', ')}. Share anyway?`);
      if (!proceed) {
        updateSharePopover({ error: 'Cancelled' });
        return;
      }
    }

    try {
      const result = await sync.uploadShare(
        snapshot,
        e.detail.coverNote,
        projectManager.get()?.contentType || 'url',
      );
      if (result.error) {
        updateSharePopover({ error: result.error });
      } else {
        // Update project state
        const project = projectManager.get();
        if (project) {
          project.activeShare = {
            id: result.shareId,
            revokeToken: result.revokeToken,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
            coverNote: e.detail.coverNote,
            lastSyncedNoteId: null,
            unseenNotes: 0,
          };
        }
        updateSharePopover(result);
      }
    } catch (err) {
      updateSharePopover({ error: err.message });
    }
  });
```

- [ ] **Step 7: Add share popover styles to app.css**

Append to `ui-v2/styles/app.css`:

```css
/* Share popover */
.share-popover {
  position: fixed;
  z-index: 100;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px;
  min-width: 340px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.share-popover-inner { display: flex; flex-direction: column; gap: 8px; }
.share-popover-url { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
.share-popover-url input { flex: 1; font-family: monospace; font-size: 12px; }
.share-popover-actions { display: flex; gap: 8px; justify-content: flex-end; }
.share-popover-status { font-size: 12px; color: var(--text-muted); min-height: 16px; }
```

- [ ] **Step 8: Build daemon**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

- [ ] **Step 9: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add daemon/src/protocol.ts daemon/src/server.ts ui-v2/components/share-popover.js ui-v2/components/toolbar.js ui-v2/views/viewer.js ui-v2/core/sync.js ui-v2/styles/app.css
git commit -m "feat: share flow — snapshot capture, upload to cloud, share popover with cover notes"
```

---

## Task 7: Add comment sync to daemon

Poll the cloud for new reviewer comments and merge them into the local project.

**Files:**
- Modify: `daemon/src/server.ts` — add sync loop
- Modify: `daemon/src/projects.ts` — add cloud comment merge

- [ ] **Step 1: Add mergeCloudComments to projects.ts**

Read `daemon/src/projects.ts`. Add this function:

```ts
export function mergeCloudComments(projectId: string, cloudComments: Array<{ id: string; author: string; screenId: string; anchor: unknown; text: string; ts: string }>): { newCount: number; lastId: string | null } {
  const existing = loadComments(projectId);
  const existingIds = new Set(existing.map(c => c.id));
  let newCount = 0;

  for (const cc of cloudComments) {
    if (!existingIds.has(cc.id)) {
      existing.push({
        id: cc.id,
        screenId: cc.screenId,
        anchor: cc.anchor as any,
        author: cc.author,
        text: cc.text,
        ts: cc.ts,
        status: 'pending',
      });
      newCount++;
    }
  }

  if (newCount > 0) {
    atomicWrite(commentsJsonPath(projectId), JSON.stringify(existing, null, 2));
  }

  const lastId = cloudComments.length > 0 ? cloudComments[cloudComments.length - 1].id : null;
  return { newCount, lastId };
}
```

Also export `atomicWrite` and `commentsJsonPath` (or make `mergeCloudComments` use them internally — they're already defined in the file, just not exported). The simplest fix: the function is defined in the same file, so it already has access.

- [ ] **Step 2: Add sync loop to server.ts**

Read `daemon/src/server.ts`. Add import for `fetchShareComments`:

```ts
import { fetchShareComments } from './cloud.js';
import { mergeCloudComments } from './projects.js';
```

In `startServer()`, add the sync loop:

```ts
  // Sync cloud comments every 30 seconds
  setInterval(() => syncCloudComments(), 30000);
  setTimeout(() => syncCloudComments(), 5000); // Initial sync after startup
```

Add the sync function:

```ts
async function syncCloudComments(): Promise<void> {
  if (!activeProjectId) return;
  try {
    const project = loadProject(activeProjectId);
    if (!project.activeShare?.id) return;

    const cloudComments = await fetchShareComments(project.activeShare.id);
    if (cloudComments.length === 0) return;

    const { newCount } = mergeCloudComments(activeProjectId, cloudComments);
    if (newCount > 0) {
      // Update unseen count
      project.activeShare.unseenNotes = (project.activeShare.unseenNotes || 0) + newCount;
      saveProject(activeProjectId, project);

      // Broadcast to connected clients
      const allComments = loadLocalComments(activeProjectId);
      broadcast({ type: 'project-loaded', projectId: activeProjectId, project, comments: allComments } as any);
      console.log(`[frank] synced ${newCount} new comment(s) from cloud`);
    }
  } catch {
    // Silent fail — sync is best-effort
  }
}
```

- [ ] **Step 3: Build**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

- [ ] **Step 4: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add daemon/src/server.ts daemon/src/projects.ts
git commit -m "feat(daemon): comment sync — polls cloud every 30s, merges into local project"
```

---

## Task 8: Implement frank connect and frank status

Wire up the CLI commands.

**Files:**
- Modify: `daemon/src/cli.ts`

- [ ] **Step 1: Update cli.ts**

Read `daemon/src/cli.ts`. Replace the `connect` and `status` cases:

```ts
  case 'connect': {
    const urlArg = process.argv[3];
    const keyFlag = process.argv.indexOf('--key');
    const keyArg = keyFlag >= 0 ? process.argv[keyFlag + 1] : undefined;

    if (!urlArg || !keyArg) {
      console.log('Usage: frank connect <cloud-url> --key <api-key>');
      console.log('Example: frank connect https://my-frank.vercel.app --key sk_abc123');
      process.exit(1);
    }

    const { saveCloudConfig, healthCheck } = await import('./cloud.js');
    saveCloudConfig(urlArg.replace(/\/$/, ''), keyArg);
    console.log(`[frank] saved cloud config`);

    const result = await healthCheck();
    if (result.ok) {
      console.log(`[frank] connected to ${urlArg}`);
    } else {
      console.error(`[frank] connection failed: ${result.error}`);
      process.exit(1);
    }
    process.exit(0);
  }

  case 'status': {
    const { isCloudConnected, getCloudUrl, healthCheck } = await import('./cloud.js');
    console.log('[frank] status');
    console.log(`  cloud: ${isCloudConnected() ? `connected (${getCloudUrl()})` : 'not connected'}`);
    if (isCloudConnected()) {
      const check = await healthCheck();
      console.log(`  health: ${check.ok ? 'ok' : check.error}`);
    }
    process.exit(0);
  }
```

- [ ] **Step 2: Build**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

- [ ] **Step 3: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add daemon/src/cli.ts
git commit -m "feat(daemon): implement frank connect and frank status commands"
```

---

## Summary

8 tasks:
1. **Frank Cloud API** — Vercel serverless functions (share, comment, health)
2. **Share viewer** — Static page rendering snapshots with commenting
3. **Deploy guide** — README with security checklist
4. **Cloud client** — Daemon module for cloud communication
5. **DOM snapshot** — Browser-side capture with style inlining
6. **Share flow** — Popover, snapshot capture, upload, link management
7. **Comment sync** — Daemon polls cloud, merges into local project
8. **CLI commands** — frank connect and frank status

Build order: 1-3 (cloud infra), 4-5 (daemon + UI additions), 6-7 (integration), 8 (CLI).

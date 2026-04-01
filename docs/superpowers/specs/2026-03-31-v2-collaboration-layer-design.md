# Frank v2 — Collaboration Layer Design Spec

> Frank v2 is a collaboration layer for any viewable content. Point it at a URL or drop in a file — Frank wraps it with commenting, sharing, feedback curation, and a complete data trail of how the thing was built.

**Date:** 2026-03-31
**Branch:** `dev`
**Supersedes:** Phase 1/Phase 2 plans (wireframe-era, `docs/superpowers/plans/2026-03-25-*`)

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Content Wrapping & Overlay](#2-content-wrapping--overlay)
3. [Commenting System](#3-commenting-system)
4. [Feedback Curation](#4-feedback-curation)
5. [Sharing & Cloud](#5-sharing--cloud)
6. [Data Capture System](#6-data-capture-system)
7. [AI Feedback Routing](#7-ai-feedback-routing)
8. [Self-Hosted Cloud Setup](#8-self-hosted-cloud-setup)
9. [Security](#9-security)
10. [Project Management](#10-project-management)

---

## 1. Architecture

Two packages. One local, one cloud. Clean separation.

### Local: Frank Daemon + Browser UI

The daemon is a Node.js CLI that runs on the user's machine. It serves the browser UI at `localhost:42068`, manages projects, captures data, and communicates with the user's self-hosted cloud instance.

```
Frank Daemon (Node.js)
├── WebSocket server (daemon <-> browser UI)
├── HTTP server (serves UI + proxies content)
├── Content proxy (for iframe-restricted URLs)
├── Snapshot coordinator (receives DOM + screenshots from browser via WebSocket)
├── Screenshot storage
├── Project file I/O (~/.frank/)
├── Cloud sync (shares, comments)
└── CLI: frank start | stop | connect | status | backup

Browser UI (localhost:42068)
├── Content viewer (iframe wrapper + overlay)
├── Commenting overlay (element targeting + pin targeting)
├── Feedback curation panel
├── Project home / screen gallery
├── Data timeline viewer
└── Settings (per-project capture toggle, cloud connection)
```

### Cloud: Frank Cloud (self-hosted on user's Vercel)

A deployable Vercel project. Users deploy it to their own Vercel account via a "Deploy to Vercel" button. Each user owns their own data.

```
Frank Cloud (Vercel)
├── POST /api/share        → upload snapshot + metadata
├── GET  /api/share/:id    → fetch share for viewer
├── POST /api/comment      → add reviewer comment
├── GET  /api/health       → connection check
├── Share Viewer            → static page that renders snapshots
└── Vercel Blob storage     → snapshots, assets, comments, backups
```

### Communication

- **Daemon <-> Browser UI:** WebSocket on localhost:42068
- **Daemon <-> Cloud:** HTTPS API calls, authenticated with API key
- **Reviewer <-> Cloud:** HTTPS (share viewer page + comment API)

### Local Storage

```
~/.frank/
├── config.json              # Cloud URL, API key, global settings
├── projects/
│   ├── my-app/
│   │   ├── project.json     # Project metadata, URL, settings, capture toggle
│   │   ├── screens/         # Per-screen data (one file per tracked route)
│   │   ├── snapshots/       # DOM snapshots + screenshots
│   │   ├── comments/        # All comments (local + synced from cloud)
│   │   ├── curation/        # Approve/dismiss/remix log
│   │   ├── ai-chain/        # AI instruction log
│   │   └── timeline.json    # Unified event timeline
│   └── other-project/
├── outbox/                  # Queued shares when cloud is unreachable
└── exports/                 # Exported datasets
```

---

## 2. Content Wrapping & Overlay

### Supported content types

| Input | How Frank loads it | Commenting mode | Sharing mode |
|---|---|---|---|
| URL (localhost) | iframe, proxy fallback | Element-level | DOM snapshot + assets |
| URL (deployed) | iframe, proxy fallback | Element-level | DOM snapshot + assets |
| Local HTML file | Served by daemon, loaded in iframe | Element-level | DOM snapshot + assets |
| PDF | Browser-native PDF viewer or pdf.js | Pin-based (page + coordinates) | File upload (original file) |
| Image (PNG, JPG, etc.) | `<img>` tag, scaled to fit | Pin-based (coordinates) | File upload (original file) |

**File size limit:** 10MB for PDFs and images.

**Snapshot size limit:** 25MB including inlined assets.

### Iframe wrapping

1. User provides a URL or drops a file.
2. Frank loads it in a controlled iframe at `localhost:42068`.
3. A transparent overlay sits on top — handles click-to-comment, element highlighting, screenshot capture.
4. The iframe content is the real running page — Frank does not modify or re-render it.
5. The page is fully interactive, responsive, and scrollable under the overlay.

### Iframe restriction handling (proxy mode)

Many deployed sites set `X-Frame-Options: DENY` or `Content-Security-Policy: frame-ancestors 'none'`, which prevents iframe embedding.

**Detection:** When the iframe fails to load (fires `error` event or loads blank), Frank detects the restriction.

**Fallback:** The daemon proxies the URL — it fetches the page server-side and serves it through `localhost:42068`, stripping the restrictive headers. This works because it's local, serving to the user themselves.

**Security constraints for proxy mode:**
- Only proxy URLs the user explicitly provides (never auto-follow redirects to untrusted domains)
- The proxy strips `X-Frame-Options` and `Content-Security-Policy` frame directives only
- All other security headers are preserved
- The proxy does not store or cache content beyond the active session
- URLs are validated before proxying (must be HTTP/HTTPS, no file:// or other protocols)

**Proxy limitation:** Proxy mode handles the initial page load but does not intercept subsequent JavaScript fetch/XHR calls from the page to its original origin. In proxy mode, client-side API calls may fail, which limits interactivity for heavily dynamic pages. This is acceptable — the snapshot captures the visible state, and proxy mode is a fallback, not the primary path. Most localhost/staging apps load fine in the iframe directly.

### Multi-page app tracking

When the iframe navigates (URL changes due to client-side routing or link clicks), Frank detects the route change and prompts: "Add this as a new screen?" The user can accept (new screen added to the project) or dismiss (navigation is transient). Each screen in a project corresponds to a tracked route.

Auto-track mode (optional setting): all navigated routes are automatically added as screens without prompting.

---

## 3. Commenting System

### Two contexts, same mechanic

| | Owner (in Frank locally) | Reviewer (via share link) |
|---|---|---|
| Click to comment | Yes | Yes |
| Element-level targeting (web) | Yes | Yes (desktop), pin-based on mobile |
| Pin-based targeting (PDF/image) | Yes | Yes |
| Guided prompts | Optional | Shown by default |
| See all comments | Yes | Own comments + owner's published replies |

### Smart element detection (forgiving clicks)

When a user clicks to comment on web content, Frank does not anchor to the exact element the cursor hit. It bubbles up to the nearest "meaningful" element:

**Skip (too granular):** `<span>`, `<em>`, `<strong>`, `<br>`, `<i>`, `<b>`, `<small>`, bare text nodes.

**Stop at (meaningful targets):**
- Semantic elements: `<button>`, `<a>`, `<input>`, `<textarea>`, `<select>`, `<img>`, `<video>`, `<h1>`-`<h6>`, `<li>`, `<nav>`, `<header>`, `<footer>`, `<main>`, `<section>`, `<article>`
- Layout elements with identity: any element with a `class`, `id`, or `data-*` attribute
- Visual containers: elements with visible borders, background colors, or box shadows (detected via computed styles)

**Confirmation step:** The detected element is highlighted with an outline before the comment box opens. If the user clicked the wrong thing, they click again elsewhere. No confirmation dialog — just visual feedback.

**Mobile behavior:** On viewports below 768px, default to pin-based commenting (tap to drop a pin). The pin coordinates map to the nearest element for data purposes, but the reviewer doesn't need to precisely tap a specific DOM node. This applies to the share viewer on mobile devices.

### Comment anchoring (triple-anchor strategy)

Each comment stores three anchors for resilience:

1. **CSS selector** (primary) — e.g., `.hero .cta-btn`
2. **DOM path** (fallback) — e.g., `body > div:nth-child(2) > section > button`
3. **Visual coordinates** (last resort) — x% and y% of viewport at the time of commenting

**Resolution order:** Try CSS selector first. If no match, try DOM path. If no match, render the comment at the saved visual coordinates with a "this element may have moved" indicator.

Comments are never lost. They degrade gracefully as the page evolves.

For PDFs and images, only pin coordinates (page number + x/y position) are stored.

### Guided feedback prompts

Shown to reviewers below the comment input:
- "How does this feel?"
- "What's missing?"
- "What would you change?"

Clicking a prompt pre-fills the comment textarea. Reviewers can ignore them and type freely.

### Reviewer name

First-time commenters are prompted for a name (just a name, no email, no account). Stored in their browser's localStorage. Re-asked if cleared. No tracking, no cookies beyond localStorage.

### Comment limits

- Max comment length: 2,000 characters
- Max 100 comments per share
- Rate limit: 5 comments per minute per IP (enforced in cloud function + Vercel Firewall)

---

## 4. Feedback Curation

The owner is the gatekeeper. Reviewer comments are input, not instructions.

### Curation actions

For each incoming comment, the owner can:

- **Approve** — this feedback is valid, include in AI instruction
- **Dismiss** — reject, with an optional reason ("out of scope", "already addressed")
- **Remix** — rewrite in the owner's own words. The original comment stays as reference, the remixed text becomes the instruction. This is the most common action — reviewers describe problems, the owner translates to technical direction.
- **Batch** — select multiple comments and combine into a single coherent instruction

### Curation panel

A side panel in the editor view showing:
- Incoming comments grouped by screen
- Each comment shows: author, text, anchored element reference, timestamp
- Action buttons: Approve / Dismiss / Remix
- Filter: All / Pending / Approved / Dismissed
- Batch mode: select multiple, combine into one instruction

### Curation log

Every curation action is recorded:

```json
{
  "id": "cur_001",
  "commentIds": ["c12", "c15"],
  "action": "remix",
  "originalTexts": ["this button is ugly", "CTA needs work"],
  "remixedText": "Increase hero CTA size, use primary color, add padding",
  "ts": "2026-03-31T..."
}
```

This log is part of the project data and included in exports.

---

## 5. Sharing & Cloud

### Share flow

1. Owner clicks Share in Frank.
2. **Pre-upload review:** Frank shows a preview of what will be shared. Warns if it detects common sensitive patterns (email addresses, API keys, tokens, password fields). The owner confirms or cancels.
3. For web content: Frank captures a full DOM snapshot — live HTML with responsive layout, scrollable, text selectable. CSS is inlined, images are downloaded and uploaded as assets. `<input type="password">` values are stripped. localStorage/sessionStorage/cookie data is excluded.
4. For files: Frank uploads the original file (PDF, image).
5. Frank uploads to the owner's Vercel Blob via `POST /api/share`.
6. Returns a share URL: `https://{users-frank-cloud}.vercel.app/s/{shareId}`
7. Owner sends the link to reviewers.

### Share viewer (reviewer experience)

The share viewer is a static page deployed as part of Frank Cloud. It:

1. Fetches the snapshot/file from the API
2. Renders it in the browser:
   - Web snapshots: rendered as live HTML (responsive, scrollable, interactive layout)
   - PDFs: rendered with browser PDF viewer
   - Images: rendered as `<img>`, scaled to fit
3. Commenting overlay on top (same as local, but with reviewer constraints)
4. Guided feedback prompts shown by default
5. Screen navigation if the project has multiple screens
6. Cover note toast (if the owner included one)

**Progressive loading for large snapshots:**
- HTML structure loads first (fast)
- Images load lazily as the reviewer scrolls
- Skeleton/loading state shows immediately
- Assets are compressed before upload (optimized PNGs, minified CSS)

**Section navigation for long pages:**
- A mini-map or jump nav for pages with many sections
- Helps reviewers navigate without scrolling through everything

### Share lifecycle

- **One active share per project** — sharing again kills the old link, generates a new one
- **Old links show:** "This has been updated. Ask the owner for the new link."
- **Auto-expiry:** Default 7 days, configurable per share
- **Expiry behavior:** Viewer access is killed (returns expired message). Comment data in Blob is NOT auto-deleted — only the owner can delete it. The daemon has already synced all comments locally.
- **Cover notes:** Optional message pinned at the top of the share viewer. "Focus on the signup flow, the rest is rough."

### Comment sync

- Cloud function writes each comment to Blob immediately on receipt
- Daemon polls `GET /api/share/:id` every 30 seconds while running
- On daemon startup, syncs any comments that arrived while it was offline
- New comments are written into the local project file immediately on sync
- Local project file is always the complete record

### Cloud resilience

- If the cloud is unreachable, shares queue in `~/.frank/outbox/` and retry on reconnection
- `frank status` shows cloud connection state clearly
- Sharing is unavailable when cloud is down; all other features work normally

---

## 6. Data Capture System

Always on by default. Toggleable per project in project settings.

### Three data streams

#### 1. Snapshots (visual state over time)

Captured at meaningful moments:
- When the owner explicitly saves/snapshots
- When the owner shares (the share snapshot is also saved locally)
- When the owner marks an AI instruction as applied

Each snapshot stores:
- Full DOM state (HTML)
- Screenshot (PNG)
- Timestamp
- Trigger: what caused this snapshot ("manual", "share", "ai-applied")
- `triggeredBy` (optional): ID of the AI instruction that caused this state change
- `frankVersion`: snapshot format version for forward compatibility

**Capture mechanism:** DOM snapshots and screenshots are captured by the browser UI, not the daemon. The browser has direct access to the iframe's DOM (same-origin for localhost/proxied content). The browser serializes the DOM (`document.documentElement.outerHTML` with inlined computed styles), takes a screenshot (via `html2canvas` or Canvas API), and sends both to the daemon via WebSocket. The daemon writes them to disk. For cross-origin iframes that can't be accessed from JS, the proxy mode ensures the content is served from localhost, making it same-origin.

**Starred snapshots:** Any snapshot can be starred with a label ("Client review v1", "Final approved"). Starred snapshots float to the top of the timeline. Unstarred snapshots are collapsed. Exports can filter to starred-only.

**Storage:** `~/.frank/projects/{project}/snapshots/`. Each snapshot is a directory containing `snapshot.html`, `screenshot.png`, and `meta.json`.

**Storage estimate:** ~200KB-1MB per screenshot, ~50KB-5MB per DOM snapshot. 50 snapshots = ~25-50MB per project.

#### 2. Comments & curation log

- Every comment from every participant (local + synced from cloud)
- Anchoring data (CSS selector, DOM path, coordinates)
- Author, timestamp, status (pending/approved/dismissed/remixed)
- Full curation log (see Section 4)

#### 3. AI interaction chain

When the owner copies feedback to the AI:

```json
{
  "id": "ai_003",
  "feedbackIds": ["c12", "c15"],
  "curationIds": ["cur_001"],
  "instruction": "Increase hero CTA size, use primary color, add padding",
  "ts": "2026-03-31T..."
}
```

When a snapshot is triggered after AI changes, it links back:

```json
{
  "snapshotId": "snap_014",
  "triggeredBy": "ai_003",
  "ts": "2026-03-31T..."
}
```

**Chain:** reviewer comments -> owner curation -> AI instruction -> snapshot of result. All linked by IDs.

Frank captures what the owner sent to the AI. It does not track what the AI did with it — that's outside Frank's scope.

### File versioning

For PDF/image inputs, each file is a "content slot" with version history. Uploading a new file to the same project prompts: "Is this a new version of [existing file] or a new item?" If new version, they're linked. The timeline shows: v1 -> feedback -> v2 -> feedback -> v3. Old versions remain accessible.

### Export

One-click export of the full project dataset as structured JSON:

```json
{
  "frank_export_version": "1",
  "project": { "name": "...", "url": "...", "created": "...", "screens": [...] },
  "snapshots": [
    { "id": "snap_001", "trigger": "manual", "triggeredBy": null, "starred": true, "label": "Initial", "ts": "..." }
  ],
  "comments": [
    { "id": "c12", "author": "Sara", "screenId": "home", "anchor": {...}, "text": "...", "status": "remixed", "ts": "..." }
  ],
  "curations": [
    { "id": "cur_001", "commentIds": ["c12", "c15"], "action": "remix", "remixedText": "...", "ts": "..." }
  ],
  "aiInstructions": [
    { "id": "ai_003", "curationIds": ["cur_001"], "instruction": "...", "resultSnapshot": "snap_014", "ts": "..." }
  ],
  "timeline": [
    { "type": "comment", "id": "c12", "ts": "..." },
    { "type": "curation", "id": "cur_001", "ts": "..." },
    { "type": "ai_instruction", "id": "ai_003", "ts": "..." },
    { "type": "snapshot", "id": "snap_014", "triggeredBy": "ai_003", "ts": "..." }
  ]
}
```

Relationships between all data types are explicit. Designed to be dropped into any AI conversation for design decision review.

---

## 7. AI Feedback Routing

### Clipboard-based (v2 launch)

1. Owner selects approved/remixed comments in the curation panel
2. An editable text field shows the combined instruction — owner can rewrite freely
3. "Copy for AI" formats a structured prompt:
   - Element references (what's being commented on)
   - Original reviewer comments (as context)
   - Owner's curated instruction (the actual ask)
   - Screenshot reference (if applicable)
4. Copied to clipboard, owner pastes into terminal/IDE
5. The instruction is logged in the AI interaction chain

**The instruction is always editable.** Reviewer comments are context, not the literal prompt. The owner crafts the actual instruction for the AI.

### Future: Direct injection

Designed so that a Claude Code integration (CLAUDE.md injection, feedback file) can be added later without changing the curation UX. The "Copy for AI" step would become "Send to AI" for Claude Code users. The data model is the same either way.

---

## 8. Self-Hosted Cloud Setup

### Deploy flow

1. User clicks "Deploy to Vercel" button in Frank's README/docs
2. Vercel clones the `frank-cloud` template repo and deploys it
3. During deploy, Vercel provisions Blob storage automatically
4. During deploy, Vercel prompts for an `FRANK_API_KEY` environment variable — the user generates a random string (the deploy template provides a generator command: `openssl rand -base64 32`) and sets it as the env var. This key authenticates all daemon-to-cloud API calls.
5. Locally: `frank connect https://my-frank.vercel.app --key sk_abc123`
6. Daemon stores the cloud URL and API key in `~/.frank/config.json`
7. `frank connect` runs a health check to confirm the connection works
8. Done — sharing is now enabled

### `frank-cloud` template

A minimal Vercel project:

```
frank-cloud/
├── api/
│   ├── share.ts          # POST: upload snapshot, GET: fetch share
│   ├── comment.ts        # POST: add comment
│   └── health.ts         # GET: connection check
├── viewer/
│   ├── index.html        # Share viewer page
│   ├── viewer.js         # Fetches snapshot, renders, commenting overlay
│   └── viewer.css
├── vercel.json           # Routes, headers, security config
├── package.json
└── README.md             # Setup guide with security checklist
```

### CLI commands

| Command | What it does |
|---|---|
| `frank start` | Start the daemon + open browser UI |
| `frank stop` | Stop the daemon |
| `frank connect <url> --key <key>` | Link to cloud instance, run health check |
| `frank status` | Show: daemon running, cloud connected/unreachable, active project, capture on/off |
| `frank backup` | Upload encrypted project archive to cloud Blob under `backups/` prefix |
| `frank export [project]` | Export project data as structured JSON |

### Security setup guide

The `frank-cloud` README includes a security checklist that walks users through:

- **Vercel Firewall:** Enable rate limiting at the edge (5 req/min per IP on `/api/comment`)
- **CORS:** Restrict allowed origins to the user's Frank Cloud domain
- **Environment variables:** API key stored as Vercel env var, never in code
- **Blob access:** Private by default, only accessible through API functions
- **Content Security Policy:** Headers on the share viewer to prevent XSS
- **Input validation:** All serverless functions validate and sanitize input
- **HTTPS only:** Enforced by Vercel by default

---

## 9. Security

Security is a first-class requirement across every layer.

### Authentication & authorization

- **Daemon <-> Cloud:** API key authentication. Key generated by the cloud instance, stored locally in `~/.frank/config.json`. All API calls include the key in an `Authorization` header.
- **Share viewer:** Public access (by design — reviewers don't need accounts). Protected by unguessable share IDs (cryptographically random, 12+ characters).
- **Comment API:** Unauthenticated (reviewers are anonymous). Protected by rate limiting, input validation, and the unguessability of share IDs (12+ chars base64url = ~4.7 * 10^21 possibilities, making brute-force impractical). The comment endpoint requires a valid share ID — without one, comments are rejected.

### Data protection

- **Sensitive content detection:** Before sharing, Frank scans the snapshot for common sensitive patterns (email addresses, API keys, tokens, password field values) and warns the owner. The owner confirms before upload.
- **Automatic stripping:** `<input type="password">` values are cleared. localStorage, sessionStorage, and cookie data are excluded from snapshots.
- **Blob storage:** Private by default. Only accessible through the authenticated API functions.
- **Backups:** Encrypted before upload to cloud Blob.

### Input validation & sanitization

- All user input (comments, cover notes, project names) sanitized server-side before storage
- XSS prevention: HTML entities escaped in all rendered user content
- Comment length limit: 2,000 characters
- File upload validation: MIME type checking, size limits enforced
- URL validation: only HTTP/HTTPS protocols accepted for wrapping

### Share security

- **Unguessable IDs:** Cryptographically random, 12+ characters (base64url)
- **Auto-expiry:** Default 7 days, configurable
- **Re-share revocation:** Old link dies immediately when a new share is created
- **Expiry behavior:** Kills viewer access only. Comment data preserved until owner deletes.
- **Access logging:** View counter + hashed IP timestamps (hashed for privacy, not raw IPs). Owner sees: "Viewed 4 times, last viewed 2 hours ago."

### Proxy security

- Only proxy URLs explicitly provided by the user
- Do not follow redirects to untrusted domains
- Strip only iframe-restrictive headers, preserve all other security headers
- No caching of proxied content beyond the active session
- URL validation before proxying

### Anti-abuse

- Rate limiting: 5 comments/minute per IP (cloud function + Vercel Firewall)
- Max 100 comments per share (hard cap)
- Snapshot size limit: 25MB
- File upload limit: 10MB
- Blob storage monitoring: users should set up Vercel usage alerts

### Local data

- All project data stored locally in `~/.frank/` — never sent anywhere without explicit user action (Share or Backup)
- No telemetry, no analytics, no phone-home
- No accounts required for the local tool
- Cloud connection is optional — everything except sharing works offline

---

## 10. Project Management

### Project structure

Each project tracks one "thing being built" — a URL, a set of related pages, or a file.

```json
{
  "frank_version": "2",
  "name": "My App Redesign",
  "contentType": "url",
  "url": "http://localhost:3000",
  "screens": {
    "home": { "route": "/", "label": "Home" },
    "dashboard": { "route": "/dashboard", "label": "Dashboard" }
  },
  "screenOrder": ["home", "dashboard"],
  "capture": true,
  "activeShare": null,
  "created": "2026-03-31T...",
  "modified": "2026-03-31T..."
}
```

For file-based projects, `contentType` is `"pdf"` or `"image"` and `url` is replaced with `file` pointing to the local path. File versions are tracked in a `versions` array.

### Views

| View | What it shows |
|---|---|
| **Home** | Project list — name, content type, last modified, capture status, unseen comment badge |
| **Viewer** | Content wrapped in iframe + commenting overlay + curation panel |
| **Timeline** | Chronological view of snapshots, comments, curations, AI instructions |
| **Settings** | Per-project: capture toggle, cloud connection, share management |

### Data persistence

- All data in `~/.frank/projects/{project}/` as JSON files
- Daemon is the sole file writer (UI never touches the filesystem directly)
- Atomic writes (temp file + rename) to prevent corruption
- `frank backup` for cloud backup to user's own Vercel Blob

---

## What's NOT in v2

Explicitly out of scope:

- **Wireframe rendering** — v1's sections.js/screen.js renderer is not part of v2. The input is a URL or file, not a JSON schema.
- **Built-in AI analysis** — Frank captures data and exports it. It does not have AI review features built in.
- **Tunnel mode for localhost** — v2 uses DOM snapshots for sharing localhost content. Live tunneling (like ngrok) is a future feature.
- **Real-time collaboration** — Reviewers don't see each other's comments in real-time. Comments sync when the owner's daemon polls.
- **Accounts / team features** — No user accounts, no team management. Reviewers are identified by name only.
- **Direct AI integration** — v2 is clipboard-based. Direct Claude Code injection is a future feature.
- **Tauri / native app** — v2 runs in the browser. No native window. The daemon + browser is the architecture.

---

## Resolved decisions

| Question | Decision | Rationale |
|---|---|---|
| Product scope | Web-first, file support as bonus | Keep focused — URLs are the core, PDF/images are supported but not the headline |
| Data capture toggle | Always on, toggleable off per project | Can't go back and capture what you didn't record. Per-project because different projects have different needs |
| Sharing infrastructure | Real internet links, self-hosted | Local-only sharing has no utility for a solo developer. Self-hosted because users own their data |
| Snapshot format | Full live DOM (responsive, scrollable) | Screenshots are too low-fidelity. Live DOM preserves the real experience |
| Element targeting | Smart bubbling for web, pins for PDF/images/mobile | Forgiving clicks — reviewers aren't precise. Pin fallback for static content and small screens |
| AI routing | Clipboard-based, owner always edits | Reviewer comments are input, not instructions. Owner crafts the actual AI prompt |
| Export format | Structured JSON with explicit relationships | Designed for AI consumption — drop into any conversation for design review |
| Architecture | Split local + cloud | Different concerns, independent evolution, users own their cloud instance |
| Iframe restrictions | Proxy fallback, strip restrictive headers | Many real sites block iframes. Proxy solves it locally without security compromise |
| Comment anchoring | Triple-anchor with graceful degradation | CSS selectors break when code changes. Fallback chain ensures comments are never lost |
| Sensitive content | Warn before sharing, auto-strip passwords | Users might not realize they're sharing sensitive data. Make them look first |
| Mobile reviewing | Pin-based by default | Element targeting is too hard on small screens. Pins are forgiving |
| Snapshot versioning | `frankVersion` in meta.json | Old shares must keep rendering as Frank evolves |
| Backups | Optional, user-initiated, encrypted to own cloud | Local data is the source of truth. Backup is insurance, not a feature |

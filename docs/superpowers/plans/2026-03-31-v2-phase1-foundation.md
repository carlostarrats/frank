# v2 Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Frank as a URL-wrapping collaboration tool with iframe content viewing, local commenting with smart element detection, and v2 project management. Result: you can point Frank at any URL or file, see it in the browser, and add local comments anchored to specific elements.

**Architecture:** Evolve the existing daemon (keep WebSocket, HTTP server, project I/O, CLI structure). Replace the wireframe rendering UI with an iframe wrapper + transparent commenting overlay. New project model stores URLs/files instead of wireframe schemas. Storage moves from `~/Documents/Frank/` to `~/.frank/projects/`.

**Tech Stack:** Node.js daemon (TypeScript), plain JS browser UI (no build step), WebSocket (ws), CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-03-31-v2-collaboration-layer-design.md`

**Phases:**
- **Phase 1 (this plan):** Foundation — daemon v2, iframe wrapper, local commenting, project management
- **Phase 2:** Cloud + Sharing — frank-cloud Vercel template, share viewer, comment sync
- **Phase 3:** Data Capture + Curation + AI Routing — snapshots, timeline, curation panel, export

---

## File Structure

### Daemon (modify existing)

```
daemon/src/
├── cli.ts              # MODIFY: add `connect`, `status`, `export` commands
├── server.ts           # MODIFY: remove schema watcher, add content proxy, keep WS/HTTP
├── protocol.ts         # MODIFY: new message types for v2 (URL wrapping, comments, proxy)
├── projects.ts         # MODIFY: v2 project model (URL/file instead of screens with schemas)
├── proxy.ts            # CREATE: HTTP proxy for iframe-restricted URLs
├── inject.ts           # MODIFY: update CLAUDE.md block for v2 instructions
└── shares.ts           # KEEP: untouched for Phase 2
```

### Browser UI (new, replaces v1 UI)

```
ui-v2/
├── index.html          # Entry point
├── app.js              # App shell: view router, state
├── core/
│   ├── sync.js         # WebSocket client (adapted from v1)
│   └── project.js      # In-memory project state manager (adapted from v1)
├── views/
│   ├── home.js         # Project list — create, open, delete
│   └── viewer.js       # Content viewer — iframe + overlay + comments
├── overlay/
│   ├── overlay.js      # Transparent overlay controller (click handling, mode switching)
│   ├── element-detect.js  # Smart element detection (bubble up to meaningful element)
│   ├── anchoring.js    # Triple-anchor: CSS selector + DOM path + coordinates
│   ├── highlight.js    # Element highlight rendering (outline on hover/select)
│   └── pin.js          # Pin-based commenting for PDFs/images/mobile
├── components/
│   ├── comments.js     # Comment panel (list, add, filter by screen)
│   ├── toolbar.js      # Top toolbar (project name, URL input, share button placeholder)
│   └── url-input.js    # URL/file input with validation
└── styles/
    ├── tokens.css      # Design tokens (dark theme from v1)
    ├── app.css         # App chrome styles
    ├── overlay.css     # Overlay and highlight styles
    └── comments.css    # Comment panel styles
```

---

## Task 1: Update daemon protocol for v2

Update the shared types to support URL-based projects and element-anchored comments.

**Files:**
- Modify: `daemon/src/protocol.ts`

- [ ] **Step 1: Replace protocol.ts with v2 types**

```ts
// Shared types and constants for daemon ↔ browser communication.

// ─── Project types ──────────────────────────────────────────────────────────

export interface ProjectV2 {
  frank_version: '2';
  name: string;
  contentType: 'url' | 'pdf' | 'image';
  url?: string;           // For contentType: 'url'
  file?: string;          // For contentType: 'pdf' | 'image'
  screens: Record<string, ScreenV2>;
  screenOrder: string[];
  capture: boolean;
  activeShare: ActiveShare | null;
  created: string;
  modified: string;
}

export interface ScreenV2 {
  route: string;
  label: string;
}

export interface ActiveShare {
  id: string;
  revokeToken: string;
  createdAt: string;
  expiresAt: string;
  coverNote: string;
  lastSyncedNoteId: string | null;
  unseenNotes: number;
}

export interface CommentAnchor {
  type: 'element' | 'pin';
  cssSelector?: string;    // Primary anchor for element type
  domPath?: string;        // Fallback for element type
  x: number;               // Visual coordinates (% of viewport)
  y: number;
  pageNumber?: number;     // For PDFs
}

export interface Comment {
  id: string;
  screenId: string;
  anchor: CommentAnchor;
  author: string;
  text: string;
  ts: string;
  status: 'pending' | 'approved' | 'dismissed' | 'remixed';
}

// ─── App → Daemon (WebSocket) ───────────────────────────────────────────────

export interface ListProjectsRequest { type: 'list-projects'; requestId?: number; }
export interface LoadProjectRequest { type: 'load-project'; projectId: string; requestId?: number; }
export interface CreateProjectRequest { type: 'create-project'; name: string; contentType: 'url' | 'pdf' | 'image'; url?: string; file?: string; requestId?: number; }
export interface DeleteProjectRequest { type: 'delete-project'; projectId: string; requestId?: number; }
export interface AddScreenRequest { type: 'add-screen'; route: string; label: string; requestId?: number; }
export interface AddCommentRequest { type: 'add-comment'; screenId: string; anchor: CommentAnchor; text: string; requestId?: number; }
export interface DeleteCommentRequest { type: 'delete-comment'; commentId: string; requestId?: number; }
export interface ProxyUrlRequest { type: 'proxy-url'; url: string; requestId?: number; }

export type AppMessage =
  | ListProjectsRequest
  | LoadProjectRequest
  | CreateProjectRequest
  | DeleteProjectRequest
  | AddScreenRequest
  | AddCommentRequest
  | DeleteCommentRequest
  | ProxyUrlRequest;

// ─── Daemon → App (WebSocket) ───────────────────────────────────────────────

export interface ProjectListMessage {
  type: 'project-list';
  requestId?: number;
  projects: Array<{ name: string; projectId: string; contentType: string; modified: string; commentCount: number }>;
}

export interface ProjectLoadedMessage {
  type: 'project-loaded';
  requestId?: number;
  project: ProjectV2;
  comments: Comment[];
}

export interface CommentAddedMessage {
  type: 'comment-added';
  comment: Comment;
}

export interface ProxyReadyMessage {
  type: 'proxy-ready';
  requestId?: number;
  proxyUrl: string;
}

export interface ErrorMessage {
  type: 'error';
  requestId?: number;
  error: string;
}

export type DaemonMessage =
  | ProjectListMessage
  | ProjectLoadedMessage
  | CommentAddedMessage
  | ProxyReadyMessage
  | ErrorMessage;

// ─── Paths ──────────────────────────────────────────────────────────────────

export const FRANK_DIR = `${process.env.HOME}/.frank`;
export const PROJECTS_DIR = `${process.env.HOME}/.frank/projects`;
export const CONFIG_PATH = `${process.env.HOME}/.frank/config.json`;

export const WEBSOCKET_PORT = 42069;
export const HTTP_PORT = 42068;

// Marker used in CLAUDE.md to identify our injected block
export const INJECT_MARKER_START = '<!-- FRANK:START -->';
export const INJECT_MARKER_END = '<!-- FRANK:END -->';
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

Expected: Build succeeds (other files will have errors — that's expected, we'll fix them in subsequent tasks).

Actually, the build will fail because server.ts and projects.ts import old types. That's fine — we'll fix those files in Tasks 2-3. For now, verify protocol.ts itself has no syntax errors:

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npx tsc --noEmit daemon/src/protocol.ts 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add daemon/src/protocol.ts
git commit -m "feat(daemon): v2 protocol types — URL-based projects, element-anchored comments"
```

---

## Task 2: Rewrite projects.ts for v2

Replace wireframe-based project model with URL/file-based projects stored in `~/.frank/projects/`.

**Files:**
- Modify: `daemon/src/projects.ts`

- [ ] **Step 1: Rewrite projects.ts**

```ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECTS_DIR, type ProjectV2, type Comment } from './protocol.js';

export function ensureProjectsDir(): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function projectDir(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId);
}

function projectJsonPath(projectId: string): string {
  return path.join(projectDir(projectId), 'project.json');
}

function commentsJsonPath(projectId: string): string {
  return path.join(projectDir(projectId), 'comments.json');
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export function listProjects(): Array<{ name: string; projectId: string; contentType: string; modified: string; commentCount: number }> {
  ensureProjectsDir();
  const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  const projects: Array<{ name: string; projectId: string; contentType: string; modified: string; commentCount: number }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(PROJECTS_DIR, entry.name, 'project.json');
    if (!fs.existsSync(jsonPath)) continue;
    try {
      const project = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ProjectV2;
      const comments = loadComments(entry.name);
      projects.push({
        name: project.name,
        projectId: entry.name,
        contentType: project.contentType,
        modified: project.modified,
        commentCount: comments.length,
      });
    } catch {
      // Skip corrupted project files
    }
  }

  return projects.sort((a, b) => b.modified.localeCompare(a.modified));
}

export function loadProject(projectId: string): ProjectV2 {
  const jsonPath = projectJsonPath(projectId);
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ProjectV2;
}

export function createProject(name: string, contentType: 'url' | 'pdf' | 'image', url?: string, file?: string): { project: ProjectV2; projectId: string } {
  ensureProjectsDir();
  const projectId = slugify(name) + '-' + crypto.randomBytes(3).toString('hex');
  const dir = projectDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'snapshots'), { recursive: true });

  const now = new Date().toISOString();
  const project: ProjectV2 = {
    frank_version: '2',
    name,
    contentType,
    ...(url ? { url } : {}),
    ...(file ? { file } : {}),
    screens: {},
    screenOrder: [],
    capture: true,
    activeShare: null,
    created: now,
    modified: now,
  };

  atomicWrite(projectJsonPath(projectId), JSON.stringify(project, null, 2));
  atomicWrite(commentsJsonPath(projectId), '[]');
  return { project, projectId };
}

export function saveProject(projectId: string, project: ProjectV2): void {
  project.modified = new Date().toISOString();
  atomicWrite(projectJsonPath(projectId), JSON.stringify(project, null, 2));
}

export function deleteProject(projectId: string): void {
  const dir = projectDir(projectId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Screens ────────────────────────────────────────────────────────────────

export function addScreen(projectId: string, route: string, label: string): ProjectV2 {
  const project = loadProject(projectId);
  const screenId = slugify(label) + '-' + crypto.randomBytes(2).toString('hex');
  project.screens[screenId] = { route, label };
  project.screenOrder.push(screenId);
  saveProject(projectId, project);
  return project;
}

// ─── Comments ───────────────────────────────────────────────────────────────

export function loadComments(projectId: string): Comment[] {
  const jsonPath = commentsJsonPath(projectId);
  if (!fs.existsSync(jsonPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Comment[];
  } catch {
    return [];
  }
}

export function addComment(projectId: string, comment: Omit<Comment, 'id' | 'ts' | 'status'>): Comment {
  const comments = loadComments(projectId);
  const newComment: Comment = {
    ...comment,
    id: 'c-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
    ts: new Date().toISOString(),
    status: 'pending',
  };
  comments.push(newComment);
  atomicWrite(commentsJsonPath(projectId), JSON.stringify(comments, null, 2));
  return newComment;
}

export function deleteComment(projectId: string, commentId: string): boolean {
  const comments = loadComments(projectId);
  const filtered = comments.filter(c => c.id !== commentId);
  if (filtered.length === comments.length) return false;
  atomicWrite(commentsJsonPath(projectId), JSON.stringify(filtered, null, 2));
  return true;
}
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npx tsc --noEmit src/projects.ts 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add daemon/src/projects.ts
git commit -m "feat(daemon): v2 project model — URL/file based with element-anchored comments"
```

---

## Task 3: Add content proxy

Create the HTTP proxy that handles iframe-restricted URLs.

**Files:**
- Create: `daemon/src/proxy.ts`

- [ ] **Step 1: Create proxy.ts**

```ts
import http from 'http';
import https from 'https';
import { URL } from 'url';

// Validates that a URL is safe to proxy
export function validateProxyUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { valid: false, error: 'Only HTTP and HTTPS URLs are allowed' };
    }
    // Block localhost/private IPs from being proxied (they're already accessible)
    // Exception: allow localhost since that's a primary use case
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL' };
  }
}

// Fetches a URL and returns the response with iframe-restrictive headers stripped
export function proxyRequest(
  targetUrl: string,
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  const validation = validateProxyUrl(targetUrl);
  if (!validation.valid) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: validation.error }));
    return;
  }

  const parsedUrl = new URL(targetUrl);
  const client = parsedUrl.protocol === 'https:' ? https : http;

  const proxyReq = client.request(
    targetUrl,
    {
      method: req.method || 'GET',
      headers: {
        ...req.headers,
        host: parsedUrl.host,
      },
      // Do not follow redirects automatically — let the browser handle them
      // through the proxy
    },
    (proxyRes) => {
      const headers: Record<string, string | string[]> = {};

      // Copy response headers, stripping iframe-restrictive ones
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (!value) continue;
        const lowerKey = key.toLowerCase();

        // Strip iframe-restrictive headers
        if (lowerKey === 'x-frame-options') continue;
        if (lowerKey === 'content-security-policy') {
          // Remove frame-ancestors directive but keep the rest
          const cspValue = Array.isArray(value) ? value.join(', ') : value;
          const cleaned = cspValue
            .split(';')
            .filter(d => !d.trim().toLowerCase().startsWith('frame-ancestors'))
            .join(';')
            .trim();
          if (cleaned) headers[key] = cleaned;
          continue;
        }

        headers[key] = value;
      }

      res.writeHead(proxyRes.statusCode || 200, headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
  });

  // Forward request body for POST/PUT
  req.pipe(proxyReq);
}
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npx tsc --noEmit src/proxy.ts 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add daemon/src/proxy.ts
git commit -m "feat(daemon): content proxy — strips iframe-restrictive headers for URL wrapping"
```

---

## Task 4: Rewrite server.ts for v2

Remove the schema file watcher and wireframe logic. Keep the HTTP server, WebSocket server, and project management. Add proxy routing and v2 message handling.

**Files:**
- Modify: `daemon/src/server.ts`

- [ ] **Step 1: Rewrite server.ts**

```ts
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  WEBSOCKET_PORT, HTTP_PORT, FRANK_DIR,
  type AppMessage, type DaemonMessage, type Comment,
} from './protocol.js';
import {
  listProjects, loadProject, createProject, deleteProject,
  addScreen, loadComments, addComment, deleteComment,
} from './projects.js';
import { proxyRequest } from './proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UI_DIR = path.resolve(__dirname, '../../ui-v2');

const panelClients = new Set<WebSocket>();
let activeProjectId: string | null = null;

// Active proxy targets: maps a slug to a target URL
const proxyTargets = new Map<string, string>();

export function startServer(): void {
  fs.mkdirSync(FRANK_DIR, { recursive: true });
  startWebSocketServer();
  startHttpServer();
  console.log(`[frank] daemon started`);
  console.log(`[frank] websocket:   ws://localhost:${WEBSOCKET_PORT}`);
  console.log(`[frank] ui:          http://localhost:${HTTP_PORT}`);
}

// ─── HTTP server ────────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.pdf':  'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function startHttpServer(): void {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // Proxy routes: /proxy/<slug>/*
    if (url.pathname.startsWith('/proxy/')) {
      const parts = url.pathname.slice('/proxy/'.length).split('/');
      const slug = parts[0];
      const targetBase = proxyTargets.get(slug);
      if (!targetBase) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown proxy target' }));
        return;
      }
      const remainder = '/' + parts.slice(1).join('/') + (url.search || '');
      const targetUrl = new URL(remainder, targetBase).toString();
      proxyRequest(targetUrl, req, res);
      return;
    }

    // Serve files from project directories (for PDF/image viewing)
    if (url.pathname.startsWith('/files/')) {
      const filePath = decodeURIComponent(url.pathname.slice('/files/'.length));
      // Only serve files from ~/.frank/ to prevent directory traversal
      const fullPath = path.resolve(FRANK_DIR, filePath);
      if (!fullPath.startsWith(FRANK_DIR)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      serveStaticFile(fullPath, res);
      return;
    }

    // Static file serving (UI)
    let urlPath = url.pathname;
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const filePath = path.join(UI_DIR, urlPath);
    if (!filePath.startsWith(UI_DIR)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    serveStaticFile(filePath, res);
  });

  server.listen(HTTP_PORT, () => {
    console.log(`[frank] http server listening on port ${HTTP_PORT}`);
  });
  server.on('error', (err) => {
    console.error(`[frank] http server error:`, err.message);
  });
}

function serveStaticFile(filePath: string, res: http.ServerResponse): void {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

// ─── WebSocket server ───────────────────────────────────────────────────────

function startWebSocketServer(): void {
  const wss = new WebSocketServer({ port: WEBSOCKET_PORT });

  wss.on('connection', (ws) => {
    panelClients.add(ws);
    console.log(`[frank] client connected (${panelClients.size} total)`);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as AppMessage;
        handleMessage(ws, msg);
      } catch (e) {
        console.warn('[frank] message error:', e);
      }
    });

    ws.on('close', () => {
      panelClients.delete(ws);
      console.log(`[frank] client disconnected (${panelClients.size} remaining)`);
    });
    ws.on('error', () => { panelClients.delete(ws); });
  });

  wss.on('error', (err) => {
    console.error(`[frank] websocket error:`, err.message);
  });
}

function handleMessage(ws: WebSocket, msg: AppMessage): void {
  const reply = (data: Record<string, unknown>) => {
    ws.send(JSON.stringify({ ...data, requestId: (msg as any).requestId }));
  };

  switch (msg.type) {
    case 'list-projects': {
      try {
        const projects = listProjects();
        reply({ type: 'project-list', projects });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'load-project': {
      try {
        const project = loadProject(msg.projectId);
        const comments = loadComments(msg.projectId);
        activeProjectId = msg.projectId;
        reply({ type: 'project-loaded', project, comments });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'create-project': {
      try {
        const { project, projectId } = createProject(msg.name, msg.contentType, msg.url, msg.file);
        activeProjectId = projectId;
        reply({ type: 'project-loaded', project, comments: [] });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'delete-project': {
      try {
        deleteProject(msg.projectId);
        if (activeProjectId === msg.projectId) activeProjectId = null;
        reply({ type: 'project-list', projects: listProjects() });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'add-screen': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const project = addScreen(activeProjectId, msg.route, msg.label);
        const comments = loadComments(activeProjectId);
        reply({ type: 'project-loaded', project, comments });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'add-comment': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const comment = addComment(activeProjectId, {
          screenId: msg.screenId,
          anchor: msg.anchor,
          author: 'You',
          text: msg.text,
        });
        broadcast({ type: 'comment-added', comment } as any);
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'delete-comment': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        deleteComment(activeProjectId, msg.commentId);
        // Reload and broadcast updated comments
        const project = loadProject(activeProjectId);
        const comments = loadComments(activeProjectId);
        reply({ type: 'project-loaded', project, comments });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'proxy-url': {
      try {
        const slug = 'p-' + Date.now().toString(36);
        proxyTargets.set(slug, msg.url);
        reply({ type: 'proxy-ready', proxyUrl: `http://localhost:${HTTP_PORT}/proxy/${slug}/` });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }
  }
}

function broadcast(message: DaemonMessage): void {
  const payload = JSON.stringify(message);
  for (const client of panelClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}
```

- [ ] **Step 2: Build the full daemon**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

Expected: Build succeeds. If there are import errors from inject.ts or shares.ts referencing old types, those files need minor updates — shares.ts is untouched and doesn't import from protocol.ts directly, but inject.ts may need the import path updated.

- [ ] **Step 3: Fix inject.ts imports if needed**

Read `daemon/src/inject.ts` and update any imports that reference removed types from protocol.ts. The inject markers (`INJECT_MARKER_START`, `INJECT_MARKER_END`) are still in protocol.ts, so inject.ts should compile. If it doesn't, update the imports.

- [ ] **Step 4: Verify build passes clean**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build 2>&1
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add daemon/src/server.ts daemon/src/inject.ts
git commit -m "feat(daemon): v2 server — URL proxy, element comments, remove wireframe logic"
```

---

## Task 5: Update CLI for v2

Update the CLI to reflect v2 behavior. Remove wireframe-specific messaging. Add `connect` and `status` commands (stubs for Phase 2).

**Files:**
- Modify: `daemon/src/cli.ts`

- [ ] **Step 1: Rewrite cli.ts**

```ts
#!/usr/bin/env node
// Frank CLI entry point.
//
// Commands:
//   frank start    — inject CLAUDE.md, start daemon, open browser
//   frank stop     — remove CLAUDE.md injection
//   frank connect  — connect to a Frank Cloud instance (Phase 2)
//   frank status   — show daemon and cloud status (Phase 2)

import fs from 'fs';
import { execFile } from 'child_process';
import { FRANK_DIR, HTTP_PORT } from './protocol.js';

const command = process.argv[2];

switch (command) {
  case 'start':
    await runStart();
    break;
  case 'stop':
    await runStop();
    break;
  case 'connect':
    console.log('[frank] connect: coming in Phase 2 (cloud sharing)');
    console.log('[frank] usage: frank connect <cloud-url> --key <api-key>');
    process.exit(0);
    break;
  case 'status':
    console.log('[frank] status: coming in Phase 2');
    process.exit(0);
    break;
  default:
    console.log('Frank — collaboration layer for any web content');
    console.log('');
    console.log('Usage:');
    console.log('  frank start     Start Frank and open the browser');
    console.log('  frank stop      Stop Frank and remove Claude Code hooks');
    console.log('  frank connect   Connect to your Frank Cloud instance');
    console.log('  frank status    Show daemon and connection status');
    process.exit(0);
}

async function runStart(): Promise<void> {
  console.log('[frank] starting...');

  fs.mkdirSync(FRANK_DIR, { recursive: true });

  const { injectClaudeMd } = await import('./inject.js');
  injectClaudeMd();

  const { startServer } = await import('./server.js');
  startServer();

  const url = `http://localhost:${HTTP_PORT}`;
  execFile('open', [url], (err) => {
    if (err) console.warn('[frank] could not open browser:', err.message);
    else console.log(`[frank] opened ${url}`);
  });

  console.log('[frank] ready — open a URL or drop a file to start collaborating');
  console.log('[frank] press Ctrl+C to stop');

  process.on('SIGINT', async () => {
    console.log('\n[frank] stopping...');
    await runStop();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await runStop();
    process.exit(0);
  });
}

async function runStop(): Promise<void> {
  const { removeClaudeMd } = await import('./inject.js');
  removeClaudeMd();
  console.log('[frank] stopped');
}
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

- [ ] **Step 3: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add daemon/src/cli.ts
git commit -m "feat(daemon): v2 CLI — updated commands and messaging"
```

---

## Task 6: Scaffold the v2 browser UI

Create the new `ui-v2/` directory with the entry point, app shell, styles, and WebSocket client.

**Files:**
- Create: `ui-v2/index.html`
- Create: `ui-v2/app.js`
- Create: `ui-v2/core/sync.js`
- Create: `ui-v2/core/project.js`
- Create: `ui-v2/styles/tokens.css`
- Create: `ui-v2/styles/app.css`

- [ ] **Step 1: Create ui-v2 directory structure**

```bash
mkdir -p /Users/carlostarrats/Documents/frank/ui-v2/{core,views,overlay,components,styles}
```

- [ ] **Step 2: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Frank</title>
  <link rel="stylesheet" href="styles/tokens.css">
  <link rel="stylesheet" href="styles/app.css">
  <link rel="stylesheet" href="styles/overlay.css">
  <link rel="stylesheet" href="styles/comments.css">
</head>
<body>
  <div id="app">
    <div id="view-home" class="view active"></div>
    <div id="view-viewer" class="view"></div>
  </div>
  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create tokens.css**

Port the dark theme tokens from the v1 `ui/styles/tokens.css`. Read the existing file and copy the `:root` variables and reset rules. Key tokens:

```css
:root {
  --bg-app: #0d0d0d;
  --bg-surface: #1a1a1a;
  --bg-elevated: #242424;
  --border: #2a2a2a;
  --border-hover: #3a3a3a;
  --text-primary: #e8e8e8;
  --text-secondary: #888;
  --text-muted: #555;
  --accent: #4a9eff;
  --accent-hover: #6ab0ff;
  --danger: #ff4a4a;
  --success: #4aff8b;
  --warning: #ffb84a;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
  background: var(--bg-app);
  color: var(--text-primary);
  overflow: hidden;
  height: 100vh;
  font-size: 14px;
  line-height: 1.5;
}

#app { height: 100vh; display: flex; flex-direction: column; }

.view { display: none; flex: 1; flex-direction: column; overflow: hidden; }
.view.active { display: flex; }

button { cursor: pointer; font-family: inherit; }
input, textarea { font-family: inherit; }
```

- [ ] **Step 4: Create app.css**

```css
/* App chrome styles */

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  height: 48px;
  flex-shrink: 0;
}

.toolbar-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.toolbar-btn {
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  transition: all 0.15s;
}
.toolbar-btn:hover {
  border-color: var(--border-hover);
  color: var(--text-primary);
  background: var(--bg-elevated);
}

.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
}
.btn-primary:hover { background: var(--accent-hover); }

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: none;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
}
.btn-ghost:hover { color: var(--text-primary); background: var(--bg-elevated); }

.input {
  padding: 8px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
}
.input:focus { border-color: var(--accent); }
.input::placeholder { color: var(--text-muted); }
```

- [ ] **Step 5: Create sync.js (WebSocket client)**

```js
// sync.js — WebSocket client. All file I/O goes through the daemon.

const WS_URL = 'ws://localhost:42069';
let ws = null;
let pendingRequests = new Map();
let requestId = 0;
let messageHandlers = [];
let isConnected = false;
let reconnectTimer = null;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[sync] connected');
    isConnected = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.requestId && pendingRequests.has(msg.requestId)) {
        const { resolve } = pendingRequests.get(msg.requestId);
        pendingRequests.delete(msg.requestId);
        resolve(msg);
        return;
      }
      // Broadcast to all registered handlers
      for (const handler of messageHandlers) handler(msg);
    } catch (e) {
      console.warn('[sync] parse error:', e);
    }
  };

  ws.onclose = () => {
    console.log('[sync] disconnected');
    isConnected = false;
    reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onerror = () => {};
}

function send(msg) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected'));
      return;
    }
    const id = ++requestId;
    msg.requestId = id;
    pendingRequests.set(id, { resolve, reject });
    ws.send(JSON.stringify(msg));
    // Timeout after 10s
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }
    }, 10000);
  });
}

const sync = {
  connect,
  onMessage(handler) { messageHandlers.push(handler); },
  offMessage(handler) { messageHandlers = messageHandlers.filter(h => h !== handler); },

  listProjects() { return send({ type: 'list-projects' }); },
  loadProject(projectId) { return send({ type: 'load-project', projectId }); },
  createProject(name, contentType, url, file) {
    return send({ type: 'create-project', name, contentType, url, file });
  },
  deleteProject(projectId) { return send({ type: 'delete-project', projectId }); },
  addScreen(route, label) { return send({ type: 'add-screen', route, label }); },
  addComment(screenId, anchor, text) {
    return send({ type: 'add-comment', screenId, anchor, text });
  },
  deleteComment(commentId) { return send({ type: 'delete-comment', commentId }); },
  requestProxy(url) { return send({ type: 'proxy-url', url }); },
};

export default sync;
```

- [ ] **Step 6: Create project.js (in-memory state manager)**

```js
// project.js — In-memory project state. Syncs with daemon.

let project = null;
let projectId = null;
let comments = [];
let changeListeners = [];

const projectManager = {
  get() { return project; },
  getId() { return projectId; },
  getComments() { return comments; },
  getCommentsForScreen(screenId) { return comments.filter(c => c.screenId === screenId); },

  setFromLoaded(data) {
    project = data.project;
    projectId = data.projectId || projectId;
    comments = data.comments || [];
    this._notify();
  },

  addComment(comment) {
    comments.push(comment);
    this._notify();
  },

  clear() {
    project = null;
    projectId = null;
    comments = [];
    this._notify();
  },

  onChange(fn) { changeListeners.push(fn); },
  offChange(fn) { changeListeners = changeListeners.filter(f => f !== fn); },
  _notify() { for (const fn of changeListeners) fn(); },
};

export default projectManager;
```

- [ ] **Step 7: Create app.js (app shell)**

```js
// app.js — App shell: view router, state management
import sync from './core/sync.js';
import projectManager from './core/project.js';
import { renderHome } from './views/home.js';
import { renderViewer } from './views/viewer.js';

const state = {
  currentView: 'home',
};

function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.add('active');
  state.currentView = view;

  if (view === 'home') {
    renderHome(document.getElementById('view-home'), {
      onOpenProject(projectId) {
        sync.loadProject(projectId).then(data => {
          projectManager.setFromLoaded({ ...data, projectId });
          switchView('viewer');
        });
      },
      onCreateProject(name, contentType, url) {
        sync.createProject(name, contentType, url).then(data => {
          projectManager.setFromLoaded(data);
          switchView('viewer');
        });
      },
    });
  }

  if (view === 'viewer') {
    renderViewer(document.getElementById('view-viewer'), {
      onBack() {
        projectManager.clear();
        switchView('home');
      },
    });
  }
}

// Listen for pushed messages from daemon
sync.onMessage((msg) => {
  if (msg.type === 'comment-added') {
    projectManager.addComment(msg.comment);
  }
});

// Boot
sync.connect();
// Wait a beat for WebSocket to connect, then render home
setTimeout(() => switchView('home'), 100);
```

- [ ] **Step 8: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add ui-v2/
git commit -m "feat(ui): scaffold v2 browser UI — app shell, sync client, project state, styles"
```

---

## Task 7: Build the Home view

The project list — create new, open existing, delete.

**Files:**
- Create: `ui-v2/views/home.js`
- Create: `ui-v2/components/url-input.js`

- [ ] **Step 1: Create url-input.js**

```js
// url-input.js — URL/file input with validation and project creation

export function renderUrlInput(container, { onSubmit }) {
  container.innerHTML = `
    <div class="url-input-wrapper">
      <div class="url-input-header">
        <h2>What are you working on?</h2>
        <p class="url-input-subtitle">Paste a URL or drop a file to start collaborating</p>
      </div>
      <div class="url-input-form">
        <input
          type="text"
          class="input url-input-field"
          placeholder="https://localhost:3000 or any URL..."
          id="url-field"
          autofocus
        >
        <input
          type="text"
          class="input url-input-name"
          placeholder="Project name"
          id="name-field"
        >
        <button class="btn-primary" id="url-submit">Open</button>
      </div>
      <div class="url-input-hint">
        <span>Supports: URLs (localhost, staging, production), PDFs, and images</span>
      </div>
      <div class="url-input-error" id="url-error" style="display:none"></div>
    </div>
  `;

  const urlField = container.querySelector('#url-field');
  const nameField = container.querySelector('#name-field');
  const submitBtn = container.querySelector('#url-submit');
  const errorEl = container.querySelector('#url-error');

  // Auto-fill name from URL
  urlField.addEventListener('input', () => {
    if (!nameField.value) {
      try {
        const url = new URL(urlField.value);
        nameField.placeholder = url.hostname || 'Project name';
      } catch {
        nameField.placeholder = 'Project name';
      }
    }
  });

  function submit() {
    const url = urlField.value.trim();
    const name = nameField.value.trim() || urlField.value.trim().split('/').pop() || 'Untitled';
    if (!url) {
      errorEl.textContent = 'Enter a URL';
      errorEl.style.display = 'block';
      return;
    }

    // Validate URL
    try {
      const parsed = new URL(url.startsWith('http') ? url : 'http://' + url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only HTTP/HTTPS URLs supported');
      }
      errorEl.style.display = 'none';
      onSubmit(name, 'url', parsed.toString());
    } catch (e) {
      errorEl.textContent = e.message || 'Invalid URL';
      errorEl.style.display = 'block';
    }
  }

  submitBtn.addEventListener('click', submit);
  urlField.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  nameField.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}
```

- [ ] **Step 2: Create home.js**

```js
// home.js — Project list: create, open, delete
import sync from '../core/sync.js';
import { renderUrlInput } from '../components/url-input.js';

export function renderHome(container, { onOpenProject, onCreateProject }) {
  container.innerHTML = `
    <div class="home">
      <div class="home-header">
        <h1 class="home-title">Frank</h1>
      </div>
      <div class="home-content">
        <div class="home-new" id="home-new"></div>
        <div class="home-projects" id="home-projects">
          <h3 class="home-section-title">Recent projects</h3>
          <div class="project-list" id="project-list">
            <div class="project-list-loading">Loading...</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render URL input
  renderUrlInput(container.querySelector('#home-new'), {
    onSubmit(name, contentType, url) {
      onCreateProject(name, contentType, url);
    },
  });

  // Load project list
  sync.listProjects().then(data => {
    const list = container.querySelector('#project-list');
    const projects = data.projects || [];

    if (projects.length === 0) {
      list.innerHTML = '<p class="project-list-empty">No projects yet</p>';
      return;
    }

    list.innerHTML = projects.map(p => `
      <div class="project-card" data-id="${p.projectId}">
        <div class="project-card-info">
          <span class="project-card-name">${escapeHtml(p.name)}</span>
          <span class="project-card-meta">${p.contentType} · ${p.commentCount} comments · ${timeAgo(p.modified)}</span>
        </div>
        <div class="project-card-actions">
          <button class="btn-ghost project-delete" data-id="${p.projectId}" title="Delete">×</button>
        </div>
      </div>
    `).join('');

    // Open project on click
    list.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.project-delete')) return;
        onOpenProject(card.dataset.id);
      });
    });

    // Delete project
    list.querySelectorAll('.project-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Delete this project and all its data?')) {
          sync.deleteProject(btn.dataset.id).then(() => {
            renderHome(container, { onOpenProject, onCreateProject });
          });
        }
      });
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

- [ ] **Step 3: Add home styles to app.css**

Append to `ui-v2/styles/app.css`:

```css
/* Home view */
.home {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 40px;
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
}

.home-title {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 32px;
}

.home-content {
  display: flex;
  flex-direction: column;
  gap: 40px;
}

.home-section-title {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin-bottom: 12px;
}

/* URL input */
.url-input-wrapper { display: flex; flex-direction: column; gap: 16px; }
.url-input-header h2 { font-size: 18px; font-weight: 600; }
.url-input-subtitle { color: var(--text-secondary); font-size: 14px; margin-top: 4px; }
.url-input-form { display: flex; gap: 8px; }
.url-input-field { flex: 2; }
.url-input-name { flex: 1; }
.url-input-hint { font-size: 12px; color: var(--text-muted); }
.url-input-error { font-size: 13px; color: var(--danger); }

/* Project list */
.project-list { display: flex; flex-direction: column; gap: 4px; }
.project-list-loading, .project-list-empty { color: var(--text-muted); font-size: 14px; padding: 12px 0; }
.project-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s;
}
.project-card:hover { background: var(--bg-surface); }
.project-card-name { font-weight: 500; }
.project-card-meta { font-size: 12px; color: var(--text-muted); margin-left: 12px; }
.project-card-actions { opacity: 0; transition: opacity 0.15s; }
.project-card:hover .project-card-actions { opacity: 1; }
.project-delete { font-size: 18px; color: var(--text-muted); }
.project-delete:hover { color: var(--danger); }
```

- [ ] **Step 4: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add ui-v2/views/home.js ui-v2/components/url-input.js ui-v2/styles/app.css
git commit -m "feat(ui): home view — project list with create, open, delete"
```

---

## Task 8: Build the Viewer — iframe wrapper + toolbar

The core content viewing experience: load a URL in an iframe, display a toolbar with project name and back button.

**Files:**
- Create: `ui-v2/views/viewer.js`
- Create: `ui-v2/components/toolbar.js`

- [ ] **Step 1: Create toolbar.js**

```js
// toolbar.js — Top toolbar for the viewer

export function renderToolbar(container, { projectName, url, onBack, onShare }) {
  container.innerHTML = `
    <div class="toolbar">
      <button class="btn-ghost toolbar-back" id="toolbar-back">← Back</button>
      <span class="toolbar-title">${escapeHtml(projectName)}</span>
      <span class="toolbar-url">${escapeHtml(url || '')}</span>
      <div class="toolbar-spacer"></div>
      <button class="toolbar-btn" id="toolbar-comment-toggle" title="Toggle comments">💬</button>
      <button class="toolbar-btn" id="toolbar-share" disabled title="Share (Phase 2)">Share</button>
    </div>
  `;

  container.querySelector('#toolbar-back').addEventListener('click', onBack);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

- [ ] **Step 2: Create viewer.js**

```js
// viewer.js — Content viewer: iframe wrapper with overlay and comments
import sync from '../core/sync.js';
import projectManager from '../core/project.js';
import { renderToolbar } from '../components/toolbar.js';

export function renderViewer(container, { onBack }) {
  const project = projectManager.get();
  if (!project) { onBack(); return; }

  container.innerHTML = `
    <div class="viewer-toolbar" id="viewer-toolbar"></div>
    <div class="viewer-body">
      <div class="viewer-content" id="viewer-content">
        <div class="viewer-loading">Loading content...</div>
      </div>
      <div class="viewer-sidebar" id="viewer-sidebar"></div>
    </div>
  `;

  // Render toolbar
  renderToolbar(container.querySelector('#viewer-toolbar'), {
    projectName: project.name,
    url: project.url || project.file || '',
    onBack,
  });

  // Toggle comment sidebar
  const sidebar = container.querySelector('#viewer-sidebar');
  const commentToggle = container.querySelector('#toolbar-comment-toggle');
  if (commentToggle) {
    commentToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }

  // Load content based on type
  const contentEl = container.querySelector('#viewer-content');

  if (project.contentType === 'url' && project.url) {
    loadUrlContent(contentEl, project.url);
  } else if (project.contentType === 'pdf' && project.file) {
    loadPdfContent(contentEl, project.file);
  } else if (project.contentType === 'image' && project.file) {
    loadImageContent(contentEl, project.file);
  } else {
    contentEl.innerHTML = '<div class="viewer-error">No content to display</div>';
  }
}

async function loadUrlContent(container, url) {
  // Try direct iframe first
  container.innerHTML = `
    <div class="iframe-wrapper" id="iframe-wrapper">
      <iframe
        id="content-iframe"
        src="${escapeAttr(url)}"
        class="content-iframe"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      ></iframe>
      <div class="overlay" id="overlay"></div>
    </div>
  `;

  const iframe = container.querySelector('#content-iframe');

  // Detect iframe load failure (X-Frame-Options / CSP blocking)
  iframe.addEventListener('error', () => fallbackToProxy(container, url));

  // Also check after a timeout — some iframe blocks don't fire error events
  setTimeout(() => {
    try {
      // If we can't access contentDocument, iframe loaded but may be blocked
      const doc = iframe.contentDocument;
      if (!doc || !doc.body || doc.body.innerHTML === '') {
        fallbackToProxy(container, url);
      }
    } catch {
      // Cross-origin — try proxy
      fallbackToProxy(container, url);
    }
  }, 3000);
}

async function fallbackToProxy(container, url) {
  console.log('[viewer] iframe blocked, trying proxy...');
  try {
    const response = await sync.requestProxy(url);
    if (response.proxyUrl) {
      const iframe = container.querySelector('#content-iframe');
      if (iframe) {
        iframe.src = response.proxyUrl;
        console.log('[viewer] proxy active:', response.proxyUrl);
      }
    }
  } catch (e) {
    console.warn('[viewer] proxy failed:', e);
    container.innerHTML = `
      <div class="viewer-error">
        <h3>Unable to load this URL</h3>
        <p>The site may be blocking iframe embedding and the proxy couldn't reach it.</p>
        <p class="viewer-error-url">${escapeHtml(url)}</p>
      </div>
    `;
  }
}

function loadPdfContent(container, filePath) {
  container.innerHTML = `
    <div class="iframe-wrapper">
      <iframe
        src="/files/${encodeURIComponent(filePath)}"
        class="content-iframe"
      ></iframe>
      <div class="overlay" id="overlay"></div>
    </div>
  `;
}

function loadImageContent(container, filePath) {
  container.innerHTML = `
    <div class="image-wrapper">
      <img
        src="/files/${encodeURIComponent(filePath)}"
        class="content-image"
        alt="Project content"
      >
      <div class="overlay" id="overlay"></div>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 3: Add viewer styles to app.css**

Append to `ui-v2/styles/app.css`:

```css
/* Viewer layout */
.viewer-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.viewer-content {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.viewer-sidebar {
  width: 0;
  overflow: hidden;
  transition: width 0.2s;
  border-left: 1px solid var(--border);
  background: var(--bg-surface);
}
.viewer-sidebar.open {
  width: 360px;
}

.viewer-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
}

.viewer-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  text-align: center;
  gap: 8px;
}
.viewer-error h3 { color: var(--text-primary); }
.viewer-error-url { font-family: monospace; font-size: 12px; color: var(--text-muted); margin-top: 8px; }

/* Iframe wrapper */
.iframe-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.content-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

.image-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--bg-app);
  overflow: auto;
}
.content-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* Overlay (sits on top of iframe for click interception) */
.overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 10;
  pointer-events: none; /* Pass through by default, enable in comment mode */
}
.overlay.comment-mode {
  pointer-events: auto;
  cursor: crosshair;
}

/* Toolbar extras */
.toolbar-url {
  font-size: 12px;
  color: var(--text-muted);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}
.toolbar-spacer { flex: 1; }
```

- [ ] **Step 4: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add ui-v2/views/viewer.js ui-v2/components/toolbar.js ui-v2/styles/app.css
git commit -m "feat(ui): viewer — iframe wrapper with proxy fallback and toolbar"
```

---

## Task 9: Build the commenting overlay

Smart element detection, triple-anchor system, and the comment panel.

**Files:**
- Create: `ui-v2/overlay/element-detect.js`
- Create: `ui-v2/overlay/anchoring.js`
- Create: `ui-v2/overlay/highlight.js`
- Create: `ui-v2/overlay/overlay.js`
- Create: `ui-v2/components/comments.js`
- Create: `ui-v2/styles/overlay.css`
- Create: `ui-v2/styles/comments.css`

- [ ] **Step 1: Create element-detect.js**

```js
// element-detect.js — Smart element detection with forgiving clicks
// Bubbles up from clicked element to nearest "meaningful" target

const SKIP_TAGS = new Set([
  'SPAN', 'EM', 'STRONG', 'BR', 'I', 'B', 'SMALL', 'SUB', 'SUP',
  'ABBR', 'MARK', 'DEL', 'INS', 'WBR', 'CODE',
]);

const SEMANTIC_TAGS = new Set([
  'BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT', 'IMG', 'VIDEO',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'NAV', 'HEADER',
  'FOOTER', 'MAIN', 'SECTION', 'ARTICLE', 'FORM', 'TABLE',
  'FIGURE', 'ASIDE', 'DETAILS', 'DIALOG',
]);

export function findMeaningfulElement(target) {
  let el = target;

  // Walk up from clicked element
  while (el && el !== document.body && el !== document.documentElement) {
    // Skip text nodes
    if (el.nodeType === 3) { el = el.parentElement; continue; }

    // If this is a semantic element, stop here
    if (SEMANTIC_TAGS.has(el.tagName)) return el;

    // If this element has identity (class, id, or data attributes), stop
    if (el.id || el.classList.length > 0 || el.dataset.length > 0) {
      // But only if it's not a skip tag
      if (!SKIP_TAGS.has(el.tagName)) return el;
    }

    // If this element has visible boundaries (check computed styles)
    if (hasVisibleBoundaries(el) && !SKIP_TAGS.has(el.tagName)) return el;

    el = el.parentElement;
  }

  // Fallback: return the original target's nearest non-skip ancestor
  el = target;
  while (el && SKIP_TAGS.has(el.tagName)) {
    el = el.parentElement;
  }
  return el || target;
}

function hasVisibleBoundaries(el) {
  try {
    const style = window.getComputedStyle(el);
    // Has border
    if (style.borderWidth && style.borderWidth !== '0px' &&
        style.borderStyle && style.borderStyle !== 'none') return true;
    // Has background
    if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
        style.backgroundColor !== 'transparent') return true;
    // Has box shadow
    if (style.boxShadow && style.boxShadow !== 'none') return true;
    return false;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Create anchoring.js**

```js
// anchoring.js — Triple-anchor: CSS selector + DOM path + coordinates

export function createAnchor(element, iframeRect) {
  const rect = element.getBoundingClientRect();
  return {
    type: 'element',
    cssSelector: getCssSelector(element),
    domPath: getDomPath(element),
    x: iframeRect ? ((rect.left + rect.width / 2) / iframeRect.width) * 100 : 0,
    y: iframeRect ? ((rect.top + rect.height / 2) / iframeRect.height) * 100 : 0,
  };
}

export function createPinAnchor(x, y, containerRect, pageNumber) {
  return {
    type: 'pin',
    x: (x / containerRect.width) * 100,
    y: (y / containerRect.height) * 100,
    ...(pageNumber != null ? { pageNumber } : {}),
  };
}

export function resolveAnchor(anchor, document) {
  if (anchor.type === 'pin') {
    return { type: 'coordinates', x: anchor.x, y: anchor.y };
  }

  // Try CSS selector first
  if (anchor.cssSelector) {
    try {
      const el = document.querySelector(anchor.cssSelector);
      if (el) return { type: 'element', element: el };
    } catch { /* invalid selector */ }
  }

  // Try DOM path
  if (anchor.domPath) {
    try {
      const el = document.querySelector(anchor.domPath);
      if (el) return { type: 'element', element: el };
    } catch { /* invalid path */ }
  }

  // Fall back to coordinates
  return { type: 'coordinates', x: anchor.x, y: anchor.y, moved: true };
}

function getCssSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const parts = [];
  let current = el;
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    if (current.classList.length > 0) {
      // Use the first non-generic class
      const cls = Array.from(current.classList).find(c =>
        !c.startsWith('_') && c.length > 1 && c.length < 50
      );
      if (cls) selector += `.${CSS.escape(cls)}`;
    }

    // Add nth-child if needed for uniqueness
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

function getDomPath(el) {
  const parts = [];
  let current = el;
  while (current && current !== document.body) {
    const parent = current.parentElement;
    if (parent) {
      const index = Array.from(parent.children).indexOf(current) + 1;
      parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
    } else {
      parts.unshift(current.tagName.toLowerCase());
    }
    current = parent;
  }
  parts.unshift('body');
  return parts.join(' > ');
}
```

- [ ] **Step 3: Create highlight.js**

```js
// highlight.js — Element highlight rendering

let highlightEl = null;
let selectedEl = null;

export function showHighlight(targetElement, iframeEl) {
  if (!highlightEl) {
    highlightEl = document.createElement('div');
    highlightEl.className = 'element-highlight';
    document.body.appendChild(highlightEl);
  }

  const rect = getElementRectRelativeToViewport(targetElement, iframeEl);
  highlightEl.style.display = 'block';
  highlightEl.style.left = rect.left + 'px';
  highlightEl.style.top = rect.top + 'px';
  highlightEl.style.width = rect.width + 'px';
  highlightEl.style.height = rect.height + 'px';
}

export function showSelected(targetElement, iframeEl) {
  if (!selectedEl) {
    selectedEl = document.createElement('div');
    selectedEl.className = 'element-selected';
    document.body.appendChild(selectedEl);
  }

  const rect = getElementRectRelativeToViewport(targetElement, iframeEl);
  selectedEl.style.display = 'block';
  selectedEl.style.left = rect.left + 'px';
  selectedEl.style.top = rect.top + 'px';
  selectedEl.style.width = rect.width + 'px';
  selectedEl.style.height = rect.height + 'px';
}

export function clearHighlight() {
  if (highlightEl) highlightEl.style.display = 'none';
}

export function clearSelected() {
  if (selectedEl) selectedEl.style.display = 'none';
}

function getElementRectRelativeToViewport(element, iframeEl) {
  const elemRect = element.getBoundingClientRect();
  const iframeRect = iframeEl.getBoundingClientRect();
  return {
    left: iframeRect.left + elemRect.left,
    top: iframeRect.top + elemRect.top,
    width: elemRect.width,
    height: elemRect.height,
  };
}
```

- [ ] **Step 4: Create overlay.js**

```js
// overlay.js — Transparent overlay controller
import { findMeaningfulElement } from './element-detect.js';
import { createAnchor, createPinAnchor } from './anchoring.js';
import { showHighlight, showSelected, clearHighlight, clearSelected } from './highlight.js';

let commentMode = false;
let onCommentCreate = null;
let currentIframe = null;

export function setupOverlay(iframeEl, callbacks) {
  currentIframe = iframeEl;
  onCommentCreate = callbacks.onCommentCreate;

  // We need to intercept clicks inside the iframe
  // This only works for same-origin (localhost / proxied) content
  iframeEl.addEventListener('load', () => {
    try {
      const doc = iframeEl.contentDocument;
      if (!doc) return;

      doc.addEventListener('mousemove', (e) => {
        if (!commentMode) return;
        const target = findMeaningfulElement(e.target);
        showHighlight(target, iframeEl);
      });

      doc.addEventListener('click', (e) => {
        if (!commentMode) return;
        e.preventDefault();
        e.stopPropagation();

        const target = findMeaningfulElement(e.target);
        showSelected(target, iframeEl);
        clearHighlight();

        const iframeRect = iframeEl.getBoundingClientRect();
        const anchor = createAnchor(target, iframeRect);

        if (onCommentCreate) {
          onCommentCreate(anchor, target);
        }
      });

      doc.addEventListener('mouseleave', () => {
        clearHighlight();
      });
    } catch (e) {
      console.warn('[overlay] cannot attach to iframe (cross-origin):', e.message);
    }
  });
}

export function enableCommentMode() {
  commentMode = true;
  const overlay = document.querySelector('.overlay');
  if (overlay) overlay.classList.add('comment-mode');
}

export function disableCommentMode() {
  commentMode = false;
  clearHighlight();
  clearSelected();
  const overlay = document.querySelector('.overlay');
  if (overlay) overlay.classList.remove('comment-mode');
}

export function toggleCommentMode() {
  if (commentMode) disableCommentMode();
  else enableCommentMode();
  return commentMode;
}

export function isCommentModeActive() {
  return commentMode;
}
```

- [ ] **Step 5: Create comments.js**

```js
// comments.js — Comment panel

import sync from '../core/sync.js';
import projectManager from '../core/project.js';

export function renderComments(container, { screenId, onCommentModeToggle }) {
  function render() {
    const comments = screenId
      ? projectManager.getCommentsForScreen(screenId)
      : projectManager.getComments();

    container.innerHTML = `
      <div class="comments-panel">
        <div class="comments-header">
          <h3 class="comments-title">Comments (${comments.length})</h3>
          <button class="btn-ghost comments-add-btn" id="toggle-comment-mode">+ Add</button>
        </div>
        <div class="comments-list" id="comments-list">
          ${comments.length === 0
            ? '<p class="comments-empty">No comments yet. Click "+ Add" to start commenting on elements.</p>'
            : comments.map(c => `
                <div class="comment-item" data-id="${c.id}">
                  <div class="comment-header">
                    <span class="comment-author">${escapeHtml(c.author)}</span>
                    <span class="comment-time">${timeAgo(c.ts)}</span>
                    <button class="btn-ghost comment-delete" data-id="${c.id}" title="Delete">×</button>
                  </div>
                  <p class="comment-text">${escapeHtml(c.text)}</p>
                  ${c.anchor?.cssSelector ? `<span class="comment-anchor">${escapeHtml(c.anchor.cssSelector)}</span>` : ''}
                </div>
              `).join('')
          }
        </div>
        <div class="comment-input-area" id="comment-input-area" style="display:none">
          <textarea class="input comment-textarea" id="comment-text" placeholder="Add a comment..." rows="3"></textarea>
          <div class="comment-input-actions">
            <button class="btn-ghost" id="cancel-comment">Cancel</button>
            <button class="btn-primary" id="submit-comment">Comment</button>
          </div>
        </div>
      </div>
    `;

    // Toggle comment mode
    container.querySelector('#toggle-comment-mode')?.addEventListener('click', () => {
      if (onCommentModeToggle) onCommentModeToggle();
    });

    // Delete comment
    container.querySelectorAll('.comment-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        sync.deleteComment(btn.dataset.id);
      });
    });
  }

  render();

  // Re-render when project state changes
  projectManager.onChange(render);

  // Return cleanup function
  return () => { projectManager.offChange(render); };
}

// Called by overlay when user clicks an element to comment on
export function showCommentInput(container, anchor, onSubmit) {
  const inputArea = container.querySelector('#comment-input-area');
  if (!inputArea) return;
  inputArea.style.display = 'block';
  inputArea._anchor = anchor;

  const textarea = inputArea.querySelector('#comment-text');
  textarea.focus();

  const submitBtn = inputArea.querySelector('#submit-comment');
  const cancelBtn = inputArea.querySelector('#cancel-comment');

  const cleanup = () => {
    submitBtn.removeEventListener('click', handleSubmit);
    cancelBtn.removeEventListener('click', handleCancel);
  };

  const handleSubmit = () => {
    const text = textarea.value.trim();
    if (!text) return;
    onSubmit(anchor, text);
    textarea.value = '';
    inputArea.style.display = 'none';
    cleanup();
  };

  const handleCancel = () => {
    textarea.value = '';
    inputArea.style.display = 'none';
    cleanup();
  };

  submitBtn.addEventListener('click', handleSubmit);
  cancelBtn.addEventListener('click', handleCancel);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
    if (e.key === 'Escape') handleCancel();
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

- [ ] **Step 6: Create overlay.css**

```css
/* Overlay and highlight styles */
.element-highlight {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  border: 2px dashed rgba(74, 158, 255, 0.5);
  border-radius: 2px;
  background: rgba(74, 158, 255, 0.05);
  transition: all 0.1s;
  display: none;
}

.element-selected {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  border: 2px solid var(--accent);
  border-radius: 2px;
  background: rgba(74, 158, 255, 0.1);
  display: none;
}

.overlay.comment-mode {
  cursor: crosshair;
}
```

- [ ] **Step 7: Create comments.css**

```css
/* Comment panel styles */
.comments-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
}

.comments-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.comments-title {
  font-size: 14px;
  font-weight: 600;
}

.comments-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.comments-empty {
  color: var(--text-muted);
  font-size: 13px;
  padding: 12px 0;
}

.comment-item {
  padding: 12px;
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}

.comment-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.comment-author {
  font-size: 13px;
  font-weight: 600;
}

.comment-time {
  font-size: 11px;
  color: var(--text-muted);
}

.comment-delete {
  margin-left: auto;
  font-size: 16px;
  color: var(--text-muted);
  opacity: 0;
  transition: opacity 0.15s;
}
.comment-item:hover .comment-delete { opacity: 1; }
.comment-delete:hover { color: var(--danger); }

.comment-text {
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
}

.comment-anchor {
  display: inline-block;
  margin-top: 6px;
  font-size: 11px;
  font-family: monospace;
  color: var(--text-muted);
  background: var(--bg-surface);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

/* Comment input */
.comment-input-area {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  margin-top: 12px;
}

.comment-textarea {
  width: 100%;
  resize: none;
  min-height: 80px;
  margin-bottom: 8px;
}

.comment-input-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
```

- [ ] **Step 8: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add ui-v2/overlay/ ui-v2/components/comments.js ui-v2/styles/overlay.css ui-v2/styles/comments.css
git commit -m "feat(ui): commenting overlay — smart element detection, triple-anchor, comment panel"
```

---

## Task 10: Wire everything together

Connect the overlay to the viewer, integrate comments with the sidebar, and make the full flow work end-to-end.

**Files:**
- Modify: `ui-v2/views/viewer.js` — integrate overlay and comments
- Modify: `ui-v2/app.js` — fix the project ID tracking

- [ ] **Step 1: Update viewer.js to integrate overlay and comments**

Add imports at the top of `ui-v2/views/viewer.js`:

```js
import { setupOverlay, toggleCommentMode, disableCommentMode } from '../overlay/overlay.js';
import { renderComments, showCommentInput } from '../components/comments.js';
```

After the iframe loads in `loadUrlContent`, add overlay setup:

```js
// After setting iframe src, add:
iframe.addEventListener('load', () => {
  setupOverlay(iframe, {
    onCommentCreate(anchor, targetElement) {
      // Open sidebar if not already open
      const sidebar = document.querySelector('#viewer-sidebar');
      if (sidebar && !sidebar.classList.contains('open')) {
        sidebar.classList.add('open');
      }
      // Show comment input with the anchor
      showCommentInput(sidebar, anchor, (anchor, text) => {
        const screenId = Object.keys(projectManager.get()?.screens || {})[0] || 'default';
        sync.addComment(screenId, anchor, text);
        disableCommentMode();
      });
    },
  });
});
```

Add comment panel rendering after the sidebar element:

```js
// After creating the sidebar element, render comments into it:
const screenId = Object.keys(project.screens || {})[0] || null;
renderComments(sidebar, {
  screenId,
  onCommentModeToggle() {
    const isActive = toggleCommentMode();
    const btn = document.querySelector('#toggle-comment-mode');
    if (btn) btn.textContent = isActive ? '✕ Cancel' : '+ Add';
  },
});
```

- [ ] **Step 2: Fix app.js project ID tracking**

In `app.js`, the `onCreateProject` callback doesn't properly track the project ID. Update the `switchView('home')` block's `onCreateProject`:

```js
onCreateProject(name, contentType, url) {
  sync.createProject(name, contentType, url).then(data => {
    // The daemon returns the project in project-loaded format
    // Extract projectId from the project name slug
    projectManager.setFromLoaded(data);
    switchView('viewer');
  });
},
```

Also remove the `require_project_id` reference — that was a placeholder. The project ID comes back in the response from the daemon.

Update the protocol to include `projectId` in the `ProjectLoadedMessage`:

In `daemon/src/protocol.ts`, add `projectId` to `ProjectLoadedMessage`:
```ts
export interface ProjectLoadedMessage {
  type: 'project-loaded';
  requestId?: number;
  projectId?: string;
  project: ProjectV2;
  comments: Comment[];
}
```

In `daemon/src/server.ts`, include `projectId` in the reply for `create-project` and `load-project`:
```ts
// In create-project handler:
reply({ type: 'project-loaded', projectId, project, comments: [] });

// In load-project handler:
reply({ type: 'project-loaded', projectId: msg.projectId, project, comments });
```

- [ ] **Step 3: Build daemon with the protocol update**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

- [ ] **Step 4: Manual smoke test**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && node dist/cli.js start
```

1. Browser opens to `localhost:42068`
2. Enter a URL (e.g., `https://example.com`) and a project name
3. The site loads in an iframe
4. Click the comment toggle (💬) to open the sidebar
5. Click "+ Add" to enter comment mode
6. Click an element in the iframe — it highlights
7. Type a comment and submit
8. Comment appears in the sidebar
9. Click "← Back" to return to the home view
10. The project appears in the project list

- [ ] **Step 5: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add ui-v2/views/viewer.js ui-v2/app.js daemon/src/protocol.ts daemon/src/server.ts
git commit -m "feat: wire overlay + comments + viewer — end-to-end commenting flow"
```

---

## Task 11: Multi-page screen tracking

Detect iframe navigation and prompt to add new screens.

**Files:**
- Modify: `ui-v2/views/viewer.js` — add navigation detection
- Modify: `ui-v2/components/toolbar.js` — add screen selector

- [ ] **Step 1: Add navigation detection to viewer.js**

After iframe loads, add a URL change detector:

```js
// Inside loadUrlContent, after iframe load event:
let lastUrl = url;

// Poll for URL changes (works for both pushState and hash changes)
const navInterval = setInterval(() => {
  try {
    const currentUrl = iframe.contentWindow.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      handleNavigation(currentUrl);
    }
  } catch {
    // Cross-origin — can't read URL
  }
}, 1000);

// Clean up interval when view changes
const viewerEl = container.closest('.view');
const observer = new MutationObserver(() => {
  if (!viewerEl.classList.contains('active')) {
    clearInterval(navInterval);
    observer.disconnect();
  }
});
observer.observe(viewerEl, { attributes: true, attributeFilter: ['class'] });

function handleNavigation(newUrl) {
  const project = projectManager.get();
  if (!project) return;

  // Check if this route is already tracked
  const route = new URL(newUrl).pathname;
  const existing = Object.values(project.screens).find(s => s.route === route);
  if (existing) return;

  // Show prompt to add as new screen
  showNavigationPrompt(container, route, (label) => {
    sync.addScreen(route, label).then(data => {
      projectManager.setFromLoaded({ ...data, projectId: projectManager.getId() });
    });
  });
}

function showNavigationPrompt(container, route, onAdd) {
  const prompt = document.createElement('div');
  prompt.className = 'nav-prompt';
  prompt.innerHTML = `
    <span>New page detected: <code>${escapeHtml(route)}</code></span>
    <input type="text" class="input nav-prompt-name" placeholder="Screen name" value="${route.split('/').pop() || 'page'}">
    <button class="btn-primary nav-prompt-add">Add Screen</button>
    <button class="btn-ghost nav-prompt-dismiss">Dismiss</button>
  `;
  container.prepend(prompt);

  prompt.querySelector('.nav-prompt-add').addEventListener('click', () => {
    const label = prompt.querySelector('.nav-prompt-name').value.trim() || route;
    onAdd(label);
    prompt.remove();
  });
  prompt.querySelector('.nav-prompt-dismiss').addEventListener('click', () => prompt.remove());

  // Auto-dismiss after 10 seconds
  setTimeout(() => { if (prompt.parentNode) prompt.remove(); }, 10000);
}
```

- [ ] **Step 2: Add nav prompt styles to app.css**

Append to `ui-v2/styles/app.css`:

```css
/* Navigation prompt */
.nav-prompt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  animation: slideDown 0.2s;
}
.nav-prompt code {
  font-family: monospace;
  background: var(--bg-surface);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.nav-prompt-name {
  width: 150px;
  padding: 4px 8px;
  font-size: 13px;
}
@keyframes slideDown {
  from { transform: translateY(-100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/carlostarrats/Documents/frank
git add ui-v2/views/viewer.js ui-v2/components/toolbar.js ui-v2/styles/app.css
git commit -m "feat(ui): multi-page tracking — detect navigation, prompt to add screens"
```

---

## Task 12: Final integration test

End-to-end smoke test of the full Phase 1 flow.

**Files:** No new files.

- [ ] **Step 1: Build daemon**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && npm run build
```

- [ ] **Step 2: Start Frank and test the complete flow**

```bash
cd /Users/carlostarrats/Documents/frank/daemon && node dist/cli.js start
```

Test checklist:
1. Browser opens to `localhost:42068` — Home view renders
2. Enter `http://example.com` as URL, name it "Test Project"
3. Project creates, viewer loads with the site in an iframe
4. Click 💬 to open comment sidebar
5. Click "+ Add" to enter comment mode — cursor changes to crosshair
6. Hover over elements in the iframe — blue dashed outline follows
7. Click an element — solid blue outline, comment input appears
8. Type "This is a test comment" and press Cmd+Enter
9. Comment appears in the sidebar with author "You", the CSS selector shown
10. Click "← Back" — returns to Home view
11. "Test Project" appears in the project list with "1 comments"
12. Click the project to reopen — viewer loads, comment still there
13. Click × on the comment to delete it
14. Test with a localhost URL if you have a dev server running

- [ ] **Step 3: Fix any issues found during testing**

Address bugs found during the smoke test. Common issues:
- Import paths wrong (ES modules require `.js` extensions)
- CSS not loading (check `index.html` link paths)
- WebSocket message format mismatches between daemon and UI
- Iframe cross-origin issues (the overlay can't attach if the site is truly cross-origin and not proxied)

- [ ] **Step 4: Commit fixes**

```bash
cd /Users/carlostarrats/Documents/frank
git add -A
git commit -m "fix: Phase 1 integration fixes"
```

---

## Summary

12 tasks building the v2 foundation:

1. **Protocol types** — v2 message types for URL projects and element comments
2. **Projects module** — v2 project model with `~/.frank/` storage
3. **Content proxy** — HTTP proxy for iframe-restricted URLs
4. **Server rewrite** — Remove wireframe logic, add proxy routing and v2 handlers
5. **CLI update** — v2 commands and messaging
6. **UI scaffold** — Entry point, app shell, sync client, project state, styles
7. **Home view** — Project list with create, open, delete
8. **Viewer** — Iframe wrapper with proxy fallback and toolbar
9. **Commenting overlay** — Smart element detection, triple-anchor, comment panel
10. **Wiring** — Connect overlay + comments + viewer end-to-end
11. **Multi-page tracking** — Detect iframe navigation, prompt to add screens
12. **Integration test** — End-to-end smoke test

**Result:** Frank can wrap any URL, let you comment on specific elements with smart detection, persist comments locally, and manage multiple projects. Ready for Phase 2 (cloud sharing) and Phase 3 (data capture + curation).

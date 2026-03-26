// Daemon server — persistent process started by `frank start`.
//
// Watches SCHEMA_DIR for new JSON files written by Claude.
// When a schema file appears, validates it and broadcasts to all panel connections via WebSocket.
// No hook spawning — FSEvents fires in ~10-50ms, vs ~200ms for a Node.js process startup.

import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { execFileSync } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { WEBSOCKET_PORT, HTTP_PORT, SCHEMA_DIR, type PanelMessage, type AppMessage } from './protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UI_DIR = path.resolve(__dirname, '../../ui');
import { listProjects, loadProject, saveProject, createProject, archiveProject, mergeScreenIntoProject, mergeNotesIntoProject, getGitUserName } from './projects.js';
import { updateInjectionProjectPath } from './inject.js';
import { createShare, getShare, addNote, readShareFile } from './shares.js';

const panelClients = new Set<WebSocket>();
let lastSchema: unknown = null;
let activeProjectPath: string | null = null;

// ─── Default design tokens (shadcn/ui zinc palette) ───────────────────────────
// Auto-injected into every schema so downstream tools have exact values.
// Users can override per-schema by including a `tokens` block.

const DEFAULT_TOKENS = {
  colors: {
    background:              '#ffffff',
    foreground:              '#18181b',
    primary:                 '#18181b',
    'primary-foreground':    '#fafafa',
    secondary:               '#f4f4f5',
    'secondary-foreground':  '#18181b',
    muted:                   '#f4f4f5',
    'muted-foreground':      '#71717a',
    border:                  '#e4e4e7',
    input:                   '#e4e4e7',
    accent:                  '#3b82f6',
    'accent-foreground':     '#ffffff',
    destructive:             '#ef4444',
    card:                    '#ffffff',
    'card-foreground':       '#18181b',
  },
  typography: {
    headline:    { size: 28, weight: 700, lineHeight: 1.2, family: 'Inter, system-ui, sans-serif' },
    subheadline: { size: 16, weight: 400, lineHeight: 1.5, family: 'Inter, system-ui, sans-serif' },
    body:        { size: 14, weight: 400, lineHeight: 1.6, family: 'Inter, system-ui, sans-serif' },
    button:      { size: 14, weight: 600, lineHeight: 1,   family: 'Inter, system-ui, sans-serif' },
    label:       { size: 12, weight: 500, lineHeight: 1,   family: 'Inter, system-ui, sans-serif' },
    caption:     { size: 11, weight: 400, lineHeight: 1.4, family: 'Inter, system-ui, sans-serif' },
    'nav-label': { size: 10, weight: 500, lineHeight: 1,   family: 'Inter, system-ui, sans-serif' },
  },
  spacing: {
    base: 16,
    xs: 4, sm: 8, md: 16, lg: 24, xl: 40, '2xl': 64,
  },
  components: {
    'button-height':    40,
    'button-height-sm': 32,
    'button-height-lg': 48,
    'button-radius':    6,
    'button-padding-x': 16,
    'input-height':     40,
    'input-radius':     6,
    'input-padding-x':  12,
    'card-radius':      8,
    'card-shadow':      '0 1px 3px rgba(0,0,0,0.1)',
    'avatar-size':      36,
    'avatar-size-sm':   28,
    'badge-height':     22,
    'badge-radius':     4,
    'badge-padding-x':  8,
  },
};

export function startServer(): void {
  startFileWatcher();
  startWebSocketServer();
  startHttpServer();

  // Sync share notes every 30 seconds
  setInterval(() => syncShareNotes(), 30000);
  // Also sync on startup (after a short delay for connection)
  setTimeout(() => syncShareNotes(), 3000);

  console.log(`[frank] daemon started`);
  console.log(`[frank] watching:    ${SCHEMA_DIR}`);
  console.log(`[frank] websocket:   ws://localhost:${WEBSOCKET_PORT}`);
  console.log(`[frank] ui:          http://localhost:${HTTP_PORT}`);
}

// ─── File watcher (replaces hook handler) ────────────────────────────────────
// Watches SCHEMA_DIR for new schema JSON files. FSEvents fires in ~10-50ms.
// Deduplicated per filename to handle double-fire from some editors/tools.

function startFileWatcher(): void {
  fs.mkdirSync(SCHEMA_DIR, { recursive: true });

  const daemonStartTime = Date.now();
  const recentlyProcessed = new Set<string>();

  fs.watch(SCHEMA_DIR, (_eventType, filename) => {
    if (!filename || !filename.endsWith('.json')) return;
    if (filename === 'pending-edit.json') return;
    if (recentlyProcessed.has(filename)) return;

    recentlyProcessed.add(filename);
    setTimeout(() => recentlyProcessed.delete(filename), 2000);

    // Small delay to ensure file is fully flushed before reading
    setTimeout(() => {
      const filePath = path.join(SCHEMA_DIR, filename);
      try {
        const stat = fs.statSync(filePath);
        // Skip stale files that existed before the daemon started
        if (stat.mtimeMs < daemonStartTime - 1000) return;
        const content = fs.readFileSync(filePath, 'utf8');
        handleSchemaFile(content);
      } catch {
        // File may have been deleted or is unreadable — ignore
      }
    }, 40);
  });

  console.log(`[frank] file watcher active`);
}

function handleSchemaFile(content: string): void {
  let schema: Record<string, unknown>;
  try {
    schema = JSON.parse(content) as Record<string, unknown>;
  } catch { return; }

  if (schema.schema !== 'v1') return;
  // Accept screen, flow, or any v1 schema the AI writes
  if (!schema.type) return;

  if (activeProjectPath) {
    // Merge into active project
    try {
      const updatedProject = mergeScreenIntoProject(activeProjectPath, schema);
      broadcast({ type: 'project-updated', project: updatedProject, filePath: activeProjectPath });
      console.log(`[frank] merged screen into ${activeProjectPath}`);
    } catch (e: any) {
      console.warn('[frank] merge failed:', e.message);
      // Fall back to legacy broadcast
      broadcastLegacy(schema);
    }
  } else {
    // No active project — create one
    const label = (schema.label as string) || 'Untitled';
    try {
      const { project, filePath } = createProject(label);
      activeProjectPath = filePath;
      const updatedProject = mergeScreenIntoProject(filePath, schema);
      broadcast({ type: 'project-updated', project: updatedProject, filePath });
      updateInjectionProjectPath(filePath);
      console.log(`[frank] created project ${filePath} with first screen`);
    } catch (e: any) {
      console.warn('[frank] project creation failed:', e.message);
      broadcastLegacy(schema);
    }
  }
}

// Legacy broadcast for backward compat (no active project, creation failed)
function broadcastLegacy(schema: Record<string, unknown>): void {
  const stamped = {
    ...schema,
    timestamp: new Date().toISOString(),
    tokens: { ...DEFAULT_TOKENS, ...(schema.tokens as object | undefined) },
  };
  lastSchema = stamped;
  broadcast({ type: 'render', schema: stamped });
}

// ─── HTTP server (serves ui/ directory) ───────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
};

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => body += chunk.toString());
    req.on('end', () => resolve(body));
  });
}

function startHttpServer(): void {
  const server = http.createServer(async (req, res) => {
    // CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    const url = new URL(req.url || '/', `http://localhost`);

    if (url.pathname === '/api/share' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const result = createShare(body.project, body.coverNote || '', body.oldRevokeToken, body.oldShareId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (url.pathname.startsWith('/api/share/') && req.method === 'GET') {
      const shareId = url.pathname.split('/api/share/')[1];
      if (shareId) {
        const result = getShare(shareId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing share id' }));
      }
      return;
    }

    if (url.pathname === '/api/note' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const result = addNote(body.shareId, {
          screenId: body.screenId,
          section: body.section ?? null,
          author: body.author,
          text: body.text,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // Static file serving
    let urlPath = req.url?.split('?')[0] || '/';
    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.join(UI_DIR, urlPath);

    // Prevent directory traversal
    if (!filePath.startsWith(UI_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const ext = path.extname(filePath);
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    });
  });

  server.listen(HTTP_PORT, () => {
    console.log(`[frank] http server listening on port ${HTTP_PORT}`);
  });

  server.on('error', (err) => {
    console.error(`[frank] http server error:`, err.message);
  });
}

// ─── WebSocket server (sends to panel) ───────────────────────────────────────

function startWebSocketServer(): void {
  const wss = new WebSocketServer({ port: WEBSOCKET_PORT });

  wss.on('connection', (ws) => {
    panelClients.add(ws);
    console.log(`[frank] panel connected (${panelClients.size} total)`);
    // Replay last schema so the panel isn't blank on reconnect
    if (lastSchema) ws.send(JSON.stringify({ type: 'render', schema: lastSchema }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as AppMessage;

        if (msg.type === 'list-projects') {
          try {
            const projects = listProjects();
            ws.send(JSON.stringify({ requestId: msg.requestId, projects }));
          } catch (e: any) {
            ws.send(JSON.stringify({ requestId: msg.requestId, error: e.message }));
          }
          return;
        }

        if (msg.type === 'load-project') {
          try {
            const project = loadProject(msg.filePath);
            activeProjectPath = msg.filePath;
            ws.send(JSON.stringify({ requestId: msg.requestId, project, filePath: msg.filePath }));
          } catch (e: any) {
            ws.send(JSON.stringify({ requestId: msg.requestId, error: e.message }));
          }
          return;
        }

        if (msg.type === 'save-project') {
          try {
            const filePath = saveProject(msg.project as Record<string, unknown>);
            ws.send(JSON.stringify({ requestId: msg.requestId, success: true, filePath }));
          } catch (e: any) {
            ws.send(JSON.stringify({ requestId: msg.requestId, success: false, error: e.message }));
          }
          return;
        }

        if (msg.type === 'create-project') {
          try {
            const { project, filePath } = createProject(msg.label);
            activeProjectPath = filePath;
            ws.send(JSON.stringify({ requestId: msg.requestId, project, filePath }));
          } catch (e: any) {
            ws.send(JSON.stringify({ requestId: msg.requestId, error: e.message }));
          }
          return;
        }

        if (msg.type === 'archive-project') {
          try {
            archiveProject(msg.filePath);
            if (activeProjectPath === msg.filePath) activeProjectPath = null;
            ws.send(JSON.stringify({ requestId: msg.requestId, success: true }));
          } catch (e: any) {
            ws.send(JSON.stringify({ requestId: msg.requestId, success: false, error: e.message }));
          }
          return;
        }

        if (msg.type === 'project-changed') {
          activeProjectPath = msg.filePath || null;
          if (activeProjectPath) updateInjectionProjectPath(activeProjectPath);
          console.log(`[frank] active project: ${activeProjectPath}`);
          return;
        }

        if (msg.type === 'inject' && typeof msg.prompt === 'string') {
          applyEdit(msg.prompt);
        }
      } catch (e) {
        console.warn('[frank] message error:', e);
      }
    });

    ws.on('close', () => {
      panelClients.delete(ws);
      console.log(`[frank] panel disconnected (${panelClients.size} remaining)`);
    });

    ws.on('error', () => {
      panelClients.delete(ws);
    });
  });

  wss.on('error', (err) => {
    console.error(`[frank] websocket error:`, err.message);
  });
}

function broadcast(message: PanelMessage): void {
  const payload = JSON.stringify(message);
  for (const client of panelClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
  console.log(`[frank] broadcast ${message.type} to ${panelClients.size} panel(s)`);
}


// ─── Share note sync (polls share files, merges into project) ────────────────

function syncShareNotes(): void {
  if (!activeProjectPath) return;
  try {
    const content = fs.readFileSync(activeProjectPath, 'utf8');
    const project = JSON.parse(content);
    const activeShare = project.activeShare;
    if (!activeShare?.id) return;

    const share = readShareFile(activeShare.id);
    if (!share || !share.notes || share.notes.length === 0) return;

    const { newNotes } = mergeNotesIntoProject(
      activeProjectPath,
      share.notes,
      activeShare.lastSyncedNoteId || null
    );

    if (newNotes.length > 0) {
      // Push each note to connected clients grouped by screen
      const byScreen = new Map<string, typeof newNotes>();
      for (const note of newNotes) {
        const existing = byScreen.get(note.screenId) || [];
        existing.push(note);
        byScreen.set(note.screenId, existing);
      }
      for (const [screenId, notes] of byScreen) {
        broadcast({ type: 'notes-updated', screenId, notes } as any);
      }
      console.log(`[frank] synced ${newNotes.length} new note(s) from share ${activeShare.id}`);
    }
  } catch (e) {
    // Silent fail — sync is best-effort
  }
}

// ─── Edit application via claude -p ──────────────────────────────────────────

function findClaude(): string | null {
  const candidates = [
    `${process.env.HOME}/.local/bin/claude`,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const p of candidates) {
    try { execFileSync('test', ['-f', p]); return p; } catch { /* try next */ }
  }
  try { return execFileSync('which', ['claude'], { encoding: 'utf8' }).trim(); } catch { return null; }
}

const CLAUDE_BIN = findClaude();

function applyEdit(instruction: string): void {
  if (!CLAUDE_BIN) {
    console.warn('[frank] claude binary not found — cannot apply edit');
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = `${SCHEMA_DIR}/render-${ts}.json`;
  const schemaBlock = lastSchema
    ? `\nCurrent schema:\n${JSON.stringify(lastSchema, null, 2)}`
    : '';

  const prompt =
    `Apply this edit to the wireframe schema and write the result to ${outPath} using the Write tool. ` +
    `If the edited section type appears on multiple screens, update it on ALL screens. No explanation.\n\n` +
    `Edit: "${instruction}"` +
    schemaBlock;

  const env = { ...process.env };
  delete env['CLAUDECODE'];

  const child = spawn(CLAUDE_BIN, [
    '-p', prompt,
    '--model', 'claude-haiku-4-5-20251001',
    '--permission-mode', 'bypassPermissions',
    '--allowedTools', 'Write',
  ], {
    env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  console.log(`[frank] applying edit via claude: "${instruction.slice(0, 80)}"`);
}

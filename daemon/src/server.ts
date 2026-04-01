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
  addScreen, loadComments, addComment, deleteComment, saveProject,
} from './projects.js';
import { proxyRequest } from './proxy.js';
import { uploadShare, isCloudConnected, getCloudUrl } from './cloud.js';

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
        reply({ type: 'project-loaded', projectId: msg.projectId, project, comments });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'create-project': {
      try {
        const { project, projectId } = createProject(msg.name, msg.contentType, msg.url, msg.file);
        activeProjectId = projectId;
        reply({ type: 'project-loaded', projectId, project, comments: [] });
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
        reply({ type: 'project-loaded', projectId: activeProjectId, project, comments });
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
        const project = loadProject(activeProjectId);
        const comments = loadComments(activeProjectId);
        reply({ type: 'project-loaded', projectId: activeProjectId, project, comments });
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

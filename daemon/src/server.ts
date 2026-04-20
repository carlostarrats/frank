import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { exec } from 'child_process';
import {
  WEBSOCKET_PORT, HTTP_PORT, FRANK_DIR, PROJECTS_DIR,
  type AppMessage, type DaemonMessage, type Comment,
} from './protocol.js';
import {
  listProjects, loadProject, createProject, createProjectFromFile, deleteProject,
  addScreen, loadComments, addComment, deleteComment, saveProject,
  renameProject, archiveProject, unarchiveProject,
  trashProject, restoreProject, purgeExpiredTrash,
} from './projects.js';
import { saveAsset, ALLOWED_MIME_TYPES } from './assets.js';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB cap for base64-over-WS uploads
import { proxyRequest } from './proxy.js';
import { uploadShare, isCloudConnected, getCloudUrl, fetchShareComments, saveCloudConfig, healthCheck, getCloudConfiguredAt, revokeShare } from './cloud.js';
import { LiveShareController } from './live-share.js';
import { mergeCloudComments } from './projects.js';
import { saveSnapshot, saveCanvasSnapshot, listSnapshots, starSnapshot } from './snapshots.js';
import { addCuration, applyCurationToComments } from './curation.js';
import { addAiInstruction } from './ai-chain.js';
import { exportProject } from './export.js';
import { exportReport } from './report.js';
import { loadCanvasState, saveCanvasState } from './canvas.js';
import {
  getClaudeApiKey, setClaudeApiKey, clearClaudeApiKey,
} from './cloud.js';
import {
  createConversation, loadConversation, listConversations, appendMessage,
  ConversationFullError, capStatusOf,
} from './ai-conversations.js';
import { buildContext, streamChat } from './ai-providers/claude.js';
import Anthropic from '@anthropic-ai/sdk';
import { buildCanvasLivePayload } from './canvas-live.js';
import { decideCanvasSend, clearSendState } from './canvas-send-state.js';
import { buildImageLivePayload } from './image-live.js';
import { decideImageSend, clearImageSendState } from './image-send-state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UI_DIR = path.resolve(__dirname, '../../ui-v2');

const panelClients = new Set<WebSocket>();
let activeProjectId: string | null = null;

// Active proxy targets: maps a slug to a target URL
const proxyTargets = new Map<string, string>();

// One LiveShareController per projectId. Paused on stop-live-share (entry
// stays in the map so resume-live-share can reuse the same controller);
// removed on revoke-share / SIGINT.
const liveShares = new Map<string, LiveShareController>();

function liveShareRate(contentType: 'canvas' | 'image' | 'pdf' | 'url'): number {
  if (contentType === 'canvas') return 15;
  if (contentType === 'pdf') return 5;
  if (contentType === 'image') return 1;
  return 1;
}

// Phase 3: image projects fork a live push off each comment change. Phase 4
// will add PDF. Canvas doesn't use this path — it has its own canvas-state
// fork in save-canvas-state (Phase 2).
//
// Race behavior: two near-simultaneous comment events (e.g., add + curate
// firing within ~100ms) each call this function. Both call buildImageLivePayload,
// which re-reads the LATEST comments.json each time — so both pushes reflect
// post-both-events state, not pre-event state. The LiveShareController's
// pushState/pushDiff coalesces under the hood (Phase 1 `live-share.ts`:
// `this.pending = { kind, payload }` replaces any pending update; `flushTimer`
// debounces), so the backend only sees the final state, not intermediate ones.
async function forkImageLivePush(projectId: string): Promise<void> {
  const ctl = liveShares.get(projectId);
  if (!ctl) return;
  const project = loadProject(projectId);
  if (!project || project.contentType !== 'image' || !project.activeShare?.id) return;
  try {
    const payload = await buildImageLivePayload(projectId);
    if (!payload) return;
    const decision = decideImageSend(project.activeShare.id, payload);
    if (decision.kind === 'state') ctl.pushState(decision.payload);
    else ctl.pushDiff(decision.payload);
  } catch { /* best-effort; persistence already succeeded */ }
}

export function startServer(): void {
  fs.mkdirSync(FRANK_DIR, { recursive: true });
  try {
    const purged = purgeExpiredTrash();
    if (purged.length > 0) console.log(`[frank] purged ${purged.length} expired trashed project(s)`);
  } catch (e: any) {
    console.warn(`[frank] trash purge failed:`, e.message);
  }
  startWebSocketServer();
  startHttpServer();
  // Sync cloud comments every 30 seconds
  setInterval(() => syncCloudComments(), 30000);
  setTimeout(() => syncCloudComments(), 5000); // Initial sync after startup

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

    case 'create-project-from-file': {
      try {
        const buffer = Buffer.from(msg.data, 'base64');
        if (buffer.length === 0) throw new Error('Empty file');
        if (buffer.length > MAX_UPLOAD_BYTES) throw new Error(`File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)`);
        if (msg.contentType !== 'pdf' && msg.contentType !== 'image') throw new Error(`Unsupported contentType: ${msg.contentType}`);
        const { project, projectId } = createProjectFromFile(msg.name, msg.contentType, msg.fileName, buffer);
        activeProjectId = projectId;
        reply({ type: 'project-loaded', projectId, project, comments: [] });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'upload-asset': {
      try {
        if (!ALLOWED_MIME_TYPES.includes(msg.mimeType.toLowerCase())) {
          throw new Error(`Unsupported asset type: ${msg.mimeType}`);
        }
        const buffer = Buffer.from(msg.data, 'base64');
        if (buffer.length === 0) throw new Error('Empty asset');
        if (buffer.length > MAX_UPLOAD_BYTES) throw new Error(`Asset too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)`);
        // Asset must belong to a known project; reject unknown IDs to prevent
        // writes outside of legitimate project dirs.
        loadProject(msg.projectId);
        const asset = saveAsset(msg.projectId, buffer, msg.mimeType);
        reply({ type: 'asset-uploaded', assetId: asset.assetId, url: asset.url, bytes: asset.bytes });
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

    case 'rename-project': {
      try {
        renameProject(msg.projectId, msg.name);
        reply({ type: 'project-list', projects: listProjects() });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'archive-project': {
      try {
        archiveProject(msg.projectId);
        reply({ type: 'project-list', projects: listProjects() });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'unarchive-project': {
      try {
        unarchiveProject(msg.projectId);
        reply({ type: 'project-list', projects: listProjects() });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'trash-project': {
      try {
        trashProject(msg.projectId);
        if (activeProjectId === msg.projectId) activeProjectId = null;
        reply({ type: 'project-list', projects: listProjects() });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'restore-project': {
      try {
        restoreProject(msg.projectId);
        reply({ type: 'project-list', projects: listProjects() });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'purge-project': {
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
        void forkImageLivePush(activeProjectId);
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'delete-comment': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        deleteComment(activeProjectId, msg.commentId);
        void forkImageLivePush(activeProjectId);
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

    case 'get-cloud-config': {
      // Returns the URL (fine to read) and a boolean for whether a key is
      // stored; we never echo the key back to the client. configuredAt is
      // the ISO timestamp of the most recent save, used by the UI to show
      // an "Already configured on …" hint.
      reply({
        type: 'cloud-config',
        cloudUrl: getCloudUrl(),
        hasApiKey: isCloudConnected(),
        configuredAt: getCloudConfiguredAt(),
      });
      break;
    }

    case 'set-cloud-config': {
      try {
        const url = (msg.cloudUrl || '').replace(/\/$/, '').trim();
        const key = (msg.apiKey || '').trim();
        if (!url || !key) throw new Error('Both URL and API key are required');
        if (!/^https?:\/\//.test(url)) throw new Error('URL must start with http:// or https://');
        saveCloudConfig(url, key);
        reply({ type: 'cloud-config', cloudUrl: url, hasApiKey: true, configuredAt: getCloudConfiguredAt() });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'test-cloud-connection': {
      (async () => {
        try {
          const result = await healthCheck();
          reply({ type: 'cloud-test-result', ok: result.ok, error: result.error });
        } catch (e: any) {
          reply({ type: 'cloud-test-result', ok: false, error: e.message });
        }
      })();
      break;
    }

    case 'save-snapshot': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const meta = saveSnapshot(activeProjectId, msg.html, msg.screenshot, msg.trigger, msg.triggeredBy);
        reply({ type: 'snapshot-saved', snapshot: meta });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'save-canvas-snapshot': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const meta = saveCanvasSnapshot(activeProjectId, msg.canvasState, msg.thumbnail || null, msg.trigger, msg.triggeredBy);
        reply({ type: 'snapshot-saved', snapshot: meta });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'list-snapshots': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        reply({ type: 'snapshot-list', snapshots: listSnapshots(activeProjectId) });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'star-snapshot': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        starSnapshot(activeProjectId, msg.snapshotId, msg.label);
        reply({ type: 'snapshot-list', snapshots: listSnapshots(activeProjectId) });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'curate-comment': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const localComments = loadComments(activeProjectId);
        const origTexts = msg.commentIds.map(id => localComments.find(c => c.id === id)?.text || '');
        const statusMap: Record<string, 'approved' | 'dismissed' | 'remixed' | 'pending'> = {
          approve: 'approved', dismiss: 'dismissed', remix: 'remixed', batch: 'approved', reset: 'pending',
        };
        const curation = addCuration(activeProjectId, msg.commentIds, msg.action, origTexts, msg.remixedText || '', msg.dismissReason || '');
        applyCurationToComments(activeProjectId, msg.commentIds, statusMap[msg.action]);
        void forkImageLivePush(activeProjectId);
        const updatedComments = loadComments(activeProjectId);
        reply({ type: 'curation-done', curation });
        broadcast({ type: 'project-loaded', projectId: activeProjectId, project: loadProject(activeProjectId), comments: updatedComments } as any);
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'log-ai-instruction': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const instruction = addAiInstruction(activeProjectId, msg.feedbackIds, msg.curationIds, msg.instruction);
        reply({ type: 'ai-instruction-logged', instruction });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'export-project': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const data = exportProject(activeProjectId);
        reply({ type: 'export-ready', data });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'export-report': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      (async () => {
        try {
          if (msg.format !== 'markdown' && msg.format !== 'pdf') throw new Error(`Unknown format: ${msg.format}`);
          const result = await exportReport(activeProjectId!, msg.format);
          reply({ type: 'report-ready', format: msg.format, mimeType: result.mimeType, data: result.data });
        } catch (e: any) {
          reply({ type: 'error', error: e.message });
        }
      })();
      break;
    }

    case 'reveal-project-folder': {
      const id = msg.projectId || activeProjectId;
      if (!id) { reply({ type: 'error', error: 'No project to reveal' }); break; }
      const target = path.join(PROJECTS_DIR, id);
      if (!fs.existsSync(target)) { reply({ type: 'error', error: 'Project folder not found' }); break; }
      // Platform-specific reveal. Fail silently if the OS command errors.
      const cmd =
        process.platform === 'darwin' ? `open "${target}"` :
        process.platform === 'win32' ? `explorer "${target}"` :
        `xdg-open "${target}"`;
      exec(cmd, (err) => {
        if (err) reply({ type: 'error', error: `Could not open folder: ${err.message}` });
        else reply({ type: 'folder-revealed', path: target });
      });
      break;
    }

    case 'load-canvas-state': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const state = loadCanvasState(activeProjectId);
        reply({ type: 'canvas-state-loaded', state });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'save-canvas-state': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        saveCanvasState(activeProjectId, msg.state);

        // v3 Phase 2: fork the live-share push off the save path.
        // buildCanvasLivePayload reads the just-persisted canvas JSON + assets;
        // decideCanvasSend determines state-vs-diff based on the per-share cache.
        const ctl = liveShares.get(activeProjectId);
        const project = loadProject(activeProjectId);
        const shareId = project?.activeShare?.id;
        if (ctl && shareId) {
          (async () => {
            try {
              const payload = await buildCanvasLivePayload(activeProjectId!);
              if (!payload) return;
              const decision = decideCanvasSend(shareId, payload);
              if (decision.kind === 'state') ctl.pushState(decision.payload);
              else ctl.pushDiff(decision.payload);
            } catch { /* best-effort; persistence already succeeded */ }
          })();
        }

        reply({ type: 'canvas-state-saved' });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'get-ai-config': {
      reply({
        type: 'ai-config',
        providers: { claude: { configured: !!getClaudeApiKey() } },
      });
      break;
    }

    case 'set-ai-api-key': {
      try {
        if (msg.provider !== 'claude') throw new Error(`Unknown provider: ${msg.provider}`);
        if (!msg.apiKey || !msg.apiKey.trim()) throw new Error('API key is empty');
        setClaudeApiKey(msg.apiKey.trim());
        console.log(`[frank] Claude API key configured (0600 enforced)`);
        reply({ type: 'ai-config', providers: { claude: { configured: true } } });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'clear-ai-api-key': {
      try {
        if (msg.provider !== 'claude') throw new Error(`Unknown provider: ${msg.provider}`);
        clearClaudeApiKey();
        console.log('[frank] Claude API key cleared');
        reply({ type: 'ai-config', providers: { claude: { configured: false } } });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'list-ai-conversations': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        reply({ type: 'ai-conversation-list', conversations: listConversations(activeProjectId) });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'load-ai-conversation': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const conversation = loadConversation(activeProjectId, msg.conversationId);
        if (!conversation) { reply({ type: 'error', error: 'Conversation not found' }); break; }
        reply({ type: 'ai-conversation-loaded', conversation });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'send-ai-message': {
      if (!activeProjectId) { reply({ type: 'error', error: 'No active project' }); break; }
      handleSendAiMessage(ws, activeProjectId, msg);
      break;
    }

    case 'start-live-share': {
      (async () => {
        try {
          const { projectId } = msg;
          const project = loadProject(projectId);
          if (!project) { reply({ type: 'error', error: 'Project not found' }); return; }
          if (!project.activeShare) { reply({ type: 'error', error: 'No active share — create a share first' }); return; }
          if (liveShares.has(projectId)) { reply({ type: 'error', error: 'Live share already running' }); return; }

          const ctype = project.contentType as 'canvas' | 'image' | 'pdf' | 'url';
          const ctl = new LiveShareController({
            projectId,
            shareId: project.activeShare.id,
            contentType: ctype,
            ratePerSecond: liveShareRate(ctype),
            onComment: (comment) => {
              ws.send(JSON.stringify({ type: 'live-share-comment', projectId, comment }));
            },
            onPresence: (viewers) => {
              ws.send(JSON.stringify({ type: 'live-share-state', projectId, status: 'live', viewers, revision: ctl.revision, lastError: null }));
            },
            onAuthorStatus: (status) => {
              ws.send(JSON.stringify({
                type: 'live-share-state',
                projectId,
                status: status === 'online' ? 'live' : status === 'offline' ? 'offline' : 'idle',
                viewers: ctl.viewers,
                revision: ctl.revision,
                lastError: null,
              }));
            },
            onShareEnded: (reason) => {
              liveShares.get(projectId)?.stop();
              liveShares.delete(projectId);
              if (reason === 'revoked') {
                ws.send(JSON.stringify({ type: 'share-revoked', projectId }));
              } else {
                // reason === 'expired'
                ws.send(JSON.stringify({ type: 'live-share-state', projectId, status: 'idle', viewers: 0, revision: ctl.revision, lastError: null }));
              }
            },
            onError: (err) => {
              ws.send(JSON.stringify({ type: 'live-share-state', projectId, status: 'error', viewers: ctl.viewers, revision: ctl.revision, lastError: err }));
            },
            onBandwidthStatus: (throttled) => {
              ws.send(JSON.stringify({ type: 'live-share-state', projectId, status: throttled ? 'throttled' : 'live', viewers: ctl.viewers, revision: ctl.revision, lastError: null }));
            },
            onSessionTimeout: () => {
              // UI banner copy (Phase 5 renders it verbatim from this lastError):
              //   "Live share paused — sessions auto-pause after 2 hours to prevent
              //    accidental long-running sessions. Click Resume to continue."
              try {
                const p = loadProject(projectId);
                if (p.activeShare?.live) {
                  p.activeShare.live.paused = true;
                  saveProject(projectId, p);
                }
              } catch { /* best-effort */ }
              ws.send(JSON.stringify({ type: 'live-share-state', projectId, status: 'paused', viewers: ctl.viewers, revision: ctl.revision, lastError: 'session-timeout-2h' }));
            },
          });

          liveShares.set(projectId, ctl);
          project.activeShare.live = { revision: ctl.revision, startedAt: new Date().toISOString(), paused: false };
          saveProject(projectId, project);

          reply({ type: 'live-share-state', projectId, status: 'connecting', viewers: 0, revision: ctl.revision, lastError: null });
        } catch (e: any) {
          reply({ type: 'error', error: e.message });
        }
      })();
      break;
    }

    case 'stop-live-share': {
      (async () => {
        try {
          const { projectId } = msg;
          const ctl = liveShares.get(projectId);
          if (ctl) ctl.pause();
          try {
            const project = loadProject(projectId);
            if (project.activeShare?.live) {
              project.activeShare.live.paused = true;
              saveProject(projectId, project);
            }
            if (project?.activeShare) {
              clearSendState(project.activeShare.id);
              clearImageSendState(project.activeShare.id);
            }
          } catch { /* best-effort */ }
          reply({ type: 'live-share-state', projectId, status: 'paused', viewers: 0, revision: ctl?.revision ?? 0, lastError: null });
        } catch (e: any) {
          reply({ type: 'error', error: e.message });
        }
      })();
      break;
    }

    case 'resume-live-share': {
      (async () => {
        try {
          const { projectId } = msg;
          const ctl = liveShares.get(projectId);
          if (!ctl) { reply({ type: 'error', error: 'Live share not initialized' }); return; }
          ctl.resume();
          try {
            const project = loadProject(projectId);
            if (project.activeShare?.live) {
              project.activeShare.live.paused = false;
              saveProject(projectId, project);
            }
          } catch { /* best-effort */ }
          reply({ type: 'live-share-state', projectId, status: 'connecting', viewers: ctl.viewers, revision: ctl.revision, lastError: null });
        } catch (e: any) {
          reply({ type: 'error', error: e.message });
        }
      })();
      break;
    }

    case 'push-live-state': {
      const { projectId } = msg;
      const ctl = liveShares.get(projectId);
      if (!ctl) { reply({ type: 'error', error: 'Live share not running' }); break; }
      if (msg.kind === 'state') {
        ctl.pushState(msg.payload);
      } else {
        ctl.pushDiff(msg.payload);
      }
      // fire-and-forget: no response
      break;
    }

    case 'revoke-share': {
      (async () => {
        try {
          const { projectId } = msg;
          const project = loadProject(projectId);
          if (!project.activeShare) { reply({ type: 'error', error: 'No active share' }); return; }
          const ctl = liveShares.get(projectId);
          if (ctl) {
            await ctl.revoke(project.activeShare.revokeToken);
          } else {
            await revokeShare(project.activeShare.id, project.activeShare.revokeToken);
          }
          liveShares.delete(projectId);
          clearSendState(project.activeShare.id);
          clearImageSendState(project.activeShare.id);
          project.activeShare = null;
          saveProject(projectId, project);
          reply({ type: 'share-revoked', projectId });
        } catch (e: any) {
          reply({ type: 'error', error: e.message });
        }
      })();
      break;
    }
  }
}

async function handleSendAiMessage(
  ws: WebSocket,
  projectId: string,
  msg: { type: 'send-ai-message'; conversationId?: string; continuedFrom?: string; message: string; feedbackIds?: string[]; requestId?: number },
): Promise<void> {
  const replyError = (error: string, conversationId: string | null = null) => {
    ws.send(JSON.stringify({ type: 'ai-stream-error', conversationId, error, requestId: msg.requestId }));
  };

  const apiKey = getClaudeApiKey();
  if (!apiKey) {
    replyError('Claude API key is not configured. Open settings and add one.');
    return;
  }

  // Load or create the conversation.
  let conversation;
  try {
    if (msg.conversationId) {
      conversation = loadConversation(projectId, msg.conversationId);
      if (!conversation) { replyError('Conversation not found'); return; }
      if (conversation.capReached) {
        replyError('Conversation is full — start a new one to continue.', conversation.id);
        return;
      }
    } else {
      conversation = createConversation(projectId, {
        model: 'claude-opus-4-7',
        provider: 'claude',
        continuedFrom: msg.continuedFrom ?? null,
      });
    }
  } catch (e: any) { replyError(e.message); return; }

  // Append the user message first so it's persisted even if the provider fails.
  try {
    appendMessage(projectId, conversation.id, 'user', msg.message);
  } catch (e: any) {
    if (e instanceof ConversationFullError) {
      ws.send(JSON.stringify({
        type: 'conversation-full',
        conversationId: conversation.id,
        reason: e.reason,
        requestId: msg.requestId,
      }));
      return;
    }
    replyError(e.message, conversation.id);
    return;
  }

  const reloaded = loadConversation(projectId, conversation.id);
  if (!reloaded) { replyError('Conversation vanished mid-turn', conversation.id); return; }

  const context = buildContext({
    projectId,
    conversation: reloaded,
    userMessage: msg.message,
    feedbackIds: msg.feedbackIds,
  });

  ws.send(JSON.stringify({
    type: 'ai-stream-started',
    conversationId: conversation.id,
    model: conversation.model,
    contextTokens: context.report.approxTokens,
    requestId: msg.requestId,
  }));

  try {
    const fullText = await streamChat({
      apiKey,
      system: context.system,
      messages: context.messages,
      model: conversation.model,
      onDelta: (delta) => {
        ws.send(JSON.stringify({ type: 'ai-stream-delta', conversationId: conversation.id, delta }));
      },
    });

    try {
      const { conversation: finalized, capStatus } = appendMessage(projectId, conversation.id, 'assistant', fullText);
      ws.send(JSON.stringify({
        type: 'ai-stream-ended',
        conversationId: finalized.id,
        fullText,
        capStatus: {
          softWarn: capStatus.softWarn,
          hardCap: capStatus.hardCap,
          bytes: capStatus.bytes,
          messageCount: capStatus.messageCount,
        },
      }));
    } catch (e: any) {
      if (e instanceof ConversationFullError) {
        // Persisted as capped, but we still want to deliver the reply — emit
        // ended + conversation-full so the UI can show the reply then force new.
        const reloaded2 = loadConversation(projectId, conversation.id);
        const status = reloaded2 ? capStatusOf(reloaded2) : { softWarn: false, hardCap: true, bytes: 0, messageCount: 0 };
        ws.send(JSON.stringify({
          type: 'ai-stream-ended',
          conversationId: conversation.id,
          fullText,
          capStatus: { softWarn: status.softWarn, hardCap: true, bytes: status.bytes, messageCount: status.messageCount },
        }));
        ws.send(JSON.stringify({
          type: 'conversation-full',
          conversationId: conversation.id,
          reason: e.reason,
        }));
      } else {
        replyError(e.message, conversation.id);
      }
    }
  } catch (e: any) {
    // Map common SDK errors to friendlier strings — never echo the key.
    if (e instanceof Anthropic.AuthenticationError) {
      replyError('Claude rejected the API key (401). Update it in settings.', conversation.id);
    } else if (e instanceof Anthropic.RateLimitError) {
      replyError('Rate limited. Wait a moment and try again.', conversation.id);
    } else if (e instanceof Anthropic.APIError) {
      replyError(`Claude API error (${e.status}): ${e.message}`, conversation.id);
    } else {
      replyError(`Claude call failed: ${e.message || 'unknown error'}`, conversation.id);
    }
  }
}

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
      const allComments = loadComments(activeProjectId);
      broadcast({ type: 'project-loaded', projectId: activeProjectId, project, comments: allComments } as any);
      console.log(`[frank] synced ${newCount} new comment(s) from cloud`);
    }
  } catch {
    // Silent fail — sync is best-effort
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

process.on('SIGINT', async () => {
  for (const [projectId, ctl] of liveShares.entries()) {
    await ctl.stop();
    const project = loadProject(projectId);
    if (project?.activeShare?.id) {
      clearSendState(project.activeShare.id);
      clearImageSendState(project.activeShare.id);
    }
  }
  process.exit(0);
});

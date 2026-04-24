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
  renameProject, setProjectIntent, setProjectSourceDir, archiveProject, unarchiveProject,
  trashProject, restoreProject, purgeExpiredTrash,
} from './projects.js';
import { saveAsset, ALLOWED_MIME_TYPES } from './assets.js';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB cap for base64-over-WS uploads
import { proxyRequest } from './proxy.js';
import {
  uploadShare, isCloudConnected, getCloudUrl, fetchShareComments,
  saveCloudConfig, healthCheck, getCloudConfiguredAt, revokeShare,
  getVercelDeployConfig, saveVercelDeployConfig, clearVercelDeployConfig,
  getVercelDeployConfiguredAt,
} from './cloud.js';
import { LiveShareController } from './live-share.js';
import { mergeCloudComments } from './projects.js';
import { saveSnapshot, saveCanvasSnapshot, listSnapshots, starSnapshot } from './snapshots.js';
import { addCuration, applyCurationToComments } from './curation.js';
import { addAiInstruction } from './ai-chain.js';
import { exportProject } from './export.js';
import { exportReport } from './report.js';
import { buildBundle } from './bundle.js';
import { checkEnvelope } from './share/envelope.js';
import { buildBundle as buildShareBundle } from './share/bundler.js';
import { runPreflight } from './share/preflight.js';
import { readEnvShare } from './share/env-share.js';
import { generateEncoderEnv } from './share/encoder-registry.js';
import { createShare, revokeShare as revokeUrlShare } from './share/share-create.js';
import {
  writeShareRecord,
  listShareRecords,
  markRecordRevoked,
  patchRecordRevoke,
  purgeExpiredRecords,
  purgeOrphanedShareBuilds,
  removeShareBuild,
} from './share/share-records.js';
import {
  enqueueRevoke,
  listPendingRevokes,
} from './share/revoke-queue.js';
import { startRevokeWorker, notifyRevokeEnqueued } from './share/revoke-worker.js';
import { deleteDeployment as vercelDeleteDeployment } from './share/vercel-api.js';
import { verifyVercelToken } from './share/vercel-api.js';
import { uploadUrlShareRecord } from './cloud.js';
import { loadCanvasState, saveCanvasState } from './canvas.js';
import { addShape, addText, addPath, addConnector, findNode, nodeCenter } from './canvas-writes.js';
import { buildCanvasLivePayload } from './canvas-live.js';
import { decideCanvasSend, clearSendState } from './canvas-send-state.js';
import { buildImageLivePayload } from './image-live.js';
import { decideImageSend, clearImageSendState } from './image-send-state.js';
import { buildPdfLivePayload } from './pdf-live.js';
import { decidePdfSend, clearPdfSendState } from './pdf-send-state.js';

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

// Creates and registers a LiveShareController for an existing active share.
// Callers: start-live-share (fresh), resume-live-share (when the daemon has
// been restarted since pause and no in-memory controller survives — without
// this, Resume is a dead button as soon as the daemon bounces).
//
// Throws if no active share is on the project — the UI must create a share
// before going live.
function setupLiveShareController(projectId: string): LiveShareController {
  const project = loadProject(projectId);
  if (!project.activeShare) throw new Error('No active share — create a share first');
  const ctype = project.contentType as 'canvas' | 'image' | 'pdf' | 'url';
  // `ctl` is referenced by the callbacks below; declared with `const` before
  // the object literal resolves so the closures capture the final value.
  //
  // Callbacks broadcast() to every connected panel client — not a single
  // captured ws — so multi-tab / multi-browser sessions all receive state
  // transitions. Before this, the ws bound at construction time was the only
  // one that heard the "live" broadcast; opening the project in a second
  // browser left that tab stuck on "Resuming…" until refresh.
  const ctl: LiveShareController = new LiveShareController({
    projectId,
    shareId: project.activeShare.id,
    contentType: ctype,
    ratePerSecond: liveShareRate(ctype),
    onComment: (comment) => {
      broadcast({ type: 'live-share-comment', projectId, comment: comment as Comment });
    },
    onPresence: (viewers) => {
      broadcast({ type: 'live-share-state', projectId, status: 'live', viewers, revision: ctl.revision, lastError: null });
    },
    onAuthorStatus: (status) => {
      broadcast({
        type: 'live-share-state',
        projectId,
        status: status === 'online' ? 'live' : status === 'offline' ? 'offline' : 'idle',
        viewers: ctl.viewers,
        revision: ctl.revision,
        lastError: null,
      });
    },
    onShareEnded: (reason) => {
      liveShares.get(projectId)?.stop();
      liveShares.delete(projectId);
      if (reason === 'revoked') {
        broadcast({ type: 'share-revoked', projectId });
      } else {
        broadcast({ type: 'live-share-state', projectId, status: 'idle', viewers: 0, revision: ctl.revision, lastError: null });
      }
    },
    onError: (err) => {
      broadcast({ type: 'live-share-state', projectId, status: 'error', viewers: ctl.viewers, revision: ctl.revision, lastError: err });
    },
    onBandwidthStatus: (throttled) => {
      broadcast({ type: 'live-share-state', projectId, status: throttled ? 'throttled' : 'live', viewers: ctl.viewers, revision: ctl.revision, lastError: null });
    },
    onSessionTimeout: () => {
      try {
        const p = loadProject(projectId);
        if (p.activeShare?.live) {
          p.activeShare.live.paused = true;
          saveProject(projectId, p);
        }
      } catch { /* best-effort */ }
      broadcast({ type: 'live-share-state', projectId, status: 'paused', viewers: ctl.viewers, revision: ctl.revision, lastError: 'session-timeout-2h' });
    },
  });
  liveShares.set(projectId, ctl);
  return ctl;
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

// Phase 4a: PDF projects fork a live push off each comment change. Same
// pattern as Phase 3's forkImageLivePush — the PDF file is immutable during
// a session, so comment changes drive live updates. Page/scroll sync is
// NOT implemented here (deferred to Phase 4b post-PDF.js-migration).
async function forkPdfLivePush(projectId: string): Promise<void> {
  const ctl = liveShares.get(projectId);
  if (!ctl) return;
  const project = loadProject(projectId);
  if (!project || project.contentType !== 'pdf' || !project.activeShare?.id) return;
  try {
    const payload = await buildPdfLivePayload(projectId);
    if (!payload) return;
    const decision = decidePdfSend(project.activeShare.id, payload);
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
  try {
    const droppedShares = purgeExpiredRecords();
    if (droppedShares > 0) console.log(`[frank] purged ${droppedShares} expired share record(s)`);
  } catch (e: any) {
    console.warn(`[frank] share-records purge failed:`, e.message);
  }
  try {
    const removedBuilds = purgeOrphanedShareBuilds();
    if (removedBuilds.length > 0) console.log(`[frank] cleaned ${removedBuilds.length} share-build dir(s)`);
  } catch (e: any) {
    console.warn(`[frank] share-builds cleanup failed:`, e.message);
  }
  try {
    const pending = listPendingRevokes();
    if (pending.length > 0) {
      console.log(`[frank] ${pending.length} pending revoke retry${pending.length === 1 ? '' : 's'} in queue`);
    }
    startRevokeWorker({
      getVercelToken: () => {
        const cfg = getVercelDeployConfig();
        if (!cfg) return null;
        return { token: cfg.token, teamId: cfg.teamId ?? undefined };
      },
      deleteDeployment: (args) =>
        vercelDeleteDeployment({
          token: args.token,
          deploymentId: args.deploymentId,
          teamId: args.teamId,
        }),
      onSuccess: (entry) => {
        // Retry succeeded → record reflects the late Vercel-delete success.
        patchRecordRevoke(entry.shareId, { vercelDeleted: true, vercelError: undefined });
        console.log(`[frank] revoke retry succeeded for ${entry.shareId}`);
      },
      onFailure: (entry, error, gaveUp) => {
        if (gaveUp) {
          console.warn(`[frank] revoke retry gave up for ${entry.shareId} after ${entry.attemptCount} attempts: ${error}`);
        }
      },
    });
  } catch (e: any) {
    console.warn(`[frank] revoke worker failed to start:`, e.message);
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
      proxyRequest(targetUrl, slug, req, res);
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
        // Re-emit live-share state so the UI can populate ambient badges +
        // popover status without waiting for the next state tick. Phase 5's
        // syncToolbarLiveBadge relied on this being available on mount;
        // before this fix the badge never appeared on a reload of a
        // live-sharing project.
        const ctl = liveShares.get(msg.projectId);
        const diskLive = project.activeShare?.live;
        if (ctl && diskLive && !diskLive.paused) {
          reply({
            type: 'live-share-state',
            projectId: msg.projectId,
            status: 'live',
            viewers: ctl.viewers,
            revision: ctl.revision,
            lastError: null,
          });
        } else if (diskLive?.paused) {
          reply({
            type: 'live-share-state',
            projectId: msg.projectId,
            status: 'paused',
            viewers: ctl?.viewers || 0,
            revision: ctl?.revision || diskLive.revision || 0,
            lastError: null,
          });
        }
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

    case 'share-check-envelope': {
      if (!msg.projectDir || typeof msg.projectDir !== 'string') {
        reply({ type: 'error', error: 'share-check-envelope requires a projectDir string' });
        break;
      }
      (async () => {
        try {
          const envelope = await checkEnvelope(msg.projectDir);
          // If a framework was detected, also compute a bundle summary so the
          // UI can show file counts + total size without a second round trip.
          let bundleSummary: {
            status: 'ok' | 'fail';
            fileCount: number;
            totalSize: number;
            rejectedCount: number;
            rejectedByReason: Record<string, number>;
          } | null = null;
          if (envelope.framework) {
            const bundle = await buildShareBundle(msg.projectDir, { framework: envelope.framework.id });
            const rejectedByReason: Record<string, number> = {};
            for (const r of bundle.rejected) {
              rejectedByReason[r.reason] = (rejectedByReason[r.reason] ?? 0) + 1;
            }
            bundleSummary = {
              status: bundle.status,
              fileCount: bundle.files.length,
              totalSize: bundle.totalSize,
              rejectedCount: bundle.rejected.length,
              rejectedByReason,
            };
          }
          reply({ type: 'share-envelope-result', envelope, bundleSummary });
        } catch (e: any) {
          reply({ type: 'error', error: e.message });
        }
      })();
      break;
    }

    case 'get-vercel-deploy-config': {
      const cfg = getVercelDeployConfig();
      reply({
        type: 'vercel-deploy-config',
        configured: !!cfg,
        teamId: cfg?.teamId ?? null,
        projectNamePrefix: cfg?.projectNamePrefix ?? null,
        configuredAt: getVercelDeployConfiguredAt(),
      });
      break;
    }

    case 'set-vercel-deploy-config': {
      if (!msg.token || typeof msg.token !== 'string') {
        reply({ type: 'error', error: 'set-vercel-deploy-config requires a token' });
        break;
      }
      try {
        saveVercelDeployConfig({ token: msg.token, teamId: msg.teamId });
        reply({ type: 'vercel-deploy-config', configured: true, teamId: msg.teamId ?? null, projectNamePrefix: null, configuredAt: getVercelDeployConfiguredAt() });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'clear-vercel-deploy-config': {
      clearVercelDeployConfig();
      reply({ type: 'vercel-deploy-config', configured: false, teamId: null, projectNamePrefix: null, configuredAt: null });
      break;
    }

    case 'test-vercel-token': {
      if (!msg.token || typeof msg.token !== 'string') {
        reply({ type: 'error', error: 'test-vercel-token requires a token' });
        break;
      }
      (async () => {
        const result = await verifyVercelToken(msg.token);
        reply({ type: 'vercel-token-test-result', ok: result.ok, message: result.message ?? null });
      })();
      break;
    }

    case 'share-create': {
      if (!msg.projectDir || typeof msg.projectDir !== 'string') {
        reply({ type: 'error', error: 'share-create requires a projectDir string' });
        break;
      }
      (async () => {
        try {
          const vercelConfig = getVercelDeployConfig();
          if (!vercelConfig) {
            reply({ type: 'share-create-result', status: 'fail', failure: { stage: 'envelope', message: 'Vercel deploy token not configured. Add one in Settings → Share Preview.' } });
            return;
          }
          const cloudUrl = getCloudUrl();
          if (!cloudUrl) {
            reply({ type: 'share-create-result', status: 'fail', failure: { stage: 'envelope', message: 'Frank-cloud not configured. Configure cloud backend in Settings first.' } });
            return;
          }

          const shareResult = await createShare({
            projectDir: msg.projectDir,
            vercelToken: vercelConfig.token,
            vercelTeamId: vercelConfig.teamId,
            cloudUrl,
            onProgress: (info) => {
              reply({ type: 'share-create-progress', ...info });
            },
          });

          if (shareResult.status === 'fail' || !shareResult.deployment) {
            reply({ type: 'share-create-result', ...shareResult, status: 'fail' });
            return;
          }

          // Persist to frank-cloud so the share link is reachable by reviewers.
          // Pass the daemon's internal shareId so it matches what's already
          // baked into the deployment's overlay script (data-share-id). Without
          // this the overlay's SSE connection keys on the daemon id while the
          // cloud record keys on a separate id — they'd never match and the
          // reviewer would see "Comments unavailable."
          const cloudRecord = await uploadUrlShareRecord(
            {
              vercelId: shareResult.deployment.id,
              vercelTeamId: vercelConfig.teamId,
              url: shareResult.deployment.url,
              readyState: shareResult.deployment.readyState,
            },
            '',
            msg.expiryDays,
            shareResult.shareId,
          );
          if ('error' in cloudRecord) {
            reply({ type: 'share-create-result', ...shareResult, cloudError: cloudRecord.error, status: 'fail' });
            return;
          }

          // Persist to ~/.frank/share-records.json so the user can revoke
          // this share after the popover that created it has closed (Item 3
          // from url-share-followups.md). Best-effort: if the write fails
          // for some reason, the share itself still works — the user just
          // can't list/revoke it from the UI until the next Create-share.
          try {
            if (msg.projectId) {
              writeShareRecord({
                shareId: cloudRecord.shareId,
                revokeToken: cloudRecord.revokeToken,
                vercelDeploymentId: shareResult.deployment.id,
                vercelTeamId: vercelConfig.teamId ?? undefined,
                // Non-null assertions are safe here: we've already returned
                // on shareResult.status === 'fail' || !shareResult.deployment
                // upstream, so both fields are guaranteed present at this point.
                deploymentUrl: shareResult.deploymentUrl!,
                shareUrl: cloudRecord.url,
                projectId: msg.projectId,
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + ((msg.expiryDays ?? 7) * 86400000)).toISOString(),
                projectDir: msg.projectDir,
                // share-create.ts writes the working dir under the daemon's
                // internal 32-char shareId (shareResult.shareId). The record's
                // primary shareId is the shorter cloud-assigned id. Track the
                // build-dir name separately so cleanup can match it.
                buildDirName: shareResult.shareId,
              });
            }
          } catch (err: any) {
            console.warn('[frank] failed to persist share record:', err.message);
          }

          reply({
            type: 'share-create-result',
            status: 'ok',
            shareId: cloudRecord.shareId,
            revokeToken: cloudRecord.revokeToken,
            shareUrl: cloudRecord.url,
            deploymentUrl: shareResult.deploymentUrl,
            vercelDeploymentId: shareResult.deployment.id,
          });
        } catch (e: any) {
          reply({ type: 'error', error: e.message });
        }
      })();
      break;
    }

    case 'list-url-shares': {
      try {
        const records = listShareRecords({ projectId: msg.projectId });
        reply({ type: 'url-shares-list', records });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'list-pending-revokes': {
      try {
        reply({ type: 'pending-revokes-list', entries: listPendingRevokes() });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'share-revoke-url': {
      if (!msg.shareId || !msg.revokeToken || !msg.vercelDeploymentId) {
        reply({ type: 'error', error: 'share-revoke-url requires shareId, revokeToken, vercelDeploymentId' });
        break;
      }
      (async () => {
        try {
          const vercelConfig = getVercelDeployConfig();
          if (!vercelConfig) {
            reply({ type: 'share-revoke-result', status: 'fail', error: 'Vercel deploy token not configured; cannot delete the deployment.' });
            return;
          }
          const result = await revokeUrlShare({
            vercelToken: vercelConfig.token,
            vercelTeamId: msg.vercelTeamId ?? vercelConfig.teamId,
            vercelDeploymentId: msg.vercelDeploymentId,
            flipCloudFlag: async () => {
              const out = await revokeShare(msg.shareId, msg.revokeToken);
              return out;
            },
          });
          // Mark the local record so the list UI can hide/grey the row.
          try {
            markRecordRevoked(msg.shareId, {
              linkInvalidated: result.linkInvalidated,
              vercelDeleted: result.vercelDeleted,
              vercelError: result.vercelError,
              cloudError: result.cloudError,
            });
          } catch (err: any) {
            console.warn('[frank] failed to mark share record revoked:', err.message);
          }
          // Item 6: if Vercel delete failed but the cloud flag DID flip
          // (link is dead but the deployment is still live), enqueue a
          // retry. Design doc §7.2 — the privacy story depends on the
          // deployment being torn down eventually; leaving it for the user
          // to manually retry is hostile.
          if (result.linkInvalidated && !result.vercelDeleted && result.vercelError) {
            try {
              enqueueRevoke({
                shareId: msg.shareId,
                vercelDeploymentId: msg.vercelDeploymentId,
                vercelTeamId: msg.vercelTeamId ?? vercelConfig.teamId ?? undefined,
                firstError: result.vercelError,
              });
              notifyRevokeEnqueued();
              console.log(`[frank] queued revoke retry for ${msg.shareId}: ${result.vercelError}`);
            } catch (err: any) {
              console.warn('[frank] failed to enqueue revoke retry:', err.message);
            }
          }
          // Clean up the on-disk working copy — a 5-10 MB dir per share
          // otherwise sits around indefinitely. Startup sweep catches any
          // that this pass misses (Vercel-delete failure, daemon crash, etc).
          // Build-dir name differs from the cloud shareId (share-create.ts
          // uses the internal 32-char id), so look it up from the record.
          try {
            const rec = listShareRecords({ includeRevoked: true, includeExpired: true })
              .find((r) => r.shareId === msg.shareId);
            const dirName = rec?.buildDirName ?? msg.shareId;
            removeShareBuild(dirName);
          } catch (err: any) {
            console.warn('[frank] failed to remove share-build dir:', err.message);
          }
          reply({ type: 'share-revoke-result', ...result, outcome: result.status === 'complete' ? 'ok' : 'partial' });
        } catch (e: any) {
          reply({ type: 'error', error: e.message });
        }
      })();
      break;
    }

    case 'share-preflight': {
      if (!msg.projectDir || typeof msg.projectDir !== 'string') {
        reply({ type: 'error', error: 'share-preflight requires a projectDir string' });
        break;
      }
      (async () => {
        try {
          // Envelope first — preflight is only meaningful if envelope passes.
          const envelope = await checkEnvelope(msg.projectDir);
          if (envelope.status === 'fail' || !envelope.framework) {
            reply({ type: 'share-preflight-result', envelope, preflight: null });
            return;
          }
          const envShare = await readEnvShare(msg.projectDir);
          // Merge order (lowest → highest priority): encoder output,
          // .env.share user overrides, Frank-injected system vars. §3.3 says
          // user values win over encoder; §5.1 says FRANK_SHARE is always
          // set by Frank, not overridable.
          const encoderEnv = generateEncoderEnv(
            envelope.detectedSdks.map((s) => s.packageName),
          );
          const preflight = await runPreflight({
            projectDir: msg.projectDir,
            framework: envelope.framework.id,
            env: {
              ...encoderEnv,
              ...envShare,
              NEXT_PUBLIC_FRANK_SHARE: '1',
            },
          });
          reply({ type: 'share-preflight-result', envelope, preflight });
        } catch (e: any) {
          reply({ type: 'error', error: e.message });
        }
      })();
      break;
    }

    case 'set-project-intent': {
      try {
        const project = setProjectIntent(msg.projectId, msg.intent);
        // Reply with the full project so the UI can refresh its state without
        // a second round-trip. Matches the shape of `project-loaded`.
        const comments = loadComments(msg.projectId);
        reply({ type: 'project-loaded', projectId: msg.projectId, project, comments });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'set-project-source-dir': {
      try {
        const project = setProjectSourceDir(msg.projectId, msg.sourceDir);
        const comments = loadComments(msg.projectId);
        reply({ type: 'project-loaded', projectId: msg.projectId, project, comments });
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
        void forkPdfLivePush(activeProjectId);
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
        void forkPdfLivePush(activeProjectId);
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
          const result = await uploadShare(msg.snapshot, msg.coverNote, msg.contentType, oldShareId, oldRevokeToken, msg.expiryDays);
          if ('error' in result) {
            reply({ type: 'error', error: result.error });
          } else {
            // Update project with active share
            if (project && activeProjectId) {
              project.activeShare = {
                id: result.shareId,
                revokeToken: result.revokeToken,
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + (msg.expiryDays ?? 7) * 24 * 60 * 60 * 1000).toISOString(),
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
      const pid = msg.projectId || activeProjectId;
      if (!pid) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        reply({ type: 'snapshot-list', snapshots: listSnapshots(pid) });
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
        void forkPdfLivePush(activeProjectId);
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
      const pid = msg.projectId || activeProjectId;
      if (!pid) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const data = exportProject(pid);
        reply({ type: 'export-ready', data });
      } catch (e: any) {
        reply({ type: 'error', error: e.message });
      }
      break;
    }

    case 'export-report': {
      const pid = msg.projectId || activeProjectId;
      if (!pid) { reply({ type: 'error', error: 'No active project' }); break; }
      (async () => {
        try {
          if (msg.format !== 'markdown' && msg.format !== 'pdf') throw new Error(`Unknown format: ${msg.format}`);
          const result = await exportReport(pid, msg.format);
          reply({ type: 'report-ready', format: msg.format, mimeType: result.mimeType, data: result.data });
        } catch (e: any) {
          reply({ type: 'error', error: e.message });
        }
      })();
      break;
    }

    case 'export-bundle': {
      const pid = msg.projectId || activeProjectId;
      if (!pid) { reply({ type: 'error', error: 'No active project' }); break; }
      (async () => {
        try {
          const { buffer, filename } = await buildBundle(pid);
          reply({
            type: 'bundle-ready',
            mimeType: 'application/zip',
            filename,
            data: buffer.toString('base64'),
          });
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
      const pid = msg.projectId || activeProjectId;
      if (!pid) { reply({ type: 'error', error: 'No active project' }); break; }
      try {
        const state = loadCanvasState(pid);
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

    case 'start-live-share': {
      (async () => {
        try {
          const { projectId } = msg;
          if (liveShares.has(projectId)) { reply({ type: 'error', error: 'Live share already running' }); return; }
          const ctl = setupLiveShareController(projectId);
          const project = loadProject(projectId);
          if (project.activeShare) {
            project.activeShare.live = { revision: ctl.revision, startedAt: new Date().toISOString(), paused: false };
            saveProject(projectId, project);
          }
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
              clearPdfSendState(project.activeShare.id);
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
          // If the controller survived in memory (pause → resume within one
          // daemon lifetime), reuse it. Otherwise recreate from the persisted
          // activeShare so Resume works after a daemon restart.
          let ctl = liveShares.get(projectId);
          if (!ctl) {
            ctl = setupLiveShareController(projectId);
          } else {
            ctl.resume();
          }
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

    // ─── MCP canvas writes ───────────────────────────────────────────────
    //
    // Each write appends to the target project's canvas-state.json and
    // broadcasts canvas-state-changed so every open browser tab on that
    // project picks up the new content without a refresh. The write+read
    // order guarantees the broadcast payload already reflects the append.
    case 'mcp-add-shape': {
      try {
        const { id } = addShape(msg.projectId, {
          kind: msg.kind, x: msg.x, y: msg.y,
          width: msg.width, height: msg.height, text: msg.text,
          fill: msg.fill, stroke: msg.stroke,
        });
        touchProjectModified(msg.projectId);
        pushCanvasStateChanged(msg.projectId);
        reply({ type: 'mcp-write-ack', id });
      } catch (e: any) { reply({ type: 'error', error: e.message }); }
      break;
    }
    case 'mcp-add-text': {
      try {
        const { id } = addText(msg.projectId, { x: msg.x, y: msg.y, text: msg.text, fontSize: msg.fontSize });
        touchProjectModified(msg.projectId);
        pushCanvasStateChanged(msg.projectId);
        reply({ type: 'mcp-write-ack', id });
      } catch (e: any) { reply({ type: 'error', error: e.message }); }
      break;
    }
    case 'mcp-add-path': {
      try {
        const { id } = addPath(msg.projectId, msg.points, msg.stroke);
        touchProjectModified(msg.projectId);
        pushCanvasStateChanged(msg.projectId);
        reply({ type: 'mcp-write-ack', id });
      } catch (e: any) { reply({ type: 'error', error: e.message }); }
      break;
    }
    case 'mcp-add-connector': {
      try {
        const { id } = addConnector(msg.projectId, msg.fromId, msg.toId, msg.kind);
        touchProjectModified(msg.projectId);
        pushCanvasStateChanged(msg.projectId);
        reply({ type: 'mcp-write-ack', id });
      } catch (e: any) { reply({ type: 'error', error: e.message }); }
      break;
    }
    case 'mcp-insert-template': {
      // Templates are currently defined only in the browser (ui-v2/canvas/
      // templates.js). For v1 the MCP tool tells the AI to use add_shape for
      // the pieces it needs — a daemon-side template library is a follow-up.
      reply({ type: 'error', error: 'insert_template is not yet supported on the daemon; compose the template from add_shape + add_connector for now.' });
      break;
    }
    case 'mcp-create-share': {
      (async () => {
        try {
          const project = loadProject(msg.projectId);
          if (!project) { reply({ type: 'error', error: 'Project not found' }); return; }
          if (project.contentType !== 'canvas') {
            // URL / PDF / image shares need a DOM snapshot that only the
            // browser can produce. Tell the AI to hand off to the user.
            reply({ type: 'error', error: `create_share is canvas-only in v1 (this project is ${project.contentType}). Ask the user to open the share modal in Frank to share this ${project.contentType} project.` });
            return;
          }
          const payload = await buildCanvasLivePayload(msg.projectId);
          if (!payload) { reply({ type: 'error', error: 'Canvas is empty; add content before sharing.' }); return; }
          // Static share payload shape mirrors the browser's buildCanvasSnapshot,
          // minus the `preview` PNG (browser-only — the cover image slot on
          // the share page will fall back).
          const snapshot = { canvasState: payload.canvasState, assets: payload.assets, preview: null };
          const oldShareId = project.activeShare?.id;
          const oldRevokeToken = project.activeShare?.revokeToken;
          const result = await uploadShare(snapshot, msg.coverNote || '', 'canvas', oldShareId, oldRevokeToken, msg.expiryDays);
          if ('error' in result) {
            reply({ type: 'error', error: result.error });
            return;
          }
          const expiryDays = msg.expiryDays ?? 7;
          project.activeShare = {
            id: result.shareId,
            revokeToken: result.revokeToken,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + expiryDays * 86400000).toISOString(),
            coverNote: msg.coverNote || '',
            lastSyncedNoteId: null,
            unseenNotes: 0,
          };
          saveProject(msg.projectId, project);
          // Broadcast updated project so open tabs reflect the new activeShare.
          broadcast({ type: 'project-loaded', projectId: msg.projectId, project, comments: loadComments(msg.projectId) } as any);
          reply({
            type: 'mcp-share-created',
            shareId: result.shareId,
            url: result.url,
            revokeToken: result.revokeToken,
            expiresAt: project.activeShare.expiresAt,
          });
        } catch (e: any) { reply({ type: 'error', error: e.message }); }
      })();
      break;
    }

    case 'mcp-add-comment': {
      try {
        const project = loadProject(msg.projectId);
        // screenId depends on project type — canvas projects use a synthetic
        // 'canvas' screen; URL/PDF/image projects use the first screen key
        // the user has actually navigated to, falling back to 'default' (the
        // same key the viewer uses when no screens have been captured yet).
        const screenId = project.contentType === 'canvas'
          ? 'canvas'
          : (Object.keys(project.screens || {})[0] || 'default');

        // Resolve x/y. For shape-anchored comments, default to the shape's
        // centre when the caller omits them — x/y for shape anchors is only
        // the pin's visual fallback if the shape gets deleted.
        let x = msg.x;
        let y = msg.y;
        if (msg.shapeId && (x == null || y == null)) {
          try {
            const state = loadCanvasState(msg.projectId);
            if (state) {
              const doc = typeof state === 'string' ? JSON.parse(state) : state;
              for (const layer of (doc.children || [])) {
                const node = findNode(layer.children || [], msg.shapeId);
                if (node) { const c = nodeCenter(node); x ??= c.x; y ??= c.y; break; }
              }
            }
          } catch { /* fall through to 0,0 */ }
          x ??= 0; y ??= 0;
        }

        const anchor = msg.shapeId
          ? { type: 'shape' as const, shapeId: msg.shapeId, x: x!, y: y!, shapeLastKnown: { x: x!, y: y! } }
          : { type: 'pin' as const, x: x!, y: y! };
        const comment = addComment(msg.projectId, {
          screenId,
          anchor,
          author: msg.author || 'AI',
          text: msg.text,
        });
        touchProjectModified(msg.projectId);
        // Let every tab re-render comments + pins.
        broadcast({ type: 'project-loaded', projectId: msg.projectId, project: loadProject(msg.projectId), comments: loadComments(msg.projectId) } as any);
        reply({ type: 'mcp-write-ack', id: comment.id });
      } catch (e: any) { reply({ type: 'error', error: e.message }); }
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
          clearPdfSendState(project.activeShare.id);
          project.activeShare = null;
          saveProject(projectId, project);
          reply({ type: 'share-revoked', projectId });
          // Also push fresh project state so the UI's projectManager clears
          // its cached activeShare. Without this the popover + toolbar refresh
          // from share-revoked but projectManager.get() still reports the
          // old activeShare until the next full reload.
          reply({ type: 'project-loaded', projectId, project, comments: loadComments(projectId) });
        } catch (e: any) {
          reply({ type: 'error', error: e.message });
        }
      })();
      break;
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

// Read the current canvas-state and push it to every connected panel client.
// Called after MCP canvas writes so open tabs pick up AI-authored shapes
// without a refresh. Silent no-op if there's no state on disk.
function pushCanvasStateChanged(projectId: string): void {
  const state = loadCanvasState(projectId);
  if (!state) return;
  broadcast({ type: 'canvas-state-changed', projectId, state, source: 'ai' });
}

// Bump project.modified so the home-page sort + "Xm ago" timestamp
// reflect writes made through MCP (and any other path that writes to
// canvas-state or comments without going through saveProject).
function touchProjectModified(projectId: string): void {
  try {
    const project = loadProject(projectId);
    saveProject(projectId, project);
  } catch {
    // Project missing or unreadable — swallow; the write already happened.
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
      clearPdfSendState(project.activeShare.id);
    }
  }
  process.exit(0);
});

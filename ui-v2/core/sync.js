// sync.js — WebSocket client. All file I/O goes through the daemon.

const WS_URL = 'ws://localhost:42069';
let ws = null;
let pendingRequests = new Map();
let requestId = 0;
let messageHandlers = [];
let isConnected = false;
let reconnectTimer = null;

let connectionLostToast = null;
let wasEverConnected = false;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[sync] connected');
    isConnected = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (connectionLostToast) {
      connectionLostToast.dismiss();
      connectionLostToast = null;
      if (wasEverConnected) {
        // Reconnected after a drop — confirm visually.
        import('../components/toast.js').then(({ toastInfo }) => {
          toastInfo('Reconnected to the daemon.');
        });
      }
    }
    wasEverConnected = true;
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      // share-create-progress events stream in during the multi-minute
      // share-create pipeline, all stamped with the originating request's
      // requestId. They are NOT the final reply — resolving the pending
      // promise on the first one short-circuits and misses the real
      // share-create-result, making every share look like it failed at
      // "unknown". Broadcast to listeners and exit early so the pending
      // promise keeps waiting for the final share-create-result message.
      if (msg.type === 'share-create-progress') {
        window.dispatchEvent(new CustomEvent('frank:share-create-progress', { detail: msg }));
        return;
      }
      // Fire broadcast events for state-change types FIRST, regardless of
      // whether the message also carries a requestId. Without this the initial
      // reply to start/pause/resume-live-share would resolve the pending
      // promise and short-circuit, and the share-popover listener would never
      // see the state transition — the spinner would spin forever until the
      // next unrelated broadcast (or page refresh) arrived.
      if (
        msg.type === 'live-share-state' ||
        msg.type === 'live-share-comment' ||
        msg.type === 'share-revoked' ||
        msg.type === 'canvas-state-changed'
      ) {
        window.dispatchEvent(new CustomEvent(`frank:${msg.type}`, { detail: msg }));
      }
      if (msg.requestId && pendingRequests.has(msg.requestId)) {
        const { resolve } = pendingRequests.get(msg.requestId);
        pendingRequests.delete(msg.requestId);
        resolve(msg);
        return;
      }
      for (const handler of messageHandlers) handler(msg);
    } catch (e) {
      console.warn('[sync] parse error:', e);
    }
  };

  ws.onclose = () => {
    console.log('[sync] disconnected');
    isConnected = false;
    // Only surface a toast when we were connected first — on initial boot
    // failure we leave console.log to avoid flashing a toast during the
    // very first second of page load.
    if (wasEverConnected && !connectionLostToast) {
      import('../components/toast.js').then(({ toastError }) => {
        connectionLostToast = toastError('Lost connection to daemon. Trying to reconnect…');
      });
    }
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
    // 30s handles first-time PDF rendering (pdfmake + fontkit cold import
    // can take several seconds on first call). Normal ops are sub-second.
    // Long-running ops (preflight, share-create) pass _timeoutMs to override.
    const timeoutMs = msg._timeoutMs || 30000;
    delete msg._timeoutMs;
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }
    }, timeoutMs);
  });
}

const sync = {
  connect,
  onMessage(handler) { messageHandlers.push(handler); },
  offMessage(handler) { messageHandlers = messageHandlers.filter(h => h !== handler); },
  // Generic send for WebSocket messages without a dedicated method — used by
  // live-share lifecycle events (start/stop/resume/revoke) and any other
  // fire-and-forget messages that don't need a typed wrapper.
  send(msg) { return send(msg); },

  listProjects() { return send({ type: 'list-projects' }); },
  loadProject(projectId) { return send({ type: 'load-project', projectId }); },
  createProject(name, contentType, url, file) {
    return send({ type: 'create-project', name, contentType, url, file });
  },
  createProjectFromFile(name, contentType, fileName, data) {
    return send({ type: 'create-project-from-file', name, contentType, fileName, data });
  },
  uploadAsset(projectId, mimeType, data) {
    return send({ type: 'upload-asset', projectId, mimeType, data });
  },
  deleteProject(projectId) { return send({ type: 'delete-project', projectId }); },
  renameProject(projectId, name) { return send({ type: 'rename-project', projectId, name }); },
  setProjectIntent(projectId, intent) { return send({ type: 'set-project-intent', projectId, intent }); },
  setProjectSourceDir(projectId, sourceDir) { return send({ type: 'set-project-source-dir', projectId, sourceDir }); },
  archiveProject(projectId) { return send({ type: 'archive-project', projectId }); },
  unarchiveProject(projectId) { return send({ type: 'unarchive-project', projectId }); },
  trashProject(projectId) { return send({ type: 'trash-project', projectId }); },
  restoreProject(projectId) { return send({ type: 'restore-project', projectId }); },
  purgeProject(projectId) { return send({ type: 'purge-project', projectId }); },
  addScreen(route, label) { return send({ type: 'add-screen', route, label }); },
  addComment(screenId, anchor, text) {
    return send({ type: 'add-comment', screenId, anchor, text });
  },
  deleteComment(commentId) { return send({ type: 'delete-comment', commentId }); },
  requestProxy(url) { return send({ type: 'proxy-url', url }); },
  uploadShare(snapshot, coverNote, contentType, oldShareId, oldRevokeToken, expiryDays) {
    return send({ type: 'upload-share', snapshot, coverNote, contentType, oldShareId, oldRevokeToken, expiryDays });
  },
  getCloudStatus() {
    return send({ type: 'cloud-status' });
  },
  saveSnapshot(html, screenshot, trigger, triggeredBy) {
    return send({ type: 'save-snapshot', html, screenshot, trigger, triggeredBy });
  },
  saveCanvasSnapshot(canvasState, thumbnail, trigger, triggeredBy) {
    return send({ type: 'save-canvas-snapshot', canvasState, thumbnail, trigger, triggeredBy });
  },
  listSnapshots() { return send({ type: 'list-snapshots' }); },
  starSnapshot(snapshotId, label) { return send({ type: 'star-snapshot', snapshotId, label }); },
  curateComment(commentIds, action, remixedText, dismissReason) {
    return send({ type: 'curate-comment', commentIds, action, remixedText, dismissReason });
  },
  logAiInstruction(feedbackIds, curationIds, instruction) {
    return send({ type: 'log-ai-instruction', feedbackIds, curationIds, instruction });
  },
  exportProject() { return send({ type: 'export-project' }); },
  exportBundle() { return send({ type: 'export-bundle' }); },
  exportReport(format) { return send({ type: 'export-report', format }); },
  revealProjectFolder(projectId) { return send({ type: 'reveal-project-folder', projectId }); },
  getCloudConfig() { return send({ type: 'get-cloud-config' }); },
  setCloudConfig(cloudUrl, apiKey) { return send({ type: 'set-cloud-config', cloudUrl, apiKey }); },
  testCloudConnection() { return send({ type: 'test-cloud-connection' }); },
  shareCheckEnvelope(projectDir) { return send({ type: 'share-check-envelope', projectDir }); },
  // Preflight runs build + 30s smoke tail; 5-minute ceiling leaves headroom
  // for larger apps. Share-create adds Vercel build on top — 15-minute
  // ceiling accounts for the doc's 5-minute Vercel build + client buffer.
  sharePreflight(projectDir) {
    return send({ type: 'share-preflight', projectDir, _timeoutMs: 5 * 60 * 1000 });
  },
  shareCreate(projectDir, projectName, expiryDays, projectId) {
    return send({ type: 'share-create', projectDir, projectName, expiryDays, projectId, _timeoutMs: 15 * 60 * 1000 });
  },
  shareRevokeUrl(shareId, revokeToken, vercelDeploymentId, vercelTeamId) {
    return send({
      type: 'share-revoke-url', shareId, revokeToken, vercelDeploymentId, vercelTeamId,
      _timeoutMs: 60 * 1000,
    });
  },
  listUrlShares(projectId) { return send({ type: 'list-url-shares', projectId }); },
  listPendingRevokes() { return send({ type: 'list-pending-revokes' }); },
  getVercelDeployConfig() { return send({ type: 'get-vercel-deploy-config' }); },
  setVercelDeployConfig(token, teamId) { return send({ type: 'set-vercel-deploy-config', token, teamId }); },
  clearVercelDeployConfig() { return send({ type: 'clear-vercel-deploy-config' }); },
  testVercelToken(token) { return send({ type: 'test-vercel-token', token }); },

  // ── v0 Platform API ──
  getV0Config() { return send({ type: 'get-v0-config' }); },
  setV0Config(apiKey) { return send({ type: 'set-v0-config', apiKey }); },
  clearV0Config() { return send({ type: 'clear-v0-config' }); },
  testV0Token(apiKey) { return send({ type: 'test-v0-token', apiKey }); },
  addV0Chat(projectId, chatUrl) { return send({ type: 'add-v0-chat', projectId, chatUrl }); },
  removeV0Chat(projectId, chatId) { return send({ type: 'remove-v0-chat', projectId, chatId }); },
  sendToV0Chat(projectId, chatId, message, commentIds) {
    return send({ type: 'send-to-v0-chat', projectId, chatId, message, commentIds });
  },

  loadCanvasState() { return send({ type: 'load-canvas-state' }); },
  saveCanvasState(state) { return send({ type: 'save-canvas-state', state }); },
};

export default sync;

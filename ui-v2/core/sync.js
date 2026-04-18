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
  uploadShare(snapshot, coverNote, contentType, oldShareId, oldRevokeToken) {
    return send({ type: 'upload-share', snapshot, coverNote, contentType, oldShareId, oldRevokeToken });
  },
  getCloudStatus() {
    return send({ type: 'cloud-status' });
  },
  saveSnapshot(html, screenshot, trigger, triggeredBy) {
    return send({ type: 'save-snapshot', html, screenshot, trigger, triggeredBy });
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
  loadCanvasState() { return send({ type: 'load-canvas-state' }); },
  saveCanvasState(state) { return send({ type: 'save-canvas-state', state }); },

  getAiConfig() { return send({ type: 'get-ai-config' }); },
  setAiApiKey(provider, apiKey) { return send({ type: 'set-ai-api-key', provider, apiKey }); },
  clearAiApiKey(provider) { return send({ type: 'clear-ai-api-key', provider }); },
  listAiConversations() { return send({ type: 'list-ai-conversations' }); },
  loadAiConversation(conversationId) { return send({ type: 'load-ai-conversation', conversationId }); },

  // sendAiMessage intentionally doesn't wait for a "done" reply — the response
  // streams through the daemon push channel as ai-stream-* messages. We resolve
  // immediately on ai-stream-started (which carries the matching requestId).
  sendAiMessage({ conversationId, continuedFrom, message, feedbackIds }) {
    return send({ type: 'send-ai-message', conversationId, continuedFrom, message, feedbackIds });
  },

  listScaffoldTemplates() { return send({ type: 'list-scaffold-templates' }); },
  // scaffoldProject returns when the daemon acknowledges with the first
  // scaffold-status. The rest of the lifecycle (installing/starting/ready)
  // arrives as push messages, handled by the subscriber in scaffold.js.
  scaffoldProject({ templateId, name, targetDir }) {
    return send({ type: 'scaffold-project', templateId, name, targetDir });
  },
  stopScaffoldedServer(projectId) { return send({ type: 'stop-scaffolded-server', projectId }); },
};

export default sync;

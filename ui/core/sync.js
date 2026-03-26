// sync.js — WebSocket client. All file I/O goes through the daemon.

const WS_URL = 'ws://localhost:42069';
let ws = null;
let pendingRequests = new Map();
let requestId = 0;
let onProjectUpdate = null;
let readyCallback = null;
let errorCallback = null;
let isConnected = false;
let waitingForConnect = []; // Queue of { resolve } waiting for connection

function resolveAllWaiters() {
  const waiters = waitingForConnect;
  waitingForConnect = [];
  for (const w of waiters) w.resolve();
}

function rejectAllWaiters(err) {
  const waiters = waitingForConnect;
  waitingForConnect = [];
  for (const w of waiters) w.reject(err);
}

function waitForConnection() {
  if (isConnected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    waitingForConnect.push({ resolve, reject });
  });
}

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[sync] connected to daemon');
    isConnected = true;
    resolveAllWaiters();
    if (readyCallback) readyCallback();
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
      if (msg.type === 'project-updated' && onProjectUpdate) {
        onProjectUpdate(msg);
      }
      if (msg.type === 'render' && onProjectUpdate) {
        onProjectUpdate(msg);
      }
    } catch (e) {
      console.warn('[sync] message parse error:', e);
    }
  };

  ws.onclose = () => {
    console.log('[sync] disconnected, reconnecting in 2s...');
    isConnected = false;
    // Reject pending requests — they were sent on the old socket
    for (const [id, { reject }] of pendingRequests) {
      reject(new Error('WebSocket disconnected'));
    }
    pendingRequests.clear();
    // Reject anyone waiting for connection — they'll retry via the caller
    rejectAllWaiters(new Error('WebSocket disconnected'));
    setTimeout(connect, 2000);
  };

  ws.onerror = (e) => {
    console.error('[sync] WebSocket error:', e);
    if (errorCallback) errorCallback('WebSocket connection failed to ws://localhost:42069');
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

async function request(msg) {
  await waitForConnection();
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    msg.requestId = id;
    pendingRequests.set(id, { resolve, reject });
    send(msg);
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
  onProjectUpdate(cb) { onProjectUpdate = cb; },
  onReady(cb) { readyCallback = cb; },
  onError(cb) { errorCallback = cb; },

  async listProjects() {
    const res = await request({ type: 'list-projects' });
    return res.projects || [];
  },

  async loadProject(filePath) {
    const res = await request({ type: 'load-project', filePath });
    return { project: res.project || null, filePath: res.filePath || filePath };
  },

  async saveProject(project) {
    const res = await request({ type: 'save-project', project });
    return res.success || false;
  },

  async createProject(label) {
    const res = await request({ type: 'create-project', label });
    return { project: res.project || null, filePath: res.filePath || null };
  },

  async archiveProject(filePath) {
    const res = await request({ type: 'archive-project', filePath });
    return res.success || false;
  },

  setActiveProject(filePath) {
    send({ type: 'project-changed', filePath });
  },
};

export default sync;

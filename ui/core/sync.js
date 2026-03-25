// sync.js — WebSocket client. All file I/O goes through the daemon.

const WS_URL = 'ws://localhost:42069';
let ws = null;
let pendingRequests = new Map();
let requestId = 0;
let onProjectUpdate = null;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => console.log('[sync] connected to daemon');

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
    for (const [id, { reject }] of pendingRequests) {
      reject(new Error('WebSocket disconnected'));
    }
    pendingRequests.clear();
    setTimeout(connect, 2000);
  };

  ws.onerror = () => {};
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function request(msg) {
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

  async listProjects() {
    const res = await request({ type: 'list-projects' });
    return res.projects || [];
  },

  async loadProject(filePath) {
    const res = await request({ type: 'load-project', filePath });
    return res.project || null;
  },

  async saveProject(project) {
    const res = await request({ type: 'save-project', project });
    return res.success || false;
  },

  async createProject(label) {
    const res = await request({ type: 'create-project', label });
    return res.project || null;
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

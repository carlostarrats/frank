// viewer.js — Share viewer: fetches snapshot, renders content, commenting for reviewers

const shareId = window.location.pathname.split('/s/')[1] || new URLSearchParams(window.location.search).get('id');

async function init() {
  const app = document.getElementById('viewer-app');
  if (!shareId) {
    app.innerHTML = '<div class="v-error"><h2>No share ID</h2><p>Check the URL and try again.</p></div>';
    return;
  }

  try {
    const res = await fetch(`/api/share?id=${encodeURIComponent(shareId)}`);
    const data = await res.json();

    if (data.error) {
      const title = data.error === 'expired' ? 'Link Expired' : 'Not Found';
      const msg = data.message || "This link doesn't exist.";
      app.innerHTML = `<div class="v-error"><h2>${title}</h2><p>${esc(msg)}</p></div>`;
      return;
    }

    renderViewer(app, data);
  } catch (e) {
    app.innerHTML = '<div class="v-error"><h2>Unable to load</h2><p>Check your connection and refresh.</p></div>';
  }
}

function renderViewer(app, data) {
  const { snapshot, comments, coverNote, metadata } = data;

  app.innerHTML = `
    ${coverNote ? `
      <div class="v-toast" id="v-toast">
        <div class="v-toast-inner">
          <span>${esc(coverNote)}</span>
          <button class="v-toast-close" id="toast-close">&times;</button>
        </div>
      </div>
    ` : ''}
    <div class="v-main">
      <div class="v-content" id="v-content"></div>
      <div class="v-sidebar" id="v-sidebar">
        <div class="v-sidebar-header">
          <h3>Comments (${comments.length})</h3>
          <button class="v-btn" id="v-add-comment">+ Comment</button>
        </div>
        <div class="v-comments" id="v-comments"></div>
        <div class="v-comment-form" id="v-comment-form" style="display:none">
          <input type="text" class="v-input" id="v-author" placeholder="Your name" value="${getAuthor()}">
          <textarea class="v-input v-textarea" id="v-comment-text" placeholder="Add a comment..." rows="3"></textarea>
          <div class="v-prompts">
            <button class="v-prompt" data-text="How does this feel?">How does this feel?</button>
            <button class="v-prompt" data-text="What's missing?">What's missing?</button>
            <button class="v-prompt" data-text="What would you change?">What would you change?</button>
          </div>
          <div class="v-form-actions">
            <button class="v-btn v-btn-ghost" id="v-cancel">Cancel</button>
            <button class="v-btn v-btn-primary" id="v-submit">Comment</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render content — branch on snapshot shape.
  const contentEl = document.getElementById('v-content');
  if (snapshot?.canvasState) {
    renderCanvasSnapshot(contentEl, snapshot);
  } else if (snapshot?.html) {
    const iframe = document.createElement('iframe');
    iframe.className = 'v-iframe';
    iframe.sandbox = 'allow-same-origin';
    iframe.srcdoc = snapshot.html;
    contentEl.appendChild(iframe);
  } else if (snapshot?.fileUrl) {
    if (metadata.contentType === 'image') {
      contentEl.innerHTML = `<img src="${esc(snapshot.fileUrl)}" class="v-image" alt="Shared content">`;
    } else {
      contentEl.innerHTML = `<iframe src="${esc(snapshot.fileUrl)}" class="v-iframe"></iframe>`;
    }
  } else {
    contentEl.innerHTML = '<div class="v-error"><p>No content in this share</p></div>';
  }

  // Render comments
  renderCommentList(comments);

  // Toast
  document.getElementById('toast-close')?.addEventListener('click', () => {
    document.getElementById('v-toast')?.remove();
  });

  // Comment form
  const form = document.getElementById('v-comment-form');
  document.getElementById('v-add-comment')?.addEventListener('click', () => {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('v-cancel')?.addEventListener('click', () => {
    form.style.display = 'none';
  });

  // Guided prompts
  document.querySelectorAll('.v-prompt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('v-comment-text').value = btn.dataset.text;
    });
  });

  // Submit comment
  document.getElementById('v-submit')?.addEventListener('click', async () => {
    const author = document.getElementById('v-author').value.trim();
    const text = document.getElementById('v-comment-text').value.trim();
    if (!author || !text) return;

    saveAuthor(author);
    try {
      const res = await fetch('/api/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareId, screenId: 'default', author, text }),
      });
      const data = await res.json();
      if (data.comment) {
        comments.push(data.comment);
        renderCommentList(comments);
        document.getElementById('v-comment-text').value = '';
        form.style.display = 'none';
      }
    } catch (e) {
      console.error('Failed to submit comment:', e);
    }
  });
}

function renderCommentList(comments) {
  const el = document.getElementById('v-comments');
  if (!el) return;
  if (comments.length === 0) {
    el.innerHTML = '<p class="v-empty">No comments yet</p>';
    return;
  }
  el.innerHTML = comments.map(c => `
    <div class="v-comment">
      <div class="v-comment-head">
        <strong>${esc(c.author)}</strong>
        <span class="v-comment-time">${timeAgo(c.ts)}</span>
      </div>
      <p>${esc(c.text)}</p>
    </div>
  `).join('');
}

function getAuthor() { return localStorage.getItem('frank-author') || ''; }
function saveAuthor(name) { localStorage.setItem('frank-author', name); }

// ─── Canvas snapshot rendering ──────────────────────────────────────────────

async function renderCanvasSnapshot(host, snapshot) {
  host.innerHTML = '<div class="viewer-loading">Loading canvas…</div>';
  try {
    await loadKonvaOnce();
  } catch {
    host.innerHTML = '<div class="v-error"><p>Could not load canvas renderer.</p></div>';
    return;
  }

  host.innerHTML = '<div class="v-canvas-wrapper" id="v-canvas-wrapper"></div>';
  const wrapper = host.querySelector('#v-canvas-wrapper');
  const width = wrapper.clientWidth || 900;
  const height = wrapper.clientHeight || 600;

  const Konva = window.Konva;
  const stage = new Konva.Stage({ container: wrapper, width, height });
  const contentLayer = new Konva.Layer();
  stage.add(contentLayer);

  // Deserialize the canvas content. Image nodes reference assetUrl; swap each
  // one for the inline data URL bundled in snapshot.assets.
  const parsed = typeof snapshot.canvasState === 'string'
    ? JSON.parse(snapshot.canvasState)
    : snapshot.canvasState;
  const assets = snapshot.assets || {};

  for (const def of (parsed.children || [])) {
    try {
      const node = Konva.Node.create(JSON.stringify(def));
      if (!node) continue;
      node.draggable(false);
      contentLayer.add(node);
    } catch (err) {
      console.warn('[v] deserialize failed', err);
    }
  }

  // Rehydrate Image nodes with bundled data URLs.
  const images = contentLayer.find('Image');
  for (const node of images) {
    const url = node.getAttr('assetUrl');
    const dataUrl = assets[url];
    if (!dataUrl) continue;
    await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { node.image(img); resolve(); };
      img.onerror = resolve;
      img.src = dataUrl;
    });
  }

  // Fit content into viewport.
  const bounds = contentLayer.getClientRect();
  if (bounds && bounds.width > 0 && bounds.height > 0) {
    const scale = Math.min((width - 40) / bounds.width, (height - 40) / bounds.height, 1);
    stage.scale({ x: scale, y: scale });
    stage.position({
      x: (width - bounds.width * scale) / 2 - bounds.x * scale,
      y: (height - bounds.height * scale) / 2 - bounds.y * scale,
    });
  }

  // Wheel zoom for reviewers.
  stage.on('wheel', (e) => {
    e.evt.preventDefault();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    const mousePt = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    const step = 1.08;
    const newScale = e.evt.deltaY > 0 ? oldScale / step : oldScale * step;
    const clamped = Math.max(0.1, Math.min(8, newScale));
    stage.scale({ x: clamped, y: clamped });
    stage.position({
      x: pointer.x - mousePt.x * clamped,
      y: pointer.y - mousePt.y * clamped,
    });
  });

  contentLayer.draw();
}

let konvaPromise = null;
function loadKonvaOnce() {
  if (window.Konva) return Promise.resolve();
  if (konvaPromise) return konvaPromise;
  konvaPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/konva@9/konva.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Konva load failed'));
    document.head.appendChild(s);
  });
  return konvaPromise;
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text || '';
  return d.innerHTML;
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

init();

// ─── v3 live-share client ───────────────────────────────────────────────────
// Subscribes to /api/share/:id/stream, dispatches events via CustomEvent
// for project-type-specific renderers (Phases 2–4). For Phase 1 this client
// routes events but does not itself re-render project content.

(function initLiveShare() {
  const shareId = new URLSearchParams(location.search).get('id')
    || location.pathname.match(/\/s\/([^/]+)/)?.[1];
  if (!shareId) return;

  const presenceEl = document.getElementById('frank-presence');
  const authorStatusEl = document.getElementById('frank-author-status');
  const reconnectEl = document.getElementById('frank-reconnect');

  let lastRevision = window.__frankInitialRevision ?? -1;
  let es = null;
  let heartbeatTimer = null;
  let fallbackPollTimer = null;

  function setPresence(n) {
    if (!presenceEl) return;
    presenceEl.textContent = n === 1 ? '1 watching' : `${n} watching`;
    presenceEl.hidden = n === 0;
  }
  function setAuthor(status) {
    if (!authorStatusEl) return;
    authorStatusEl.dataset.status = status;
    authorStatusEl.hidden = false;
    authorStatusEl.textContent = {
      online: 'Author online',
      offline: 'Author offline',
      ended: 'Author ended live share',
    }[status] || '';
  }
  function setReconnecting(on) { if (reconnectEl) reconnectEl.hidden = !on; }

  function openStream() {
    setReconnecting(false);
    es = new EventSource(`/api/share/${encodeURIComponent(shareId)}/stream`, { withCredentials: true });
    es.addEventListener('state', (ev) => {
      const data = JSON.parse(ev.data);
      lastRevision = data.revision;
      window.dispatchEvent(new CustomEvent('frank:state', { detail: data }));
    });
    es.addEventListener('diff', (ev) => {
      const data = JSON.parse(ev.data);
      lastRevision = data.revision;
      window.dispatchEvent(new CustomEvent('frank:diff', { detail: data }));
    });
    es.addEventListener('comment', (ev) => {
      window.dispatchEvent(new CustomEvent('frank:comment', { detail: JSON.parse(ev.data) }));
    });
    es.addEventListener('presence', (ev) => {
      const { viewers } = JSON.parse(ev.data);
      setPresence(viewers);
    });
    es.addEventListener('author-status', (ev) => {
      const { status } = JSON.parse(ev.data);
      setAuthor(status);
    });
    es.addEventListener('share-ended', (ev) => {
      const { reason } = JSON.parse(ev.data);
      setAuthor('ended');
      if (es) { es.close(); es = null; }
      document.body.classList.add(`frank-ended-${reason}`);
    });
    es.onerror = () => {
      setReconnecting(true);
      // Browser auto-reconnects via EventSource. If terminal (404/410) the
      // readyState goes to CLOSED — fall back to polling.
      if (es && es.readyState === EventSource.CLOSED) {
        es = null;
        startPollingFallback();
      }
    };
  }

  function startPollingFallback() {
    if (fallbackPollTimer) return;
    const pollEl = document.getElementById('frank-updates-disabled');
    if (pollEl) pollEl.hidden = false;
    async function poll() {
      try {
        const r = await fetch(`/api/share?id=${encodeURIComponent(shareId)}`);
        const j = await r.json();
        if (j.snapshot && j.snapshot.revision && j.snapshot.revision > lastRevision) {
          lastRevision = j.snapshot.revision;
          window.dispatchEvent(new CustomEvent('frank:state', { detail: j.snapshot }));
        }
      } catch { /* keep trying */ }
    }
    fallbackPollTimer = setInterval(poll, 5_000);
  }

  function startHeartbeat() {
    heartbeatTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fetch(`/api/share/${encodeURIComponent(shareId)}/ping`, { method: 'POST', credentials: 'include' })
        .catch(() => { /* transient */ });
    }, 60_000);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !es && !fallbackPollTimer) {
      openStream();
    }
  });

  openStream();
  startHeartbeat();
})();

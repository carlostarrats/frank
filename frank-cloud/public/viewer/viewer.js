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
          <button class="v-btn v-hide-mobile" id="v-add-comment">+ Comment</button>
          <span class="v-mobile-only v-mobile-hint">Open on desktop to comment</span>
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
    window.__frankInitialRevision = snapshot.revision ?? 0;
  } else if (snapshot?.html) {
    const iframe = document.createElement('iframe');
    iframe.className = 'v-iframe';
    iframe.sandbox = 'allow-same-origin';
    iframe.srcdoc = snapshot.html;
    contentEl.appendChild(iframe);
  } else if (snapshot?.fileDataUrl) {
    if (metadata.contentType === 'image') {
      contentEl.innerHTML = `<img src="${esc(snapshot.fileDataUrl)}" class="v-image" alt="Shared content">`;
      __imageCache = { fileDataUrl: snapshot.fileDataUrl, mimeType: snapshot.mimeType };
    } else if (metadata.contentType === 'pdf') {
      contentEl.innerHTML = `<iframe src="${esc(snapshot.fileDataUrl)}" class="v-iframe"></iframe>`;
      __pdfCache = { fileDataUrl: snapshot.fileDataUrl, mimeType: snapshot.mimeType };
    } else {
      contentEl.innerHTML = '<div class="v-error"><p>Unsupported content type</p></div>';
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

// Module-level state: preserved across live-share events so updates render
// in place rather than stacking new stages.
let __canvasStage = null;
const __assetCache = {}; // url → dataUrl, merged across state + diff events

// v3 Phase 3 — image live share cache. Cold-open render seeds this with the
// initial snapshot's fileDataUrl; renderImageLive compares incoming payload
// fileDataUrl against it to skip redundant `img.src =` assignments when the
// image hasn't changed (the 30s-promotion case: same image, new comments).
// If a future feature ever swaps the source image mid-session, the cache
// comparison triggers a visible img.src update.
let __imageCache = null; // { fileDataUrl, mimeType } or null

// v3 Phase 4a — PDF live share cache. Same pattern as __imageCache: cold-open
// render seeds this, and renderPdfLive compares payload.fileDataUrl against
// it to skip redundant iframe src reassignment. PDF file is immutable during
// a session so the src rarely changes; state events carry it for snapshot
// freshness, not because the PDF actually updated.
let __pdfCache = null; // { fileDataUrl, mimeType } or null

async function renderCanvas(payload) {
  // payload shape: { canvasState: string, assets: Record<url, dataUrl> }
  if (!payload || !payload.canvasState) return;

  // Merge assets from this payload into the long-lived cache. Diff events
  // may arrive with assets: {} — that's fine, the cache retains prior entries.
  Object.assign(__assetCache, payload.assets || {});

  try {
    await loadKonvaOnce();
  } catch {
    const host = document.getElementById('v-content');
    if (host) host.innerHTML = '<div class="v-error"><p>Could not load canvas renderer.</p></div>';
    return;
  }

  const Konva = window.Konva;

  // On first render, build the wrapper + stage. On subsequent renders
  // (live-share updates), reuse the existing stage by clearing its layers.
  let contentLayer;
  if (!__canvasStage) {
    const host = document.getElementById('v-content');
    if (!host) return;
    host.innerHTML = '<div class="v-canvas-wrapper" id="v-canvas-wrapper"></div>';
    const wrapper = host.querySelector('#v-canvas-wrapper');
    const width = wrapper.clientWidth || 900;
    const height = wrapper.clientHeight || 600;

    __canvasStage = new Konva.Stage({ container: wrapper, width, height });
    contentLayer = new Konva.Layer();
    __canvasStage.add(contentLayer);

    // Wheel zoom for reviewers — wired once on stage creation.
    __canvasStage.on('wheel', (e) => {
      e.evt.preventDefault();
      const oldScale = __canvasStage.scaleX();
      const pointer = __canvasStage.getPointerPosition();
      const mousePt = {
        x: (pointer.x - __canvasStage.x()) / oldScale,
        y: (pointer.y - __canvasStage.y()) / oldScale,
      };
      const step = 1.08;
      const newScale = e.evt.deltaY > 0 ? oldScale / step : oldScale * step;
      const clamped = Math.max(0.1, Math.min(8, newScale));
      __canvasStage.scale({ x: clamped, y: clamped });
      __canvasStage.position({
        x: pointer.x - mousePt.x * clamped,
        y: pointer.y - mousePt.y * clamped,
      });
    });

    // Touch pan + pinch zoom for mobile reviewers. One finger pans; two
    // fingers pinch-zoom around the midpoint. Without this the canvas is
    // frozen on phones — wheel events never fire.
    let __touchLastDist = 0;
    let __touchLastCenter = null;
    let __touchPanStart = null;
    const stageContainer = __canvasStage.container();
    stageContainer.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        __touchPanStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, stageX: __canvasStage.x(), stageY: __canvasStage.y() };
      } else if (e.touches.length === 2) {
        __touchPanStart = null;
        const [a, b] = e.touches;
        __touchLastDist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        __touchLastCenter = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
      }
    }, { passive: true });
    stageContainer.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && __touchPanStart) {
        e.preventDefault();
        const t = e.touches[0];
        __canvasStage.position({
          x: __touchPanStart.stageX + (t.clientX - __touchPanStart.x),
          y: __touchPanStart.stageY + (t.clientY - __touchPanStart.y),
        });
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const [a, b] = e.touches;
        const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        const center = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
        if (__touchLastDist > 0) {
          const oldScale = __canvasStage.scaleX();
          const rect = stageContainer.getBoundingClientRect();
          const local = { x: center.x - rect.left, y: center.y - rect.top };
          const worldPt = { x: (local.x - __canvasStage.x()) / oldScale, y: (local.y - __canvasStage.y()) / oldScale };
          const newScale = Math.max(0.1, Math.min(8, oldScale * (dist / __touchLastDist)));
          __canvasStage.scale({ x: newScale, y: newScale });
          __canvasStage.position({
            x: local.x - worldPt.x * newScale,
            y: local.y - worldPt.y * newScale,
          });
        }
        __touchLastDist = dist;
        __touchLastCenter = center;
      }
    }, { passive: false });
    stageContainer.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        __touchPanStart = null;
        __touchLastDist = 0;
        __touchLastCenter = null;
      } else if (e.touches.length === 1) {
        __touchLastDist = 0;
        __touchLastCenter = null;
        __touchPanStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, stageX: __canvasStage.x(), stageY: __canvasStage.y() };
      }
    }, { passive: true });

    // Keep the stage sized to its container on viewport changes (rotation,
    // browser chrome show/hide, sidebar toggle). Without this, the stage
    // stays at its initial dimensions and content gets clipped.
    const resizeStage = () => {
      const w = stageContainer.clientWidth;
      const h = stageContainer.clientHeight;
      if (w > 0 && h > 0) {
        __canvasStage.size({ width: w, height: h });
        __canvasStage.batchDraw();
      }
    };
    window.addEventListener('resize', resizeStage);
    if (window.ResizeObserver) new ResizeObserver(resizeStage).observe(stageContainer);
  } else {
    // Reuse existing stage: destroy existing layer children and replace layer.
    __canvasStage.destroyChildren();
    contentLayer = new Konva.Layer();
    __canvasStage.add(contentLayer);
  }

  const width = __canvasStage.width();
  const height = __canvasStage.height();

  // Deserialize the canvas content. Image nodes reference assetUrl; swap each
  // one for the inline data URL from __assetCache (populated by state events
  // and the initial snapshot; diff events rely on the cached entries).
  const parsed = typeof payload.canvasState === 'string'
    ? JSON.parse(payload.canvasState)
    : payload.canvasState;

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
    const dataUrl = __assetCache[url];
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
    __canvasStage.scale({ x: scale, y: scale });
    __canvasStage.position({
      x: (width - bounds.width * scale) / 2 - bounds.x * scale,
      y: (height - bounds.height * scale) / 2 - bounds.y * scale,
    });
  }

  contentLayer.draw();
}

// Called by renderViewer for the initial snapshot render. `host` is always
// document.getElementById('v-content'), which renderCanvas also looks up
// internally — so they refer to the same element.
async function renderCanvasSnapshot(host, snapshot) {
  host.innerHTML = '<div class="viewer-loading">Loading canvas…</div>';
  await renderCanvas(snapshot);
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

// ─── v3 Phase 2: canvas live-render ─────────────────────────────────────────
// Wire canvas re-renders to live-share events dispatched by initLiveShare.
// `state` events carry the full asset bundle; `diff` events carry just the
// canvas JSON (assets are already in __assetCache from the most recent state
// event or the initial snapshot).

// v3 Phase 3 — image live share renderer. Declaration of __imageCache lives
// alongside __canvasStage and __assetCache above, by convention.
function renderImageLive(payload) {
  // payload is either:
  //   state: { fileDataUrl, mimeType, comments }
  //   diff:  { comments }
  // The <img> element in #v-content stays put across events. We update the
  // src only when fileDataUrl actually changed, and re-render the comment
  // list on every event that carries comments.
  if (payload?.fileDataUrl) {
    if (__imageCache?.fileDataUrl !== payload.fileDataUrl) {
      __imageCache = { fileDataUrl: payload.fileDataUrl, mimeType: payload.mimeType };
      const img = document.querySelector('#v-content .v-image');
      if (img) img.src = payload.fileDataUrl;
    }
  }
  if (Array.isArray(payload?.comments)) {
    renderCommentList(payload.comments);
  }
}

// v3 Phase 4a — PDF live share renderer. Declaration of __pdfCache lives
// alongside __canvasStage / __assetCache / __imageCache above, by convention.
function renderPdfLive(payload) {
  // payload is either:
  //   state: { fileDataUrl, mimeType, comments }
  //   diff:  { comments }
  // The <iframe> element in #v-content stays put across events. The iframe
  // src only changes on true source-file swaps (rare — the PDF is immutable
  // during a session). We re-render the comment list on every event that
  // carries comments.
  if (payload?.fileDataUrl) {
    if (__pdfCache?.fileDataUrl !== payload.fileDataUrl) {
      __pdfCache = { fileDataUrl: payload.fileDataUrl, mimeType: payload.mimeType };
      const iframe = document.querySelector('#v-content .v-iframe');
      if (iframe) iframe.src = payload.fileDataUrl;
    }
  }
  if (Array.isArray(payload?.comments)) {
    renderCommentList(payload.comments);
  }
}

window.addEventListener('frank:state', async (e) => {
  const { contentType, payload } = e.detail || {};
  if (contentType === 'canvas') {
    await renderCanvas(payload);
  } else if (contentType === 'image') {
    renderImageLive(payload);
  } else if (contentType === 'pdf') {
    renderPdfLive(payload);
  }
});

window.addEventListener('frank:diff', async (e) => {
  const { contentType, payload } = e.detail || {};
  if (contentType === 'canvas') {
    await renderCanvas(payload);
  } else if (contentType === 'image') {
    renderImageLive(payload);
  } else if (contentType === 'pdf') {
    renderPdfLive(payload);
  }
});

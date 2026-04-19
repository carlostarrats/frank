// viewer.js — Content viewer: iframe wrapper with overlay and comments
import sync from '../core/sync.js';
import projectManager from '../core/project.js';
import { renderToolbar } from '../components/toolbar.js';
import { setupOverlay, toggleCommentMode, disableCommentMode, isCommentModeActive } from '../overlay/overlay.js';
import { createViewerPinRenderer } from '../overlay/pins.js';
import { renderCuration } from '../components/curation.js';
import { showCommentInput } from '../components/comments.js';
import { captureSnapshot, detectSensitiveContent } from '../overlay/snapshot.js';
import { updateSharePopover } from '../components/share-popover.js';
import { mountAiPanel, toggleAiPanel } from '../components/ai-panel.js';
import { renderErrorCard } from '../components/error-card.js';
import { toastError, toastInfo } from '../components/toast.js';

export function renderViewer(container, { onBack }) {
  const project = projectManager.get();
  if (!project) { onBack(); return; }

  container.innerHTML = `
    <div class="viewer-toolbar" id="viewer-toolbar"></div>
    <div class="viewer-body">
      <div class="viewer-content" id="viewer-content">
        <div class="viewer-loading">Loading content...</div>
      </div>
      <div class="viewer-sidebar" id="viewer-sidebar"></div>
      <div class="viewer-ai-sidebar" id="viewer-ai-sidebar"></div>
    </div>
  `;

  renderToolbar(container.querySelector('#viewer-toolbar'), {
    projectName: project.name,
    url: project.url || project.file || '',
    onBack,
  });

  const sidebar = container.querySelector('#viewer-sidebar');
  const commentToggle = container.querySelector('#toolbar-comment-toggle');

  // Reflect the comment-mode active state on the toolbar button.
  function syncCommentModeUi() {
    const active = isCommentModeActive();
    if (commentToggle) {
      commentToggle.classList.toggle('active', active);
      commentToggle.title = active ? 'Exit comment mode' : 'Add comment';
    }
  }

  function enterCommentModeFromUi() {
    // Entering comment mode always opens the sidebar so the user lands on a
    // predictable layout — and the +Add/✕ Cancel affordance stays visible.
    if (!sidebar.classList.contains('open')) sidebar.classList.add('open');
    if (!isCommentModeActive()) toggleCommentMode();
    syncCommentModeUi();
  }
  function leaveCommentModeFromUi() {
    if (isCommentModeActive()) toggleCommentMode();
    syncCommentModeUi();
  }
  function toggleCommentModeFromUi() {
    isCommentModeActive() ? leaveCommentModeFromUi() : enterCommentModeFromUi();
  }

  if (commentToggle) {
    commentToggle.addEventListener('click', toggleCommentModeFromUi);
  }
  // Esc anywhere on the viewer exits comment mode — matches the convention
  // used by the canvas view.
  const onEscape = (e) => {
    if (e.key === 'Escape' && isCommentModeActive()) {
      leaveCommentModeFromUi();
    }
  };
  window.addEventListener('keydown', onEscape);

  const aiSidebar = container.querySelector('#viewer-ai-sidebar');
  mountAiPanel(aiSidebar);
  const aiToggle = container.querySelector('#toolbar-ai-toggle');
  if (aiToggle) {
    aiToggle.addEventListener('click', () => {
      toggleAiPanel();
      const isOpen = aiSidebar.classList.contains('open');
      aiToggle.classList.toggle('active', isOpen);
    });
  }

  // Render curation panel in sidebar. Comment mode toggling lives on the
  // toolbar comment icon — no need for a redundant button inside the panel.
  const screenId = Object.keys(project.screens || {})[0] || null;
  renderCuration(sidebar, { screenId });

  // Manual snapshot trigger from toolbar
  window.addEventListener('frank:take-snapshot', async () => {
    const iframe = document.querySelector('#content-iframe');
    if (!iframe) return;
    showSnapshotFlash();
    try {
      const snapshot = await captureSnapshot(iframe);
      if (snapshot) {
        await sync.saveSnapshot(snapshot.html, null, 'manual');
        toastInfo('Snapshot saved');
      } else {
        toastError('Could not capture snapshot');
      }
    } catch (err) {
      toastError(`Snapshot failed: ${err.message || err}`);
    }
  });

  // Share flow: capture snapshot → check sensitive → upload
  window.addEventListener('frank:capture-snapshot', async (e) => {
    const iframe = document.querySelector('#content-iframe');
    if (!iframe) return;

    const snapshot = await captureSnapshot(iframe);
    if (!snapshot) {
      updateSharePopover({ error: 'Could not capture snapshot' });
      return;
    }

    // Check for sensitive content
    const warnings = detectSensitiveContent(snapshot.html);
    if (warnings.length > 0) {
      const proceed = confirm(`Warning: ${warnings.join(', ')}. Share anyway?`);
      if (!proceed) {
        updateSharePopover({ error: 'Cancelled' });
        return;
      }
    }

    try {
      const result = await sync.uploadShare(
        snapshot,
        e.detail.coverNote,
        projectManager.get()?.contentType || 'url',
      );
      if (result.error) {
        updateSharePopover({ error: result.error });
      } else {
        // Update project state
        const project = projectManager.get();
        if (project) {
          project.activeShare = {
            id: result.shareId,
            revokeToken: result.revokeToken,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
            coverNote: e.detail.coverNote,
            lastSyncedNoteId: null,
            unseenNotes: 0,
          };
        }
        updateSharePopover(result);
      }
    } catch (err) {
      updateSharePopover({ error: err.message });
    }
  });

  const contentEl = container.querySelector('#viewer-content');

  // The pin renderer attaches after the content element exists; loaders
  // mount it once their DOM is ready so pins can find the host + overlay.
  let pinRenderer = null;
  function mountPinRenderer(hostEl, overlayEl) {
    if (pinRenderer) pinRenderer.destroy();
    pinRenderer = createViewerPinRenderer({ hostEl, overlayEl, screenId });
    pinRenderer.render();
  }
  projectManager.onChange(() => { if (pinRenderer) pinRenderer.render(); });
  window.addEventListener('frank:focus-comment-pin', (e) => {
    if (pinRenderer) pinRenderer.setFocused(e.detail?.id ?? null);
  });

  if (project.contentType === 'url' && project.url) {
    loadUrlContent(contentEl, project.url, mountPinRenderer);
  } else if (project.contentType === 'pdf' && project.file) {
    loadPdfContent(contentEl, project.file, mountPinRenderer);
  } else if (project.contentType === 'image' && project.file) {
    loadImageContent(contentEl, project.file, mountPinRenderer);
  } else {
    contentEl.innerHTML = '<div class="viewer-error">No content to display</div>';
  }
}

async function loadUrlContent(container, url, mountPins) {
  container.innerHTML = `
    <div class="iframe-wrapper" id="iframe-wrapper">
      <iframe
        id="content-iframe"
        src="${escapeAttr(url)}"
        class="content-iframe"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      ></iframe>
      <div class="overlay" id="overlay"></div>
    </div>
  `;

  const iframe = container.querySelector('#content-iframe');
  const overlayEl = container.querySelector('#overlay');
  mountPins?.(iframe, overlayEl);

  // Setup overlay immediately — it listens for load events internally
  setupOverlay(iframe, {
    onCommentCreate(anchor, targetElement) {
      const sidebar = document.querySelector('#viewer-sidebar');
      if (sidebar && !sidebar.classList.contains('open')) {
        sidebar.classList.add('open');
      }
      showCommentInput(sidebar, anchor, (anchor, text) => {
        const screenId = Object.keys(projectManager.get()?.screens || {})[0] || 'default';
        sync.addComment(screenId, anchor, text);
        disableCommentMode();
        syncCommentModeUi();
      });
    },
  });

  iframe.addEventListener('error', () => fallbackToProxy(container, url));

  setTimeout(() => {
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body || doc.body.innerHTML === '') {
        fallbackToProxy(container, url);
      }
    } catch {
      fallbackToProxy(container, url);
    }
  }, 3000);

  // --- Multi-page tracking ---
  let lastUrl = url;
  let userClicked = false;
  let loadTime = Date.now();

  // Track user clicks inside the iframe
  iframe.addEventListener('load', () => {
    try {
      iframe.contentDocument.addEventListener('click', () => {
        userClicked = true;
      }, true);
    } catch {
      // Cross-origin — can't attach listener
    }
  });

  const navInterval = setInterval(() => {
    try {
      const currentUrl = iframe.contentWindow.location.href;
      if (currentUrl !== lastUrl) {
        const wasUserClick = userClicked;
        const timeSinceLoad = Date.now() - loadTime;
        lastUrl = currentUrl;
        userClicked = false;

        // Ignore auto-redirects: no user click, or happened within 2s of page load
        if (!wasUserClick || timeSinceLoad < 2000) return;

        autoAddScreen(currentUrl);
      }
    } catch {
      // Cross-origin — can't read URL
    }
  }, 1000);

  // Clean up interval when view changes
  const viewerEl = container.closest('.view');
  if (viewerEl) {
    const observer = new MutationObserver(() => {
      if (!viewerEl.classList.contains('active')) {
        clearInterval(navInterval);
        observer.disconnect();
      }
    });
    observer.observe(viewerEl, { attributes: true, attributeFilter: ['class'] });
  }
}

async function fallbackToProxy(container, url) {
  console.log('[viewer] iframe blocked, trying proxy...');
  try {
    const response = await sync.requestProxy(url);
    if (response.proxyUrl) {
      const iframe = container.querySelector('#content-iframe');
      if (iframe) {
        iframe.src = response.proxyUrl;
        console.log('[viewer] proxy active:', response.proxyUrl);
      }
    }
  } catch (e) {
    console.warn('[viewer] proxy failed:', e);
    renderErrorCard(container, {
      title: 'Unable to load this URL',
      message: `The site may be blocking iframe embedding, and Frank's proxy couldn't reach it.`,
      suggestion: `URL: ${url}\n\nChecks: is the server running? Is it reachable from this machine? Does it require an allowlist or VPN?`,
      actionLabel: 'Retry',
      onAction: () => fallbackToProxy(container, url),
    });
  }
}

function loadPdfContent(container, filePath, mountPins) {
  container.innerHTML = `
    <div class="iframe-wrapper">
      <iframe
        id="content-iframe"
        src="/files/${encodeURIComponent(filePath)}"
        class="content-iframe"
      ></iframe>
      <div class="overlay" id="overlay"></div>
    </div>
  `;
  const iframe = container.querySelector('#content-iframe');
  const overlayEl = container.querySelector('#overlay');
  mountPins?.(iframe, overlayEl);
}

function loadImageContent(container, filePath, mountPins) {
  container.innerHTML = `
    <div class="image-wrapper">
      <img
        id="content-image"
        src="/files/${encodeURIComponent(filePath)}"
        class="content-image"
        alt="Project content"
      >
      <div class="overlay" id="overlay"></div>
    </div>
  `;
  const img = container.querySelector('#content-image');
  const overlayEl = container.querySelector('#overlay');
  // Wait for image load so the host's getBoundingClientRect has final size.
  img.addEventListener('load', () => mountPins?.(img, overlayEl), { once: true });
  if (img.complete) mountPins?.(img, overlayEl);
}

function autoAddScreen(newUrl) {
  const project = projectManager.get();
  if (!project) return;

  let route;
  try {
    route = new URL(newUrl).pathname;
  } catch {
    return;
  }

  const existing = Object.values(project.screens).find(s => s.route === route);
  if (existing) return;

  const label = route.split('/').filter(Boolean).pop() || 'page';
  sync.addScreen(route, label).then(data => {
    projectManager.setFromLoaded({ ...data, projectId: projectManager.getId() });
  });
}

function showSnapshotFlash() {
  const wrapper = document.querySelector('#iframe-wrapper') || document.querySelector('.viewer-content');
  if (!wrapper) return;

  // Remove any existing canvas
  wrapper.querySelector('.snapshot-particles')?.remove();

  const canvas = document.createElement('canvas');
  canvas.className = 'snapshot-particles';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:10000;';
  wrapper.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const rect = wrapper.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  const w = canvas.width;
  const h = canvas.height;
  const particles = [];
  const count = 1000;

  // Spawn particles from edges
  for (let i = 0; i < count; i++) {
    const edge = Math.floor(Math.random() * 4);
    let x, y, vx, vy;
    const speed = 0.45 + Math.random() * 1.2;

    if (edge === 0) {        // top
      x = Math.random() * w; y = 0;
      vx = (Math.random() - 0.5) * 1.5; vy = speed;
    } else if (edge === 1) { // bottom
      x = Math.random() * w; y = h;
      vx = (Math.random() - 0.5) * 1.5; vy = -speed;
    } else if (edge === 2) { // left
      x = 0; y = Math.random() * h;
      vx = speed; vy = (Math.random() - 0.5) * 1.5;
    } else {                 // right
      x = w; y = Math.random() * h;
      vx = -speed; vy = (Math.random() - 0.5) * 1.5;
    }

    particles.push({
      x, y, vx, vy,
      size: 0.5 + Math.random() * 1.5,
      life: 1,
      decay: 0.006 + Math.random() * 0.010,
      delay: Math.random() * 15, // stagger spawn in frames
    });
  }

  let frame = 0;
  function animate() {
    ctx.clearRect(0, 0, w, h);
    let alive = false;

    for (const p of particles) {
      if (frame < p.delay) { alive = true; continue; }
      if (p.life <= 0) continue;
      alive = true;

      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;

      const alpha = Math.max(0, p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fill();
    }

    frame++;
    if (alive) {
      requestAnimationFrame(animate);
    } else {
      canvas.remove();
    }
  }

  requestAnimationFrame(animate);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

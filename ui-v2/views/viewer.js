// viewer.js — Content viewer: iframe wrapper with overlay and comments
import sync from '../core/sync.js';
import projectManager from '../core/project.js';
import { renderToolbar, syncToolbarLiveBadge } from '../components/toolbar.js';
import { setupOverlay, toggleCommentMode, disableCommentMode, isCommentModeActive } from '../overlay/overlay.js';
import { createViewerPinRenderer } from '../overlay/pins.js';
import { renderCuration } from '../components/curation.js';
import { showCommentInput } from '../components/comments.js';
import { captureSnapshot, detectSensitiveContent, buildMediaFileSnapshot } from '../overlay/snapshot.js';
import { updateSharePopover } from '../components/share-popover.js';
import { renderErrorCard } from '../components/error-card.js';
import { showConfirm } from '../components/confirm.js';
import { toastError, toastInfo } from '../components/toast.js';
import { mountZoomMenu } from '../components/zoom-menu.js';

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
    </div>
  `;

  renderToolbar(container.querySelector('#viewer-toolbar'), {
    projectName: project.name,
    url: project.url || project.file || '',
    onBack,
    projectId: projectManager.getId(),
  });
  syncToolbarLiveBadge(projectManager.getId());

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

  // Render curation panel in sidebar. Comment mode toggling lives on the
  // toolbar comment icon — no need for a redundant button inside the panel.
  // Must use the same fallback as onCommentCreate below ('default') so the
  // panel + pins read comments at the same screenId they were written with.
  const screenId = Object.keys(project.screens || {})[0] || 'default';
  renderCuration(sidebar, { screenId });

  // Manual snapshot trigger from toolbar — button flashes like the canvas
  // snapshot button for visual consistency.
  window.addEventListener('frank:take-snapshot', async () => {
    const iframe = document.querySelector('#content-iframe');
    if (!iframe) return;
    const snapshotBtn = document.querySelector('#toolbar-snapshot');
    snapshotBtn?.classList.add('flashing');
    try {
      const snapshot = await captureSnapshot(iframe);
      if (snapshot) {
        await sync.saveSnapshot(snapshot.html, null, 'manual');
        toastInfo('Moment bookmarked');
      } else {
        toastError('Could not capture the moment');
      }
    } catch (err) {
      toastError(`Could not save bookmark: ${err.message || err}`);
    } finally {
      setTimeout(() => snapshotBtn?.classList.remove('flashing'), 300);
    }
  });

  // Share flow: capture snapshot → check sensitive → upload
  window.addEventListener('frank:capture-snapshot', async (e) => {
    const project = projectManager.get();
    if (!project) {
      updateSharePopover({ error: 'No project loaded' });
      return;
    }

    let snapshot = null;
    if (project.contentType === 'url') {
      const iframe = document.querySelector('#content-iframe');
      if (!iframe) {
        updateSharePopover({ error: 'No content to capture' });
        return;
      }
      snapshot = await captureSnapshot(iframe);
    } else if (project.contentType === 'image' || project.contentType === 'pdf') {
      if (!project.file) {
        updateSharePopover({ error: 'Project has no file' });
        return;
      }
      snapshot = await buildMediaFileSnapshot(project.file);
    } else {
      updateSharePopover({ error: `Unsupported project type: ${project.contentType}` });
      return;
    }

    if (!snapshot) {
      updateSharePopover({ error: 'Could not build snapshot' });
      return;
    }

    // Pre-upload size check for data-URL payloads. Vercel Hobby's function
    // body limit is ~5 MB; the payload gets JSON-wrapped with cover note +
    // metadata. A 4 MB ceiling on fileDataUrl leaves comfortable headroom
    // and surfaces a user-friendly error instead of letting the upload fail
    // with a cryptic network error.
    const DATA_URL_CEILING = 4 * 1024 * 1024;
    if (snapshot.fileDataUrl && snapshot.fileDataUrl.length > DATA_URL_CEILING) {
      updateSharePopover({ error: 'File is too large to share directly. Resize or compress before sharing.' });
      return;
    }

    // Check for sensitive content (URL snapshots only — data URLs are opaque
    // base64 and would false-positive on almost any image's byte pattern).
    if (snapshot.html) {
      const warnings = detectSensitiveContent(snapshot.html);
      if (warnings.length > 0) {
        const proceed = await showConfirm({
          title: 'Sensitive content detected',
          message: `${warnings.join(', ')}.\nShare anyway?`,
          confirmLabel: 'Share anyway',
          destructive: true,
        });
        if (!proceed) {
          updateSharePopover({ error: 'Cancelled' });
          return;
        }
      }
    }

    try {
      const result = await sync.uploadShare(
        snapshot,
        e.detail.coverNote,
        project.contentType,
        undefined,  // oldShareId — unused on fresh creation
        undefined,  // oldRevokeToken
        e.detail.expiryDays,
      );
      if (result.error) {
        updateSharePopover({ error: result.error });
      } else {
        // Update project state
        if (project) {
          project.activeShare = {
            id: result.shareId,
            revokeToken: result.revokeToken,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + (e.detail.expiryDays ?? 7) * 86400000).toISOString(),
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
  const wrapper = container.querySelector('.image-wrapper');
  const img = container.querySelector('#content-image');
  const overlayEl = container.querySelector('#overlay');
  // The zoom pill lives in the shared toolbar (mirrors the canvas topbar
  // placement) instead of floating over the image.
  const zoomEl = document.querySelector('#toolbar-zoom-host');

  // Same UX as canvas: wheel to zoom, click "N%" pill to reset. 100% is the
  // natural fit size — object-fit:contain inside the wrapper — and we scale
  // the <img> element up or down from there via explicit width/height.
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 8;
  const ZOOM_STEP = 1.08;
  let zoom = 1;
  let fitW = 0;
  let fitH = 0;

  let zoomMenu = null;
  const applyZoom = () => {
    if (zoom === 1 || fitW === 0 || fitH === 0) {
      img.style.removeProperty('width');
      img.style.removeProperty('height');
      img.style.removeProperty('max-width');
      img.style.removeProperty('max-height');
    } else {
      img.style.maxWidth = 'none';
      img.style.maxHeight = 'none';
      img.style.width = `${fitW * zoom}px`;
      img.style.height = `${fitH * zoom}px`;
    }
    if (zoomMenu) zoomMenu.update();
    // Poke the pin renderer (listens for window resize) so pins reposition
    // to the new image bounds.
    window.dispatchEvent(new Event('resize'));
  };

  function resetZoom() { zoom = 1; applyZoom(); }

  if (zoomEl) {
    zoomMenu = mountZoomMenu(zoomEl, {
      getZoom: () => zoom,
      setZoom: (level) => {
        zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
        applyZoom();
      },
      onReset: resetZoom,
    });
  }

  const onWheel = (e) => {
    e.preventDefault();
    const direction = e.deltaY > 0 ? -1 : 1;
    const next = direction > 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP;
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    if (clamped === zoom) return;
    zoom = clamped;
    applyZoom();
  };
  wrapper.addEventListener('wheel', onWheel, { passive: false });

  const onLoad = () => {
    fitW = img.clientWidth;
    fitH = img.clientHeight;
    mountPins?.(img, overlayEl);
  };
  img.addEventListener('load', onLoad, { once: true });
  if (img.complete) onLoad();
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

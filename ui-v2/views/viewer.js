// viewer.js — Content viewer: iframe wrapper with overlay and comments
import sync from '../core/sync.js';
import projectManager from '../core/project.js';
import { renderToolbar } from '../components/toolbar.js';
import { setupOverlay, toggleCommentMode, disableCommentMode } from '../overlay/overlay.js';
import { renderCuration } from '../components/curation.js';
import { showCommentInput } from '../components/comments.js';
import { captureSnapshot, detectSensitiveContent } from '../overlay/snapshot.js';
import { updateSharePopover } from '../components/share-popover.js';

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
  });

  const sidebar = container.querySelector('#viewer-sidebar');
  const commentToggle = container.querySelector('#toolbar-comment-toggle');
  if (commentToggle) {
    commentToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }

  // Render curation panel in sidebar
  const screenId = Object.keys(project.screens || {})[0] || null;
  renderCuration(sidebar, {
    screenId,
    onCommentModeToggle() {
      const isActive = toggleCommentMode();
      const btn = document.querySelector('#toggle-comment-mode');
      if (btn) btn.textContent = isActive ? '✕ Cancel' : '+ Add';
    },
  });

  // Manual snapshot trigger from toolbar
  window.addEventListener('frank:take-snapshot', async () => {
    const iframe = document.querySelector('#content-iframe');
    if (!iframe) return;
    const snapshot = await captureSnapshot(iframe);
    if (snapshot) {
      await sync.saveSnapshot(snapshot.html, null, 'manual');
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

  if (project.contentType === 'url' && project.url) {
    loadUrlContent(contentEl, project.url);
  } else if (project.contentType === 'pdf' && project.file) {
    loadPdfContent(contentEl, project.file);
  } else if (project.contentType === 'image' && project.file) {
    loadImageContent(contentEl, project.file);
  } else {
    contentEl.innerHTML = '<div class="viewer-error">No content to display</div>';
  }
}

async function loadUrlContent(container, url) {
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

  const navInterval = setInterval(() => {
    try {
      const currentUrl = iframe.contentWindow.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        handleNavigation(currentUrl, container);
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
    container.innerHTML = `
      <div class="viewer-error">
        <h3>Unable to load this URL</h3>
        <p>The site may be blocking iframe embedding and the proxy couldn't reach it.</p>
        <p class="viewer-error-url">${escapeHtml(url)}</p>
      </div>
    `;
  }
}

function loadPdfContent(container, filePath) {
  container.innerHTML = `
    <div class="iframe-wrapper">
      <iframe
        src="/files/${encodeURIComponent(filePath)}"
        class="content-iframe"
      ></iframe>
      <div class="overlay" id="overlay"></div>
    </div>
  `;
}

function loadImageContent(container, filePath) {
  container.innerHTML = `
    <div class="image-wrapper">
      <img
        src="/files/${encodeURIComponent(filePath)}"
        class="content-image"
        alt="Project content"
      >
      <div class="overlay" id="overlay"></div>
    </div>
  `;
}

function handleNavigation(newUrl, container) {
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

  showNavigationPrompt(container, route, (label) => {
    sync.addScreen(route, label).then(data => {
      projectManager.setFromLoaded({ ...data, projectId: projectManager.getId() });
    });
  });
}

function showNavigationPrompt(container, route, onAdd) {
  // Remove any existing prompt
  container.querySelector('.nav-prompt')?.remove();

  const prompt = document.createElement('div');
  prompt.className = 'nav-prompt';
  prompt.innerHTML = `
    <span>New page: <code>${escapeHtml(route)}</code></span>
    <input type="text" class="input nav-prompt-name" placeholder="Screen name" value="${route.split('/').filter(Boolean).pop() || 'page'}">
    <button class="btn-primary nav-prompt-add">Add Screen</button>
    <button class="btn-ghost nav-prompt-dismiss">Dismiss</button>
  `;
  container.prepend(prompt);

  prompt.querySelector('.nav-prompt-add').addEventListener('click', () => {
    const label = prompt.querySelector('.nav-prompt-name').value.trim() || route;
    onAdd(label);
    prompt.remove();
  });
  prompt.querySelector('.nav-prompt-dismiss').addEventListener('click', () => prompt.remove());

  setTimeout(() => { if (prompt.parentNode) prompt.remove(); }, 10000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

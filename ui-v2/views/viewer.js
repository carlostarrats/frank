// viewer.js — Content viewer: iframe wrapper with overlay and comments
import sync from '../core/sync.js';
import projectManager from '../core/project.js';
import { renderToolbar } from '../components/toolbar.js';
import { setupOverlay, toggleCommentMode, disableCommentMode } from '../overlay/overlay.js';
import { renderComments, showCommentInput } from '../components/comments.js';

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

  // Render comment panel in sidebar
  const screenId = Object.keys(project.screens || {})[0] || null;
  renderComments(sidebar, {
    screenId,
    onCommentModeToggle() {
      const isActive = toggleCommentMode();
      const btn = document.querySelector('#toggle-comment-mode');
      if (btn) btn.textContent = isActive ? '✕ Cancel' : '+ Add';
    },
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

  iframe.addEventListener('load', () => {
    setupOverlay(iframe, {
      onCommentCreate(anchor, targetElement) {
        // Open sidebar if not already open
        const sidebar = document.querySelector('#viewer-sidebar');
        if (sidebar && !sidebar.classList.contains('open')) {
          sidebar.classList.add('open');
        }
        // Show comment input with the anchor
        showCommentInput(sidebar, anchor, (anchor, text) => {
          const screenId = Object.keys(projectManager.get()?.screens || {})[0] || 'default';
          sync.addComment(screenId, anchor, text);
          disableCommentMode();
        });
      },
    });
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

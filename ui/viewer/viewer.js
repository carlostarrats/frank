import { renderScreen } from '../render/screen.js';

const params = new URLSearchParams(window.location.search);
const shareId = params.get('id');

let shareData = null;
let currentScreenIndex = 0;
let screens = [];

async function init() {
  const app = document.getElementById('viewer-app');

  if (!shareId) {
    showError(app, 'No Share ID', "Check the URL and try again.");
    return;
  }

  try {
    const res = await fetch(`/api/share/${shareId}`);
    const data = await res.json();

    if (data.error) {
      if (data.error === 'expired') {
        showError(app, 'Link Expired', data.message || 'This prototype has been updated. Ask the owner for the new link.');
      } else {
        showError(app, 'Not Found', "This link doesn't exist. Check the URL and try again.");
      }
      return;
    }

    shareData = data;
    screens = (data.project.screenOrder || [])
      .map(id => ({ id, ...data.project.screens[id] }))
      .filter(s => s.sections && s.sections.length > 0);

    if (screens.length === 0) {
      showError(app, 'Empty Prototype', 'This prototype has no screens yet.');
      return;
    }

    renderViewer(app);
  } catch (e) {
    showError(app, 'Unable to Load', 'Check your connection and refresh.');
  }
}

function showError(container, title, message) {
  container.innerHTML = `
    <div class="viewer-error">
      <h2 class="viewer-error-title">${escapeHtml(title)}</h2>
      <p class="viewer-error-message">${escapeHtml(message)}</p>
    </div>
  `;
}

function renderViewer(app) {
  const { coverNote, notes } = shareData;

  app.innerHTML = `
    ${coverNote ? `
      <div class="viewer-toast" id="viewer-toast">
        <div class="viewer-toast-content">
          <span class="viewer-toast-text">"${escapeHtml(coverNote)}"</span>
          <button class="viewer-toast-close" id="toast-close">&times;</button>
        </div>
      </div>
      <button class="viewer-toast-pill hidden" id="toast-pill">
        <span class="viewer-pill-icon">&#128204;</span> Note
      </button>
    ` : ''}
    ${screens.length > 1 ? `
      <div class="viewer-nav" id="viewer-nav">
        ${screens.map((s, i) => `
          <button class="viewer-nav-btn ${i === 0 ? 'active' : ''}" data-index="${i}">${escapeHtml(s.label || s.id)}</button>
        `).join('')}
      </div>
    ` : ''}
    <div class="viewer-layout">
      <div class="viewer-wireframe" id="viewer-wireframe"></div>
      <div class="viewer-sidebar" id="viewer-sidebar">
        <div class="viewer-comments" id="viewer-comments"></div>
      </div>
    </div>
  `;

  // Toast toggle
  setupToast();

  // Screen nav
  setupScreenNav();

  // Render first screen
  renderCurrentScreen();
}

function setupToast() {
  const toast = document.getElementById('viewer-toast');
  const pill = document.getElementById('toast-pill');
  const closeBtn = document.getElementById('toast-close');

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      toast.classList.add('collapsed');
      pill.classList.remove('hidden');
    });
  }
  if (pill) {
    pill.addEventListener('click', () => {
      toast.classList.remove('collapsed');
      pill.classList.add('hidden');
    });
  }
}

function setupScreenNav() {
  const nav = document.getElementById('viewer-nav');
  if (!nav) return;

  nav.querySelectorAll('.viewer-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentScreenIndex = parseInt(btn.dataset.index);
      nav.querySelectorAll('.viewer-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCurrentScreen();
    });
  });
}

function renderCurrentScreen() {
  const screen = screens[currentScreenIndex];
  if (!screen) return;

  const wireframeEl = document.getElementById('viewer-wireframe');
  wireframeEl.innerHTML = `
    <div class="viewer-wireframe-inner">
      ${renderScreen(screen)}
    </div>
  `;

  // Render comments for this screen
  renderComments();
}

function renderComments() {
  const commentsEl = document.getElementById('viewer-comments');
  const screen = screens[currentScreenIndex];
  const screenNotes = (shareData.notes || []).filter(n => n.screenId === screen.id);

  commentsEl.innerHTML = `
    <h3 class="viewer-comments-title">Comments <span class="viewer-comments-count">${screenNotes.length}</span></h3>
    <div class="viewer-comments-list">
      ${screenNotes.length === 0 ? '<p class="viewer-comments-empty">Click a section to add a comment</p>' : ''}
      ${screenNotes.map(n => `
        <div class="viewer-comment">
          <div class="viewer-comment-header">
            <span class="viewer-comment-author">${escapeHtml(n.author)}</span>
            ${n.section !== null && n.section !== undefined ? `<span class="viewer-comment-section">on ${escapeHtml(getSectionType(n.section))}</span>` : ''}
          </div>
          <p class="viewer-comment-text">${escapeHtml(n.text)}</p>
          <span class="viewer-comment-time">${formatTime(n.ts)}</span>
        </div>
      `).join('')}
    </div>
    <div class="viewer-add-comment" id="viewer-add-comment">
      <p class="viewer-add-hint">Click a section in the wireframe to comment on it</p>
    </div>
  `;
}

function getSectionType(sectionIndex) {
  const screen = screens[currentScreenIndex];
  const type = screen?.sections?.[sectionIndex]?.type || 'Section';
  return type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, ' ');
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

init();

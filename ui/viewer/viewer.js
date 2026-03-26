import { renderScreen } from '../render/screen.js';

const params = new URLSearchParams(window.location.search);
const shareId = params.get('id');

let shareData = null;
let currentScreenIndex = 0;
let screens = [];
let selectedViewerSection = null;

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

  // Set up section click handlers
  setupViewerSectionClicks();
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

function getAuthorName() {
  return localStorage.getItem('frank-reviewer-name') || '';
}

function setAuthorName(name) {
  localStorage.setItem('frank-reviewer-name', name);
}

function setupViewerSectionClicks() {
  const wireframeEl = document.getElementById('viewer-wireframe');
  const sectionEls = wireframeEl.querySelectorAll('[data-section-index]');

  sectionEls.forEach(section => {
    const idx = parseInt(section.dataset.sectionIndex);
    section.addEventListener('click', (e) => {
      e.stopPropagation();
      sectionEls.forEach(s => s.classList.remove('section-selected'));
      section.classList.add('section-selected');
      selectedViewerSection = idx;
      showCommentForm();
    });
  });

  // Click background to deselect
  wireframeEl.addEventListener('click', (e) => {
    if (!e.target.closest('[data-section-index]')) {
      sectionEls.forEach(s => s.classList.remove('section-selected'));
      selectedViewerSection = null;
      renderComments();
    }
  });
}

function showCommentForm() {
  const addCommentEl = document.getElementById('viewer-add-comment');
  if (!addCommentEl) return;

  const authorName = getAuthorName();
  const sectionType = getSectionType(selectedViewerSection);

  addCommentEl.innerHTML = `
    <div class="viewer-form">
      <div class="viewer-form-label">Comment on ${escapeHtml(sectionType)}</div>
      ${!authorName ? `
        <input class="viewer-form-name" type="text" placeholder="Your name" autofocus>
      ` : `
        <div class="viewer-form-author">Commenting as ${escapeHtml(authorName)}</div>
      `}
      <textarea class="viewer-form-text" placeholder="Add your feedback..." rows="3"${authorName ? ' autofocus' : ''}></textarea>
      <div class="viewer-prompts">
        <button class="viewer-prompt-btn" data-prompt="How does this feel?">How does this feel?</button>
        <button class="viewer-prompt-btn" data-prompt="What's missing?">What's missing?</button>
        <button class="viewer-prompt-btn" data-prompt="What would you change?">What would you change?</button>
      </div>
      <button class="viewer-form-submit">Submit</button>
    </div>
  `;

  // Guided prompts
  addCommentEl.querySelectorAll('.viewer-prompt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const textarea = addCommentEl.querySelector('.viewer-form-text');
      textarea.value = btn.dataset.prompt + ' ';
      textarea.focus();
    });
  });

  // Submit
  addCommentEl.querySelector('.viewer-form-submit').addEventListener('click', async () => {
    const nameInput = addCommentEl.querySelector('.viewer-form-name');
    const textarea = addCommentEl.querySelector('.viewer-form-text');

    let author = authorName;
    if (nameInput) {
      author = nameInput.value.trim();
      if (!author) { nameInput.focus(); return; }
      setAuthorName(author);
    }

    const text = textarea.value.trim();
    if (!text) { textarea.focus(); return; }

    try {
      const res = await fetch('/api/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shareId,
          screenId: screens[currentScreenIndex].id,
          section: selectedViewerSection,
          author,
          text,
        }),
      });
      const result = await res.json();
      if (result.note) {
        shareData.notes.push(result.note);
        renderComments();
        showCommentForm();
      }
    } catch (e) {
      console.warn('Failed to submit note:', e);
    }
  });

  // Cmd+Enter to submit
  const textarea = addCommentEl.querySelector('.viewer-form-text');
  if (textarea) {
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        addCommentEl.querySelector('.viewer-form-submit')?.click();
      }
    });
  }
}

init();

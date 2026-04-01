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

  // Render content
  const contentEl = document.getElementById('v-content');
  if (snapshot?.html) {
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

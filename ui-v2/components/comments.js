// comments.js — Comment panel

import sync from '../core/sync.js';
import projectManager from '../core/project.js';

export function renderComments(container, { screenId, onCommentModeToggle }) {
  function render() {
    const comments = screenId
      ? projectManager.getCommentsForScreen(screenId)
      : projectManager.getComments();

    container.innerHTML = `
      <div class="comments-panel">
        <div class="comments-header">
          <h3 class="comments-title">Comments (${comments.length})</h3>
          <button class="btn-ghost comments-add-btn" id="toggle-comment-mode">+ Add</button>
        </div>
        <div class="comments-list" id="comments-list">
          ${comments.length === 0
            ? '<p class="comments-empty">No comments yet. Click "+ Add" to start commenting on elements.</p>'
            : comments.map(c => `
                <div class="comment-item" data-id="${c.id}">
                  <div class="comment-header">
                    <span class="comment-author">${escapeHtml(c.author)}</span>
                    <span class="comment-time">${timeAgo(c.ts)}</span>
                    <button class="btn-ghost comment-delete" data-id="${c.id}" title="Delete">×</button>
                  </div>
                  <p class="comment-text">${escapeHtml(c.text)}</p>
                  ${c.anchor?.cssSelector ? `<span class="comment-anchor">${escapeHtml(c.anchor.cssSelector)}</span>` : ''}
                </div>
              `).join('')
          }
        </div>
        <div class="comment-input-area" id="comment-input-area" style="display:none">
          <textarea class="input comment-textarea" id="comment-text" placeholder="Add a comment..." rows="3" aria-label="New comment"></textarea>
          <div class="comment-input-actions">
            <button class="btn-ghost" id="cancel-comment">Cancel</button>
            <button class="btn-primary" id="submit-comment">Comment</button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#toggle-comment-mode')?.addEventListener('click', () => {
      if (onCommentModeToggle) onCommentModeToggle();
    });

    container.querySelectorAll('.comment-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        sync.deleteComment(btn.dataset.id);
      });
    });
  }

  render();
  projectManager.onChange(render);
  return () => { projectManager.offChange(render); };
}

export function showCommentInput(container, anchor, onSubmit) {
  const inputArea = container.querySelector('#comment-input-area');
  if (!inputArea) return;
  inputArea.style.display = 'block';
  inputArea._anchor = anchor;

  const textarea = inputArea.querySelector('#comment-text');
  textarea.focus();

  const submitBtn = inputArea.querySelector('#submit-comment');
  const cancelBtn = inputArea.querySelector('#cancel-comment');

  const cleanup = () => {
    submitBtn.removeEventListener('click', handleSubmit);
    cancelBtn.removeEventListener('click', handleCancel);
  };

  const handleSubmit = () => {
    const text = textarea.value.trim();
    if (!text) return;
    onSubmit(anchor, text);
    textarea.value = '';
    inputArea.style.display = 'none';
    cleanup();
  };

  const handleCancel = () => {
    textarea.value = '';
    inputArea.style.display = 'none';
    cleanup();
  };

  submitBtn.addEventListener('click', handleSubmit);
  cancelBtn.addEventListener('click', handleCancel);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
    if (e.key === 'Escape') handleCancel();
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

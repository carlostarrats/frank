// comments.js — Comment panel for the editor

export function renderComments(container, { screen, screenId, onApprove, onDismiss, onAddNote, authorName }) {
  const notes = screen.notes || [];

  container.innerHTML = `
    <div class="comments-panel">
      <div class="comments-header">
        <span class="comments-title">Comments</span>
        <span class="comments-count">${notes.length}</span>
      </div>
      <div class="comments-list">
        ${notes.length === 0 ? '<p class="comments-empty">No comments yet</p>' : ''}
        ${notes.map((note, i) => `
          <div class="comment-item ${note.status ? 'comment-item--' + note.status : ''}" data-index="${i}">
            <div class="comment-author">${escapeHtml(note.author || 'Unknown')}</div>
            <div class="comment-text">${escapeHtml(note.text)}</div>
            <div class="comment-meta">
              ${formatTime(note.ts)}
              ${note.status ? ` · <span class="comment-status comment-status--${note.status}">${note.status}</span>` : ''}
            </div>
            ${!note.status ? `
              <div class="comment-actions">
                <button class="comment-approve" data-index="${i}" title="Approve">&#x2713;</button>
                <button class="comment-dismiss" data-index="${i}" title="Dismiss">&#x2717;</button>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
      <div class="comments-add">
        <textarea class="comments-input" placeholder="Add a note..." rows="2"></textarea>
        <button class="comments-submit">Add</button>
      </div>
    </div>
  `;

  // Approve buttons
  container.querySelectorAll('.comment-approve').forEach(btn => {
    btn.addEventListener('click', () => onApprove(parseInt(btn.dataset.index)));
  });

  // Dismiss buttons
  container.querySelectorAll('.comment-dismiss').forEach(btn => {
    btn.addEventListener('click', () => onDismiss(parseInt(btn.dataset.index)));
  });

  // Add note
  const input = container.querySelector('.comments-input');
  const submitBtn = container.querySelector('.comments-submit');

  submitBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return;
    onAddNote({
      id: 'n' + Date.now(),
      author: authorName || 'You',
      text,
      section: null,
      ts: new Date().toISOString(),
      status: null,
    });
    input.value = '';
  });

  // Enter to submit (Cmd+Enter or Ctrl+Enter)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      submitBtn.click();
    }
  });
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

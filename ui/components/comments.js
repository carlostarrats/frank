// comments.js — Comment panel for the editor

export function renderComments(container, { screen, screenId, selectedSection = null, onApprove, onDismiss, onAddNote, onClearSection, authorName }) {
  const notes = screen.notes || [];
  const isFiltered = selectedSection !== null;
  const sectionType = isFiltered ? (screen.sections?.[selectedSection]?.type || 'section') : null;
  const sectionLabel = sectionType ? sectionType.charAt(0).toUpperCase() + sectionType.slice(1) : '';

  // When a section is selected, filter to that section's notes; otherwise show all
  const displayNotes = isFiltered
    ? notes.map((n, i) => ({ ...n, _origIndex: i })).filter(n => n.section === selectedSection)
    : notes.map((n, i) => ({ ...n, _origIndex: i }));

  container.innerHTML = `
    <div class="comments-panel">
      <div class="comments-header">
        <span class="comments-title">Comments${isFiltered ? ` <span class="comments-section-label">on ${escapeHtml(sectionLabel)}</span>` : ''}</span>
        <span class="comments-header-right">
          ${isFiltered ? '<button class="comments-show-all">Show all</button>' : ''}
          <span class="comments-count">${displayNotes.length}</span>
        </span>
      </div>
      <div class="comments-list">
        ${displayNotes.length === 0 ? '<p class="comments-empty">No comments yet</p>' : ''}
        ${displayNotes.map((note) => {
          const noteSection = note.section != null && !isFiltered ? screen.sections?.[note.section]?.type : null;
          const noteSectionLabel = noteSection ? noteSection.charAt(0).toUpperCase() + noteSection.slice(1) : '';
          return `
          <div class="comment-item ${note.status ? 'comment-item--' + note.status : ''}" data-index="${note._origIndex}">
            <div class="comment-author">${escapeHtml(note.author || 'Unknown')}${noteSectionLabel ? ` <span class="comment-section-tag">on ${escapeHtml(noteSectionLabel)}</span>` : ''}</div>
            <div class="comment-text">${escapeHtml(note.text)}</div>
            <div class="comment-meta">
              ${formatTime(note.ts)}
              ${note.status ? ` · <span class="comment-status comment-status--${note.status}">${note.status}</span>` : ''}
            </div>
            ${!note.status ? `
              <div class="comment-actions">
                <button class="comment-approve" data-index="${note._origIndex}" title="Approve">&#x2713;</button>
                <button class="comment-dismiss" data-index="${note._origIndex}" title="Dismiss">&#x2717;</button>
              </div>
            ` : ''}
          </div>
        `}).join('')}
      </div>
      <div class="comments-add">
        <textarea class="comments-input" placeholder="Add a note${isFiltered ? ' on ' + sectionLabel : ''}..." rows="2"></textarea>
        <button class="comments-submit">Add</button>
      </div>
    </div>
  `;

  // Show all button
  const showAllBtn = container.querySelector('.comments-show-all');
  if (showAllBtn && onClearSection) {
    showAllBtn.addEventListener('click', () => onClearSection());
  }

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
      section: selectedSection ?? null,
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

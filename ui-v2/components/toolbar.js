// toolbar.js — Top toolbar for the viewer

export function renderToolbar(container, { projectName, url, onBack }) {
  container.innerHTML = `
    <div class="toolbar">
      <button class="btn-ghost toolbar-back" id="toolbar-back">← Back</button>
      <span class="toolbar-title">${escapeHtml(projectName)}</span>
      <span class="toolbar-url">${escapeHtml(url || '')}</span>
      <div class="toolbar-spacer"></div>
      <button class="toolbar-btn" id="toolbar-comment-toggle" title="Toggle comments">💬</button>
      <button class="toolbar-btn" id="toolbar-share" disabled title="Share (Phase 2)">Share</button>
    </div>
  `;

  container.querySelector('#toolbar-back').addEventListener('click', onBack);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

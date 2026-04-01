// toolbar.js — Top toolbar for the viewer
import { showSharePopover } from './share-popover.js';

export function renderToolbar(container, { projectName, url, onBack }) {
  container.innerHTML = `
    <div class="toolbar">
      <button class="btn-ghost toolbar-back" id="toolbar-back">← Back</button>
      <span class="toolbar-title">${escapeHtml(projectName)}</span>
      <span class="toolbar-url">${escapeHtml(url || '')}</span>
      <div class="toolbar-spacer"></div>
      <button class="toolbar-btn" id="toolbar-comment-toggle" title="Toggle comments">💬</button>
      <button class="toolbar-btn" id="toolbar-share" title="Share">Share</button>
    </div>
  `;

  container.querySelector('#toolbar-back').addEventListener('click', onBack);

  const shareBtn = container.querySelector('#toolbar-share');
  shareBtn.addEventListener('click', () => {
    showSharePopover(shareBtn, { onClose() {} });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

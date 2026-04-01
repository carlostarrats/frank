// toolbar.js — Top toolbar for the viewer
import { showSharePopover } from './share-popover.js';

export function renderToolbar(container, { projectName, url, onBack }) {
  container.innerHTML = `
    <div class="toolbar">
      <button class="btn-ghost toolbar-back" id="toolbar-back">← Back</button>
      <span class="toolbar-title">${escapeHtml(projectName)}</span>
      <span class="toolbar-url">${escapeHtml(url || '')}</span>
      <div class="toolbar-spacer"></div>
      <div class="toolbar-actions">
        <button class="toolbar-btn toolbar-info-btn" id="toolbar-info" title="What do these do?">?</button>
        <button class="toolbar-btn" id="toolbar-snapshot" title="Take snapshot">📸</button>
        <button class="toolbar-btn" id="toolbar-timeline" title="Timeline">📋</button>
        <button class="toolbar-btn toolbar-comment-btn" id="toolbar-comment-toggle" title="Toggle comments">💬</button>
        <button class="toolbar-btn" id="toolbar-share" title="Share">Share</button>
      </div>
    </div>
    <div class="toolbar-info-overlay" id="toolbar-info-overlay" style="display:none">
      <div class="toolbar-info-modal">
        <div class="toolbar-info-header">
          <h3>Toolbar Guide</h3>
          <button class="toolbar-info-close" id="toolbar-info-close">✕</button>
        </div>
        <div class="toolbar-info-content">
          <div class="toolbar-info-item">
            <span class="toolbar-info-icon">📸</span>
            <strong>Snapshot</strong>
            <p>Save the current page state as a point-in-time record. Use it to bookmark meaningful moments before and after changes.</p>
          </div>
          <div class="toolbar-info-item">
            <span class="toolbar-info-icon">📋</span>
            <strong>Timeline</strong>
            <p>View all snapshots, comments, and decisions in chronological order. The full history of your project.</p>
          </div>
          <div class="toolbar-info-item">
            <span class="toolbar-info-icon">💬</span>
            <strong>Comments</strong>
            <p>Open the feedback panel. Click elements on the page to leave anchored comments, then curate them.</p>
          </div>
          <div class="toolbar-info-item">
            <span class="toolbar-info-icon">🔗</span>
            <strong>Share</strong>
            <p>Generate a shareable link so others can view the page and leave comments from their browser.</p>
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#toolbar-back').addEventListener('click', onBack);

  container.querySelector('#toolbar-snapshot')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('frank:take-snapshot'));
  });

  container.querySelector('#toolbar-timeline')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('frank:open-timeline'));
  });

  // Info modal toggle
  const infoBtn = container.querySelector('#toolbar-info');
  const infoOverlay = container.querySelector('#toolbar-info-overlay');
  const infoClose = container.querySelector('#toolbar-info-close');
  infoBtn.addEventListener('click', () => { infoOverlay.style.display = 'flex'; });
  infoClose.addEventListener('click', () => { infoOverlay.style.display = 'none'; });
  infoOverlay.addEventListener('click', (e) => {
    if (e.target === infoOverlay) infoOverlay.style.display = 'none';
  });

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

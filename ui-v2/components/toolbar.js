// toolbar.js — Top toolbar for the viewer
import { showSharePopover } from './share-popover.js';

// v3 Phase 5: ambient LIVE badge on the toolbar share button. Tracks the
// frank:live-share-state DOM events emitted by core/sync.js — same source
// the share popover consumes. The popover handles detailed interaction;
// this badge is a passive, always-visible signal.
//
// Known limitation (documented, not fixed): toolbarLiveState grows over the
// session as the user opens different projects with active live shares.
// Entries are harmless (stale entries don't render anything because the
// corresponding share button doesn't exist after project switch), but the
// map isn't pruned. A future cleanup hook could prune on project-close.
const toolbarLiveState = new Map(); // projectId → { status, viewers }

window.addEventListener('frank:live-share-state', (e) => {
  const { projectId, status, viewers } = e.detail;
  toolbarLiveState.set(projectId, { status, viewers });
  rerenderBadge(projectId);
});

window.addEventListener('frank:share-revoked', (e) => {
  toolbarLiveState.delete(e.detail.projectId);
  rerenderBadge(e.detail.projectId);
});

function rerenderBadge(projectId) {
  // Marker-based selector. Both the viewer's toolbar (components/toolbar.js)
  // and the canvas view's inline share button (views/canvas.js) tag their
  // share buttons with data-frank-share-btn + data-project-id. Neither
  // existing button's class name is shared between the two views, so we
  // use a neutral data-attribute marker rather than a class selector.
  const shareBtn = document.querySelector('[data-frank-share-btn][data-project-id="' + projectId + '"]');
  if (!shareBtn) return;
  const badge = shareBtn.querySelector('.toolbar-live-badge');
  const state = toolbarLiveState.get(projectId);
  if (!state || (state.status !== 'live' && state.status !== 'throttled')) {
    if (badge) badge.remove();
    return;
  }
  const count = state.viewers || 0;
  const label = count === 1 ? 'LIVE · 1' : `LIVE · ${count}`;
  if (badge) {
    badge.textContent = label;
  } else {
    const el = document.createElement('span');
    el.className = 'toolbar-live-badge';
    el.textContent = label;
    shareBtn.appendChild(el);
  }
}

// Called from view render paths after the share button is mounted to sync
// badge state on project switch. Without this, a user who starts live share
// on project A, switches to project B, then switches back to A would not
// see the badge until the next state event fires — potentially 30s later
// at the next state-promotion tick.
export function syncToolbarLiveBadge(projectId) {
  rerenderBadge(projectId);
}

export function renderToolbar(container, { projectName, url, onBack, projectId }) {
  container.innerHTML = `
    <div class="toolbar">
      <button class="btn-ghost toolbar-back" id="toolbar-back" title="Back" aria-label="Back">←</button>
      <span class="toolbar-title">${escapeHtml(projectName)}</span>
      <span class="toolbar-url">${escapeHtml(url || '')}</span>
      <div class="toolbar-spacer"></div>
      <div class="toolbar-actions">
        <button class="toolbar-btn toolbar-info-btn" id="toolbar-info" title="What do these do?">?</button>
        <button class="toolbar-btn toolbar-icon-btn" id="toolbar-snapshot" title="Take snapshot" aria-label="Take snapshot">
          ${iconCamera()}
        </button>
        <button class="toolbar-btn toolbar-icon-btn toolbar-comment-btn" id="toolbar-comment-toggle" title="Add comment" aria-label="Toggle comment mode">
          ${iconCommentPlus()}
        </button>
        <button class="toolbar-btn toolbar-icon-btn" id="toolbar-timeline" title="Timeline" aria-label="Timeline">
          ${iconTimeline()}
        </button>
        <button class="toolbar-btn toolbar-ai-toggle" id="toolbar-ai-toggle" title="Ask Claude">AI</button>
        <button class="toolbar-btn toolbar-icon-btn" id="toolbar-share" data-frank-share-btn data-project-id="${projectId || ''}" title="Share" aria-label="Share">
          ${iconLink()}
        </button>
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
            <span class="toolbar-info-icon">${iconCamera()}</span>
            <strong>Snapshot</strong>
            <p>Save the current page state as a point-in-time record. Use it to bookmark meaningful moments before and after changes.</p>
          </div>
          <div class="toolbar-info-item">
            <span class="toolbar-info-icon">${iconTimeline()}</span>
            <strong>Timeline</strong>
            <p>View all snapshots, comments, and decisions in chronological order. The full history of your project.</p>
          </div>
          <div class="toolbar-info-item">
            <span class="toolbar-info-icon">${iconCommentPlus()}</span>
            <strong>Comment mode</strong>
            <p>Toggle comment mode. Your cursor turns into a speech-bubble-plus — click any element on the page to anchor a comment. Click the button again or press Esc to exit.</p>
          </div>
          <div class="toolbar-info-item">
            <span class="toolbar-info-icon">${iconLink()}</span>
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

// Shared SVG icons — inline to keep the "no build step" constraint and so the
// icons inherit currentColor. 16×16 default via width/height on the <svg>.
export function iconCommentPlus() {
  return `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 4 L20 4 L20 15 L12 15 L8 19 L8 15 L4 15 Z"/>
      <line x1="12" y1="7" x2="12" y2="12"/>
      <line x1="9.5" y1="9.5" x2="14.5" y2="9.5"/>
    </svg>
  `;
}
export function iconCamera() {
  return `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 8 L7 8 L8.5 6 L15.5 6 L17 8 L21 8 L21 19 L3 19 Z"/>
      <circle cx="12" cy="13" r="3.5"/>
    </svg>
  `;
}
export function iconLink() {
  return `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10.5 13.5 a4 4 0 0 1 0-5.66 l2.5-2.5 a4 4 0 0 1 5.66 5.66 l-1.5 1.5"/>
      <path d="M13.5 10.5 a4 4 0 0 1 0 5.66 l-2.5 2.5 a4 4 0 0 1-5.66-5.66 l1.5-1.5"/>
    </svg>
  `;
}
export function iconDownload() {
  return `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 4 V16"/>
      <path d="M6 12 L12 18 L18 12"/>
      <path d="M5 21 L19 21"/>
    </svg>
  `;
}
export function iconUndo() {
  return `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 14 L4 9 L9 4"/>
      <path d="M4 9 H14 a6 6 0 0 1 6 6 v1 a6 6 0 0 1-6 6 H8"/>
    </svg>
  `;
}
export function iconTimeline() {
  return `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="5" y1="7" x2="19" y2="7"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
      <line x1="5" y1="17" x2="15" y2="17"/>
    </svg>
  `;
}

// share-popover.js — Share popover with cover note and link management
import sync from '../core/sync.js';
import projectManager from '../core/project.js';

// Tracks the current "Capturing snapshot..." state. `captureInProgress` is
// a flag (not a string comparison on textContent — that would break if any
// other code path changes the status text's whitespace, adds a spinner
// character, or localizes the string). `captureTimeoutId` is the pending
// defensive timeout. Both are cleared by updateSharePopover when a real
// response arrives. Only one share-create flow runs at a time; a Map would
// be overkill.
let captureInProgress = false;
let captureTimeoutId = null;

// v3 Phase 2: live-share state per project. Updated by daemon broadcasts
// re-emitted as DOM events by core/sync.js.
const liveShareState = new Map(); // projectId → { status, viewers, lastError }

window.addEventListener('frank:live-share-state', (e) => {
  const { projectId, status, viewers, lastError } = e.detail;
  liveShareState.set(projectId, { status, viewers, lastError });
  const open = document.querySelector('.share-modal[data-project-id="' + projectId + '"]');
  if (open) rerenderLiveBlock(open, projectId);
});

window.addEventListener('frank:share-revoked', (e) => {
  liveShareState.delete(e.detail.projectId);
  const open = document.querySelector('.share-modal[data-project-id="' + e.detail.projectId + '"]');
  if (open) rerenderLiveBlock(open, e.detail.projectId);
});

function getLiveState(projectId) {
  return liveShareState.get(projectId) || { status: 'idle', viewers: 0, lastError: null };
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = String(s);
  return div.innerHTML;
}

// v3 Phase 5: payload-too-large maps to different user-friendly copy per
// project type. Canvas hits this with inline assets; image and PDF hit it
// with the file itself being too large.
function payloadTooLargeCopy(contentType) {
  if (contentType === 'canvas') return 'Canvas too heavy for live share — reduce inline assets, then click Resume.';
  if (contentType === 'image') return 'Image too large for live share — use a smaller file, then click Resume.';
  if (contentType === 'pdf') return 'PDF too large for live share — use a smaller file, then click Resume.';
  return 'File too large for live share — reduce size, then click Resume.';
}

function renderLiveBlock(projectId) {
  const { status, viewers, lastError } = getLiveState(projectId);
  let html = '<div class="share-live-block">';
  if (status === 'idle') {
    html += `<button type="button" class="share-live-btn" data-action="start">Start live share</button>`;
  } else if (status === 'connecting') {
    html += `<button type="button" class="share-live-btn" disabled>Starting…</button>`;
  } else if (status === 'live') {
    html += `<button type="button" class="share-live-btn" data-action="pause">Pause live share</button>`;
    const count = viewers === 1 ? '1 watching' : `${viewers} watching`;
    html += `<div class="share-live-presence">Live · ${count}</div>`;
  } else if (status === 'throttled') {
    html += `<button type="button" class="share-live-btn" data-action="pause">Pause live share</button>`;
    html += `<div class="share-live-banner">Live updates throttled — catching up.</div>`;
  } else if (status === 'paused') {
    html += `<button type="button" class="share-live-btn" data-action="resume">Resume live share</button>`;
    if (lastError === 'session-timeout-2h') {
      html += `<div class="share-live-banner">Live share paused — sessions auto-pause after 2 hours to prevent accidental long-running sessions. Click Resume to continue.</div>`;
    } else if (lastError === 'payload-too-large') {
      const contentType = projectManager.get()?.contentType;
      html += `<div class="share-live-banner error">${payloadTooLargeCopy(contentType)}</div>`;
    }
  } else if (status === 'offline') {
    html += `<div class="share-live-status">Author offline · Reconnecting…</div>`;
  } else if (status === 'error') {
    html += `<button type="button" class="share-live-btn" data-action="start">Retry live share</button>`;
    if (lastError) html += `<div class="share-live-banner error">${escapeHtml(lastError)}</div>`;
  } else if (status === 'unsupported') {
    html += `<div class="share-live-banner error">Live updates unavailable — your backend needs updating.</div>`;
  }
  html += '</div>';
  return html;
}

function rerenderLiveBlock(popoverEl, projectId) {
  const existing = popoverEl.querySelector('.share-live-block');
  if (existing) existing.outerHTML = renderLiveBlock(projectId);
}

export function showSharePopover(anchorEl, { onClose }) {
  // Remove existing
  document.querySelector('.share-overlay')?.remove();

  const project = projectManager.get();
  const activeShare = project?.activeShare;

  const overlay = document.createElement('div');
  overlay.className = 'share-overlay';

  overlay.innerHTML = `
    <div class="share-modal" data-project-id="${esc(project?.id || '')}">
      <div class="share-modal-header">
        <h3>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1px;margin-right:6px">
            <path d="M10.5 13.5 a4 4 0 0 1 0-5.66 l2.5-2.5 a4 4 0 0 1 5.66 5.66 l-1.5 1.5"/>
            <path d="M13.5 10.5 a4 4 0 0 1 0 5.66 l-2.5 2.5 a4 4 0 0 1-5.66-5.66 l1.5-1.5"/>
          </svg>
          Share
        </h3>
        <button class="share-modal-close" id="share-close">✕</button>
      </div>
      <div class="share-popover-inner">
        ${activeShare ? `
          <div class="share-popover-url">
            <input type="text" class="v-input" id="share-url" value="${esc(activeShare.id)}" readonly>
            <button class="v-btn v-btn-primary" id="share-copy">Copy</button>
          </div>
          <div class="share-revoke-row">
            <button type="button" class="share-revoke-btn" id="share-revoke">Revoke share</button>
            <span class="share-revoke-help">Invalidates the link for all current viewers.</span>
          </div>
        ` : ''}
        <textarea class="v-input v-textarea" id="share-note" placeholder="Cover note (optional)... e.g. 'Focus on the signup flow'"
          rows="2">${esc(activeShare?.coverNote || '')}</textarea>
        <label for="share-expiry" class="share-expiry-label">Expires after</label>
        <select id="share-expiry" class="share-expiry-select">
          <option value="1">1 day</option>
          <option value="7" selected>7 days (default)</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="365">1 year</option>
        </select>
        <div class="share-popover-actions">
          <button class="v-btn v-btn-ghost" id="share-cancel">Cancel</button>
          <button class="v-btn v-btn-primary" id="share-create">${activeShare ? 'Update Link' : 'Create Link'}</button>
        </div>
        <div class="share-popover-status" id="share-status"></div>
        ${renderLiveBlock(project?.id || '')}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const modal = overlay.querySelector('.share-modal');

  // Wire live-share button clicks
  modal.addEventListener('click', (e) => {
    const btn = e.target.closest('.share-live-btn[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'start') sync.send({ type: 'start-live-share', projectId: project.id });
    else if (action === 'pause') sync.send({ type: 'stop-live-share', projectId: project.id });
    else if (action === 'resume') sync.send({ type: 'resume-live-share', projectId: project.id });
  });

  // Copy link
  modal.querySelector('#share-copy')?.addEventListener('click', () => {
    const urlInput = modal.querySelector('#share-url');
    navigator.clipboard.writeText(urlInput.value);
    modal.querySelector('#share-copy').textContent = 'Copied!';
    setTimeout(() => { modal.querySelector('#share-copy').textContent = 'Copy'; }, 2000);
  });

  // Revoke share
  modal.querySelector('#share-revoke')?.addEventListener('click', () => {
    const p = projectManager.get();
    if (!p?.activeShare) return;
    const confirmed = confirm(
      'Revoke this share?\n\n' +
      'The link will stop working for all current viewers and cannot be restored.\n\n' +
      'Your project is unchanged — you can create a new share afterward.'
    );
    if (!confirmed) return;
    sync.send({ type: 'revoke-share', projectId: p.id });
    // Daemon broadcasts share-revoked; the frank:share-revoked listener above
    // clears liveShareState for this project. project-loaded broadcasts
    // re-render the modal with a null activeShare, resetting to create state.
  });

  // Create/Update share
  modal.querySelector('#share-create').addEventListener('click', async () => {
    const statusEl = modal.querySelector('#share-status');
    const coverNote = modal.querySelector('#share-note').value.trim();
    const expiryDays = Number(modal.querySelector('#share-expiry').value) || 7;
    statusEl.textContent = 'Capturing snapshot...';
    statusEl.style.color = '';  // reset any previous error color

    // Defensive timeout. If no snapshot result arrives within 15 seconds,
    // flip to a visible error so the user knows something went wrong instead
    // of staring at a spinner indefinitely. Uses a boolean flag — NOT a string
    // comparison on textContent — so future status-text changes (spinners,
    // whitespace, localization) don't silently break the check.
    if (captureTimeoutId) clearTimeout(captureTimeoutId);
    captureInProgress = true;
    captureTimeoutId = setTimeout(() => {
      captureTimeoutId = null;
      if (captureInProgress) {
        captureInProgress = false;
        statusEl.textContent = 'Snapshot capture failed — please report this';
        statusEl.style.color = '#ff4a4a';
      }
    }, 15_000);

    const event = new CustomEvent('frank:capture-snapshot', { detail: { coverNote, expiryDays } });
    window.dispatchEvent(event);
  });

  // Cancel / Close
  const closeModal = () => { overlay.remove(); onClose(); };
  modal.querySelector('#share-cancel').addEventListener('click', closeModal);
  modal.querySelector('#share-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  return overlay;
}

// Called after snapshot is captured and uploaded
export function updateSharePopover(result) {
  // We have a real response — cancel the defensive timeout and clear the flag.
  captureInProgress = false;
  if (captureTimeoutId) { clearTimeout(captureTimeoutId); captureTimeoutId = null; }
  const modal = document.querySelector('.share-modal');
  if (!modal) return;

  const statusEl = modal.querySelector('#share-status');
  if (result.error) {
    statusEl.textContent = `Error: ${result.error}`;
    statusEl.style.color = '#ff4a4a';
    return;
  }

  // Show URL
  statusEl.textContent = '';
  const urlSection = modal.querySelector('.share-popover-url') || document.createElement('div');
  urlSection.className = 'share-popover-url';
  urlSection.innerHTML = `
    <input type="text" class="v-input" id="share-url" value="${esc(result.url)}" readonly>
    <button class="v-btn v-btn-primary" id="share-copy">Copy</button>
  `;
  if (!modal.querySelector('.share-popover-url')) {
    modal.querySelector('.share-popover-inner').prepend(urlSection);
  }

  navigator.clipboard.writeText(result.url);
  urlSection.querySelector('#share-copy').textContent = 'Copied!';

  urlSection.querySelector('#share-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(result.url);
    urlSection.querySelector('#share-copy').textContent = 'Copied!';
    setTimeout(() => { urlSection.querySelector('#share-copy').textContent = 'Copy'; }, 2000);
  });
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text || '';
  return d.innerHTML;
}

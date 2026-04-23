// share-popover.js — Share popover with cover note and link management
import sync from '../core/sync.js';
import projectManager from '../core/project.js';
import { renderShareCreateResult } from './share-envelope-panel.js';
import { showSettingsPanel } from './settings-panel.js';

// Localhost / private-network hostnames that route to the URL-share
// auto-deploy flow. Keep the set conservative — a public URL should use
// the snapshot flow because auto-deploy doesn't apply to something that
// already lives on the internet. Matches what a reviewer couldn't reach
// from outside the author's machine.
const LOCALHOST_HOSTNAMES = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1', 'host.docker.internal',
]);
export function isLocalhostUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const u = new URL(rawUrl);
    const host = u.hostname;
    if (LOCALHOST_HOSTNAMES.has(host)) return true;
    // RFC1918 private ranges. Strict regex so public IPs like 17.17.17.17 don't match.
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

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

// Spinner + pending label shown while a start/pause/resume action is in
// flight. Swapped back to the real state when the daemon broadcasts
// live-share-state (listener at the top of this file). Without this, the
// Resume click appears dead for ~500ms — users click multiple times and
// the second click races with the state broadcast.
const PENDING_SPINNER = `<span class="share-live-spinner" aria-hidden="true"></span>`;

// Pause is visually distinct from the other actions — it's a stop, not a
// go — so it uses the ghost variant while start / resume / retry stay
// primary. Using a variant class rather than inline styles so existing
// tokens and hover states apply.
function renderLiveBlock(projectId) {
  const { status, viewers, lastError } = getLiveState(projectId);
  let html = '<div class="share-live-block">';
  if (status === 'idle') {
    html += `<button type="button" class="share-live-btn" data-action="start">Start live share</button>`;
  } else if (status === 'connecting') {
    html += `<button type="button" class="share-live-btn" disabled>${PENDING_SPINNER}Starting…</button>`;
  } else if (status === 'live') {
    html += `<button type="button" class="share-live-btn share-live-btn-stop" data-action="pause">Pause live share</button>`;
    const count = viewers === 1 ? '1 watching' : `${viewers} watching`;
    html += `<div class="share-live-presence">Live · ${count}</div>`;
  } else if (status === 'throttled') {
    html += `<button type="button" class="share-live-btn share-live-btn-stop" data-action="pause">Pause live share</button>`;
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
  const projectId = projectManager.getId();

  // Localhost URL projects branch to auto-deploy share instead of snapshot.
  // Snapshot-based share (canvas/image/pdf/remote-URL) stays on the original
  // frank:capture-snapshot pipeline below.
  if (project?.contentType === 'url' && isLocalhostUrl(project?.url)) {
    return showUrlSharePopover(anchorEl, { onClose });
  }

  const activeShare = project?.activeShare;

  const overlay = document.createElement('div');
  overlay.className = 'share-overlay';

  overlay.innerHTML = `
    <div class="share-modal" data-project-id="${esc(projectId || '')}">
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
            <input type="text" class="v-input" id="share-url" value="${esc(activeShare.id)}" readonly aria-label="Share link ID">
            <button class="v-btn v-btn-primary" id="share-copy">Copy</button>
          </div>
          <div class="share-revoke-row">
            <button type="button" class="share-revoke-btn" id="share-revoke">Revoke share</button>
            <span class="share-revoke-help">Invalidates the link for all current viewers.</span>
          </div>
        ` : ''}
        <textarea class="v-input v-textarea" id="share-note" placeholder="Cover note (optional)... e.g. 'Focus on the signup flow'"
          aria-label="Cover note for reviewers (optional)"
          rows="2">${esc(activeShare?.coverNote || '')}</textarea>
        <label class="share-expiry-label">Expires after</label>
        <div class="share-expiry-wrapper">
          <button type="button" class="share-expiry-btn" id="share-expiry-btn"
            aria-haspopup="menu" aria-expanded="false"
            data-value="7">
            <span class="share-expiry-btn-label">7 days (default)</span>
            <svg class="share-expiry-caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div class="share-expiry-menu" id="share-expiry-menu" role="menu" hidden>
            ${[
              { v: '1',   l: '1 day' },
              { v: '7',   l: '7 days (default)' },
              { v: '30',  l: '30 days' },
              { v: '90',  l: '90 days' },
              { v: '365', l: '1 year' },
            ].map(o => `<button type="button" role="menuitemradio" class="share-expiry-item${o.v === '7' ? ' active' : ''}" data-value="${o.v}" aria-checked="${o.v === '7'}">${o.l}</button>`).join('')}
          </div>
        </div>
        <div class="share-popover-actions">
          <button class="v-btn v-btn-ghost" id="share-cancel">Cancel</button>
          <button class="v-btn v-btn-primary" id="share-create">${activeShare ? 'Update Link' : 'Create Link'}</button>
        </div>
        <div class="share-popover-status" id="share-status"></div>
        ${renderLiveBlock(projectId || '')}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const modal = overlay.querySelector('.share-modal');

  // Wire live-share button clicks. Optimistically swap the button into a
  // disabled pending state (spinner + "…ing" label) so the user sees
  // something happen inside the same frame — the daemon broadcast that
  // finishes the state transition can take 300–800ms, and without this
  // the click felt dead and people double-clicked.
  modal.addEventListener('click', (e) => {
    const btn = e.target.closest('.share-live-btn[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;
    const pendingLabel = action === 'pause' ? 'Pausing…'
      : action === 'resume' ? 'Resuming…'
      : 'Starting…';
    btn.disabled = true;
    btn.innerHTML = `${PENDING_SPINNER}${pendingLabel}`;
    if (action === 'start') sync.send({ type: 'start-live-share', projectId });
    else if (action === 'pause') sync.send({ type: 'stop-live-share', projectId });
    else if (action === 'resume') sync.send({ type: 'resume-live-share', projectId });
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
    sync.send({ type: 'revoke-share', projectId });
    // Daemon broadcasts share-revoked; the frank:share-revoked listener above
    // clears liveShareState for this project. project-loaded broadcasts
    // re-render the modal with a null activeShare, resetting to create state.
  });

  // Custom expiry dropdown — mirrors the home-page Kind / Sort pattern so
  // the share modal stays on-system instead of the OS-rendered <select>.
  const expiryBtn = modal.querySelector('#share-expiry-btn');
  const expiryMenu = modal.querySelector('#share-expiry-menu');
  const expiryLabelEl = modal.querySelector('.share-expiry-btn-label');
  const closeExpiryMenu = () => {
    expiryMenu.setAttribute('hidden', '');
    expiryBtn.setAttribute('aria-expanded', 'false');
  };
  expiryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!expiryMenu.hasAttribute('hidden')) { closeExpiryMenu(); return; }
    expiryMenu.removeAttribute('hidden');
    expiryBtn.setAttribute('aria-expanded', 'true');
  });
  expiryMenu.querySelectorAll('.share-expiry-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const value = item.dataset.value;
      expiryBtn.dataset.value = value;
      expiryLabelEl.textContent = item.textContent.trim();
      expiryMenu.querySelectorAll('.share-expiry-item').forEach(i => {
        const active = i === item;
        i.classList.toggle('active', active);
        i.setAttribute('aria-checked', String(active));
      });
      closeExpiryMenu();
    });
  });
  const onExpiryClickOutside = (e) => {
    if (expiryMenu.hasAttribute('hidden')) return;
    if (e.target.closest('.share-expiry-wrapper')) return;
    closeExpiryMenu();
  };
  document.addEventListener('click', onExpiryClickOutside);
  const onExpiryKeydown = (e) => {
    if (e.key === 'Escape' && !expiryMenu.hasAttribute('hidden')) closeExpiryMenu();
  };
  document.addEventListener('keydown', onExpiryKeydown);

  // Create/Update share
  modal.querySelector('#share-create').addEventListener('click', async () => {
    const statusEl = modal.querySelector('#share-status');
    const coverNote = modal.querySelector('#share-note').value.trim();
    const expiryDays = Number(expiryBtn.dataset.value) || 7;
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
  const closeModal = () => {
    document.removeEventListener('click', onExpiryClickOutside);
    document.removeEventListener('keydown', onExpiryKeydown);
    overlay.remove();
    onClose();
  };
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
    <input type="text" class="v-input" id="share-url" value="${esc(result.url)}" readonly aria-label="Share link URL">
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

// ─── URL-share popover (localhost → auto-deploy to Vercel) ─────────────────
//
// Simpler UX than Settings → Share Preview's diagnostics panel: just one
// "Create share" button. Daemon's share-create handler runs envelope +
// preflight + bundle + deploy internally and surfaces a single result via
// renderShareCreateResult. Diagnostics panel in Settings stays available for
// users who want to see each step.
//
// Two gates block the main flow: (1) Vercel deploy token configured in
// Settings, (2) sourceDir remembered on the project. Until both are cleared
// the "Create share" button is hidden — flips into reveal mode once both
// conditions are met.

export function showUrlSharePopover(anchorEl, { onClose }) {
  document.querySelector('.share-overlay')?.remove();

  const project = projectManager.get();
  const projectId = projectManager.getId();
  if (!project || !projectId) return null;

  const overlay = document.createElement('div');
  overlay.className = 'share-overlay';
  overlay.innerHTML = `
    <div class="share-modal" data-project-id="${esc(projectId)}">
      <div class="share-modal-header">
        <h3>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1px;margin-right:6px">
            <path d="M10.5 13.5 a4 4 0 0 1 0-5.66 l2.5-2.5 a4 4 0 0 1 5.66 5.66 l-1.5 1.5"/>
            <path d="M13.5 10.5 a4 4 0 0 1 0 5.66 l-2.5 2.5 a4 4 0 0 1-5.66-5.66 l1.5-1.5"/>
          </svg>
          Share localhost app
        </h3>
        <button class="share-modal-close" id="share-close">✕</button>
      </div>
      <div class="share-popover-inner share-url-popover">
        <p class="share-url-intro">Frank auto-deploys your running app to a preview on your own Vercel account. Reviewers get an interactive copy — not a screenshot.</p>
        <div class="share-url-gate-vercel" id="share-url-gate-vercel"></div>
        <div class="share-url-gate-sourcedir" id="share-url-gate-sourcedir"></div>
        <div class="share-url-ready" id="share-url-ready" hidden>
          <div class="share-url-source-row">
            <span class="share-url-source-label">Source:</span>
            <code class="share-url-source-path" id="share-url-source-path"></code>
            <button type="button" class="share-url-source-change" id="share-url-source-change">Change</button>
          </div>
          <div class="share-url-actions">
            <button type="button" class="v-btn v-btn-primary" id="share-url-create">Create share</button>
          </div>
        </div>
        <div class="share-url-progress" id="share-url-progress" aria-live="polite"></div>
        <div class="share-url-result" id="share-url-result"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const modal = overlay.querySelector('.share-modal');
  const vercelGate = modal.querySelector('#share-url-gate-vercel');
  const sourceGate = modal.querySelector('#share-url-gate-sourcedir');
  const ready = modal.querySelector('#share-url-ready');
  const sourcePathEl = modal.querySelector('#share-url-source-path');
  const progressEl = modal.querySelector('#share-url-progress');
  const resultEl = modal.querySelector('#share-url-result');

  let vercelConfigured = false;
  let sourceDir = project.sourceDir || '';

  const close = () => { overlay.remove(); onClose?.(); };
  modal.querySelector('#share-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  async function refreshGates() {
    // Vercel gate
    try {
      const cfg = await sync.getVercelDeployConfig();
      vercelConfigured = !!cfg?.configured;
    } catch { vercelConfigured = false; }
    renderVercelGate();
    renderSourceGate();
    renderReady();
  }

  function renderVercelGate() {
    if (vercelConfigured) { vercelGate.innerHTML = ''; return; }
    vercelGate.innerHTML = `
      <div class="share-url-gate share-url-gate-warn">
        <div class="share-url-gate-title">Vercel deploy token not configured</div>
        <div class="share-url-gate-body">Frank needs a Vercel personal access token to deploy your app. Configure it once in Settings.</div>
        <div class="share-url-gate-actions">
          <button type="button" class="v-btn v-btn-primary" id="share-url-open-settings">Open Settings</button>
        </div>
      </div>
    `;
    vercelGate.querySelector('#share-url-open-settings').addEventListener('click', () => {
      close();
      showSettingsPanel({ initialTopTab: 'share-diag' });
    });
  }

  function renderSourceGate() {
    // Only surface the source-dir prompt after Vercel is configured — less
    // noisy first impression. User clears one gate at a time.
    if (!vercelConfigured) { sourceGate.innerHTML = ''; return; }
    if (sourceDir) { sourceGate.innerHTML = ''; return; }
    sourceGate.innerHTML = `
      <div class="share-url-gate">
        <div class="share-url-gate-title">Absolute path to your project</div>
        <div class="share-url-gate-body">Browsers can't pick directories, so paste the full path. Example: <code>/Users/you/code/my-app</code></div>
        <form class="share-url-source-form" id="share-url-source-form">
          <input type="text" class="v-input" id="share-url-source-input" placeholder="/Users/you/code/my-app" autocomplete="off" spellcheck="false" />
          <button type="submit" class="v-btn v-btn-primary">Save path</button>
        </form>
      </div>
    `;
    const form = sourceGate.querySelector('#share-url-source-form');
    const input = sourceGate.querySelector('#share-url-source-input');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const trimmed = input.value.trim();
      if (!trimmed) return;
      try {
        await sync.setProjectSourceDir(projectId, trimmed);
        sourceDir = trimmed;
        renderSourceGate();
        renderReady();
      } catch (err) {
        progressEl.textContent = `Could not save: ${err?.message ?? String(err)}`;
      }
    });
  }

  function renderReady() {
    const canCreate = vercelConfigured && sourceDir;
    ready.hidden = !canCreate;
    if (canCreate) sourcePathEl.textContent = sourceDir;
  }

  modal.querySelector('#share-url-source-change').addEventListener('click', async () => {
    try {
      await sync.setProjectSourceDir(projectId, '');
      sourceDir = '';
      renderSourceGate();
      renderReady();
    } catch (err) {
      progressEl.textContent = `Could not clear: ${err?.message ?? String(err)}`;
    }
  });

  modal.querySelector('#share-url-create').addEventListener('click', async () => {
    const createBtn = modal.querySelector('#share-url-create');
    createBtn.disabled = true;
    progressEl.innerHTML = `<span class="share-live-spinner" aria-hidden="true"></span>Running envelope → pre-flight → deploy. This can take several minutes.`;
    resultEl.innerHTML = '';
    try {
      const reply = await sync.shareCreate(sourceDir);
      progressEl.textContent = '';
      if (reply?.type === 'error') {
        resultEl.innerHTML = `<div class="share-url-gate share-url-gate-warn"><div class="share-url-gate-title">Share failed</div><div class="share-url-gate-body">${esc(reply.error)}</div></div>`;
        createBtn.disabled = false;
        return;
      }
      renderShareCreateResult(resultEl, reply, {
        onRevoke: async () => {
          if (reply.status !== 'ok' || !reply.shareId) return;
          resultEl.innerHTML = `<div class="share-url-progress"><span class="share-live-spinner" aria-hidden="true"></span>Revoking…</div>`;
          try {
            const r = await sync.shareRevokeUrl(reply.shareId, reply.revokeToken, reply.vercelDeploymentId);
            renderShareCreateResult(resultEl, reply, { revokeResult: r });
          } catch (err) {
            resultEl.innerHTML = `<div class="share-url-gate share-url-gate-warn"><div class="share-url-gate-title">Revoke failed</div><div class="share-url-gate-body">${esc(err?.message ?? String(err))}</div></div>`;
          }
        },
      });
    } catch (err) {
      progressEl.textContent = '';
      resultEl.innerHTML = `<div class="share-url-gate share-url-gate-warn"><div class="share-url-gate-title">Share failed</div><div class="share-url-gate-body">${esc(err?.message ?? String(err))}</div></div>`;
      createBtn.disabled = false;
    }
  });

  refreshGates();
  return overlay;
}

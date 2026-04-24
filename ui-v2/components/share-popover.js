// share-popover.js — Share popover with cover note and link management
import sync from '../core/sync.js';
import projectManager from '../core/project.js';
import { renderShareCreateResult } from './share-envelope-panel.js';
import { showSettingsPanel } from './settings-panel.js';
import { showConfirm } from './confirm.js';

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
            <input type="text" class="input" id="share-url" value="${esc(activeShare.id)}" readonly aria-label="Share link ID">
            <button class="btn-primary" id="share-copy">Copy</button>
          </div>
          <div class="share-revoke-row">
            <button type="button" class="share-revoke-btn" id="share-revoke">Revoke share</button>
            <span class="share-revoke-help">Invalidates the link for all current viewers.</span>
          </div>
        ` : ''}
        <textarea class="input textarea" id="share-note" placeholder="Cover note (optional)... e.g. 'Focus on the signup flow'"
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
          <button class="btn-ghost" id="share-cancel">Cancel</button>
          <button class="btn-primary" id="share-create">${activeShare ? 'Update Link' : 'Create Link'}</button>
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
  modal.querySelector('#share-revoke')?.addEventListener('click', async () => {
    const p = projectManager.get();
    if (!p?.activeShare) return;
    const ok = await showConfirm({
      title: 'Revoke this share?',
      message: 'The link will stop working for all current viewers and cannot be restored.\nYour project is unchanged — you can create a new share afterward.',
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!ok) return;
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
    <input type="text" class="input" id="share-url" value="${esc(result.url)}" readonly aria-label="Share link URL">
    <button class="btn-primary" id="share-copy">Copy</button>
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

// Build-progress block with the three-zone UX + streamed log pane.
// Updates driven by frank:share-create-progress events (broadcast by
// core/sync.js without resolving the pending share-create promise).
//
// Three zones per design doc §6.3:
//   - 0–90s       "Building your preview" (green / neutral)
//   - 90s–5min    "Taking longer than usual" (yellow)
//   - >5min       "Build timed out" (red)
//
// The timer is driven locally so the elapsed number updates smoothly
// between poll-based daemon updates.
function createBuildProgressBlock() {
  const el = document.createElement('div');
  el.className = 'share-url-build-block';
  el.innerHTML = `
    <div class="share-url-build-header">
      <div class="share-url-build-stage" id="sub-stage">
        <span class="share-live-spinner" aria-hidden="true"></span>
        <span class="share-url-build-stage-label">Starting…</span>
      </div>
      <div class="share-url-build-timer" id="sub-timer" aria-live="off">00:00</div>
    </div>
    <div class="share-url-build-zone" id="sub-zone" hidden></div>
    <pre class="share-url-build-log" id="sub-log" aria-live="polite"></pre>
  `;

  const stageLabel = el.querySelector('.share-url-build-stage-label');
  const timerEl = el.querySelector('#sub-timer');
  const zoneEl = el.querySelector('#sub-zone');
  const logEl = el.querySelector('#sub-log');

  let startedAt = null;
  let currentZone = 'expected';
  let rafId = null;

  function pad(n) { return String(Math.floor(n)).padStart(2, '0'); }
  function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${pad(total / 60)}:${pad(total % 60)}`;
  }
  function zoneFromElapsed(ms) {
    if (ms < 90_000) return 'expected';
    if (ms < 5 * 60_000) return 'taking-longer';
    return 'timeout';
  }
  function setZone(z) {
    if (z === currentZone) return;
    currentZone = z;
    if (z === 'expected') {
      zoneEl.hidden = true;
    } else if (z === 'taking-longer') {
      zoneEl.hidden = false;
      zoneEl.className = 'share-url-build-zone share-url-build-zone-warn';
      zoneEl.textContent = 'Taking longer than usual. Vercel might be busy, or your app is larger than typical. Still running…';
    } else {
      zoneEl.hidden = false;
      zoneEl.className = 'share-url-build-zone share-url-build-zone-error';
      zoneEl.textContent = 'Build is past the 5-minute timeout window. Vercel may be degraded or the app build is stuck — check the Vercel dashboard.';
    }
  }

  function tick() {
    if (!startedAt) { rafId = requestAnimationFrame(tick); return; }
    const elapsed = Date.now() - startedAt;
    timerEl.textContent = formatElapsed(elapsed);
    setZone(zoneFromElapsed(elapsed));
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);

  function appendLog(type, text) {
    const line = document.createElement('span');
    line.className = `share-url-build-log-line share-url-build-log-${type}`;
    line.textContent = text + '\n';
    logEl.appendChild(line);
    // Auto-scroll to bottom — user is expected to watch the tail, not read
    // from the top. If they scroll up manually we don't fight them: only
    // stick-to-bottom when they were already at the bottom.
    const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    if (nearBottom) logEl.scrollTop = logEl.scrollHeight;
  }

  const STAGE_LABELS = {
    'envelope': 'Checking share envelope…',
    'preflight-build': 'Pre-flight build…',
    'preflight-smoke': 'Pre-flight smoke test…',
    'bundle-prep': 'Bundling + injecting overlay…',
    'vercel-upload': 'Uploading to Vercel…',
    'vercel-building': 'Vercel building your preview…',
    'complete': 'Share live.',
  };

  function onProgress(info) {
    if (!info) return;
    // First vercel-building event = build clock starts. Everything before
    // that happens locally and doesn't count against the Vercel build zones.
    if (info.stage === 'vercel-building' && !startedAt) startedAt = Date.now();

    if (info.stage === 'vercel-log') {
      appendLog(info.logType || 'stdout', info.logText || info.message || '');
      return;
    }

    const label = STAGE_LABELS[info.stage] || info.message || info.stage;
    stageLabel.textContent = label;

    // Use daemon's zone hint when it's fresher than our local tick (catches
    // the case where the user's clock drifts or Promise microtasks bunch up).
    if (info.zone) setZone(info.zone);
  }

  function stopTimer() {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  return { el, onProgress, stopTimer };
}

// Human-readable "expires in 3 days" / "expired 2 hours ago" for the active-
// shares list. Intentionally fuzzy — users don't care about exact minutes, and
// an exact timestamp is already on the record if they want to hover.
function formatRelative(iso) {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return '—';
  const diff = target - Date.now();
  const abs = Math.abs(diff);
  const sign = diff >= 0 ? 'in ' : '';
  const past = diff < 0 ? ' ago' : '';
  const DAY = 86400000, HOUR = 3600000, MIN = 60000;
  const pick = (v, unit) => `${sign}${v} ${unit}${v === 1 ? '' : 's'}${past}`;
  if (abs >= DAY) return pick(Math.round(abs / DAY), 'day');
  if (abs >= HOUR) return pick(Math.round(abs / HOUR), 'hour');
  if (abs >= MIN) return pick(Math.round(abs / MIN), 'min');
  return diff >= 0 ? 'soon' : 'just now';
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
        <div class="share-url-existing" id="share-url-existing"></div>
        <div class="share-url-pending-revokes" id="share-url-pending-revokes"></div>
        <div class="share-url-ready" id="share-url-ready" hidden>
          <div class="share-url-source-row">
            <span class="share-url-source-label">Source:</span>
            <code class="share-url-source-path" id="share-url-source-path"></code>
            <button type="button" class="btn-ghost btn-sm share-url-source-change" id="share-url-source-change">Change</button>
          </div>
          <div class="share-url-actions">
            <button type="button" class="btn-primary" id="share-url-create">Create share</button>
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
  const existingEl = modal.querySelector('#share-url-existing');
  const pendingRevokesEl = modal.querySelector('#share-url-pending-revokes');

  let vercelConfigured = false;
  let sourceDir = project.sourceDir || '';

  const close = () => {
    document.removeEventListener('keydown', onEscape, true);
    overlay.remove();
    onClose?.();
  };
  // Escape closes — parity with every other modal in Frank (confirm,
  // settings, help). Without this, the share modal was the odd one out.
  const onEscape = (e) => {
    if (e.key === 'Escape' && overlay.isConnected) {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onEscape, true);
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
    refreshExisting();
  }

  // Existing shares for this project — populated by list-url-shares. Kept
  // in sync after Revoke / Create so the list reflects reality without a
  // full popover refresh.
  async function refreshExisting() {
    // Only fetch when both gates are cleared — a user who hasn't configured
    // Vercel hasn't created any shares yet, no point in surfacing an empty
    // "Active shares" block above a warning they need to handle first.
    if (!vercelConfigured) {
      existingEl.innerHTML = '';
      pendingRevokesEl.innerHTML = '';
      return;
    }
    try {
      const reply = await sync.listUrlShares(projectId);
      renderExistingList(reply?.records || []);
    } catch {
      existingEl.innerHTML = '';
    }
    // Pending-revoke retries are global (not scoped to a project). Surface
    // any entries here so the user knows background cleanup is in-flight or
    // has given up. Worker runs autonomously — no buttons, just state.
    try {
      const reply = await sync.listPendingRevokes();
      renderPendingRevokes(reply?.entries || []);
    } catch {
      pendingRevokesEl.innerHTML = '';
    }
  }

  function renderPendingRevokes(entries) {
    if (!entries.length) { pendingRevokesEl.innerHTML = ''; return; }
    const gaveUp = entries.filter((e) => e.gaveUpAt);
    const retrying = entries.filter((e) => !e.gaveUpAt);
    let html = '<div class="share-url-pending-section">';
    if (retrying.length) {
      html += `<div class="share-url-pending-title">Vercel cleanup retrying (${retrying.length})</div>`;
      html += '<ul class="share-url-pending-list">';
      for (const e of retrying) {
        html += `<li class="share-url-pending-item">
          <code>${esc(e.shareId)}</code>
          <span class="share-url-pending-meta">next attempt ${esc(formatRelative(e.nextAttemptAt))} · ${e.attemptCount}/6 tries</span>
        </li>`;
      }
      html += '</ul>';
    }
    if (gaveUp.length) {
      html += `<div class="share-url-pending-title share-url-pending-title-error">Vercel cleanup failed — delete manually (${gaveUp.length})</div>`;
      html += '<ul class="share-url-pending-list">';
      for (const e of gaveUp) {
        html += `<li class="share-url-pending-item">
          <code>${esc(e.shareId)}</code>
          <span class="share-url-pending-meta">${esc(e.lastError || 'unknown error')}</span>
        </li>`;
      }
      html += '</ul>';
    }
    html += '</div>';
    pendingRevokesEl.innerHTML = html;
  }

  function renderExistingList(records) {
    if (!records.length) { existingEl.innerHTML = ''; return; }
    existingEl.innerHTML = `
      <div class="share-url-existing-section">
        <div class="share-url-existing-title">Active shares (${records.length})</div>
        <ul class="share-url-existing-list">
          ${records.map((r) => `
            <li class="share-url-existing-item" data-share-id="${esc(r.shareId)}">
              <div class="share-url-existing-urls">
                <a href="${esc(r.shareUrl)}" target="_blank" rel="noopener" class="share-url-existing-link">${esc(r.shareUrl)}</a>
                <div class="share-url-existing-meta">Expires ${esc(formatRelative(r.expiresAt))} · Vercel: <code>${esc(r.deploymentUrl.replace(/^https?:\/\//, ''))}</code></div>
              </div>
              <div class="share-url-existing-actions">
                <button type="button" class="btn-secondary btn-sm share-url-existing-copy" data-copy="${esc(r.shareUrl)}">Copy</button>
                <button type="button" class="btn-destructive btn-sm share-url-existing-revoke" data-revoke="${esc(r.shareId)}">Revoke</button>
              </div>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
    // Wire per-row Copy + Revoke.
    existingEl.querySelectorAll('.share-url-existing-copy').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.copy || '');
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        } catch {
          btn.textContent = 'Copy failed';
        }
      });
    });
    existingEl.querySelectorAll('.share-url-existing-revoke').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const shareId = btn.dataset.revoke;
        const record = records.find((r) => r.shareId === shareId);
        if (!record) return;
        const ok = await showConfirm({
          title: 'Revoke this share?',
          message: 'The share link will stop working for all current viewers and the Vercel deployment will be deleted. This cannot be undone.',
          confirmLabel: 'Revoke',
          destructive: true,
        });
        if (!ok) return;
        btn.disabled = true;
        btn.textContent = 'Revoking…';
        try {
          await sync.shareRevokeUrl(
            record.shareId,
            record.revokeToken,
            record.vercelDeploymentId,
            record.vercelTeamId,
          );
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Revoke';
          alert(`Revoke failed: ${err?.message || err}`);
          return;
        }
        refreshExisting();
      });
    });
  }

  function renderVercelGate() {
    if (vercelConfigured) { vercelGate.innerHTML = ''; return; }
    vercelGate.innerHTML = `
      <div class="share-url-gate share-url-gate-warn">
        <div class="share-url-gate-title">Vercel deploy token not configured</div>
        <div class="share-url-gate-body">Frank needs a Vercel personal access token to deploy your app. Configure it once in Settings.</div>
        <div class="share-url-gate-actions">
          <button type="button" class="btn-primary" id="share-url-open-settings">Open Settings</button>
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
          <input type="text" class="input" id="share-url-source-input" placeholder="/Users/you/code/my-app" autocomplete="off" spellcheck="false" />
          <button type="submit" class="btn-primary">Save path</button>
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
    resultEl.innerHTML = '';

    // Three-zone build UX + streamed log pane. The popover's progress area
    // gets replaced with a live status block: stage + elapsed timer + log
    // output. Updated by frank:share-create-progress events coming through
    // sync.js (which broadcasts these without resolving the pending promise).
    const buildBlock = createBuildProgressBlock();
    progressEl.innerHTML = '';
    progressEl.appendChild(buildBlock.el);
    const onProgress = (e) => buildBlock.onProgress(e.detail);
    window.addEventListener('frank:share-create-progress', onProgress);
    const cleanup = () => window.removeEventListener('frank:share-create-progress', onProgress);

    try {
      // Pass projectId so the daemon can persist a share-record — Item 3:
      // enables the "active shares" list + revoke-after-session.
      const reply = await sync.shareCreate(sourceDir, undefined, undefined, projectId);
      cleanup();
      buildBlock.stopTimer();
      progressEl.innerHTML = '';
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
            refreshExisting();
          } catch (err) {
            resultEl.innerHTML = `<div class="share-url-gate share-url-gate-warn"><div class="share-url-gate-title">Revoke failed</div><div class="share-url-gate-body">${esc(err?.message ?? String(err))}</div></div>`;
          }
        },
      });
      // Pull the freshly-persisted record into the active-shares list so
      // the user sees it immediately, without closing+reopening the popover.
      if (reply?.status === 'ok') refreshExisting();
    } catch (err) {
      cleanup();
      buildBlock.stopTimer();
      progressEl.innerHTML = '';
      resultEl.innerHTML = `<div class="share-url-gate share-url-gate-warn"><div class="share-url-gate-title">Share failed</div><div class="share-url-gate-body">${esc(err?.message ?? String(err))}</div></div>`;
      createBtn.disabled = false;
    }
  });

  refreshGates();
  return overlay;
}

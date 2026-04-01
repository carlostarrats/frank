// share-popover.js — Share popover with cover note and link management
import sync from '../core/sync.js';
import projectManager from '../core/project.js';

export function showSharePopover(anchorEl, { onClose }) {
  // Remove existing
  document.querySelector('.share-overlay')?.remove();

  const project = projectManager.get();
  const activeShare = project?.activeShare;

  const overlay = document.createElement('div');
  overlay.className = 'share-overlay';

  overlay.innerHTML = `
    <div class="share-modal">
      <div class="share-modal-header">
        <h3>🔗 Share</h3>
        <button class="share-modal-close" id="share-close">✕</button>
      </div>
      <div class="share-popover-inner">
        ${activeShare ? `
          <div class="share-popover-url">
            <input type="text" class="v-input" id="share-url" value="${esc(activeShare.id)}" readonly>
            <button class="v-btn v-btn-primary" id="share-copy">Copy</button>
          </div>
        ` : ''}
        <textarea class="v-input v-textarea" id="share-note" placeholder="Cover note (optional)... e.g. 'Focus on the signup flow'"
          rows="2">${esc(activeShare?.coverNote || '')}</textarea>
        <div class="share-popover-actions">
          <button class="v-btn v-btn-ghost" id="share-cancel">Cancel</button>
          <button class="v-btn v-btn-primary" id="share-create">${activeShare ? 'Update Link' : 'Create Link'}</button>
        </div>
        <div class="share-popover-status" id="share-status"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const modal = overlay.querySelector('.share-modal');

  // Copy link
  modal.querySelector('#share-copy')?.addEventListener('click', () => {
    const urlInput = modal.querySelector('#share-url');
    navigator.clipboard.writeText(urlInput.value);
    modal.querySelector('#share-copy').textContent = 'Copied!';
    setTimeout(() => { modal.querySelector('#share-copy').textContent = 'Copy'; }, 2000);
  });

  // Create/Update share
  modal.querySelector('#share-create').addEventListener('click', async () => {
    const statusEl = modal.querySelector('#share-status');
    const coverNote = modal.querySelector('#share-note').value.trim();
    statusEl.textContent = 'Capturing snapshot...';

    const event = new CustomEvent('frank:capture-snapshot', { detail: { coverNote } });
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

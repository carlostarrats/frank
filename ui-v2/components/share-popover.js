// share-popover.js — Share popover with cover note and link management
import sync from '../core/sync.js';
import projectManager from '../core/project.js';

export function showSharePopover(anchorEl, { onClose }) {
  // Remove existing popover
  document.querySelector('.share-popover')?.remove();

  const project = projectManager.get();
  const activeShare = project?.activeShare;

  const popover = document.createElement('div');
  popover.className = 'share-popover';

  // Position below anchor
  const rect = anchorEl.getBoundingClientRect();
  popover.style.top = (rect.bottom + 4) + 'px';
  popover.style.right = (window.innerWidth - rect.right) + 'px';

  popover.innerHTML = `
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
  `;

  document.body.appendChild(popover);

  // Copy link
  popover.querySelector('#share-copy')?.addEventListener('click', () => {
    const urlInput = popover.querySelector('#share-url');
    navigator.clipboard.writeText(urlInput.value);
    popover.querySelector('#share-copy').textContent = 'Copied!';
    setTimeout(() => { popover.querySelector('#share-copy').textContent = 'Copy'; }, 2000);
  });

  // Create/Update share
  popover.querySelector('#share-create').addEventListener('click', async () => {
    const statusEl = popover.querySelector('#share-status');
    const coverNote = popover.querySelector('#share-note').value.trim();
    statusEl.textContent = 'Capturing snapshot...';

    // Dispatch snapshot capture event — viewer.js listens for this
    const event = new CustomEvent('frank:capture-snapshot', { detail: { coverNote } });
    window.dispatchEvent(event);
  });

  // Cancel
  popover.querySelector('#share-cancel').addEventListener('click', () => {
    popover.remove();
    onClose();
  });

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', function closePopover(e) {
      if (!popover.contains(e.target) && e.target !== anchorEl) {
        popover.remove();
        document.removeEventListener('click', closePopover);
        onClose();
      }
    });
  }, 100);

  return popover;
}

// Called after snapshot is captured and uploaded
export function updateSharePopover(result) {
  const popover = document.querySelector('.share-popover');
  if (!popover) return;

  const statusEl = popover.querySelector('#share-status');
  if (result.error) {
    statusEl.textContent = `Error: ${result.error}`;
    statusEl.style.color = '#ff4a4a';
    return;
  }

  // Show URL
  statusEl.textContent = '';
  const urlSection = popover.querySelector('.share-popover-url') || document.createElement('div');
  urlSection.className = 'share-popover-url';
  urlSection.innerHTML = `
    <input type="text" class="v-input" id="share-url" value="${esc(result.url)}" readonly>
    <button class="v-btn v-btn-primary" id="share-copy">Copy</button>
  `;
  if (!popover.querySelector('.share-popover-url')) {
    popover.querySelector('.share-popover-inner').prepend(urlSection);
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

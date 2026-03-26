// toolbar.js — Editor toolbar

import { PLATFORM_DEFAULTS } from '../render/screen.js';

const PRESETS = [
  { label: 'iPhone 16', width: 390, height: 844 },
  { label: 'iPhone 16 Pro Max', width: 430, height: 932 },
  { label: 'iPad', width: 768, height: 1024 },
  { label: 'iPad Pro', width: 1024, height: 1366 },
  { label: 'Desktop', width: 1440, height: 900 },
  { label: 'Desktop Wide', width: 1920, height: 1080 },
];

export function renderToolbar(container, options) {
  const { screen, screenId, onBack, onViewportChange, onUndo, onRedo, onStar, onShare, onZoomFit, onZoomIn, onZoomOut, onZoomReset, undoCount, redoCount, starCount, activeShare } = options;

  const viewport = screen.viewport || PLATFORM_DEFAULTS[screen.platform] || PLATFORM_DEFAULTS.web;
  const currentPreset = PRESETS.find(p => p.width === viewport.width && p.height === viewport.height);

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <button class="toolbar-btn toolbar-back" title="Back to Gallery">\u2190</button>
        <span class="toolbar-label" title="Click to rename">${escapeHtml(screen.label || screenId)}</span>
      </div>
      <div class="toolbar-center">
        <select class="toolbar-viewport-select">
          ${PRESETS.map(p => `<option value="${p.width}x${p.height}" ${p.width === viewport.width && p.height === viewport.height ? 'selected' : ''}>${p.label}</option>`).join('')}
          <option value="custom" ${!currentPreset ? 'selected' : ''}>Custom</option>
        </select>
        <input class="toolbar-dim-input" type="number" value="${viewport.width}" min="100" max="3840" title="Width">
        <span class="toolbar-dim-x">\u00d7</span>
        <input class="toolbar-dim-input" type="number" value="${viewport.height}" min="100" max="3840" title="Height">
      </div>
      <div class="toolbar-right">
        <button class="toolbar-btn toolbar-undo" title="Undo" ${undoCount > 0 ? '' : 'disabled'}>\u21a9</button>
        <button class="toolbar-btn toolbar-redo" title="Redo" ${redoCount > 0 ? '' : 'disabled'}>\u21aa</button>
        <button class="toolbar-btn toolbar-star" title="Star this state">\u2606${starCount > 0 ? ` ${starCount}` : ''}</button>
        <div class="toolbar-separator"></div>
        <button class="toolbar-btn toolbar-zoom-fit" title="Fit to window">Fit</button>
        <button class="toolbar-btn toolbar-zoom-out" title="Zoom out">\u2212</button>
        <button class="toolbar-btn toolbar-zoom-in" title="Zoom in">+</button>
        <button class="toolbar-btn toolbar-zoom-100" title="100%">1:1</button>
        <div class="toolbar-separator"></div>
        <button class="toolbar-btn toolbar-share" title="Share">Share${activeShare?.unseenNotes > 0 ? ` <span class="toolbar-badge">${activeShare.unseenNotes}</span>` : ''}</button>
      </div>
    </div>
  `;

  // Back button
  container.querySelector('.toolbar-back').addEventListener('click', onBack);

  // Label rename — inline input instead of prompt()
  container.querySelector('.toolbar-label').addEventListener('click', (e) => {
    const labelEl = e.target;
    const currentLabel = labelEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentLabel;
    input.className = 'toolbar-label-input';
    input.style.cssText = 'font-size:14px;font-weight:500;padding:2px 6px;border-radius:4px;border:1px solid var(--accent);background:var(--bg-elevated);color:var(--text-primary);font-family:inherit;width:160px;';
    labelEl.replaceWith(input);
    input.focus();
    input.select();
    function commit() {
      const newLabel = input.value.trim();
      const newEl = document.createElement('span');
      newEl.className = 'toolbar-label';
      newEl.textContent = newLabel || currentLabel;
      newEl.title = 'Click to rename';
      input.replaceWith(newEl);
      if (newLabel && newLabel !== currentLabel) {
        onViewportChange({ label: newLabel });
      }
      // Re-attach click handler
      newEl.addEventListener('click', (e2) => container.querySelector('.toolbar-label')?.click());
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { input.value = currentLabel; input.blur(); }
    });
  });

  // Viewport preset select
  container.querySelector('.toolbar-viewport-select').addEventListener('change', (e) => {
    if (e.target.value === 'custom') return;
    const [w, h] = e.target.value.split('x').map(Number);
    container.querySelector('.toolbar-dim-input:first-of-type').value = w;
    container.querySelectorAll('.toolbar-dim-input')[1].value = h;
    onViewportChange({ viewport: { width: w, height: h } });
  });

  // Dimension inputs
  const dimInputs = container.querySelectorAll('.toolbar-dim-input');
  dimInputs.forEach(input => {
    input.addEventListener('change', () => {
      const w = parseInt(dimInputs[0].value) || 390;
      const h = parseInt(dimInputs[1].value) || 844;
      container.querySelector('.toolbar-viewport-select').value = 'custom';
      onViewportChange({ viewport: { width: w, height: h } });
    });
  });

  // Undo/Redo
  container.querySelector('.toolbar-undo').addEventListener('click', onUndo);
  container.querySelector('.toolbar-redo').addEventListener('click', onRedo);

  // Star
  container.querySelector('.toolbar-star').addEventListener('click', onStar);

  // Zoom
  container.querySelector('.toolbar-zoom-fit').addEventListener('click', onZoomFit);
  container.querySelector('.toolbar-zoom-in').addEventListener('click', onZoomIn);
  container.querySelector('.toolbar-zoom-out').addEventListener('click', onZoomOut);
  container.querySelector('.toolbar-zoom-100').addEventListener('click', onZoomReset);

  // Share popover state
  let currentShareState = activeShare || null;
  let sharePopover = null;

  function closeSharePopover() {
    if (sharePopover) {
      sharePopover.remove();
      sharePopover = null;
    }
  }

  function showSharePopover() {
    closeSharePopover();
    const shareBtn = container.querySelector('.toolbar-share');
    if (!shareBtn) return;
    const rect = shareBtn.getBoundingClientRect();

    const popover = document.createElement('div');
    popover.className = 'share-popover';
    popover.style.top = (rect.bottom + 4) + 'px';
    popover.style.right = (window.innerWidth - rect.right) + 'px';

    if (currentShareState) {
      const shareUrl = `http://localhost:42068/viewer/?id=${currentShareState.id}`;
      popover.innerHTML = `
        <div class="share-popover-label">Shared</div>
        <div class="share-popover-url">
          <input type="text" readonly value="${escapeHtml(shareUrl)}">
          <button class="share-popover-copy">Copy</button>
        </div>
        <textarea class="share-popover-note" placeholder="Update the cover note..." rows="3">${escapeHtml(currentShareState.coverNote || '')}</textarea>
        <div class="share-popover-actions">
          <button class="share-popover-update">Update Link</button>
        </div>
      `;

      popover.querySelector('.share-popover-copy').addEventListener('click', () => {
        try {
          navigator.clipboard.writeText(shareUrl);
          const copyBtn = popover.querySelector('.share-popover-copy');
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { if (copyBtn.isConnected) copyBtn.textContent = 'Copy'; }, 2000);
        } catch (e) { /* clipboard may not be available */ }
      });

      popover.querySelector('.share-popover-update').addEventListener('click', () => {
        const coverNote = popover.querySelector('.share-popover-note').value.trim();
        if (onShare) onShare({ action: 'update', coverNote });
      });
    } else {
      popover.innerHTML = `
        <div class="share-popover-label">Share this prototype</div>
        <textarea class="share-popover-note" placeholder="Any context for the reviewer? (optional)" rows="3"></textarea>
        <div class="share-popover-actions">
          <button class="share-popover-create">Create Link</button>
        </div>
      `;

      popover.querySelector('.share-popover-create').addEventListener('click', () => {
        const coverNote = popover.querySelector('.share-popover-note').value.trim();
        if (onShare) onShare({ action: 'create', coverNote });
      });
    }

    document.body.appendChild(popover);
    sharePopover = popover;

    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', function closeOutside(e) {
        if (!popover.contains(e.target) && e.target !== shareBtn) {
          closeSharePopover();
          document.removeEventListener('click', closeOutside);
        }
      });
    }, 0);
  }

  container.querySelector('.toolbar-share').addEventListener('click', () => {
    if (sharePopover) {
      closeSharePopover();
    } else {
      showSharePopover();
    }
  });

  return {
    updateUndoState(undoCount, redoCount) {
      container.querySelector('.toolbar-undo').disabled = undoCount === 0;
      container.querySelector('.toolbar-redo').disabled = redoCount === 0;
    },
    updateStarCount(count) {
      container.querySelector('.toolbar-star').textContent = count > 0 ? `\u2605 ${count}` : '\u2606';
    },
    updateShareState(share) {
      currentShareState = share;
      // If popover is open, re-render it with new state
      if (sharePopover) {
        showSharePopover();
      }
    },
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

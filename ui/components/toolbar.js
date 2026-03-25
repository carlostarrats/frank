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
  const { screen, screenId, onBack, onViewportChange, onUndo, onRedo, onStar, onZoomFit, onZoomIn, onZoomOut, onZoomReset, undoCount, redoCount, starCount } = options;

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
        <button class="toolbar-btn toolbar-share" title="Share" disabled>Share</button>
      </div>
    </div>
  `;

  // Back button
  container.querySelector('.toolbar-back').addEventListener('click', onBack);

  // Label rename
  container.querySelector('.toolbar-label').addEventListener('click', (e) => {
    const newLabel = prompt('Screen name:', screen.label || '');
    if (newLabel?.trim() && newLabel.trim() !== screen.label) {
      e.target.textContent = newLabel.trim();
      onViewportChange({ label: newLabel.trim() });
    }
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

  return {
    updateUndoState(undoCount, redoCount) {
      container.querySelector('.toolbar-undo').disabled = undoCount === 0;
      container.querySelector('.toolbar-redo').disabled = redoCount === 0;
    },
    updateStarCount(count) {
      container.querySelector('.toolbar-star').textContent = count > 0 ? `\u2605 ${count}` : '\u2606';
    },
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

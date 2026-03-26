// gallery.js — Screen thumbnails + flow map

import projectManager from '../core/project.js';
import { renderScreen, PLATFORM_DEFAULTS } from '../render/screen.js';
import { renderFlowMap } from '../components/flow-map.js';

export function renderGallery(container, { onSelectScreen, onAddScreen, onBack }) {
  const screens = projectManager.getAllScreens();
  const project = projectManager.get();

  container.innerHTML = `
    <div class="gallery">
      <div class="gallery-header">
        <button class="gallery-back-btn">\u2190 Projects</button>
        <h2 class="gallery-title">${escapeHtml(project?.label || 'Untitled')}</h2>
      </div>
      <div class="gallery-grid"></div>
      <div class="gallery-flow-map"></div>
    </div>
  `;

  const grid = container.querySelector('.gallery-grid');
  const flowMapContainer = container.querySelector('.gallery-flow-map');

  container.querySelector('.gallery-back-btn').addEventListener('click', onBack);

  // Render thumbnail cards
  renderThumbnailGrid(grid, screens, { onSelectScreen, onAddScreen });

  // Render flow map if there are screens with connections
  renderFlowMap(flowMapContainer, screens, { onSelectScreen });
}

function renderThumbnailGrid(grid, screens, { onSelectScreen, onAddScreen }) {
  const cards = screens.map(screen => {
    const deviceClass = (screen.platform === 'ios' || screen.platform === 'android') ? 'mobile'
      : screen.platform === 'tablet' ? 'tablet'
      : screen.platform === 'web' ? 'web'
      : 'mobile';
    const viewport = screen.viewport || PLATFORM_DEFAULTS[deviceClass] || PLATFORM_DEFAULTS.web;
    const isMobile = deviceClass === 'mobile';
    const thumbWidth = isMobile ? 140 : 280;
    const thumbHeight = isMobile ? 240 : 180;
    const scale = thumbWidth / viewport.width;

    return `
      <div class="gallery-card" data-screen-id="${escapeAttr(screen.id)}">
        <div class="gallery-thumb" style="width:${thumbWidth}px;height:${thumbHeight}px;">
          <div class="gallery-thumb-content" data-screen-id="${escapeAttr(screen.id)}"
               style="width:${viewport.width}px;transform:scale(${scale});transform-origin:top left;">
          </div>
        </div>
        <div class="gallery-card-info">
          <span class="gallery-card-label">${escapeHtml(screen.label || screen.id)}</span>
          <span class="gallery-card-platform">${escapeHtml(screen.platform || 'web')}</span>
        </div>
      </div>
    `;
  }).join('');

  const addCard = `
    <div class="gallery-card gallery-card--add">
      <div class="gallery-thumb gallery-thumb--add" style="width:280px;height:180px;">
        <span class="gallery-add-icon">+</span>
      </div>
      <div class="gallery-card-info">
        <span class="gallery-card-label">New Screen</span>
      </div>
    </div>
  `;

  grid.innerHTML = cards + addCard;

  // Lazy render thumbnails with IntersectionObserver
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const thumbContent = entry.target;
        const screenId = thumbContent.dataset.screenId;
        const screen = screens.find(s => s.id === screenId);
        if (screen && !thumbContent.dataset.rendered) {
          thumbContent.innerHTML = renderScreen(screen);
          thumbContent.dataset.rendered = 'true';
        }
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  grid.querySelectorAll('.gallery-thumb-content[data-screen-id]').forEach(el => {
    observer.observe(el);
  });

  // Click handlers
  grid.querySelectorAll('.gallery-card[data-screen-id]').forEach(card => {
    card.addEventListener('click', () => onSelectScreen(card.dataset.screenId));
  });

  grid.querySelector('.gallery-card--add')?.addEventListener('click', () => {
    const addCard = grid.querySelector('.gallery-card--add');
    const thumb = addCard.querySelector('.gallery-thumb--add');
    thumb.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;padding:16px;width:100%;">
        <input class="add-screen-input" type="text" placeholder="Screen name..." autofocus
          style="padding:8px;border-radius:4px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-primary);font-size:13px;font-family:inherit;width:100%;">
        <div style="display:flex;gap:4px;">
          <button class="add-screen-confirm" style="flex:1;padding:6px;border-radius:4px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;font-size:12px;font-family:inherit;">Create</button>
          <button class="add-screen-cancel" style="padding:6px 10px;border-radius:4px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-secondary);cursor:pointer;font-size:12px;font-family:inherit;">Cancel</button>
        </div>
      </div>
    `;
    const input = thumb.querySelector('.add-screen-input');
    input.focus();
    function submit() {
      const label = input.value.trim();
      if (label) onAddScreen(label);
    }
    thumb.querySelector('.add-screen-confirm').addEventListener('click', submit);
    thumb.querySelector('.add-screen-cancel').addEventListener('click', () => {
      thumb.innerHTML = '<span class="gallery-add-icon">+</span>';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') thumb.innerHTML = '<span class="gallery-add-icon">+</span>';
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

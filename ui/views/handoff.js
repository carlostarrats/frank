// handoff.js — Handoff view: read-only overview of entire project for code handoff

import projectManager from '../core/project.js';
import { renderScreen, PLATFORM_DEFAULTS } from '../render/screen.js';
import { renderFlowMap } from '../components/flow-map.js';

export function renderHandoff(container, { onBack, onSelectScreen }) {
  const project = projectManager.get();
  const screens = projectManager.getAllScreens();

  // Compute summary stats
  const totalScreens = screens.length;
  const totalNotes = screens.reduce((sum, s) => sum + (s.notes?.length || 0), 0);
  const pendingNotes = screens.reduce((sum, s) => sum + (s.notes || []).filter(n => !n.status).length, 0);
  const approvedNotes = screens.reduce((sum, s) => sum + (s.notes || []).filter(n => n.status === 'approved').length, 0);
  const dismissedNotes = screens.reduce((sum, s) => sum + (s.notes || []).filter(n => n.status === 'dismissed').length, 0);

  // Count connections
  let totalConnections = 0;
  const undefinedConnections = [];
  screens.forEach(screen => {
    if (screen.connections) {
      const connCount = Object.keys(screen.connections).length;
      totalConnections += connCount;
      Object.entries(screen.connections).forEach(([key, targetId]) => {
        if (!screens.find(s => s.id === targetId)) {
          undefinedConnections.push({ from: screen.label || screen.id, key, targetId });
        }
      });
    }
  });

  const screensWithPendingNotes = screens.filter(s => (s.notes || []).some(n => !n.status)).length;

  container.innerHTML = `
    <div class="handoff">
      <div class="handoff-header">
        <div class="handoff-header-left">
          <button class="handoff-back-btn">&larr; Gallery</button>
          <h2 class="handoff-title">${escapeHtml(project?.label || 'Untitled')} &mdash; Handoff</h2>
        </div>
      </div>

      <div class="handoff-summary">
        <span class="handoff-stat"><strong>${totalScreens}</strong> screen${totalScreens !== 1 ? 's' : ''}</span>
        ${pendingNotes > 0 ? `<span class="handoff-stat"><strong>${screensWithPendingNotes}</strong> with unresolved notes</span>` : ''}
        ${totalConnections > 0 ? `<span class="handoff-stat"><strong>${totalConnections}</strong> connection${totalConnections !== 1 ? 's' : ''}</span>` : ''}
        ${undefinedConnections.length > 0 ? `<span class="handoff-stat" style="color:var(--danger)"><strong>${undefinedConnections.length}</strong> undefined connection${undefinedConnections.length !== 1 ? 's' : ''}</span>` : ''}
        ${approvedNotes > 0 ? `<span class="handoff-stat" style="color:var(--success)"><strong>${approvedNotes}</strong> approved</span>` : ''}
        ${dismissedNotes > 0 ? `<span class="handoff-stat"><strong>${dismissedNotes}</strong> dismissed</span>` : ''}
      </div>

      <div class="handoff-flow-map">
        <div class="handoff-flow-label">Flow Map</div>
        <div class="handoff-flow-map-content"></div>
      </div>

      <div class="handoff-screens"></div>
    </div>
  `;

  // Back button
  container.querySelector('.handoff-back-btn').addEventListener('click', onBack);

  // Render flow map
  const flowMapContent = container.querySelector('.handoff-flow-map-content');
  renderFlowMap(flowMapContent, screens, { onSelectScreen });

  // If no connections exist, hide flow map section
  if (totalConnections === 0) {
    container.querySelector('.handoff-flow-map').style.display = 'none';
  }

  // Render screen cards
  const screensGrid = container.querySelector('.handoff-screens');
  renderScreenCards(screensGrid, screens, { onSelectScreen });
}

function renderScreenCards(grid, screens, { onSelectScreen }) {
  grid.innerHTML = screens.map(screen => {
    const deviceClass = (screen.platform === 'ios' || screen.platform === 'android') ? 'mobile'
      : screen.platform === 'tablet' ? 'tablet'
      : screen.platform === 'web' ? 'web'
      : 'mobile';
    const viewport = screen.viewport || PLATFORM_DEFAULTS[deviceClass] || PLATFORM_DEFAULTS.web;
    const thumbWidth = 340;
    const scale = thumbWidth / viewport.width;

    const notes = screen.notes || [];
    const pending = notes.filter(n => !n.status);
    const approved = notes.filter(n => n.status === 'approved');
    const dismissed = notes.filter(n => n.status === 'dismissed');
    const sectionCount = (screen.sections || []).length;
    const connCount = screen.connections ? Object.keys(screen.connections).length : 0;

    const notesSummary = [];
    if (pending.length > 0) notesSummary.push(`${pending.length} pending`);
    if (approved.length > 0) notesSummary.push(`${approved.length} approved`);
    if (dismissed.length > 0) notesSummary.push(`${dismissed.length} dismissed`);

    return `
      <div class="handoff-screen-card" data-screen-id="${escapeAttr(screen.id)}">
        <div class="handoff-screen-thumb" style="height:200px;">
          <div class="handoff-screen-thumb-content" data-screen-id="${escapeAttr(screen.id)}"
               style="width:${viewport.width}px;transform:scale(${scale});transform-origin:top left;">
          </div>
        </div>
        <div class="handoff-screen-info">
          <div class="handoff-screen-label">${escapeHtml(screen.label || screen.id)}</div>
          <div class="handoff-screen-meta">
            <span>${escapeHtml(screen.platform || 'web')}</span>
            <span>${sectionCount} section${sectionCount !== 1 ? 's' : ''}</span>
            ${connCount > 0 ? `<span>${connCount} connection${connCount !== 1 ? 's' : ''}</span>` : ''}
            ${notesSummary.length > 0 ? `<span>${notesSummary.join(', ')}</span>` : ''}
          </div>
          ${screen.context ? `<div class="handoff-screen-context">${escapeHtml(screen.context)}</div>` : ''}
          ${notes.length > 0 ? `
            <div class="handoff-screen-notes">
              ${notes.slice(0, 3).map(note => `
                <div class="handoff-note">
                  <span class="handoff-note-status handoff-note-status--${note.status || 'pending'}"></span>
                  <span class="handoff-note-text">${escapeHtml(note.text || '')}</span>
                </div>
              `).join('')}
              ${notes.length > 3 ? `<div class="handoff-note"><span class="handoff-note-text" style="color:var(--text-muted)">+${notes.length - 3} more</span></div>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Lazy render thumbnails
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

  grid.querySelectorAll('.handoff-screen-thumb-content[data-screen-id]').forEach(el => {
    observer.observe(el);
  });

  // Click handlers
  grid.querySelectorAll('.handoff-screen-card[data-screen-id]').forEach(card => {
    card.addEventListener('click', () => onSelectScreen(card.dataset.screenId));
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

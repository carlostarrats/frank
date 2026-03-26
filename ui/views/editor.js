// editor.js — Single screen editor

import { createCanvas } from '../components/canvas.js';
import { renderScreen } from '../render/screen.js';
import { renderToolbar } from '../components/toolbar.js';
import { renderComments } from '../components/comments.js';
import projectManager from '../core/project.js';
import undoManager from '../core/undo.js';
import starsManager from '../core/stars.js';

let currentCanvas = null;
let currentToolbar = null;
let selectedSection = null; // null = show all, number = section index

export function renderEditor(container, { screenId, onBack }) {
  const screen = projectManager.getScreen(screenId);
  if (!screen) { onBack(); return; }

  container.innerHTML = `
    <div class="editor">
      <div class="editor-toolbar"></div>
      <div class="editor-body">
        <div class="editor-canvas-area"></div>
        <div class="editor-comments"></div>
      </div>
      <div class="editor-status">Auto-saved · ${Object.keys(projectManager.get()?.screens || {}).length} screens</div>
    </div>
  `;

  // Canvas
  const canvasArea = container.querySelector('.editor-canvas-area');
  currentCanvas = createCanvas(canvasArea);
  currentCanvas.setContent(renderScreen(screen));
  selectedSection = null; // reset on each render
  setupDragHandles(screenId);

  // Toolbar
  const toolbarEl = container.querySelector('.editor-toolbar');
  currentToolbar = renderToolbar(toolbarEl, {
    screen,
    screenId,
    onBack,
    onViewportChange: (updates) => {
      projectManager.updateScreen(screenId, updates);
      const updated = projectManager.getScreen(screenId);
      currentCanvas.setContent(renderScreen(updated));
      setupDragHandles(screenId);
    },
    onUndo: () => {
      const screen = projectManager.getScreen(screenId);
      const restored = undoManager.undo(screenId, screen.sections);
      if (restored) {
        projectManager.updateScreen(screenId, { sections: restored });
        currentCanvas.setContent(renderScreen(projectManager.getScreen(screenId)));
        currentToolbar.updateUndoState(undoManager.undoCount(screenId), undoManager.redoCount(screenId));
        setupDragHandles(screenId);
      }
    },
    onRedo: () => {
      const screen = projectManager.getScreen(screenId);
      const restored = undoManager.redo(screenId, screen.sections);
      if (restored) {
        projectManager.updateScreen(screenId, { sections: restored });
        currentCanvas.setContent(renderScreen(projectManager.getScreen(screenId)));
        currentToolbar.updateUndoState(undoManager.undoCount(screenId), undoManager.redoCount(screenId));
        setupDragHandles(screenId);
      }
    },
    onStar: () => {
      const stars = starsManager.list(screenId);
      if (stars.length === 0) {
        // No stars — create one
        starsManager.star(screenId);
        currentToolbar.updateStarCount(starsManager.count(screenId));
        return;
      }
      // Stars exist — show dropdown to create new or restore
      showStarDropdown(screenId);
    },
    onZoomFit: () => currentCanvas.fitToWindow(),
    onZoomIn: () => currentCanvas.zoomIn(),
    onZoomOut: () => currentCanvas.zoomOut(),
    onZoomReset: () => currentCanvas.zoomReset(),
    undoCount: undoManager.undoCount(screenId),
    redoCount: undoManager.redoCount(screenId),
    starCount: screen.stars?.length || 0,
  });

  // Comments panel
  const commentsEl = container.querySelector('.editor-comments');

  function refreshComments() {
    const currentScreen = projectManager.getScreen(screenId);
    renderComments(commentsEl, {
      screen: currentScreen,
      screenId,
      selectedSection,
      authorName: 'You',
      onClearSection: () => {
        const canvasContent = currentCanvas.content;
        canvasContent.querySelectorAll('[data-section-index]').forEach(s => s.classList.remove('section-selected'));
        selectedSection = null;
        refreshComments();
      },
      onApprove: (index) => {
        const notes = [...(currentScreen.notes || [])];
        if (notes[index]) {
          notes[index] = { ...notes[index], status: 'approved' };
          projectManager.updateScreen(screenId, { notes });
          refreshComments();
          updateStatus();
        }
      },
      onDismiss: (index) => {
        const notes = [...(currentScreen.notes || [])];
        if (notes[index]) {
          notes[index] = { ...notes[index], status: 'dismissed' };
          projectManager.updateScreen(screenId, { notes });
          refreshComments();
          updateStatus();
        }
      },
      onAddNote: (note) => {
        const notes = [...(currentScreen.notes || []), note];
        projectManager.updateScreen(screenId, { notes });
        refreshComments();
        updateStatus();
      },
    });
  }

  refreshComments();
  setupSectionSelection(screenId, refreshComments);

  // Update status
  function updateStatus() {
    const statusEl = container.querySelector('.editor-status');
    const currentScreen = projectManager.getScreen(screenId);
    const screenCount = Object.keys(projectManager.get()?.screens || {}).length;
    const noteCount = (currentScreen.notes || []).filter(n => !n.status).length;
    statusEl.textContent = `Auto-saved · ${screenCount} screen${screenCount !== 1 ? 's' : ''}${noteCount > 0 ? ` · ${noteCount} note${noteCount !== 1 ? 's' : ''} pending` : ''}`;
  }
  updateStatus();
}

// Star dropdown
function showStarDropdown(screenId) {
  // Remove existing dropdown
  document.querySelector('.star-dropdown')?.remove();

  const stars = starsManager.list(screenId);
  const starBtn = document.querySelector('.toolbar-star');
  if (!starBtn) return;

  const rect = starBtn.getBoundingClientRect();
  const dropdown = document.createElement('div');
  dropdown.className = 'star-dropdown';
  dropdown.style.cssText = `position:fixed;top:${rect.bottom + 4}px;right:${window.innerWidth - rect.right}px;z-index:100;`;

  dropdown.innerHTML = `
    <div class="star-dropdown-inner">
      <button class="star-dropdown-new">+ New Star</button>
      <div class="star-dropdown-divider"></div>
      ${stars.map((s, i) => `
        <div class="star-dropdown-item" data-index="${i}">
          <div class="star-dropdown-item-info">
            <span class="star-dropdown-item-label">${escapeHtml(s.label)}</span>
            <span class="star-dropdown-item-date">${new Date(s.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          </div>
          <div class="star-dropdown-item-actions">
            <button class="star-restore" data-index="${i}" title="Restore">&#8617;</button>
            <button class="star-delete" data-index="${i}" title="Delete">&times;</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  document.body.appendChild(dropdown);

  // New star
  dropdown.querySelector('.star-dropdown-new').addEventListener('click', () => {
    starsManager.star(screenId);
    currentToolbar.updateStarCount(starsManager.count(screenId));
    dropdown.remove();
  });

  // Restore
  dropdown.querySelectorAll('.star-restore').forEach(btn => {
    btn.addEventListener('click', () => {
      starsManager.restore(screenId, parseInt(btn.dataset.index));
      currentCanvas.setContent(renderScreen(projectManager.getScreen(screenId)));
      setupDragHandles(screenId);
      currentToolbar.updateUndoState(undoManager.undoCount(screenId), undoManager.redoCount(screenId));
      dropdown.remove();
    });
  });

  // Delete
  dropdown.querySelectorAll('.star-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      starsManager.remove(screenId, parseInt(btn.dataset.index));
      currentToolbar.updateStarCount(starsManager.count(screenId));
      dropdown.remove();
    });
  });

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!dropdown.contains(e.target) && e.target !== starBtn) {
        dropdown.remove();
        document.removeEventListener('click', close);
      }
    });
  }, 0);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Section selection for comment anchoring
function setupSectionSelection(screenId, onSelectionChange) {
  const canvasContent = currentCanvas.content;
  const sectionEls = canvasContent.querySelectorAll('[data-section-index]');

  sectionEls.forEach((section) => {
    const sectionIndex = parseInt(section.dataset.sectionIndex);
    section.style.cursor = 'pointer';

    section.addEventListener('click', (e) => {
      // Don't select if clicking a drag handle
      if (e.target.closest('.drag-handle')) return;
      e.stopPropagation();

      // Deselect all
      sectionEls.forEach(s => s.classList.remove('section-selected'));
      // Select this one
      section.classList.add('section-selected');
      selectedSection = sectionIndex;
      onSelectionChange();
    });
  });

  // Click canvas background to deselect
  const canvasEl = canvasContent.closest('.canvas') || canvasContent.parentElement;
  if (canvasEl) {
    canvasEl.addEventListener('click', (e) => {
      if (!e.target.closest('[data-section-index]')) {
        sectionEls.forEach(s => s.classList.remove('section-selected'));
        selectedSection = null;
        onSelectionChange();
      }
    });
  }
}

// Drag-to-reorder sections
let isDragging = false;
let dragIndex = -1;
let dropIndex = -1;
let dropIndicator = null;

function setupDragHandles(screenId) {
  const canvasContent = currentCanvas.content;
  const sections = canvasContent.querySelectorAll('.wf-section');

  sections.forEach((section, index) => {
    const handle = document.createElement('div');
    handle.className = 'drag-handle';
    handle.innerHTML = '⠿';
    handle.style.cssText = 'position:absolute;left:-24px;top:50%;transform:translateY(-50%);cursor:grab;color:var(--text-muted);font-size:14px;opacity:0;transition:opacity 0.15s;z-index:10;padding:4px;';

    section.style.position = 'relative';
    section.appendChild(handle);

    section.addEventListener('mouseenter', () => handle.style.opacity = '1');
    section.addEventListener('mouseleave', () => { if (!isDragging) handle.style.opacity = '0'; });

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      startDrag(screenId, index, e, sections);
    });
  });
}

function startDrag(screenId, index, startEvent, sections) {
  isDragging = true;
  dragIndex = index;
  const scale = currentCanvas.getScale();

  // Create drop indicator
  dropIndicator = document.createElement('div');
  dropIndicator.className = 'drop-indicator';
  dropIndicator.style.cssText = 'height:2px;background:var(--accent);position:absolute;left:0;right:0;z-index:20;display:none;pointer-events:none;';
  sections[0]?.parentElement?.appendChild(dropIndicator);

  sections[dragIndex]?.classList.add('dragging');

  function onMove(e) {
    const mouseY = e.clientY / scale;
    let newDropIndex = sections.length;

    for (let i = 0; i < sections.length; i++) {
      const rect = sections[i].getBoundingClientRect();
      const midY = (rect.top + rect.height / 2) / scale;
      if (mouseY < midY) {
        newDropIndex = i;
        break;
      }
    }

    dropIndex = newDropIndex;

    // Position drop indicator
    if (dropIndicator) {
      dropIndicator.style.display = 'block';
      if (newDropIndex < sections.length) {
        const rect = sections[newDropIndex].getBoundingClientRect();
        dropIndicator.style.top = (rect.top / scale - 1) + 'px';
      } else {
        const rect = sections[sections.length - 1].getBoundingClientRect();
        dropIndicator.style.top = ((rect.top + rect.height) / scale + 1) + 'px';
      }
    }
  }

  function onUp() {
    isDragging = false;
    sections[dragIndex]?.classList.remove('dragging');
    dropIndicator?.remove();
    dropIndicator = null;

    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);

    if (dropIndex !== -1 && dropIndex !== dragIndex && dropIndex !== dragIndex + 1) {
      const screen = projectManager.getScreen(screenId);
      const oldSections = [...screen.sections];
      undoManager.push(screenId, oldSections);

      const newSections = [...oldSections];
      const [moved] = newSections.splice(dragIndex, 1);
      const insertAt = dropIndex > dragIndex ? dropIndex - 1 : dropIndex;
      newSections.splice(insertAt, 0, moved);

      projectManager.updateScreen(screenId, { sections: newSections });
      currentCanvas.setContent(renderScreen(projectManager.getScreen(screenId)));
      currentToolbar.updateUndoState(undoManager.undoCount(screenId), undoManager.redoCount(screenId));
      setupDragHandles(screenId);
    }
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

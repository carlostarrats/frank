// editor.js — Single screen editor

import { createCanvas } from '../components/canvas.js';
import { renderScreen } from '../render/screen.js';
import { renderToolbar } from '../components/toolbar.js';
import { renderComments } from '../components/comments.js';
import projectManager from '../core/project.js';
import undoManager from '../core/undo.js';

let currentCanvas = null;
let currentToolbar = null;

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
    onStar: () => { /* Task 12 */ },
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
      authorName: 'You',
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

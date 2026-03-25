// editor.js — Single screen editor

import { createCanvas } from '../components/canvas.js';
import { renderScreen } from '../render/screen.js';
import { renderToolbar } from '../components/toolbar.js';
import { renderComments } from '../components/comments.js';
import projectManager from '../core/project.js';

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
    },
    onUndo: () => { /* Task 11 */ },
    onRedo: () => { /* Task 11 */ },
    onStar: () => { /* Task 12 */ },
    onZoomFit: () => currentCanvas.fitToWindow(),
    onZoomIn: () => currentCanvas.zoomIn(),
    onZoomOut: () => currentCanvas.zoomOut(),
    onZoomReset: () => currentCanvas.zoomReset(),
    undoCount: 0,
    redoCount: 0,
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

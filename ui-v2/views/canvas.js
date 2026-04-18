// canvas.js (view) — The canvas entry point. Mounts a Konva stage, wires tool
// palette and selection, persists canvas state through the daemon.

import sync from '../core/sync.js';
import projectManager from '../core/project.js';
import { createStage } from '../canvas/stage.js';
import { createToolController } from '../canvas/tools.js';
import { createSelection } from '../canvas/transformer.js';
import { serializeContent, deserializeInto } from '../canvas/serialize.js';

const TOOLS = [
  { id: 'select',    label: 'Select',    icon: '↖' },
  { id: 'rectangle', label: 'Rectangle', icon: '▭' },
  { id: 'sticky',    label: 'Sticky',    icon: '◪' },
  { id: 'text',      label: 'Text',      icon: 'T' },
  { id: 'freehand',  label: 'Pen',       icon: '✎' },
  { id: 'arrow',     label: 'Arrow',     icon: '→' },
];

const SAVE_DEBOUNCE_MS = 500;

export function renderCanvas(container, { onBack }) {
  const project = projectManager.get();
  if (!project) { onBack(); return; }

  container.innerHTML = `
    <div class="canvas-toolbar">
      <button class="btn-ghost canvas-back" title="Back">←</button>
      <div class="canvas-title">${escapeHtml(project.name)}</div>
      <div class="canvas-tools" id="canvas-tools"></div>
      <div class="canvas-zoom" id="canvas-zoom"></div>
    </div>
    <div class="canvas-stage" id="canvas-stage"></div>
  `;

  container.querySelector('.canvas-back').addEventListener('click', onBack);

  const toolsEl = container.querySelector('#canvas-tools');
  toolsEl.innerHTML = TOOLS.map((t) => `
    <button class="canvas-tool" data-tool="${t.id}" title="${t.label}">
      <span class="canvas-tool-icon">${t.icon}</span>
      <span class="canvas-tool-label">${t.label}</span>
    </button>
  `).join('');

  const stageEl = container.querySelector('#canvas-stage');
  const { stage, contentLayer, uiLayer, destroy: destroyStage, isPanning, resetView } = createStage(stageEl);

  const selection = createSelection({
    stage,
    contentLayer,
    uiLayer,
    getTool: () => tools.getTool(),
  });

  let saveTimer = null;
  const commitChange = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const json = serializeContent(contentLayer);
      sync.saveCanvasState(json).catch((err) => {
        console.warn('[canvas] save failed:', err);
      });
    }, SAVE_DEBOUNCE_MS);
  };

  const tools = createToolController({
    stage,
    contentLayer,
    isPanning,
    onCommit: commitChange,
  });

  // Tool button wiring
  toolsEl.querySelectorAll('.canvas-tool').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tool;
      tools.activate(t);
      selection.clear();
      toolsEl.querySelectorAll('.canvas-tool').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });
  toolsEl.querySelector('.canvas-tool[data-tool="select"]').classList.add('active');

  // Drag-end on any shape → save
  stage.on('dragend', commitChange);
  // Transformer end → save (resize/rotate)
  stage.on('transformend', commitChange);

  // Zoom display
  const zoomEl = container.querySelector('#canvas-zoom');
  const updateZoom = () => {
    zoomEl.innerHTML = `
      <button class="btn-ghost canvas-zoom-reset" title="Reset view">${Math.round(stage.scaleX() * 100)}%</button>
    `;
    zoomEl.querySelector('.canvas-zoom-reset').addEventListener('click', () => {
      resetView();
      updateZoom();
    });
  };
  updateZoom();
  stage.on('wheel', () => updateZoom());

  // Load persisted state
  sync.loadCanvasState().then((msg) => {
    if (msg && msg.state) {
      try {
        deserializeInto(contentLayer, msg.state);
      } catch (err) {
        console.warn('[canvas] could not restore state:', err);
      }
    }
  });

  // Cleanup when leaving the view
  const viewEl = container.closest('.view');
  const observer = new MutationObserver(() => {
    if (!viewEl.classList.contains('active')) {
      selection.destroy();
      destroyStage();
      if (saveTimer) clearTimeout(saveTimer);
      observer.disconnect();
    }
  });
  if (viewEl) observer.observe(viewEl, { attributes: true, attributeFilter: ['class'] });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

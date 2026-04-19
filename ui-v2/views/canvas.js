// canvas.js (view) — Whiteboard surface.
//
// Layout:
//   ┌──────────────────────────────────────────────────────────────┐
//   │  top bar: back, title, zoom                                  │
//   ├──────┬────────────────────────────────────────┬──────────────┤
//   │  L   │                                        │      R       │
//   │ drw. │  Konva stage                           │  inspector   │
//   │      │                                        │              │
//   └──────┴────────────────────────────────────────┴──────────────┘
//
// The left drawer is categorized (Basic / Shapes / Flowchart / Decorative /
// Templates). The right inspector binds to the current selection; when nothing
// is selected, it shows a hint. Both sidebars use the shadcn tokens and
// primitives; no new CSS framework.

import sync from '../core/sync.js';
import projectManager from '../core/project.js';
import { createStage } from '../canvas/stage.js';
import { createToolController } from '../canvas/tools.js';
import { createSelection } from '../canvas/transformer.js';
import { serializeContent, deserializeInto } from '../canvas/serialize.js';
import { createInspector } from '../canvas/properties.js';
import { TEMPLATES } from '../canvas/templates.js';

const SAVE_DEBOUNCE_MS = 500;

// Unicode cloud (☁) and speech (💬) render as full-color emoji on macOS,
// which breaks visual parity with the outline glyphs used elsewhere in the
// drawer. Small inline SVGs at the same weight (stroke 1.5, 14×14) give
// us clean monochrome outlines.
const CLOUD_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18h10a3.5 3.5 0 0 0 0-7 4.5 4.5 0 0 0-8.82-1.1A3 3 0 0 0 7 18z"/></svg>`;

const SPEECH_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v10H10l-5 4v-4H4z"/></svg>`;

const TOOL_SECTIONS = [
  {
    id: 'basic', label: 'Basic',
    tools: [
      { id: 'select',    label: 'Select',    icon: '↖' },
      { id: 'text',      label: 'Text',      icon: 'T' },
      { id: 'sticky',    label: 'Sticky',    icon: '◪' },
      { id: 'freehand',  label: 'Pen',       icon: '✎' },
    ],
  },
  {
    id: 'shapes', label: 'Shapes',
    tools: [
      // Rectangle doubles as Square — hold Shift while dragging to lock to
      // 1:1 and get a perfect square. Circle is the same: Ellipse with
      // equal radii; Shift locks it as a perfect circle during drag.
      { id: 'rectangle', label: 'Rectangle', icon: '▭' },
      { id: 'circle',    label: 'Circle',    icon: '○' },
      { id: 'triangle',  label: 'Triangle',  icon: '△' },
      { id: 'diamond',   label: 'Diamond',   icon: '◇' },
      { id: 'hexagon',   label: 'Hexagon',   icon: '⬡' },
      { id: 'star',      label: 'Star',      icon: '☆' },
    ],
  },
  {
    id: 'flowchart', label: 'Flowchart',
    tools: [
      { id: 'parallelogram', label: 'Parallelogram', icon: '▱' },
      { id: 'document',      label: 'Document',      icon: '⬒' },
      { id: 'cylinder',      label: 'Cylinder',      icon: '⏣' },
      { id: 'arrow',         label: 'Arrow',         icon: '→' },
      { id: 'elbow',         label: 'Elbow',         icon: '⌐' },
    ],
  },
  {
    id: 'decorative', label: 'Decorative',
    tools: [
      { id: 'cloud',  label: 'Cloud',         icon: CLOUD_ICON },
      { id: 'speech', label: 'Speech bubble', icon: SPEECH_ICON },
    ],
  },
];

export function renderCanvas(container, { onBack }) {
  const project = projectManager.get();
  if (!project) { onBack(); return; }

  container.innerHTML = `
    <div class="canvas-view">
      <div class="canvas-topbar">
        <button class="btn-ghost canvas-back" title="Back">←</button>
        <div class="canvas-title">${escapeHtml(project.name)}</div>
        <div class="canvas-topbar-spacer"></div>
        <div class="canvas-zoom" id="canvas-zoom"></div>
      </div>
      <div class="canvas-body">
        <aside class="canvas-drawer" id="canvas-drawer"></aside>
        <div class="canvas-stage" id="canvas-stage"></div>
        <aside class="canvas-inspector-host" id="canvas-inspector-host"></aside>
      </div>
    </div>
  `;

  container.querySelector('.canvas-back').addEventListener('click', onBack);

  const stageEl = container.querySelector('#canvas-stage');
  const drawerEl = container.querySelector('#canvas-drawer');
  const inspectorHost = container.querySelector('#canvas-inspector-host');

  const { stage, contentLayer, uiLayer, destroy: destroyStage, isPanning, resetView } = createStage(stageEl);

  let saveTimer = null;
  const commitChange = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const json = serializeContent(contentLayer);
      sync.saveCanvasState(json).catch((err) => console.warn('[canvas] save failed:', err));
    }, SAVE_DEBOUNCE_MS);
  };

  const inspector = createInspector({
    host: inspectorHost,
    onChange: commitChange,
  });

  const selection = createSelection({
    stage,
    contentLayer,
    uiLayer,
    getTool: () => tools.getTool(),
    onChange: (nodes) => {
      inspector.setSelection(nodes);
      // Collapse the inspector sidebar when nothing's selected; expand when
      // there's something to edit. Matches the AI-panel show/hide pattern.
      inspectorHost.classList.toggle('open', nodes.length > 0);
    },
    onCommit: commitChange,
  });

  const tools = createToolController({
    stage,
    contentLayer,
    uiLayer,
    isPanning,
    onCommit: commitChange,
    // Context-aware tool behavior: if the user clicks on an existing shape
    // while a creation tool is active, switch back to Select and pick that
    // shape. Matches the Figma/Miro pattern.
    onShapeClick: (shape) => {
      tools.activate('select');
      markActiveTool(drawerEl, 'select');
      selection.setSelection([shape]);
    },
  });

  renderDrawer(drawerEl, {
    onTool: (id) => {
      tools.activate(id);
      selection.clear();
      markActiveTool(drawerEl, id);
    },
    onTemplate: (insert) => {
      const group = insert(contentLayer);
      contentLayer.batchDraw();
      selection.setSelection([group]);
      commitChange();
    },
  });
  markActiveTool(drawerEl, 'select');

  stage.on('dragend', commitChange);
  stage.on('transformend', commitChange);

  const zoomEl = container.querySelector('#canvas-zoom');
  const updateZoom = () => {
    zoomEl.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'btn-ghost canvas-zoom-reset';
    btn.title = 'Reset view';
    btn.textContent = `${Math.round(stage.scaleX() * 100)}%`;
    btn.addEventListener('click', () => { resetView(); updateZoom(); });
    zoomEl.appendChild(btn);
  };
  updateZoom();
  stage.on('wheel', () => updateZoom());

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

function renderDrawer(host, { onTool, onTemplate }) {
  host.innerHTML = '';
  for (const section of TOOL_SECTIONS) {
    const header = document.createElement('div');
    header.className = 'canvas-drawer-section-title';
    header.textContent = section.label;
    host.appendChild(header);

    const list = document.createElement('div');
    list.className = 'canvas-drawer-tools';
    for (const t of section.tools) {
      const btn = document.createElement('button');
      btn.className = 'canvas-drawer-tool';
      btn.dataset.tool = t.id;
      btn.title = t.label;
      btn.innerHTML = `
        <span class="canvas-drawer-tool-icon">${t.icon}</span>
        <span class="canvas-drawer-tool-label">${t.label}</span>
      `;
      btn.addEventListener('click', () => onTool(t.id));
      list.appendChild(btn);
    }
    host.appendChild(list);
  }

  // Templates section
  const header = document.createElement('div');
  header.className = 'canvas-drawer-section-title';
  header.textContent = 'Templates';
  host.appendChild(header);

  const templatesList = document.createElement('div');
  templatesList.className = 'canvas-drawer-templates';
  for (const tpl of TEMPLATES) {
    const btn = document.createElement('button');
    btn.className = 'canvas-drawer-template';
    btn.textContent = tpl.label;
    btn.addEventListener('click', () => onTemplate(tpl.insert));
    templatesList.appendChild(btn);
  }
  host.appendChild(templatesList);
}

function markActiveTool(drawerEl, toolId) {
  drawerEl.querySelectorAll('.canvas-drawer-tool').forEach((el) => {
    el.classList.toggle('active', el.dataset.tool === toolId);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

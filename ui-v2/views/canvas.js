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
import { attachImageDrop } from '../canvas/image.js';
import { createCommentController, CANVAS_SCREEN_ID } from '../canvas/comments.js';
import { renderCuration } from '../components/curation.js';
import { showSharePopover, updateSharePopover } from '../components/share-popover.js';
import { attachShortcuts } from '../canvas/shortcuts.js';
import { createHistory } from '../canvas/history.js';
import { exportPng, exportPdf, exportSvg, exportJson } from '../canvas/export.js';
import { toastError, toastInfo } from '../components/toast.js';
import { iconCommentPlus, iconCamera, iconLink, iconDownload, iconUndo, iconTimeline, syncToolbarLiveBadge } from '../components/toolbar.js';

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
        <button class="btn-ghost canvas-icon-btn canvas-undo-btn" id="canvas-undo-btn" title="Undo (⌘Z)" aria-label="Undo" disabled>${iconUndo()}</button>
        <button class="btn-ghost canvas-icon-btn canvas-comment-toggle" id="canvas-comment-toggle" title="Comment on shape" aria-label="Toggle comment mode">${iconCommentPlus()}</button>
        <button class="btn-ghost canvas-icon-btn" id="canvas-timeline-btn" title="Timeline" aria-label="Timeline">${iconTimeline()}</button>
        <button class="btn-ghost canvas-icon-btn canvas-snapshot-btn" id="canvas-snapshot-btn" title="Take snapshot" aria-label="Take snapshot">${iconCamera()}</button>
        <button class="btn-ghost canvas-icon-btn canvas-share-btn" id="canvas-share-btn" data-frank-share-btn data-project-id="${project.id}" title="Share canvas" aria-label="Share canvas">${iconLink()}</button>
        <div class="canvas-export-wrapper">
          <button class="btn-ghost canvas-icon-btn canvas-export-btn" id="canvas-export-btn" title="Export" aria-label="Export">${iconDownload()}</button>
          <div class="canvas-export-menu" id="canvas-export-menu" hidden>
            <button data-format="png" class="canvas-export-item">Export PNG</button>
            <button data-format="svg" class="canvas-export-item">Export SVG (vector)</button>
            <button data-format="pdf" class="canvas-export-item">Export PDF (vector)</button>
            <button data-format="json" class="canvas-export-item">Export JSON</button>
          </div>
        </div>
        <div class="canvas-zoom" id="canvas-zoom"></div>
      </div>
      <div class="canvas-body">
        <aside class="canvas-drawer" id="canvas-drawer"></aside>
        <div class="canvas-stage" id="canvas-stage"></div>
        <aside class="canvas-inspector-host" id="canvas-inspector-host"></aside>
        <aside class="canvas-curation-host" id="canvas-curation-host"></aside>
      </div>
    </div>
  `;

  container.querySelector('.canvas-back').addEventListener('click', onBack);

  const stageEl = container.querySelector('#canvas-stage');
  const drawerEl = container.querySelector('#canvas-drawer');
  const inspectorHost = container.querySelector('#canvas-inspector-host');

  const { stage, contentLayer, uiLayer, destroy: destroyStage, isPanning, resetView } = createStage(stageEl);

  // Undo/redo stack. Fed by commitChange; suspended during restore.
  const history = createHistory({
    serialize: () => serializeContent(contentLayer),
    deserialize: (json) => deserializeInto(contentLayer, json),
  });

  // Undo button reflects history.canUndo() — disabled (greyed out) when the
  // stack is empty, re-enables as soon as there's something to undo.
  const undoBtn = container.querySelector('#canvas-undo-btn');
  const syncUndoBtn = () => {
    if (!undoBtn) return;
    undoBtn.disabled = !history.canUndo();
  };

  let saveTimer = null;
  let saveFailureCount = 0;
  const commitChange = () => {
    history.commit();
    syncUndoBtn();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const json = serializeContent(contentLayer);
      sync.saveCanvasState(json).then(() => {
        saveFailureCount = 0;
      }).catch((err) => {
        console.warn('[canvas] save failed:', err);
        saveFailureCount++;
        // After two back-to-back failures, warn the user non-blockingly.
        if (saveFailureCount === 2) {
          toastError('Canvas auto-save failing. Check that the daemon is running.', {
            actionLabel: 'Retry now',
            onAction: () => {
              sync.saveCanvasState(json).then(() => {
                saveFailureCount = 0;
                toastInfo('Saved.');
              }).catch(() => toastError('Still failing. Export JSON to keep a safe copy.'));
            },
          });
        }
      });
    }, SAVE_DEBOUNCE_MS);
  };

  const inspector = createInspector({
    host: inspectorHost,
    onChange: commitChange,
  });

  // `comments` is built below; read its mode lazily so createSelection can
  // short-circuit when comment mode is on without a forward-reference error.
  let commentsRef = null;
  const selection = createSelection({
    stage,
    contentLayer,
    uiLayer,
    getTool: () => tools.getTool(),
    getCommentMode: () => commentsRef ? commentsRef.getMode() : 'off',
    onChange: (nodes) => {
      // Don't show the inspector at all while in comment mode — the user is
      // focused on annotating, not editing.
      if (commentsRef && commentsRef.getMode() === 'on') {
        inspector.setSelection([]);
        inspectorHost.classList.remove('open');
        return;
      }
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

  const detachImageDrop = attachImageDrop(stageEl, contentLayer, {
    onCommit: commitChange,
    getStage: () => stage,
  });

  // Comment controller: mounts pins on the uiLayer, intercepts shape clicks
  // when in comment mode, persists via sync.addComment.
  const comments = createCommentController({
    stage,
    contentLayer,
    uiLayer,
    onCommit: commitChange,
  });
  commentsRef = comments;

  // Feedback panel → canvas: clicking a comment row focuses/un-focuses it.
  // While focused, the matching pin pulses continuously; id=null clears.
  const onFocusPin = (e) => {
    comments.setFocusedPin(e.detail?.id ?? null);
  };
  window.addEventListener('frank:focus-comment-pin', onFocusPin);

  // Curation sidebar mirrors the viewer layout; filters to 'canvas' screen.
  const curationHost = container.querySelector('#canvas-curation-host');
  renderCuration(curationHost, { screenId: CANVAS_SCREEN_ID });

  const commentToggleBtn = container.querySelector('#canvas-comment-toggle');
  commentToggleBtn.addEventListener('click', () => {
    const next = comments.getMode() === 'on' ? 'off' : 'on';
    comments.setMode(next);
  });
  comments.onModeChange((mode) => {
    commentToggleBtn.classList.toggle('active', mode === 'on');
    curationHost.classList.toggle('open', mode === 'on');
    if (mode === 'on') {
      // Neutralize any active creation tool so click-in-comment-mode doesn't
      // accidentally create a shape alongside the comment.
      tools.activate('select');
      selection.clear();
      markActiveTool(drawerEl, 'select');
      // Hide the inspector panel — comment mode shouldn't show object props.
      inspector.setSelection([]);
      inspectorHost.classList.remove('open');
    }
  });

  // In comment mode, clicking anywhere on the stage creates a comment — on a
  // shape it becomes a shape-anchored pin; on empty canvas it becomes a
  // free-floating pin at the world coords. Selection / properties are
  // suppressed while mode is on so the properties panel doesn't pop open.
  stage.on('click.comments tap.comments', (e) => {
    if (comments.getMode() !== 'on') return;

    // Ignore clicks that land on existing comment pins (uiLayer) — those have
    // their own handler that opens the popover.
    if (e.target && e.target.getLayer && e.target.getLayer() === uiLayer) return;

    e.cancelBubble = true;

    // Empty stage: drop a free pin at the pointer's world coords.
    if (!e.target || e.target === stage) {
      const pt = stage.getRelativePointerPosition() || { x: 0, y: 0 };
      comments.handleEmptyClickInMode(pt.x, pt.y);
      return;
    }

    // Otherwise walk up to a direct contentLayer child and anchor to it.
    let shape = e.target;
    while (shape && shape.getParent && shape.getParent() !== contentLayer) {
      shape = shape.getParent();
    }
    if (!shape || shape === contentLayer) return;
    comments.handleShapeClickInMode(shape);
  });

  // Re-render pins whenever the project's comment list changes.
  const onProjectChange = () => comments.render();
  projectManager.onChange(onProjectChange);

  // Snapshot: capture current canvas state + a thumbnail via Konva toDataURL.
  // Thumbnail is rendered at pixelRatio 0.5 of the visible stage (cheap, good
  // enough for timeline thumbnails).
  const snapshotBtn = container.querySelector('#canvas-snapshot-btn');
  snapshotBtn.addEventListener('click', async () => {
    try {
      snapshotBtn.classList.add('flashing');
      // Briefly hide the uiLayer (transformer handles, comment pins) so the
      // thumbnail captures just the content.
      const wasVisible = uiLayer.visible();
      uiLayer.visible(false);
      uiLayer.draw();
      const thumbnail = stage.toDataURL({ pixelRatio: 0.5, mimeType: 'image/png' });
      uiLayer.visible(wasVisible);
      uiLayer.draw();
      const state = serializeContent(contentLayer);
      await sync.saveCanvasSnapshot(state, thumbnail, 'manual', 'user');
      toastInfo('Snapshot saved');
    } catch (err) {
      console.warn('[canvas] snapshot failed:', err);
      toastError('Snapshot failed');
    } finally {
      setTimeout(() => snapshotBtn.classList.remove('flashing'), 300);
    }
  });

  // Export dropdown: PNG / PDF / JSON. Click-outside closes.
  const exportBtn = container.querySelector('#canvas-export-btn');
  const exportMenu = container.querySelector('#canvas-export-menu');
  const closeExportMenu = () => exportMenu.setAttribute('hidden', '');
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (exportMenu.hasAttribute('hidden')) exportMenu.removeAttribute('hidden');
    else closeExportMenu();
  });
  const onExportClickOutside = (e) => {
    if (!exportMenu.contains(e.target) && e.target !== exportBtn) closeExportMenu();
  };
  document.addEventListener('click', onExportClickOutside);
  exportMenu.querySelectorAll('.canvas-export-item').forEach((item) => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeExportMenu();
      const format = item.dataset.format;
      try {
        if (format === 'png') exportPng({ stage, uiLayer, name: project.name });
        else if (format === 'svg') await exportSvg({ contentLayer, name: project.name });
        else if (format === 'pdf') await exportPdf({ contentLayer, name: project.name });
        else if (format === 'json') exportJson({ contentLayer, name: project.name });
      } catch (err) {
        console.warn('[canvas] export failed:', err);
        toastError(`Export failed: ${err.message || err}`);
      }
    });
  });

  // Share: open popover, then capture canvas-flavored snapshot with assets
  // inlined as data URLs so the cloud viewer can render without the daemon.
  const shareBtn = container.querySelector('#canvas-share-btn');
  shareBtn.addEventListener('click', () => {
    showSharePopover(shareBtn, { onClose() {} });
  });
  syncToolbarLiveBadge(project.id);  // v3 Phase 5: sync badge on canvas mount

  const onCaptureSnapshot = async (e) => {
    // Only handle canvas-originated captures. The viewer handler in viewer.js
    // branches on its own iframe presence, so we need the contentType guard.
    const project = projectManager.get();
    if (project?.contentType !== 'canvas') return;
    try {
      const snapshot = await buildCanvasSnapshot(contentLayer, stage);
      const result = await sync.uploadShare(
        snapshot,
        e.detail.coverNote,
        'canvas',
        undefined,  // oldShareId — unused on fresh creation
        undefined,  // oldRevokeToken
        e.detail.expiryDays,
      );
      if (result.error) {
        updateSharePopover({ error: result.error });
        return;
      }
      project.activeShare = {
        id: result.shareId,
        revokeToken: result.revokeToken,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        coverNote: e.detail.coverNote,
        lastSyncedNoteId: null,
        unseenNotes: 0,
      };
      updateSharePopover(result);
    } catch (err) {
      updateSharePopover({ error: err.message || 'Share failed' });
    }
  };
  window.addEventListener('frank:capture-snapshot', onCaptureSnapshot);

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
    // Render pins after content is restored so they find their anchor shapes.
    comments.render();
    // Reset the history baseline so the first real edit creates the first
    // undo entry (rather than the restored-from-disk state itself).
    history.reset();
    syncUndoBtn();
  });

  // Toolbar undo button: same path as Cmd+Z. Disabled attribute is kept in
  // sync by syncUndoBtn; clicking while disabled is a no-op.
  // Canvas topbar → timeline view (same event the viewer's toolbar dispatches).
  container.querySelector('#canvas-timeline-btn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('frank:open-timeline'));
  });

  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      if (!history.canUndo()) return;
      // Clear selection first — deserialize replaces every child node, which
      // would leave the Transformer pointing at a destroyed shape and render
      // orphan handles where the shape used to be.
      selection.clear();
      history.undo();
      comments.render();
      syncUndoBtn();
    });
  }

  function duplicateSelection() {
    const nodes = selection.selectedNodes();
    if (!nodes.length) return;
    placeClonesWithOffset(nodes.map(n => n.toObject()));
  }

  // In-memory clipboard for Cmd+C / Cmd+V. Stores Konva-serialized plain
  // objects (not live nodes) so they survive layer mutations and can paste
  // any number of times. Scoped to this canvas view; cleared on reload.
  let canvasClipboard = [];
  let pasteCount = 0;

  function copySelection() {
    const nodes = selection.selectedNodes();
    if (!nodes.length) return false;
    canvasClipboard = nodes.map(n => n.toObject());
    pasteCount = 0;
    return true;
  }

  function pasteSelection() {
    if (!canvasClipboard.length) return false;
    pasteCount += 1;
    placeClonesWithOffset(canvasClipboard, pasteCount);
    return true;
  }

  // Shared clone helper. Offsets each clone by (+20*n, +20*n) so repeated
  // pastes stair-step instead of stacking on top of each other.
  function placeClonesWithOffset(sourceObjects, step = 1) {
    const Konva = window.Konva;
    const dx = 20 * step;
    const dy = 20 * step;
    const newNodes = [];
    for (const obj of sourceObjects) {
      try {
        const clone = Konva.Node.create(JSON.stringify(obj));
        if (!clone) continue;
        clone.id('shape-' + Math.random().toString(36).slice(2, 10));
        clone.x((clone.x() || 0) + dx);
        clone.y((clone.y() || 0) + dy);
        clone.draggable(true);
        contentLayer.add(clone);
        newNodes.push(clone);
      } catch (err) {
        console.warn('[canvas] paste failed', err);
      }
    }
    if (newNodes.length) {
      contentLayer.batchDraw();
      selection.setSelection(newNodes);
      commitChange();
    }
  }

  const detachShortcuts = attachShortcuts({
    onTool: (id) => {
      tools.activate(id);
      selection.clear();
      markActiveTool(drawerEl, id);
    },
    onEscape: () => {
      tools.activate('select');
      selection.clear();
      markActiveTool(drawerEl, 'select');
      // Also turn off comment mode if it was active.
      if (comments.getMode() === 'on') comments.setMode('off');
    },
    onUndo: () => { selection.clear(); history.undo(); comments.render(); syncUndoBtn(); },
    onRedo: () => { selection.clear(); history.redo(); comments.render(); syncUndoBtn(); },
    onDuplicate: duplicateSelection,
    onCopy: copySelection,
    onPaste: pasteSelection,
  });

  // Cleanup when leaving the view
  const viewEl = container.closest('.view');
  const observer = new MutationObserver(() => {
    if (!viewEl.classList.contains('active')) {
      selection.destroy();
      comments.destroy();
      projectManager.offChange(onProjectChange);
      window.removeEventListener('frank:capture-snapshot', onCaptureSnapshot);
      destroyStage();
      if (detachImageDrop) detachImageDrop();
      if (detachShortcuts) detachShortcuts();
      document.removeEventListener('click', onExportClickOutside);
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

// Build a canvas-flavored share snapshot. The cloud viewer sees this blob as
// `snapshot`; it carries the canvas JSON plus inline data URLs for every
// referenced asset so no round-trips to the daemon are needed at view time.
async function buildCanvasSnapshot(contentLayer, stage) {
  const canvasState = serializeContent(contentLayer);
  const parsed = JSON.parse(canvasState);

  // Walk for every assetUrl that will need inlining. Image nodes carry
  // assetUrl on attrs; if we later nest images inside groups, walk recurses.
  const urls = new Set();
  function walk(def) {
    if (!def) return;
    if (def.className === 'Image' && def.attrs?.assetUrl) urls.add(def.attrs.assetUrl);
    if (Array.isArray(def.children)) def.children.forEach(walk);
  }
  (parsed.children || []).forEach(walk);

  const assets = {};
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      assets[url] = await blobToDataUrl(blob);
    } catch (err) {
      console.warn('[canvas:share] failed to inline asset', url, err);
    }
  }

  // Preview PNG for the cover image on the share page.
  let preview = null;
  try {
    preview = stage.toDataURL({ pixelRatio: 0.5, mimeType: 'image/png' });
  } catch { /* best effort */ }

  return { canvasState, assets, preview };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Read failed'));
    reader.readAsDataURL(blob);
  });
}

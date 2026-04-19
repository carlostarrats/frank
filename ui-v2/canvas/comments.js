// comments.js — Shape-anchored comments on the canvas.
//
// A shape-anchored comment lives under a synthetic screenId ('canvas') and
// carries anchor.type === 'shape' with anchor.shapeId. We render a small
// numbered pin at each shape's current world position on the uiLayer, follow
// the shape via Konva dragmove (same pattern as connectors), and persist the
// last-known position on anchor.shapeLastKnown so orphaned pins (when the
// shape is deleted) survive the edit in-place.
//
// Click a pin → popover with the comment text + dismiss. Deleted-shape pins
// render with a dashed, muted style so it's obvious the anchor is stale.

import sync from '../core/sync.js';
import projectManager from '../core/project.js';

export const CANVAS_SCREEN_ID = 'canvas';

const PIN_RADIUS = 11;
const PIN_OFFSET_Y = -26;
const PIN_FILL = '#f0b429';
const PIN_STROKE = '#111';
const PIN_STALE_FILL = '#888';
const PIN_STALE_STROKE = '#444';

export function createCommentController({ stage, contentLayer, uiLayer, onCommit }) {
  const Konva = window.Konva;

  let mode = 'off';   // 'off' | 'on'
  let modeChangeListeners = [];
  let input = null;   // floating DOM input while creating
  let popover = null; // floating DOM popover while viewing

  const pinsByCommentId = new Map();      // commentId → Konva.Group
  const dragSubsByShapeId = new Map();    // shapeId → cleanup fn

  function setMode(next) {
    mode = next;
    stage.container().style.cursor = mode === 'on' ? 'crosshair' : '';
    modeChangeListeners.forEach(fn => fn(mode));
  }

  function onModeChange(fn) { modeChangeListeners.push(fn); }

  // ─── Pin rendering ──────────────────────────────────────────────────────

  function render() {
    // Hide the existing pins and re-render from scratch. Comments are few
    // enough that this is cheap, and it keeps the code simple.
    for (const group of pinsByCommentId.values()) group.destroy();
    pinsByCommentId.clear();
    for (const [, cleanup] of dragSubsByShapeId) cleanup();
    dragSubsByShapeId.clear();

    const comments = projectManager.getCommentsForScreen(CANVAS_SCREEN_ID);
    const shapeIndex = new Map();
    contentLayer.getChildren().forEach((node) => {
      const id = node.id();
      if (id) shapeIndex.set(id, node);
    });

    comments.forEach((c, idx) => {
      if (c.anchor?.type !== 'shape') return;
      const shape = c.anchor.shapeId ? shapeIndex.get(c.anchor.shapeId) : null;
      const stale = !shape;
      const pos = shape ? shapeCentroid(shape) : (c.anchor.shapeLastKnown || { x: c.anchor.x, y: c.anchor.y });

      const group = buildPin({ label: String(idx + 1), x: pos.x, y: pos.y, stale, comment: c });
      uiLayer.add(group);
      pinsByCommentId.set(c.id, group);

      if (shape) subscribeToShape(shape, c);
    });

    uiLayer.batchDraw();
  }

  function buildPin({ label, x, y, stale, comment }) {
    const group = new Konva.Group({
      x: x,
      y: y + PIN_OFFSET_Y,
      name: 'comment-pin',
      listening: true,
    });

    const circle = new Konva.Circle({
      radius: PIN_RADIUS,
      fill: stale ? PIN_STALE_FILL : PIN_FILL,
      stroke: stale ? PIN_STALE_STROKE : PIN_STROKE,
      strokeWidth: 1.5,
      dash: stale ? [3, 3] : undefined,
      shadowColor: 'black',
      shadowBlur: 4,
      shadowOpacity: 0.25,
    });
    const text = new Konva.Text({
      text: label,
      fontSize: 11,
      fontStyle: 'bold',
      fill: '#111',
      width: PIN_RADIUS * 2,
      height: PIN_RADIUS * 2,
      offsetX: PIN_RADIUS,
      offsetY: PIN_RADIUS,
      align: 'center',
      verticalAlign: 'middle',
    });
    group.add(circle);
    group.add(text);

    group.on('mouseenter', () => stage.container().style.cursor = 'pointer');
    group.on('mouseleave', () => stage.container().style.cursor = mode === 'on' ? 'crosshair' : '');
    group.on('click', (e) => {
      e.cancelBubble = true;
      showCommentPopover(group, comment);
    });

    return group;
  }

  function subscribeToShape(shape, comment) {
    const shapeId = shape.id();
    if (dragSubsByShapeId.has(shapeId)) return;
    const handler = () => {
      const centroid = shapeCentroid(shape);
      const pin = pinsByCommentId.get(comment.id);
      if (pin) {
        pin.x(centroid.x);
        pin.y(centroid.y + PIN_OFFSET_Y);
        uiLayer.batchDraw();
      }
      // Persist the last-known position so deletes keep the pin in place.
      if (!comment.anchor.shapeLastKnown ||
          comment.anchor.shapeLastKnown.x !== centroid.x ||
          comment.anchor.shapeLastKnown.y !== centroid.y) {
        comment.anchor.shapeLastKnown = { x: centroid.x, y: centroid.y };
      }
    };
    shape.on('dragmove.commentpin transform.commentpin', handler);
    dragSubsByShapeId.set(shapeId, () => shape.off('.commentpin'));
  }

  // ─── Creation (comment mode click) ───────────────────────────────────────

  function handleShapeClickInMode(shape, worldPt) {
    const shapeId = ensureShapeId(shape);
    const centroid = shapeCentroid(shape);
    openCreateInput(centroid.x, centroid.y, (text) => {
      const anchor = {
        type: 'shape',
        shapeId,
        x: centroid.x,
        y: centroid.y,
        shapeLastKnown: { x: centroid.x, y: centroid.y },
      };
      sync.addComment(CANVAS_SCREEN_ID, anchor, text);
      // Daemon broadcasts comment-added; app.js updates projectManager, then
      // we'll re-render pins from the refreshed list.
    });
  }

  function openCreateInput(worldX, worldY, onSubmit) {
    closeInput();
    const screenPt = worldToScreen(worldX, worldY);
    const containerRect = stage.container().getBoundingClientRect();

    input = document.createElement('div');
    input.className = 'canvas-comment-input';
    input.style.left = `${containerRect.left + screenPt.x}px`;
    input.style.top = `${containerRect.top + screenPt.y + 12}px`;
    input.innerHTML = `
      <textarea class="canvas-comment-input-textarea" rows="2" placeholder="Add a comment…"></textarea>
      <div class="canvas-comment-input-actions">
        <button class="btn-ghost canvas-comment-cancel">Cancel</button>
        <button class="btn-primary canvas-comment-submit">Post</button>
      </div>
    `;
    document.body.appendChild(input);
    const ta = input.querySelector('textarea');
    ta.focus();

    const close = () => closeInput();
    input.querySelector('.canvas-comment-cancel').addEventListener('click', close);
    input.querySelector('.canvas-comment-submit').addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) { close(); return; }
      onSubmit(text);
      close();
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        const text = ta.value.trim();
        if (text) onSubmit(text);
        close();
      }
    });
  }

  function closeInput() {
    if (input) { input.remove(); input = null; }
  }

  // ─── Pop-over on pin click ───────────────────────────────────────────────

  function showCommentPopover(pinGroup, comment) {
    closePopover();
    const pinScreenPt = worldToScreen(pinGroup.x(), pinGroup.y());
    const containerRect = stage.container().getBoundingClientRect();

    popover = document.createElement('div');
    popover.className = 'canvas-comment-popover';
    popover.style.left = `${containerRect.left + pinScreenPt.x + 16}px`;
    popover.style.top = `${containerRect.top + pinScreenPt.y - 10}px`;
    popover.innerHTML = `
      <div class="canvas-comment-popover-header">
        <strong>${escapeHtml(comment.author || 'You')}</strong>
        <span class="canvas-comment-popover-status">${escapeHtml(comment.status)}</span>
      </div>
      <p class="canvas-comment-popover-text">${escapeHtml(comment.text)}</p>
      <div class="canvas-comment-popover-actions">
        <button class="btn-ghost canvas-comment-popover-close">Close</button>
        <button class="btn-ghost canvas-comment-popover-delete">Delete</button>
      </div>
    `;
    document.body.appendChild(popover);

    popover.querySelector('.canvas-comment-popover-close').addEventListener('click', closePopover);
    popover.querySelector('.canvas-comment-popover-delete').addEventListener('click', () => {
      if (confirm('Delete this comment?')) {
        sync.deleteComment(comment.id);
        closePopover();
      }
    });
  }

  function closePopover() {
    if (popover) { popover.remove(); popover = null; }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  function worldToScreen(wx, wy) {
    const scale = stage.scaleX() || 1;
    return {
      x: wx * scale + stage.x(),
      y: wy * scale + stage.y(),
    };
  }

  function shapeCentroid(shape) {
    const rect = shape.getClientRect({ relativeTo: contentLayer });
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  }

  function ensureShapeId(shape) {
    let id = shape.id();
    if (!id) {
      id = 'shape-' + Math.random().toString(36).slice(2, 10);
      shape.id(id);
      if (onCommit) onCommit();
    }
    return id;
  }

  function destroy() {
    for (const group of pinsByCommentId.values()) group.destroy();
    pinsByCommentId.clear();
    for (const [, cleanup] of dragSubsByShapeId) cleanup();
    dragSubsByShapeId.clear();
    closeInput();
    closePopover();
    modeChangeListeners = [];
    stage.container().style.cursor = '';
  }

  return {
    getMode: () => mode,
    setMode,
    onModeChange,
    render,
    handleShapeClickInMode,
    destroy,
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

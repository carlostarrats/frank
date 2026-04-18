// tools.js — Tool modes and shape creation for the Konva canvas.
//
// Tools: select, rectangle, sticky, text, freehand, arrow.
// Each tool binds its own handlers to the stage and is de-activated when the
// caller switches tools.

const STICKY_FILL = '#fff2a8';
// Default shape colors are tuned for the dark canvas background. The styling
// inspector (Phase 1b) will let users override these per-shape.
const SHAPE_STROKE = '#e5e7eb';
const FREEHAND_STROKE = '#e5e7eb';
const DEFAULT_TEXT_FILL = '#f2f2f2';
const DEFAULT_RECT_FILL = 'rgba(255, 255, 255, 0.08)';

export function createToolController({ stage, contentLayer, isPanning, onCommit }) {
  const Konva = window.Konva;
  let currentTool = 'select';
  let disposers = [];

  function activate(tool) {
    disposers.forEach((d) => d());
    disposers = [];
    currentTool = tool;

    if (tool === 'rectangle') disposers = bindRectangle();
    else if (tool === 'sticky') disposers = bindSticky();
    else if (tool === 'text') disposers = bindText();
    else if (tool === 'freehand') disposers = bindFreehand();
    else if (tool === 'arrow') disposers = bindArrow();
  }

  function getTool() { return currentTool; }

  // ── Rectangle ─────────────────────────────────────────────────────────────
  function bindRectangle() {
    let rect = null;
    let start = null;
    const onDown = (e) => {
      if (isPanning()) return;
      if (e.target !== stage) return; // only start when clicking empty canvas
      const pos = stageToContent(stage);
      start = pos;
      rect = new Konva.Rect({
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        fill: DEFAULT_RECT_FILL,
        stroke: SHAPE_STROKE,
        strokeWidth: 1.5,
        draggable: true,
        name: 'shape',
      });
      contentLayer.add(rect);
    };
    const onMove = () => {
      if (!rect || !start) return;
      const pos = stageToContent(stage);
      rect.width(pos.x - start.x);
      rect.height(pos.y - start.y);
    };
    const onUp = () => {
      if (!rect) return;
      // Normalize negative width/height
      if (rect.width() < 0) { rect.x(rect.x() + rect.width()); rect.width(-rect.width()); }
      if (rect.height() < 0) { rect.y(rect.y() + rect.height()); rect.height(-rect.height()); }
      // Discard trivially small shapes (accidental clicks)
      if (Math.abs(rect.width()) < 4 || Math.abs(rect.height()) < 4) {
        rect.destroy();
      } else {
        onCommit();
      }
      rect = null;
      start = null;
    };
    stage.on('mousedown.rect', onDown);
    stage.on('mousemove.rect', onMove);
    stage.on('mouseup.rect', onUp);
    return [() => stage.off('mousedown.rect mousemove.rect mouseup.rect')];
  }

  // ── Sticky note (group: rect + text) ──────────────────────────────────────
  function bindSticky() {
    const onDown = (e) => {
      if (isPanning()) return;
      if (e.target !== stage) return;
      const pos = stageToContent(stage);
      const group = new Konva.Group({ x: pos.x, y: pos.y, draggable: true, name: 'shape sticky' });
      const bg = new Konva.Rect({
        width: 160,
        height: 120,
        fill: STICKY_FILL,
        stroke: '#b39700',
        strokeWidth: 1,
        cornerRadius: 4,
        shadowColor: 'black',
        shadowOpacity: 0.1,
        shadowBlur: 6,
        shadowOffset: { x: 0, y: 2 },
      });
      const text = new Konva.Text({
        x: 12,
        y: 12,
        width: 136,
        text: 'Double-click to edit',
        fontSize: 14,
        fontFamily: 'system-ui, sans-serif',
        fill: '#333',
      });
      group.add(bg);
      group.add(text);
      contentLayer.add(group);
      attachTextEdit(group, text);
      onCommit();
    };
    stage.on('mousedown.sticky', onDown);
    return [() => stage.off('mousedown.sticky')];
  }

  // ── Text ──────────────────────────────────────────────────────────────────
  function bindText() {
    const onDown = (e) => {
      if (isPanning()) return;
      if (e.target !== stage) return;
      const pos = stageToContent(stage);
      const text = new Konva.Text({
        x: pos.x,
        y: pos.y,
        text: 'Text',
        fontSize: 18,
        fontFamily: 'system-ui, sans-serif',
        fill: DEFAULT_TEXT_FILL,
        draggable: true,
        name: 'shape',
      });
      contentLayer.add(text);
      attachTextEdit(text, text);
      onCommit();
    };
    stage.on('mousedown.text', onDown);
    return [() => stage.off('mousedown.text')];
  }

  // ── Freehand (Konva.Line with points, smoothed) ───────────────────────────
  function bindFreehand() {
    let line = null;
    const onDown = (e) => {
      if (isPanning()) return;
      if (e.target !== stage) return;
      const pos = stageToContent(stage);
      line = new Konva.Line({
        points: [pos.x, pos.y],
        stroke: FREEHAND_STROKE,
        strokeWidth: 2,
        lineCap: 'round',
        lineJoin: 'round',
        tension: 0.4,
        draggable: true,
        name: 'shape',
      });
      contentLayer.add(line);
    };
    const onMove = () => {
      if (!line) return;
      const pos = stageToContent(stage);
      line.points([...line.points(), pos.x, pos.y]);
    };
    const onUp = () => {
      if (!line) return;
      if (line.points().length < 4) line.destroy();
      else onCommit();
      line = null;
    };
    stage.on('mousedown.freehand', onDown);
    stage.on('mousemove.freehand', onMove);
    stage.on('mouseup.freehand', onUp);
    return [() => stage.off('mousedown.freehand mousemove.freehand mouseup.freehand')];
  }

  // ── Arrow ─────────────────────────────────────────────────────────────────
  function bindArrow() {
    let arrow = null;
    let start = null;
    const onDown = (e) => {
      if (isPanning()) return;
      if (e.target !== stage) return;
      start = stageToContent(stage);
      arrow = new Konva.Arrow({
        points: [start.x, start.y, start.x, start.y],
        pointerLength: 10,
        pointerWidth: 10,
        fill: SHAPE_STROKE,
        stroke: SHAPE_STROKE,
        strokeWidth: 2,
        draggable: true,
        name: 'shape',
      });
      contentLayer.add(arrow);
    };
    const onMove = () => {
      if (!arrow || !start) return;
      const pos = stageToContent(stage);
      arrow.points([start.x, start.y, pos.x, pos.y]);
    };
    const onUp = () => {
      if (!arrow) return;
      const pts = arrow.points();
      const dx = pts[2] - pts[0];
      const dy = pts[3] - pts[1];
      if (Math.hypot(dx, dy) < 6) arrow.destroy();
      else onCommit();
      arrow = null;
      start = null;
    };
    stage.on('mousedown.arrow', onDown);
    stage.on('mousemove.arrow', onMove);
    stage.on('mouseup.arrow', onUp);
    return [() => stage.off('mousedown.arrow mousemove.arrow mouseup.arrow')];
  }

  activate('select');

  return { activate, getTool };
}

function stageToContent(stage) {
  // Konva convenience: returns pointer position in the stage's coordinate system,
  // which accounts for the current scale and translation (our pan/zoom state).
  const pos = stage.getRelativePointerPosition();
  return pos || { x: 0, y: 0 };
}

// Double-click on a Konva.Text opens a DOM textarea positioned over the canvas
// for inline editing. Rich text, wrap, and alignment options are 1b scope.
function attachTextEdit(anchor, textNode) {
  anchor.on('dblclick', () => {
    const stage = textNode.getStage();
    if (!stage) return;
    const abs = textNode.getAbsolutePosition();
    const scale = stage.scaleX();

    const ta = document.createElement('textarea');
    ta.value = textNode.text();
    ta.className = 'canvas-text-editor';
    ta.style.position = 'absolute';
    ta.style.left = abs.x + 'px';
    ta.style.top = abs.y + 'px';
    ta.style.width = Math.max(80, textNode.width() * scale) + 'px';
    ta.style.fontSize = textNode.fontSize() * scale + 'px';
    ta.style.fontFamily = textNode.fontFamily();
    ta.style.color = textNode.fill();
    stage.container().appendChild(ta);
    ta.focus();
    ta.select();

    const commit = () => {
      textNode.text(ta.value);
      ta.remove();
    };
    ta.addEventListener('blur', commit);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        commit();
      }
    });
  });
}

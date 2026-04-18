// tools.js — Tool modes for the Konva canvas.
//
// Each tool binds its own stage listeners; activate(toolId) tears down the
// previous tool's listeners before installing the new one. Shape-specific
// drawing logic lives here; the shape factories come from shapes.js, and
// follow-shape connector wiring comes from connectors.js.

import {
  createRect, createCircle, createEllipse, createTriangle, createDiamond,
  createHexagon, createStar, createCloud, createSpeechBubble, createDocument,
  createCylinder, createParallelogram, createArrow, createElbow, createFreehand,
  createText, createSticky,
} from './shapes.js';
import { bindConnector, _ensureId } from './connectors.js';

export function createToolController({ stage, contentLayer, isPanning, onCommit }) {
  let currentTool = 'select';
  let disposers = [];

  function activate(tool) {
    disposers.forEach((d) => d());
    disposers = [];
    currentTool = tool;

    const handlerMap = {
      rectangle: bindDragShape((pos) => createRect({ x: pos.x, y: pos.y, width: 0, height: 0 }), resizeRect),
      circle: bindDragShape((pos) => createCircle({ x: pos.x, y: pos.y, radius: 1 }), resizeCircle),
      ellipse: bindDragShape((pos) => createEllipse({ x: pos.x, y: pos.y, radiusX: 1, radiusY: 1 }), resizeEllipse),
      triangle: bindClickShape((pos) => createTriangle({ x: pos.x, y: pos.y })),
      diamond: bindClickShape((pos) => createDiamond({ x: pos.x, y: pos.y })),
      hexagon: bindClickShape((pos) => createHexagon({ x: pos.x, y: pos.y })),
      star: bindClickShape((pos) => createStar({ x: pos.x, y: pos.y })),
      cloud: bindClickShape((pos) => createCloud({ x: pos.x - 70, y: pos.y - 50 })),
      speech: bindClickShape((pos) => createSpeechBubble({ x: pos.x - 80, y: pos.y - 50 })),
      document: bindClickShape((pos) => createDocument({ x: pos.x - 60, y: pos.y - 70 })),
      cylinder: bindClickShape((pos) => createCylinder({ x: pos.x - 60, y: pos.y - 70 })),
      parallelogram: bindClickShape((pos) => createParallelogram({ x: pos.x - 80, y: pos.y - 40 })),
      sticky: bindClickShape((pos) => {
        const g = createSticky({ x: pos.x, y: pos.y });
        contentLayer.add(g);
        attachTextEdit(g, g._stickyText);
        onCommit();
        return null; // already added
      }),
      text: bindClickShape((pos) => {
        const t = createText({ x: pos.x, y: pos.y, text: 'Text' });
        contentLayer.add(t);
        attachTextEdit(t, t);
        onCommit();
        return null;
      }),
      freehand: bindFreehand,
      arrow: bindConnectorTool('arrow'),
      elbow: bindConnectorTool('elbow'),
    };

    const handler = handlerMap[tool];
    if (typeof handler === 'function') disposers = handler();
  }

  function getTool() { return currentTool; }

  // ── Drag-to-size shapes (rect, circle, ellipse) ────────────────────────────
  function bindDragShape(factory, resize) {
    return () => {
      let node = null;
      let start = null;
      const onDown = (e) => {
        if (isPanning()) return;
        if (e.target !== stage) return;
        start = stageToContent(stage);
        node = factory(start);
        contentLayer.add(node);
      };
      const onMove = () => {
        if (!node || !start) return;
        resize(node, start, stageToContent(stage));
      };
      const onUp = () => {
        if (!node) return;
        if (!finalizeOrDiscard(node)) onCommit();
        node = null;
        start = null;
      };
      stage.on('mousedown.tool', onDown);
      stage.on('mousemove.tool', onMove);
      stage.on('mouseup.tool', onUp);
      return [() => stage.off('mousedown.tool mousemove.tool mouseup.tool')];
    };
  }

  // ── Click-to-place shapes (polygons, path shapes) ──────────────────────────
  function bindClickShape(factory) {
    return () => {
      const onDown = (e) => {
        if (isPanning()) return;
        if (e.target !== stage) return;
        const pos = stageToContent(stage);
        const node = factory(pos);
        if (node) {
          contentLayer.add(node);
          onCommit();
        }
      };
      stage.on('mousedown.tool', onDown);
      return [() => stage.off('mousedown.tool')];
    };
  }

  // ── Freehand pen ───────────────────────────────────────────────────────────
  function bindFreehand() {
    let line = null;
    const onDown = (e) => {
      if (isPanning()) return;
      if (e.target !== stage) return;
      const pos = stageToContent(stage);
      line = createFreehand({ points: [pos.x, pos.y] });
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
    stage.on('mousedown.tool', onDown);
    stage.on('mousemove.tool', onMove);
    stage.on('mouseup.tool', onUp);
    return [() => stage.off('mousedown.tool mousemove.tool mouseup.tool')];
  }

  // ── Connector (arrow or elbow) — follows source/target if either end
  //     is a shape on the content layer.
  function bindConnectorTool(kind) {
    return () => {
      let connector = null;
      let start = null;
      let sourceId = null;

      const onDown = (e) => {
        if (isPanning()) return;
        start = stageToContent(stage);
        // If the user pressed on a shape, record its ID as the source.
        if (e.target !== stage) {
          const shape = nearestShape(e.target);
          if (shape) sourceId = _ensureId(shape);
        }
        connector = kind === 'elbow'
          ? createElbow({ x1: start.x, y1: start.y, x2: start.x, y2: start.y })
          : createArrow({ points: [start.x, start.y, start.x, start.y] });
        contentLayer.add(connector);
      };
      const onMove = () => {
        if (!connector || !start) return;
        const pos = stageToContent(stage);
        if (kind === 'elbow') {
          connector.points([start.x, start.y, pos.x, start.y, pos.x, pos.y]);
        } else {
          connector.points([start.x, start.y, pos.x, pos.y]);
        }
      };
      const onUp = (e) => {
        if (!connector) return;
        const pts = connector.points();
        const lastX = pts[pts.length - 2];
        const lastY = pts[pts.length - 1];
        const dx = lastX - pts[0];
        const dy = lastY - pts[1];
        if (Math.hypot(dx, dy) < 6) {
          connector.destroy();
        } else {
          let targetId = null;
          if (e.target !== stage) {
            const shape = nearestShape(e.target);
            if (shape && _ensureId(shape) !== sourceId) targetId = _ensureId(shape);
          }
          if (sourceId || targetId) {
            bindConnector(contentLayer, connector, { sourceId, targetId });
          }
          onCommit();
        }
        connector = null;
        start = null;
        sourceId = null;
      };
      stage.on('mousedown.tool', onDown);
      stage.on('mousemove.tool', onMove);
      stage.on('mouseup.tool', onUp);
      return [() => stage.off('mousedown.tool mousemove.tool mouseup.tool')];
    };
  }

  // Walk up the parent chain to find the first node that sits directly on the
  // content layer. Matches the selection logic in transformer.js.
  function nearestShape(node) {
    let n = node;
    while (n && n.getLayer && n.getLayer() !== contentLayer) n = n.getParent();
    return n && n !== contentLayer ? n : null;
  }

  activate('select');

  return { activate, getTool };
}

// ── Shape-specific resizers (used by bindDragShape) ──────────────────────────
function resizeRect(rect, start, pos) {
  rect.width(pos.x - start.x);
  rect.height(pos.y - start.y);
}
function resizeCircle(circle, start, pos) {
  const r = Math.max(1, Math.hypot(pos.x - start.x, pos.y - start.y));
  circle.radius(r);
}
function resizeEllipse(ellipse, start, pos) {
  ellipse.radiusX(Math.max(1, Math.abs(pos.x - start.x)));
  ellipse.radiusY(Math.max(1, Math.abs(pos.y - start.y)));
}

function finalizeOrDiscard(node) {
  // Returns true if the node was discarded (too small).
  if (typeof node.width === 'function' && typeof node.height === 'function' && node.getClassName() === 'Rect') {
    if (node.width() < 0) { node.x(node.x() + node.width()); node.width(-node.width()); }
    if (node.height() < 0) { node.y(node.y() + node.height()); node.height(-node.height()); }
    if (Math.abs(node.width()) < 4 || Math.abs(node.height()) < 4) { node.destroy(); return true; }
  } else if (node.getClassName() === 'Circle') {
    if (node.radius() < 3) { node.destroy(); return true; }
  } else if (node.getClassName() === 'Ellipse') {
    if (node.radiusX() < 3 || node.radiusY() < 3) { node.destroy(); return true; }
  }
  return false;
}

function stageToContent(stage) {
  const pos = stage.getRelativePointerPosition();
  return pos || { x: 0, y: 0 };
}

// Double-click on a text node opens a DOM textarea overlaid on the canvas.
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
    ta.style.width = Math.max(80, (textNode.width() || 160) * scale) + 'px';
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

// Exported so canvas.js can re-attach edit handlers on restored text nodes.
export { attachTextEdit };

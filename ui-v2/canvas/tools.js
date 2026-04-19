// tools.js — Tool modes for the Konva canvas.
//
// Each tool binds its own stage listeners; activate(toolId) tears down the
// previous tool's listeners before installing the new one. Shape-specific
// drawing logic lives here; the shape factories come from shapes.js, and
// follow-shape connector wiring comes from connectors.js.

import {
  createRect, createEllipse, createTriangle, createDiamond,
  createHexagon, createStar, createCloud, createSpeechBubble, createDocument,
  createCylinder, createParallelogram, createArrow, createElbow, createFreehand,
  createText, createSticky,
} from './shapes.js';
import { bindConnector, _ensureId } from './connectors.js';
import { TOOL_CURSORS } from './cursors.js';
import { createAnchorOverlay, nearestAnchor, nearestSnapTarget, isSnappableShape } from './anchors.js';

export function createToolController({ stage, contentLayer, uiLayer, isPanning, onCommit, onShapeClick }) {
  let currentTool = 'select';
  let disposers = [];
  const containerEl = stage.container();

  function setToolCursor(tool) {
    containerEl.style.cursor = TOOL_CURSORS[tool] || 'default';
  }

  // Shape-hover cursor override: when the pointer enters an existing shape
  // (any child of the content layer) and the active tool is NOT select, we
  // flip the cursor to `pointer` so the user knows a click will select (via
  // the onShapeClick hook), not create.
  let hoveredShape = null;
  const onLayerEnter = (e) => {
    if (currentTool === 'select') return;
    const shape = nearestContentChild(e.target);
    if (!shape || shape === hoveredShape) return;
    hoveredShape = shape;
    containerEl.style.cursor = 'pointer';
  };
  const onLayerLeave = (e) => {
    if (currentTool === 'select') return;
    const shape = nearestContentChild(e.target);
    if (shape && shape === hoveredShape) {
      hoveredShape = null;
      setToolCursor(currentTool);
    }
  };
  stage.on('mouseover.hover', onLayerEnter);
  stage.on('mouseout.hover', onLayerLeave);

  function nearestContentChild(node) {
    let n = node;
    while (n && n.getLayer && n.getLayer() !== contentLayer) n = n.getParent();
    return n && n !== contentLayer ? n : null;
  }

  function activate(tool) {
    disposers.forEach((d) => d());
    disposers = [];
    currentTool = tool;

    const handlerMap = {
      rectangle: bindDragShape((pos) => createRect({ x: pos.x, y: pos.y, width: 0, height: 0 }), resizeRect),
      // Circle and Ellipse are unified: Ellipse with equal radii is a circle;
      // non-uniform Transformer resize stretches it to an ellipse after the
      // fact. Ellipse tool stays as an alias for backward compatibility.
      circle: bindDragShape((pos) => createEllipse({ x: pos.x, y: pos.y, radiusX: 1, radiusY: 1 }), resizeEllipse),
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

    setToolCursor(tool);
  }

  function getTool() { return currentTool; }

  // Shared "maybe intercept this mousedown as a selection" check. Creation
  // tools call this first; if the mousedown landed on an existing shape, we
  // short-circuit creation, switch to the select tool, and hand the shape up
  // to the view so it updates the active-tool UI and populates the inspector.
  function tryInterceptClick(e) {
    if (e.target === stage) return false;
    const shape = nearestContentChild(e.target);
    if (!shape) return false;
    if (onShapeClick) onShapeClick(shape, e);
    return true;
  }

  // ── Drag-to-size shapes (rect, circle, ellipse) ────────────────────────────
  //
  // Passing the event-level `shiftKey` into the resizer lets the shape stay
  // locked to its natural-1:1 aspect while Shift is held — square instead of
  // rectangle, perfect circle instead of ellipse. Matches Figma/Sketch.
  function bindDragShape(factory, resize) {
    return () => {
      let node = null;
      let start = null;
      const onDown = (e) => {
        if (isPanning()) return;
        if (tryInterceptClick(e)) return;
        if (e.target !== stage) return;
        start = stageToContent(stage);
        node = factory(start);
        contentLayer.add(node);
      };
      const onMove = (e) => {
        if (!node || !start) return;
        const shift = !!(e.evt && e.evt.shiftKey);
        resize(node, start, stageToContent(stage), { shift });
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
        if (tryInterceptClick(e)) return;
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
      if (tryInterceptClick(e)) return;
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

  // ── Connector (arrow or elbow) ────────────────────────────────────────────
  //
  // The source/target binding works for ANY shape on the content layer, not
  // just flowchart primitives — any Konva.Node with a `name` that includes
  // "shape" qualifies. While the user drags, we probe under the cursor for a
  // candidate target; if found, we snap the endpoint to its center and flash
  // a highlight box on the UI layer so the user can see the attach point
  // before committing. Shift constrains the line to 0° / 45° / 90° angles.
  function bindConnectorTool(kind) {
    return () => {
      let connector = null;
      let start = null;
      let sourceId = null;
      let sourceAnchorId = null;
      let hoveredTarget = null;
      let hoveredAnchorId = null;
      const overlay = createAnchorOverlay({ uiLayer, contentLayer });

      // While a connector tool is active, content-layer shapes must not be
      // draggable — otherwise mousedown on a shape starts both the connector
      // tool AND a shape drag, and the user watches the shape follow their
      // cursor instead of an arrow being drawn. Stash the previous value
      // on each node so we restore it when the tool deactivates.
      function suppressShapeDrag() {
        for (const child of contentLayer.getChildren()) {
          if (typeof child.draggable !== 'function') continue;
          child._wasDraggable = child.draggable();
          child.draggable(false);
        }
      }
      function restoreShapeDrag() {
        for (const child of contentLayer.getChildren()) {
          if (typeof child.draggable !== 'function') continue;
          if ('_wasDraggable' in child) {
            child.draggable(child._wasDraggable);
            delete child._wasDraggable;
          }
        }
      }
      suppressShapeDrag();

      // Snap detection uses proximity to anchor points across every
      // shape on the layer, not pixel hit-testing. Pixel hit-testing
      // breaks for rotated shapes whose corners poke into a neighbor's
      // body — the neighbor wins the hit and the connector snaps to
      // the wrong shape. Closest-anchor wins instead.
      function snapCandidateAt(pos) {
        return nearestSnapTarget(pos, contentLayer, { maxDist: 60, exclude: connector });
      }

      // Shift-constrain: snap the drag angle to the nearest 0° / 45° / 90°.
      function constrainAngle(sp, p) {
        const dx = p.x - sp.x;
        const dy = p.y - sp.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) return p;
        const step = Math.PI / 4;
        const snapped = Math.round(Math.atan2(dy, dx) / step) * step;
        return { x: sp.x + Math.cos(snapped) * dist, y: sp.y + Math.sin(snapped) * dist };
      }

      function resolveSnap(pos) {
        const cand = snapCandidateAt(pos);
        if (!cand || _ensureId(cand.shape) === sourceId) {
          overlay.hide();
          hoveredTarget = null;
          hoveredAnchorId = null;
          return { pos, target: null, anchorId: null };
        }
        overlay.show(cand.shape);
        hoveredTarget = cand.shape;
        hoveredAnchorId = cand.anchor.id;
        overlay.highlight(cand.anchor.id);
        return {
          pos: { x: cand.anchor.x, y: cand.anchor.y },
          target: cand.shape,
          anchorId: cand.anchor.id,
        };
      }

      const onDown = (e) => {
        if (isPanning()) return;
        start = stageToContent(stage);
        if (e.target !== stage) {
          const shape = nearestShape(e.target);
          if (shape && isSnappableShape(shape, contentLayer)) {
            sourceId = _ensureId(shape);
            // Snap start to the nearest anchor on the source shape and
            // remember which slot we chose, so recompute after rotation
            // resolves to the same anchor.
            const anchor = nearestAnchor(shape, start, contentLayer);
            start = { x: anchor.x, y: anchor.y };
            sourceAnchorId = anchor.id;
          }
        }
        connector = kind === 'elbow'
          ? createElbow({ x1: start.x, y1: start.y, x2: start.x, y2: start.y })
          : createArrow({ points: [start.x, start.y, start.x, start.y] });
        contentLayer.add(connector);
      };
      const onMove = (e) => {
        if (!connector || !start) return;
        const raw = stageToContent(stage);
        const shifted = (e.evt && e.evt.shiftKey) ? constrainAngle(start, raw) : raw;
        const { pos } = resolveSnap(shifted);

        if (kind === 'elbow') {
          connector.points([start.x, start.y, pos.x, start.y, pos.x, pos.y]);
        } else {
          connector.points([start.x, start.y, pos.x, pos.y]);
        }
      };
      const onUp = () => {
        // Re-probe at the final pointer position so fast drags still snap.
        const raw = stageToContent(stage);
        const { pos: finalPos, target: finalTarget, anchorId: finalAnchorId } = resolveSnap(raw);
        overlay.hide();
        if (!connector) return;
        const pts = connector.points();
        const dx = pts[pts.length - 2] - pts[0];
        const dy = pts[pts.length - 1] - pts[1];
        if (Math.hypot(dx, dy) < 6) {
          connector.destroy();
        } else {
          let targetId = null;
          let targetAnchorId = null;
          if (finalTarget && _ensureId(finalTarget) !== sourceId) {
            targetId = _ensureId(finalTarget);
            targetAnchorId = finalAnchorId;
            const next = pts.slice();
            next[next.length - 2] = finalPos.x;
            next[next.length - 1] = finalPos.y;
            if (kind === 'elbow' && next.length === 6) {
              next[2] = finalPos.x;
              next[3] = next[1];
            }
            connector.points(next);
          }
          if (sourceId || targetId) {
            bindConnector(contentLayer, connector, {
              sourceId,
              targetId,
              sourceAnchorId,
              targetAnchorId,
            });
          }
          onCommit();
        }
        connector = null;
        start = null;
        sourceId = null;
        sourceAnchorId = null;
        hoveredTarget = null;
        hoveredAnchorId = null;
      };
      // Window-level fallbacks — if the user releases the mouse outside the
      // stage (drawer, inspector, past the window edge) the stage's mouseup
      // never fires and the connector + anchor overlay would be orphaned.
      const onWindowUp = () => onUp();
      const onWindowKey = (e) => {
        if (e.key !== 'Escape') return;
        if (connector) connector.destroy();
        overlay.hide();
        connector = null;
        start = null;
        sourceId = null;
        sourceAnchorId = null;
        hoveredTarget = null;
        hoveredAnchorId = null;
      };
      stage.on('mousedown.tool', onDown);
      stage.on('mousemove.tool', onMove);
      stage.on('mouseup.tool', onUp);
      window.addEventListener('mouseup', onWindowUp);
      window.addEventListener('keydown', onWindowKey);
      return [() => {
        stage.off('mousedown.tool mousemove.tool mouseup.tool');
        window.removeEventListener('mouseup', onWindowUp);
        window.removeEventListener('keydown', onWindowKey);
        overlay.hide();
        restoreShapeDrag();
      }];
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

  function destroy() {
    stage.off('mouseover.hover mouseout.hover');
    disposers.forEach((d) => d());
    disposers = [];
  }

  return { activate, getTool, destroy };
}

// ── Shape-specific resizers (used by bindDragShape) ──────────────────────────
function resizeRect(rect, start, pos, { shift } = {}) {
  let w = pos.x - start.x;
  let h = pos.y - start.y;
  if (shift) {
    const d = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * d;
    h = Math.sign(h || 1) * d;
  }
  rect.width(w);
  rect.height(h);
}
function resizeEllipse(ellipse, start, pos, { shift } = {}) {
  let rx = Math.max(1, Math.abs(pos.x - start.x));
  let ry = Math.max(1, Math.abs(pos.y - start.y));
  if (shift) {
    const r = Math.max(rx, ry);
    rx = r; ry = r;
  }
  ellipse.radiusX(rx);
  ellipse.radiusY(ry);
}

function finalizeOrDiscard(node) {
  // Returns true if the node was discarded (too small).
  if (node.getClassName() === 'Rect') {
    if (node.width() < 0) { node.x(node.x() + node.width()); node.width(-node.width()); }
    if (node.height() < 0) { node.y(node.y() + node.height()); node.height(-node.height()); }
    if (Math.abs(node.width()) < 4 || Math.abs(node.height()) < 4) { node.destroy(); return true; }
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

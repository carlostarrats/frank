// endpoint-edit.js — Draggable endpoint handles for a selected connector.
//
// When a single connector (Arrow with name including 'connector') is selected,
// the transformer.js selection hook calls `showConnectorHandles(...)`, which
// replaces the Transformer's anchors with two small blue circles on the UI
// layer — one at each end of the line. The user drags a handle to move that
// endpoint. If the drag lands on a shape, we snap the handle to the shape's
// center and bind that end of the connector to the shape's ID, so subsequent
// drags of the bound shape pull the connector with them (the same
// follow-shape machinery the creation tool uses).
//
// Dropping a handle in empty canvas detaches that end — the connector keeps
// rendering at the released position but no longer follows any shape on that
// side. The opposite-end binding is preserved.

import { bindConnector, unbindConnector, _ensureId } from './connectors.js';

export function showConnectorHandles(connector, { stage, contentLayer, uiLayer, onChange }) {
  const Konva = window.Konva;
  let hoveredTarget = null;
  let snapIndicator = null;

  function endpointFromPoints(which) {
    const pts = connector.points();
    if (which === 'start') return { x: pts[0], y: pts[1], idx: 0 };
    return { x: pts[pts.length - 2], y: pts[pts.length - 1], idx: pts.length - 2 };
  }

  function updatePointsFor(which, x, y) {
    const pts = connector.points().slice();
    const { idx } = endpointFromPoints(which);
    pts[idx] = x;
    pts[idx + 1] = y;

    // Elbow connectors have a middle bend at (endX, startY). Recompute so
    // the L stays aligned when either end moves.
    if ((connector.name() || '').includes('connector-elbow') && pts.length === 6) {
      pts[2] = pts[4]; // midX = endX
      pts[3] = pts[1]; // midY = startY
    }
    connector.points(pts);
  }

  function makeHandle(which) {
    const { x, y } = endpointFromPoints(which);
    const h = new Konva.Circle({
      x,
      y,
      radius: 6,
      fill: '#60a5fa',
      stroke: 'white',
      strokeWidth: 1.5,
      draggable: true,
      name: 'endpoint-handle',
      hitStrokeWidth: 12,
    });
    h.on('dragmove', () => onDragMove(h, which));
    h.on('dragend', () => onDragEnd(h, which));
    return h;
  }

  const startHandle = makeHandle('start');
  const endHandle = makeHandle('end');
  uiLayer.add(startHandle);
  uiLayer.add(endHandle);
  uiLayer.batchDraw();

  function targetAtPointer() {
    const p = stage.getPointerPosition();
    if (!p) return null;
    const hit = stage.getIntersection(p);
    if (!hit) return null;
    let n = hit;
    while (n && n.getLayer() !== contentLayer) n = n.getParent();
    if (!n || n === contentLayer || n === connector) return null;
    return n;
  }

  function highlight(shape) {
    clearHighlight();
    if (!shape) return;
    hoveredTarget = shape;
    const rect = shape.getClientRect({ skipStroke: true, relativeTo: uiLayer });
    snapIndicator = new Konva.Rect({
      x: rect.x - 4,
      y: rect.y - 4,
      width: rect.width + 8,
      height: rect.height + 8,
      stroke: '#60a5fa',
      strokeWidth: 2,
      dash: [6, 4],
      listening: false,
      cornerRadius: 2,
    });
    uiLayer.add(snapIndicator);
    uiLayer.batchDraw();
  }
  function clearHighlight() {
    hoveredTarget = null;
    if (snapIndicator) { snapIndicator.destroy(); snapIndicator = null; }
  }

  function onDragMove(handle, which) {
    updatePointsFor(which, handle.x(), handle.y());
    const target = targetAtPointer();
    if (target) {
      if (target !== hoveredTarget) highlight(target);
    } else if (hoveredTarget) {
      clearHighlight();
    }
    uiLayer.batchDraw();
  }

  function onDragEnd(handle, which) {
    const target = hoveredTarget;
    clearHighlight();

    const attr = which === 'start' ? 'sourceId' : 'targetId';
    const otherAttr = which === 'start' ? 'targetId' : 'sourceId';
    // Detach existing binding for this end BEFORE rebinding so the index in
    // connectors.js stays clean.
    unbindConnector(contentLayer, connector);

    if (target) {
      const id = _ensureId(target);
      connector.setAttr(attr, id);
      const rect = target.getClientRect({ skipStroke: true, relativeTo: contentLayer });
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      handle.x(cx);
      handle.y(cy);
      updatePointsFor(which, cx, cy);
    } else {
      connector.setAttr(attr, null);
    }

    // Re-register with whatever bindings remain. If both ends are now
    // unbound, the rebind is a no-op — the connector sits where it is.
    bindConnector(contentLayer, connector, {
      sourceId: connector.getAttr('sourceId'),
      targetId: connector.getAttr('targetId'),
    });

    // Re-read endpoint positions from the (possibly snap-adjusted) points
    // so both handles stay aligned with the line.
    const startPt = endpointFromPoints('start');
    const endPt = endpointFromPoints('end');
    startHandle.position({ x: startPt.x, y: startPt.y });
    endHandle.position({ x: endPt.x, y: endPt.y });

    uiLayer.batchDraw();
    if (onChange) onChange();
  }

  function destroy() {
    clearHighlight();
    startHandle.destroy();
    endHandle.destroy();
    uiLayer.batchDraw();
  }

  return { destroy };
}

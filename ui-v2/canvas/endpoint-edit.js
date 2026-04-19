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
import { createAnchorOverlay, nearestAnchor, isSnappableShape } from './anchors.js';

export function showConnectorHandles(connector, { stage, contentLayer, uiLayer, onChange }) {
  const Konva = window.Konva;
  let hoveredTarget = null;
  const overlay = createAnchorOverlay({ uiLayer, contentLayer });

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
    if (!isSnappableShape(n, contentLayer)) return null;
    return n;
  }

  function onDragMove(handle, which) {
    updatePointsFor(which, handle.x(), handle.y());
    const target = targetAtPointer();
    if (target) {
      overlay.show(target);
      hoveredTarget = target;
      const anchor = nearestAnchor(target, { x: handle.x(), y: handle.y() }, contentLayer);
      overlay.highlight(anchor.id);
    } else if (hoveredTarget) {
      overlay.hide();
      hoveredTarget = null;
    }
    uiLayer.batchDraw();
  }

  function onDragEnd(handle, which) {
    const target = hoveredTarget;
    overlay.hide();

    const attr = which === 'start' ? 'sourceId' : 'targetId';
    // Detach existing binding for this end BEFORE rebinding so the index in
    // connectors.js stays clean.
    unbindConnector(contentLayer, connector);

    if (target) {
      const id = _ensureId(target);
      connector.setAttr(attr, id);
      const anchor = nearestAnchor(target, { x: handle.x(), y: handle.y() }, contentLayer);
      handle.x(anchor.x);
      handle.y(anchor.y);
      updatePointsFor(which, anchor.x, anchor.y);
    } else {
      connector.setAttr(attr, null);
    }
    hoveredTarget = null;

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
    overlay.hide();
    startHandle.destroy();
    endHandle.destroy();
    uiLayer.batchDraw();
  }

  return { destroy };
}

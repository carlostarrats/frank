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

  // Visually mark the selected connector with an accent-blue glow (shadow),
  // NOT by mutating stroke width/color — otherwise the properties inspector
  // fights with this code for ownership of the stroke, and the user can't
  // edit line width. Stroke geometry stays untouched; shadow is a visual
  // overlay we clean up on destroy.
  const hadShadow = connector.shadowEnabled && connector.shadowEnabled();
  connector.shadowColor('#60a5fa');
  connector.shadowBlur(10);
  connector.shadowOpacity(0.9);
  connector.shadowEnabled(true);

  // Connector renders its local `points` offset by its own x/y. The uiLayer
  // shares the stage transform but NOT the connector's position offset, so
  // we convert between the two spaces explicitly. Without this, dragging
  // the connector moves the line but leaves the handles behind in
  // pre-drag layer space.
  function endpointFromPoints(which) {
    const pts = connector.points();
    const cx = connector.x();
    const cy = connector.y();
    if (which === 'start') return { x: pts[0] + cx, y: pts[1] + cy, idx: 0 };
    return { x: pts[pts.length - 2] + cx, y: pts[pts.length - 1] + cy, idx: pts.length - 2 };
  }

  function updatePointsFor(which, absX, absY) {
    const pts = connector.points().slice();
    const { idx } = endpointFromPoints(which);
    const cx = connector.x();
    const cy = connector.y();
    pts[idx] = absX - cx;
    pts[idx + 1] = absY - cy;

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
    // While the handle is being dragged it sits directly under the cursor.
    // If it stays listening, `stage.getIntersection(pointer)` returns the
    // handle itself (or punches through to a shape below, at the wrong z),
    // which caused snap-to-wrong-shape. Turn off hit detection for the
    // duration of the drag so intersection sees only the content layer.
    h.on('dragstart', () => { h.listening(false); });
    h.on('dragmove', () => onDragMove(h, which));
    h.on('dragend', () => {
      h.listening(true);
      onDragEnd(h, which);
    });
    return h;
  }

  const startHandle = makeHandle('start');
  const endHandle = makeHandle('end');
  uiLayer.add(startHandle);
  uiLayer.add(endHandle);
  uiLayer.batchDraw();

  // When the connector's bound source or target shape moves, connectors.js
  // re-computes the connector's points. We need to move the handles along
  // with them — otherwise the handles float off where they were when the
  // connector was selected. Subscribe to dragmove/transformend on both
  // bound shapes and reposition the handles after each update.
  const followListeners = [];
  function attachFollowers() {
    for (const l of followListeners) {
      l.node.off('dragmove.endpoint-handles transformend.endpoint-handles', l.handler);
    }
    followListeners.length = 0;
    for (const attr of ['sourceId', 'targetId']) {
      const id = connector.getAttr(attr);
      if (!id) continue;
      const node = contentLayer.findOne('#' + id);
      if (!node) continue;
      const handler = () => {
        const s = endpointFromPoints('start');
        const e = endpointFromPoints('end');
        startHandle.position({ x: s.x, y: s.y });
        endHandle.position({ x: e.x, y: e.y });
        uiLayer.batchDraw();
      };
      node.on('dragmove.endpoint-handles transformend.endpoint-handles', handler);
      followListeners.push({ node, handler });
    }
  }
  attachFollowers();

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

    // Bindings may have changed — re-subscribe to the new source/target
    // dragmove events so future shape moves keep the handles glued.
    attachFollowers();

    uiLayer.batchDraw();
    if (onChange) onChange();
  }

  function destroy() {
    overlay.hide();
    for (const l of followListeners) {
      l.node.off('dragmove.endpoint-handles transformend.endpoint-handles', l.handler);
    }
    followListeners.length = 0;
    // Drop the selection glow. We don't restore the prior shadow state
    // because connectors never have shadows by default — the sticky/rect
    // shapes that do have shadows aren't connectors.
    connector.shadowEnabled(!!hadShadow);
    connector.shadowBlur(0);
    connector.shadowOpacity(0);
    startHandle.destroy();
    endHandle.destroy();
    contentLayer.batchDraw();
    uiLayer.batchDraw();
  }

  return { destroy };
}

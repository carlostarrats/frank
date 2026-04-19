// connectors.js — Follow-shape connectors.
//
// A connector is a Konva.Arrow whose endpoints track two other shapes by ID.
// When a source or target shape moves, we recompute the connector's points so
// the arrow stays glued between them.
//
// State lives per content-layer: a WeakMap<layer, Map<shapeId, Set<connector>>>
// so different stages don't leak listeners across each other.

const layerIndex = new WeakMap();

function indexFor(layer) {
  let index = layerIndex.get(layer);
  if (!index) {
    index = new Map();
    layerIndex.set(layer, index);
  }
  return index;
}

function ensureId(node) {
  if (!node.id()) node.id('n-' + Math.random().toString(36).slice(2, 10));
  return node.id();
}

// Compute the segment between two shapes. We use getClientRect relative to the
// content layer (no stroke/shadow so the endpoints sit on the shape body), and
// trim to the edge of the bounding box toward the other shape's center so the
// arrow doesn't plunge into the shape's interior.
function edgePoint(rect, toward) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const scale = Math.min(hw / Math.abs(dx || 0.0001), hh / Math.abs(dy || 0.0001));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function getShapeById(layer, id) {
  if (!id) return null;
  return layer.findOne('#' + id);
}

function rectOf(layer, node) {
  // getClientRect without stroke/shadow, in the content layer's coordinate
  // system (skipTransform:false honors stage zoom/pan for the node's drawn
  // bounds — the layer removes the stage transform so we get layer-space
  // coordinates).
  return node.getClientRect({ skipStroke: true, skipShadow: true, relativeTo: layer });
}

export function recomputeConnector(connector, layer) {
  const sourceId = connector.getAttr('sourceId');
  const targetId = connector.getAttr('targetId');
  const source = getShapeById(layer, sourceId);
  const target = getShapeById(layer, targetId);
  if (!source && !target) return;

  // Shape rects come back in LAYER-space. If the connector has been dragged
  // (non-zero x/y), its own position offset would be added on top at render
  // time, pushing the line away from the shapes. Reset to origin so the new
  // layer-space points render exactly where we computed them.
  connector.position({ x: 0, y: 0 });

  const sourceRect = source ? rectOf(layer, source) : null;
  const targetRect = target ? rectOf(layer, target) : null;

  const existing = connector.points();

  let srcPt, tgtPt;
  if (sourceRect && targetRect) {
    const srcCenter = { x: sourceRect.x + sourceRect.width / 2, y: sourceRect.y + sourceRect.height / 2 };
    const tgtCenter = { x: targetRect.x + targetRect.width / 2, y: targetRect.y + targetRect.height / 2 };
    srcPt = edgePoint(sourceRect, tgtCenter);
    tgtPt = edgePoint(targetRect, srcCenter);
    // If the two shapes overlap so much that the edge points collapse,
    // fall back to the centers — anything shorter and the Arrow just
    // renders as a triangle.
    if (Math.hypot(tgtPt.x - srcPt.x, tgtPt.y - srcPt.y) < 12) {
      srcPt = srcCenter;
      tgtPt = tgtCenter;
    }
  } else if (sourceRect) {
    srcPt = { x: sourceRect.x + sourceRect.width / 2, y: sourceRect.y + sourceRect.height / 2 };
    tgtPt = { x: existing[existing.length - 2], y: existing[existing.length - 1] };
    srcPt = edgePoint(sourceRect, tgtPt);
  } else if (targetRect) {
    tgtPt = { x: targetRect.x + targetRect.width / 2, y: targetRect.y + targetRect.height / 2 };
    srcPt = { x: existing[0], y: existing[1] };
    tgtPt = edgePoint(targetRect, srcPt);
  }

  if (connector.name().includes('connector-elbow')) {
    const midX = tgtPt.x;
    const midY = srcPt.y;
    connector.points([srcPt.x, srcPt.y, midX, midY, tgtPt.x, tgtPt.y]);
  } else {
    connector.points([srcPt.x, srcPt.y, tgtPt.x, tgtPt.y]);
  }
}

function registerShapeListener(layer, shape) {
  const index = indexFor(layer);
  const shapeId = shape.id();
  if (!shapeId) return;
  const set = index.get(shapeId);
  if (!set) return;
  if (shape._connectorDragBound) return;
  shape._connectorDragBound = true;
  shape.on('dragmove.connectors transformend.connectors', () => {
    for (const connector of set) recomputeConnector(connector, layer);
    layer.batchDraw();
  });
}

// Bind a newly-drawn connector to its source/target shapes. Call this right
// after adding the connector to the layer.
export function bindConnector(layer, connector, { sourceId, targetId }) {
  if (sourceId) connector.setAttr('sourceId', sourceId);
  if (targetId) connector.setAttr('targetId', targetId);
  ensureId(connector);

  const index = indexFor(layer);
  for (const id of [sourceId, targetId]) {
    if (!id) continue;
    let set = index.get(id);
    if (!set) { set = new Set(); index.set(id, set); }
    set.add(connector);
    const shape = getShapeById(layer, id);
    if (shape) registerShapeListener(layer, shape);
  }

  recomputeConnector(connector, layer);
}

// Remove a connector from the index (called before connector.destroy()).
export function unbindConnector(layer, connector) {
  const index = indexFor(layer);
  for (const id of [connector.getAttr('sourceId'), connector.getAttr('targetId')]) {
    if (!id) continue;
    const set = index.get(id);
    if (set) {
      set.delete(connector);
      if (set.size === 0) index.delete(id);
    }
  }
}

// Walk the layer and rebuild the connector index + re-attach dragmove
// listeners. Run this after deserializeInto() so restored connectors follow
// their sources again.
export function rebindAll(layer) {
  layerIndex.delete(layer);
  const connectors = layer.getChildren().filter((n) => {
    const name = n.name ? n.name() : '';
    return name.includes('connector') && (n.getAttr('sourceId') || n.getAttr('targetId'));
  });
  for (const c of connectors) {
    bindConnector(layer, c, {
      sourceId: c.getAttr('sourceId'),
      targetId: c.getAttr('targetId'),
    });
  }
}

export { ensureId as _ensureId };

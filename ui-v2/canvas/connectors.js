// connectors.js — Follow-shape connectors.
//
// A connector is a Konva.Arrow whose endpoints track two other shapes by ID,
// and optionally by a specific anchor slot (tl, tm, tr, rm, br, bm, bl, lm).
// When a source/target shape moves OR rotates, we re-resolve the stored
// anchor ID back to its current layer-space position and update the
// connector's points — so rotated shapes stay glued at their real rotated
// corners, not at the axis-aligned bounding box edges.
//
// State lives per content-layer: a WeakMap<layer, Map<shapeId, Set<connector>>>
// so different stages don't leak listeners across each other.

import { allAnchors, anchorById, nearestAnchor } from './anchors.js';

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

function getShapeById(layer, id) {
  if (!id) return null;
  return layer.findOne('#' + id);
}

// Resolve an anchor slot on `shape` to its current layer-space coordinate.
// If the connector stored an explicit anchor id (the user snapped to a
// specific corner/edge-midpoint), use that. Otherwise fall back to the
// anchor closest to `toward` — matches the spirit of the old "edge point
// toward the other shape" logic but respects rotation and scale.
function resolveAnchor(shape, anchorId, toward, layer) {
  if (anchorId) {
    const a = anchorById(shape, anchorId, layer);
    if (a) return a;
  }
  if (toward) return nearestAnchor(shape, toward, layer);
  const all = allAnchors(shape, layer);
  return all[0];
}

function centerOf(shape, layer) {
  const all = allAnchors(shape, layer);
  let cx = 0, cy = 0;
  for (const a of all) { cx += a.x; cy += a.y; }
  return { x: cx / all.length, y: cy / all.length };
}

export function recomputeConnector(connector, layer) {
  const sourceId = connector.getAttr('sourceId');
  const targetId = connector.getAttr('targetId');
  const source = getShapeById(layer, sourceId);
  const target = getShapeById(layer, targetId);
  if (!source && !target) return;

  // Shape anchor coords come back in LAYER-space. If the connector has been
  // dragged (non-zero x/y), its own position offset would be added on top
  // at render time, pushing the line away from the shapes. Reset to origin
  // so the new layer-space points render exactly where we computed them.
  connector.position({ x: 0, y: 0 });

  const sourceAnchorId = connector.getAttr('sourceAnchorId');
  const targetAnchorId = connector.getAttr('targetAnchorId');
  const existing = connector.points();

  let srcPt, tgtPt;
  if (source && target) {
    const srcTowardFallback = centerOf(target, layer);
    const tgtTowardFallback = centerOf(source, layer);
    srcPt = resolveAnchor(source, sourceAnchorId, srcTowardFallback, layer);
    tgtPt = resolveAnchor(target, targetAnchorId, tgtTowardFallback, layer);
  } else if (source) {
    const toward = { x: existing[existing.length - 2], y: existing[existing.length - 1] };
    srcPt = resolveAnchor(source, sourceAnchorId, toward, layer);
    tgtPt = { x: existing[existing.length - 2], y: existing[existing.length - 1] };
  } else if (target) {
    const toward = { x: existing[0], y: existing[1] };
    srcPt = { x: existing[0], y: existing[1] };
    tgtPt = resolveAnchor(target, targetAnchorId, toward, layer);
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

// Bind a newly-drawn connector to its source/target shapes. Pass the anchor
// slots (`sourceAnchorId`, `targetAnchorId`) if the user snapped to a
// specific corner/midpoint — those are persisted on the connector's attrs
// so rotations/moves resolve back to the same anchor.
export function bindConnector(layer, connector, { sourceId, targetId, sourceAnchorId, targetAnchorId }) {
  if (sourceId) connector.setAttr('sourceId', sourceId);
  if (targetId) connector.setAttr('targetId', targetId);
  if (sourceAnchorId !== undefined) connector.setAttr('sourceAnchorId', sourceAnchorId || null);
  if (targetAnchorId !== undefined) connector.setAttr('targetAnchorId', targetAnchorId || null);
  ensureId(connector);

  // A bound connector's endpoints are 100% defined by its source/target
  // anchors — dragging the whole line is meaningless (it snaps right back
  // on the next shape-move, or worse, desyncs its position offset from
  // its points). Disable whole-line drag; endpoint handles are the only
  // way to re-route.
  connector.draggable(false);
  // Reset any stale position offset so the line renders exactly where
  // its points say it should.
  connector.position({ x: 0, y: 0 });
  // Keep connectors behind other shapes so clicks on shapes win the
  // hit-test when they overlap a line.
  connector.moveToBottom();

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

// Remove a connector from the index (called before connector.destroy(), or
// before endpoint-edit rebinds it with different source/target IDs).
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
  // If the connector has no bindings left it becomes a free arrow — allow
  // the user to drag it around as a whole again. Callers that are about to
  // re-bind will flip this back off inside bindConnector.
  if (!connector.getAttr('sourceId') && !connector.getAttr('targetId')) {
    connector.draggable(true);
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
      sourceAnchorId: c.getAttr('sourceAnchorId'),
      targetAnchorId: c.getAttr('targetAnchorId'),
    });
  }
}

export { ensureId as _ensureId };

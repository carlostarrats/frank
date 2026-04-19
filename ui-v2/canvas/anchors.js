// anchors.js — Shape anchor overlay + snap-point helpers for connector editing.
//
// When the user is drawing or re-routing a connector and the pointer enters a
// valid target shape, we paint the shape's 8 anchor points (4 corners +
// 4 edge midpoints) on the UI layer. The nearest anchor to the cursor is
// emphasized. `nearestAnchor(shape, point)` picks the snap target; the caller
// uses its coordinates to position the connector endpoint.
//
// Connectors are never valid snap targets (that was the "arrows tying to
// arrows" bug), so `isSnappableShape` filters them out.

// Produce 8 anchor points on the shape's OWN bounding box (pre-transform),
// then push each point through the shape's absolute transform so rotation
// and scale are preserved. The points come out in `relativeTo` layer space,
// matching how the connector's endpoints are stored.
//
// The old implementation used getClientRect, which returns the axis-aligned
// bounding box AFTER transform — for a 45°-rotated square that's the big
// square containing the diamond, so the "corners" landed out in empty
// space and the endpoint couldn't snap to the shape's actual corners.
function allAnchors(shape, relativeTo) {
  // Prefer getSelfRect (class-specific, tightest bounds). Fall back to
  // getClientRect({skipTransform: true}) for Groups/Labels which don't
  // implement getSelfRect — that still gives us the shape's own pre-
  // transform bounding box.
  const local = typeof shape.getSelfRect === 'function'
    ? shape.getSelfRect()
    : shape.getClientRect({ skipTransform: true, skipStroke: true, skipShadow: true });
  const x0 = local.x;
  const y0 = local.y;
  const x1 = x0 + local.width;
  const y1 = y0 + local.height;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const localPoints = [
    { id: 'tl', x: x0, y: y0 },
    { id: 'tm', x: mx, y: y0 },
    { id: 'tr', x: x1, y: y0 },
    { id: 'rm', x: x1, y: my },
    { id: 'br', x: x1, y: y1 },
    { id: 'bm', x: mx, y: y1 },
    { id: 'bl', x: x0, y: y1 },
    { id: 'lm', x: x0, y: my },
  ];
  const shapeToAbs = shape.getAbsoluteTransform();
  const absToRel = relativeTo.getAbsoluteTransform().copy().invert();
  return localPoints.map((p) => {
    const abs = shapeToAbs.point({ x: p.x, y: p.y });
    const rel = absToRel.point(abs);
    return { id: p.id, x: rel.x, y: rel.y };
  });
}

export function isSnappableShape(node, contentLayer) {
  if (!node || node === contentLayer) return false;
  // Connectors (arrow / elbow / line tagged 'connector') should never be
  // snap targets for other connectors — that was the "lines tying to lines"
  // bug. Text nodes don't make useful endpoints either.
  const name = node.name() || '';
  if (name.includes('connector')) return false;
  // The Transformer / marquee helpers use 'endpoint-handle' and 'marquee'
  // on the UI layer; they shouldn't be targets either, but since they're
  // on a different layer the contentLayer walk in the caller already
  // filters them out.
  return true;
}

export function nearestAnchor(shape, point, relativeTo) {
  const anchors = allAnchors(shape, relativeTo);
  let best = anchors[0];
  let bestDist = Infinity;
  for (const a of anchors) {
    const d = Math.hypot(a.x - point.x, a.y - point.y);
    if (d < bestDist) { bestDist = d; best = a; }
  }
  return best;
}

// Look up a specific anchor by id — used by connectors.js to re-resolve a
// stored anchor choice (e.g. 'tl', 'bm') to its current position after the
// shape moves or rotates. Returns null if the id doesn't match.
export function anchorById(shape, id, relativeTo) {
  const anchors = allAnchors(shape, relativeTo);
  return anchors.find((a) => a.id === id) || null;
}

// Also export allAnchors directly for callers that want to compute a snap
// target based on geometry (e.g. pick the anchor closest to a reference
// point on another shape).
export { allAnchors };

// Given a point in layer space, find the (shape, anchor) pair the user
// most likely means to snap to. Two layers of detection:
//
// 1. Anchor-proximity: if the point is within `maxDist` of any shape's
//    anchor, that's a snap. Wins over pixel hit-test so rotated corners
//    don't lose to a neighboring shape whose body contains the pixel.
//
// 2. Body-containment fallback: if no anchor is within range but the
//    point is INSIDE a shape's body, still bind — the user clearly
//    released on that shape, even if its anchors are far from the
//    release point (common for large shapes). Use the shape's own
//    nearest anchor as the snap slot.
//
// Returns null only if neither check matches.
export function nearestSnapTarget(point, layer, { maxDist = 60, exclude } = {}) {
  let bestShape = null;
  let bestAnchor = null;
  let bestDist = maxDist;
  let containing = null;
  for (const child of layer.getChildren()) {
    if (!isSnappableShape(child, layer)) continue;
    if (exclude && (child === exclude || (exclude.id && child.id() === exclude.id()))) continue;
    const anchors = allAnchors(child, layer);
    for (const a of anchors) {
      const d = Math.hypot(a.x - point.x, a.y - point.y);
      if (d < bestDist) { bestDist = d; bestShape = child; bestAnchor = a; }
    }
    if (!bestShape && pointInShape(child, point, layer)) containing = child;
  }
  if (bestShape) return { shape: bestShape, anchor: bestAnchor, distance: bestDist };
  if (containing) {
    const a = nearestAnchor(containing, point, layer);
    return { shape: containing, anchor: a, distance: Math.hypot(a.x - point.x, a.y - point.y) };
  }
  return null;
}

// Layer-space point-in-shape test. Uses the shape's rotated bounding
// quad built from the 4 corner anchors — tighter than the axis-aligned
// getClientRect, and correct under rotation.
function pointInShape(shape, point, layer) {
  const anchors = allAnchors(shape, layer);
  const tl = anchors[0], tr = anchors[2], br = anchors[4], bl = anchors[6];
  return pointInQuad(point, tl, tr, br, bl);
}

function pointInQuad(p, a, b, c, d) {
  // Split the quad into two triangles.
  return pointInTriangle(p, a, b, c) || pointInTriangle(p, a, c, d);
}

function pointInTriangle(p, a, b, c) {
  const sign = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(hasNeg && hasPos);
}

export function createAnchorOverlay({ uiLayer, contentLayer }) {
  const Konva = window.Konva;
  let group = null;
  let activeShape = null;
  let dots = [];
  let highlightDot = null;

  function show(shape) {
    if (activeShape === shape) return;
    hide();
    activeShape = shape;
    const anchors = allAnchors(shape, contentLayer);
    group = new Konva.Group({ listening: false, name: 'anchor-overlay' });
    dots = anchors.map((a) => {
      const dot = new Konva.Circle({
        x: a.x,
        y: a.y,
        radius: 4,
        fill: '#60a5fa',
        stroke: 'white',
        strokeWidth: 1.5,
        listening: false,
        name: 'anchor-dot',
      });
      dot._anchorId = a.id;
      group.add(dot);
      return dot;
    });
    uiLayer.add(group);
  }

  function highlight(anchorId) {
    for (const d of dots) {
      if (d._anchorId === anchorId) {
        d.radius(7);
        d.fill('#ffffff');
        d.stroke('#60a5fa');
        d.strokeWidth(2);
        highlightDot = d;
      } else if (d === highlightDot) {
        d.radius(4);
        d.fill('#60a5fa');
        d.stroke('white');
        d.strokeWidth(1.5);
      }
    }
  }

  function hide() {
    if (group) { group.destroy(); group = null; }
    activeShape = null;
    dots = [];
    highlightDot = null;
  }

  return { show, highlight, hide, getActive: () => activeShape };
}

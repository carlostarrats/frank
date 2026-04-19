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

function allAnchors(shape, relativeTo) {
  const r = shape.getClientRect({ skipStroke: true, relativeTo });
  const hw = r.width / 2;
  const hh = r.height / 2;
  return [
    { id: 'tl', x: r.x,          y: r.y },
    { id: 'tm', x: r.x + hw,     y: r.y },
    { id: 'tr', x: r.x + r.width, y: r.y },
    { id: 'rm', x: r.x + r.width, y: r.y + hh },
    { id: 'br', x: r.x + r.width, y: r.y + r.height },
    { id: 'bm', x: r.x + hw,     y: r.y + r.height },
    { id: 'bl', x: r.x,          y: r.y + r.height },
    { id: 'lm', x: r.x,          y: r.y + hh },
  ];
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

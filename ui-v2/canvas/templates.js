// templates.js — One-click template insertions.
//
// Each export drops a pre-arranged Konva.Group onto the content layer near the
// viewport center. Templates persist as groups (confirmed with user) so the
// whole board can be moved as one unit; double-click to enter the group and
// edit children in place.
//
// Any shape inside a template uses the same factories from shapes.js so the
// inspector's edit flows work identically on template children.

import {
  createRect, createEllipse, createDiamond, createLabel, createSticky, createArrow, createText,
} from './shapes.js';
import { bindConnector } from './connectors.js';

function insertGroup(layer, children, center = null) {
  const Konva = window.Konva;
  const stage = layer.getStage();
  const origin = center || centerOfViewport(stage);
  const group = new Konva.Group({
    x: origin.x,
    y: origin.y,
    draggable: true,
    name: 'shape template-group',
  });
  for (const child of children) {
    // Children of a group must NOT be individually draggable. Konva's
    // drag-start picks the deepest draggable node under the cursor, so
    // a draggable child would be dragged out of its group instead of
    // the group moving as a unit. The group's own draggable:true
    // handles the whole-unit drag.
    if (typeof child.draggable === 'function') child.draggable(false);
    group.add(child);
  }
  layer.add(group);
  return group;
}

function centerOfViewport(stage) {
  if (!stage) return { x: 0, y: 0 };
  const scale = stage.scaleX() || 1;
  return {
    x: (stage.width() / 2 - stage.x()) / scale,
    y: (stage.height() / 2 - stage.y()) / scale,
  };
}

// Konva.Text centered inside a bounding box. Used by templates so labels
// sit in the middle of their host shape regardless of font width.
function centeredLabel({ x, y, w, h, text, fontSize }) {
  const node = createText({ x, y, text, fontSize });
  node.width(w);
  node.height(h);
  node.align('center');
  node.verticalAlign('middle');
  return node;
}

// Mirror anchors.js's 8-point anchor scheme (4 corners + 4 edge midpoints)
// in template-local coords so static template arrows snap to the same
// points an interactively-drawn connector would. Returns layer-space
// points relative to the template group's origin.
function bboxAnchors(cx, cy, hw, hh) {
  return [
    { x: cx - hw, y: cy - hh }, // tl
    { x: cx,      y: cy - hh }, // tm
    { x: cx + hw, y: cy - hh }, // tr
    { x: cx + hw, y: cy      }, // rm
    { x: cx + hw, y: cy + hh }, // br
    { x: cx,      y: cy + hh }, // bm
    { x: cx - hw, y: cy + hh }, // bl
    { x: cx - hw, y: cy      }, // lm
  ];
}

function nearest(points, target) {
  let best = points[0];
  let bestD = Infinity;
  for (const p of points) {
    const d = (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// ── Kanban ───────────────────────────────────────────────────────────────────

export function insertKanban(layer) {
  const columns = ['To Do', 'Doing', 'Done'];
  const colW = 220;
  const colH = 420;
  const gap = 20;
  const totalW = colW * 3 + gap * 2;

  const children = [];
  columns.forEach((title, i) => {
    const x = i * (colW + gap) - totalW / 2;
    // Column background
    children.push(createRect({ x, y: 0, width: colW, height: colH }));
    // Header label on top
    children.push(createLabel({
      x: x + 12,
      y: 12,
      text: title,
      backgroundFill: '#f5f5f5',
      fill: '#111',
      fontSize: 13,
      padding: 6,
    }));
    // Two placeholder sticky cards per column
    for (let j = 0; j < 2; j++) {
      children.push(createSticky({
        x: x + 10,
        y: 50 + j * 110,
        width: colW - 20,
        height: 90,
        text: `Task ${i + 1}.${j + 1}`,
      }));
    }
  });

  return insertGroup(layer, children);
}

// ── Mind map ─────────────────────────────────────────────────────────────────

export function insertMindMap(layer) {
  // Three buckets so we can compose final draw order: arrows behind shapes,
  // text on top. Mixed insertion would let arrows draw over earlier shapes
  // and text labels — that's what this fixes.
  const arrows = [];
  const shapes = [];
  const labels = [];

  const cRX = 80, cRY = 40;       // center ellipse radii
  const bW = 120, bH = 44;        // branch rect size
  const radius = 200;             // distance from center to branch center

  const centerNode = createEllipse({ x: 0, y: 0, radiusX: cRX, radiusY: cRY });
  centerNode.fill('#3b3b3b');
  shapes.push(centerNode);
  labels.push(centeredLabel({ x: -cRX, y: -cRY, w: cRX * 2, h: cRY * 2, text: 'Main idea', fontSize: 16 }));

  const branchNames = ['Branch A', 'Branch B', 'Branch C', 'Branch D', 'Branch E', 'Branch F'];
  // Pre-compute the center node's anchors once — they don't depend on the branch.
  const centerAnchors = bboxAnchors(0, 0, cRX, cRY);

  branchNames.forEach((label, i) => {
    const angle = (i / branchNames.length) * Math.PI * 2 - Math.PI / 2;
    const bx = Math.cos(angle) * radius;
    const by = Math.sin(angle) * radius;
    // Source: center-node anchor closest to the branch's center.
    // Target: branch-rect anchor closest to the canvas origin (where the
    // center node sits). Result mirrors the snap behavior of an
    // interactively-drawn connector: arrows land on a corner or
    // edge-midpoint, never inside the shape body.
    const start = nearest(centerAnchors, { x: bx, y: by });
    const branchAnchors = bboxAnchors(bx, by, bW / 2, bH / 2);
    const end = nearest(branchAnchors, { x: 0, y: 0 });
    arrows.push(createArrow({ points: [start.x, start.y, end.x, end.y] }));
    shapes.push(createRect({ x: bx - bW / 2, y: by - bH / 2, width: bW, height: bH }));
    labels.push(centeredLabel({ x: bx - bW / 2, y: by - bH / 2, w: bW, h: bH, text: label, fontSize: 13 }));
  });

  return insertGroup(layer, [...arrows, ...shapes, ...labels]);
}

// ── Flowchart starter ────────────────────────────────────────────────────────

export function insertFlowchart(layer) {
  const arrows = [];
  const shapes = [];
  const labels = [];

  // Shape descriptors — center + half-extents. Drive both the centered
  // label call and the anchor-snap arrow lookup, so the same numbers
  // can't drift apart.
  const startD    = { cx: 0,    cy: -180, hw: 60, hh: 28 };
  const stepD     = { cx: 0,    cy: -42,  hw: 80, hh: 28 };
  const decisionD = { cx: 0,    cy: 70,   hw: 80, hh: 48 };
  const yesD      = { cx: -140, cy: 210,  hw: 60, hh: 28 };
  const noD       = { cx: 140,  cy: 210,  hw: 60, hh: 28 };

  // Shapes
  const startNode = createEllipse({ x: startD.cx, y: startD.cy, radiusX: startD.hw, radiusY: startD.hh });
  startNode.fill('#1f3f6b');
  shapes.push(startNode);
  shapes.push(createRect({ x: stepD.cx - stepD.hw, y: stepD.cy - stepD.hh, width: stepD.hw * 2, height: stepD.hh * 2 }));
  shapes.push(createDiamond({ x: decisionD.cx, y: decisionD.cy, width: decisionD.hw * 2, height: decisionD.hh * 2 }));
  const yesNode = createEllipse({ x: yesD.cx, y: yesD.cy, radiusX: yesD.hw, radiusY: yesD.hh });
  yesNode.fill('#2a5a2a');
  shapes.push(yesNode);
  const noNode = createEllipse({ x: noD.cx, y: noD.cy, radiusX: noD.hw, radiusY: noD.hh });
  noNode.fill('#6a2a2a');
  shapes.push(noNode);

  // Labels — centeredLabel takes the bbox top-left + width/height.
  const labelFor = (d, text, fontSize) => centeredLabel({
    x: d.cx - d.hw, y: d.cy - d.hh,
    w: d.hw * 2, h: d.hh * 2,
    text, fontSize,
  });
  labels.push(labelFor(startD, 'Start', 14));
  labels.push(labelFor(stepD, 'Step 1', 14));
  labels.push(labelFor(decisionD, 'Decision?', 13));
  labels.push(labelFor(yesD, 'End (yes)', 13));
  labels.push(labelFor(noD, 'End (no)', 13));

  // Anchor-snapped arrows: source endpoint = source's anchor closest to
  // target's center, and vice versa. Same 8-point scheme used by the
  // mindmap template and by interactively-drawn / MCP-drawn connectors,
  // so connector endpoints land on the same named anchors regardless of
  // who drew them.
  const arrowBetween = (from, to) => {
    const a = nearest(bboxAnchors(from.cx, from.cy, from.hw, from.hh), { x: to.cx, y: to.cy });
    const b = nearest(bboxAnchors(to.cx, to.cy, to.hw, to.hh), { x: from.cx, y: from.cy });
    return createArrow({ points: [a.x, a.y, b.x, b.y] });
  };
  arrows.push(arrowBetween(startD, stepD));
  arrows.push(arrowBetween(stepD, decisionD));
  arrows.push(arrowBetween(decisionD, yesD));
  arrows.push(arrowBetween(decisionD, noD));

  return insertGroup(layer, [...arrows, ...shapes, ...labels]);
}

// ── Calendar / weekly grid ───────────────────────────────────────────────────

export function insertCalendar(layer) {
  const children = [];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const cellW = 120;
  const cellH = 90;
  const rows = 4;
  const totalW = cellW * 7;
  const offsetX = -totalW / 2;

  days.forEach((day, i) => {
    const x = offsetX + i * cellW;
    const isWeekend = i >= 5;
    // Header label
    children.push(createLabel({
      x: x + 10,
      y: -28,
      text: day,
      backgroundFill: isWeekend ? '#c8e6c9' : '#f5f5f5',
      fill: '#111',
      fontSize: 12,
      padding: 4,
    }));
    // Rows
    for (let r = 0; r < rows; r++) {
      const cell = createRect({ x, y: r * cellH, width: cellW, height: cellH });
      if (isWeekend) cell.fill('rgba(200, 230, 201, 0.06)');
      children.push(cell);
    }
  });

  return insertGroup(layer, children);
}

export const TEMPLATES = [
  { id: 'kanban', label: 'Kanban', insert: insertKanban },
  { id: 'mindmap', label: 'Mind map', insert: insertMindMap },
  { id: 'flowchart', label: 'Flowchart', insert: insertFlowchart },
  { id: 'calendar', label: 'Calendar', insert: insertCalendar },
];

// Used by the properties inspector for the "Dissolve group" action, and
// by the cmd+shift+G keybinding.
export function dissolveGroup(group, layer) {
  const parent = group.getParent();
  const children = group.getChildren().slice();
  const gx = group.x();
  const gy = group.y();
  for (const child of children) {
    // Move child up to the parent layer while preserving world position.
    const worldX = gx + child.x();
    const worldY = gy + child.y();
    child.moveTo(parent || layer);
    child.x(worldX);
    child.y(worldY);
    // Children were draggable(false) while inside the group. Restore
    // individual draggability now that they're loose on the layer.
    if (typeof child.draggable === 'function') child.draggable(true);
  }
  group.destroy();
  if (layer) layer.batchDraw();
  return children;
}

// Group the given nodes into a new Konva.Group on the same layer,
// preserving each child's world position. Returns the new group.
// Used by the cmd+G keybinding.
export function groupNodes(nodes, layer) {
  if (!nodes || nodes.length < 2) return null;
  const Konva = window.Konva;
  // Compute the group's origin as the top-left of the selection bounding
  // box, then rebase each child's x/y to group-local coords.
  const rects = nodes.map((n) => n.getClientRect({ relativeTo: layer }));
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const group = new Konva.Group({
    x: minX,
    y: minY,
    draggable: true,
    name: 'shape user-group',
  });
  // Preserve draw order: keep the nodes in their current z-order within
  // the group. `nodes` may arrive in selection-click order, so sort by
  // their current index on the layer.
  const sorted = nodes.slice().sort((a, b) => a.getZIndex() - b.getZIndex());
  for (const node of sorted) {
    const worldX = node.x();
    const worldY = node.y();
    // `moveTo` reparents without clobbering position, but position is in
    // the previous parent's coords — subtract the group origin to keep
    // visual placement identical after reparent.
    node.moveTo(group);
    node.x(worldX - minX);
    node.y(worldY - minY);
    // Children inside a group must not be individually draggable — see
    // insertGroup for why.
    if (typeof node.draggable === 'function') node.draggable(false);
  }
  layer.add(group);
  layer.batchDraw();
  return group;
}

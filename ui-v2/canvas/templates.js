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
  for (const child of children) group.add(child);
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
  const children = [];
  const centerNode = createEllipse({ x: 0, y: 0, radiusX: 80, radiusY: 40 });
  centerNode.fill('#3b3b3b');
  children.push(centerNode);
  // Text label for center
  const centerText = createText({ x: -60, y: -10, text: 'Main idea', fontSize: 16 });
  children.push(centerText);

  const branchLabels = ['Branch A', 'Branch B', 'Branch C', 'Branch D', 'Branch E', 'Branch F'];
  const radius = 200;
  branchLabels.forEach((label, i) => {
    const angle = (i / branchLabels.length) * Math.PI * 2 - Math.PI / 2;
    const bx = Math.cos(angle) * radius;
    const by = Math.sin(angle) * radius;
    const node = createRect({ x: bx - 60, y: by - 22, width: 120, height: 44 });
    children.push(node);
    children.push(createText({ x: bx - 40, y: by - 8, text: label, fontSize: 13 }));
    // Arrow from center edge to branch — in template coordinates. Not bound to
    // source/target here because they're inside the group; the group's
    // internal layout is static.
    children.push(createArrow({ points: [0, 0, bx, by] }));
  });

  return insertGroup(layer, children);
}

// ── Flowchart starter ────────────────────────────────────────────────────────

export function insertFlowchart(layer) {
  const children = [];

  const start = createEllipse({ x: 0, y: -180, radiusX: 60, radiusY: 28 });
  start.fill('#1f3f6b');
  children.push(start);
  children.push(createText({ x: -20, y: -188, text: 'Start', fontSize: 14 }));

  const step = createRect({ x: -80, y: -70, width: 160, height: 56 });
  children.push(step);
  children.push(createText({ x: -30, y: -50, text: 'Step 1', fontSize: 14 }));

  const decision = createDiamond({ x: 0, y: 70, width: 160, height: 96 });
  children.push(decision);
  children.push(createText({ x: -38, y: 60, text: 'Decision?', fontSize: 13 }));

  const endYes = createEllipse({ x: -140, y: 210, radiusX: 60, radiusY: 28 });
  endYes.fill('#2a5a2a');
  children.push(endYes);
  children.push(createText({ x: -160, y: 202, text: 'End (yes)', fontSize: 13 }));

  const endNo = createEllipse({ x: 140, y: 210, radiusX: 60, radiusY: 28 });
  endNo.fill('#6a2a2a');
  children.push(endNo);
  children.push(createText({ x: 120, y: 202, text: 'End (no)', fontSize: 13 }));

  // Arrows — static within the template group.
  children.push(createArrow({ points: [0, -152, 0, -70] }));
  children.push(createArrow({ points: [0, -14, 0, 20] }));
  children.push(createArrow({ points: [-50, 110, -140, 182] }));
  children.push(createArrow({ points: [50, 110, 140, 182] }));

  return insertGroup(layer, children);
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
  }
  layer.add(group);
  layer.batchDraw();
  return group;
}

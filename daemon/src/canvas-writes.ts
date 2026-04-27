// canvas-writes.ts — Daemon-side primitives that append shapes / text /
// connectors / comments to a canvas-state.json file. Used by the MCP
// write tools. Output must match what Konva's serializer produces on the
// browser side (see ui-v2/canvas/shapes.js + serialize.js) so the state
// round-trips cleanly through deserializeInto().
//
// Shape defaults mirror the ui-v2/canvas/shapes.js `common()` helper so
// AI-authored shapes look identical to user-drawn ones.

import crypto from 'crypto';
import { loadCanvasState, saveCanvasState } from './canvas.js';

// Keep in sync with ui-v2/canvas/shapes.js:
//   STROKE / FILL_SOFT / STICKY_FILL / TEXT_FILL / FONT_STACK
const STROKE = '#e5e7eb';
const FILL_SOFT = 'rgba(255, 255, 255, 0.08)';
const STICKY_FILL = '#fff2a8';
const TEXT_FILL = '#f2f2f2';
const FONT_STACK = "'Geist Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

// Path data for non-geometric flowchart shapes. Must match ui-v2/canvas/paths.js
// exactly — these strings are fed into Konva.Path which renders them verbatim.
const PATHS: Record<string, string> = {
  cloud: 'M 20 70 Q 0 70 0 55 Q 0 40 15 35 Q 15 15 35 15 Q 50 0 65 15 Q 90 10 95 30 Q 100 55 80 60 Q 75 75 55 70 Q 40 85 20 70 Z',
  speech: 'M 10 0 L 90 0 Q 100 0 100 10 L 100 65 Q 100 75 90 75 L 30 75 L 20 95 L 20 75 L 10 75 Q 0 75 0 65 L 0 10 Q 0 0 10 0 Z',
  document: 'M 0 0 L 75 0 L 100 25 L 100 100 L 0 100 Z M 75 0 L 75 25 L 100 25',
  cylinder: 'M 0 15 L 0 85 Q 0 100 50 100 Q 100 100 100 85 L 100 15 Q 100 0 50 0 Q 0 0 0 15 M 0 15 Q 0 30 50 30 Q 100 30 100 15',
  parallelogram: 'M 20 0 L 100 0 L 80 100 L 0 100 Z',
};

export type ShapeKind =
  | 'rectangle' | 'circle' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'star'
  | 'sticky' | 'parallelogram' | 'document' | 'cylinder' | 'cloud' | 'speech';

interface CanvasStateDoc {
  version?: number;
  children?: CanvasNode[];
  className?: string;
  attrs?: Record<string, unknown>;
}

interface CanvasNode {
  className: string;
  attrs: Record<string, unknown>;
  children?: CanvasNode[];
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function commonAttrs(extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fill: FILL_SOFT,
    stroke: STROKE,
    strokeWidth: 1.5,
    draggable: true,
    name: 'shape',
    ...extras,
  };
}

// Load or create an empty state document.
function load(projectId: string): CanvasStateDoc {
  const raw = loadCanvasState(projectId);
  if (!raw) return { version: 1, children: [] };
  try {
    const parsed = JSON.parse(raw) as CanvasStateDoc;
    if (!parsed.children) parsed.children = [];
    return parsed;
  } catch {
    return { version: 1, children: [] };
  }
}

function save(projectId: string, doc: CanvasStateDoc): void {
  saveCanvasState(projectId, JSON.stringify(doc));
}

// ─── Shape appenders ─────────────────────────────────────────────────────────

export interface AddShapeInput {
  kind: ShapeKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  fill?: string;
  stroke?: string;
}

export function addShape(projectId: string, input: AddShapeInput): { id: string } {
  const doc = load(projectId);
  const id = newId('s');
  const node = shapeNode(id, input);
  doc.children!.push(node);
  if (input.text && input.kind !== 'sticky') {
    // Put a free-floating text node at the shape's center so AI callers get
    // labeled shapes without a separate call.
    const w = input.width ?? shapeDefaultSize(input.kind).w;
    const h = input.height ?? shapeDefaultSize(input.kind).h;
    doc.children!.push(textNode(newId('t'), input.x + w / 2, input.y + h / 2, input.text, { align: 'center' }));
  }
  save(projectId, doc);
  return { id };
}

function shapeDefaultSize(kind: ShapeKind): { w: number; h: number } {
  switch (kind) {
    case 'circle': case 'triangle': case 'hexagon': return { w: 100, h: 100 };
    case 'ellipse': return { w: 140, h: 80 };
    case 'diamond': return { w: 140, h: 90 };
    case 'star': return { w: 110, h: 110 };
    case 'sticky': return { w: 180, h: 140 };
    default: return { w: 140, h: 90 };
  }
}

function shapeNode(id: string, input: AddShapeInput): CanvasNode {
  const { kind, x, y, fill, stroke, text } = input;
  const size = shapeDefaultSize(kind);
  const w = input.width ?? size.w;
  const h = input.height ?? size.h;
  const overrides: Record<string, unknown> = { id };
  if (fill) overrides.fill = fill;
  if (stroke) overrides.stroke = stroke;

  switch (kind) {
    case 'rectangle':
      return { className: 'Rect', attrs: commonAttrs({ ...overrides, x, y, width: w, height: h }) };
    case 'circle':
      return { className: 'Ellipse', attrs: commonAttrs({ ...overrides, x: x + w / 2, y: y + h / 2, radiusX: w / 2, radiusY: h / 2 }) };
    case 'ellipse':
      return { className: 'Ellipse', attrs: commonAttrs({ ...overrides, x: x + w / 2, y: y + h / 2, radiusX: w / 2, radiusY: h / 2 }) };
    case 'triangle':
      return { className: 'RegularPolygon', attrs: commonAttrs({ ...overrides, x: x + w / 2, y: y + h / 2, sides: 3, radius: Math.min(w, h) / 2 }) };
    case 'diamond': {
      const hw = w / 2;
      const hh = h / 2;
      return { className: 'Line', attrs: commonAttrs({ ...overrides, x: x + hw, y: y + hh, points: [0, -hh, hw, 0, 0, hh, -hw, 0], closed: true }) };
    }
    case 'hexagon':
      return { className: 'RegularPolygon', attrs: commonAttrs({ ...overrides, x: x + w / 2, y: y + h / 2, sides: 6, radius: Math.min(w, h) / 2 }) };
    case 'star':
      return { className: 'Star', attrs: commonAttrs({ ...overrides, x: x + w / 2, y: y + h / 2, numPoints: 5, innerRadius: Math.min(w, h) / 4, outerRadius: Math.min(w, h) / 2 }) };
    case 'sticky':
      return { className: 'Rect', attrs: commonAttrs({ ...overrides, x, y, width: w, height: h, fill: fill ?? STICKY_FILL, stroke: stroke ?? 'rgba(0,0,0,0.15)' }) };
    case 'parallelogram': case 'document': case 'cylinder': case 'cloud': case 'speech':
      return {
        className: 'Path',
        attrs: commonAttrs({
          ...overrides,
          x, y,
          data: PATHS[kind],
          scaleX: w / 100,
          scaleY: h / 100,
        }),
      };
  }
}

// ─── Text ────────────────────────────────────────────────────────────────────

export interface AddTextInput {
  x: number;
  y: number;
  text: string;
  fontSize?: number;
}

export function addText(projectId: string, input: AddTextInput): { id: string } {
  const doc = load(projectId);
  const id = newId('t');
  doc.children!.push(textNode(id, input.x, input.y, input.text, { fontSize: input.fontSize }));
  save(projectId, doc);
  return { id };
}

function textNode(id: string, x: number, y: number, text: string, opts: { align?: string; fontSize?: number } = {}): CanvasNode {
  return {
    className: 'Text',
    attrs: {
      id,
      x, y,
      text,
      fontSize: opts.fontSize ?? 16,
      fontFamily: FONT_STACK,
      fill: TEXT_FILL,
      draggable: true,
      name: 'shape',
      ...(opts.align ? { align: opts.align } : {}),
    },
  };
}

// ─── Freehand path ───────────────────────────────────────────────────────────

export function addPath(projectId: string, points: number[], stroke?: string): { id: string } {
  if (points.length < 4 || points.length % 2 !== 0) {
    throw new Error('points must be a non-empty flat array of [x,y,x,y,...] pairs');
  }
  const doc = load(projectId);
  const id = newId('p');
  doc.children!.push({
    className: 'Line',
    attrs: commonAttrs({
      id,
      points,
      stroke: stroke ?? STROKE,
      strokeWidth: 2,
      fill: 'transparent',
      lineCap: 'round',
      lineJoin: 'round',
      tension: 0.4,
    }),
  });
  save(projectId, doc);
  return { id };
}

// ─── Connectors (arrow / elbow) ──────────────────────────────────────────────

// Connector defaults match ui-v2/canvas/shapes.js:
//   ARROW_POINTER (8) and CONNECTOR_HIT_STROKE (16). Keeping these in sync
//   is what lets MCP-authored connectors look and click identically to
//   user-drawn ones.
const ARROW_POINTER = 8;
const CONNECTOR_HIT_STROKE = 16;

// 8-point anchor scheme: 4 corners + 4 edge midpoints. Mirrors
// ui-v2/canvas/anchors.js so MCP-authored connectors snap to the same
// points the user gets when drawing a connector by hand. Returns
// { id, x, y } per anchor; the id is persisted on the connector so
// rebindAll re-resolves it after future shape moves/rotations.
function bboxAnchors(bounds: { x: number; y: number; width: number; height: number }) {
  const x0 = bounds.x;
  const y0 = bounds.y;
  const x1 = x0 + bounds.width;
  const y1 = y0 + bounds.height;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  return [
    { id: 'tl', x: x0, y: y0 },
    { id: 'tm', x: mx, y: y0 },
    { id: 'tr', x: x1, y: y0 },
    { id: 'rm', x: x1, y: my },
    { id: 'br', x: x1, y: y1 },
    { id: 'bm', x: mx, y: y1 },
    { id: 'bl', x: x0, y: y1 },
    { id: 'lm', x: x0, y: my },
  ];
}

function nearestAnchor(anchors: { id: string; x: number; y: number }[], target: { x: number; y: number }) {
  let best = anchors[0];
  let bestD = Infinity;
  for (const a of anchors) {
    const d = (a.x - target.x) ** 2 + (a.y - target.y) ** 2;
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

export function addConnector(projectId: string, fromId: string, toId: string, kind: 'arrow' | 'elbow'): { id: string } {
  const doc = load(projectId);
  const from = findNode(doc.children!, fromId);
  const to = findNode(doc.children!, toId);
  if (!from) throw new Error(`from shape not found: ${fromId}`);
  if (!to) throw new Error(`to shape not found: ${toId}`);

  const fromCenter = nodeCenter(from);
  const toCenter = nodeCenter(to);
  // Source endpoint = source's anchor closest to target's center.
  // Target endpoint = target's anchor closest to source's center.
  // Same scheme an interactively-drawn connector uses, so AI-drawn
  // connectors snap to the same 8 named points (tl/tm/tr/rm/br/bm/bl/lm)
  // a user gets when they drop a connector endpoint on a shape.
  const fromAnchor = nearestAnchor(bboxAnchors(nodeBounds(from)), toCenter);
  const toAnchor = nearestAnchor(bboxAnchors(nodeBounds(to)), fromCenter);

  const id = newId('c');
  const isElbow = kind === 'elbow';
  // Elbow routing matches ui-v2/canvas/connectors.js#recomputeConnector:
  // 3 points with the corner at (target.x, source.y).
  const points = isElbow
    ? [fromAnchor.x, fromAnchor.y, toAnchor.x, fromAnchor.y, toAnchor.x, toAnchor.y]
    : [fromAnchor.x, fromAnchor.y, toAnchor.x, toAnchor.y];

  doc.children!.push({
    className: 'Arrow',
    attrs: {
      id,
      points,
      stroke: STROKE,
      fill: STROKE,
      strokeWidth: 2,
      pointerLength: ARROW_POINTER,
      pointerWidth: ARROW_POINTER,
      // hitStrokeWidth gives the thin connector line a generous click zone —
      // matches what user-drawn connectors get (see shapes.js).
      hitStrokeWidth: CONNECTOR_HIT_STROKE,
      // Bound connectors aren't whole-line draggable — endpoints handle reroute.
      draggable: false,
      // The 'connector' tag is what rebindAll() filters on at load time.
      // 'connector-elbow' triggers the L-bend recompute path.
      name: isElbow ? 'shape connector connector-elbow' : 'shape connector',
      // Bind metadata: rebindAll(contentLayer) reads these on canvas load
      // and reattaches dragmove listeners, so AI-drawn arrows follow shape
      // moves identically to user-drawn ones — no more positional snapshots.
      sourceId: fromId,
      targetId: toId,
      sourceAnchorId: fromAnchor.id,
      targetAnchorId: toAnchor.id,
      ...(isElbow ? { tension: 0, lineJoin: 'round' } : {}),
    },
  });
  save(projectId, doc);
  return { id };
}

// Axis-aligned bounding box for a shape. For rectangular shapes this is
// exact; for circles/ellipses/polygons we approximate with their enclosing
// rect, which is good enough for connector routing.
function nodeBounds(node: CanvasNode): { x: number; y: number; width: number; height: number } {
  const a = node.attrs as { x?: number; y?: number; width?: number; height?: number; radiusX?: number; radiusY?: number; radius?: number };
  const x = a.x ?? 0;
  const y = a.y ?? 0;
  if (typeof a.width === 'number' && typeof a.height === 'number') {
    return { x, y, width: a.width, height: a.height };
  }
  const rx = a.radiusX ?? a.radius ?? 0;
  const ry = a.radiusY ?? a.radius ?? 0;
  return { x: x - rx, y: y - ry, width: rx * 2, height: ry * 2 };
}

export function findNode(children: CanvasNode[], id: string): CanvasNode | null {
  for (const n of children) {
    if ((n.attrs as { id?: string }).id === id) return n;
    if (n.children) {
      const nested = findNode(n.children, id);
      if (nested) return nested;
    }
  }
  return null;
}

export function nodeCenter(node: CanvasNode): { x: number; y: number } {
  const a = node.attrs as { x?: number; y?: number; width?: number; height?: number; radiusX?: number; radiusY?: number; radius?: number };
  const x = a.x ?? 0;
  const y = a.y ?? 0;
  if (typeof a.width === 'number' && typeof a.height === 'number') {
    return { x: x + a.width / 2, y: y + a.height / 2 };
  }
  // Circle / Ellipse / RegularPolygon already use their center as x/y.
  return { x, y };
}

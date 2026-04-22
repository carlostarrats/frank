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

export function addConnector(projectId: string, fromId: string, toId: string, kind: 'arrow' | 'elbow'): { id: string } {
  const doc = load(projectId);
  const from = findNode(doc.children!, fromId);
  const to = findNode(doc.children!, toId);
  if (!from) throw new Error(`from shape not found: ${fromId}`);
  if (!to) throw new Error(`to shape not found: ${toId}`);
  const a = nodeCenter(from);
  const b = nodeCenter(to);
  const id = newId('c');
  // Simple straight-line arrow. Elbow adds a midpoint; full connector
  // follow-shape logic lives in the browser (ui-v2/canvas/connectors.js).
  // AI-authored connectors are snapshotted, not live-following — if the user
  // moves the endpoints, the connector won't chase. That's a v1 tradeoff.
  const points = kind === 'elbow'
    ? [a.x, a.y, (a.x + b.x) / 2, a.y, (a.x + b.x) / 2, b.y, b.x, b.y]
    : [a.x, a.y, b.x, b.y];
  doc.children!.push({
    className: 'Arrow',
    attrs: commonAttrs({
      id,
      points,
      stroke: STROKE,
      fill: STROKE,
      strokeWidth: 1.5,
      pointerLength: 10,
      pointerWidth: 10,
    }),
  });
  save(projectId, doc);
  return { id };
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

// shapes.js — Shape factory functions, one per shape type.
//
// Every factory returns a ready-to-add Konva node (with `draggable: true` and
// `name: 'shape'` so the Transformer in transformer.js picks it up). tools.js
// calls these for interactive drawing; templates.js calls them to compose
// templates.
//
// Defaults are tuned for Frank's dark canvas background. Users can override
// any visual attr via the properties inspector.

import { CLOUD, SPEECH_BUBBLE, DOCUMENT, CYLINDER, PARALLELOGRAM } from './paths.js';

const STROKE = '#e5e7eb';
const FILL_SOFT = 'rgba(255, 255, 255, 0.08)';
const STICKY_FILL = '#fff2a8';
const TEXT_FILL = '#f2f2f2';

// Konva renders to a <canvas>, not the DOM — `fontFamily: "inherit"` silently
// falls back to Konva's built-in default (Arial). Hard-code the full Geist
// Mono stack from tokens.css so canvas text matches the rest of the app.
const FONT_STACK = "'Geist Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

function common(extras = {}) {
  return {
    fill: FILL_SOFT,
    stroke: STROKE,
    strokeWidth: 1.5,
    draggable: true,
    name: 'shape',
    ...extras,
  };
}

// ── Primitive rectangles / circles / polygons ────────────────────────────────

export function createRect({ x, y, width = 120, height = 80 } = {}) {
  const Konva = window.Konva;
  return new Konva.Rect({ ...common(), x, y, width, height });
}

// Circle and Ellipse are the same tool: Konva.Ellipse with radiusX === radiusY
// starts as a perfect circle; the Transformer's non-uniform resize lets the
// user stretch it into an ellipse after placement. Keeping a separate Circle
// factory here for templates that specifically want a circle shape.
export function createCircle({ x, y, radius = 50 } = {}) {
  const Konva = window.Konva;
  return new Konva.Ellipse({ ...common(), x, y, radiusX: radius, radiusY: radius });
}

export function createEllipse({ x, y, radiusX = 70, radiusY = 40 } = {}) {
  const Konva = window.Konva;
  return new Konva.Ellipse({ ...common(), x, y, radiusX, radiusY });
}

export function createTriangle({ x, y, radius = 50 } = {}) {
  const Konva = window.Konva;
  return new Konva.RegularPolygon({ ...common(), x, y, sides: 3, radius });
}

// Flowchart diamond: wider than tall, drawn as a 4-point closed polyline so
// it reads unambiguously as a rhombus rather than a rotated square.
export function createDiamond({ x, y, width = 140, height = 90 } = {}) {
  const Konva = window.Konva;
  const hw = width / 2;
  const hh = height / 2;
  return new Konva.Line({
    ...common(),
    x,
    y,
    points: [0, -hh, hw, 0, 0, hh, -hw, 0],
    closed: true,
  });
}

export function createHexagon({ x, y, radius = 55 } = {}) {
  const Konva = window.Konva;
  return new Konva.RegularPolygon({ ...common(), x, y, sides: 6, radius });
}

export function createStar({ x, y, innerRadius = 25, outerRadius = 55, numPoints = 5 } = {}) {
  const Konva = window.Konva;
  return new Konva.Star({ ...common(), x, y, numPoints, innerRadius, outerRadius });
}

// ── Path-based shapes ────────────────────────────────────────────────────────

function pathShape({ x, y, width, height, data }) {
  const Konva = window.Konva;
  return new Konva.Path({
    ...common(),
    x,
    y,
    data,
    scaleX: width / 100,
    scaleY: height / 100,
  });
}

export function createCloud({ x, y, width = 140, height = 100 } = {}) {
  return pathShape({ x, y, width, height, data: CLOUD });
}

export function createSpeechBubble({ x, y, width = 160, height = 100 } = {}) {
  return pathShape({ x, y, width, height, data: SPEECH_BUBBLE });
}

export function createDocument({ x, y, width = 120, height = 140 } = {}) {
  return pathShape({ x, y, width, height, data: DOCUMENT });
}

export function createCylinder({ x, y, width = 120, height = 140 } = {}) {
  return pathShape({ x, y, width, height, data: CYLINDER });
}

export function createParallelogram({ x, y, width = 160, height = 80 } = {}) {
  return pathShape({ x, y, width, height, data: PARALLELOGRAM });
}

// ── Freehand / arrow / elbow connector ───────────────────────────────────────

// Pointer size for arrow heads. Kept modest so short arrows still read as
// arrows (not dominated triangles).
const ARROW_POINTER = 8;

// Hit area for thin connector lines — wide enough to click without
// pixel-perfect aim, narrow enough that the line doesn't steal clicks
// from nearby shape edges when a connector endpoint snaps to a corner.
// Exported so serialize.js applies the same value to connectors restored
// from disk.
export const CONNECTOR_HIT_STROKE = 16;

export function createArrow({ points, stroke = STROKE, strokeWidth = 2 }) {
  const Konva = window.Konva;
  return new Konva.Arrow({
    points,
    pointerLength: ARROW_POINTER,
    pointerWidth: ARROW_POINTER,
    stroke,
    fill: stroke,
    strokeWidth,
    hitStrokeWidth: CONNECTOR_HIT_STROKE,
    draggable: true,
    name: 'shape connector',
  });
}

// Elbow (right-angle) connector: three points. mid is the L bend.
export function createElbow({ x1, y1, x2, y2, horizontalFirst = true, stroke = STROKE, strokeWidth = 2 }) {
  const Konva = window.Konva;
  const mid = horizontalFirst ? { x: x2, y: y1 } : { x: x1, y: y2 };
  return new Konva.Arrow({
    points: [x1, y1, mid.x, mid.y, x2, y2],
    pointerLength: ARROW_POINTER,
    pointerWidth: ARROW_POINTER,
    stroke,
    fill: stroke,
    strokeWidth,
    hitStrokeWidth: CONNECTOR_HIT_STROKE,
    draggable: true,
    tension: 0,
    lineJoin: 'round',
    name: 'shape connector connector-elbow',
  });
}

export function createFreehand({ points, stroke = STROKE, strokeWidth = 2 }) {
  const Konva = window.Konva;
  return new Konva.Line({
    points,
    stroke,
    strokeWidth,
    lineCap: 'round',
    lineJoin: 'round',
    tension: 0.4,
    draggable: true,
    name: 'shape',
  });
}

// ── Text and sticky ──────────────────────────────────────────────────────────

export function createText({ x, y, text = 'Text', fontSize = 18, fill = TEXT_FILL }) {
  const Konva = window.Konva;
  return new Konva.Text({
    x,
    y,
    text,
    fontSize,
    fontFamily: FONT_STACK,
    fill,
    draggable: true,
    name: 'shape text',
  });
}

export function createSticky({ x, y, width = 160, height = 120, text = 'Double-click to edit' }) {
  const Konva = window.Konva;
  const group = new Konva.Group({ x, y, draggable: true, name: 'shape sticky' });
  const bg = new Konva.Rect({
    width,
    height,
    fill: STICKY_FILL,
    stroke: '#b39700',
    strokeWidth: 1,
    cornerRadius: 4,
    shadowColor: 'black',
    shadowOpacity: 0.1,
    shadowBlur: 6,
    shadowOffset: { x: 0, y: 2 },
  });
  const textNode = new Konva.Text({
    x: 12,
    y: 12,
    width: width - 24,
    text,
    fontSize: 14,
    fontFamily: FONT_STACK,
    fill: '#333',
  });
  group.add(bg);
  group.add(textNode);
  // Expose the text node for the editable-text binder in tools.js.
  group._stickyText = textNode;
  return group;
}

// ── Column header label (Konva.Label + Konva.Tag) ────────────────────────────

export function createLabel({ x, y, text, fill = '#111', backgroundFill = '#f5f5f5', padding = 6, fontSize = 13 }) {
  const Konva = window.Konva;
  const label = new Konva.Label({ x, y, name: 'shape label' });
  label.add(new Konva.Tag({
    fill: backgroundFill,
    cornerRadius: 2,
  }));
  label.add(new Konva.Text({
    text,
    fontFamily: FONT_STACK,
    fontSize,
    padding,
    fill,
  }));
  return label;
}
